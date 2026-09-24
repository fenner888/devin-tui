import type {
	PermissionOption,
	PlanEntryStatus,
	SessionConfigOption,
	SessionUpdate,
	ToolCallContent,
	ToolCallLocation,
	ToolCallStatus,
	ToolKind,
} from '@agentclientprotocol/sdk';

export type Status =
	| 'booting'
	| 'needsAuth'
	| 'auth'
	| 'idle'
	| 'working'
	| 'error';

export interface BootStep {
	id: string;
	label: string;
	state: 'pending' | 'active' | 'done' | 'failed';
	detail?: string;
}

export type TranscriptItem =
	| {kind: 'user'; id: string; text: string}
	| {kind: 'agent'; id: string; text: string; streaming: boolean}
	| {kind: 'thought'; id: string; text: string}
	| {
			kind: 'tool';
			id: string;
			toolCallId: string;
			toolKind: ToolKind | string;
			title: string;
			status: ToolCallStatus | string;
			content?: ToolCallContent[];
			locations?: ToolCallLocation[];
			rawInput?: unknown;
			rawOutput?: unknown;
			/** last _meta.terminal_exit.exit_code seen (real Devin shape) */
			exitCode?: number;
			/** _meta["cognition.ai/cwd"] the tool ran in */
			toolCwd?: string;
	  }
	| {kind: 'system'; id: string; text: string; bright?: string};

export interface PlanItem {
	content: string;
	status: PlanEntryStatus;
}

export interface SlashCommand {
	name: string;
	description: string;
	local?: boolean;
}

export interface PermissionReq {
	toolCallId: string;
	title: string;
	toolKind: string;
	options: PermissionOption[];
	/** _meta["cognition.ai/editableCommand"] — the command awaiting approval */
	editableCommand?: string;
}

export interface ModeInfo {
	id: string;
	name: string;
}

export interface AuthMethod {
	id: string;
	name?: string | null;
	description?: string | null;
}

export interface State {
	status: Status;
	boot: BootStep[];
	error?: string;
	logFile: string;
	cwd: string;
	model?: string;
	sessionId?: string;
	agentTitle?: string;
	authMethods: AuthMethod[];
	authError?: string;
	configOptions: SessionConfigOption[];
	mode?: string;
	modes: ModeInfo[];
	items: TranscriptItem[];
	plan: PlanItem[];
	commands: SlashCommand[];
	permission?: PermissionReq;
	turns: number;
	toolCalls: number;
	turnStartedAt?: number;
	sidebar: boolean;
	notice?: string;
	/** context usage from the latest usage_update */
	usage?: {used: number; size: number};
	/** session title from session_info_update */
	sessionTitle?: string;
	/** prompts typed while working — sent as one prompt when the turn ends */
	queued: string[];
	/** ctrl+o — expand completed command blocks (collapsed by default) */
	expandTools: boolean;
}

let nextId = 1;
const id = () => `i${nextId++}`;

export function initialState(cwd: string, model: string | undefined, logFile: string): State {
	return {
		status: 'booting',
		boot: [
			{id: 'spawn', label: 'spawning devin acp', state: 'pending'},
			{id: 'handshake', label: 'handshake · protocol v1', state: 'pending'},
			{id: 'session', label: 'opening session', state: 'pending'},
		],
		logFile,
		cwd,
		model,
		authMethods: [],
		configOptions: [],
		modes: [],
		items: [],
		plan: [],
		commands: [],
		turns: 0,
		toolCalls: 0,
		sidebar: true,
		queued: [],
		expandTools: false,
	};
}

export type Action =
	| {type: 'status'; status: Status}
	| {type: 'logFile'; path: string}
	| {type: 'bootStep'; id: string; state: BootStep['state']; detail?: string}
	| {type: 'bootInsert'; step: BootStep; before: string}
	| {type: 'fail'; message: string}
	| {type: 'agentInfo'; title: string}
	| {type: 'authMethods'; methods: AuthMethod[]}
	| {type: 'authError'; message?: string}
	| {type: 'configOptions'; options: SessionConfigOption[]}
	| {type: 'logout'}
	| {type: 'sessionReady'; sessionId: string; modes?: ModeInfo[]; mode?: string}
	| {type: 'update'; update: SessionUpdate}
	| {type: 'permission'; req: PermissionReq}
	| {type: 'permissionDone'}
	| {type: 'userSubmit'; text: string}
	| {type: 'turnEnd'; stopReason: string}
	| {type: 'systemMsg'; text: string; bright?: string}
	| {type: 'clear'}
	| {type: 'toggleSidebar'}
	| {type: 'setMode'; mode: string}
	| {type: 'queueMsg'; text: string}
	| {type: 'clearQueue'}
	| {type: 'toggleExpandTools'}
	| {type: 'notice'; text?: string};

/** Devin-specific fields carried in a tool_call(_update)'s `_meta`:
 *  `terminal_exit.exit_code` and `cognition.ai/cwd`. */
