import {
	type Seg,
	seg,
	padSegs,
	segsWidth,
	strWidth,
	truncSegs,
} from './lines.js';
import os from 'node:os';
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

const FRAME_H = 7;
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
 * bg around `panel`-bg content — pad row, input row (`❯` + text or
 * placeholder + caret), blank row, meta row. A shimmer band runs the
 * perimeter while the agent works. `w` is the full frame width.
 */
export function inputPanel(
	w: number,
	value: string,
	cursor: number,
	tick: number,
	meta: PanelMeta,
): Seg[][] {
	const grid = frameColors(w, FRAME_H, tick, meta.working ?? false);

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

	const innerW = w - 4; // '│ ' + content + ' │'
	const innerRow = (r: number, segs: Seg[]): Seg[] => [
		seg('│', grid[r][0] ?? 'bezelHi', 'bg'),
		seg(' ', 'plain', 'panel'),
		...padSegs(segs, innerW, 'panel'),
		seg(' ', 'plain', 'panel'),
		seg('│', grid[r][w - 1] ?? 'bezelLo', 'bg'),
	];

	// input row content
	const cursorOn = tick % 12 < 7;
	const prefix = seg('❯ ', 'bright', 'panel');
	const room = innerW - 2; // after '❯ '
	let inputSegs: Seg[];
	if (value.length === 0) {
		inputSegs = [
			prefix,
			cursorOn ? seg(' ', 'caret', 'sel') : seg(' ', 'plain', 'panel'),
			seg(
				meta.working ? 'Guide Devin while it works' : PLACEHOLDER,
				'muted',
				'panel',
			),
		];
	} else {
		// scroll horizontally if the input is longer than the panel
		const start = Math.max(0, cursor - room + 1);
		const shown = value.slice(start);
		const shownCursor = cursor - start;
		const at = shown[shownCursor] ?? ' ';
		inputSegs = [
			prefix,
			seg(shown.slice(0, shownCursor), 'text', 'panel'),
			cursorOn ? seg(at, 'caret', 'sel') : seg(at, 'text', 'panel'),
			seg(shown.slice(shownCursor + 1), 'text', 'panel'),
		];
	}

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

	return [
		borderRow(0),
		innerRow(1, []),
		innerRow(2, truncSegs(inputSegs, innerW)),
		innerRow(3, []),
		innerRow(4, truncSegs(metaSegs, innerW)),
		innerRow(5, []),
		borderRow(6),
	];
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
