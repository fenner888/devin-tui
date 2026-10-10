import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import {render} from 'ink';
import {App} from './ui/App.js';
import {defaultLogFile, type AgentConn} from './acp/connection.js';
import {MOUSE_OFF, MOUSE_ON} from './mouse.js';
import {effectiveSettings} from './settings.js';
import {setAutoDetected, TRUECOLOR} from './theme.js';
import {osc11Luminance} from './themes.js';

interface CliArgs {
	cwd: string;
	model?: string;
	command: string;
	/** 'continue' = newest session for cwd; otherwise a session id */
	resume?: string;
}

function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = {cwd: process.cwd(), command: 'devin acp'};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--cwd') {
			args.cwd = path.resolve(argv[++i] ?? '.');
		} else if (a === '--model') {
			args.model = argv[++i];
		} else if (a === '--agent') {
			args.command = argv[++i] ?? args.command;
		} else if (a === '-c' || a === '--continue') {
			args.resume = 'continue';
		} else if (a === '-r' || a === '--resume') {
			args.resume = argv[++i] ?? '';
		} else if (a === '--help' || a === '-h') {
			process.stderr.write(
				'usage: devin-tui [update] [--cwd <dir>] [--model <name>] [--agent "<cmd>"] [-c|--continue] [-r|--resume <id>]\n',
			);
			process.exit(0);
		}
	}
	return args;
}

const FOCUS_ON = '\x1b[?1004h';
const FOCUS_OFF = '\x1b[?1004l';
const ENTER_ALT = '\x1b[?1049h\x1b[?25l\x1b]0;devin-tui\x07';
const LEAVE_ALT =
	MOUSE_OFF + FOCUS_OFF + '\x1b[?25h\x1b[?1049l\x1b]0;devin-tui\x07';

/** OSC 11 terminal-background probe — sent BEFORE Ink renders so 'auto'
 *  theme picks dark/light by the real terminal background. Only runs when
 *  the effective theme is 'auto' on a truecolor TTY. 100 ms window; any
 *  reply of `rgb:R/G/B` (2- or 4-digit components, BEL or ST) classifies
 *  the background; a dark/no-reply result keeps 'devin'. */
function detectTerminalBg(): Promise<void> {
	return new Promise(resolve => {
		if (!process.stdin.isTTY || !TRUECOLOR) {
			setAutoDetected('devin');
			resolve();
			return;
		}
		let buf = '';
		let finished = false;
		const done = () => {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			process.stdin.off('data', onData);
			process.stdin.setRawMode(false);
			process.stdin.pause();
			const lum = osc11Luminance(buf);
			setAutoDetected(lum !== null && lum >= 0.5 ? 'light' : 'devin');
			resolve();
		};
		const onData = (d: Buffer) => {
			buf += d.toString('utf8');
			if (osc11Luminance(buf) !== null) done();
		};
		const timer = setTimeout(done, 100);
		process.stdin.setRawMode(true);
		process.stdin.resume();
		process.stdin.on('data', onData);
		try {
			process.stdout.write('\x1b]11;?\x07');
		} catch {
			done();
		}
	});
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	if (!fs.statSync(args.cwd, {throwIfNoEntry: false})?.isDirectory()) {
		process.stderr.write(`devin-tui: --cwd is not a directory: ${args.cwd}\n`);
		process.exit(1);
	}
	if (!process.stdout.isTTY) {
		process.stderr.write('devin-tui: stdout is not a terminal\n');
		process.exit(1);
	}

	let conn: AgentConn | undefined;
	let cleaned = false;

	const restore = () => {
		try {
			process.stdout.write(LEAVE_ALT);
		} catch {
			// already gone
		}
	};

	const settings = effectiveSettings();
	if (settings.theme === 'auto') await detectTerminalBg();
	else setAutoDetected('devin');

	process.stdout.write(
		ENTER_ALT +
			(settings.mouse ? MOUSE_ON : '') +
			(settings.alerts === 'off' ? '' : FOCUS_ON),
	);

	const inst = render(
		<App
			cwd={args.cwd}
			model={args.model}
			command={args.command}
			resume={args.resume}
			onQuit={() => quit(0)}
			onConn={c => (conn = c)}
		/>,
		{exitOnCtrlC: false, patchConsole: false, incrementalRendering: true},
	);

	function quit(code: number): void {
		if (cleaned) return;
		cleaned = true;
		try {
			inst.unmount();
		} catch {
			// ignore
		}
		try {
			conn?.dispose();
		} catch {
			// ignore
		}
		restore();
		process.exit(code);
	}

	process.on('SIGINT', () => quit(130));
	process.on('SIGTERM', () => quit(143));
	process.on('uncaughtException', e => {
		try {
			fs.appendFileSync(
				defaultLogFile(),
				`\nuncaughtException: ${e.stack ?? e.message}\n`,
			);
		} catch {
			// ignore
		}
		quit(1);
	});
	process.on('unhandledRejection', e => {
		try {
			fs.appendFileSync(defaultLogFile(), `\nunhandledRejection: ${String(e)}\n`);
		} catch {
			// ignore
		}
	});
	process.on('exit', () => {
		restore();
		try {
			conn?.dispose();
		} catch {
			// ignore
		}
	});
}

main();
