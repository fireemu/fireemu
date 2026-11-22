// The lanes that share the query sandbox harness. The first two record into `fireemu-oracle-query`
// `(default)` with the same indexes, the pipeline lane into its own named Enterprise database; each has its own corpus, fixture, ledger task id and
// comparison. `run.mjs` picks one with FIREEMU_SANDBOX_LANE (default `fs-query-index`).

export const LANES = {
  // Text observations reuse the existing named-database request guard and raw recorder.
  // Native index creation, readiness and cleanup are separate coordinator-owned phases.
  "fs-ent-text": {
    id: "fs-ent-text",
    taskId: "FS-ENT-TEXT-ORACLE",
    corpus: "../fs-ent-pipeline/text-corpus.mjs",
    fixture: "fs-ent-text-production.json",
    indexes: null,
    database: "entpipe1",
    edition: "ENTERPRISE",
    target:
      "production Firestore REST v1 and gRPC google.firestore.v1 text search, Enterprise Native, database entpipe1",
    localConfig: "fs-ent-text.fireemu.json",
    firebaseJson: "fs-ent-text.firebase.json",
    harness: "src/fs-ent-text",
    sources: ["src/fs-query-index", "src/fs-ent-pipeline", "src/fs-ent-text"],
  },
  "fs-query-index": {
    id: "fs-query-index",
    taskId: "FS-QUERY-INDEX-SANDBOX",
    corpus: "./corpus.mjs",
    divergences: "./divergences.mjs",
    fixture: "fs-query-index-production.json",
    indexes: "fs-query-index.indexes.json",
    localConfig: "fs-query-index.fireemu.json",
    harness: "src/fs-query-index",
    sources: ["src/fs-query-index"],
  },
  "fs-data-write-list": {
    id: "fs-data-write-list",
    taskId: "FS-DATA-WRITE-LIST",
    corpus: "../fs-list/corpus.mjs",
    fixture: "fs-data-write-list-production.json",
    indexes: "fs-query-index.indexes.json",
    localConfig: "fs-query-index.fireemu.json",
    harness: "src/fs-query-index",
    sources: ["src/fs-query-index", "src/fs-list"],
  },
  // The index-merge observation (shapes F1 to F3 of the Lean index-merge model): the same
  // request layer and `(default)` database as FS-QUERY-INDEX, with its own corpus, fixture,
  // ledger task and index file. The index file is fs-query-index.indexes.json plus entries on
  // collection groups only this corpus uses, so the harness digest the FS-QUERY-INDEX and
  // FS-DATA-WRITE-LIST rows were recorded with (it reads their index file) stays theirs.
  "fs-query-index-merge": {
    id: "fs-query-index-merge",
    taskId: "FS-QUERY-INDEX-MERGE",
    corpus: "../fs-query-index-merge/corpus.mjs",
    fixture: "fs-query-index-merge-production.json",
    indexes: "fs-query-index-merge.indexes.json",
    localConfig: "fs-query-index-merge.fireemu.json",
    harness: "src/fs-query-index",
    sources: ["src/fs-query-index", "src/fs-query-index-merge"],
  },
  // The second index-merge observation (2a): the shapes next to the first observation's that
  // have no recorded production answer, on the same request layer and `(default)` database, with
  // its own corpus, fixture, ledger task and index file (the merge lane's file plus overrides on
  // two collection groups only this corpus uses), so the first merge lane's recorded harness
  // digest and rows stay theirs.
  "fs-query-index-merge2": {
    id: "fs-query-index-merge2",
    taskId: "FS-QUERY-INDEX-MERGE-2",
    corpus: "../fs-query-index-merge2/corpus.mjs",
    fixture: "fs-query-index-merge2-production.json",
    indexes: "fs-query-index-merge2.indexes.json",
    localConfig: "fs-query-index-merge2.fireemu.json",
    harness: "src/fs-query-index",
    sources: ["src/fs-query-index", "src/fs-query-index-merge", "src/fs-query-index-merge2"],
  },
  // Observation 2b-1 covers two carriers, a carrier with the automatic contains index, the collection-scope mirror of shape (c), and the read-only leap-second program.
  "fs-query-index-merge3": {
    id: "fs-query-index-merge3",
    taskId: "FS-QUERY-INDEX-MERGE-3",
    corpus: "../fs-query-index-merge3/corpus.mjs",
    fixture: "fs-query-index-merge3-production.json",
    indexes: "fs-query-index-merge3.indexes.json",
    localConfig: "fs-query-index-merge3.fireemu.json",
    harness: "src/fs-query-index",
    sources: ["src/fs-query-index", "src/fs-query-index-merge", "src/fs-query-index-merge3"],
  },
  // Observation 2b-2 covers ASC and DESC carriers together, and a carrier with tags in ordered modes only.
  "fs-query-index-merge4": {
    id: "fs-query-index-merge4",
    taskId: "FS-QUERY-INDEX-MERGE-4",
    corpus: "../fs-query-index-merge4/corpus.mjs",
    fixture: "fs-query-index-merge4-production.json",
    indexes: "fs-query-index-merge4.indexes.json",
    localConfig: "fs-query-index-merge4.fireemu.json",
    harness: "src/fs-query-index",
    sources: ["src/fs-query-index", "src/fs-query-index-merge", "src/fs-query-index-merge4"],
  },
  // Observation 2b-3 covers tags CONTAINS only at group scope, a two-field carrier prefix, and second-60 writes.
  "fs-query-index-merge5": {
    id: "fs-query-index-merge5",
    taskId: "FS-QUERY-INDEX-MERGE-5",
    corpus: "../fs-query-index-merge5/corpus.mjs",
    fixture: "fs-query-index-merge5-production.json",
    indexes: "fs-query-index-merge5.indexes.json",
    localConfig: "fs-query-index-merge5.fireemu.json",
    harness: "src/fs-query-index",
    sources: ["src/fs-query-index", "src/fs-query-index-merge", "src/fs-query-index-merge5"],
  },
  // Observation 2b-4 covers a group composite for a collection query (I1), its reverse, and a configured composite as a merge member.
  "fs-query-index-merge6": {
    id: "fs-query-index-merge6",
    taskId: "FS-QUERY-INDEX-MERGE-6",
    corpus: "../fs-query-index-merge6/corpus.mjs",
    fixture: "fs-query-index-merge6-production.json",
    indexes: "fs-query-index-merge6.indexes.json",
    localConfig: "fs-query-index-merge6.fireemu.json",
    harness: "src/fs-query-index",
    sources: ["src/fs-query-index", "src/fs-query-index-merge", "src/fs-query-index-merge6"],
  },
  // Observation 2b-5: a collection-group carrier with `b` group-scoped, and a descending-prefix carrier.
  "fs-query-index-merge7": {
    id: "fs-query-index-merge7",
    taskId: "FS-QUERY-INDEX-MERGE-7",
    corpus: "../fs-query-index-merge7/corpus.mjs",
    fixture: "fs-query-index-merge7-production.json",
    indexes: "fs-query-index-merge7.indexes.json",
    localConfig: "fs-query-index-merge7.fireemu.json",
    harness: "src/fs-query-index",
    sources: ["src/fs-query-index", "src/fs-query-index-merge", "src/fs-query-index-merge7"],
  },
  // Observation 2b-6: the shared path with restricted modes, and collection-scope readiness of the group-carrier configuration.
  "fs-query-index-merge8": {
    id: "fs-query-index-merge8",
    taskId: "FS-QUERY-INDEX-MERGE-8",
    corpus: "../fs-query-index-merge8/corpus.mjs",
    fixture: "fs-query-index-merge8-production.json",
    indexes: "fs-query-index-merge8.indexes.json",
    localConfig: "fs-query-index-merge8.fireemu.json",
    harness: "src/fs-query-index",
    sources: ["src/fs-query-index", "src/fs-query-index-merge", "src/fs-query-index-merge8"],
  },
  // FS-ENT-ORACLE O-1 (owner ledger 1468 Q1): pipeline semantics in the named Enterprise
  // database `entpipe1`, which this campaign creates and deletes in its own packet steps. No
  // index file: Enterprise runs pipelines without indexes, and the lane never deploys any. The
  // lane has its own copy of the request layer (harness.mjs, session.mjs with named-database
  // support), so the other lanes' recorded harness digest stays bound to theirs.
  "fs-ent-pipeline": {
    id: "fs-ent-pipeline",
    taskId: "FS-ENT-ORACLE",
    corpus: "../fs-ent-pipeline/corpus.mjs",
    fixture: "fs-ent-pipeline-production.json",
    indexes: null,
    database: "entpipe1",
    edition: "ENTERPRISE",
    target:
      "production Firestore REST v1 and gRPC google.firestore.v1, Enterprise edition, Native API, database entpipe1",
    localConfig: "fs-ent-pipeline.fireemu.json",
    firebaseJson: "fs-ent-pipeline.firebase.json",
    harness: "src/fs-ent-pipeline",
    sources: ["src/fs-query-index", "src/fs-ent-pipeline"],
  },
};