function toolMeta(update: {_meta?: unknown}): {
	exitCode?: number;
	cwd?: string;
} {
	const m = update._meta as Record<string, unknown> | undefined;
	if (!m) return {};
	const te = m['terminal_exit'] as {exit_code?: unknown} | undefined;
	const cwd = m['cognition.ai/cwd'];
	return {
		exitCode:
			typeof te?.exit_code === 'number' ? te.exit_code : undefined,
		cwd: typeof cwd === 'string' ? cwd : undefined,
	};
}

/** Close any streaming agent item — a different item kind is about to follow. */
function closeStreaming(items: TranscriptItem[]): TranscriptItem[] {
	if (!items.some(it => it.kind === 'agent' && it.streaming)) return items;
	return items.map(it =>
		it.kind === 'agent' && it.streaming ? {...it, streaming: false} : it,
	);
}

function applyUpdate(state: State, update: SessionUpdate): State {
	const items = [...state.items];
	switch (update.sessionUpdate) {
		case 'agent_message_chunk': {
			const block = update.content;
			if (block.type !== 'text') return state;
			const last = items[items.length - 1];
			if (last && last.kind === 'agent' && last.streaming) {
				items[items.length - 1] = {...last, text: last.text + block.text};
			} else {
				items.push({kind: 'agent', id: id(), text: block.text, streaming: true});
			}
			return {...state, items};
		}
		case 'agent_thought_chunk': {
			const block = update.content;
			if (block.type !== 'text') return state;
			const items2 = closeStreaming(items);
			const last = items2[items2.length - 1];
			if (last && last.kind === 'thought') {
				items2[items2.length - 1] = {...last, text: last.text + block.text};
			} else {
				items2.push({kind: 'thought', id: id(), text: block.text});
			}
			return {...state, items: items2};
		}
		case 'tool_call': {
			const items2 = closeStreaming(items);
			const meta = toolMeta(update);
			items2.push({
				kind: 'tool',
				id: id(),
				toolCallId: update.toolCallId,
				toolKind: update.kind ?? 'other',
				title: update.title ?? '',
				status: update.status ?? 'pending',
				content: update.content ?? undefined,
				locations: update.locations ?? undefined,
				rawInput: update.rawInput,
				rawOutput: update.rawOutput,
				exitCode: meta.exitCode,
				toolCwd: meta.cwd,
			});
			return {...state, items: items2, toolCalls: state.toolCalls + 1};
		}
		case 'tool_call_update': {
			const idx = items.findIndex(
				it => it.kind === 'tool' && it.toolCallId === update.toolCallId,
			);
			if (idx === -1) return state;
			const it = items[idx];
			if (it.kind !== 'tool') return state;
			const meta = toolMeta(update);
			items[idx] = {
				...it,
				toolKind: update.kind ?? it.toolKind,
				title: update.title ?? it.title,
				status: update.status ?? it.status,
				content: update.content ?? it.content,
				locations: update.locations ?? it.locations,
				rawInput: update.rawInput ?? it.rawInput,
				rawOutput: update.rawOutput ?? it.rawOutput,
				exitCode: meta.exitCode ?? it.exitCode,
				toolCwd: meta.cwd ?? it.toolCwd,
			};
			return {...state, items};
		}
		case 'plan': {
			return {
				...state,
				plan: update.entries.map(e => ({content: e.content, status: e.status})),
			};
		}
		case 'available_commands_update': {
			return {
				...state,
				commands: update.availableCommands.map(c => ({
					name: c.name,
					description: c.description ?? '',
				})),
			};
		}
		case 'current_mode_update': {
			return {...state, mode: update.currentModeId};
		}
		case 'config_option_update': {
			return {...state, configOptions: update.configOptions};
		}
		case 'usage_update': {
			return {...state, usage: {used: update.used, size: update.size}};
		}
		case 'session_info_update': {
			return {...state, sessionTitle: update.title ?? undefined};
		}
		default:
			// user_message_chunk, plan_update, etc. — ignored, not fatal.
			return state;
	}
}

