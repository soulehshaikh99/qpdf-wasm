# @soulehshaikh99/qpdf-wasm &middot; [![NPM Version](https://img.shields.io/npm/v/@soulehshaikh99/qpdf-wasm)](https://www.npmjs.com/package/@soulehshaikh99/qpdf-wasm) [![License: ISC](https://img.shields.io/badge/license-ISC-blue.svg)](LICENSE)

[QPDF](https://github.com/qpdf/qpdf) **12.4.2** compiled to WebAssembly. Runs in the browser, in Web Workers and in Node.js, with no server and no native binaries.

Use it to merge, split, rotate, encrypt, decrypt, linearize, repair and inspect PDFs entirely client side.

> **This is a maintained fork of [neslinesli93/qpdf-wasm](https://github.com/neslinesli93/qpdf-wasm)**, created by [Tommaso Pifferi](https://github.com/neslinesli93). All credit for the original build pipeline, JS glue and packaging goes to the original author. This fork keeps the same API and updates the toolchain and bundled libraries to their latest releases.

---

## Table of contents

- [What this fork offers](#what-this-fork-offers)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Core concepts](#core-concepts)
- [Usage recipes](#usage-recipes)
  - [Node.js](#nodejs)
  - [Browser (main thread)](#browser-main-thread)
  - [Web Worker with WORKERFS](#web-worker-with-workerfs)
  - [Bundler setup (Vite, webpack, Next.js)](#bundler-setup)
  - [Common qpdf commands](#common-qpdf-commands)
- [TypeScript](#typescript)
- [Troubleshooting](#troubleshooting)
- [Building from source](#building-from-source)
- [Project layout](#project-layout)
- [Updating bundled versions](#updating-bundled-versions)
- [Credits](#credits)
- [License](#license)

---

## What this fork offers

The upstream package was last built against qpdf 12.2.0 and Emscripten 3.1.74. This fork rebuilds everything on current releases so you get the latest qpdf fixes and up-to-date compression and image libraries.

| Component         | Upstream (`@neslinesli93/qpdf-wasm` 0.3.0) | This fork (`@soulehshaikh99/qpdf-wasm` 0.4.0) |
| ----------------- | ------------------------------------------ | ------------------------------------- |
| qpdf              | 12.2.0                                     | **12.4.2**                            |
| Emscripten (emsdk)| 3.1.74                                     | **6.0.13**                            |
| zlib              | pinned commit (pre 1.3.2)                  | **1.3.2**                             |
| libjpeg-turbo     | ImageMagick mirror (older)                 | **3.2.1** (official `libjpeg-turbo/libjpeg-turbo`) |
| Node.js (build/test image) | 22                                | **24**                                |

Other changes:

- Final link step uses `em++` instead of `emcc`, as needed for the C++ qpdf sources on newer Emscripten.
- Removed the `-s WASM_BIGINT=1` flag. BigInt integration is on by default in current Emscripten.
- Updated the libjpeg-turbo patch for its new source layout (`src/jchuff.c`).
- `.gitattributes` forces LF line endings on `*.sh`, `*.patch` and `Dockerfile`, so the Docker build also works from a Windows checkout.
- Same public API as upstream. Migrating means changing the package name.

Verified: the Node test suite (`docker compose up`) passes, and the build has been checked in the browser.

### Migrating from upstream

```diff
- npm i @neslinesli93/qpdf-wasm
+ npm i @soulehshaikh99/qpdf-wasm
```

```diff
- import createModule from "@neslinesli93/qpdf-wasm";
+ import createModule from "@soulehshaikh99/qpdf-wasm";
```

Nothing else changes.

---

## Installation

```bash
npm i @soulehshaikh99/qpdf-wasm
# or
yarn add @soulehshaikh99/qpdf-wasm
# or
pnpm add @soulehshaikh99/qpdf-wasm
```

The package ships three files in `dist/`:

| File          | Purpose                                              |
| ------------- | ---------------------------------------------------- |
| `qpdf.js`     | Emscripten JS loader (factory function, `MODULARIZE`) |
| `qpdf.wasm`   | Compiled qpdf binary                                 |
| `qpdf.d.ts`   | TypeScript declarations                              |

---

## Quick start

```js
import createModule from "@soulehshaikh99/qpdf-wasm";

const qpdf = await createModule({
  // Must return a URL (browser) or path (Node) where qpdf.wasm can be fetched.
  locateFile: () => "/wasm/qpdf.wasm",
});

// Write the input into the in-memory filesystem
const input = new Uint8Array(await (await fetch("/input.pdf")).arrayBuffer());
qpdf.FS.writeFile("/input.pdf", input);

// Same arguments as the qpdf CLI: keep pages 1-2
const exitCode = qpdf.callMain(["/input.pdf", "--pages", ".", "1-2", "--", "/output.pdf"]);

// Read the result back
if (exitCode === 0 || exitCode === 3) {
  const output = qpdf.FS.readFile("/output.pdf");
  const url = URL.createObjectURL(new Blob([output], { type: "application/pdf" }));
}
```

---

## Core concepts

**Factory function.** The default export is an async factory. Each call returns a new, independent qpdf instance with its own memory and virtual filesystem.

**`callMain(args)`** runs qpdf exactly like the [qpdf CLI](https://qpdf.readthedocs.io/en/stable/cli.html). Pass the arguments you would type after `qpdf` in a terminal. It returns the exit code:

| Exit code | Meaning                               |
| --------- | ------------------------------------- |
| `0`       | Success                               |
| `2`       | Error, no usable output               |
| `3`       | Success with warnings (output written) |

`callMain` never calls `process.exit`. Errors come back as exit codes, and qpdf's messages go to `stderr` (the console by default).

**Virtual filesystem (`FS`).** qpdf runs inside the Emscripten filesystem, not your real disk. You move bytes in and out with:

| Method                         | Use                                                   |
| ------------------------------ | ----------------------------------------------------- |
| `FS.writeFile(path, data)`     | Put a `Uint8Array` into memory (MEMFS)                |
| `FS.readFile(path)`            | Read output as a `Uint8Array`                         |
| `FS.mkdir(path)`               | Create a directory                                    |
| `FS.mount(type, opts, path)`   | Mount `NODEFS` (Node) or `WORKERFS` (Web Worker)      |
| `FS.unmount(path)`             | Unmount                                               |
| `FS.chdir(path)`               | Change working directory                              |
| `FS.unlink(path)`              | Delete a file (free memory between jobs)              |

**Initial run.** `noInitialRun` is already set to `true` by the package, so qpdf does not run when the module loads. It runs only when you call `callMain`.

---

## Usage recipes

### Node.js

Mount a real directory with `NODEFS` so qpdf reads and writes your disk directly:

```js
const path = require("path");
const createModule = require("@soulehshaikh99/qpdf-wasm");

async function run(args, dir) {
  const qpdf = await createModule();
  qpdf.FS.mkdir("/work");
  qpdf.FS.mount(qpdf.NODEFS, { root: dir }, "/work");
  qpdf.FS.chdir("/work");
  return qpdf.callMain(args);
}

const code = await run(
  ["input.pdf", "--pages", ".", "1-2", "--", "output.pdf"],
  path.resolve(__dirname, "pdfs")
);
console.log("exit code:", code);
```

In Node, `locateFile` is optional. The loader finds `qpdf.wasm` next to `qpdf.js`.

### Browser (main thread)

```js
import createModule from "@soulehshaikh99/qpdf-wasm";
import wasmUrl from "@soulehshaikh99/qpdf-wasm/dist/qpdf.wasm?url"; // Vite; see bundler section

export async function extractPages(file /* File | Blob */, range = "1-2") {
  const qpdf = await createModule({ locateFile: () => wasmUrl });

  qpdf.FS.writeFile("/in.pdf", new Uint8Array(await file.arrayBuffer()));
  const code = qpdf.callMain(["/in.pdf", "--pages", ".", range, "--", "/out.pdf"]);
  if (code !== 0 && code !== 3) throw new Error(`qpdf failed with exit code ${code}`);

  return new Blob([qpdf.FS.readFile("/out.pdf")], { type: "application/pdf" });
}
```

Large PDFs block the UI thread while qpdf runs. For anything bigger than a few MB, use a Web Worker.

### Web Worker with WORKERFS

`WORKERFS` mounts `File`/`Blob` objects read-only **without copying them into wasm memory**. That makes it the best option for large inputs. It works only inside a Worker.

```js
// qpdf.worker.js
import createModule from "@soulehshaikh99/qpdf-wasm";
import wasmUrl from "@soulehshaikh99/qpdf-wasm/dist/qpdf.wasm?url";

self.onmessage = async ({ data: { file, args } }) => {
  const qpdf = await createModule({ locateFile: () => wasmUrl });

  qpdf.FS.mkdir("/in");
  qpdf.FS.mount(qpdf.WORKERFS, { blobs: [{ name: "input.pdf", data: file }] }, "/in");

  // WORKERFS is read-only, so write output to MEMFS (root)
  const code = qpdf.callMain(["/in/input.pdf", ...args, "/out.pdf"]);
  const output = code === 0 || code === 3 ? qpdf.FS.readFile("/out.pdf") : null;

  qpdf.FS.unmount("/in");
  self.postMessage({ code, output }, output ? [output.buffer] : []);
};
```

```js
// main.js
const worker = new Worker(new URL("./qpdf.worker.js", import.meta.url), { type: "module" });
worker.onmessage = ({ data: { code, output } }) => {
  if (output) window.open(URL.createObjectURL(new Blob([output], { type: "application/pdf" })));
  else console.error("qpdf exit code", code);
};
worker.postMessage({ file: fileInput.files[0], args: ["--linearize"] });
```

### Bundler setup

The `.wasm` file has to be served as a static asset, and `locateFile` has to return its URL.

**Vite.** Import the URL with `?url`:

```js
import wasmUrl from "@soulehshaikh99/qpdf-wasm/dist/qpdf.wasm?url";
const qpdf = await createModule({ locateFile: () => wasmUrl });
```

**webpack 5.** Use an asset module:

```js
const wasmUrl = new URL("@soulehshaikh99/qpdf-wasm/dist/qpdf.wasm", import.meta.url).href;
const qpdf = await createModule({ locateFile: () => wasmUrl });
```

Or copy `node_modules/@soulehshaikh99/qpdf-wasm/dist/qpdf.wasm` into your `public/` folder (or a CDN) and use `locateFile: () => "/wasm/qpdf.wasm"`.

The loader includes code paths for Node. Tell webpack not to polyfill Node built-ins on the client:

```js
// webpack.config.js
module.exports = {
  resolve: {
    fallback: { fs: false, path: false, crypto: false, process: false },
  },
};
```

**Next.js.** Same fallback, client side only. Load qpdf only in client components (`"use client"` or `dynamic(..., { ssr: false })`):

```js
// next.config.js
module.exports = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false, crypto: false, process: false };
    }
    return config;
  },
};
```

**Creating folders before the run.** Use `preRun` to set up directories before qpdf starts:

```js
const qpdf = await createModule({
  locateFile: () => wasmUrl,
  preRun: [(mod) => { mod.FS.mkdir("/input"); mod.FS.mkdir("/output"); }],
});
```

### Common qpdf commands

All examples are `callMain` argument arrays. See the [qpdf CLI docs](https://qpdf.readthedocs.io/en/stable/cli.html) for the full reference.

```js
// Keep pages 1-3 and 7
["/in.pdf", "--pages", ".", "1-3,7", "--", "/out.pdf"]

// Merge several files
["--empty", "--pages", "/a.pdf", "/b.pdf", "/c.pdf", "--", "/merged.pdf"]

// Merge selected pages from different files
["--empty", "--pages", "/a.pdf", "1-2", "/b.pdf", "5,z", "--", "/out.pdf"]   // z = last page

// Split into one file per page -> /page-01.pdf, /page-02.pdf, ...
["/in.pdf", "--split-pages", "/page.pdf"]

// Rotate pages 1-3 by 90 degrees clockwise
["/in.pdf", "--rotate=+90:1-3", "/out.pdf"]

// Encrypt with AES-256
["/in.pdf", "--encrypt", "--user-password=user", "--owner-password=owner", "--bits=256", "--", "/out.pdf"]

// Remove encryption (password needed)
["--password=secret", "--decrypt", "/in.pdf", "/out.pdf"]

// Linearize ("fast web view")
["/in.pdf", "--linearize", "/out.pdf"]

// Shrink: object streams plus maximum compression
["/in.pdf", "--object-streams=generate", "--compression-level=9", "--recompress-flate", "/out.pdf"]

// Validate structure (no output file)
["--check", "/in.pdf"]

// Dump PDF structure as JSON to stdout
["--json", "/in.pdf"]
```

---

## TypeScript

Types are included (`dist/qpdf.d.ts`) and declared for the module `@soulehshaikh99/qpdf-wasm`:

```ts
import createModule, { type QpdfInstance } from "@soulehshaikh99/qpdf-wasm";

const qpdf: QpdfInstance = await createModule({ locateFile: () => wasmUrl });
qpdf.FS.writeFile("/in.pdf", bytes);
const code: number = qpdf.callMain(["--check", "/in.pdf"]);
```

The declarations cover `callMain`, `FS` (`mkdir`, `mount`, `unmount`, `chdir`, `writeFile`, `readFile`, `unlink`), `NODEFS` and `WORKERFS`, plus the factory options `locateFile`, `noInitialRun` and `preRun`. For `?url` imports in Vite, add `/// <reference types="vite/client" />`.

---

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| `failed to asynchronously prepare wasm` / 404 on `qpdf.wasm` | `locateFile` returns the wrong URL. Open it in the browser and check that it serves the file. |
| `Incorrect response MIME type. Expected 'application/wasm'` | Configure your server to send `Content-Type: application/wasm` for `.wasm` files. |
| `Module not found: Can't resolve 'fs'` (webpack/Next.js) | Add the `resolve.fallback` config from [Bundler setup](#bundler-setup). |
| `ReferenceError: window is not defined` in Next.js | You are loading qpdf during SSR. Load it in a client component only. |
| `ErrnoError` / `No such file or directory` | The path in `callMain` doesn't exist in the virtual FS. Write the file with `FS.writeFile` first, or check your mount point. |
| `FS.writeFile` fails inside a WORKERFS mount | WORKERFS is read-only. Write outputs outside the mount (e.g. `/out.pdf`). |
| Out of memory on huge files | Memory growth is enabled, but wasm32 tops out at 4 GB. Use WORKERFS for inputs, run in a Worker, and `FS.unlink` files you no longer need. |
| Odd results when reusing one instance for many jobs | Create a new instance per job with `await createModule(...)`. The test suite does the same. |
| Exit code `3` | Output was written, but qpdf found recoverable problems. Check the console for warnings. |

---

## Building from source

Requirements: [Docker](https://docs.docker.com/get-docker/) with Compose. Emscripten and the libraries are fetched inside the container.

```bash
git clone https://github.com/soulehshaikh99/qpdf-wasm.git
cd qpdf-wasm
docker compose up
```

This runs these steps:

1. Builds the `emscripten/emsdk:6.0.13` stage and shallow clones zlib, libjpeg-turbo and qpdf at pinned commits.
2. Runs [build.sh](build.sh), which compiles zlib and libjpeg-turbo (patched, SIMD off) as static libs, then qpdf, then links `dist/qpdf.js` and `dist/qpdf.wasm` with `em++`.
3. Copies the artifacts into a `node:24` image. The entrypoint puts them in `./dist`.
4. Runs `yarn && yarn test` (mocha, [tests/all.js](tests/all.js)).

When it finishes, `./dist` holds a ready-to-publish build.

Key link flags in [build.sh](build.sh):

| Flag | Why |
| ---- | --- |
| `-Oz -flto -fvisibility=hidden`, `--closure 1` | Smallest output |
| `-s MODULARIZE=1` | Exports a factory function, not a global |
| `-s ALLOW_MEMORY_GROWTH=1` | Handles PDFs of any size, up to the wasm32 limit |
| `-s NO_DISABLE_EXCEPTION_CATCHING=1` | qpdf relies on C++ exceptions for error handling |
| `-s EXPORTED_RUNTIME_METHODS=[callMain,FS,NODEFS,WORKERFS,ENV]` | Public runtime API |
| `-lnodefs.js -lworkerfs.js` | Filesystem backends for Node and Workers |

> On Windows, keep the LF line endings enforced by `.gitattributes`. CRLF in `build.sh` or the patch breaks the Linux container build.
> `build.sh` compiles qpdf with `-j 4`. Change it if your machine has more or fewer cores.

---

## Project layout

```
.
├── Dockerfile              # emsdk build stage + node test/runtime stage, pinned library commits
├── docker-compose.yml      # `docker compose up` = build + test
├── build.sh                # compiles zlib, libjpeg-turbo, qpdf and links the wasm module
├── shallow-clone.sh        # fetches one commit of a git repo (fast, reproducible)
├── entrypoint.sh           # copies built artifacts into ./dist
├── patches/
│   └── jpeg-turbo.patch    # makes libjpeg-turbo detect 32-bit word size under Emscripten
├── js/
│   ├── pre.js              # sets noInitialRun, exposes FS methods past Closure minification
│   └── post.js
├── types/
│   └── qpdf.d.ts           # TypeScript declarations (copied to dist/)
├── tests/
│   ├── all.js              # mocha tests (page extraction, error exit codes)
│   └── assets/sample.pdf
└── .github/workflows/
    ├── ci.yml              # build + test on every push
    └── deploy.yml          # publish to npm when a GitHub release is created
```

---

## Updating bundled versions

1. Edit the pinned commit SHAs in [Dockerfile](Dockerfile) (`shallow-clone.sh <repo> <path> <sha>`) and the version comments above them.
2. To change Emscripten, bump the `FROM emscripten/emsdk:<version>` tag.
3. If libjpeg-turbo changes its source layout, regenerate [patches/jpeg-turbo.patch](patches/jpeg-turbo.patch).
4. Run `docker compose up` and confirm the tests pass.
5. Bump `version` in [package.json](package.json), update the table in [What this fork offers](#what-this-fork-offers), then create a GitHub release. [deploy.yml](.github/workflows/deploy.yml) publishes to npm (needs the `NPM_TOKEN` repo secret).

---

## Credits

- **[Tommaso Pifferi (@neslinesli93)](https://github.com/neslinesli93)**: original author of [qpdf-wasm](https://github.com/neslinesli93/qpdf-wasm), including the build pipeline, Emscripten glue, tests and CI. This fork exists because of that work. If it helps you, consider starring the [upstream repo](https://github.com/neslinesli93/qpdf-wasm).
- Upstream contributors, for browser usage docs and the qpdf 12.2.0 update.
- **[qpdf](https://github.com/qpdf/qpdf)** by Jay Berkenbilt and contributors: the PDF transformation library this package compiles (Apache-2.0).
- **[zlib](https://github.com/madler/zlib)** by Jean-loup Gailly and Mark Adler.
- **[libjpeg-turbo](https://github.com/libjpeg-turbo/libjpeg-turbo)**.
- **[Emscripten](https://emscripten.org/)**.

Fork maintained by [Souleh Shaikh (@soulehshaikh99)](https://github.com/soulehshaikh99).

---

## License

[ISC](LICENSE). Copyright (c) Tommaso Pifferi. The bundled qpdf, zlib and libjpeg-turbo are distributed under their own licenses (Apache-2.0, zlib and BSD-style/IJG respectively).
