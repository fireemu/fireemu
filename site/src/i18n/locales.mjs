// The site's languages. English is the root locale and keeps the unprefixed URLs; every other
// language lives under its own path segment (e.g. /fireemu/ja/). Starlight reads `locales` from
// here, and the custom components use the helpers to find the language of a page.
export const locales = {
	root: { label: 'English', lang: 'en' },
	es: { label: 'Español', lang: 'es' },
	de: { label: 'Deutsch', lang: 'de' },
	ja: { label: '日本語', lang: 'ja' },
	'zh-cn': { label: '简体中文', lang: 'zh-CN' },
	ko: { label: '한국어', lang: 'ko' },
};

/** The locale path segments other than the root (English) locale. */
export const localeCodes = Object.keys(locales).filter((code) => code !== 'root');

/** The BCP-47 tags of the translated languages, as Starlight's sidebar `translations` expects. */
export const translatedLangs = localeCodes.map((code) => locales[code].lang);

/** The URL segment that starts a page of `locale` ('' for English). */
export function localePrefix(locale) {
	return !locale || locale === 'root' ? '' : `${locale}/`;
}

/**
 * The locale a site path belongs to and the rest of the path. `path` is relative to the site
 * base, e.g. "/ja/guides/time/" gives { locale: 'ja', rest: 'guides/time/' }.
 */
export function splitLocale(path) {
	const clean = path.replace(/^\/+/, '');
	const [first, ...rest] = clean.split('/');
	if (localeCodes.includes(first)) return { locale: first, rest: rest.join('/') };
	return { locale: 'root', rest: clean };
}
