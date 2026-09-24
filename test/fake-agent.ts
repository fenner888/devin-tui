/**
 * Fake Devin ACP agent for testing the TUI without real Devin.
 *
 * Mimics `devin acp`:
 *  - initialize advertises a "devin-browser" auth method.
 *  - session/new before auth rejects with -32000 "not authenticated".
 *  - authenticate "logs in" after ~1s.
 *  - prompt streams thought → plan → commands → markdown chunks → read/edit/
 *    execute tool calls (edit requests permission; execute fails).
 *  - Emits `_cognition.ai/output` extension notifications like real Devin.
 *
 * Run the TUI against it: npm start -- --agent "npx tsx test/fake-agent.ts"
 */
import {Readable, Writable} from 'node:stream';
import {
	AgentSideConnection,
	ndJsonStream,
	RequestError,
	type Agent,
	type SessionConfigOption,
	type SessionUpdate,
} from '@agentclientprotocol/sdk';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let authenticated = false;
let sessionId = '';
let cancelled = false;
let promptCount = 0;
let conn: AgentSideConnection;

function update(u: SessionUpdate): Promise<void> {
	if (!sessionId) return Promise.resolve();
	return conn.sessionUpdate({sessionId, update: u});
}

function text(t: string) {
	return {type: 'text' as const, text: t};
}

async function extLog(message: string): Promise<void> {
	try {
		await conn.extNotification('_cognition.ai/output', {
			channel: 'mcp',
			message,
			level: 'info',
			sessionId,
		});
	} catch {
		// notifications are best-effort
	}
}

const MODES = [
	{id: 'normal', name: 'Normal'},
	{id: 'plan', name: 'Plan'},
	{id: 'accept-edits', name: 'Accept Edits'},
	{id: 'bypass', name: 'Bypass Permissions'},
];

// ---- session config options (standard ACP schema) -------------------------

let currentModel = 'swe-2';
let currentEffort = 'max';
let currentMode = 'normal';

function effortOptions(model: string) {
	// Claude Opus 5 caps at 'high' — a different effort list for one model
	const all = [
		{value: 'low', name: 'Low'},
		{value: 'medium', name: 'Medium'},
		{value: 'high', name: 'High'},
		{value: 'max', name: 'Max'},
	];
	return model === 'opus-5' ? all.slice(0, 3) : all;
}

function buildConfig(): SessionConfigOption[] {
	const efforts = effortOptions(currentModel);
	if (!efforts.some(e => e.value === currentEffort)) currentEffort = 'high';
	return [
		{
			id: 'mode',
			name: 'Mode',
			type: 'select',
			category: 'mode',
			currentValue: currentMode,
			options: MODES.map(m => ({value: m.id, name: m.name})),
		},
		{
			id: 'model',
			name: 'Model',
			type: 'select',
			category: 'model',
			currentValue: currentModel,
			options: [
				{
					group: 'devin',
					name: 'Devin',
					options: [
						{value: 'gpt-6-sol', name: 'GPT-6 Sol'},
						{value: 'inkling', name: 'Inkling'},
						{value: 'swe-2', name: 'SWE-2'},
						{value: 'swe-1.6', name: 'SWE-1.6'},
						{value: 'swe-1.5', name: 'SWE-1.5'},
					],
				},
				{
					group: 'other',
					name: 'Other models',
					options: [
						{value: 'opus-5', name: 'Claude Opus 5'},
						{value: 'sonnet-5', name: 'Claude Sonnet 5'},
						{value: 'haiku-5', name: 'Claude Haiku 5'},
						{value: 'gpt-5.4', name: 'GPT-5.4'},
						{value: 'gemini-4', name: 'Gemini 4'},
					],
				},
				{
					group: 'fusion',
					name: 'Fusion',
					options: [
						{
							value: 'fusion-claude-opus-5-5-high-sidekick-swe-2-medium',
							name: 'Fusion (Claude Opus 5.5 High + SWE-2 Medium)',
						},
						{
							value: 'fusion-claude-opus-5-5-high-sidekick-swe-2-high',
							name: 'Fusion (Claude Opus 5.5 High + SWE-2 High)',
						},
						{
							value: 'fusion-claude-opus-5-5-high-sidekick-gpt-5-6-luna-high-thinking',
							name: 'Fusion (Claude Opus 5.5 High + GPT-5.6 Luna High Thinking)',
						},
						{
							value: 'fusion-gpt-6-sol-high-thinking-sidekick-swe-2-medium',
							name: 'Fusion (GPT-6 Sol High Thinking + SWE-2 Medium)',
						},
						{
							value: 'fusion-gpt-6-sol-high-thinking-sidekick-swe-2-high',
							name: 'Fusion (GPT-6 Sol High Thinking + SWE-2 High)',
						},
						// one pair missing: GPT-6 Sol × GPT-5.6 Luna
					],
				},
			],
		},
		{
			id: 'thought_level',
			name: 'Reasoning effort',
			type: 'select',
			category: 'thought_level',
			currentValue: currentEffort,
			options: efforts,
		},
	];
}

