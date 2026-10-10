/** xterm mouse reporting (button events + SGR encoding) — the terminal
 *  then sends wheel notches as `ESC[<64;x;yM` / `ESC[<65;x;yM` instead of
 *  turning them into ↑/↓ keys. Native drag-selection needs a modifier
 *  (Shift on Linux terminals, Option in iTerm2) while it is on. */
import {effectiveSettings} from './settings.js';

export const MOUSE_ON = '\x1b[?1000h\x1b[?1006h';
export const MOUSE_OFF = '\x1b[?1006l\x1b[?1000l';

export type MouseEvent =
	| {kind: 'wheel'; dir: 'up' | 'down'}
	| /** 0-based coordinates */
	{kind: 'click'; x: number; y: number};

/** The startup mouse default — the persisted `mouse` setting with the
 *  `DEVIN_TUI_NO_MOUSE=1` env override on top. */
export function mouseDefault(): boolean {
	return effectiveSettings().mouse;
}

export function setMouseReporting(on: boolean): void {
	process.stdout.write(on ? MOUSE_ON : MOUSE_OFF);
}

/** SGR mouse report `ESC [ < b ; x ; y M/m` as seen by Ink's useInput
 *  (the leading ESC may already be stripped). Returns a MouseEvent —
 *  wheel notches and button-0 presses (click, 0-based coords) — `null`
 *  for releases, motion and other buttons, or `undefined` when the
 *  input is not a mouse report at all. */
export function parseMouse(input: string): MouseEvent | null | undefined {
	const m = /^\x1b?\[<(\d+);(\d+);(\d+)([Mm])$/.exec(input);
	if (!m) return undefined;
	const b = Number(m[1]) & ~(4 | 8 | 16);
	if (b === 64) return {kind: 'wheel', dir: 'up'};
	if (b === 65) return {kind: 'wheel', dir: 'down'};
	// releases ('m'), motion (32+), drag and non-left buttons → swallowed
	if (m[4] === 'm' || (b & 32) !== 0 || (b & 3) !== 0) return null;
	return {kind: 'click', x: Math.max(0, Number(m[2]) - 1), y: Math.max(0, Number(m[3]) - 1)};
}
