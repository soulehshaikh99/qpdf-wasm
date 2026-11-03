const assert = require("assert");
const path = require("path");
const fs = require("fs/promises");
const Module = require("../");

const OUT = path.join(__dirname, "out");
const SAMPLE = "assets/sample.pdf";

before(async function () {
  await fs.mkdir(OUT, { recursive: true });
});

describe("all", function () {
  this.timeout(30000);

  it("should report a version", async function () {
    const { code, out } = await run(["--version"]);
    assert.equal(code, 0);
    // Program name comes from process.argv[1] (e.g. "mocha"), so match only the version.
    assert.match(out, /version \d+\.\d+\.\d+/);
  });

  it("should remove pdf pages", async function () {
    const exitStatus = (
      await run([SAMPLE, "--pages", ".", "1-2", "--", "out/removed.pdf"])
    ).code;
    assert.equal(exitStatus, 0);

    const check = await run(["--check", "out/removed.pdf"]);
    assert.equal(check.code, 0, check.out);

    const npages = await run(["--show-npages", "out/removed.pdf"]);
    assert.equal(npages.code, 0);
    assert.equal(npages.out.trim(), "2");
  });

  // Ensure this doesn't call `process.exit`
  it("should exit properly on error", async function () {
    const { code } = await run(["unknown-subcommand"]);
    assert.equal(code, 2);
  });

  it("should uncompress and recompress flate streams (zlib)", async function () {
    const plain = await run([
      SAMPLE,
      "--stream-data=uncompress",
      "out/uncompressed.pdf",
    ]);
    assert.equal(plain.code, 0);

    const packed = await run([
      "out/uncompressed.pdf",
      "--compress-streams=y",
      "--recompress-flate",
      "--compression-level=9",
      "out/compressed.pdf",
    ]);
    assert.equal(packed.code, 0);

    assert.equal((await run(["--check", "out/compressed.pdf"])).code, 0);
    const [u, c] = await Promise.all([
      fs.stat(path.join(OUT, "uncompressed.pdf")),
      fs.stat(path.join(OUT, "compressed.pdf")),
    ]);
    assert.ok(c.size < u.size, `compressed ${c.size} >= uncompressed ${u.size}`);
  });

  it("should encode and decode JPEG images (libjpeg-turbo)", async function () {
    await fs.writeFile(path.join(OUT, "raw-image.pdf"), buildImagePdf(64, 64));

    const opt = await run([
      "out/raw-image.pdf",
      "--optimize-images",
      "--oi-min-width=0",
      "--oi-min-height=0",
      "--oi-min-area=0",
      "out/jpeg.pdf",
    ]);
    assert.equal(opt.code, 0);
    const jpeg = await fs.readFile(path.join(OUT, "jpeg.pdf"), "latin1");
    assert.ok(jpeg.includes("/DCTDecode"), "image was not converted to JPEG");

    const dec = await run([
      "out/jpeg.pdf",
      "--decode-level=all",
      "out/decoded.pdf",
    ]);
    assert.equal(dec.code, 0);
    const decoded = await fs.readFile(path.join(OUT, "decoded.pdf"), "latin1");
    assert.ok(!decoded.includes("/DCTDecode"), "JPEG was not decoded");
  });

  it("should encrypt and decrypt with AES-256 (native crypto)", async function () {
    const enc = await run([
      SAMPLE,
      "--encrypt",
      "--user-password=user",
      "--owner-password=owner",
      "--bits=256",
      "--",
      "out/encrypted.pdf",
    ]);
    assert.equal(enc.code, 0);

    // --is-encrypted: exit 0 = encrypted, 2 = not encrypted
    assert.equal((await run(["--is-encrypted", "out/encrypted.pdf"])).code, 0);
    // Opening without the password must fail
    assert.equal((await run(["--check", "out/encrypted.pdf"])).code, 2);

    const dec = await run([
      "--password=user",
      "--decrypt",
      "out/encrypted.pdf",
      "out/decrypted.pdf",
    ]);
    assert.equal(dec.code, 0);

    assert.equal((await run(["--is-encrypted", "out/decrypted.pdf"])).code, 2);
    assert.equal((await run(["--check", "out/decrypted.pdf"])).code, 0);
  });

  // Recovery relies on libqpdf's internal try/catch (needs -fexceptions at compile time).
  it("should recover a PDF with a broken xref", async function () {
    const good = buildImagePdf(8, 8).toString("latin1");
    const broken = good.replace(/startxref\n\d+/, "startxref\n999999");
    await fs.writeFile(path.join(OUT, "broken.pdf"), broken, "latin1");

    const fixed = await run(["out/broken.pdf", "out/recovered.pdf"]);
    assert.equal(fixed.code, 3, "expected success with warnings");
    assert.equal((await run(["--check", "out/recovered.pdf"])).code, 0);
  });

  it("should linearize", async function () {
    const lin = await run([SAMPLE, "--linearize", "out/linearized.pdf"]);
    assert.equal(lin.code, 0);
    const check = await run(["--check-linearization", "out/linearized.pdf"]);
    assert.equal(check.code, 0, check.out);
  });

  it("should work with in-memory FS (browser-style usage)", async function () {
    const mod = await Module();
    const input = await fs.readFile(path.join(__dirname, SAMPLE));
    mod.FS.writeFile("/in.pdf", input);

    const { code } = capture(() =>
      mod.callMain(["/in.pdf", "--pages", ".", "1", "--", "/out.pdf"])
    );
    assert.equal(code, 0);

    const output = mod.FS.readFile("/out.pdf");
    assert.ok(output.length > 0);
    assert.equal(Buffer.from(output.subarray(0, 5)).toString(), "%PDF-");

    const npages = capture(() => mod.callMain(["--show-npages", "/out.pdf"]));
    assert.equal(npages.out.trim(), "1");
  });

  it("should allow callMain more than once on one instance", async function () {
    const mod = await Module();
    mount(mod);
    // Not `--check`: sample.pdf has broken linearization hints, so it exits 3 (warnings).
    const pages = (out) => [SAMPLE, "--pages", ".", "1", "--", out];
    const first = capture(() => mod.callMain(pages("out/reuse-1.pdf")));
    const second = capture(() => mod.callMain(pages("out/reuse-2.pdf")));
    assert.equal(first.code, 0);
    assert.equal(second.code, 0);
  });
});

