// The browser side of the RC-CLOSURE-B recorder: one headless Chromium, one context per synthetic
// installation, each with the page of page.mjs. The page is served by the context's request hook
// (nothing listens), the SDK bundles are the gstatic URLs of the pinned firebase package answered
// from node_modules, and every other request goes through the hook's allow list: the Remote
// Config, realtime and Installations hosts in production (continued unchanged), or a fake that
// answers them in tests. Anything else is aborted and stops the run. A cap counts the allowed
// requests of all contexts together.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const FIREBASE = dirname(require.resolve("firebase/package.json"));
export const SDK_VERSION = JSON.parse(readFileSync(join(FIREBASE, "package.json"), "utf8")).version;
export const GSTATIC = `https://www.gstatic.com/firebasejs/${SDK_VERSION}/`;
/** The bundles the page may load, by file name, with their pinned sha256 (firebase 12.18.0). */
export const BUNDLE_SHA256 = {
  "firebase-app.js": "2fddac0600772c36b848b6b9651e52d00eb8f0a3656b5c24246cd8380b0e452a",
  "firebase-remote-config.js": "9e5ba87c092bac375bfbd8c61f22a0b5c1d30bcb2784ed7fc6ffa555b8d23e4c",
  "firebase-installations.js": "2e7820fda26f5b2438d15245b5da40b3a29ff9c96b898601e61228d3cfc1272c",
};
export const BUNDLES = Object.keys(BUNDLE_SHA256);
export const PINNED_SDK = "12.18.0";

/** The bundle files, refused unless they are the pinned version and bytes (ruling 16 item 8). */
export function pinnedBundles(dir = FIREBASE, version = SDK_VERSION) {
  if (version !== PINNED_SDK)
    throw new Error(`firebase ${version} is not the pinned ${PINNED_SDK}`);
  return Object.fromEntries(
    BUNDLES.map((file) => {
      const bytes = readFileSync(join(dir, file));
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (digest !== BUNDLE_SHA256[file]) throw new Error(`${file} is not the pinned bundle`);
      return [file, bytes];
    }),
  );
}
/** The hosts the page may reach beyond its own origin and the bundles. */
export const HOSTS = [
  "firebaseremoteconfig.googleapis.com",
  "firebaseremoteconfigrealtime.googleapis.com",
  "firebaseinstallations.googleapis.com",
];

const PAGE = `<!doctype html><meta charset="utf-8"><title>rc</title>
<script type="module" src="/lib/page.mjs"></script>`;

/** The origin the page is served from. */
export const originOf = (port) => `http://localhost:${port}`;

/**
 * What the hook does with one request URL: `page` and `bundle` answered from files, `remote` for
 * the three hosts over https without credentials in the URL (then judged by `requestPolicy`), and
 * `refused` for anything else.
 */
export function classify(href, origin, rcOrigin = null) {
  const url = new URL(href);
  if (url.origin === origin)
    return url.pathname === "/" || url.pathname === "/lib/page.mjs" ? "page" : "refused";
  // A local run's Remote Config base (fireemu on loopback), judged by `requestPolicy` as the two
  // Remote Config hosts are.
  if (rcOrigin && url.origin === rcOrigin && !url.username && !url.password) return "remote";
  if (href.startsWith(GSTATIC) && BUNDLES.includes(href.slice(GSTATIC.length))) return "bundle";
  if (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.port &&
    HOSTS.includes(url.host)
  )
    return "remote";
  return "refused";
}

