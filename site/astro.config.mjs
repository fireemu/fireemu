// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { fileURLToPath } from 'node:url';
import { codeThemes } from './src/data/code-themes.mjs';
import { codeBreaks } from './src/data/code-breaks.mjs';
import { localeFragments } from './src/data/locale-fragments.mjs';
import { locales } from './src/i18n/locales.mjs';
import { translateSidebar } from './src/i18n/sidebar.mjs';

// The deployment target is set by the Pages workflow. The defaults build for
// https://fireemu.github.io/fireemu/, the project page of the repository.
const site = process.env.FIREEMU_SITE_URL ?? 'https://fireemu.github.io';
const base = process.env.FIREEMU_SITE_BASE ?? '/fireemu';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
	site,
	base,
	trailingSlash: 'always',
	vite: {
		// The compatibility pages read spec/ and crates/ from the repository root.
		server: { fs: { allow: [repoRoot] } },
	},
	integrations: [
		starlight({
			title: 'Fireemu',
			description:
				'A local Firebase emulator for tests and CI that follows production Firebase behavior.',
			// The emu mark on a dark tile, so it reads on light and dark browser tabs.
			// The cleaned source drawing is src/assets/emu.png.
			favicon: '/favicon.png',
			// English stays at the unprefixed URLs; the other languages live under /<locale>/ and
			// pages not yet translated fall back to the English content (src/i18n/locales.mjs).
			defaultLocale: 'root',
			locales,
			head: [
				{ tag: 'link', attrs: { rel: 'icon', href: `${base}/favicon.ico`, sizes: '48x48' } },
				{ tag: 'link', attrs: { rel: 'apple-touch-icon', href: `${base}/apple-touch-icon.png` } },
			],
			editLink: { baseUrl: 'https://github.com/fireemu/fireemu/edit/main/site/' },
			lastUpdated: false,
			// tokens.css holds the palette and maps it onto Starlight's variables; custom.css styles
			// the chrome and components. The landing page (src/pages/index.astro) uses both.
			customCss: [
				'@fontsource-variable/inter',
				'./src/styles/tokens.css',
				'./src/styles/custom.css',
			],
			expressiveCode: {
				themes: codeThemes,
				useStarlightUiThemeColors: true,
				styleOverrides: {
					borderRadius: '0',
					borderColor: 'var(--fe-border)',
					codeBackground: 'var(--fe-code-bg)',
					codeFontSize: '0.9375rem',
					codeLineHeight: '1.8',
					codePaddingBlock: '1.125rem',
					codePaddingInline: '1.125rem',
					uiFontSize: '0.9375rem',
					frames: {
						frameBoxShadowCssValue: 'none',
						editorTabBarBackground: 'var(--fe-code-bg)',
						editorActiveTabBackground: 'var(--fe-code-bg)',
						editorActiveTabIndicatorTopColor: 'transparent',
						editorActiveTabIndicatorBottomColor: 'transparent',
						editorTabBarBorderBottomColor: 'var(--fe-border)',
						editorActiveTabForeground: 'var(--fe-fg-secondary)',
						terminalTitlebarBackground: 'var(--fe-code-bg)',
						terminalTitlebarBorderBottomColor: 'var(--fe-border)',
						terminalTitlebarForeground: 'var(--fe-fg-secondary)',
						terminalBackground: 'var(--fe-code-bg)',
					},
				},
			},
			components: {
				// Text links in the header, so the landing page reaches the docs too.
				SocialIcons: './src/components/HeaderNav.astro',
				// The site footer under every page, and no duplicate <h1> on the landing page.
				Footer: './src/components/Footer.astro',
				PageTitle: './src/components/PageTitle.astro',
				// The language picker next to the search box on narrow screens.
				Search: './src/components/Search.astro',
				// Icon menus instead of the native selects, so the open list has room and stays on screen.
				ThemeSelect: './src/components/ThemeSelect.astro',
				LanguageSelect: './src/components/LanguageSelect.astro',
			},
			sidebar: translateSidebar([
				{
					label: 'Getting started',
					items: [
						{ label: 'Why Fireemu', slug: 'getting-started/why-fireemu' },
						{ label: 'Install and run', slug: 'getting-started/install' },
						{ label: 'Connect your app', slug: 'getting-started/connect' },
						{ label: 'Migrate from the Local Emulator Suite', slug: 'getting-started/migrate' },
					],
				},
				{
					label: 'Products',
					items: [
						{ label: 'Cloud Firestore', slug: 'products/firestore' },
						{ label: 'Authentication', slug: 'products/auth' },
						{ label: 'Cloud Storage', slug: 'products/storage' },
						{ label: 'Cloud Functions', slug: 'products/functions' },
						{ label: 'Cloud Functions (Python)', slug: 'products/functions-python' },
						{ label: 'Pub/Sub and Eventarc', slug: 'products/pubsub-eventarc' },
						{ label: 'Realtime Database', slug: 'products/realtime-database' },
						{ label: 'Firebase Hosting', slug: 'products/hosting' },
						{ label: 'App Check', slug: 'products/app-check' },
					],
				},
				{
					label: 'Guides',
					items: [
						{ label: 'Configuration files', slug: 'guides/configuration' },
						{ label: 'Profiles and productionExact', slug: 'guides/profiles' },
						{ label: 'Security Rules', slug: 'guides/security-rules' },
						{ label: 'Time and scheduled functions', slug: 'guides/time' },
						{ label: 'Test worlds', slug: 'guides/test-worlds' },
						{ label: 'Export and import data', slug: 'guides/data' },
						{ label: 'Emulator UI', slug: 'guides/ui' },
						{ label: 'CI and containers', slug: 'guides/ci-and-containers' },
						{ label: 'Troubleshooting', slug: 'guides/troubleshooting' },
					],
				},
				{
					label: 'Compatibility',
					items: [
						{ label: 'Compatibility tables', slug: 'compatibility' },
						{ label: 'Limitations', slug: 'compatibility/limitations' },
						{ label: 'Performance', slug: 'compatibility/performance' },
					],
				},
				{
					label: 'Reference',
					items: [
						{ label: 'CLI', slug: 'reference/cli' },
						{ label: 'Configuration schema', slug: 'reference/configuration' },
						{ label: 'Environment variables', slug: 'reference/environment-variables' },
					],
				},
			]),
		}),
		// Long inline code wraps at its separators, never mid-word (rewrites the built HTML).
		codeBreaks(),
		// Links into translated pages use the translated heading ids (src/data/locale-fragments.mjs).
		localeFragments(base),
	],
});
