/**
 * Replays a raw PTY capture (ANSI stream) and prints the resulting screen.
 *
 *   npx tsx scripts/snapshot.ts <rawfile> [--after <marker>] [--cols N] [--rows N] [--json]
 *
 * --json emits the final frame as rows of cells
 *   {ch, fg, bg, bold, dim, italic, inverse}  (fg/bg are "#rrggbb" or null)
 * so scripts/render-png.py can paint it. Processing stops when the alternate
 * screen is exited (\x1b[?1049l), so the dump shows the last painted frame.
 */
import fs from 'node:fs';
import {cpWidth} from '../src/ui/lines.js';

const args = process.argv.slice(2);
const file = args[0];
if (!file) {
	console.error('usage: snapshot.ts <rawfile> [--after <m>] [--cols N] [--rows N] [--json]');
	process.exit(1);
}
const opt = (name: string, dflt: number) => {
	const i = args.indexOf(name);
	return i >= 0 ? Number(args[i + 1]) : dflt;
};
const JSON_OUT = args.includes('--json');
const COLS = opt('--cols', 120);
const ROWS = opt('--rows', 36);

const raw = fs.readFileSync(file);

// --after <text>: dump the first *complete* frame that contains the marker —
// i.e. process up to the end of the next synchronized update (\x1b[?2026l)
// that follows the marker's first appearance.
let at = opt('--at', Infinity);
const afterIdx = args.indexOf('--after');
const afterLastIdx = args.indexOf('--after-last');
const beforeIdx = args.indexOf('--before');
const markerArg =
	afterLastIdx >= 0 ? afterLastIdx : beforeIdx >= 0 ? beforeIdx : afterIdx;
if (markerArg >= 0) {
	const marker = Buffer.from(args[markerArg + 1], 'utf8');
	const pos =
		afterLastIdx >= 0 ? raw.lastIndexOf(marker) : raw.indexOf(marker);
	if (pos === -1) {
		console.error(`marker not found: ${args[markerArg + 1]}`);
		process.exit(1);
	}
	if (beforeIdx >= 0) {
		// last complete frame before the marker's sync block starts
		const syncBegin = raw.lastIndexOf('\x1b[?2026h', pos);
		at = syncBegin === -1 ? pos : syncBegin;
	} else {
		const syncEnd = raw.indexOf('\x1b[?2026l', pos);
		at = syncEnd === -1 ? raw.length : syncEnd + '\x1b[?2026l'.length;
	}
}

const data = raw.subarray(0, Math.min(at === Infinity ? raw.length : at, raw.length));
const text = new TextDecoder('utf-8').decode(data);

interface Attrs {
	fg: string | null;
	bg: string | null;
	bold: boolean;
	dim: boolean;
	italic: boolean;
	inverse: boolean;
}
interface Cell extends Attrs {
	ch: string;
}
const blankCell = (): Cell => ({
	ch: ' ',
	fg: null,
	bg: null,
	bold: false,
	dim: false,
	italic: false,
	inverse: false,
});

const grid: Cell[][] = Array.from({length: ROWS}, () =>
	Array.from({length: COLS}, blankCell),
);
const cur: Attrs = {fg: null, bg: null, bold: false, dim: false, italic: false, inverse: false};
let row = 0;
let col = 0;
let savedRow = 0;
let savedCol = 0;
let stopped = false;

function scrollUp(n: number): void {
	for (let i = 0; i < n; i++) {
		grid.shift();
		grid.push(Array.from({length: COLS}, blankCell));
	}
	row = Math.max(0, row - n);
}

function clearScreen(): void {
	for (let r = 0; r < ROWS; r++) grid[r] = Array.from({length: COLS}, blankCell);
	row = 0;
	col = 0;
}

function putChar(ch: string, w: number): void {
	if (w === 0) return;
	if (col >= COLS) {
		col = 0;
		row++;
	}
	if (row >= ROWS) scrollUp(row - ROWS + 1);
	if (w === 2 && col === COLS - 1) {
		grid[row][col] = {ch: ' ', ...cur};
		col = 0;
		row++;
		if (row >= ROWS) scrollUp(1);
	}
	grid[row][col] = {ch, ...cur};
	if (w === 2) grid[row][col + 1] = {ch: '', ...cur};
	col += w;
}

