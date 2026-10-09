declare module 'pngjs' {
  // pngjs não tipa (sem @types). Superfície usada no appConfig.test.ts:
  export class PNG {
    data: Buffer; // RGBA expansível (4 bytes/pixel) após read/sync.read
    width: number;
    height: number;
    static sync: {
      read(buffer: Buffer | Uint8Array): PNG;
    };
  }
}
