import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {Readable, Writable} from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	ClientSideConnection,
	ndJsonStream,
	PROTOCOL_VERSION,
	type AuthenticateResponse,
	type Client,
	type ContentBlock,
	type InitializeResponse,
	type LoadSessionResponse,
	type NewSessionResponse,
	type PermissionOption,
	type PromptResponse,
	type RequestPermissionOutcome,
	type RequestPermissionRequest,
	type SessionInfo,
	type SessionModeState,
	type SessionNotification,
} from '@agentclientprotocol/sdk';
import {parseTurnStats, type TurnStat} from '../spend.js';

export interface ConnEvents {
	onUpdate: (n: SessionNotification) => void;
	onPermissionRequest: (
		req: RequestPermissionRequest,
	) => Promise<RequestPermissionOutcome>;
	/** `_cognition.ai/turn_stats` ext notification, parsed (per-turn token
	 *  usage + model label). Fired for replays during session/load too. */
	onTurnStats: (sessionId: string, stat: TurnStat) => void;
	onLog: (line: string) => void;
	onExit: (code: number | null, signal: string | null) => void;
	onSpawnError: (err: Error) => void;
}

/** Use `bin` if it's on PATH; otherwise fall back to ~/.local/bin/<bin> (the Devin CLI install location). */
export function resolveBin(bin: string): string {
	if (bin.includes('/')) return bin;
	const onPath = (process.env.PATH ?? '')
		.split(path.delimiter)
		.some(d => d && fs.existsSync(path.join(d, bin)));
	if (onPath) return bin;
	const fallback = path.join(os.homedir(), '.local', 'bin', bin);
	return fs.existsSync(fallback) ? fallback : bin;
}

/** Split a command string like `npx tsx test/fake-agent.ts` respecting quotes. */
export function splitCommand(cmd: string): string[] {
	const out: string[] = [];
	const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(cmd))) out.push(m[1] ?? m[2] ?? m[3]);
	return out;
}

/** DEVIN_TUI_DEBUG=1 enables protocol captures — session-updates.jsonl,
 *  session-config.json and config-updates.jsonl contain session content
 *  (file contents, command output), so they are opt-in and off by default. */
const DEBUG = process.env.DEVIN_TUI_DEBUG === '1';

/** Agent stderr log cap — over this, rotate to `.1` (replacing it) at startup. */
const MAX_LOG_BYTES = 5 * 1024 * 1024;

export function defaultLogFile(): string {
	const dir = path.join(os.tmpdir(), 'devin-tui');
	fs.mkdirSync(dir, {recursive: true});
	const file = path.join(dir, 'devin-acp.log');
	try {
		if (fs.statSync(file).size > MAX_LOG_BYTES) {
			fs.renameSync(file, `${file}.1`);
		}
	} catch {
		// missing file or failed rotation — diagnostics must never throw
	}
	return file;
}

export class AgentConn {
	readonly logFile: string;
	sessionId?: string;
	modes?: SessionModeState | null;
	private child?: ChildProcessWithoutNullStreams;
	private conn!: ClientSideConnection;
	private logStream?: fs.WriteStream;
	private init?: InitializeResponse;

	constructor(
		private opts: {command: string; cwd: string; model?: string},
		private ev: ConnEvents,
	) {
		this.logFile = defaultLogFile();
	}

	get running(): boolean {
		return !!this.child && this.child.exitCode === null && !this.child.killed;
	}

	spawn(): void {
		const [rawBin, ...args] = splitCommand(this.opts.command);
		if (!rawBin) throw new Error('empty agent command');
		const bin = resolveBin(rawBin);
		if (this.opts.model) args.push('--model', this.opts.model);
		this.logStream = fs.createWriteStream(this.logFile, {flags: 'a'});
		this.log(`--- spawn: ${bin} ${args.join(' ')} (cwd=${this.opts.cwd})`);
		this.child = spawn(bin, args, {
			cwd: this.opts.cwd,
			stdio: ['pipe', 'pipe', 'pipe'],
			env: process.env,
		});
		this.child.stderr.on('data', (d: Buffer) => this.logStream?.write(d));
		this.child.on('error', err => {
			this.log(`spawn error: ${err.message}`);
			this.ev.onSpawnError(err);
		});
		this.child.on('exit', (code, signal) => this.ev.onExit(code, signal));
		const stream = ndJsonStream(
			Writable.toWeb(this.child.stdin) as WritableStream<Uint8Array>,
			Readable.toWeb(this.child.stdout) as ReadableStream<Uint8Array>,
		);
		this.conn = new ClientSideConnection(() => this.clientHandler(), stream);
		void this.conn.closed.then(() => this.log('connection closed'));
	}

	private clientHandler(): Client {
		return {
			sessionUpdate: n => {
				if (DEBUG) {
					if (n.update.sessionUpdate === 'config_option_update') {
						this.appendConfigUpdate(n.update);
					}
					if (!n.update.sessionUpdate.endsWith('_chunk')) {
						this.appendJsonl('session-updates.jsonl', n.update);
					}
				}
				this.ev.onUpdate(n);
			},
			requestPermission: async req => {
				if (DEBUG)
					this.appendJsonl('session-updates.jsonl', {
						permissionRequest: req,
					});
				return {outcome: await this.ev.onPermissionRequest(req)};
			},
			extNotification: (method, params) => {
				const p = params as {
					channel?: string;
					message?: string;
					level?: string;
					sessionId?: string;
				};
				if (method === '_cognition.ai/turn_stats') {
					const ts = parseTurnStats(params);
					if (ts) this.ev.onTurnStats(ts.sessionId, ts.stat);
				}
				if (method === '_cognition.ai/output' && p && typeof p === 'object') {
					this.log(
						`[ext output${p.level ? `/${p.level}` : ''}${p.channel ? ` ${p.channel}` : ''}] ${p.message ?? JSON.stringify(params)}`,
					);
				} else {
					this.log(`[ext ${method}] ${JSON.stringify(params)}`);
				}
			},
		};
	}

