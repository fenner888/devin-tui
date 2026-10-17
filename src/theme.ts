/**
 * Central style tokens for the entire UI — the ONLY place styling is defined.
 *
 * Tokens resolve through the active theme (`src/themes.ts`): the default
 * 'devin' theme is grayscale (depth from background shades, never hue);
 * other built-ins and user themes recolor tokens + neutrals but add no new
 * hue roles. If the terminal lacks truecolor (COLORTERM not
 * truecolor/24bit) all colors drop to attribute-only equivalents
 * (bold/dim/inverse/ansi) and theme/background settings are ignored.
 */

import {
	BUILTIN_THEMES,
	builtinTheme,
	mix,
	resolveTheme,
	themeById,
	type ThemeDef,
} from './themes.js';
import type {Settings} from './settings.js';

export const TRUECOLOR = /^(truecolor|24bit)$/i.test(process.env.COLORTERM ?? '');

export type Bg =
	| 'bg'
	| 'panel'
	| 'overlay'
	| 'raised'
	| 'sel'
	| 'pkSel'
	| 'pkBlue'
	| 'diffAdd'
	| 'diffDel';

export type Token =
	| 'plain' // default terminal fg
	| 'text' // body text
	| 'bright' // values, key names
	| 'muted' // labels
	| 'faint' // lowest-emphasis text
	| 'rule' // separators │ ─
	| 'accent' // bright + bold — mode name
	| 'title' // bright + bold — headings, section titles
	| 'strong' // bright + bold — **markdown bold**
	| 'sel' // selection row (fg selFg on bg sel)
	| 'code' // `inline code` — bright on raised
	| 'err' // failures, ✗, −M stats, failed text
	| 'ok' // ✓, completed dots, +N stats
	| 'cmdFlag' // -flags in $ command lines
	| 'cmdString' // "quoted strings" in $ command lines
	| 'thought' // muted italic — thinking
	| 'ghost' // faint — detail/thought tail
	| 'caret' // block cursor
	| 'spin' // muted spinner
	// picker palette (accent)
	| 'pk' // selected name, chevron, filled bars, effort label
	| 'pkBold' // accent + bold — selected inline-permission row
	| 'pkDim' // accent, dim — ← → arrows
	| 'pkOff' // unfilled bars
	| 'pkGreen' // "New" badge + price-slider low end
	| 'pkYellow' // "Beta" badge + price-slider mid-low
	| 'pkOrange' // price-slider mid-high
	| 'pkPurple' // price-slider high end
	| 'pkBadge' // FREE badge (fg bg on bg pkBlue)
	// composer frame bezel + working shimmer
	| 'bezelHi' // top/left edge + ╭
	| 'bezelMid' // ╮ ╰ mixed corners
	| 'bezelLo' // bottom/right edge + ╯
	| 'shine1' // shimmer band head
	| 'shine2' // shimmer band mid
	| 'shine3' // shimmer band tail
	// home dot field (background 'pattern' mode)
	| 'patternFar' // outer half of the distance from the block
	| 'patternNear'; // inner half

export interface StyleDef {
	fg?: string;
	bg?: Bg;
	ansi?: string; // ANSI color keyword used in the non-truecolor fallback
	ansiBg?: string;
	bold?: boolean;
	dim?: boolean;
	italic?: boolean;
	inverse?: boolean;
}

const MONO: Record<Token, StyleDef> = {
	plain: {},
	text: {},
	bright: {bold: true},
	muted: {dim: true},
	faint: {dim: true},
	rule: {dim: true},
	accent: {bold: true},
	title: {bold: true},
	strong: {bold: true},
	sel: {inverse: true},
	code: {inverse: true},
	err: {ansi: 'red'},
	ok: {ansi: 'green'},
	cmdFlag: {ansi: 'blue'},
	cmdString: {ansi: 'yellow'},
	thought: {dim: true, italic: true},
	ghost: {dim: true},
	caret: {inverse: true},
	spin: {dim: true},
	pk: {ansi: 'blueBright'},
	pkBold: {ansi: 'blueBright', bold: true},
	pkDim: {ansi: 'blueBright', dim: true},
	pkOff: {dim: true},
	pkGreen: {ansi: 'green'},
	pkYellow: {ansi: 'yellow'},
	pkOrange: {ansi: 'red'},
	pkPurple: {ansi: 'magenta'},
	pkBadge: {ansi: 'black', ansiBg: 'blueBright'},
	bezelHi: {dim: true},
	bezelMid: {dim: true},
	bezelLo: {dim: true},
	shine1: {bold: true},
	shine2: {},
	shine3: {},
	patternFar: {dim: true},
	patternNear: {dim: true},
};

