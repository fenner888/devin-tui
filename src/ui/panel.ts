import {
	type Seg,
	seg,
	padSegs,
	segsWidth,
	strWidth,
	truncSegs,
} from './lines.js';
import os from 'node:os';
import {cursorLine, visualLines} from '../composer.js';
import {PLACEHOLDER, type Token} from '../theme.js';

/** Collapse the user's home directory to `~`. */
export function shortCwd(cwd: string): string {
	const home = os.homedir();
	return cwd === home ? '~' : cwd.startsWith(home + '/') ? `~${cwd.slice(home.length)}` : cwd;
}

export interface PanelMeta {
	/** session established — shows the real mode; otherwise `connecting…` */
	ready: boolean;
	mode?: string;
	modeId?: string; // 'bypass' renders the tag in yellow
	model?: string; // omitted from the meta row when undefined
	cwd: string; // already ~-collapsed
	working?: boolean; // drives the frame's shimmer band + guide placeholder
}

// ---- composer frame -------------------------------------------------------

const MAX_INPUT_ROWS = 8; // input area grows to 8 lines, scrolls beyond
const BAND = 10; // shimmer band length in perimeter cells

/**
 * Perimeter border colors for an w×h frame: bezel base (top/left/╭ =
 * bezelHi, bottom/right/╯ = bezelLo, ╮/╰ = bezelMid), with a 10-cell
 * shimmer band travelling clockwise when `active` — head 2 shine1,
 * then 3 shine2, then 5 shine3; advances 3 cells per tick. Returns
 * grid[y][x] → token (null for interior cells).
 */
export function frameColors(
	w: number,
	h: number,
	tick: number,
	active: boolean,
): (Token | null)[][] {
	const grid: (Token | null)[][] = Array.from({length: h}, () =>
		Array<Token | null>(w).fill(null),
	);
	// clockwise traversal: top L→R, right T→B, bottom R→L, left B→T
	const perim: {x: number; y: number; base: Token}[] = [];
	for (let x = 0; x < w; x++)
		perim.push({x, y: 0, base: x === w - 1 ? 'bezelMid' : 'bezelHi'});
	for (let y = 1; y < h; y++) perim.push({x: w - 1, y, base: 'bezelLo'});
	for (let x = w - 2; x >= 0; x--)
		perim.push({x, y: h - 1, base: x === 0 ? 'bezelMid' : 'bezelLo'});
	for (let y = h - 2; y >= 1; y--) perim.push({x: 0, y, base: 'bezelHi'});
	for (const c of perim) grid[c.y][c.x] = c.base;
	if (active && perim.length > 0) {
		const head = (tick * 3) % perim.length;
		for (let i = 0; i < BAND && i < perim.length; i++) {
			const c = perim[(head - i + perim.length) % perim.length];
			grid[c.y][c.x] = i < 2 ? 'shine1' : i < 5 ? 'shine2' : 'shine3';
		}
	}
	return grid;
}

/**
 * The shared input panel: a rounded bezel frame (╭─╮/│/╰─╯) on the screen
 * bg around `panel`-bg content — pad row, attachment chips row (when any),
 * input rows (`❯` + text or placeholder + caret; up to 8 visible lines,
 * scrolling internally beyond), blank row, meta row. A shimmer band runs
 * the perimeter while the agent works. `w` is the full frame width.
 */
