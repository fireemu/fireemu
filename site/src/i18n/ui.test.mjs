import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dictionaries, useTranslations, statusLabel, pageLocale } from './ui.mjs';
import { localeCodes, splitLocale, translatedLangs } from './locales.mjs';
import { sidebarLabels } from './sidebar.mjs';

const url = (p) => new URL(p, 'http://site');

test('every locale has every English UI string and the same placeholders and tags', () => {
	const en = dictionaries.root;
	for (const code of localeCodes) {
		const dict = dictionaries[code];
		assert.deepEqual(Object.keys(dict).sort(), Object.keys(en).sort(), `keys of ${code}`);
		for (const [key, text] of Object.entries(en)) {
			const marks = (s) => [...s.matchAll(/\{\w+\}|<\/?code>/g)].map((m) => m[0]).sort();
			assert.deepEqual(marks(dict[key]), marks(text), `${code} ${key}`);
		}
	}
});

test('sidebar labels have all translated languages', () => {
	for (const [label, translations] of Object.entries(sidebarLabels)) {
		assert.deepEqual(Object.keys(translations).sort(), [...translatedLangs].sort(), label);
	}
});

test('links stay in the page locale and are never prefixed twice', () => {
	const ja = pageLocale(url('/fireemu/ja/guides/time/'), '/fireemu/');
	assert.equal(ja.locale, 'ja');
	assert.equal(ja.rest, 'guides/time/');
	assert.equal(ja.to('compatibility/'), '/fireemu/ja/compatibility/');
	assert.equal(ja.to('ja/compatibility/'), '/fireemu/ja/compatibility/');
	const ko = pageLocale(url('/fireemu/ko/'), '/fireemu/');
	assert.equal(ko.to('ko/compatibility/#x'), '/fireemu/ko/compatibility/#x');
	const en = pageLocale(url('/fireemu/guides/time/'), '/fireemu/');
	assert.equal(en.locale, 'root');
	assert.equal(en.to('compatibility/'), '/fireemu/compatibility/');
	assert.equal(pageLocale(url('/fireemu/'), '/fireemu/').rest, '');
	assert.deepEqual(splitLocale('/zh-cn/'), { locale: 'zh-cn', rest: '' });
	assert.deepEqual(splitLocale('/javascript/'), { locale: 'root', rest: 'javascript/' });
});

test('translation helpers fill placeholders and keep unknown statuses', () => {
	assert.equal(useTranslations('de')('table.conditions', { count: 3 }), '3 Bedingungen');
	assert.equal(statusLabel('ja', 'Supported'), '対応');
	assert.equal(statusLabel('ja', 'Something new'), 'Something new');
	assert.throws(() => useTranslations('es')('no.such.key'));
});
