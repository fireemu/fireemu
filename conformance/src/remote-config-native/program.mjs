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

    // The Apple SDK can take longer to reach its first stream after both apps were installed.
    // Keep Android's listener deadline for the period during which the first stream is live.
    for (const platform of ["ios", "android"]) {
      const client = clients[platform];
      phase = platform + " client start";
      if (stopped()) throw new Error("native session halted");
      started.add(platform);
      await client.start(configs[platform]);
      phase = platform + " realtime readiness";
      if (!(await client.waiting())) throw new Error("a native stream is not ready");
    }
    if (stopped() || !PLATFORMS.every((platform) => clients[platform].streamActive()))
      throw new Error("a native stream ended before publication");

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