const AGENT_CWD = process.cwd();

const EDIT_OLD = [
	'import {spawn} from "node:child_process";',
	'import {ndJsonStream} from "@agentclientprotocol/sdk";',
	'',
	'export function resolveBin(bin: string): string {',
	'	if (bin.includes("/")) return bin;',
	'	return (process.env.PATH ?? "").split(":").map(d => d + "/" + bin).find(existsSync) ?? bin;',
	'}',
].join('\n');

const EDIT_NEW = [
	'import {spawn} from "node:child_process";',
	'import os from "node:os";',
	'import path from "node:path";',
	'import {ndJsonStream} from "@agentclientprotocol/sdk";',
	'',
	'export function resolveBin(bin: string): string {',
	'	if (bin.includes("/")) return bin;',
	// deliberately longer than an 80-col content width after detab —
	// regression coverage for the diff-row wrap bug
	'	const resolved = (process.env.PATH ?? "").split(path.delimiter).map(d => path.join(d, bin)).find(candidate => candidate.length > 0 && existsSync(candidate));',
	'	return resolved ?? bin;',
	'}',
].join('\n');

/** Devin's execute shape: the command preview rides as a flagged resource
 *  content item; output arrives in in_progress text updates; the exit
 *  code arrives in `_meta.terminal_exit` on a later update; the final
 *  status update carries no content at all. */
const previewResource = (command: string) => ({
	type: 'content' as const,
	content: {
		type: 'resource' as const,
		resource: {
			mimeType: 'text/x-shellscript',
			text: command,
			uri: 'tool://preview',
		},
		_meta: {'cognition.ai/preview_is_shell_command': true},
	},
});