// The pipeline lane against the emulator profile, for local runs only: the lane's id, corpus,
// fixture and database, with the emulator profile's fireemu config. A recording always uses
// `fs-ent-pipeline`. Both lanes share the id, so both write `.runs/fs-ent-pipeline/`: copy
// `comparison.json` out after each profile's run.
LANES["fs-ent-pipeline-emulator"] = {
  ...LANES["fs-ent-pipeline"],
  localConfig: "fs-ent-pipeline.emulator.fireemu.json",
};

// The pipeline regex observation (owner decision 2404): the four regex functions over Unicode
// subjects, in the same named Enterprise database and with the same request layer as the O-series
// lane, but with its own corpus, fixture and ledger task, so a recording here touches nothing the
// O-series lane compares. The harness files are shared unchanged, so the O-series harness digest
// stays valid.
LANES["fs-ent-pipeline-regex"] = {
  ...LANES["fs-ent-pipeline"],
  id: "fs-ent-pipeline-regex",
  taskId: "FS-PIPELINE-REGEX",
  corpus: "../fs-ent-pipeline/regex-corpus.mjs",
  fixture: "fs-ent-pipeline-regex-production.json",
};
LANES["fs-ent-pipeline-regex-emulator"] = {
  ...LANES["fs-ent-pipeline-regex"],
  localConfig: "fs-ent-pipeline.emulator.fireemu.json",
};

export function selectLane(name = process.env.FIREEMU_SANDBOX_LANE ?? "fs-query-index") {
  const lane = LANES[name];
  if (!lane) throw new Error(`unknown sandbox lane ${name}`);
  return lane;
}
