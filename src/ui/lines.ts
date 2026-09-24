import type {Bg, Token} from '../theme.js';

/**
 * A styled segment of a single terminal line. All transcript/UI content is
 * flattened to Seg[] lines so we control wrapping and scrolling ourselves.
 * `k` is a theme token; `bg` optionally overrides the region background.
 */
export interface Seg {
	t: string;
	k?: Token;
	bg?: Bg;
}

export const seg = (t: string, k?: Token, bg?: Bg): Seg => ({t, k, bg});

/** Display width of a code point (0 = combining/control, 2 = wide). */
export function cpWidth(cp: number): number {
	if (cp === 0) return 0;
	if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
	// combining marks, variation selectors, zero-width
	if (
		(cp >= 0x0300 && cp <= 0x036f) ||
		(cp >= 0x1ab0 && cp <= 0x1aff) ||
		(cp >= 0x1dc0 && cp <= 0x1dff) ||
		(cp >= 0x20d0 && cp <= 0x20ff) ||
		(cp >= 0xfe00 && cp <= 0xfe0f) ||
		(cp >= 0xfe20 && cp <= 0xfe2f) ||
		(cp >= 0x200b && cp <= 0x200f) ||
		cp === 0xfeff
	) {
		return 0;
	}
	// East Asian wide & fullwidth, emoji
	if (
		(cp >= 0x1100 && cp <= 0x115f) ||
		(cp >= 0x2e80 && cp <= 0xa4cf) ||
		(cp >= 0xac00 && cp <= 0xd7a3) ||
		(cp >= 0xf900 && cp <= 0xfaff) ||
		(cp >= 0xfe30 && cp <= 0xfe6f) ||
		(cp >= 0xff00 && cp <= 0xff60) ||
		(cp >= 0xffe0 && cp <= 0xffe6) ||
		(cp >= 0x1f300 && cp <= 0x1faff) ||
		(cp >= 0x20000 && cp <= 0x3fffd)
	) {
		return 2;
	}
	return 1;
}

export function strWidth(s: string): number {
	let w = 0;
	for (const ch of s) w += cpWidth(ch.codePointAt(0) ?? 0);
	return w;
}

export function segsWidth(segs: Seg[]): number {
	return segs.reduce((w, s) => w + strWidth(s.t), 0);
}

interface Unit {
	ch: string;
	k?: Token;
	bg?: Bg;
	w: number;
}

function toUnits(segs: Seg[]): Unit[] {
	const units: Unit[] = [];
	for (const s of segs) {
		for (const ch of s.t) {
			units.push({ch, k: s.k, bg: s.bg, w: cpWidth(ch.codePointAt(0) ?? 0)});
		}
	}
	return units;
}

function unitsToSegs(units: Unit[]): Seg[] {
	const out: Seg[] = [];
	for (const u of units) {
		const last = out[out.length - 1];
		if (last && last.k === u.k && last.bg === u.bg) last.t += u.ch;
		else out.push({t: u.ch, k: u.k, bg: u.bg});
	}
	return out;
}

/**
 * Greedy word-wrap of styled segments to `width`. Words longer than the width
 * are hard-broken. Returns at least one (possibly empty) line.
 */
export function wrapSegs(segs: Seg[], width: number): Seg[][] {
	if (width <= 0) return [[]];
	const units = toUnits(segs);
	const lines: Unit[][] = [];
	let cur: Unit[] = [];
	let curW = 0;
	let i = 0;
	while (i < units.length) {
		const u = units[i];
		if (u.ch === ' ') {
			if (curW + 1 > width) {
				lines.push(cur);
				cur = [];
				curW = 0;
			} else if (cur.length > 0) {
				cur.push(u);
				curW += 1;
			}
			i++;
			continue;
		}
		let j = i;
		const word: Unit[] = [];
		while (j < units.length && units[j].ch !== ' ') {
			word.push(units[j]);
			j++;
		}
		const wordW = word.reduce((w, x) => w + x.w, 0);
		if (curW + wordW <= width) {
			cur.push(...word);
			curW += wordW;
		} else if (wordW <= width) {
			lines.push(cur);
			cur = [...word];
			curW = wordW;
		} else {
			// word longer than a line: hard-break it
			for (const wu of word) {
				if (curW + wu.w > width) {
					lines.push(cur);
					cur = [];
					curW = 0;
				}
				cur.push(wu);
				curW += wu.w;
			}
		}
		i = j;
	}
	if (cur.length > 0 || lines.length === 0) lines.push(cur);
	// strip trailing spaces
	return lines.map(l => {
		while (l.length && l[l.length - 1].ch === ' ') l.pop();
		return unitsToSegs(l);
	});
}

/** Truncate a segment list to a single line of at most `width` columns. */
export function truncSegs(segs: Seg[], width: number): Seg[] {
	const units = toUnits(segs);
	const out: Unit[] = [];
	let w = 0;
	for (const u of units) {
		if (w + u.w > width) break;
		out.push(u);
		w += u.w;
	}
	return unitsToSegs(out);
}

/** Take `width` columns starting at column `start` (pads short lines). */
export function sliceSegs(
	segs: Seg[],
	start: number,
	width: number,
	bg: Bg = 'bg',
): Seg[] {
	const units = toUnits(segs);
	const out: Unit[] = [];
	let x = 0;
	for (const u of units) {
		if (x >= start + width) break;
		if (x + u.w > start) {
			if (x < start) out.push({ch: ' ', w: 1});
			else out.push(u);
		}
		x += u.w;
	}
	return padSegs(unitsToSegs(out), width, bg);
}

/** Pad a line to exactly `width` with spaces painted `bg`. */
export function padSegs(segs: Seg[], width: number, bg: Bg = 'bg'): Seg[] {
	const w = segsWidth(segs);
	if (w >= width) return truncSegs(segs, width);
	return [...segs, seg(' '.repeat(width - w), 'plain', bg)];
}

/** Blank line padded to `width` on `bg`. */
export function blankLine(width: number, bg: Bg = 'bg'): Seg[] {
	return [seg(' '.repeat(width), 'plain', bg)];
}

/** Concatenate two segment runs onto one line. */
export function joinSegs(a: Seg[], b: Seg[]): Seg[] {
	return [...a, ...b];
}
