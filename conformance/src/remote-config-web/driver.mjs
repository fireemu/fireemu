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
export function classify(href, origin) {
  const url = new URL(href);
  if (url.origin === origin)
    return url.pathname === "/" || url.pathname === "/lib/page.mjs" ? "page" : "refused";
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

/**
 * The closed set of SDK requests of one context (ruling 16 item 4), by method, host, path and
 * query, bound to the context's project, its API key and the installation ids it created:
 *   POST installations  /v1/projects/<project>/installations                     (no query)
 *   POST installations  /v1/projects/<project>/installations/<fid>/authTokens:generate
 *   DELETE installations /v1/projects/<project>/installations/<fid>               (`delete`)
 *   POST remote config  /v1/projects/<project>/namespaces/firebase:fetch?key=<key>
 *   POST realtime       /v1/projects/<project>/namespaces/firebase:streamFetchInvalidations?key=<key>
 * An Installations request must carry the key in x-goog-api-key. Returns "allowed", "delete"
 * (an installation's deletion, which the cleanup reserve also admits) or the refusal's reason.
 * A create's fid is learned here so the context's later requests can name it.
 */
export function requestPolicy({ method, href, headers, postData }, { project, key, fids }) {
  const url = new URL(href);
  const base = `/v1/projects/${project}`;
  if (url.host === "firebaseinstallations.googleapis.com") {
    if (url.search !== "") return "query";
    if (headers["x-goog-api-key"] !== key) return "key";
    if (method === "POST" && url.pathname === `${base}/installations`) {
      let fid = null;
      try {
        fid = JSON.parse(postData ?? "").fid ?? null;
      } catch {
        fid = null;
      }
      if (typeof fid !== "string" || !FID.test(fid)) return "installation id";
      fids.add(fid);
      return "allowed";
    }
    const named = /^\/v1\/projects\/([^/]+)\/installations\/([^/]+?)(\/authTokens:generate)?$/.exec(
      url.pathname,
    );
    if (!named || named[1] !== project || !fids.has(named[2])) return "path";
    if (method === "POST" && named[3]) return "allowed";
    if (method === "DELETE" && !named[3]) return "delete";
    return "method";
  }
  const paths = {
    "firebaseremoteconfig.googleapis.com": `${base}/namespaces/firebase:fetch`,
    "firebaseremoteconfigrealtime.googleapis.com": `${base}/namespaces/firebase:streamFetchInvalidations`,
  };
  if (method !== "POST") return "method";
  if (url.pathname !== paths[url.host]) return "path";
  if (url.search !== `?key=${encodeURIComponent(key)}` && url.search !== `?key=${key}`)
    return "query";
  return "allowed";
}

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
}) {
  if (/pw:|\*/.test(env.DEBUG ?? "") || env.PWDEBUG || env.DEBUG_FILE)
    throw new Error("Playwright diagnostics (DEBUG, PWDEBUG, DEBUG_FILE) must be off");
  const bundles = pinnedBundles();
  const browser = await chromium.launch({ headless: true });
  const origin = originOf(port);
  let allowed = 0;
  let reserved = 0;
  let stopped = null;
  const refusals = [];
  const contexts = [];
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
    async client(config) {
      const context = await browser.newContext({ serviceWorkers: "block" });
      contexts.push(context);
      const own = { project: config.projectId, key: config.apiKey, fids: new Set() };
      await context.route("**/*", async (route) => {
        const request = route.request();
        const kind = classify(request.url(), origin);
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
        const verdict =
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
            : "not allowed";
        const forward = verdict === "allowed" && !stopped && allowed < cap;
        const cleanup = verdict === "delete" && reserved < CLEANUP_RESERVE;
        if (forward || cleanup) {
          if (forward) allowed += 1;
          else reserved += 1;
          if (!fake) return route.continue();
          const answer = await fake(request);
          return route.fulfill({
            status: answer.status,
            headers: { "access-control-allow-origin": origin, ...answer.headers },
            body: answer.body,
          });
        }
        const reason = verdict === "allowed" ? (stopped ? "after stop" : "request cap") : verdict;
        refusals.push({ host, reason });
        if (reason !== "after stop")
          stop(
            reason === "request cap"
              ? `request cap ${cap}`
              : `refused request to ${host} (${reason})`,
          );
        return route.abort();
      });
      const page = await context.newPage();
      await page.addInitScript(
        (input) => {
          window.__RC_INPUT = input;
        },
        { config, sdk: GSTATIC },
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
      return {
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
        close: () => context.close(),
      };
    },
    async close() {
      for (const context of contexts) await context.close().catch(() => {});
      await browser.close();
    },
  };
}
