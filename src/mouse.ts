/** xterm mouse reporting (button events + SGR encoding) — the terminal
 *  then sends wheel notches as `ESC[<64;x;yM` / `ESC[<65;x;yM` instead of
 *  turning them into ↑/↓ keys. Native drag-selection needs a modifier
 *  (Shift on Linux terminals, Option in iTerm2) while it is on. */
export const MOUSE_ON = '\x1b[?1000h\x1b[?1006h';
export const MOUSE_OFF = '\x1b[?1006l\x1b[?1000l';

/** On unless `DEVIN_TUI_NO_MOUSE=1`. */
export function mouseDefault(): boolean {
	return process.env.DEVIN_TUI_NO_MOUSE !== '1';
}

export function setMouseReporting(on: boolean): void {
	process.stdout.write(on ? MOUSE_ON : MOUSE_OFF);
}

/** SGR mouse report as seen by Ink's useInput (leading ESC stripped).
 *  Returns the wheel direction, `null` for any other mouse event, or
 *  `undefined` when the input is not a mouse report at all. */
export function parseMouse(input: string): 'up' | 'down' | null | undefined {
	const m = /^\x1b?\[<(\d+);\d+;\d+[Mm]$/.exec(input);
	if (!m) return undefined;
	const b = Number(m[1]) & ~(4 | 8 | 16);
	if (b === 64) return 'up';
	if (b === 65) return 'down';
	return null;
}
