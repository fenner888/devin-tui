/** xterm mouse reporting (button events + SGR encoding) — the terminal
 *  then sends wheel notches as `ESC[<64;x;yM` / `ESC[<65;x;yM` instead of
 *  turning them into ↑/↓ keys. Native drag-selection needs a modifier
 *  while it is on. */
import {effectiveSettings} from './settings.js';

export const MOUSE_ON = '\x1b[?1000h\x1b[?1006h';
export const MOUSE_OFF = '\x1b[?1006l\x1b[?1000l';

export type MouseEvent =
	| {kind: 'wheel'; dir: 'up' | 'down'}
	| /** Left-button press; 0-based coordinates. */
	{kind: 'click'; x: number; y: number}
	| /** Left-button release; 0-based coordinates. */
	{kind: 'release'; x: number; y: number};

/** The startup mouse default — the persisted `mouse` setting with the
 *  `DEVIN_TUI_NO_MOUSE=1` env override on top. */
export function mouseDefault(): boolean {
	return effectiveSettings().mouse;
}

export function setMouseReporting(on: boolean): void {
	process.stdout.write(on ? MOUSE_ON : MOUSE_OFF);
}

/** SGR mouse report `ESC [ < b ; x ; y M/m` as seen by Ink's useInput
 *  (the leading ESC may already be stripped). Returns wheel notches,
 *  button-0 presses, and button-0 releases (coordinates are 0-based);
 *  `null` for motion and other buttons; `undefined` for non-mouse input. */
export function parseMouse(input: string): MouseEvent | null | undefined {
	const m = /^\x1b?\[<(\d+);(\d+);(\d+)([Mm])$/.exec(input);
	if (!m) return undefined;
	const b = Number(m[1]) & ~(4 | 8 | 16);
	const x = Math.max(0, Number(m[2]) - 1);
	const y = Math.max(0, Number(m[3]) - 1);
	if (m[4] === 'm')
		return (b & 32) === 0 && (b & 3) === 0
			? {kind: 'release', x, y}
			: null;
	if (b === 64) return {kind: 'wheel', dir: 'up'};
	if (b === 65) return {kind: 'wheel', dir: 'down'};
	if ((b & 32) !== 0 || (b & 3) !== 0) return null;
	return {kind: 'click', x, y};
}

export function selectModifier(termProgram = process.env.TERM_PROGRAM): string {
	if (termProgram === 'iTerm.app') return 'option';
	if (termProgram === 'Apple_Terminal') return 'fn';
	return 'shift';
}
