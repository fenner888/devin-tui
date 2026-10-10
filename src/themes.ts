import fs from 'node:fs';
import path from 'node:path';
import type {Bg, StyleDef, Token} from './theme.js';
import {configDir} from './settings.js';

/** Theme palette — hex colors a theme provides; derived styles (bezels,
 *  shimmer bands, diff backgrounds…) are computed from these. */
export interface Palette {
	bg: string;
	panel: string;
	overlay: string;
	raised: string;
	text: string;
	bright: string;
	muted: string;
	faint: string;
	rule: string;
	sel: string;
	selFg: string;
	accent: string;
	accentBg: string;
	ok: string;
	err: string;
	warn: string;
	orange: string;
	purple: string;
	info: string;
	/** accent/title/strong fg; defaults to bright */
	title?: string;
	/** diff backgrounds; default = mix(bg, ok|err, 0.16) */
	diffAdd?: string;
	diffDel?: string;
}

export interface ThemeDef {
	id: string;
	name: string;
	dark: boolean;
	palette: Palette;
	/** per-token fg overrides applied after derivation */
	tokens?: Partial<Record<Token, string>>;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export function hexToRgb(hex: string): [number, number, number] {
	return [
		parseInt(hex.slice(1, 3), 16),
		parseInt(hex.slice(3, 5), 16),
		parseInt(hex.slice(5, 7), 16),
	];
}

function toHex([r, g, b]: [number, number, number]): string {
	return (
		'#' +
		[r, g, b]
			.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
			.join('')
	);
}

/** Linear RGB lerp a→b by t. */
export function mix(a: string, b: string, t: number): string {
	const ca = hexToRgb(a);
	const cb = hexToRgb(b);
	return toHex([
		ca[0] + (cb[0] - ca[0]) * t,
		ca[1] + (cb[1] - ca[1]) * t,
		ca[2] + (cb[2] - ca[2]) * t,
	]);
}

// ---- built-in themes ---------------------------------------------------------

export const BUILTIN_THEMES: ThemeDef[] = [
	{
		id: 'devin',
		name: 'Devin',
		dark: true,
		palette: {
			bg: '#0a0a0a', panel: '#141414', overlay: '#1a1a1a', raised: '#202020',
			text: '#d4d4d4', bright: '#ffffff', muted: '#7a7a7a', faint: '#4a4a4a',
			rule: '#2a2a2a', sel: '#e8e8e8', selFg: '#0a0a0a',
			accent: '#4db8ff', accentBg: '#1c2530',
			ok: '#3ddc84', err: '#e06c6c', warn: '#e6d17a', orange: '#e5a07a',
			purple: '#b48ead', info: '#6cb6ff',
			diffAdd: '#12261a', diffDel: '#2a1414',
		},
		tokens: {
			pkOff: '#5f6b78',
			bezelHi: '#6a6a6a', bezelMid: '#4a4a4a', bezelLo: '#2e2e2e',
			shine2: '#cfcfcf', shine3: '#9a9a9a',
		},
	},
	{
		id: 'light',
		name: 'Light',
		dark: false,
		palette: {
			bg: '#fafafa', panel: '#f0f0f0', overlay: '#e9e9e9', raised: '#e4e4e4',
			text: '#2b2b2b', bright: '#000000', muted: '#6e6e6e', faint: '#a3a3a3',
			rule: '#e0e0e0', sel: '#1f1f1f', selFg: '#fafafa',
			accent: '#0969da', accentBg: '#ddeafb',
			ok: '#1a7f37', err: '#cf222e', warn: '#9a6700', orange: '#bc4c00',
			purple: '#8250df', info: '#0969da',
			diffAdd: '#e3f6e8', diffDel: '#fbe6e6',
		},
	},
	{
		id: 'high-contrast',
		name: 'High Contrast',
		dark: true,
		palette: {
			bg: '#000000', panel: '#121212', overlay: '#1a1a1a', raised: '#262626',
			text: '#ffffff', bright: '#ffffff', muted: '#c8c8c8', faint: '#9a9a9a',
			rule: '#6a6a6a', sel: '#ffffff', selFg: '#000000',
			accent: '#5cc8ff', accentBg: '#003a5c',
			ok: '#5cff9d', err: '#ff6b6b', warn: '#ffe066', orange: '#ffa94d',
			purple: '#da77f2', info: '#74c0fc',
		},
	},
	{
		id: 'nord',
		name: 'Nord',
		dark: true,
		palette: {
			bg: '#2e3440', panel: '#3b4252', overlay: '#434c5e', raised: '#4c566a',
			text: '#d8dee9', bright: '#eceff4', muted: '#7b88a1', faint: '#616e88',
			rule: '#434c5e', sel: '#88c0d0', selFg: '#2e3440',
			accent: '#88c0d0', accentBg: '#434c5e',
			ok: '#a3be8c', err: '#bf616a', warn: '#ebcb8b', orange: '#d08770',
			purple: '#b48ead', info: '#81a1c1',
		},
	},
	{
		id: 'gruvbox',
		name: 'Gruvbox',
		dark: true,
		palette: {
			bg: '#282828', panel: '#32302f', overlay: '#3c3836', raised: '#504945',
			text: '#ebdbb2', bright: '#fbf1c7', muted: '#a89984', faint: '#665c54',
			rule: '#3c3836', sel: '#ebdbb2', selFg: '#282828',
			accent: '#83a598', accentBg: '#3c3836',
			ok: '#b8bb26', err: '#fb4934', warn: '#fabd2f', orange: '#fe8019',
			purple: '#d3869b', info: '#83a598',
		},
	},
	{
		id: 'catppuccin',
		name: 'Catppuccin Mocha',
		dark: true,
		palette: {
			bg: '#1e1e2e', panel: '#272739', overlay: '#313244', raised: '#45475a',
			text: '#cdd6f4', bright: '#e6ebff', muted: '#7f849c', faint: '#585b70',
			rule: '#313244', sel: '#cba6f7', selFg: '#1e1e2e',
			accent: '#89b4fa', accentBg: '#313244',
			ok: '#a6e3a1', err: '#f38ba8', warn: '#f9e2af', orange: '#fab387',
			purple: '#cba6f7', info: '#89b4fa',
		},
	},
	{
		id: 'tokyo-night',
		name: 'Tokyo Night',
		dark: true,
		palette: {
			bg: '#1a1b26', panel: '#1f2335', overlay: '#24283b', raised: '#292e42',
			text: '#c0caf5', bright: '#e0e6ff', muted: '#737aa2', faint: '#565f89',
			rule: '#292e42', sel: '#7aa2f7', selFg: '#1a1b26',
			accent: '#7aa2f7', accentBg: '#292e42',
			ok: '#9ece6a', err: '#f7768e', warn: '#e0af68', orange: '#ff9e64',
			purple: '#bb9af7', info: '#7dcfff',
		},
	},
];

export function builtinTheme(id: string): ThemeDef | undefined {
	return BUILTIN_THEMES.find(t => t.id === id);
}

// ---- custom themes ------------------------------------------------------------

const MAX_THEME_FILE = 64 * 1024;

export interface CustomThemeError {
	file: string;
	error: string;
}

/** `<configdir>/themes/*.json` → theme defs + per-file errors. Shape:
 *  `{name?, extends? (default devin), palette?: Partial<Palette>,
 *  tokens?: Partial<Record<Token,string>>}` — only `#rrggbb` values are
 *  accepted; unknown keys and bad values are ignored; files >64 KB or
 *  unparseable JSON become error rows. Rescanned on every call. */
export function loadCustomThemes(dir = path.join(configDir(), 'themes')): {
	themes: ThemeDef[];
	errors: CustomThemeError[];
} {
	const themes: ThemeDef[] = [];
	const errors: CustomThemeError[] = [];
	let files: string[];
	try {
		files = fs
			.readdirSync(dir)
			.filter(f => f.endsWith('.json'))
			.sort();
	} catch {
		return {themes, errors};
	}
	for (const f of files) {
		const file = path.join(dir, f);
		const id = f.slice(0, -'.json'.length);
		try {
			const st = fs.statSync(file);
			if (st.size > MAX_THEME_FILE) {
				errors.push({file: f, error: 'over 64 KB'});
				continue;
			}
			const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
			if (typeof raw !== 'object' || raw === null) {
				errors.push({file: f, error: 'not an object'});
				continue;
			}
			const r = raw as {
				name?: unknown;
				extends?: unknown;
				palette?: unknown;
				tokens?: unknown;
			};
			const base =
				typeof r.extends === 'string'
					? (builtinTheme(r.extends) ?? builtinTheme('devin')!)
					: builtinTheme('devin')!;
			const palette = {...base.palette};
			if (typeof r.palette === 'object' && r.palette !== null) {
				for (const [k, v] of Object.entries(
					r.palette as Record<string, unknown>,
				)) {
					if (k in palette && typeof v === 'string' && HEX.test(v)) {
						(palette as Record<string, string>)[k] = v;
					}
				}
			}
			const tokens: ThemeDef['tokens'] = {...base.tokens};
			if (typeof r.tokens === 'object' && r.tokens !== null) {
				for (const [k, v] of Object.entries(
					r.tokens as Record<string, unknown>,
				)) {
					if (typeof v === 'string' && HEX.test(v)) {
						(tokens as Record<string, string>)[k] = v;
					}
				}
			}
			themes.push({
				id,
				name: typeof r.name === 'string' && r.name ? r.name : id,
				dark: base.dark,
				palette,
				tokens,
			});
		} catch (e) {
			errors.push({
				file: f,
				error: e instanceof Error ? e.message : 'unparseable',
			});
		}
	}
	return {themes, errors};
}

export function themeById(
	id: string,
	custom: ThemeDef[] = loadCustomThemes().themes,
): ThemeDef | undefined {
	return builtinTheme(id) ?? custom.find(t => t.id === id);
}

// ---- theme resolution ---------------------------------------------------------

/** Palette → the resolved fg/bg tables segStyle reads. Per-token
 *  overrides in `def.tokens` win over the derived fg. */
export function resolveTheme(def: ThemeDef): {
	colors: Record<Token, StyleDef>;
	bgs: Record<Bg, string>;
} {
	const p = def.palette;
	const fg = (c: string): StyleDef => ({fg: c});
	const strongFg = p.title ?? p.bright;
	const colors: Record<Token, StyleDef> = {
		plain: {},
		text: fg(p.text),
		bright: fg(p.bright),
		muted: fg(p.muted),
		faint: fg(p.faint),
		rule: fg(p.rule),
		accent: {fg: strongFg, bold: true},
		title: {fg: strongFg, bold: true},
		strong: {fg: strongFg, bold: true},
		sel: {fg: p.selFg, bg: 'sel'},
		code: {fg: p.bright, bg: 'raised'},
		caret: {fg: p.selFg, bg: 'sel'},
		err: fg(p.err),
		ok: fg(p.ok),
		cmdFlag: fg(p.info),
		cmdString: fg(p.orange),
		thought: {fg: p.muted, italic: true},
		ghost: fg(p.faint),
		spin: fg(p.muted),
		pk: fg(p.accent),
		pkBold: {fg: p.accent, bold: true},
		pkDim: {fg: p.accent, dim: true},
		pkOff: fg(mix(p.muted, p.accent, 0.25)),
		pkGreen: fg(p.ok),
		pkYellow: fg(p.warn),
		pkOrange: fg(p.orange),
		pkPurple: fg(p.purple),
		pkBadge: {fg: p.bg, bg: 'pkBlue'},
		bezelHi: fg(mix(p.bg, p.bright, 0.38)),
		bezelMid: fg(mix(p.bg, p.bright, 0.25)),
		bezelLo: fg(mix(p.bg, p.bright, 0.15)),
		shine1: fg(p.bright),
		shine2: fg(mix(p.muted, p.bright, 0.7)),
		shine3: fg(mix(p.muted, p.bright, 0.3)),
		patternFar: fg(mix(p.bg, p.bright, 0.11)),
		patternNear: fg(mix(p.bg, p.bright, 0.06)),
	};
	for (const [k, v] of Object.entries(def.tokens ?? {})) {
		if (typeof v === 'string' && HEX.test(v)) {
			colors[k as Token] = {...colors[k as Token], fg: v};
		}
	}
	const bgs: Record<Bg, string> = {
		bg: p.bg,
		panel: p.panel,
		overlay: p.overlay,
		raised: p.raised,
		sel: p.sel,
		pkSel: p.accentBg,
		pkBlue: p.accent,
		diffAdd: p.diffAdd ?? mix(p.bg, p.ok, 0.16),
		diffDel: p.diffDel ?? mix(p.bg, p.err, 0.16),
	};
	return {colors, bgs};
}

// ---- OSC 11 (terminal background → auto theme) --------------------------------

/** Parse an OSC 11 reply `ESC ] 11 ; rgb:RR/GG/BB (BEL|ST)` (2- or
 *  4-hex-digit components, possibly wrapped in other output) → relative
 *  luminance in [0,1] (WCAG linearized), or null. */
export function osc11Luminance(data: string): number | null {
	const m =
		/\x1b?\]?11;rgb:([0-9a-fA-F]{2,4})\/([0-9a-fA-F]{2,4})\/([0-9a-fA-F]{2,4})(?:\x07|\x1b\\)/.exec(
			data,
		) ??
		/rgb:([0-9a-fA-F]{2,4})\/([0-9a-fA-F]{2,4})\/([0-9a-fA-F]{2,4})/.exec(
			data,
		);
	if (!m) return null;
	const comp = (s: string) => {
		const v = parseInt(s, 16);
		// 4-digit components are 16-bit; scale to [0,1]
		const n = v / (s.length <= 2 ? 0xff : 0xffff);
		// duplicate nibble counts as 2 digits ("rgg" style isn't expected)
		return n;
	};
	const lin = (c: number) =>
		c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
	const [r, g, b] = [comp(m[1]), comp(m[2]), comp(m[3])];
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