// Fresh module, NODEFS mounted at tests/, stdout captured.
async function run(args) {
  const mod = await Module();
  mount(mod);
  return capture(() => mod.callMain(args));
}

function mount(mod) {
  const working = "/working";
  mod.FS.mkdir(working);
  mod.FS.mount(mod.NODEFS, { root: __dirname }, working);
  mod.FS.chdir(working);
}

// Build exposes no `print` option, so intercept Node's stdout while
// the synchronous callMain runs.
function capture(fn) {
  const chunks = [];
  const orig = process.stdout.write;
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    const code = fn();
    return { code, out: chunks.join("") };
  } finally {
    process.stdout.write = orig;
  }
}

// Minimal one-page PDF holding an uncompressed RGB gradient image.
function buildImagePdf(w, h) {
  const pixels = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      pixels[i] = (x * 255) / (w - 1);
      pixels[i + 1] = (y * 255) / (h - 1);
      pixels[i + 2] = 128;
    }
  }
  const content = Buffer.from(`q ${w} 0 0 ${h} 0 0 cm /Im1 Do Q`, "latin1");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
      "/Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>",
    [
      `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${pixels.length} >>`,
      pixels,
    ],
    [`<< /Length ${content.length} >>`, content],
  ];

  const parts = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets = [];
  let pos = parts[0].length;
  const push = (buf) => {
    parts.push(buf);
    pos += buf.length;
  };

  objects.forEach((obj, idx) => {
    offsets.push(pos);
    const n = idx + 1;
    if (Array.isArray(obj)) {
      push(Buffer.from(`${n} 0 obj\n${obj[0]}\nstream\n`, "latin1"));
      push(obj[1]);
      push(Buffer.from("\nendstream\nendobj\n", "latin1"));
    } else {
      push(Buffer.from(`${n} 0 obj\n${obj}\nendobj\n`, "latin1"));
    }
  });

  const xrefPos = pos;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  xref +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefPos}\n%%EOF\n`;
  push(Buffer.from(xref, "latin1"));

  return Buffer.concat(parts);
}