export function inputPanel(
	w: number,
	value: string,
	cursor: number,
	tick: number,
	meta: PanelMeta,
	chips: {icon: string; label: string}[] = [],
): Seg[][] {
	const innerW = w - 4; // '│ ' + content + ' │'
	const room = innerW - 2; // after '❯ '
	const vls = visualLines(value, room);
	const vcur = cursorLine(vls, cursor);
	const nVis = Math.min(MAX_INPUT_ROWS, vls.length);
	// keep the cursor's row inside the visible window
	const top = Math.min(
		Math.max(0, vcur - nVis + 1),
		Math.max(0, vls.length - nVis),
	);
	const h = 6 + nVis + (chips.length > 0 ? 1 : 0);
	const grid = frameColors(w, h, tick, meta.working ?? false);

	const borderRow = (r: number): Seg[] => {
		const row: Seg[] = [];
		for (let x = 0; x < w; x++) {
			const ch =
				r === 0
					? x === 0
						? '╭'
						: x === w - 1
							? '╮'
							: '─'
					: x === 0
						? '╰'
						: x === w - 1
							? '╯'
							: '─';
			row.push(seg(ch, grid[r][x] ?? 'bezelHi', 'bg'));
		}
		// mode tag on the top border, right-aligned with 2 border cells
		// after it — the shimmer band only recolors border cells, so the
		// tag text keeps its color as the band passes
		if (r === 0 && meta.ready && meta.mode) {
			const bypass = meta.modeId === 'bypass';
			const tag = bypass ? ' bypass permissions on ' : ` ${meta.mode} `;
			const tok = bypass ? 'pkYellow' : 'muted';
			const start = Math.max(1, w - 2 - tag.length);
			for (let i = 0; i < tag.length && start + i < w - 2; i++) {
				row[start + i] = seg(tag[i], tok, 'bg');
			}
		}
		return row;
	};

	const innerRow = (r: number, segs: Seg[]): Seg[] => [
		seg('│', grid[r][0] ?? 'bezelHi', 'bg'),
		seg(' ', 'plain', 'panel'),
		...padSegs(segs, innerW, 'panel'),
		seg(' ', 'plain', 'panel'),
		seg('│', grid[r][w - 1] ?? 'bezelLo', 'bg'),
	];

	// input rows: '❯ ' on the first visual line, '  ' continuation after;
	// the cursor cell renders as an inverse block
	const cursorOn = tick % 12 < 7;
	const inputRows: Seg[][] = [];
	vls.slice(top, top + nVis).forEach((vl, i) => {
		const gi = top + i;
		const text = value.slice(vl.start, vl.start + vl.len);
		if (value.length === 0) {
			inputRows.push([
				seg('❯ ', 'bright', 'panel'),
				cursorOn ? seg(' ', 'caret', 'sel') : seg(' ', 'plain', 'panel'),
				seg(
					meta.working ? 'Guide Devin while it works' : PLACEHOLDER,
					'muted',
					'panel',
				),
			]);
			return;
		}
		const row: Seg[] = [
			seg(gi === 0 ? '❯ ' : '  ', gi === 0 ? 'bright' : 'muted', 'panel'),
		];
		if (gi === vcur) {
			const col = cursor - vl.start;
			const at = text[col] ?? ' ';
			row.push(
				seg(text.slice(0, col), 'text', 'panel'),
				cursorOn ? seg(at, 'caret', 'sel') : seg(at, 'text', 'panel'),
				seg(text.slice(col + 1), 'text', 'panel'),
			);
		} else {
			row.push(seg(text, 'text', 'panel'));
		}
		inputRows.push(row);
	});

	// meta row content: <mode|connecting…> · <model?> · <cwd>
	const metaSegs: Seg[] = [
		seg(
			meta.ready ? (meta.mode ?? 'default') : 'connecting…',
			meta.ready ? 'accent' : 'muted',
			'panel',
		),
	];
	if (meta.model) {
		metaSegs.push(
			seg(' · ', 'muted', 'panel'),
			seg(meta.model, 'text', 'panel'),
		);
	}
	metaSegs.push(seg(' · ', 'muted', 'panel'), seg(meta.cwd, 'muted', 'panel'));

	const rows: Seg[][] = [];
	let r = 0;
	rows.push(borderRow(r++));
	rows.push(innerRow(r++, []));
	if (chips.length > 0) {
		const chipSegs: Seg[] = [];
		for (const [i, c] of chips.entries()) {
			if (i > 0) chipSegs.push(seg('  ', 'plain', 'panel'));
			chipSegs.push(seg(`${c.icon} `, 'faint', 'panel'), seg(c.label, 'faint', 'panel'));
		}
		rows.push(innerRow(r++, truncSegs(chipSegs, innerW)));
	}
	for (const ir of inputRows) rows.push(innerRow(r++, truncSegs(ir, innerW)));
	rows.push(innerRow(r++, []));
	rows.push(innerRow(r++, truncSegs(metaSegs, innerW)));
	rows.push(innerRow(r++, []));
	rows.push(borderRow(r));
	return rows;
}

/** Right-aligned key hints (keys bright, labels muted). */
export function hintsLine(
	w: number,
	hints: [key: string, label: string][],
): Seg[] {
	const segs: Seg[] = [];
	hints.forEach(([k, l], i) => {
		if (i > 0) segs.push(seg('   '));
		segs.push(seg(k, 'bright'), seg(' ' + l, 'muted'));
	});
	const total = segsWidth(segs);
	return [
		seg(' '.repeat(Math.max(0, w - total))),
		...segs,
	];
}

export {strWidth};