export function reducer(state: State, action: Action): State {
	switch (action.type) {
		case 'status':
			return {...state, status: action.status};
		case 'logFile':
			return {...state, logFile: action.path};
		case 'bootStep': {
			return {
				...state,
				boot: state.boot.map(s =>
					s.id === action.id
						? {...s, state: action.state, detail: action.detail ?? s.detail}
						: s,
				),
			};
		}
		case 'bootInsert': {
			const idx = state.boot.findIndex(s => s.id === action.before);
			const boot = [...state.boot];
			boot.splice(idx === -1 ? boot.length : idx, 0, action.step);
			return {...state, boot};
		}
		case 'fail': {
			return {
				...state,
				status: 'error',
				error: state.error ?? action.message,
				boot: state.boot.map(s => (s.state === 'active' ? {...s, state: 'failed'} : s)),
			};
		}
		case 'agentInfo':
			return {...state, agentTitle: action.title};
		case 'authMethods':
			return {...state, authMethods: action.methods};
		case 'authError':
			return {...state, authError: action.message};
		case 'configOptions':
			return {...state, configOptions: action.options};
		case 'logout':
			return {
				...state,
				status: 'needsAuth',
				sessionId: undefined,
				mode: undefined,
				modes: [],
				items: [],
				plan: [],
				commands: [],
				configOptions: [],
				turns: 0,
				toolCalls: 0,
				turnStartedAt: undefined,
				permission: undefined,
				authError: undefined,
				queued: [],
				usage: undefined,
				sessionTitle: undefined,
			};
		case 'sessionReady': {
			return {
				...state,
				status: 'idle',
				authError: undefined,
				sessionId: action.sessionId,
				modes: action.modes ?? [],
				mode: action.mode,
			};
		}
		case 'update':
			return applyUpdate(state, action.update);
		case 'permission':
			return {...state, permission: action.req};
		case 'permissionDone':
			return {...state, permission: undefined};
		case 'userSubmit': {
			return {
				...state,
				status: 'working',
				turns: state.turns + 1,
				turnStartedAt: Date.now(),
				items: [
					...closeStreaming(state.items),
					{kind: 'user', id: id(), text: action.text},
				],
				notice: undefined,
			};
		}
		case 'turnEnd': {
			const items = state.items.map(it =>
				it.kind === 'agent' && it.streaming ? {...it, streaming: false} : it,
			);
			return {
				...state,
				status: 'idle',
				items,
				turnStartedAt: undefined,
				permission: undefined,
			};
		}
		case 'systemMsg':
			return {
				...state,
				items: [
					...closeStreaming(state.items),
					{
						kind: 'system',
						id: id(),
						text: action.text,
						bright: action.bright,
					},
				],
			};
		case 'clear':
			return {
				...state,
				items: [],
				plan: [],
				commands: [],
				turns: 0,
				toolCalls: 0,
				turnStartedAt: undefined,
				queued: [],
				usage: undefined,
				sessionTitle: undefined,
			};
		case 'toggleSidebar':
			return {...state, sidebar: !state.sidebar};
		case 'setMode':
			return {...state, mode: action.mode};
		case 'queueMsg':
			return {...state, queued: [...state.queued, action.text]};
		case 'clearQueue':
			return {...state, queued: []};
		case 'toggleExpandTools':
			return {...state, expandTools: !state.expandTools};
		case 'notice':
			return {...state, notice: action.text};
		default:
			return state;
	}
}

// ---- session config option helpers ----------------------------------------

/** Find a select-type config option by semantic category (then by id). */
export function findConfigOption(
	s: State,
	kind: 'mode' | 'model' | 'model_config' | 'thought_level',
): SessionConfigOption | undefined {
	return (
		s.configOptions.find(o => o.type === 'select' && o.category === kind) ??
		s.configOptions.find(o => o.type === 'select' && o.id === kind)
	);
}

/** The display name of a select option's current value. */
export function configLabel(opt: SessionConfigOption): string | undefined {
	if (opt.type !== 'select') return undefined;
	const opts = opt.options;
	for (const o of opts) {
		if ('group' in o) {
			const hit = o.options.find(v => v.value === opt.currentValue);
			if (hit) return hit.name;
		} else if (o.value === opt.currentValue) {
			return o.name;
		}
	}
	return String(opt.currentValue);
}

/** Flatten a select option's (possibly grouped) values. */
export function configValues(
	opt: SessionConfigOption,
): {value: string; name: string}[] {
	if (opt.type !== 'select') return [];
	const out: {value: string; name: string}[] = [];
	for (const o of opt.options) {
		if ('group' in o) out.push(...o.options.map(v => ({value: v.value, name: v.name})));
		else out.push({value: o.value, name: o.name});
	}
	return out;
}

/** Whether a select option's values arrive grouped. */
export function configGroups(
	opt: SessionConfigOption,
): {name: string; options: {value: string; name: string}[]}[] | null {
	if (opt.type !== 'select') return null;
	if (opt.options.length === 0 || !('group' in opt.options[0])) return null;
	return (opt.options as {name: string; options: {value: string; name: string}[]}[]).map(
		g => ({name: g.name, options: g.options}),
	);
}

/** Model label for the meta row / status bar: current config value, else --model. */
export function displayModel(s: State): string | undefined {
	const opt = findConfigOption(s, 'model');
	return (opt && configLabel(opt)) ?? s.model;
}

/** Mode display name: modes.name, else the mode config option's value
 *  name, else the raw id. */
export function displayMode(s: State): string | undefined {
	if (!s.mode) return undefined;
	const named = s.modes.find(m => m.id === s.mode)?.name;
	if (named) return named;
	const opt = findConfigOption(s, 'mode');
	const label = opt ? configValues(opt).find(v => v.value === s.mode)?.name : undefined;
	return label ?? s.mode;
}
