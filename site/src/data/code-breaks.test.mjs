import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breakInlineCode, withBreaks } from './code-breaks.mjs';

test('a break opportunity follows each run of separators and the text is unchanged', () => {
	assert.equal(withBreaks('firestore.missingIndexes'), 'firestore.<wbr>missingIndexes');
	const url = withBreaks('https://example.test/a_b');
	assert.equal(url, 'https://<wbr>example.<wbr>test/<wbr>a_<wbr>b');
	assert.equal(url.replaceAll('<wbr>', ''), 'https://example.test/a_b');
});

test('a word without separators, a trailing separator and a separator before a space get no break', () => {
	assert.equal(withBreaks('FAILEDPRECONDITION'), 'FAILEDPRECONDITION');
	assert.equal(withBreaks('trailing.'), 'trailing.');
	assert.equal(withBreaks('a, b'), 'a, b');
});

test('a character reference is never split from the separator before it', () => {
	assert.equal(withBreaks('a=&lt;b'), 'a=&lt;b');
	assert.equal(withBreaks('x:&#x3C;limit'), 'x:&#x3C;limit');
});

test('only inline code longer than a short word is touched; code blocks and prose are not', () => {
	const inline = '<td><code dir="auto">daemon.clockStart</code></td>';
	assert.equal(breakInlineCode(inline), '<td><code dir="auto">daemon.<wbr>clockStart</code></td>');
	const short = '<code dir="auto">a.b</code>';
	assert.equal(breakInlineCode(short), short);
	const block = '<pre data-language="toml"><code><div class="ec-line"><span>daemon.clockStart = "x"</span></div></code></pre>';
	assert.equal(breakInlineCode(block), block);
	const prose = '<p>see daemon.clockStart_and_more here</p>';
	assert.equal(breakInlineCode(prose), prose);
});
