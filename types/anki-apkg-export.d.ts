declare module "anki-apkg-export" {
  interface AddCardOptions {
    tags?: string[];
  }

  interface Exporter {
    addCard(front: string, back: string, options?: AddCardOptions): void;
    addMedia(filename: string, data: Buffer): void;
    save(): Promise<Buffer>;
  }

  function AnkiExport(deckName: string, template?: unknown): Exporter;
  export default AnkiExport;
  export { Exporter };
}