const FID = /^[A-Za-z0-9_-]{22}$/;
const json = (text) => {
  try {
    const value = JSON.parse(text ?? "");
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
};

/**
 * The closed set of SDK requests of one context (ruling 16 item 4, ruling 18 item 4), by method,
 * host, path, query, key and body, bound to the context's project, API key, app id and the
 * installation ids whose create this context's hook dispatched (`own.fids`):
 *   POST installations   /v1/projects/<project>/installations          no query, key header,
 *                                                                       body fid of 22 characters
 *   POST installations   .../installations/<fid>/authTokens:generate    no query, key header
 *   DELETE installations .../installations/<fid>                        no query, key header
 *   POST remote config   .../namespaces/firebase:fetch?key=<key>         no key header or the key;
 *                                                                       body app_instance_id <fid>,
 *                                                                       app_id <app id>
 *   POST realtime        .../namespaces/firebase:streamFetchInvalidations?key=<key>
 *                                                                       key header; body
 *                                                                       appInstanceId <fid>,
 *                                                                       appId <app id>, project
 * Returns { verdict, fid }: verdict "create" (its fid is added to `own.fids` only once the hook
 * dispatches it), "allowed", "delete" (an installation's deletion, which the cleanup reserve also
 * admits) or the refusal's reason.
 */
export function requestPolicy({ method, href, headers, postData }, own) {
  const { project, key, appId, fids } = own;
  const url = new URL(href);
  // A local run serves both Remote Config routes from one base; each is judged as its host's.
  const host =
    own.rcOrigin && url.origin === own.rcOrigin
      ? url.pathname.endsWith(":streamFetchInvalidations")
        ? "firebaseremoteconfigrealtime.googleapis.com"
        : "firebaseremoteconfig.googleapis.com"
      : url.host;
  const base = `/v1/projects/${project}`;
  const keyHeader = headers["x-goog-api-key"];
  if (host === "firebaseinstallations.googleapis.com") {
    if (url.search !== "") return { verdict: "query" };
    if (keyHeader !== key) return { verdict: "key" };
    if (method === "POST" && url.pathname === `${base}/installations`) {
      const fid = json(postData)?.fid;
      if (typeof fid !== "string" || !FID.test(fid)) return { verdict: "installation id" };
      return { verdict: "create", fid };
    }
    const named = /^\/v1\/projects\/([^/]+)\/installations\/([^/]+?)(\/authTokens:generate)?$/.exec(
      url.pathname,
    );
    if (!named || named[1] !== project || !fids.has(named[2])) return { verdict: "path" };
    if (method === "POST" && named[3]) return { verdict: "allowed" };
    if (method === "DELETE" && !named[3]) return { verdict: "delete" };
    return { verdict: "method" };
  }
  const forms = {
    "firebaseremoteconfig.googleapis.com": {
      path: `${base}/namespaces/firebase:fetch`,
      keyHeader: (value) => value === undefined || value === key,
      body: (b) => fids.has(b.app_instance_id) && b.app_id === appId,
    },
    "firebaseremoteconfigrealtime.googleapis.com": {
      path: `${base}/namespaces/firebase:streamFetchInvalidations`,
      keyHeader: (value) => value === key,
      body: (b) => fids.has(b.appInstanceId) && b.appId === appId && b.project === project,
    },
  };
  const form = forms[host];
  if (!form) return { verdict: "host" };
  if (method !== "POST") return { verdict: "method" };
  if (url.pathname !== form.path) return { verdict: "path" };
  if (url.search !== `?key=${encodeURIComponent(key)}` && url.search !== `?key=${key}`)
    return { verdict: "query" };
  if (!form.keyHeader(keyHeader)) return { verdict: "key" };
  const body = json(postData);
  if (!body || !form.body(body)) return { verdict: "installation id" };
  return { verdict: "allowed" };
}

/**
 * The answers that stop the hook itself (ruling 19 item 1): seen at the response boundary, so an
 * SDK retry inside the same page call is refused before it leaves; the cleanup reserve stays.
 */
export const STOP_STATUSES = new Set([403, 429]);

/** The installation deletions admitted beyond the cap and after a stop, for the cleanup. */
export const CLEANUP_RESERVE = 4;
/** The wall-clock bound of one page call. */
export const CALL_TIMEOUT_MS = 60_000;

/**
 * Opens the browser. `fake(request)` (tests) answers the remote hosts instead of the network: it
 * returns `{ status, headers, body }`. `cap` bounds the forward requests of all contexts; the
 * installations' deletions have their own reserve. Playwright's protocol diagnostics must be off
 * (the init script carries the key).
 */
export async function openBrowser({
  port,
  cap,
  fake = null,
  callTimeoutMs = CALL_TIMEOUT_MS,
  env = process.env,
  rcBase = null,
}) {
  // `rcBase` (local runs only): the SDK's Remote Config base, passed through to fireemu; the
  // Installations host is still answered by `fake` (coordinator ruling 10).
  const rcOrigin = rcBase ? new URL(rcBase).origin : null;
  if (/pw:|\*/.test(env.DEBUG ?? "") || env.PWDEBUG || env.DEBUG_FILE)
    throw new Error("Playwright diagnostics (DEBUG, PWDEBUG, DEBUG_FILE) must be off");
  const bundles = pinnedBundles();
  // A local run's page (served by the hook, so of no address space of its own) reaches fireemu on
  // loopback; Chromium's local-network check would refuse that, so a local run turns it off.
  const browser = await chromium.launch({
    headless: true,
    ...(rcOrigin ? { args: ["--disable-features=LocalNetworkAccessChecks"] } : {}),
  });
  const origin = originOf(port);
  let allowed = 0;
  let reserved = 0;
  let stopped = null;
  const refusals = [];
  const contexts = [];
  const handles = [];
  const stop = (reason) => {
    if (!stopped) stopped = reason;
  };
  return {
    stopped: () => stopped,
    stop,
    refusals,
    allowedRequests: () => allowed,
    cleanupRequests: () => reserved,
    /** A new context and page with `config`; resolves when the page's SDK is loaded. */
    async client(config, name = `context-${handles.length + 1}`) {
      const context = await browser.newContext({ serviceWorkers: "block" });
      contexts.push(context);
      const own = {
        project: config.projectId,
        key: config.apiKey,
        appId: config.appId,
        fids: new Set(),
        rcOrigin,
      };
      await context.route("**/*", async (route) => {
        const request = route.request();
        const kind = classify(request.url(), origin, rcOrigin);
        if (kind === "page") {
          const path = new URL(request.url()).pathname;
          return route.fulfill(
            path === "/"
              ? { status: 200, contentType: "text/html", body: PAGE }
              : {
                  status: 200,
                  contentType: "text/javascript",
                  body: readFileSync(join(HERE, "page.mjs")),
                },
          );
        }
        if (kind === "bundle")
          return route.fulfill({
            status: 200,
            contentType: "text/javascript",
            headers: { "access-control-allow-origin": "*" },
            body: bundles[request.url().slice(GSTATIC.length)],
          });
        const host = new URL(request.url()).host;
        const { verdict, fid } =
          kind === "remote"
            ? requestPolicy(
                {
                  method: request.method(),
                  href: request.url(),
                  headers: request.headers(),
                  postData: request.postData(),
                },
                own,
              )
            : { verdict: "not allowed" };
        const forwardable = verdict === "allowed" || verdict === "create";
        const forward = forwardable && !stopped && allowed < cap;
        const cleanup = verdict === "delete" && reserved < CLEANUP_RESERVE;
        if (forward || cleanup) {
          if (forward) allowed += 1;
          else reserved += 1;
          // A create's id becomes this context's only once its request is dispatched.
          if (verdict === "create") own.fids.add(fid);
          if (!fake || (rcOrigin && new URL(request.url()).origin === rcOrigin))
            return route.continue();
          const answer = await fake(request);
          return route.fulfill({
            status: answer.status,
            headers: { "access-control-allow-origin": origin, ...answer.headers },
            body: answer.body,
          });
        }
        const reason = forwardable ? (stopped ? "after stop" : "request cap") : verdict;
        refusals.push({ host, reason });
        if (reason !== "after stop")
          stop(
            reason === "request cap"
              ? `request cap ${cap}`
              : `refused request to ${host} (${reason})`,
          );
        return route.abort();
      });
      // Every answer's status is read here, when its headers arrive and before the SDK can act on
      // it: production's (passed by `route.continue()`) and the test fakes' alike, one mechanism.
      context.on("response", (response) => {
        const url = new URL(response.url());
        const host = url.host;
        if (
          (HOSTS.includes(host) || url.origin === rcOrigin) &&
          STOP_STATUSES.has(response.status())
        )
          stop(`${host} answered ${response.status()}`);
      });
      const page = await context.newPage();
      await page.addInitScript(
        (input) => {
          window.__RC_INPUT = input;
        },
        { config, sdk: GSTATIC, ...(rcBase ? { rcBase } : {}) },
      );
      await page.goto(`${origin}/`);
      await page.waitForFunction(() => window.rcReady === true, null, { timeout: 30_000 });
      /** One page call, bounded in time: a call that does not settle throws. */
      const bounded = (promise, what) =>
        Promise.race([
          promise,
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error(`page call ${what} timed out`)),
              callTimeoutMs,
            ).unref?.(),
          ),
        ]);
      const handle = {
        call: (name, ...args) =>
          bounded(
            page.evaluate(([n, a]) => window.rc[n](...a), [name, args]),
            name,
          ),
        /** Every exchange the page recorded so far (a stream's frames grow while it is open). */
        wire: () =>
          bounded(
            page.evaluate(() => window.rc.wire(0)),
            "wire",
          ),
        updates: () =>
          bounded(
            page.evaluate(() => window.rc.updates()),
            "updates",
          ),
        /** The dispatched creates of this context and how many a 2xx DELETE on the wire proves. */
        installations: () =>
          bounded(
            page.evaluate(([f, p]) => window.rc.deletions(f, p), [[...own.fids], own.project]),
            "installations",
          ),
        close: () => context.close(),
      };
      handles.push({ name, page, own, bounded, handle });
      return handle;
    },
    /**
     * Every context's installation settlement (ruling 18 item 5): { name, dispatched, proved };
     * a page that cannot answer proves nothing.
     */
    async installations() {
      const out = [];
      for (const h of handles) {
        let proof = { dispatched: h.own.fids.size, proved: 0 };
        try {
          proof = await h.handle.installations();
        } catch {
          // proved stays 0
        }
        out.push({ name: h.name, dispatched: h.own.fids.size, proved: proof.proved });
      }
      return out;
    },
    /** A text with every secret any page knows masked; the text unchanged when none is in it. */
    async mask(text) {
      let out = text;
      for (const h of handles)
        out = await h.bounded(
          h.page.evaluate((t) => window.rc.mask(t), out),
          "mask",
        );
      return out;
    },
    async close() {
      for (const context of contexts) await context.close().catch(() => {});
      await browser.close();
    },
  };
}