// ---- active theme / background ------------------------------------------------

interface Resolved {
	colors: Record<Token, StyleDef>;
	bgs: Record<Bg, string>;
}

let activeDef: ThemeDef = BUILTIN_THEMES[0];
let active: Resolved = resolveTheme(BUILTIN_THEMES[0]);
let paletteBg = BUILTIN_THEMES[0].palette.bg;
let paletteBright = BUILTIN_THEMES[0].palette.bright;
let backgroundMode: Settings['background'] = 'pattern';
/** Theme id 'auto' resolves to — set once at startup by the OSC 11 probe. */
let autoDetected = 'devin';

export function setAutoDetected(id: string): void {
	autoDetected = id;
}

export function setTheme(def: ThemeDef): void {
	activeDef = def;
	active = resolveTheme(def);
	paletteBg = def.palette.bg;
	paletteBright = def.palette.bright;
}

/** Resolve a settings theme id to a ThemeDef and activate it: 'auto' →
 *  the OSC 11 detection result; built-ins and `<configdir>/themes/*.json`
 *  custom themes by id; unknown ids fall back to 'devin'. */
export function applyThemeId(id: string, custom: ThemeDef[]): void {
	if (id === 'auto') {
		setTheme(builtinTheme(autoDetected) ?? BUILTIN_THEMES[0]);
		return;
	}
	setTheme(themeById(id, custom) ?? BUILTIN_THEMES[0]);
}

export function setBackground(mode: Settings['background']): void {
	backgroundMode = mode;
}

/** Hex fg of a token in the active theme (picker gradients, swatches). */
export function fgHex(token: Token): string | undefined {
	return TRUECOLOR ? active.colors[token]?.fg : undefined;
}

/** Per-row screen background: 'solid' is the palette bg; 'transparent'
 *  omits it; 'gradient'/'pattern' lift the top rows to
 *  mix(bg, bright, 0.022) and ease down (smoothstep) to exactly bg at
 *  60% of the screen height. */
export function screenBg(row: number, rows: number): string | undefined {
	if (backgroundMode === 'transparent') return undefined;
	const bg = paletteBg;
	if (backgroundMode === 'solid') return bg;
	const t = Math.max(0, Math.min(1, 1 - row / Math.max(1, rows * 0.6)));
	if (t <= 0) return bg;
	const eased = t * t * (3 - 2 * t);
	return mix(bg, paletteBright, 0.022 * eased);
}

/** Ink <Text> props for a token + optional region background override;
 *  `hex` replaces the fg under truecolor only (gradient cells). `rowBg`
 *  is this row's `screenBg` — used wherever the resolved bg is 'bg' so
 *  gradients and transparency apply to padSegs fills automatically. */
export function segStyle(
	t: Token | undefined,
	bg?: Bg,
	hex?: string,
	rowBg?: string,
): {
	color?: string;
	backgroundColor?: string;
	bold?: boolean;
	dimColor?: boolean;
	italic?: boolean;
	inverse?: boolean;
} {
	const d = (TRUECOLOR ? active.colors : MONO)[t ?? 'plain'];
	const out: {
		color?: string;
		backgroundColor?: string;
		bold?: boolean;
		dimColor?: boolean;
		italic?: boolean;
		inverse?: boolean;
	} = {};
	if (TRUECOLOR) {
		if (d.fg) out.color = d.fg;
		if (hex) out.color = hex;
		const b = bg ?? d.bg;
		if (b === 'bg') {
			if (rowBg) out.backgroundColor = rowBg;
		} else if (b) {
			out.backgroundColor = active.bgs[b];
		}
	} else {
		if (d.ansi) out.color = d.ansi;
		if (d.ansiBg) out.backgroundColor = d.ansiBg;
		// picker selected row falls back to inverse
		if (bg === 'pkSel') out.inverse = true;
	}
	if (d.bold) out.bold = true;
	if (d.dim) out.dimColor = true;
	if (d.italic) out.italic = true;
	if (d.inverse) out.inverse = true;
	return out;
}

