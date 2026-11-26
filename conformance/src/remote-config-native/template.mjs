import { baselineEmpty } from "../remote-config-web/program.mjs";

function versionOf(document) {
  const version = document?.version?.versionNumber;
  if (typeof version !== "string" || !/^[1-9]\d{0,18}$/.test(version))
    throw new Error("native template version unreadable");
  return version;
}

function confirm(response) {
  if (response.status !== 200 || typeof response.etag !== "string" || !response.etag)
    throw new Error("native template answer has no verified ETag");
  return { etag: response.etag, version: versionOf(response.json), document: response.json };
}

function buildTemplate(runId, stage) {
  return {
    conditions: [
      { name: "native_gold", expression: "app.customSignal['tier'].exactlyMatches(['gold'])" },
    ],
    parameters: {
      native_value: { defaultValue: { value: stage === "initial" ? "before" : "after" } },
      native_tier: {
        defaultValue: { value: "base" },
        conditionalValues: { native_gold: { value: "gold" } },
      },
    },
    version: { description: `fireemu-stage-c-${runId}-${stage}` },
  };
}

/** Conditional publications over an owned sandbox template and verified rollback. */
export function nativeTemplateControl({ transport, url, runId, stopped }) {
  if (!/^[a-z0-9]{8,24}$/.test(runId)) throw new Error("invalid native template run ID");
  let base;
  let current;
  let phase = null;
  let uncertain = false;

  async function baseline() {
    if (base) throw new Error("native baseline already read");
    const previous = confirm(await transport.send("native-baseline", url));
    if (!baselineEmpty(previous.document))
      throw new Error("native baseline is not the published empty template");
    base = current = previous;
    return base.version;
  }

  async function publish(stage) {
    if (
      !current ||
      uncertain ||
      stage !== (phase === null ? "initial" : "update") ||
      phase === "update"
    )
      throw new Error("native publication has no verified predecessor");
    const body = buildTemplate(runId, stage);
    let dispatched = false;
    try {
      const next = confirm(
        await transport.send(`native-${stage}`, url, {
          method: "PUT",
          body,
          ifMatch: current.etag,
          beforeDispatch() {
            if (stopped()) throw new Error("native SDK pass halted");
            dispatched = true;
          },
        }),
      );
      if (
        BigInt(next.version) !== BigInt(current.version) + 1n ||
        next.document.version.description !== body.version.description ||
        next.document.parameters?.native_value?.defaultValue?.value !==
          body.parameters.native_value.defaultValue.value
      )
        throw new Error("native publication was not recognized");
      current = next;
      phase = stage;
      return next.version;
    } catch (error) {
      if (dispatched) uncertain = true;
      throw error;
    }
  }

  async function restore() {
    if (!base || uncertain) return false;
    const before = confirm(await transport.send("native-owned-cleanup", url));
    if (before.etag !== current.etag || before.version !== current.version) return false;
    if (phase === null) return baselineEmpty(before.document);
    uncertain = true;
    const rolledBack = confirm(
      await transport.send("native-rollback", `${url}:rollback`, {
        method: "POST",
        ifMatch: before.etag,
        body: { versionNumber: base.version },
      }),
    );
    const after = confirm(await transport.send("native-rollback-read", url));
    return (
      after.etag === rolledBack.etag &&
      after.version === rolledBack.version &&
      BigInt(after.version) === BigInt(before.version) + 1n &&
      baselineEmpty(after.document)
    );
  }

  return { baseline, publish, restore };
}
