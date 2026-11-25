// The browser side of the RC-CLOSURE-B recorder: one headless Chromium, one context per synthetic
// installation, each with the page of page.mjs. The page is served by the context's request hook
// (nothing listens), the SDK bundles are the gstatic URLs of the pinned firebase package answered
// from node_modules, and every other request goes through the hook's allow list: the Remote
// Config, realtime and Installations hosts in production (continued unchanged), or a fake that
// answers them in tests. Anything else is aborted and stops the run. A cap counts the allowed
// requests of all contexts together.
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
/** The bundles the page may load, by file name. */
export const BUNDLES = [
  "firebase-app.js",
  "firebase-remote-config.js",
  "firebase-installations.js",
];
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
 * What the hook does with one request URL: `page` and `bundle` answered from files, `allowed` for
 * the three hosts over https without credentials in the URL, and `refused` for anything else.
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
    return "allowed";
  return "refused";
}

/**
 * Opens the browser. `fake(request)` (tests) answers the allowed hosts instead of the network: it
 * returns `{ status, headers, body }`. `cap` bounds the allowed requests of all contexts.
 */
export async function openBrowser({ port, cap, fake = null, onRefuse = () => {} }) {
  const browser = await chromium.launch({ headless: true });
  const origin = originOf(port);
  let allowed = 0;
  let stopped = null;
  const refusals = [];
  const contexts = [];
  const stop = (reason) => {
    if (!stopped) {
      stopped = reason;
      onRefuse(reason);
    }
  };
  return {
    stopped: () => stopped,
    refusals,
    allowedRequests: () => allowed,
    /** A new context and page with `config`; resolves when the page's SDK is loaded. */
    async client(config) {
      const context = await browser.newContext({ serviceWorkers: "block" });
      contexts.push(context);
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
            body: readFileSync(join(FIREBASE, request.url().slice(GSTATIC.length))),
          });
        if (kind === "allowed" && !stopped && allowed < cap) {
          allowed += 1;
          if (!fake) return route.continue();
          const answer = await fake(request);
          return route.fulfill({
            status: answer.status,
            headers: { "access-control-allow-origin": origin, ...answer.headers },
            body: answer.body,
          });
        }
        const host = new URL(request.url()).host;
        refusals.push({ host, kind, reason: kind === "allowed" ? "request cap" : "not allowed" });
        stop(kind === "allowed" ? `request cap ${cap}` : `refused request to ${host}`);
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
      return {
        call: (name, ...args) => page.evaluate(([n, a]) => window.rc[n](...a), [name, args]),
        /** Every exchange the page recorded so far (a stream's frames grow while it is open). */
        wire: () => page.evaluate(() => window.rc.wire(0)),
        updates: () => page.evaluate(() => window.rc.updates()),
        close: () => context.close(),
      };
    },
    async close() {
      for (const context of contexts) await context.close().catch(() => {});
      await browser.close();
    },
  };
}
