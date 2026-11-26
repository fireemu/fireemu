const PLATFORMS = ["android", "ios"];

/** One bounded observation of two independently registered native clients. */
export async function runNativePass({ clients, stopped, prepare, publish, restore, cleanup }) {
  const open = [];
  const verified = [];
  const started = new Set();
  let phase = "preparation";
  const all = (operation) =>
    Promise.allSettled(PLATFORMS.map(async (platform) => operation(platform)));

  try {
    const configs = await prepare();
    phase = "initial publication";
    if (stopped()) throw new Error("native session halted");
    await publish("initial");

    phase = "client start";
    const starts = await all((platform) => {
      started.add(platform);
      return clients[platform].start(configs[platform]);
    });
    if (starts.some((item) => item.status !== "fulfilled"))
      throw new Error("native SDK start failed");
    phase = "realtime readiness";
    const ready = await all((platform) => clients[platform].waiting());
    if (!ready.every((item) => item.status === "fulfilled" && item.value === true) || stopped())
      throw new Error("a native stream is not ready");

    phase = "updated publication";
    await publish("update");
    phase = "SDK evidence";
    const results = await all((platform) => clients[platform].result());
    for (const [index, item] of results.entries()) {
      const platform = PLATFORMS[index];
      if (item.status === "fulfilled" && item.value?.complete === true) verified.push(platform);
      else open.push(`${platform} SDK evidence incomplete`);
    }
  } catch {
    open.push(`${phase} incomplete`);
  }

  const finished = await all((platform) =>
    started.has(platform) ? clients[platform].finish() : { cleanupVerified: true },
  );
  const cleanClients = PLATFORMS.filter((platform, index) => {
    const item = finished[index];
    const clean = item.status === "fulfilled" && item.value?.cleanupVerified === true;
    if (!clean) open.push(`${platform} installation cleanup unsettled`);
    return clean;
  });

  async function verifiedCleanup(operation, name) {
    try {
      if ((await operation()) === true) return true;
    } catch {
      // A non-answer remains open until qualified read-back.
    }
    open.push(name);
    return false;
  }

  const templateRestored = await verifiedCleanup(restore, "template restoration unverified");
  const appsAndKeyRestored = await verifiedCleanup(
    () => cleanup(cleanClients),
    "app or key cleanup unverified",
  );
  const sandboxAtBaseline =
    templateRestored && appsAndKeyRestored && cleanClients.length === PLATFORMS.length;
  return {
    complete: open.length === 0 && verified.length === PLATFORMS.length,
    sandboxAtBaseline,
    open,
    verified,
  };
}