/** Apply one SGR parameter list to `cur`. */
function sgr(nums: number[], rawParams: string): void {
	const p = rawParams.replace(/^[?>=!]/, '').split(';');
	if (p.length === 0 || (p.length === 1 && p[0] === '')) {
		Object.assign(cur, {fg: null, bg: null, bold: false, dim: false, italic: false, inverse: false});
		return;
	}
	for (let k = 0; k < nums.length; k++) {
		const n = nums[k];
		if (n === 0) Object.assign(cur, {fg: null, bg: null, bold: false, dim: false, italic: false, inverse: false});
		else if (n === 1) cur.bold = true;
		else if (n === 2) cur.dim = true;
		else if (n === 3) cur.italic = true;
		else if (n === 7) cur.inverse = true;
		else if (n === 22) { cur.bold = false; cur.dim = false; }
		else if (n === 23) cur.italic = false;
		else if (n === 27) cur.inverse = false;
		else if (n === 39) cur.fg = null;
		else if (n === 49) cur.bg = null;
		else if (n === 38 || n === 48) {
			// extended color: 38;2;r;g;b (truecolor) or 38;5;n (256)
			const target = n === 38 ? 'fg' : 'bg';
			if (nums[k + 1] === 2 && nums[k + 4] !== undefined) {
				const hex = [nums[k + 2], nums[k + 3], nums[k + 4]]
					.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'))
					.join('');
				cur[target] = `#${hex}`;
				k += 4;
			} else if (nums[k + 1] === 5 && nums[k + 2] !== undefined) {
				cur[target] = ansi256(nums[k + 2]);
				k += 2;
			}
		} else if (n >= 30 && n <= 37) cur.fg = ansi16(n - 30);
		else if (n >= 40 && n <= 47) cur.bg = ansi16(n - 40);
		else if (n >= 90 && n <= 97) cur.fg = ansi16(n - 90, true);
		else if (n >= 100 && n <= 107) cur.bg = ansi16(n - 100, true);
	}
}

function ansi16(n: number, bright = false): string {
	const base = [
		'#000000', '#800000', '#008000', '#808000',
		'#000080', '#800080', '#008080', '#c0c0c0',
	][n & 7];
	if (!bright) return base;
	const b = ['#808080', '#ff0000', '#00ff00', '#ffff00',
		'#0000ff', '#ff00ff', '#00ffff', '#ffffff'][n & 7];
	return b;
}

function ansi256(n: number): string {
	if (n < 16) return ansi16(n & 7, n >= 8);
	if (n >= 232) {
		const v = 8 + (n - 232) * 10;
		return `#${v.toString(16).padStart(2, '0').repeat(3)}`;
	}
	const idx = n - 16;
	const r = Math.floor(idx / 36), g = Math.floor((idx % 36) / 6), b = idx % 6;
	const cv = (x: number) => (x === 0 ? 0 : 55 + x * 40);
	const hex = [cv(r), cv(g), cv(b)]
		.map(v => v.toString(16).padStart(2, '0'))
		.join('');
	return `#${hex}`;
}

