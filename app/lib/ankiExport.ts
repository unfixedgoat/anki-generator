import JSZip from "jszip";
import { createHash } from "crypto";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const SQL = require("sql.js") as { Database: new () => SqlDatabase };

interface SqlDatabase {
  run(sql: string, params?: Record<string, unknown>): void;
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
  prepare(sql: string): { getAsObject(params: Record<string, unknown>): Record<string, unknown> };
  export(): Uint8Array;
  close(): void;
}

const TEMPLATE_SQL = `
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE col (
    id              integer primary key,
    crt             integer not null,
    mod             integer not null,
    scm             integer not null,
    ver             integer not null,
    dty             integer not null,
    usn             integer not null,
    ls              integer not null,
    conf            text not null,
    models          text not null,
    decks           text not null,
    dconf           text not null,
    tags            text not null
);
INSERT INTO "col" VALUES(
  1,1388548800,1435645724219,1435645724215,11,0,0,0,
  '{"nextPos": 1, "estTimes": true, "activeDecks": [1], "sortType": "noteFld", "timeLim": 0, "sortBackwards": false, "addToCur": true, "curDeck": 1, "newBury": true, "newSpread": 0, "dueCounts": true, "curModel": "1435645724216", "collapseTime": 1200}',
  '{"1388596687391": {"vers": [], "name": "Basic", "tags": [], "did": 1435588830424, "usn": -1, "req": [[0, "all", [0]]], "flds": [{"name": "Front", "media": [], "sticky": false, "rtl": false, "ord": 0, "font": "Arial", "size": 20}, {"name": "Back", "media": [], "sticky": false, "rtl": false, "ord": 1, "font": "Arial", "size": 20}], "sortf": 0, "tmpls": [{"name": "Card 1", "qfmt": "{{Front}}", "did": null, "bafmt": "", "afmt": "{{FrontSide}}<hr id=answer>{{Back}}", "ord": 0, "bqfmt": ""}], "type": 0, "id": 1388596687391, "css": ".card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }", "mod": 1435645658}}',
  '{"1": {"desc": "", "name": "Default", "extendRev": 50, "usn": 0, "collapsed": false, "newToday": [0, 0], "timeToday": [0, 0], "dyn": 0, "extendNew": 10, "conf": 1, "revToday": [0, 0], "lrnToday": [0, 0], "id": 1, "mod": 1435645724}, "1435588830424": {"desc": "", "name": "Template", "extendRev": 50, "usn": -1, "collapsed": false, "newToday": [0, 0], "timeToday": [0, 0], "dyn": 0, "extendNew": 10, "conf": 1, "revToday": [0, 0], "lrnToday": [0, 0], "id": 1435588830424, "mod": 1435588830}}',
  '{"1": {"name": "Default", "replayq": true, "lapse": {"leechFails": 8, "minInt": 1, "delays": [10], "leechAction": 0, "mult": 0}, "rev": {"perDay": 100, "fuzz": 0.05, "ivlFct": 1, "maxIvl": 36500, "ease4": 1.3, "bury": true, "minSpace": 1}, "timer": 0, "maxTaken": 60, "usn": 0, "new": {"perDay": 20, "delays": [1, 10], "separate": true, "ints": [1, 4, 7], "initialFactor": 2500, "bury": true, "order": 1}, "mod": 0, "id": 1, "autoplay": true}}',
  '{}'
);
CREATE TABLE notes (
    id integer primary key, guid text not null, mid integer not null,
    mod integer not null, usn integer not null, tags text not null,
    flds text not null, sfld integer not null, csum integer not null,
    flags integer not null, data text not null
);
CREATE TABLE cards (
    id integer primary key, nid integer not null, did integer not null,
    ord integer not null, mod integer not null, usn integer not null,
    type integer not null, queue integer not null, due integer not null,
    ivl integer not null, factor integer not null, reps integer not null,
    lapses integer not null, left integer not null, odue integer not null,
    odid integer not null, flags integer not null, data text not null
);
CREATE TABLE revlog (
    id integer primary key, cid integer not null, usn integer not null,
    ease integer not null, ivl integer not null, lastIvl integer not null,
    factor integer not null, time integer not null, type integer not null
);
CREATE TABLE graves (
    usn integer not null, oid integer not null, type integer not null
);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
COMMIT;`;

const SEPARATOR = "\x1F";

function sha1Int(str: string): number {
  return parseInt(createHash("sha1").update(str).digest("hex").slice(0, 8), 16);
}

export interface AnkiCard {
  front: string;
  back: string;
}

export async function buildApkg(deckName: string, cards: AnkiCard[]): Promise<Buffer> {
  const db = new SQL.Database();
  db.run(TEMPLATE_SQL);

  const now = Date.now();
  const deckId = now;
  const modelId = now + 1;

  // Patch deck name into the col row
  const rawDecks = db.exec("select decks from col")[0].values[0][0] as string;
  const decks = JSON.parse(rawDecks) as Record<string, Record<string, unknown>>;
  const oldDeckKey = Object.keys(decks).at(-1)!;
  const deckEntry = { ...decks[oldDeckKey], name: deckName, id: deckId };
  delete decks[oldDeckKey];
  decks[String(deckId)] = deckEntry;
  db.run("update col set decks=:d where id=1", { ":d": JSON.stringify(decks) });

  // Patch model name into the col row
  const rawModels = db.exec("select models from col")[0].values[0][0] as string;
  const models = JSON.parse(rawModels) as Record<string, Record<string, unknown>>;
  const oldModelKey = Object.keys(models).at(-1)!;
  const modelEntry = { ...models[oldModelKey], name: deckName, did: deckId, id: modelId };
  delete models[oldModelKey];
  models[String(modelId)] = modelEntry;
  db.run("update col set models=:m where id=1", { ":m": JSON.stringify(models) });

  // Insert notes + cards
  cards.forEach((card, i) => {
    const fields = card.front + SEPARATOR + card.back;
    const noteId = now + 1000 + i;
    const cardId = now + 2000 + i;
    const guid = createHash("sha1")
      .update(String(deckId) + card.front + card.back)
      .digest("hex")
      .slice(0, 10);

    db.run(
      "insert into notes values(:id,:guid,:mid,:mod,:usn,:tags,:flds,:sfld,:csum,:flags,:data)",
      {
        ":id": noteId,
        ":guid": guid,
        ":mid": modelId,
        ":mod": Math.floor(now / 1000),
        ":usn": -1,
        ":tags": "",
        ":flds": fields,
        ":sfld": card.front,
        ":csum": sha1Int(fields),
        ":flags": 0,
        ":data": "",
      }
    );

    db.run(
      "insert into cards values(:id,:nid,:did,:ord,:mod,:usn,:type,:queue,:due,:ivl,:factor,:reps,:lapses,:left,:odue,:odid,:flags,:data)",
      {
        ":id": cardId,
        ":nid": noteId,
        ":did": deckId,
        ":ord": 0,
        ":mod": Math.floor(now / 1000),
        ":usn": -1,
        ":type": 0,
        ":queue": 0,
        ":due": 179,
        ":ivl": 0,
        ":factor": 0,
        ":reps": 0,
        ":lapses": 0,
        ":left": 0,
        ":odue": 0,
        ":odid": 0,
        ":flags": 0,
        ":data": "",
      }
    );
  });

  const dbBinary = db.export();
  db.close();

  const zip = new JSZip();
  zip.file("collection.anki2", Buffer.from(dbBinary));
  zip.file("media", "{}");

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }) as Promise<Buffer>;
}
