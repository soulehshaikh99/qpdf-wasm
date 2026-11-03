declare module "@soulehshaikh99/qpdf-wasm" {
  interface QpdfModuleOptions {
    locateFile?: (path: string, prefix: string) => string;
    noInitialRun?: boolean;
    preRun?: Array<(module: QpdfInstance) => void>;
    /** Name qpdf uses for itself in messages (argv[0]). Default "qpdf". */
    thisProgram?: string;
  }

  interface QpdfModule {
    (options?: QpdfModuleOptions): Promise<QpdfInstance>;
  }

  interface QpdfInstance {
    callMain: (args: string[]) => number;
    FS: EmscriptenFS;
    NODEFS: any;
    WORKERFS: any;
    ENV: Record<string, string>;
  }

  interface EmscriptenFS {
    mkdir: (path: string) => void;
    mount: (
      type: QpdfInstance["NODEFS"] | QpdfInstance["WORKERFS"],
      opts: { root: string } | { blobs: { name: string; data: Blob }[] },
      mountPoint: string
    ) => void;
    unmount: (mountPoint: string) => void;
    chdir: (path: string) => void;
    writeFile: (path: string, data: string | ArrayBufferView) => void;
    readFile: (path: string) => Uint8Array;
    unlink: (path: string) => void;
  }

  const module: QpdfModule;
  export default module;
  export type { QpdfInstance, QpdfModuleOptions };
}
