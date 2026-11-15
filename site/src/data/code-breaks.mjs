// Inline code gets a line-break opportunity (<wbr>) after each separator, so a long identifier
// in a narrow table column or on a phone wraps at `.`, `_`, `/`, `:`, `=` or `,` and never in the
// middle of a word. Code blocks are left alone, and copied text is unaffected.
//
// This runs on the built HTML: Astro's default Markdown processor takes no rehype plugins.
// The dev server therefore shows inline code without the break opportunities.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEPARATOR = /([._/:=,]+)(?=[^\s._/:=,&])/g;
// Inline code is a <code> whose content is plain text; code blocks hold elements inside <code>.
const INLINE_CODE = /(<code(?: dir="auto")?>)([^<]{13,})(<\/code>)/g;

/** `text` with a <wbr> after each run of separators that is followed by more text. */
export function withBreaks(text) {
	return text.replace(SEPARATOR, '$1<wbr>');
}

/** `html` with break opportunities in every inline code element longer than a short word. */
export function breakInlineCode(html) {
	return html.replace(INLINE_CODE, (_, open, text, close) => open + withBreaks(text) + close);
}

function htmlFiles(dir, out = []) {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) htmlFiles(path, out);
		else if (name.endsWith('.html')) out.push(path);
	}
	return out;
}

/** Astro integration: rewrites the built pages. */
export function codeBreaks() {
	return {
		name: 'fireemu-code-breaks',
		hooks: {
			'astro:build:done': ({ dir }) => {
				for (const file of htmlFiles(fileURLToPath(dir))) {
					const html = readFileSync(file, 'utf8');
					const next = breakInlineCode(html);
					if (next !== html) writeFileSync(file, next);
				}
			},
		},
	};
}
