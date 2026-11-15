// Syntax themes for every code block on the site (docs pages and the landing page).
// The hex values are the sRGB equivalents of the --fe-code-* tokens in src/styles/tokens.css;
// Expressive Code needs literal colors here, so keep the two in step.

const theme = (name, type, c) => ({
	name,
	type,
	colors: {
		'editor.background': c.bg,
		'editor.foreground': c.fg,
	},
	tokenColors: [
		{ scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: c.comment } },
		{
			scope: [
				'keyword',
				'storage',
				'storage.type',
				'storage.modifier',
				'keyword.control',
				'keyword.operator.new',
				'entity.name.tag',
				'support.type.property-name.toml',
				'entity.name.section',
			],
			settings: { foreground: c.keyword },
		},
		{
			scope: ['string', 'string.quoted', 'string.template', 'markup.inline.raw'],
			settings: { foreground: c.string },
		},
		{
			scope: ['constant.numeric', 'constant.language', 'constant.other.option', 'variable.parameter.option'],
			settings: { foreground: c.keyword },
		},
		{
			scope: ['support.type.property-name', 'meta.object-literal.key', 'entity.other.attribute-name'],
			settings: { foreground: c.property },
		},
		{ scope: ['markup.heading'], settings: { foreground: c.keyword, fontStyle: 'bold' } },
		{ scope: ['markup.inserted'], settings: { foreground: c.string } },
		{ scope: ['markup.deleted'], settings: { foreground: c.deleted } },
	],
});

export const codeThemes = [
	theme('fireemu-dark', 'dark', {
		bg: '#0f1317',
		fg: '#ecf0f4',
		comment: '#afb3b7',
		keyword: '#f5ca7a',
		string: '#a8c8a8',
		property: '#9bc6ec',
		deleted: '#f8a49d',
	}),
	theme('fireemu-light', 'light', {
		bg: '#e5eaee',
		fg: '#202326',
		comment: '#575a5d',
		keyword: '#6f4c12',
		string: '#345035',
		property: '#284e6c',
		deleted: '#89312f',
	}),
];
