// Content check of the Batch 3 rehearsal against fireemu strict: what strict answers TODAY for
// every recipe, by content (status, message, stored value), not by counts of ok. After the
// production recording the same table is compared with the recorded rows instead; a row that
// differs there is a finding, not a failure of this check.
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PREFIX = "writes/limits/";

function steps(rest, id) {
  return rest?.[PREFIX + id]?.steps;
}

function foundFields(step) {
  const row = Array.isArray(step?.body) ? step.body[0] : undefined;
  return row?.found?.fields;
}

/** Violations of the strict-today expectations; empty means the rehearsal says what we expect. */
export function checkWriteLimitsLocal(rest, stream, manifest) {
  const problems = [];
  const expect = (condition, text) => {
    if (!condition) problems.push(text);
  };
  for (const id of manifest.restIds) {
    expect(Object.keys(rest?.[id]?.steps ?? {}).length === 2, `${id}: two answered steps`);
  }
  const answered = (id) => Object.keys(rest?.[id]?.steps ?? {}).length === 2;
  for (const id of manifest.restIds.filter(
    (i) => answered(i) && /\/(commit-budget|composite-entry|collection-group-entry)\//.test(i),
  )) {
    const { write, readback } = rest[id].steps;
    expect(write.status === 200, `${id}: strict accepts the write today (status ${write.status})`);
    const rows = readback.body ?? [];
    expect(
      rows.length > 0 && rows.every((row) => row.found),
      `${id}: every written document reads back`,
    );
  }
  for (const id of manifest.restIds.filter(
    (i) => answered(i) && i.includes("/bytes-line-breaks/"),
  )) {
    const [method, caseName] = id.slice((PREFIX + "bytes-line-breaks/").length).split("/");
    const { write, readback } = rest[id].steps;
    const refusedToday = method === "commit" && caseName !== "control";
    if (refusedToday) {
      expect(write.status === 400, `${id}: commit already refuses (status ${write.status})`);
      expect(
        (write.message ?? "").startsWith(
          "Invalid value at 'writes[0].update.fields[0].value.bytes_value' (TYPE_BYTES)",
        ),
        `${id}: commit refusal text`,
      );
      expect(readback.body?.[0]?.missing !== undefined, `${id}: the refused write left nothing`);
    } else {
      expect(
        write.status === 200,
        `${id}: strict accepts the bytes today (status ${write.status})`,
      );
    }
  }
  const stored = (method, caseName) =>
    foundFields(steps(rest, `bytes-line-breaks/${method}/${caseName}`)?.readback)?.b?.bytesValue;
  for (const method of ["create", "patch", "batch-write"]) {
    expect(stored(method, "control") === "QUJD", `${method}/control stores QUJD`);
    expect(
      stored(method, "lf") === "QUJDQUJD",
      `${method}/lf: strict drops the LF and stores QUJDQUJD`,
    );
    expect(stored(method, "crlf") === "QUJDQUJD", `${method}/crlf: strict drops CRLF`);
    expect(
      stored(method, "mime-76")?.length === 88,
      `${method}/mime-76: strict joins the 76-column lines`,
    );
  }
  for (const id of manifest.streamIds) {
    const result = stream?.[id];
    const events = result?.events ?? [];
    const kinds = events.map((event) => event.type);
    expect(result?.sentFrames === 2, `${id}: two frames sent`);
    expect(result?.status?.code === 0, `${id}: strict's Write stream ends OK today`);
    expect(
      events[0]?.type === "seed" && events[0].status.code === 0,
      `${id}: the seed was accepted`,
    );
    expect(
      kinds.filter((kind) => kind === "data").length === 2,
      `${id}: handshake and delete responses`,
    );
    const deleteResponse = events.filter((event) => event.type === "data")[1]?.value;
    expect(deleteResponse?.writeResults?.length === 1, `${id}: one write result for the delete`);
    expect(deleteResponse?.commitTime === "timestamp", `${id}: the commit time is masked`);
    const readback = events.find((event) => event.type === "readback");
    expect(
      readback?.found === false && readback.arrayCount === 0,
      `${id}: strict deleted the document`,
    );
    expect(
      JSON.stringify(result).includes("fireemu-oracle-sbx") === false,
      `${id}: project normalized`,
    );
  }
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = resolve(process.argv[2] ?? "");
  const manifest = JSON.parse(
    await readFile(new URL("./firestore-probe/write-limits-set.json", import.meta.url), "utf8"),
  );
  const rest = JSON.parse(await readFile(join(dir, "rest-0.json"), "utf8"));
  const stream = JSON.parse(await readFile(join(dir, "stream-0.json"), "utf8"));
  const problems = checkWriteLimitsLocal(rest, stream, manifest);
  process.stdout.write(
    `${JSON.stringify({ dir, checked: manifest.restIds.length + manifest.streamIds.length, problems })}\n`,
  );
  process.exitCode = problems.length === 0 ? 0 : 1;
}
