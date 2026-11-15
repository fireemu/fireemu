// The UI strings of the custom components and the landing page, one dictionary per locale. A key
// missing from a translation falls back to English, so a page never shows a bare key.
import en from './en.json' with { type: 'json' };
import es from './es.json' with { type: 'json' };
import de from './de.json' with { type: 'json' };
import ja from './ja.json' with { type: 'json' };
import zhCn from './zh-cn.json' with { type: 'json' };
import ko from './ko.json' with { type: 'json' };
import { localePrefix, splitLocale } from './locales.mjs';

export const dictionaries = { root: en, es, de, ja, 'zh-cn': zhCn, ko };

/** A translator for `locale`: t(key, { count }) fills {count}-style placeholders. */
export function useTranslations(locale = 'root') {
	const dict = dictionaries[locale] ?? en;
	return (key, vars = {}) => {
		const text = dict[key] ?? en[key];
		if (text === undefined) throw new Error(`no UI string "${key}"`);
		return text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
	};
}

/** Translates a status label from the compatibility data, keeping unknown labels as they are. */
export function statusLabel(locale, status) {
	const dict = dictionaries[locale] ?? en;
	return dict[`status.${status}`] ?? en[`status.${status}`] ?? status;
}

/**
 * The locale of a page from its URL, and a function that makes a link to a site path (relative to
 * the base, e.g. "guides/time/") in the same locale.
 */
export function pageLocale(url, baseUrl) {
	const base = baseUrl.replace(/\/$/, '');
	const path = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : url.pathname;
	const { locale, rest } = splitLocale(path);
	// A target that already names a locale (e.g. "ko/compatibility/") is not prefixed again.
	const to = (target = '') =>
		splitLocale(target).locale !== 'root' ? `${base}/${target}` : `${base}/${localePrefix(locale)}${target}`;
	return { locale, rest, to, t: useTranslations(locale) };
}