let i = 0;
const len = text.length;
while (i < len && !stopped) {
	const ch = text[i];
	if (ch === '\x1b') {
		const next = text[i + 1];
		if (next === '[') {
			// CSI
			let j = i + 2;
			while (j < len && !/[@-~]/.test(text[j])) j++;
			const params = text.slice(i + 2, j);
			const fin = text[j];
			const nums = params
				.replace(/^[?>=!]/, '')
				.split(';')
				.map(s => (s === '' ? 0 : Number(s)));
			const n = (d: number, idx = 0) => (Number.isFinite(nums[idx]) && nums[idx] > 0 ? nums[idx] : d);
			switch (fin) {
				case 'm': sgr(nums, params); break;
				case 'A': row = Math.max(0, row - n(1)); break;
				case 'B': row = Math.min(ROWS - 1, row + n(1)); break;
				case 'C': col = Math.min(COLS - 1, col + n(1)); break;
				case 'D': col = Math.max(0, col - n(1)); break;
				case 'E': row = Math.min(ROWS - 1, row + n(1)); col = 0; break;
				case 'F': row = Math.max(0, row - n(1)); col = 0; break;
				case 'G': case '`': col = Math.min(COLS - 1, n(1) - 1); break;
				case 'H': case 'f':
					row = Math.min(ROWS - 1, Math.max(0, n(1) - 1));
					col = Math.min(COLS - 1, Math.max(0, n(1, 1) - 1));
					break;
				case 'J': {
					const mode = nums[0] ?? 0;
					if (mode === 2 || mode === 3) clearScreen();
					else if (mode === 0) {
						for (let c = col; c < COLS; c++) grid[row][c] = blankCell();
						for (let r = row + 1; r < ROWS; r++) grid[r] = Array.from({length: COLS}, blankCell);
					} else if (mode === 1) {
						for (let r = 0; r < row; r++) grid[r] = Array.from({length: COLS}, blankCell);
						for (let c = 0; c <= col; c++) grid[row][c] = blankCell();
					}
					break;
				}
				case 'K': {
					const mode = nums[0] ?? 0;
					if (mode === 0) for (let c = col; c < COLS; c++) grid[row][c] = blankCell();
					else if (mode === 1) for (let c = 0; c <= col; c++) grid[row][c] = blankCell();
					else if (mode === 2) grid[row] = Array.from({length: COLS}, blankCell);
					break;
				}
				case 'L': {
					for (let k = 0; k < n(1); k++) {
						grid.splice(row, 0, Array.from({length: COLS}, blankCell));
						grid.pop();
					}
					break;
				}
				case 'M': {
					for (let k = 0; k < n(1); k++) {
						grid.splice(row, 1);
						grid.push(Array.from({length: COLS}, blankCell));
					}
					break;
				}
				case 'P': {
					const count = n(1);
					for (let c = col; c < COLS; c++) {
						grid[row][c] = c + count < COLS ? {...grid[row][c + count]} : blankCell();
					}
					break;
				}
				case '@': {
					const count = n(1);
					for (let c = COLS - 1; c >= col; c--) {
						grid[row][c] = c - count >= col ? {...grid[row][c - count]} : blankCell();
					}
					break;
				}
				case 'S': scrollUp(n(1)); break;
				case 'T': {
					for (let k = 0; k < n(1); k++) {
						grid.pop();
						grid.unshift(Array.from({length: COLS}, blankCell));
					}
					break;
				}
				case 's': savedRow = row; savedCol = col; break;
				case 'u': row = savedRow; col = savedCol; break;
				case 'h': case 'l': {
					if (params.includes('1049')) {
						if (fin === 'h') clearScreen();
						else stopped = true; // alt screen exit → dump last frame
					}
					break;
				}
				default: break; // q etc — ignored
			}
			i = j + 1;
			continue;
		}
		if (next === ']') {
			// OSC — consume to BEL or ST
			let j = i + 2;
			while (j < len && text[j] !== '\x07' && !(text[j] === '\x1b' && text[j + 1] === '\\')) j++;
			i = text[j] === '\x1b' ? j + 2 : j + 1;
			continue;
		}
		if (next === '(' || next === ')' || next === '#' || next === '%') {
			i += 3;
			continue;
		}
		// two-char escapes: M (reverse index), E (NEL), 7/8 save/restore, =/> keypad
		if (next === 'M') {
			if (row === 0) {
				grid.pop();
				grid.unshift(Array.from({length: COLS}, blankCell));
			} else row--;
		} else if (next === 'E') {
			row = Math.min(ROWS - 1, row + 1);
			col = 0;
		} else if (next === '7') {
			savedRow = row;
			savedCol = col;
		} else if (next === '8') {
			row = savedRow;
			col = savedCol;
		}
		i += 2;
		continue;
	}
	if (ch === '\r') {
		col = 0;
		i++;
		continue;
	}
	if (ch === '\n' || ch === '\x0b' || ch === '\x0c') {
		row++;
		if (row >= ROWS) scrollUp(row - ROWS + 1);
		i++;
		continue;
	}
	if (ch === '\b') {
		col = Math.max(0, col - 1);
		i++;
		continue;
	}
	if (ch === '\t') {
		col = Math.min(COLS - 1, (Math.floor(col / 8) + 1) * 8);
		i++;
		continue;
	}
	if (ch < ' ' || ch === '\x7f') {
		i++;
		continue;
	}
	putChar(ch, cpWidth(ch.codePointAt(0) ?? 0));
	i++;
}

if (JSON_OUT) {
	console.log(JSON.stringify({cols: COLS, rows: ROWS, cells: grid}));
} else {
	const out = grid.map(r => r.map(c => c.ch).join('').replace(/\s+$/, '')).join('\n');
	console.log(out);
}
