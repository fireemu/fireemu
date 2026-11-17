// Freezes the recorded Batch 3 attempts (writelimits run 2026-11-17) into one supplement per
// question, the way the production parent does, but offline from the saved recordings file. The
// comparison of the two attempts is `compareRecordings`, which reads a typed batchGet answer
// without regard to its order.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { freezeSandboxFixture } from "./fs-data-write-sandbox.mjs";
import {
  bracketGroupCorpora,
  prepareWriteLimitsCorpus,
  recordingSdkVersions,
  selectBracketRecipes,
  supplementRecipeDigests,
} from "./fs-data-write-sandbox-run.mjs";

const pick = (entries, programs) =>
  Object.fromEntries(programs.map((program) => [program.id, entries[program.id]]));

/**
 * @param recordings the saved `writelimits-recordings.json`: two attempts, each with `rest`,
 *   `stream` and `startedAt`.
 * @returns {Promise<Array<{group: string, fixture?: object, refused?: string}>>}
 */
export async function freezeRecordedGroups({ recordings, harnessRevision, sdkVersions }) {
  if (!Array.isArray(recordings) || recordings.length !== 2) {
    throw new Error("two recorded attempts are required");
  }
  const { recordingCorpus } = selectBracketRecipes(await prepareWriteLimitsCorpus(), "writelimits");
  const results = [];
  for (const { group, corpus: part } of bracketGroupCorpora(recordingCorpus, "writelimits")) {
    try {
      const fixture = freezeSandboxFixture({
        corpus: part,
        first: pick(recordings[0].rest, part.restPrograms),
        second: pick(recordings[1].rest, part.restPrograms),
        firstStream: part.streamRecipes.length > 0 ? recordings[0].stream : {},
        secondStream: part.streamRecipes.length > 0 ? recordings[1].stream : {},
        recordedAt: recordings.map((recording) => recording.startedAt),
        harnessRevision,
        sdkVersions,
        // The saved file holds no credential; the freeze inspects for a token it is given.
        credentialToken: "no-credential-in-the-saved-recordings",
        refuseAuthFailures: true,
      });
      results.push({
        group,
        fixture: { ...fixture, mode: "writelimits", recipeDigests: supplementRecipeDigests(part) },
      });
    } catch (error) {
      results.push({ group, refused: String(error.message).slice(0, 400) });
    }
  }
  return results;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [recordingsPath, outDir, harnessRevision] = process.argv.slice(2);
  if (!recordingsPath || !outDir || !/^[0-9a-f]{40}$/.test(harnessRevision ?? "")) {
    throw new Error(
      "usage: fs-write-limits-freeze.mjs <writelimits-recordings.json> <out dir> <40-hex send commit>",
    );
  }
  const recordings = JSON.parse(await readFile(resolve(recordingsPath), "utf8"));
  const results = await freezeRecordedGroups({
    recordings,
    harnessRevision,
    sdkVersions: recordingSdkVersions(),
  });
  await mkdir(resolve(outDir), { recursive: true });
  for (const { group, fixture, refused } of results) {
    if (fixture) {
      await writeFile(
        join(resolve(outDir), `writelimits-${group}.json`),
        `${JSON.stringify(fixture, null, 2)}\n`,
        { flag: "wx" },
      );
    }
    process.stdout.write(`${group}: ${fixture ? "frozen" : `refused: ${refused}`}\n`);
  }
  process.exitCode = results.some(({ refused }) => refused) ? 1 : 0;
}
