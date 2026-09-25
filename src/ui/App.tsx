import React, {
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from 'react';
import {Box, useInput, usePaste, useWindowSize} from 'ink';
import {
	RequestError,
	type RequestPermissionOutcome,
} from '@agentclientprotocol/sdk';
import {AgentConn} from '../acp/connection.js';
import {
	configValues,
	findConfigOption,
	initialState,
	reducer,
	type AuthMethod,
	type SlashCommand,
	type State,
} from '../state/store.js';
import {Line, useTick} from './Line.js';
import {homeLines} from './home.js';
import {contentWidth, sessionLines} from './session.js';
import {loadCatalog, type CatalogState} from '../catalog.js';
import {
	asImage,
	buildBlocks,
	listProjectFiles,
	matchFile,
	mentionToken,
	moveVertical,
	resolveMentions,
	tokenEndingAt,
	type ImageAttachment,
} from '../composer.js';
import {
	agentCommands,
	commandPanelBlock,
	dimScreen,
	filterHelp,
	filterPanelItems,
	helpBlock,
	helpEntries,
	panelItems,
	spliceCentered,
	type HandoffInfo,
	type PanelItem,
} from './overlays.js';
import {
	defaultSidekickIdx,
	filterFusion,
	filterResume,
	filteredOptions,
	fusionData,
	sortSessions,
	type FusionView,
	type PickerView,
	type ResumeView,
} from './picker.js';
import {transcriptDigest} from './transcript.js';
import {
	buildHandoffPrompt,
	gatherGitContext,
	sendHandoff,
} from '../handoff.js';
import type {Seg} from './lines.js';

function errMsg(e: unknown): string {
	if (e instanceof RequestError) return `${e.message} (code ${e.code})`;
	if (e instanceof Error) return e.message;
	return String(e);
}

function isAuthError(e: unknown): boolean {
	// -32000 is the generic JSON-RPC server error — only the message
	// identifies the not-authenticated case (real Devin: "ACP host has not
	// authenticated…").
	const msg = e instanceof Error ? e.message : String(e);
	return /not authenticated/i.test(msg);
}

const LOCAL_COMMANDS: SlashCommand[] = [
	{name: 'model', description: 'switch model and effort', local: true},
	{name: 'fusion', description: 'choose a Fusion lead + sidekick', local: true},
	{name: 'resume', description: 'resume a previous session', local: true},
	{name: 'handoff', description: 'hand off to a cloud Devin', local: true},
	{name: 'login', description: 'sign in to the agent', local: true},
	{name: 'logout', description: 'sign out of the agent', local: true},
	{name: 'status', description: 'show session status', local: true},
	{name: 'clear', description: 'start a fresh session', local: true},
	{name: 'sidebar', description: 'toggle the plan block', local: true},
	{name: 'help', description: 'show commands and keys', local: true},
	{name: 'exit', description: 'exit devin-tui', local: true},
	{name: 'quit', description: 'exit devin-tui', local: true},
];

/** The /help Keys section — keep in sync with the useInput handling below. */
export const HELP_KEYS: readonly {key: string; desc: string}[] = [
	{key: 'enter', desc: 'send (queues while Devin works)'},
	{key: 'alt+enter', desc: 'insert a newline (ctrl+j too)'},
	{key: '@', desc: 'add a file to the prompt'},
	{key: 'image path', desc: 'drag or paste an image to attach'},
	{key: 'esc esc', desc: 'interrupt the running turn'},
	{key: 'ctrl+p', desc: 'command panel'},
	{key: 'ctrl+o', desc: 'expand/collapse command output'},
	{key: 'ctrl+b', desc: 'toggle plan'},
	{key: 'shift+tab', desc: 'cycle mode'},
	{key: 'pgup/pgdn', desc: 'scroll transcript'},
	{key: 'shift+↑/↓', desc: 'scroll one line'},
	{key: '↑/↓', desc: 'cursor line / prompt history'},
	{key: '/', desc: 'slash commands'},
	{key: 'ctrl+c ctrl+c', desc: 'quit'},
];

/** `/abc` (no space yet) → 'abc' filter for the slash dropdown. */
function slashFilter(value: string): string | null {
	const m = /^\/(\S*)$/.exec(value);
	return m ? m[1] : null;
}

interface Props {
	cwd: string;
	model?: string;
	command: string;
	/** 'continue' = newest session for cwd; otherwise a session id */
	resume?: string;
	onQuit: () => void;
	onConn: (c: AgentConn) => void;
}

export function App({cwd, model, command, resume, onQuit, onConn}: Props): React.JSX.Element {
	const [state, dispatch] = useReducer(reducer, undefined, () =>
		initialState(cwd, model, ''),
	);
	const {columns: cols, rows} = useWindowSize();
	const tick = useTick(80);
	const [prompt, setPrompt] = useState({value: '', cursor: 0});
	const promptRef = useRef(prompt);
	promptRef.current = prompt;
	const [paletteSel, setPaletteSel] = useState(0);
	const [permSel, setPermSel] = useState(0);
	const [scrollOffset, setScrollOffset] = useState(0);
	const [panelOpen, setPanelOpen] = useState(false);
	const [panelQuery, setPanelQuery] = useState('');
	const [panelSel, setPanelSel] = useState(0);
	const [helpOpen, setHelpOpen] = useState(false);
	const [helpQuery, setHelpQuery] = useState('');
	const [helpSel, setHelpSel] = useState(0);
	const [authSel, setAuthSel] = useState(0);
	const [picker, setPicker] = useState<PickerView | null>(null);
	const [fusion, setFusion] = useState<FusionView | null>(null);
	const [resumeView, setResumeView] = useState<ResumeView | null>(null);
	// pending /handoff confirmation — prompt prebuilt, shown above composer
	const [handoff, setHandoff] = useState<(HandoffInfo & {prompt: string}) | null>(null);
	// model pricing catalog for the /model + /fusion pickers — loaded
	// once, non-blocking (CLI → ~/.cache → unavailable)
	const [catalog, setCatalog] = useState<CatalogState>({status: 'loading'});
	useEffect(() => {
		let live = true;
		void loadCatalog().then(cs => {
			if (live) setCatalog(cs);
		});
		return () => {
			live = false;
		};
	}, []);
	// image attachment chips (▣) + the @file dropdown
	const [atts, setAtts] = useState<ImageAttachment[]>([]);
	const [files, setFiles] = useState<string[] | null>(null);
	const [mentionSel, setMentionSel] = useState(0);
	const [mentionDismiss, setMentionDismiss] = useState<number | null>(null);

	const connRef = useRef<AgentConn | null>(null);
	const stateRef = useRef<State>(state);
	stateRef.current = state;
	const authSelRef = useRef(authSel);
	authSelRef.current = authSel;
	const pickerRef = useRef<PickerView | null>(picker);
	pickerRef.current = picker;
	const fusionRef = useRef<FusionView | null>(fusion);
	fusionRef.current = fusion;
	const resumeRef = useRef<ResumeView | null>(resumeView);
	resumeRef.current = resumeView;
	/** -c/-r session-load intent; survives the auth detour */
	const pendingResume = useRef(resume);
	const filesRef = useRef<string[] | null>(null);
	filesRef.current = files;
	const attsRef = useRef<ImageAttachment[]>(atts);
	attsRef.current = atts;
	/** image attachments stashed with queued guidance while working */
	const queuedAtts = useRef<ImageAttachment[]>([]);
	const panelOpenRef = useRef(panelOpen);
	panelOpenRef.current = panelOpen;
	const helpOpenRef = useRef(helpOpen);
	helpOpenRef.current = helpOpen;
	const handoffRef = useRef(handoff);
	handoffRef.current = handoff;
	const permResolve = useRef<((o: RequestPermissionOutcome) => void) | null>(null);
	const authMethods = useRef<AuthMethod[]>([]);
	const history = useRef<string[]>([]);
	const histIdx = useRef(-1);
	const histStash = useRef('');
	const lastCtrlC = useRef(0);
	const lastEsc = useRef(0);
	const ready = useRef(false);

	// ---- connection lifecycle ------------------------------------------------

	const tryNewSession = useCallback(async (conn: AgentConn) => {
		dispatch({type: 'bootStep', id: 'session', state: 'active'});
		const res = await conn.newSession();
		dispatch({type: 'bootStep', id: 'session', state: 'done'});
		conn.writeSessionConfig(res);
		dispatch({type: 'configOptions', options: res.configOptions ?? []});
		dispatch({
			type: 'sessionReady',
			sessionId: res.sessionId,
			modes: res.modes?.availableModes.map(m => ({id: m.id, name: m.name})),
			mode: res.modes?.currentModeId,
		});
		ready.current = true;
	}, []);

	/** session/load — wipes the session view state, replays the agent's
	 *  history updates into it, then applies the load response like
	 *  sessionReady (modes, config options, session-config.json). */
	const loadSessionInto = useCallback(
		async (conn: AgentConn, sessionId: string) => {
			dispatch({type: 'bootStep', id: 'session', state: 'active'});
			dispatch({type: 'loadStart'});
			setScrollOffset(0);
			setPrompt({value: '', cursor: 0});
			try {
				const res = await conn.loadSession(sessionId);
				conn.writeSessionConfig(res);
				dispatch({type: 'configOptions', options: res.configOptions ?? []});
				dispatch({
					type: 'sessionReady',
					sessionId,
					modes: res.modes?.availableModes.map(m => ({
						id: m.id,
						name: m.name,
					})),
					mode: res.modes?.currentModeId,
				});
				dispatch({type: 'bootStep', id: 'session', state: 'done'});
				ready.current = true;
			} finally {
				dispatch({type: 'loadEnd'});
			}
		},
		[],
	);

	/** -c/--continue + -r/--resume — pick a session id, then session/load.
	 *  Returns true when a session was loaded; dispatches its own system
	 *  lines for the unsupported/empty/failed cases. */
	const tryResume = useCallback(
		async (conn: AgentConn, want: string): Promise<boolean> => {
			if (!conn.canLoadSession) {
				dispatch({
					type: 'systemMsg',
					text: 'session resume not supported by this agent',
				});
				return false;
			}
			let id: string | undefined;
			if (want === 'continue') {
				if (!conn.canListSessions) {
					dispatch({
						type: 'systemMsg',
						text: 'session resume not supported by this agent',
					});
					return false;
				}
				let list: Awaited<ReturnType<AgentConn['listSessions']>> = [];
				try {
					list = await conn.listSessions();
				} catch (e) {
					if (isAuthError(e)) throw e; // sign-in first, then retry
					list = [];
				}
				id = sortSessions(
					list.filter(si => !si.cwd || si.cwd === cwd),
				)[0]?.sessionId;
				if (!id) {
					dispatch({
						type: 'systemMsg',
						text: 'no previous session in this folder',
					});
					return false;
				}
			} else {
				id = want;
			}
			try {
				await loadSessionInto(conn, id);
				return true;
			} catch (e) {
				if (isAuthError(e)) throw e;
				dispatch({
					type: 'systemMsg',
					text: `resume failed: ${errMsg(e)}`,
				});
				return false;
			}
		},
		[cwd, loadSessionInto],
	);

	/** session/new (or session/load for -c/-r) — on the not-authenticated
	 *  error, fall back to the needsAuth sign-in menu instead of
	 *  auto-authenticating. */
	const openSession = useCallback(
		async (conn: AgentConn) => {
			try {
				const want = pendingResume.current;
				if (want !== undefined) {
					const done = await tryResume(conn, want);
					pendingResume.current = undefined;
					if (done) return;
					await tryNewSession(conn);
					return;
				}
				await tryNewSession(conn);
			} catch (e) {
				if (!isAuthError(e) || authMethods.current.length === 0) throw e;
				dispatch({type: 'bootStep', id: 'session', state: 'pending'});
				dispatch({type: 'authMethods', methods: authMethods.current});
				dispatch({type: 'status', status: 'needsAuth'});
			}
		},
		[tryNewSession, tryResume],
	);

	/** Explicit sign-in: needsAuth menu Enter or /login while signed out. */
	const doAuth = useCallback(
		async (methodId: string) => {
			const conn = connRef.current;
			if (!conn || !methodId) return;
			dispatch({type: 'authError'});
			const authStep = {
				id: 'auth',
				label: 'authenticating',
				state: 'active' as const,
				detail: 'waiting for browser sign-in…',
			};
			if (stateRef.current.boot.some(b => b.id === 'auth')) {
				dispatch({type: 'bootStep', id: 'auth', state: 'active', detail: authStep.detail});
			} else {
				dispatch({type: 'bootInsert', step: authStep, before: 'session'});
			}
			dispatch({type: 'status', status: 'auth'});
			try {
				await conn.authenticate(methodId);
				dispatch({type: 'bootStep', id: 'auth', state: 'done'});
				await openSession(conn);
			} catch (e) {
				dispatch({type: 'bootStep', id: 'auth', state: 'failed', detail: errMsg(e)});
				dispatch({type: 'authError', message: errMsg(e)});
				dispatch({type: 'status', status: 'needsAuth'});
			}
		},
		[openSession],
	);

	/** /login — in needsAuth picks the first method; signed in re-authenticates. */
	const doLogin = useCallback(async () => {
		const conn = connRef.current;
		const method = authMethods.current[0];
		if (!conn || !method) {
			dispatch({type: 'systemMsg', text: 'no auth methods available'});
			return;
		}
		const s = stateRef.current;
		if (s.status === 'needsAuth' || !s.sessionId) {
			void doAuth(method.id);
			return;
		}
		try {
			await conn.authenticate(method.id);
			dispatch({type: 'systemMsg', text: 're-authenticated'});
		} catch (e) {
			dispatch({type: 'systemMsg', text: `login failed: ${errMsg(e)}`});
		}
	}, [doAuth]);

	/** /logout — conn.logout, then reset to the needsAuth home menu. */
	const doLogout = useCallback(async () => {
		const conn = connRef.current;
		if (!conn) return;
		try {
			await conn.logout();
			conn.sessionId = undefined;
			ready.current = false;
			dispatch({type: 'logout'});
			dispatch({type: 'authMethods', methods: authMethods.current});
		} catch (e) {
			dispatch({type: 'systemMsg', text: `logout: ${errMsg(e)}`});
		}
	}, []);

	/** /status — one system line summarizing the connection. */
	const doStatus = useCallback(() => {
		const s = stateRef.current;
		const signed = s.sessionId ? 'signed in' : 'signed out';
		const sid = s.sessionId ? s.sessionId.slice(0, 8) : '—';
		dispatch({
			type: 'systemMsg',
			text: `${signed} · ${s.agentTitle ?? 'agent'} · session ${sid} · log ${s.logFile ?? '—'}`,
		});
	}, []);

	/** /handoff — gather git context + transcript digest, then show the
	 *  inline confirm block (Enter sends, Esc cancels). */
	const prepareHandoff = useCallback(async (task: string) => {
		try {
			const s = stateRef.current;
			const gc = await gatherGitContext(s.cwd);
			const context = transcriptDigest(s);
			setHandoff({
				task,
				repo: gc.repo,
				branch: gc.branch,
				diffKb: gc.diff ? Math.ceil(Buffer.byteLength(gc.diff) / 1024) : 0,
				contextKb: context
					? Math.ceil(Buffer.byteLength(context) / 1024)
					: 0,
				prompt: buildHandoffPrompt(task, {...gc, context}),
			});
		} catch (e) {
			dispatch({type: 'systemMsg', text: `handoff failed: ${errMsg(e)}`});
		}
	}, []);

	/** /handoff confirm → POST to the Devin API (key only in the header). */
	const doHandoff = useCallback(async (h: HandoffInfo & {prompt: string}) => {
		setHandoff(null);
		try {
			const url = await sendHandoff(h.prompt, h.task);
			dispatch({type: 'systemMsg', text: '◆ handed off → ', bright: url});
		} catch (e) {
			dispatch({type: 'systemMsg', text: `handoff failed: ${errMsg(e)}`});
		}
	}, []);

	useEffect(() => {
		const conn = new AgentConn(
			{command, cwd, model},
			{
				onUpdate: n => {
				dispatch({type: 'update', update: n.update});
				if (n.update.sessionUpdate === 'session_info_update') {
					const t = n.update.title;
					try {
						process.stdout.write(
							`\x1b]0;${t ? `devin: ${t}` : 'devin-tui'}\x07`,
						);
					} catch {
						// title is cosmetic
					}
				}
			},
				onPermissionRequest: req =>
					new Promise<RequestPermissionOutcome>(res => {
						permResolve.current = res;
						setPermSel(0);
						setScrollOffset(0); // tail-follow so the prompt is visible
						const tcMeta = (req.toolCall as {_meta?: Record<string, unknown>})
							._meta;
						const editable = tcMeta?.['cognition.ai/editableCommand'];
						dispatch({
							type: 'permission',
							req: {
								toolCallId: req.toolCall.toolCallId,
								title: req.toolCall.title ?? 'tool call',
								toolKind: req.toolCall.kind ?? 'other',
								options: req.options,
								editableCommand:
									typeof editable === 'string' ? editable : undefined,
							},
						});
					}),
				onLog: () => {},
				onSpawnError: err =>
					dispatch({
						type: 'fail',
						message: `could not start "${command}" in ${cwd}: ${err.message}`,
					}),
				onExit: (code, signal) => {
					if (!ready.current) {
						dispatch({
							type: 'fail',
							message: `agent exited early (code ${code ?? 'null'} signal ${signal ?? 'none'})`,
						});
					} else {
						dispatch({
							type: 'systemMsg',
							text: `agent process exited (code ${code ?? 'null'})`,
						});
						dispatch({type: 'turnEnd', stopReason: 'error'});
					}
				},
			},
		);
		connRef.current = conn;
		onConn(conn);
		dispatch({type: 'logFile', path: conn.logFile});
		(async () => {
			try {
				dispatch({type: 'bootStep', id: 'spawn', state: 'active'});
				conn.spawn();
				dispatch({type: 'bootStep', id: 'spawn', state: 'done'});
				dispatch({type: 'bootStep', id: 'handshake', state: 'active'});
				const init = await conn.initialize();
				authMethods.current = init.authMethods ?? [];
				dispatch({
					type: 'agentInfo',
					title:
						init.agentInfo?.title ?? init.agentInfo?.name ?? 'agent',
				});
				dispatch({
					type: 'bootStep',
					id: 'handshake',
					state: 'done',
					detail:
						init.agentInfo?.title ??
						init.agentInfo?.name ??
						`protocol v${init.protocolVersion}`,
				});
				await openSession(conn);
			} catch (e) {
				dispatch({type: 'fail', message: errMsg(e)});
			}
		})();
		return () => conn.dispose();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// ---- actions --------------------------------------------------------------

	const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const flash = useCallback((text: string, ms = 1500) => {
		dispatch({type: 'notice', text});
		if (noticeTimer.current) clearTimeout(noticeTimer.current);
		noticeTimer.current = setTimeout(
			() => dispatch({type: 'notice', text: undefined}),
			ms,
		);
	}, []);

	const resolvePermission = useCallback((optionId?: string) => {
		const r = permResolve.current;
		permResolve.current = null;
		dispatch({type: 'permissionDone'});
		r?.(optionId ? {outcome: 'selected', optionId} : {outcome: 'cancelled'});
	}, []);

	const cancelTurn = useCallback(() => {
		if (permResolve.current) resolvePermission(undefined);
		const conn = connRef.current;
		if (conn && stateRef.current.status === 'working') {
			conn.cancel().catch(() => {});
		}
	}, [resolvePermission]);

	/** /model — open the inline model picker (needs a live session + option). */
	const openPicker = useCallback(() => {
		const s = stateRef.current;
		if (s.status === 'working') {
			flash('agent is working — esc to cancel');
			return;
		}
		const modelOpt = findConfigOption(s, 'model');
		if (!s.sessionId || !modelOpt) {
			dispatch({type: 'systemMsg', text: 'model switching not available'});
			return;
		}
		const effortOpt = findConfigOption(s, 'thought_level');
		const evals = effortOpt ? configValues(effortOpt) : [];
		const opts = configValues(modelOpt);
		setPicker({
			sel: Math.max(0, opts.findIndex(o => o.value === modelOpt.currentValue)),
			filter: '',
			effortIdx: Math.max(
				0,
				evals.findIndex(o => o.value === effortOpt?.currentValue),
			),
		});
	}, [flash]);

	/** Picker Enter — push model then thought_level via set_config_option. */
	const applyPicker = useCallback(async () => {
		const s = stateRef.current;
		const p = pickerRef.current;
		const conn = connRef.current;
		const modelOpt = findConfigOption(s, 'model');
		const effortOpt = findConfigOption(s, 'thought_level');
		if (!conn || !p || !modelOpt) {
			setPicker(null);
			return;
		}
		const filtered = filteredOptions(modelOpt, p.filter);
		const chosen = filtered[Math.min(p.sel, Math.max(0, filtered.length - 1))];
		const evals = effortOpt ? configValues(effortOpt) : [];
		const effortVal = evals[Math.min(p.effortIdx, Math.max(0, evals.length - 1))];
		setPicker(null);
		try {
			if (chosen && chosen.value !== modelOpt.currentValue) {
				const opts = await conn.setConfigOption(modelOpt.id, chosen.value);
				if (opts) dispatch({type: 'configOptions', options: opts});
			}
			if (
				effortOpt &&
				effortVal &&
				effortVal.value !== effortOpt.currentValue
			) {
				const opts = await conn.setConfigOption(effortOpt.id, effortVal.value);
				if (opts) dispatch({type: 'configOptions', options: opts});
			}
		} catch (e) {
			dispatch({type: 'systemMsg', text: `set_config_option: ${errMsg(e)}`});
		}
	}, []);

	/** /fusion — inline lead+sidekick picker over fusion-* model options. */
	const openFusion = useCallback(() => {
		const s = stateRef.current;
		if (s.status === 'working') {
			flash('agent is working — esc to cancel');
			return;
		}
		const modelOpt = findConfigOption(s, 'model');
		const leads = modelOpt ? fusionData(modelOpt) : [];
		if (!s.sessionId || !modelOpt || leads.length === 0) {
			dispatch({
				type: 'systemMsg',
				text: `Fusion isn't available for this account`,
			});
			return;
		}
		const curIdx = leads.findIndex(l =>
			l.pairs.some(p => p.value === modelOpt.currentValue),
		);
		setFusion({sel: Math.max(0, curIdx), filter: '', sk: {}});
	}, [flash]);

	/** /resume — list this cwd's sessions and open the inline picker. */
	const openResume = useCallback(async () => {
		const s = stateRef.current;
		const conn = connRef.current;
		if (s.status === 'working') {
			flash('agent is working — esc to cancel');
			return;
		}
		if (!conn || !conn.canLoadSession || !conn.canListSessions) {
			dispatch({
				type: 'systemMsg',
				text: 'session resume not supported by this agent',
			});
			return;
		}
		if (!s.sessionId) {
			dispatch({type: 'systemMsg', text: 'sign in to resume a session'});
			return;
		}
		let list: Awaited<ReturnType<AgentConn['listSessions']>>;
		try {
			list = await conn.listSessions();
		} catch (e) {
			dispatch({
				type: 'systemMsg',
				text: `session list failed: ${errMsg(e)}`,
			});
			return;
		}
		const mine = sortSessions(
			list.filter(si => !si.cwd || si.cwd === cwd),
		);
		if (mine.length === 0) {
			dispatch({
				type: 'systemMsg',
				text: 'no previous sessions in this folder',
			});
			return;
		}
		setPrompt({value: '', cursor: 0});
		setPaletteSel(0);
		setResumeView({sel: 0, filter: '', sessions: mine});
	}, [flash, cwd]);

	/** Fusion Enter — set_config_option(model = <chosen pair value>). */
	const applyFusion = useCallback(async () => {
		const s = stateRef.current;
		const f = fusionRef.current;
		const conn = connRef.current;
		const modelOpt = findConfigOption(s, 'model');
		setFusion(null);
		if (!conn || !f || !modelOpt) return;
		const leads = filterFusion(fusionData(modelOpt), f.filter);
		const lead = leads[Math.min(f.sel, Math.max(0, leads.length - 1))];
		if (!lead) return;
		const skIdx = Math.min(
			f.sk[lead.name] ?? defaultSidekickIdx(lead, modelOpt.currentValue),
			lead.pairs.length - 1,
		);
		const pair = lead.pairs[Math.max(0, skIdx)];
		if (!pair || pair.value === modelOpt.currentValue) return;
		try {
			const opts = await conn.setConfigOption(modelOpt.id, pair.value);
			if (opts) dispatch({type: 'configOptions', options: opts});
		} catch (e) {
			dispatch({type: 'systemMsg', text: `set_config_option: ${errMsg(e)}`});
		}
	}, []);

	/** Send one prompt; on a clean turn end, flush queued guidance into the
	 *  next prompt automatically. Self-referenced via sendPromptRef. */
	const sendPromptRef = useRef<(t: string, images?: ImageAttachment[]) => void>(
		() => {},
	);
	const sendPrompt = useCallback((t: string, images: ImageAttachment[] = []) => {
		const conn = connRef.current;
		if (!conn || !t) return;
		history.current.push(t);
		histIdx.current = -1;
		const blocks = buildBlocks(t, images, stateRef.current.cwd);
		dispatch({type: 'userSubmit', text: t});
		conn
			.prompt(blocks)
			.then(r => {
				dispatch({type: 'turnEnd', stopReason: r.stopReason});
				if (r.stopReason === 'cancelled') {
					dispatch({type: 'systemMsg', text: 'turn cancelled'});
					return; // cancelled turns keep the queue for the next Enter
				}
				const q = stateRef.current.queued;
				if (q.length > 0) {
					dispatch({type: 'clearQueue'});
					sendPromptRef.current(
						q.join('\n\n'),
						queuedAtts.current.splice(0),
					);
				}
			})
			.catch(e => {
				dispatch({type: 'turnEnd', stopReason: 'error'});
				dispatch({type: 'systemMsg', text: `error: ${errMsg(e)}`});
			});
	}, []);
	sendPromptRef.current = sendPrompt;

	const submit = useCallback(
		(text: string) => {
			const conn = connRef.current;
			const t = text.trim();
			const s = stateRef.current;
			const working = s.status === 'working';
			if (!conn) return;
			if (!t) {
				// empty Enter while idle flushes a pending queue
				if (!working && s.queued.length > 0) {
					dispatch({type: 'clearQueue'});
					sendPrompt(s.queued.join('\n\n'));
				}
				return;
			}
			// like the Devin CLI: /exit, /quit, or bare `exit` / `quit`
			if (['/quit', '/exit', 'quit', 'exit'].includes(t.toLowerCase())) {
				onQuit();
				return;
			}
			if (t === '/sidebar') {
				dispatch({type: 'toggleSidebar'});
				setPrompt({value: '', cursor: 0});
				return;
			}
			if (
				working &&
				(t === '/clear' ||
					t === '/logout' ||
					t === '/model' ||
					t === '/fusion' ||
					t === '/resume' ||
					t === '/handoff' ||
					t.startsWith('/handoff '))
			) {
				flash('agent is working — esc to cancel');
				return;
			}
			if (t === '/handoff' || t.startsWith('/handoff ')) {
				setPrompt({value: '', cursor: 0});
				setPaletteSel(0);
				const handoffKey = process.env.DEVIN_API_KEY;
				if (!handoffKey) {
					dispatch({
						type: 'systemMsg',
						text: 'set DEVIN_API_KEY to use /handoff — create a PAT at app.devin.ai → Settings → Devin API → PATs',
					});
					return;
				}
				if (handoffKey.startsWith('cog_') && !process.env.DEVIN_ORG_ID) {
					dispatch({
						type: 'systemMsg',
						text: 'set DEVIN_ORG_ID too — cog_ keys (PATs / service users) need your organization id',
					});
					return;
				}
				const task =
					t.slice('/handoff'.length).trim() ||
					'Continue where the local session left off.';
				void prepareHandoff(task);
				return;
			}
			if (t === '/fusion') {
				openFusion();
				setPrompt({value: '', cursor: 0});
				setPaletteSel(0);
				return;
			}
			if (t === '/resume') {
				void openResume();
				setPrompt({value: '', cursor: 0});
				setPaletteSel(0);
				return;
			}
			if (t === '/model') {
				openPicker();
				setPrompt({value: '', cursor: 0});
				setPaletteSel(0);
				return;
			}
			if (t === '/login') {
				void doLogin();
				setPrompt({value: '', cursor: 0});
				setPaletteSel(0);
				return;
			}
			if (t === '/logout') {
				void doLogout();
				setPrompt({value: '', cursor: 0});
				setPaletteSel(0);
				return;
			}
			if (t === '/status') {
				doStatus();
				setPrompt({value: '', cursor: 0});
				setPaletteSel(0);
				return;
			}
			if (t === '/help') {
				openHelp();
				setPrompt({value: '', cursor: 0});
				setPaletteSel(0);
				return;
			}
			// ACP doesn't allow concurrent prompts — queue guidance typed
			// while the agent works; it's sent when the turn ends. Image
			// attachments ride along with the queued text.
			if (working) {
				dispatch({type: 'queueMsg', text: t});
				queuedAtts.current.push(...attsRef.current);
				setAtts([]);
				setPrompt({value: '', cursor: 0});
				setPaletteSel(0);
				setScrollOffset(0);
				return;
			}
			const imgs = attsRef.current;
			setAtts([]);
			setPrompt({value: '', cursor: 0});
			setPaletteSel(0);
			if (t === '/clear') {
				(async () => {
					try {
						dispatch({type: 'clear'});
						await openSession(conn);
						dispatch({type: 'systemMsg', text: 'new session started'});
					} catch (e) {
						dispatch({type: 'systemMsg', text: `clear failed: ${errMsg(e)}`});
						dispatch({type: 'turnEnd', stopReason: 'error'});
					}
				})();
				return;
			}
			// queued text survives a cancelled turn — prepend it here
			const q = s.queued;
			const full = q.length > 0 ? `${q.join('\n\n')}\n\n${t}` : t;
			if (q.length > 0) dispatch({type: 'clearQueue'});
			sendPrompt(full, [...queuedAtts.current.splice(0), ...imgs]);
		},
		[onQuit, openSession, flash, openPicker, doLogin, doLogout, doStatus, sendPrompt],
	);

	const cycleMode = useCallback(() => {
		const s = stateRef.current;
		const conn = connRef.current;
		if (!conn || !s.sessionId || s.modes.length === 0) return;
		const idx = s.modes.findIndex(m => m.id === s.mode);
		const next = s.modes[(idx + 1) % s.modes.length];
		dispatch({type: 'setMode', mode: next.id});
		conn
			.setMode(next.id)
			.catch(e => dispatch({type: 'systemMsg', text: `set_mode: ${errMsg(e)}`}));
	}, []);

	const openPanel = useCallback(() => {
		setPanelQuery('');
		setPanelSel(0);
		setPanelOpen(true);
	}, []);

	const openHelp = useCallback(() => {
		setHelpQuery('');
		setHelpSel(0);
		setHelpOpen(true);
	}, []);

	const runPanelItem = useCallback(
		(item: PanelItem | undefined) => {
			if (!item) return;
			setPanelOpen(false);
			switch (item.action.type) {
				case 'clear':
					submit('/clear');
					break;
				case 'togglePlan':
					dispatch({type: 'toggleSidebar'});
					break;
				case 'cycleMode':
					cycleMode();
					break;
				case 'toggleExpand':
					dispatch({type: 'toggleExpandTools'});
					break;
				case 'handoff':
					submit('/handoff');
					break;
				case 'fusion':
					openFusion();
					break;
				case 'resume':
					void openResume();
					break;
				case 'model':
					openPicker();
					break;
				case 'login':
					void doLogin();
					break;
				case 'logout':
					void doLogout();
					break;
				case 'status':
					doStatus();
					break;
				case 'help':
					openHelp();
					break;
				case 'insert':
					setPrompt({
						value: item.action.text,
						cursor: item.action.text.length,
					});
					break;
				case 'quit':
					onQuit();
					break;
			}
		},
		[submit, cycleMode, openPicker, openFusion, openResume, doLogin, doLogout, doStatus, openHelp, onQuit],
	);

	// ---- input ----------------------------------------------------------------

	/** Insert text at the cursor; \r\n|\r become real newlines. A token that
	 *  resolves to an existing image file becomes a ▣ chip instead of text. */
	const insertText = useCallback((text: string) => {
		const clean = text.replace(/\r\n|\r/g, '\n');
		const p = promptRef.current;
		let value = p.value.slice(0, p.cursor) + clean + p.value.slice(p.cursor);
		let cursor = p.cursor + clean.length;
		// image detection looks at the token the insertion ended on
		// (allow trailing whitespace from a drag-and-drop paste)
		const probe = value.slice(0, cursor).replace(/\s+$/, '');
		const tok = tokenEndingAt(value, probe.length);
		if (tok) {
			const img = asImage(tok.text, stateRef.current.cwd);
			if (img) {
				value = value.slice(0, tok.start) + value.slice(tok.end);
				cursor = tok.start;
				if (img === 'tooLarge') {
					dispatch({
						type: 'systemMsg',
						text: `image too large: ${tok.text} (max 5 MB)`,
					});
				} else {
					setAtts(prev => [...prev, img]);
				}
			}
		}
		setPrompt({value, cursor});
		setPaletteSel(0);
		setMentionSel(0);
		setScrollOffset(0);
	}, []);

	/** Any overlay/menu/pending state that should swallow a paste — mirrors
	 *  the gating in useInput. */
	const inputLocked = useCallback((s: State) => {
		if (s.status !== 'idle' && s.status !== 'working') return true;
		if (s.loading) return true;
		if (s.turns === 0 && s.status !== 'idle') return true;
		return (
			s.permission !== undefined ||
			pickerRef.current !== null ||
			fusionRef.current !== null ||
			resumeRef.current !== null ||
			panelOpenRef.current ||
			helpOpenRef.current ||
			handoffRef.current !== null
		);
	}, []);

	// @file mention state — the open token under the cursor, the lazily
	// loaded project file list, and the filtered dropdown rows
	const mentionTok = mentionToken(prompt.value, prompt.cursor);
	const mentionItems =
		mentionTok !== null && mentionTok.start !== mentionDismiss && files !== null
			? files
					.filter(f => matchFile(f, mentionTok.q))
					.slice(0, 8)
					.map(name => ({name}))
			: [];
	useEffect(() => {
		if (mentionTok === null || files !== null) return;
		let live = true;
		void listProjectFiles(state.cwd).then(list => {
			if (live) setFiles(list);
		});
		return () => {
			live = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [mentionTok !== null, files, state.cwd]);
	// a dismissed dropdown re-arms once the @token is gone
	useEffect(() => {
		if (mentionTok === null && mentionDismiss !== null)
			setMentionDismiss(null);
	}, [mentionTok, mentionDismiss]);

	// bracketed paste arrives as one string — real newlines, never a send
	usePaste(text => {
		if (inputLocked(stateRef.current)) return;
		insertText(text);
	});

	useInput((input, key) => {
		const s = stateRef.current;
		const isCtrlC = (key.ctrl && input === 'c') || input === '\x03';
		if (isCtrlC) {
			const now = Date.now();
			if (now - lastCtrlC.current < 1500) {
				onQuit();
			} else {
				lastCtrlC.current = now;
				flash('press ctrl+c again to quit', 1600);
			}
			return;
		}
		if (s.status === 'booting' || s.status === 'auth') {
			// during the browser auth flow, let the user bail out with q
			if (s.status === 'auth' && input === 'q') onQuit();
			return;
		}
		if (s.status === 'error' && !s.sessionId) {
			if (input === 'q') onQuit();
			return;
		}
		// sign-in menu captures all input while unauthenticated
		if (s.status === 'needsAuth') {
			const n = s.authMethods.length + 1; // methods + Quit
			if (key.upArrow) {
				setAuthSel(i => (i - 1 + n) % n);
			} else if (key.downArrow) {
				setAuthSel(i => (i + 1) % n);
			} else if (key.return) {
				const sel = authSelRef.current;
				if (sel >= s.authMethods.length) {
					onQuit();
				} else {
					void doAuth(s.authMethods[sel]?.id ?? '');
				}
			}
			return;
		}
		// a session/load replay streams in read-only
		if (s.loading) return;
		// home screen ignores typing until the session is ready
		if (s.turns === 0 && s.status !== 'idle') return;

		// model picker captures all input while open
		const pk = pickerRef.current;
		if (pk) {
			const modelOpt = findConfigOption(s, 'model');
			const effortOpt = findConfigOption(s, 'thought_level');
			const filtered = modelOpt
				? filteredOptions(modelOpt, pk.filter)
				: [];
			const evals = effortOpt ? configValues(effortOpt) : [];
			const n = Math.max(1, filtered.length);
			if (key.escape) {
				setPicker(null);
			} else if (key.upArrow) {
				setPicker({...pk, sel: (pk.sel - 1 + n) % n});
			} else if (key.downArrow) {
				setPicker({...pk, sel: (pk.sel + 1) % n});
			} else if (key.leftArrow && evals.length > 0) {
				setPicker({...pk, effortIdx: Math.max(0, pk.effortIdx - 1)});
			} else if (key.rightArrow && evals.length > 0) {
				setPicker({...pk, effortIdx: Math.min(evals.length - 1, pk.effortIdx + 1)});
			} else if (key.return) {
				void applyPicker();
			} else if (key.backspace || key.delete) {
				setPicker({...pk, filter: pk.filter.slice(0, -1), sel: 0});
			} else if (input && !key.ctrl && !key.meta) {
				setPicker({...pk, filter: pk.filter + input, sel: 0});
			}
			return;
		}

		// fusion picker captures all input while open
		const fu = fusionRef.current;
		if (fu) {
			const modelOpt = findConfigOption(s, 'model');
			const leads = modelOpt
				? filterFusion(fusionData(modelOpt), fu.filter)
				: [];
			const n = Math.max(1, leads.length);
			const sel = Math.min(fu.sel, n - 1);
			const lead = leads[sel];
			if (key.escape) {
				setFusion(null);
			} else if (key.upArrow) {
				setFusion({...fu, sel: (sel - 1 + n) % n});
			} else if (key.downArrow) {
				setFusion({...fu, sel: (sel + 1) % n});
			} else if ((key.leftArrow || key.rightArrow) && lead) {
				const cur =
					fu.sk[lead.name] ??
					defaultSidekickIdx(lead, modelOpt?.currentValue);
				const m = lead.pairs.length;
				const next =
					((cur + (key.rightArrow ? 1 : -1)) % m + m) % m;
				setFusion({...fu, sk: {...fu.sk, [lead.name]: next}});
			} else if (key.return) {
				void applyFusion();
			} else if (key.backspace || key.delete) {
				setFusion({...fu, filter: fu.filter.slice(0, -1), sel: 0});
			} else if (input && !key.ctrl && !key.meta) {
				setFusion({...fu, filter: fu.filter + input, sel: 0});
			}
			return;
		}

		// resume picker captures all input while open
		const rv = resumeRef.current;
		if (rv) {
			const list = filterResume(rv.sessions, rv.filter);
			const n = Math.max(1, list.length);
			if (key.escape) {
				setResumeView(null);
			} else if (key.upArrow) {
				setResumeView({...rv, sel: (rv.sel - 1 + n) % n});
			} else if (key.downArrow) {
				setResumeView({...rv, sel: (rv.sel + 1) % n});
			} else if (key.return) {
				const target = list[Math.min(rv.sel, list.length - 1)];
				setResumeView(null);
				const conn = connRef.current;
				if (target && conn) {
					void loadSessionInto(conn, target.sessionId).catch(e =>
						dispatch({
							type: 'systemMsg',
							text: `resume failed: ${errMsg(e)}`,
						}),
					);
				}
			} else if (key.backspace || key.delete) {
				setResumeView({...rv, filter: rv.filter.slice(0, -1), sel: 0});
			} else if (input && !key.ctrl && !key.meta) {
				setResumeView({...rv, filter: rv.filter + input, sel: 0});
			}
			return;
		}

		// inline permission prompt captures all input
		if (s.permission) {
			const opts = s.permission.options;
			if (key.upArrow) {
				setPermSel(i => (i - 1 + opts.length) % opts.length);
			} else if (key.downArrow) {
				setPermSel(i => (i + 1) % opts.length);
			} else if (key.return) {
				resolvePermission(opts[permSel]?.optionId);
			} else if (key.escape) {
				const rej = opts.find(o => o.kind === 'reject_once');
				resolvePermission(rej?.optionId);
			} else if (/^[1-9]$/.test(input)) {
				const opt = opts[Number(input) - 1];
				if (opt) resolvePermission(opt.optionId);
			} else if (input === 'y' || input === 'a' || input === 'n') {
				const kind =
					input === 'y' ? 'allow_once' : input === 'a' ? 'allow_always' : 'reject_once';
				const opt = opts.find(o => o.kind === kind);
				if (opt) resolvePermission(opt.optionId);
			}
			return;
		}

		// handoff confirmation captures all input while open
		if (handoff) {
			if (key.return) void doHandoff(handoff);
			else if (key.escape) setHandoff(null);
			return;
		}

		// command panel captures input while open
		if (panelOpen) {
			const items = filterPanelItems(panelItems(s), panelQuery);
			if (key.escape || (key.ctrl && input === 'p')) {
				setPanelOpen(false);
			} else if (key.upArrow) {
				setPanelSel(i => (i - 1 + Math.max(1, items.length)) % Math.max(1, items.length));
			} else if (key.downArrow) {
				setPanelSel(i => (i + 1) % Math.max(1, items.length));
			} else if (key.return) {
				runPanelItem(items[Math.min(panelSel, items.length - 1)]);
			} else if (key.backspace || key.delete) {
				setPanelQuery(q => q.slice(0, -1));
				setPanelSel(0);
			} else if (input && !key.ctrl && !key.meta) {
				setPanelQuery(q => q + input);
				setPanelSel(0);
			}
			return;
		}

		// help overlay captures input while open
		if (helpOpen) {
			const rows = filterHelp(
				helpEntries(s, LOCAL_COMMANDS, HELP_KEYS),
				helpQuery,
			);
			const flat = rows.flatMap(r => ('entry' in r ? [r.entry] : []));
			const n = Math.max(1, flat.length);
			if (key.escape) {
				setHelpOpen(false);
			} else if (key.upArrow) {
				setHelpSel(i => (i - 1 + n) % n);
			} else if (key.downArrow) {
				setHelpSel(i => (i + 1) % n);
			} else if (key.return) {
				const it = flat[Math.min(helpSel, flat.length - 1)];
				if (it?.insert) {
					setHelpOpen(false);
					setPrompt({value: it.insert, cursor: it.insert.length});
				}
			} else if (key.backspace || key.delete) {
				setHelpQuery(q => q.slice(0, -1));
				setHelpSel(0);
			} else if (input && !key.ctrl && !key.meta) {
				setHelpQuery(q => q + input);
				setHelpSel(0);
			}
			return;
		}

		// global keys
		if (key.ctrl && input === 'p') {
			if (s.sessionId) openPanel();
			return;
		}
		if (key.ctrl && input === 'b') {
			dispatch({type: 'toggleSidebar'});
			return;
		}
		if (key.ctrl && input === 'o') {
			dispatch({type: 'toggleExpandTools'});
			return;
		}
		if (key.tab && key.shift) {
			cycleMode();
			return;
		}
		const page = Math.max(1, rows - 8);
		if (key.pageUp) {
			setScrollOffset(o => o + page);
			return;
		}
		if (key.pageDown) {
			setScrollOffset(o => Math.max(0, o - page));
			return;
		}
		if (key.shift && key.upArrow) {
			setScrollOffset(o => o + 1);
			return;
		}
		if (key.shift && key.downArrow) {
			setScrollOffset(o => Math.max(0, o - 1));
			return;
		}
		// newline: alt+enter (meta+return) or ctrl+j — Ink parses a bare
		// '\n' as name 'enter' (input '\n', no modifiers); never a send
		if ((key.meta && key.return) || (key.ctrl && input === 'j') || input === '\n') {
			insertText('\n');
			return;
		}

		// @file mention dropdown — arrows/Tab/Enter/Esc belong to it
		if (mentionItems.length > 0) {
			if (key.upArrow) {
				setMentionSel(i => Math.max(0, i - 1));
				return;
			}
			if (key.downArrow) {
				setMentionSel(i =>
					Math.min(mentionItems.length - 1, i + 1),
				);
				return;
			}
			if (key.escape) {
				setMentionDismiss(mentionTok?.start ?? null);
				return;
			}
			if (key.tab || key.return) {
				const sel =
					mentionItems[
						Math.min(mentionSel, mentionItems.length - 1)
					];
				if (sel && mentionTok) {
					const nv =
						prompt.value.slice(0, mentionTok.start) +
						`@${sel.name} ` +
						prompt.value.slice(mentionTok.end);
					setPrompt({
						value: nv,
						cursor: mentionTok.start + sel.name.length + 2,
					});
				}
				return;
			}
			// other keys fall through to editing (re-filters the list)
		}

		const filter = slashFilter(prompt.value);
		const commands: SlashCommand[] = [...agentCommands(s), ...LOCAL_COMMANDS];
		const matches =
			filter !== null
				? commands.filter(c => c.name.startsWith(filter))
				: [];

		if (filter !== null) {
			if (key.upArrow) {
				setPaletteSel(i => (i - 1 + Math.max(1, matches.length)) % Math.max(1, matches.length));
				return;
			}
			if (key.downArrow) {
				setPaletteSel(i => (i + 1) % Math.max(1, matches.length));
				return;
			}
			if (key.escape) {
				setPrompt({value: '', cursor: 0});
				return;
			}
			if (key.tab || key.return) {
				const chosen = matches[Math.min(paletteSel, matches.length - 1)];
				if (chosen) {
					if (key.return && chosen.name === filter) {
						submit('/' + chosen.name);
					} else {
						const nv = '/' + chosen.name + ' ';
						setPrompt({value: nv, cursor: nv.length});
						setPaletteSel(0);
					}
				} else if (key.return) {
					submit(prompt.value);
				}
				return;
			}
			// other keys fall through to editing (re-filters the list)
		} else {
			if (key.upArrow) {
				// inside a multiline input ↑ moves the cursor; history
				// navigation only starts on the first visual row
				const nc = moveVertical(
					prompt.value,
					prompt.cursor,
					contentWidth(cols) - 6,
					-1,
				);
				if (nc !== null) {
					setPrompt({value: prompt.value, cursor: nc});
					return;
				}
				if (history.current.length > 0) {
					if (histIdx.current === -1) {
						histStash.current = prompt.value;
						histIdx.current = history.current.length - 1;
					} else if (histIdx.current > 0) {
						histIdx.current--;
					}
					const hv = history.current[histIdx.current] ?? '';
					setPrompt({value: hv, cursor: hv.length});
				}
				return;
			}
			if (key.downArrow) {
				const nc = moveVertical(
					prompt.value,
					prompt.cursor,
					contentWidth(cols) - 6,
					1,
				);
				if (nc !== null) {
					setPrompt({value: prompt.value, cursor: nc});
					return;
				}
				if (histIdx.current !== -1) {
					if (histIdx.current < history.current.length - 1) {
						histIdx.current++;
						const hv = history.current[histIdx.current];
						setPrompt({value: hv, cursor: hv.length});
					} else {
						histIdx.current = -1;
						setPrompt({
							value: histStash.current,
							cursor: histStash.current.length,
						});
					}
				}
				return;
			}
			if (key.escape) {
				if (s.status === 'working') {
					// double-esc to interrupt: first press warns, second cancels
					const now = Date.now();
					if (now - lastEsc.current < 1500) {
						lastEsc.current = 0;
						cancelTurn();
					} else {
						lastEsc.current = now;
						flash('press esc again to interrupt', 1500);
					}
				} else {
					setPrompt({value: '', cursor: 0});
				}
				return;
			}
			if (key.return) {
				submit(prompt.value);
				return;
			}
		}

		// prompt editing — update value+cursor atomically
		if (key.leftArrow) {
			setPrompt(p => ({...p, cursor: Math.max(0, p.cursor - 1)}));
		} else if (key.rightArrow) {
			setPrompt(p => ({...p, cursor: Math.min(p.value.length, p.cursor + 1)}));
		} else if (key.home || (key.ctrl && input === 'a')) {
			setPrompt(p => ({...p, cursor: 0}));
		} else if (key.end || (key.ctrl && input === 'e')) {
			setPrompt(p => ({...p, cursor: p.value.length}));
		} else if (key.ctrl && input === 'u') {
			setPrompt(p => ({value: p.value.slice(p.cursor), cursor: 0}));
		} else if (key.backspace || key.delete) {
			if (prompt.cursor === 0 && attsRef.current.length > 0) {
				// backspace on an empty input pops the last attachment chip
				setAtts(prev => prev.slice(0, -1));
			} else {
				setPrompt(p =>
					p.cursor > 0
						? {
								value:
									p.value.slice(0, p.cursor - 1) +
									p.value.slice(p.cursor),
								cursor: p.cursor - 1,
							}
						: p,
				);
				setPaletteSel(0);
			}
		} else if (input && !key.ctrl && !key.meta) {
			insertText(input);
		}
	});

	// ---- render ----------------------------------------------------------------

	const home =
		state.turns === 0 && !state.loading && state.items.length === 0;
	const filter = slashFilter(prompt.value);
	const allCommands: SlashCommand[] = [
		...agentCommands(state),
		...LOCAL_COMMANDS,
	];
	const slashItems =
		filter !== null
			? allCommands
					.filter(c => c.name.startsWith(filter))
					.slice(0, 8)
					.map(c => ({name: c.name, description: c.description}))
			: [];

	// attachment chips: ⌗ per resolved @file mention, ▣ per image
	const chips = [
		...resolveMentions(prompt.value, state.cwd).map(m => ({
			icon: '⌗',
			label: m.rel,
		})),
		...atts.map(a => ({icon: '▣', label: a.name})),
	];
	const mentionOpen = mentionItems.length > 0;
	const mentionSelC = Math.min(mentionSel, Math.max(0, mentionItems.length - 1));

	let lines: Seg[][] = home
		? homeLines(
				state,
				{
					value: prompt.value,
					cursor: prompt.cursor,
					tick,
					authSel,
					picker: picker ?? undefined,
					fusion: fusion ?? undefined,
					resume: resumeView ?? undefined,
					paletteSel,
					slashItems,
					slashOpen: filter !== null && slashItems.length > 0,
					mentionItems,
					mentionOpen,
					mentionSel: mentionSelC,
					chips,
					catalog,
					handoff: handoff ?? undefined,
				},
				cols,
				rows,
			)
		: sessionLines(
				state,
				{
					value: prompt.value,
					cursor: prompt.cursor,
					tick,
					scrollOffset,
					paletteSel,
					slashItems,
					slashOpen: filter !== null && slashItems.length > 0,
					mentionItems,
					mentionOpen,
					mentionSel: mentionSelC,
					chips,
					catalog,
					modelPicker: picker ?? undefined,
					fusion: fusion ?? undefined,
					resume: resumeView ?? undefined,
					permSel,
					handoff: handoff ?? undefined,
				},
				cols,
				rows,
			);

	const overlay = panelOpen
		? commandPanelBlock(
				filterPanelItems(panelItems(state), panelQuery),
				panelSel,
				panelQuery,
				Math.min(64, Math.max(24, cols - 8)),
			)
		: helpOpen
			? helpBlock(
					filterHelp(
						helpEntries(state, LOCAL_COMMANDS, HELP_KEYS),
						helpQuery,
					),
					helpSel,
					helpQuery,
					Math.min(64, Math.max(24, cols - 8)),
					rows - 4,
				)
			: null;
	if (overlay) lines = spliceCentered(dimScreen(lines), overlay, cols, rows);

	return (
		<Box flexDirection="column" width={cols} height={rows}>
			{lines.map((l, i) => (
				<Line key={i} segs={l} />
			))}
		</Box>
	);
}
