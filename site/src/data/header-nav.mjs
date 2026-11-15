// Links shown in the site header on every page, including the landing page, which has no sidebar.
// A link with a `slug` is a docs page, and `section` is the path prefix that marks it as current;
// a link with an `href` leaves the site.
export const headerNav = [
	{ label: 'Docs', slug: 'getting-started/install', section: 'getting-started' },
	{ label: 'Products', slug: 'products/firestore', section: 'products' },
	{ label: 'Guides', slug: 'guides/configuration', section: 'guides' },
	{ label: 'Compatibility', slug: 'compatibility', section: 'compatibility' },
	{ label: 'npm', href: 'https://www.npmjs.com/package/fireemu' },
	{ label: 'GitHub', href: 'https://github.com/fireemu/fireemu' },
];

/** The link whose section is the longest prefix of `path` (relative to the site base). */
export function currentNavSlug(path) {
	const clean = path.replace(/^\/+|\/+$/g, '');
	let best;
	for (const item of headerNav) {
		if (!item.section) continue;
		if (clean === item.section || clean.startsWith(`${item.section}/`)) {
			if (!best || item.section.length > best.section.length) best = item;
		}
	}
	return best?.slug;
}
