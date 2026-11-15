// Translated pages get heading ids from the translated text (/ja/products/firestore/ has
// #複合インデックス, not #composite-indexes), while links written against English ids (the landing
// page, components, translated docs that kept an English #fragment) point at the English one.
// After the build, a link into a locale page whose #fragment is missing there is rewritten to the
// heading at the same position on that page: the n-th heading of the English page is taken to be
// the n-th heading of its translation. Fragments that cannot be mapped are left alone, so
// check-links still reports them.
//
// A relative link in a translated page to a file that exists only once, at the root (such as
// spec/config/fireemu.schema.json), resolves under the locale; it is pointed back at the root file.

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localeCodes, splitLocale } from '../i18n/locales.mjs';

const HEADING = /<h[2-6][^>]*\sid="([^"]+)"/g;

/** The heading ids of a page, in document order. */
export function headingIds(html) {
	return [...html.matchAll(HEADING)].map((m) => m[1]);
}

/**
 * The fragment to use on a translated page for `fragment` from the English page, or undefined when
 * it cannot be mapped (unknown on the English page, or the heading counts differ).
 */
export function mapFragment(fragment, englishIds, localeIds) {
	if (localeIds.includes(fragment)) return fragment;
	const index = englishIds.indexOf(fragment);
	if (index < 0 || englishIds.length !== localeIds.length) return undefined;
	return localeIds[index];
}

function htmlFiles(dir, out = []) {
	for (const name of readdirSync(dir)) {
		if (name === '_astro' || name === 'pagefind') continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) htmlFiles(path, out);
		else if (name.endsWith('.html')) out.push(path);
	}
	return out;
}

/** Rewrites the links in the built site `distDir` served under `base` (e.g. "/fireemu"). */
export function rewriteLocaleFragments(distDir, base) {
	const cache = new Map();
	const ids = (file) => {
		if (!cache.has(file)) cache.set(file, existsSync(file) ? headingIds(readFileSync(file, 'utf8')) : null);
		return cache.get(file);
	};
	const pageFile = (rest) => join(distDir, rest, 'index.html');
	let rewritten = 0;
	for (const file of htmlFiles(distDir)) {
		const html = readFileSync(file, 'utf8');
		const pageUrl = new URL(`${base}/${relative(distDir, file).replace(/index\.html$/, '')}`, 'http://site');
		const out = html.replace(/(<a\s[^>]*?href=")([^"]+)(")/g, (whole, open, href, close) => {
			if (/^(https?:|mailto:)/.test(href)) return whole;
			const url = new URL(href.replaceAll('&amp;', '&'), pageUrl);
			if (!url.pathname.startsWith(`${base}/`)) return whole;
			const { locale, rest } = splitLocale(url.pathname.slice(base.length));
			if (!localeCodes.includes(locale)) return whole;
			const target = join(distDir, locale, rest);
			if (!existsSync(target) && existsSync(join(distDir, rest)) && statSync(join(distDir, rest)).isFile()) {
				rewritten += 1;
				return `${open}${base}/${rest}${url.search}${url.hash}${close}`;
			}
			if (!url.hash) return whole;
			const localeIds = ids(pageFile(rest ? `${locale}/${rest}` : locale));
			const englishIds = ids(pageFile(rest));
			if (!localeIds || !englishIds) return whole;
			const fragment = decodeURIComponent(url.hash.slice(1));
			const mapped = mapFragment(fragment, englishIds, localeIds);
			if (!mapped || mapped === fragment) return whole;
			rewritten += 1;
			const [path] = href.split('#');
			return `${open}${path}#${encodeURIComponent(mapped)}${close}`;
		});
		if (out !== html) writeFileSync(file, out);
	}
	return rewritten;
}

/** Astro integration: runs the rewrite on the built pages. */
export function localeFragments(base) {
	return {
		name: 'fireemu-locale-fragments',
		hooks: {
			'astro:build:done': ({ dir, logger }) => {
				const count = rewriteLocaleFragments(fileURLToPath(dir), base.replace(/\/$/, ''));
				logger.info(`${count} links into translated pages now use the translated heading ids`);
			},
		},
	};
}
