// Links shown in the site header on every page, including the landing page, which has no sidebar.
// A link with a `slug` is a docs page, and `section` is the path prefix that marks it as current;
// a link with an `href` leaves the site. `key` names the label in src/i18n/<locale>.json.
import { splitLocale } from '../i18n/locales.mjs';

export const headerNav = [
	{ label: 'Docs', key: 'nav.docs', slug: 'getting-started/install', section: 'getting-started' },
	{ label: 'Supported services', key: 'nav.products', slug: 'products/firestore', section: 'products' },
	{ label: 'Guides', key: 'nav.guides', slug: 'guides/configuration', section: 'guides' },
	{ label: 'Compatibility', key: 'nav.compatibility', slug: 'compatibility', section: 'compatibility' },
	{ label: 'npm', icon: 'npm', href: 'https://www.npmjs.com/package/fireemu' },
	{ label: 'GitHub', icon: 'github', href: 'https://github.com/fireemu/fireemu' },
];

/**
 * The link whose section is the longest prefix of `path` (relative to the site base). A locale
 * prefix such as /ja/ is ignored, so a translated page marks the same section.
 */
export function currentNavSlug(path) {
	const clean = splitLocale(path).rest.replace(/^\/+|\/+$/g, '');
	let best;
	for (const item of headerNav) {
		if (!item.section) continue;
		if (clean === item.section || clean.startsWith(`${item.section}/`)) {
			if (!best || item.section.length > best.section.length) best = item;
		}
	}
	return best?.slug;
}