async function runMainTurn(): Promise<'end_turn' | 'cancelled'> {
	const step = async (fn: () => Promise<unknown>, ms = 260) => {
		if (cancelled) return false;
		await fn();
		await sleep(ms);
		return !cancelled;
	};
	const usage = (used: number) =>
		update({sessionUpdate: 'usage_update', used, size: 262000});

	if (!(await step(() => update({sessionUpdate: 'agent_thought_chunk', content: text('Let me look at this workspace.\nI should list the files, read package.json, then make the edit and run the tests.')})))) return 'cancelled';
	if (!(await step(() => update({sessionUpdate: 'plan', entries: [
		{content: 'List the project files', status: 'in_progress', priority: 'high'},
		{content: 'Read package.json', status: 'pending', priority: 'high'},
		{content: 'Apply the requested edit', status: 'pending', priority: 'high'},
		{content: 'Run the test suite', status: 'pending', priority: 'medium'},
	]})))) return 'cancelled';
	if (!(await step(() => update({sessionUpdate: 'available_commands_update', availableCommands: [
		{name: 'plan', description: 'create an execution plan'},
		{name: 'ask', description: 'ask a question without editing'},
		{name: 'compact', description: 'compact the conversation context'},
	]})))) return 'cancelled';
	if (!(await step(() => update({sessionUpdate: 'session_info_update', title: 'Workspace Overview'})))) return 'cancelled';
	if (!(await step(() => extLog('mcp server "devin" connected')))) return 'cancelled';
	if (!(await step(() => update({sessionUpdate: 'agent_message_chunk', content: text(" I'll take a look at the workspace layout.\n")}), 400))) return 'cancelled';

	// execute tool call (real Devin shape: preview resource + _meta) →
	// permission request with the real 6 options → streamed output →
	// terminal_exit → bare `completed` update with no content
	if (!(await step(() => update({sessionUpdate: 'tool_call', toolCallId: 'tc-ls#1', title: 'Listed ./src', kind: 'execute', status: 'pending', content: [previewResource('ls ./src')], rawInput: {command: 'ls ./src'}, _meta: {'cognition.ai/commandNames': ['ls'], 'cognition.ai/inferenceToolName': 'exec'}} as never)))) return 'cancelled';
	if (!(await step(() => update({sessionUpdate: 'tool_call_update', toolCallId: 'tc-ls#1', status: 'in_progress', _meta: {'cognition.ai/cwd': AGENT_CWD}} as never), 400))) return 'cancelled';
	const outcome = await conn.requestPermission({
		sessionId,
		toolCall: {
			toolCallId: 'tc-ls#1',
			_meta: {'cognition.ai/editableCommand': 'ls ./src'},
		} as never,
		options: [
			{optionId: 'opt-allow', name: 'Allow', kind: 'allow_once'},
			{optionId: 'opt-allow-session', name: 'Yes, allow `ls` commands (this session)', kind: 'allow_always'},
			{optionId: 'opt-allow-always', name: 'Yes, always allow `ls` commands in `devin-tui`', kind: 'allow_always'},
			{optionId: 'opt-allow-global', name: 'Yes, always allow `ls` commands in all projects', kind: 'allow_always'},
			{optionId: 'opt-bypass', name: 'Yes, switch to bypass mode', kind: 'allow_always'},
			{optionId: 'opt-reject', name: 'Reject', kind: 'reject_once'},
		],
	});
	if (cancelled || outcome.outcome.outcome === 'cancelled') {
		await update({sessionUpdate: 'tool_call_update', toolCallId: 'tc-ls#1', status: 'failed'});
		return 'cancelled';
	}
	const allowed =
		outcome.outcome.outcome === 'selected' &&
		outcome.outcome.optionId !== 'opt-reject';
	if (!allowed) {
		await update({sessionUpdate: 'tool_call_update', toolCallId: 'tc-ls#1', status: 'failed'});
		return 'end_turn';
	}
	const lsOut = 'acp\nstate\nui';
	if (!(await step(() => update({
		sessionUpdate: 'tool_call_update',
		toolCallId: 'tc-ls#1',
		status: 'in_progress',
		content: [{type: 'content', content: text(lsOut)}],
		_meta: {'cognition.ai/terminalPreview': true},
	} as never)))) return 'cancelled';
	if (!(await step(() => update({
		sessionUpdate: 'tool_call_update',
		toolCallId: 'tc-ls#1',
		status: 'in_progress',
		content: [{type: 'content', content: text(lsOut)}],
		_meta: {terminal_exit: {terminal_id: 'fake-term-1', exit_code: 0, signal: null}},
	} as never)))) return 'cancelled';
	// real Devin: the final update carries only the status — the prior
	// content (and the exit code) must be kept by the client
	if (!(await step(() => update({sessionUpdate: 'tool_call_update', toolCallId: 'tc-ls#1', status: 'completed'})))) return 'cancelled';
	if (!(await step(() => usage(13127)))) return 'cancelled';

	// read tool call — Devin's generic 'Read file' title + locations
	if (!(await step(() => update({sessionUpdate: 'tool_call', toolCallId: 'tc-read#1', title: 'Read file', kind: 'read', status: 'in_progress', locations: [{path: `${AGENT_CWD}/package.json`}], rawInput: {file_path: `${AGENT_CWD}/package.json`}}), 500))) return 'cancelled';
	if (!(await step(() => update({sessionUpdate: 'tool_call_update', toolCallId: 'tc-read#1', status: 'completed', content: [{type: 'content', content: text('22 lines')}]})))) return 'cancelled';
	if (!(await step(() => usage(16904)))) return 'cancelled';

	// kind-less skill invocation (title only)
	if (!(await step(() => update({sessionUpdate: 'tool_call', toolCallId: 'tc-skill#1', title: 'Invoked skill remotion-best-practices', status: 'in_progress'}), 300))) return 'cancelled';
	if (!(await step(() => update({sessionUpdate: 'tool_call_update', toolCallId: 'tc-skill#1', status: 'completed'})))) return 'cancelled';
	if (!(await step(() => usage(18441)))) return 'cancelled';

	// edit tool call with a real diff (incl. a long indented line that
	// overflows an 80-col content width — regression test for the
	// diff-row wrap bug)
	if (!(await step(() => update({sessionUpdate: 'tool_call', toolCallId: 'tc-edit#1', title: 'Edit src/index.tsx', kind: 'edit', status: 'in_progress', locations: [{path: `${AGENT_CWD}/src/index.tsx`}]}), 400))) return 'cancelled';
	if (!(await step(() => update({
		sessionUpdate: 'tool_call_update',
		toolCallId: 'tc-edit#1',
		status: 'completed',
		content: [{type: 'diff', path: `${AGENT_CWD}/src/index.tsx`, oldText: EDIT_OLD, newText: EDIT_NEW}],
	})))) return 'cancelled';
	if (!(await step(() => usage(21773)))) return 'cancelled';

	// execute tool call → fails (npm test, terminal_exit exit_code 1)
	if (!(await step(() => update({sessionUpdate: 'tool_call', toolCallId: 'tc-test#1', title: 'Ran npm test', kind: 'execute', status: 'in_progress', content: [previewResource('npm test')], rawInput: {command: 'npm test'}}), 700))) return 'cancelled';
	if (!(await step(() => update({
		sessionUpdate: 'tool_call_update',
		toolCallId: 'tc-test#1',
		status: 'in_progress',
		content: [{type: 'content', content: text('FAIL src/app.test.ts\n  ✗ renders the home screen')}],
	})))) return 'cancelled';
	if (!(await step(() => update({
		sessionUpdate: 'tool_call_update',
		toolCallId: 'tc-test#1',
		status: 'in_progress',
		_meta: {terminal_exit: {terminal_id: 'fake-term-2', exit_code: 1, signal: null}},
	} as never)))) return 'cancelled';
	if (!(await step(() => update({sessionUpdate: 'tool_call_update', toolCallId: 'tc-test#1', status: 'failed'})))) return 'cancelled';
	if (!(await step(() => usage(24120)))) return 'cancelled';

	await step(() => update({sessionUpdate: 'plan', entries: [
		{content: 'List the project files', status: 'completed', priority: 'high'},
		{content: 'Read package.json', status: 'completed', priority: 'high'},
		{content: 'Apply the requested edit', status: 'completed', priority: 'high'},
		{content: 'Run the test suite', status: 'completed', priority: 'medium'},
	]}));
	await step(() => update({sessionUpdate: 'agent_message_chunk', content: text('\nHere is what I found in the workspace:\n\n- `src` holds 3 entries\n- `package.json` is 22 lines\n- The edit applied cleanly but **npm test** failed — see the `execute` step above.')}), 0);
	return cancelled ? 'cancelled' : 'end_turn';
}

