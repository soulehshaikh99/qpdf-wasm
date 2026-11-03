Module["noInitialRun"] = true;
// Program name qpdf prints in messages (argv[0]). Emscripten defaults to
// process.argv[1] in Node (e.g. "mocha") or "./this.program" in browsers.
if (!Module["thisProgram"]) Module["thisProgram"] = "qpdf";
