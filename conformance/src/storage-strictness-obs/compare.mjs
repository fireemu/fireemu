import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bodyErrorFields, judgeJournal, readJournal } from "./judge.mjs";

const FIELDS = ["status", "shape", "headerNames", "headers", "json", "xml", "location", "v4"];

// Brings a judged journal row and a published masked fixture row into one representation.
// Fixture rows keep the recorded error body text instead of judged json/xml fields, and a
// request-relative location instead of the masked header value.
// A run's own bucket name appears in some error messages; fixtures carry it as fireemu-obs-RUN.
const RUN_BUCKET = /fireemu-obs-(?:ss-[0-9a-f]{8}|RUN)/g;
const maskRun = (value) =>
  typeof value === "string"
    ? value.replace(RUN_BUCKET, "fireemu-obs-RUN")
    : Array.isArray(value)
      ? value.map(maskRun)
      : value !== null && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).map(([key, member]) => [key, maskRun(member)]))
        : value;

export function comparable(row) {
  const errors = maskRun(
    Object.hasOwn(row, "json") || Object.hasOwn(row, "xml")
      ? { json: row.json ?? null, xml: row.xml ?? null }
      : bodyErrorFields(row.body ?? ""),
  );
  const compared = Object.fromEntries(
    FIELDS.map((field) => [field, (Object.hasOwn(errors, field) ? errors : row)[field] ?? null]),
  );
  // The length of a body follows its content; only an empty body (a 204) is a framing fact.
  if (compared.v4 && compared.v4.contentLength !== null && compared.v4.contentLength !== "0")
    compared.v4 = { ...compared.v4, contentLength: "<body>" };
  return compared;
}

export function compare(recorded, local) {
  // A fixture-only row (cleanup the local run cannot perform) is kept for its framing, not compared.
  const production = recorded.filter((row) => !row.fixtureOnly);
  const cases = [...new Set([...production, ...local].map((row) => row.case))];
  return cases.map((id) => {
    const p = production.filter((row) => row.case === id);
    const l = local.filter((row) => row.case === id);
    if (p.length !== 1 || l.length !== 1 || p[0].known !== true || l[0].known !== true)
      return { case: id, verdict: "NEEDS-REVIEW" };
    const [a, b] = [comparable(p[0]), comparable(l[0])];
    const fields = FIELDS.filter((field) => JSON.stringify(a[field]) !== JSON.stringify(b[field]));
    return { case: id, verdict: fields.length ? `DIFFERS(${fields.join(",")})` : "MATCH" };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const recording = JSON.parse(readFileSync(process.argv[2], "utf8"));
    const production = recording.rows ?? recording;
    const rows = compare(production, judgeJournal(readJournal(process.argv[3])));
    for (const row of rows) console.log(`${row.case} ${row.verdict}`);
    process.exitCode = rows.length && rows.every((row) => row.verdict === "MATCH") ? 0 : 1;
  } catch {
    console.error("Could not compare production rows and local journal");
    process.exitCode = 1;
  }
}
