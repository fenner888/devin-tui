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
	/** truecolor fg override (gradient cells — the price slider); `k` stays
	 *  the ANSI fallback and the overlay-dim target */
	hex?: string;
	/** OSC 8 hyperlink target (clickable in supporting terminals) */
	link?: string;
}

export const seg = (t: string, k?: Token, bg?: Bg): Seg => ({t, k, bg});

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g;
const CONTROL_CHAR = /[\x00-\x1f\x7f]/;

function hasExtraClosing(text: string, open: string, close: string): boolean {
	let depth = 0;
	for (const ch of text) {
		if (ch === open) depth++;
		else if (ch === close) depth--;
	}
	return depth < 0;
}

function trimUrlEnd(raw: string): string {
	let end = raw.length;
	while (end > 0) {
		const last = raw[end - 1];
		if (/[.,;:!?]/.test(last)) {
			end--;
			continue;
		}
		const candidate = raw.slice(0, end);
		if (
			(last === ')' && hasExtraClosing(candidate, '(', ')')) ||
			(last === ']' && hasExtraClosing(candidate, '[', ']'))
		) {
			end--;
			continue;
		}
		break;
	}
	return raw.slice(0, end);
}

/** HTTP(S) URL occurrences with prose punctuation and unmatched closers removed. */
export function findHttpUrls(text: string): string[] {
	const urls: string[] = [];
	const re = new RegExp(URL_PATTERN.source, 'g');
	let match: RegExpExecArray | null;
	while ((match = re.exec(text))) {
		if (CONTROL_CHAR.test(match[0])) continue;
		const url = trimUrlEnd(match[0]);
		if (url) urls.push(url);
	}
	return urls;
}

/** Linkify HTTP(S) URL runs while preserving each segment's styling. */
export function linkify(segs: Seg[]): Seg[] {
	const out: Seg[] = [];
	for (const source of segs) {
		if (source.link !== undefined) {
			out.push(source);
			continue;
		}
		const pieces: Seg[] = [];
		const re = new RegExp(URL_PATTERN.source, 'g');
		let last = 0;
		let linked = false;
		let match: RegExpExecArray | null;
		while ((match = re.exec(source.t))) {
			const raw = match[0];
			if (CONTROL_CHAR.test(raw)) continue;
			const url = trimUrlEnd(raw);
			if (!url) continue;
			if (match.index > last) {
				pieces.push({...source, t: source.t.slice(last, match.index)});
			}
			pieces.push({...source, t: url, link: url});
			const trailing = raw.slice(url.length);
			if (trailing) pieces.push({...source, t: trailing});
			last = match.index + raw.length;
			linked = true;
		}
		if (!linked) {
			out.push(source);
			continue;
		}
		if (last < source.t.length) {
			pieces.push({...source, t: source.t.slice(last)});
		}
		out.push(...pieces);
	}
	return out;
}

export interface TextRange {
	start: number;
	end: number;
}

export interface FindMatch extends TextRange {
	row: number;
}

export function findMatches(lines: Seg[][], query: string): FindMatch[] {
	const needle = query.toLowerCase();
	if (!needle) return [];
	const matches: FindMatch[] = [];
	for (const [row, segs] of lines.entries()) {
		const text = segs.map(s => s.t).join('');
		const lower = text.toLowerCase();
		let from = 0;
		while (from <= lower.length - needle.length) {
			const start = lower.indexOf(needle, from);
			if (start < 0) break;
			matches.push({row, start, end: start + needle.length});
			from = start + needle.length;
		}
	}
	return matches;
}

export function highlightRow(
	segs: Seg[],
	ranges: TextRange[],
	currentRange?: TextRange,
): Seg[] {
	const sorted = [...ranges].sort((a, b) => a.start - b.start);
	const out: Seg[] = [];
	let rowOffset = 0;
	for (const source of segs) {
		let local = 0;
		for (const range of sorted) {
			const start = Math.max(0, range.start - rowOffset);
			const end = Math.min(source.t.length, range.end - rowOffset);
			if (end <= local || start >= source.t.length) continue;
			if (start > local) out.push({...source, t: source.t.slice(local, start)});
			const from = Math.max(local, start);
			const current =
				currentRange?.start === range.start &&
				currentRange.end === range.end;
			out.push({
				...source,
				t: source.t.slice(from, end),
				k: current ? 'sel' : 'pk',
				bg: current ? 'sel' : 'pkSel',
			});
			local = end;
		}
		if (local < source.t.length)
			out.push({...source, t: source.t.slice(local)});
		rowOffset += source.t.length;
	}
	return out;
}

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
	hex?: string;
	link?: string;
	w: number;
}

function toUnits(segs: Seg[]): Unit[] {
	const units: Unit[] = [];
	for (const s of segs) {
		for (const ch of s.t) {
			units.push({
				ch,
				k: s.k,
				bg: s.bg,
				hex: s.hex,
				link: s.link,
				w: cpWidth(ch.codePointAt(0) ?? 0),
			});
		}
	}
	return units;
}

function unitsToSegs(units: Unit[]): Seg[] {
	const out: Seg[] = [];
	for (const u of units) {
		const last = out[out.length - 1];
		if (
			last &&
			last.k === u.k &&
			last.bg === u.bg &&
			last.hex === u.hex &&
			last.link === u.link
		) {
			last.t += u.ch;
		} else {
			const s: Seg = {t: u.ch, k: u.k, bg: u.bg};
			if (u.hex) s.hex = u.hex;
			if (u.link) s.link = u.link;
			out.push(s);
		}
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
