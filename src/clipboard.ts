import {spawn} from 'node:child_process';

/** Best-effort copy to the system clipboard: OSC 52 (works over SSH in
 *  iTerm2/kitty/WezTerm/Ghostty/Windows Terminal/tmux) plus the native
 *  tool where one exists (pbcopy on macOS, wl-copy/xclip on Linux). */
export function copyToClipboard(text: string): void {
	try {
		const b64 = Buffer.from(text).toString('base64');
		process.stdout.write(`\x1b]52;c;${b64}\x07`);
	} catch {
		// ignore
	}
	const cmds: [string, string[]][] =
		process.platform === 'darwin'
			? [['pbcopy', []]]
			: process.platform === 'win32'
				? [['clip', []]]
				: [
						['wl-copy', []],
						['xclip', ['-selection', 'clipboard']],
					];
	const tryCmd = (i: number): void => {
		const c = cmds[i];
		if (!c) return;
		try {
			const p = spawn(c[0], c[1], {stdio: ['pipe', 'ignore', 'ignore']});
			p.on('error', () => tryCmd(i + 1));
			p.stdin.on('error', () => {});
			p.stdin.end(text);
		} catch {
			tryCmd(i + 1);
		}
	};
	tryCmd(0);
}
