// Checks every internal link in the built site (dist/): the target page exists, and a #fragment
// names an id on that page. Stylesheets, scripts and images a page loads must exist too (a stale
// build cache can leave a page pointing at a stylesheet of an earlier build). Run after `pnpm build`. Exits 1 and lists each broken link.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const base = (process.env.FIREEMU_SITE_BASE ?? '/fireemu').replace(/\/$/, '');

/** Every index.html under dist, without following links into asset folders. */
function pages(dir, out = []) {
	for (const name of readdirSync(dir)) {
		if (name === '_astro' || name === 'pagefind') continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) pages(path, out);
		else if (name.endsWith('.html')) out.push(path);
	}
	return out;
}

const idsByFile = new Map();
function idsOf(file) {
	if (!idsByFile.has(file)) {
		const html = readFileSync(file, 'utf8');
		idsByFile.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
	}
	return idsByFile.get(file);
}

/** The dist file an absolute site path points at, or undefined when nothing is there. */
function fileFor(pathname) {
	if (!pathname.startsWith(`${base}/`) && pathname !== base) return undefined;
	const rest = pathname.slice(base.length).replace(/^\//, '');
	const candidates = [join(dist, rest), join(dist, rest, 'index.html')];
	return candidates.find((c) => existsSync(c) && statSync(c).isFile());
}

const broken = [];
let checked = 0;
for (const file of pages(dist)) {
	const html = readFileSync(file, 'utf8');
	const pageUrl = new URL(`${base}/${relative(dist, file).replace(/index\.html$/, '')}`, 'http://site');
	const from = relative(dist, file);
	for (const [, asset] of html.matchAll(/<(?:link|script|img)\s[^>]*?(?:href|src)="([^"]+)"/g)) {
		const raw = asset.replaceAll('&amp;', '&');
		if (/^(https?:|data:|\/\/)/.test(raw)) continue;
		checked += 1;
		if (!fileFor(new URL(raw, pageUrl).pathname)) broken.push(`${from}: ${raw} -> no such file`);
	}
	for (const [, href] of html.matchAll(/<a\s[^>]*?href="([^"]+)"/g)) {
		const raw = href.replaceAll('&amp;', '&');
		if (/^(https?:|mailto:|data:)/.test(raw)) continue;
		const url = new URL(raw, pageUrl);
		checked += 1;
		const target = fileFor(url.pathname);
		if (!target) {
			broken.push(`${from}: ${raw} -> no such page`);
			continue;
		}
		const fragment = decodeURIComponent(url.hash.slice(1));
		if (fragment && target.endsWith('.html') && !idsOf(target).has(fragment)) {
			broken.push(`${from}: ${raw} -> no id "${fragment}" on ${relative(dist, target)}`);
		}
	}
}

for (const line of [...new Set(broken)]) console.error(line);
console.log(`${checked} internal links and assets checked, ${new Set(broken).size} broken`);
process.exit(broken.length ? 1 : 0);
