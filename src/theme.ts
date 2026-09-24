/**
 * Central style tokens for the entire UI — the ONLY place styling is defined.
 *
 * Grayscale palette (Devin brand is black & white): depth comes from gray
 * background shades, never hue. If the terminal lacks truecolor
 * (COLORTERM not truecolor/24bit) all colors drop to attribute-only
 * equivalents (bold/dim/inverse). Hue is allowed only for the picker
 * palette, success/fail dots and diff +/- lines, $ command highlighting,
 * and the bypass-mode tag.
 */

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

export const BG_HEX: Record<Bg, string> = {
	bg: '#0a0a0a', // whole screen
	panel: '#141414', // input panel, user messages
	overlay: '#1a1a1a', // popups
	raised: '#202020', // inline code, inactive-selected
	sel: '#e8e8e8', // selection row background
	// picker palette — the ONE allowed hue exception (Devin CLI /model picker)
	pkSel: '#1c2530', // selected model row
	pkBlue: '#4db8ff', // FREE badge background
	// diff line backgrounds (CLI-matching hue exception)
	diffAdd: '#12261a', // + lines
	diffDel: '#2a1414', // − lines
};

export type Token =
	| 'plain' // default terminal fg
	| 'text' // #d4d4d4 — body text
	| 'bright' // #ffffff — values, key names
	| 'muted' // #7a7a7a — labels
	| 'faint' // #4a4a4a — lowest-emphasis text
	| 'rule' // #2a2a2a — separators │ ─
	| 'accent' // bright + bold — mode name
	| 'title' // bright + bold — headings, section titles
	| 'strong' // bright + bold — **markdown bold**
	| 'sel' // selection row (bg #e8e8e8 / fg #0a0a0a)
	| 'code' // `inline code` — bright on raised
	| 'err' // #e06c6c — failures, ✗, −M stats, failed text
	| 'ok' // #3ddc84 — ✓, completed dots, +N stats
	| 'cmdFlag' // #6cb6ff — -flags in $ command lines
	| 'cmdString' // #e5a07a — "quoted strings" in $ command lines
	| 'thought' // muted italic — thinking
	| 'ghost' // faint — detail/thought tail
	| 'caret' // block cursor
	| 'spin' // muted spinner
	// picker palette (blue accent — allowed hue exception for /model)
	| 'pk' // #4db8ff — selected name, chevron, filled bars, effort label
	| 'pkBold' // #4db8ff + bold — selected inline-permission row
	| 'pkDim' // blue, dim — ← → arrows
	| 'pkOff' // #3a3a3a — unfilled bars
	| 'pkGreen' // #3ddc84 — reserved: "New" badge
	| 'pkYellow' // #e6d17a — reserved: "Beta" badge
	| 'pkBadge' // reserved: FREE badge (#0a0a0a on #4db8ff)
	// composer frame bezel + working shimmer
	| 'bezelHi' // #6a6a6a — top/left edge + ╭
	| 'bezelMid' // #4a4a4a — ╮ ╰ mixed corners
	| 'bezelLo' // #2e2e2e — bottom/right edge + ╯
	| 'shine1' // #ffffff — shimmer band head
	| 'shine2' // #cfcfcf — shimmer band mid
	| 'shine3'; // #9a9a9a — shimmer band tail

interface StyleDef {
	fg?: string;
	bg?: Bg;
	ansi?: string; // ANSI color keyword used in the non-truecolor fallback
	ansiBg?: string;
	bold?: boolean;
	dim?: boolean;
	italic?: boolean;
	inverse?: boolean;
}

const COLOR: Record<Token, StyleDef> = {
	plain: {},
	text: {fg: '#d4d4d4'},
	bright: {fg: '#ffffff'},
	muted: {fg: '#7a7a7a'},
	faint: {fg: '#4a4a4a'},
	rule: {fg: '#2a2a2a'},
	accent: {fg: '#ffffff', bold: true},
	title: {fg: '#ffffff', bold: true},
	strong: {fg: '#ffffff', bold: true},
	sel: {fg: '#0a0a0a', bg: 'sel'},
	code: {fg: '#ffffff', bg: 'raised'},
	err: {fg: '#e06c6c'},
	ok: {fg: '#3ddc84'},
	cmdFlag: {fg: '#6cb6ff'},
	cmdString: {fg: '#e5a07a'},
	thought: {fg: '#7a7a7a', italic: true},
	ghost: {fg: '#4a4a4a'},
	caret: {fg: '#0a0a0a', bg: 'sel'},
	spin: {fg: '#7a7a7a'},
	pk: {fg: '#4db8ff'},
	pkBold: {fg: '#4db8ff', bold: true},
	pkDim: {fg: '#4db8ff', dim: true},
	pkOff: {fg: '#3a3a3a'},
	pkGreen: {fg: '#3ddc84'},
	pkYellow: {fg: '#e6d17a'},
	pkBadge: {fg: '#0a0a0a', bg: 'pkBlue'},
	bezelHi: {fg: '#6a6a6a'},
	bezelMid: {fg: '#4a4a4a'},
	bezelLo: {fg: '#2e2e2e'},
	shine1: {fg: '#ffffff'},
	shine2: {fg: '#cfcfcf'},
	shine3: {fg: '#9a9a9a'},
};

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
	pkBadge: {ansi: 'black', ansiBg: 'blueBright'},
	bezelHi: {dim: true},
	bezelMid: {dim: true},
	bezelLo: {dim: true},
	shine1: {bold: true},
	shine2: {},
	shine3: {},
};

/** Ink <Text> props for a token + optional region background override. */
export function segStyle(
	t: Token | undefined,
	bg?: Bg,
): {
	color?: string;
	backgroundColor?: string;
	bold?: boolean;
	dimColor?: boolean;
	italic?: boolean;
	inverse?: boolean;
} {
	const d = (TRUECOLOR ? COLOR : MONO)[t ?? 'plain'];
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
		const b = bg ?? d.bg;
		if (b) out.backgroundColor = BG_HEX[b];
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

export const VERSION = 'v0.1.0';

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
	{key: 'pgup', text: 'scrolls the transcript'},
	{key: 'ctrl+b', text: 'toggles the plan block'},
];