	private log(line: string): void {
		try {
			this.logStream?.write(
				`${new Date().toISOString()} ${line.replace(/\n$/, '')}\n`,
			);
		} catch {
			// logging must never throw
		}
		this.ev.onLog(line);
	}

	async initialize(): Promise<InitializeResponse> {
		this.init = await this.conn.initialize({
			protocolVersion: PROTOCOL_VERSION,
			clientCapabilities: {
				fs: {readTextFile: false, writeTextFile: false},
				terminal: false,
			},
			clientInfo: {name: 'devin-tui', title: 'Devin TUI', version: '0.2.0'},
		});
		return this.init;
	}

	/** agentCapabilities.loadSession — session/load support. */
	get canLoadSession(): boolean {
		return this.init?.agentCapabilities?.loadSession === true;
	}

	/** agentCapabilities.sessionCapabilities.list — session/list support. */
	get canListSessions(): boolean {
		return this.init?.agentCapabilities?.sessionCapabilities?.list != null;
	}

	/** agentCapabilities.promptCapabilities.image — image content blocks. */
	get canPromptImages(): boolean {
		return this.init?.agentCapabilities?.promptCapabilities?.image === true;
	}

	async authenticate(methodId: string): Promise<AuthenticateResponse> {
		return this.conn.authenticate({methodId});
	}

	async newSession(): Promise<NewSessionResponse> {
		const res = await this.conn.newSession({
			cwd: this.opts.cwd,
			mcpServers: [],
		});
		this.sessionId = res.sessionId;
		this.modes = res.modes;
		return res;
	}

	/** session/list — sessions for this cwd (the agent orders by its own
	 *  `cognition.ai/sessionListOrderBy`; we sort client-side too). */
	async listSessions(): Promise<SessionInfo[]> {
		const res = await this.conn.listSessions({cwd: this.opts.cwd});
		return res.sessions;
	}

	/** session/load — replays the session's history via session/update
	 *  notifications, then resolves with modes/configOptions. */
	async loadSession(sessionId: string): Promise<LoadSessionResponse> {
		const res = await this.conn.loadSession({
			cwd: this.opts.cwd,
			mcpServers: [],
			sessionId,
		});
		this.sessionId = sessionId;
		this.modes = res.modes;
		return res;
	}

	async prompt(blocks: ContentBlock[]): Promise<PromptResponse> {
		if (!this.sessionId) throw new Error('no session');
		return this.conn.prompt({
			sessionId: this.sessionId,
			prompt: blocks,
		});
	}

	async cancel(): Promise<void> {
		if (!this.sessionId) return;
		await this.conn.cancel({sessionId: this.sessionId});
	}

	async setMode(modeId: string): Promise<void> {
		if (!this.sessionId) return;
		await this.conn.setSessionMode({sessionId: this.sessionId, modeId});
	}

	/** Returns the updated configOptions list from the agent's response. */
	async setConfigOption(configId: string, value: string) {
		if (!this.sessionId) return undefined;
		const res = await this.conn.setSessionConfigOption({
			sessionId: this.sessionId,
			configId,
			value,
		});
		return res.configOptions;
	}

	async logout(): Promise<void> {
		await this.conn.logout({});
	}

	/** Dump the session/new (or session/load) config payload for later
	 *  inspection (no secrets) — DEVIN_TUI_DEBUG=1 only. */
	writeSessionConfig(
		res: Pick<NewSessionResponse, 'configOptions' | 'modes' | '_meta'> & {
			models?: unknown;
		},
	): void {
		if (!DEBUG) return;
		try {
			const file = path.join(path.dirname(this.logFile), 'session-config.json');
			fs.writeFileSync(
				file,
				JSON.stringify(
					{
						configOptions: res.configOptions ?? null,
						modes: res.modes ?? null,
						models: (res as {models?: unknown}).models ?? null,
						_meta: res._meta ?? null,
					},
					null,
					2,
				),
			);
		} catch {
			// diagnostics must never throw
		}
	}

	/** Append one non-chunk session update to a diagnostics jsonl (no
	 *  secrets) — DEVIN_TUI_DEBUG=1 only (callers also gate). */
	private appendJsonl(name: string, payload: unknown): void {
		if (!DEBUG) return;
		try {
			fs.appendFileSync(
				path.join(path.dirname(this.logFile), name),
				`${JSON.stringify(payload)}\n`,
			);
		} catch {
			// diagnostics must never throw
		}
	}

	/** Append one config_option_update payload to the jsonl log —
	 *  DEVIN_TUI_DEBUG=1 only. */
	appendConfigUpdate(update: unknown): void {
		if (!DEBUG) return;
		try {
			const file = path.join(
				path.dirname(this.logFile),
				'config-updates.jsonl',
			);
			fs.appendFileSync(file, `${JSON.stringify(update)}\n`);
		} catch {
			// diagnostics must never throw
		}
	}

	dispose(): void {
		const child = this.child;
		this.child = undefined;
		if (child && child.exitCode === null && !child.killed) {
			try {
				child.kill('SIGTERM');
			} catch {
				// already dead
			}
			const killer = setTimeout(() => {
				try {
					child.kill('SIGKILL');
				} catch {
					// already dead
				}
			}, 1500);
			killer.unref();
		}
		try {
			this.logStream?.end();
		} catch {
			// ignore
		}
	}
}
