// Compares the local (fireemu) answers of the Batch 3 recipes with the recorded production
// supplements (`fs-data-write-production-supplements/writelimits/`). A difference is a row where
// the local answer is not production's, by status, code, message or body.
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compareSandboxArtifact } from "./fs-data-write-sandbox.mjs";
import {
  bracketGroupCorpora,
  prepareWriteLimitsCorpus,
  selectBracketRecipes,
  supplementRecipeDigests,
} from "./fs-write-limits-run.mjs";

export const SUPPLEMENTS = fileURLToPath(
  new URL("../fs-data-write-production-supplements/writelimits/", import.meta.url),
);

const subset = (entries, ids) => Object.fromEntries(ids.map((id) => [id, entries?.[id]]));

/**
 * @param rest local `rest-N.json` of a rehearsal; @param stream local `stream-N.json`
 * @param supplements the parsed supplement files keyed by group
 * @returns {{differences: string[], compared: number, problems: string[]}}
 */
export function compareWriteLimits({ rest, stream, supplements, groups }) {
  const differences = [];
  const problems = [];
  let compared = 0;
  for (const { group, corpus: part } of groups) {
    const supplement = supplements[group];
    if (!supplement) {
      problems.push(`no recorded supplement for the ${group} group`);
      continue;
    }
    const digests = supplementRecipeDigests(part);
    if (JSON.stringify(digests) !== JSON.stringify(supplement.recipeDigests)) {
      problems.push(`the ${group} supplement is not bound to the current recipes`);
      continue;
    }
    const ids = part.restPrograms.map((program) => program.id);
    const streamIds = part.streamRecipes.map((recipe) => recipe.id);
    differences.push(
      ...compareSandboxArtifact(
        { programs: supplement.programs, streams: supplement.streams },
        subset(rest, ids),
        subset(stream, streamIds),
        part,
      ),
    );
    compared += ids.length + streamIds.length;
  }
  return { differences: differences.toSorted(), compared, problems };
}

export async function readSupplements(dir = SUPPLEMENTS) {
  const supplements = {};
  for (const name of (await readdir(dir)).filter((n) => n.endsWith(".json")).toSorted()) {
    const group = name.replace(/^writelimits-/, "").replace(/\.json$/, "");
    supplements[group] = JSON.parse(await readFile(join(dir, name), "utf8"));
  }
  return supplements;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = resolve(process.argv[2] ?? "");
  const attempt = process.argv[3] ?? "0";
  const { recordingCorpus } = selectBracketRecipes(await prepareWriteLimitsCorpus(), "writelimits");
  const result = compareWriteLimits({
    rest: JSON.parse(await readFile(join(dir, `rest-${attempt}.json`), "utf8")),
    stream: JSON.parse(await readFile(join(dir, `stream-${attempt}.json`), "utf8")),
    supplements: await readSupplements(),
    groups: bracketGroupCorpora(recordingCorpus, "writelimits"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 1)}\n`);
  process.exitCode = result.differences.length === 0 && result.problems.length === 0 ? 0 : 1;
}
