import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import {render} from 'ink';
import {App} from './ui/App.js';
import {defaultLogFile, type AgentConn} from './acp/connection.js';

interface CliArgs {
	cwd: string;
	model?: string;
	command: string;
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
		} else if (a === '--help' || a === '-h') {
			process.stderr.write(
				'usage: devin-tui [--cwd <dir>] [--model <name>] [--agent "<cmd>"]\n',
			);
			process.exit(0);
		}
	}
	return args;
}

const ENTER_ALT = '\x1b[?1049h\x1b[?25l\x1b]0;devin-tui\x07';
const LEAVE_ALT = '\x1b[?25h\x1b[?1049l\x1b]0;devin-tui\x07';

function main(): void {
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

	process.stdout.write(ENTER_ALT);

	const inst = render(
		<App
			cwd={args.cwd}
			model={args.model}
			command={args.command}
			onQuit={() => quit(0)}
			onConn={c => (conn = c)}
		/>,
		{exitOnCtrlC: false, patchConsole: false},
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