async function runSlowTurn(): Promise<'end_turn' | 'cancelled'> {
	await update({sessionUpdate: 'agent_thought_chunk', content: text('Streaming a slow reply — press esc to cancel.')});
	for (let i = 1; i <= 40; i++) {
		if (cancelled) return 'cancelled';
		await update({sessionUpdate: 'agent_message_chunk', content: text(`line ${i} of a slow stream. `)});
		await sleep(250);
	}
	return 'end_turn';
}

const agent: Agent = {
	async initialize() {
		return {
			protocolVersion: 1,
			agentCapabilities: {loadSession: true, logout: {}},
			authMethods: [
				{
					id: 'devin-browser',
					name: 'Log in with browser',
					description: 'opens a browser window to authenticate',
				},
			],
			agentInfo: {name: 'fake-devin', title: 'Devin Agent', version: '0.0.1'},
		};
	},
	async newSession() {
		if (!authenticated) {
			throw new RequestError(
				-32000,
				'ACP host has not authenticated. Call the `authenticate` ACP method (or invoke the browser auth method to start the PKCE browser flow)',
			);
		}
		sessionId = 'fake-' + Math.random().toString(36).slice(2, 10);
		promptCount = 0;
		setTimeout(() => void extLog('mcp servers changed: 1 connected'), 150);
		// advertise slash commands up front so the home dropdown has them
		setTimeout(
			() =>
				void update({
					sessionUpdate: 'available_commands_update',
					availableCommands: [
						{name: 'plan', description: 'create an execution plan'},
						{name: 'ask', description: 'ask a question without editing'},
						{name: 'compact', description: 'compact the conversation context'},
					],
				}),
			120,
		);
		return {
			sessionId,
			modes: {currentModeId: 'normal', availableModes: MODES},
			configOptions: buildConfig(),
		};
	},
	async authenticate() {
		await sleep(1000);
		authenticated = true;
		return {};
	},
	async setSessionMode(params) {
		currentMode = params.modeId;
		setTimeout(
			() =>
				void update({
					sessionUpdate: 'current_mode_update',
					currentModeId: params.modeId,
				}),
			60,
		);
		return {};
	},
	async setSessionConfigOption(params) {
		const v = String(params.value);
		process.stderr.write(
			`fake-agent: set_config_option ${params.configId}=${v}\n`,
		);
		if (params.configId === 'model') currentModel = v;
		else if (params.configId === 'thought_level') currentEffort = v;
		else if (params.configId === 'mode') currentMode = v;
		const configOptions = buildConfig();
		// model changes can alter other options (e.g. the effort list) —
		// push the full set as a config_option_update like real Devin does
		setTimeout(
			() =>
				void update({
					sessionUpdate: 'config_option_update',
					configOptions,
				}),
			60,
		);
		return {configOptions};
	},
	async logout() {
		process.stderr.write('fake-agent: logout\n');
		authenticated = false;
		sessionId = '';
		return {};
	},
	async prompt(params) {
		promptCount++;
		const text = params.prompt
			.map(b => (b.type === 'text' ? b.text : ''))
			.join(' ');
		process.stderr.write(`fake-agent: prompt #${promptCount} received: ${JSON.stringify(text)}\n`);
		cancelled = false;
		await sleep(2500); // mimic real Devin's ~4s TTFT before the first chunk
		const stopReason = promptCount === 1 ? await runMainTurn() : await runSlowTurn();
		return {stopReason};
	},
	async cancel() {
		cancelled = true;
	},
	extNotification() {
		// swallow client extension notifications
	},
};

conn = new AgentSideConnection(
	() => agent,
	ndJsonStream(
		Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
		Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
	),
);

process.stderr.write('fake-agent: listening\n');
await conn.closed;