export const VERSION = 'v0.3.2';

export const BRAILLE_LOGO = [
	'⠀⣴⣾⣶⡄⠀⠀⠀⠀',
	'⠀⠛⠿⠟⠻⣶⣾⣶⡄',
	'⠀⣤⣶⣦⣴⠿⢿⠿⠃',
	'⠀⠻⢿⠿⠃⠀⠀⠀⠀',
];

const BIT_LEFT = [0x01, 0x02, 0x04, 0x40];
const BIT_RIGHT = [0x08, 0x10, 0x20, 0x80];

function brailleDot(ch: string | undefined, x: number, y: number): boolean {
	if (!ch) return false;
	const cp = (ch.codePointAt(0) ?? 0) - 0x2800;
	const bit = (x % 2 === 0 ? BIT_LEFT : BIT_RIGHT)[y % 4];
	return (cp & bit) !== 0;
}

/** Decode each braille char to a 2×4 dot grid, nearest-neighbor 2×, re-encode. */
export function scaleBraille2x(rows: string[]): string[] {
	const chars = rows.map(r => [...r]);
	const W = Math.max(...chars.map(r => r.length));
	const H = chars.length;
	const src = (dx: number, dy: number) =>
		brailleDot(chars[Math.floor(dy / 4)]?.[Math.floor(dx / 2)], dx, dy);
	const out: string[] = [];
	for (let cy = 0; cy < H * 2; cy++) {
		let line = '';
		for (let cx = 0; cx < W * 2; cx++) {
			let bits = 0;
			for (let dx = 0; dx < 2; dx++) {
				for (let dy = 0; dy < 4; dy++) {
					const ox = cx * 2 + dx;
					const oy = cy * 4 + dy;
					// nearest neighbor: each output dot maps to half its position
					if (src(Math.floor(ox / 2), Math.floor(oy / 2))) {
						bits |= (dx === 0 ? BIT_LEFT : BIT_RIGHT)[dy];
					}
				}
			}
			line += String.fromCodePoint(0x2800 + bits);
		}
		out.push(line);
	}
	return out;
}

export const LOGO_2X = scaleBraille2x(BRAILLE_LOGO);

export const SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';

export const TOOL_GLYPHS: Record<string, string> = {
	read: '◇',
	edit: '✎',
	delete: '⌫',
	move: '⇄',
	search: '⌕',
	execute: '$',
	think: '∴',
	fetch: '⇣',
	switch_mode: '⇄',
	other: '·',
};

/** Kind labels for tool calls whose title doesn't start with a Capitalized verb. */
export const TOOL_LABELS: Record<string, string> = {
	read: 'Read',
	edit: 'Edit',
	delete: 'Delete',
	move: 'Move',
	search: 'Search',
	execute: 'Run',
	think: 'Think',
	fetch: 'Fetch',
	switch_mode: 'Switch',
	other: 'Tool',
};

export const PLACEHOLDER =
	'Ask Devin to build features, fix bugs, or work on your code';

export interface Tip {
	key: string;
	text: string;
}

export const TIPS: Tip[] = [
	{key: 'ctrl+p', text: 'opens the command panel'},
	{key: '/', text: 'shows slash commands'},
	{key: 'shift+tab', text: 'cycles agent modes'},
	{key: 'esc', text: 'cancels the running turn'},
	{key: '/help', text: 'lists every command and key'},
	{key: 'ctrl+b', text: 'toggles the plan block'},
];
