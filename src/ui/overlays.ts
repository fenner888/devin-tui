import {
	type Seg,
	seg,
	padSegs,
	segsWidth,
	sliceSegs,
	truncSegs,
	strWidth,
} from './lines.js';
import type {SlashCommand, State} from '../state/store.js';

/** Force every foreground to `faint` — the dimmed backdrop under an overlay. */
export function dimScreen(lines: Seg[][]): Seg[][] {
	return lines.map(row =>
		row.map(s => ({...s, k: 'faint' as const, hex: undefined})),
	);
}

/** Splice a centered `block` (each row padded to its own width) over `base`. */
export function spliceCentered(
	base: Seg[][],
	block: Seg[][],
	cols: number,
	rows: number,
): Seg[][] {
	const bw = block.reduce((m, r) => Math.max(m, segsWidth(r)), 0);
	const bh = block.length;
	const x = Math.max(0, Math.floor((cols - bw) / 2));
	const y = Math.max(0, Math.floor((rows - bh) / 2));
	const out = base.map(r => [...r]);
	for (let i = 0; i < bh && y + i < out.length; i++) {
		const row = block[i];
		const line = out[y + i];
		out[y + i] = [
			...sliceSegs(line, 0, x),
			...padSegs(row, bw, 'overlay'),
			...sliceSegs(line, x + bw, Math.max(0, cols - x - bw)),
		];
	}
	return out;
}

// ---- command panel ---------------------------------------------------------

export interface PanelItem {
	section: 'Session' | 'Agent' | 'Account' | 'App';
	label: string;
	desc: string;
	hint?: string;
	action:
		| {type: 'clear'}
		| {type: 'togglePlan'}
		| {type: 'cycleMode'}
		| {type: 'toggleExpand'}
		| {type: 'handoff'}
		| {type: 'fusion'}
		| {type: 'model'}
		| {type: 'login'}
		| {type: 'logout'}
		| {type: 'status'}
		| {type: 'insert'; text: string}
		| {type: 'help'}
		| {type: 'resume'}
		| {type: 'quit'};
}

/** Agent-advertised commands that collide with local ones are filtered out. */
export const LOCAL_RESERVED = new Set([
	'login',
	'logout',
	'status',
	'model',
	'handoff',
	'fusion',
	'resume',
	'help',
	'exit',
	'quit',
]);

export function agentCommands(s: State) {
	return s.commands.filter(c => !LOCAL_RESERVED.has(c.name.toLowerCase()));
}

export function panelItems(s: State): PanelItem[] {
	const items: PanelItem[] = [
		{
			section: 'Session',
			label: 'New session',
			desc: 'start a fresh session',
			action: {type: 'clear'},
		},
		{
			section: 'Session',
			label: 'Toggle plan',
			desc: 'show or hide the plan block',
			hint: 'ctrl+b',
			action: {type: 'togglePlan'},
		},
		{
			section: 'Session',
			label: 'Cycle mode',
			desc: 'switch agent mode',
			hint: 'shift+tab',
			action: {type: 'cycleMode'},
		},
		{
			section: 'Session',
			label: 'Toggle command output',
			desc: 'expand or collapse command blocks',
			hint: 'ctrl+o',
			action: {type: 'toggleExpand'},
		},
		{
			section: 'Session',
			label: 'Resume session',
			desc: 'resume a previous session',
			hint: '/resume',
			action: {type: 'resume'},
		},
		{
			section: 'Session',
			label: 'Hand off to cloud Devin',
			desc: 'send this session to the cloud',
			hint: '/handoff',
			action: {type: 'handoff'},
		},
		{
			section: 'Session',
			label: 'Switch to Fusion',
			desc: 'choose a Fusion lead + sidekick',
			hint: '/fusion',
			action: {type: 'fusion'},
		},
		{
			section: 'Session',
			label: 'Switch model',
			desc: 'choose model and reasoning effort',
			hint: '/model',
			action: {type: 'model'},
		},
	];
	for (const c of agentCommands(s)) {
		items.push({
			section: 'Agent',
			label: `/${c.name}`,
			desc: c.description ?? '',
			action: {type: 'insert', text: `/${c.name} `},
		});
	}
	items.push(
		{
			section: 'Account',
			label: 'Sign in',
			desc: 'authenticate with the agent',
			action: {type: 'login'},
		},
		{
			section: 'Account',
			label: 'Sign out',
			desc: 'log out of the agent',
			action: {type: 'logout'},
		},
		{
			section: 'Account',
			label: 'Status',
			desc: 'show session status',
			action: {type: 'status'},
		},
		{
			section: 'App',
			label: 'Help',
			desc: 'show commands and keys',
			hint: '/help',
			action: {type: 'help'},
		},
		{
			section: 'App',
			label: 'Quit',
			desc: 'exit devin-tui',
			hint: 'ctrl+c',
			action: {type: 'quit'},
		},
	);
	return items;
}

export function filterPanelItems(
	items: PanelItem[],
	query: string,
): PanelItem[] {
	const q = query.trim().toLowerCase();
	if (!q) return items;
	return items.filter(
		i =>
			i.label.toLowerCase().includes(q) || i.desc.toLowerCase().includes(q),
	);
}

/**
 * Centered borderless command panel. `sel` indexes the flattened filtered
 * item list. 2-col inner padding, blank rows inside the overlay top/bottom.
 */
export function commandPanelBlock(
	items: PanelItem[],
	sel: number,
	query: string,
	w: number,
): Seg[][] {
	const pad = padSegs([], w, 'overlay');
	const rows: Seg[][] = [pad];
	const nameW =
		Math.max(4, ...items.map(i => strWidth(i.label))) + 2; // name column
	const right = (s: string) => w - 2 - strWidth(s); // right-aligned col

	rows.push(
		padSegs(
			[
				seg('  Commands', 'title', 'overlay'),
				seg(' '.repeat(Math.max(0, right('esc') - 2 - strWidth('Commands'))), 'plain', 'overlay'),
				seg('esc', 'muted', 'overlay'),
				seg('  ', 'plain', 'overlay'),
			],
			w,
			'overlay',
		),
	);
	rows.push(
		padSegs(
			[
				seg('  Search  ', 'muted', 'overlay'),
				query
					? seg(query, 'bright', 'overlay')
					: seg('type to filter', 'faint', 'overlay'),
			],
			w,
			'overlay',
		),
	);
	rows.push(pad);

	let flat = 0;
	let first = true;
	for (const section of ['Session', 'Agent', 'Account', 'App'] as const) {
		const group = items.filter(i => i.section === section);
		if (group.length === 0) continue;
		if (!first) rows.push(pad);
		first = false;
		rows.push(
			padSegs([seg(`  ${section}`, 'muted', 'overlay')], w, 'overlay'),
		);
		for (const item of group) {
			const selected = flat === sel;
			flat++;
			const hint = item.hint ?? '';
			const descRoom = Math.max(
				0,
				right(hint) - 2 - nameW - (hint ? strWidth(hint) : 0),
			);
			const desc = truncSegs(
				[seg(item.desc, 'muted', 'overlay')],
				descRoom,
			);
			const gap = Math.max(
				1,
				right(hint) - 2 - nameW - segsWidth(desc),
			);
			const rowSegs: Seg[] = [
				seg('  ', 'plain', 'overlay'),
				seg(
					item.label + ' '.repeat(Math.max(0, nameW - strWidth(item.label))),
					'bright',
					'overlay',
				),
				...desc,
				seg(' '.repeat(gap), 'plain', 'overlay'),
				...(hint ? [seg(hint, 'muted', 'overlay')] : []),
				seg('  ', 'plain', 'overlay'),
			];
			rows.push(
				padSegs(
					selected
						? rowSegs.map(s => ({...s, k: 'sel' as const, bg: 'sel' as const}))
						: rowSegs,
					w,
					selected ? 'sel' : 'overlay',
				),
			);
		}
	}
	rows.push(pad);
	return rows;
}

// ---- /help overlay -----------------------------------------------------------

export interface HelpCommand {
	name: string;
	desc: string;
	/** appended faint after the name (`/plan [prompt]`) */
	hint?: string;
	/** Enter → close + put this text into the prompt (commands only) */
	insert?: string;
}

export type HelpEntry =
	| {header: string} // section header (TUI commands / Keys / Devin commands)
	| {sub: string} // category sub-header inside Devin commands
	| {note: string} // faint non-selectable line
	| {entry: HelpCommand};

/** The /help row model: locals, the key list, then agent commands grouped
 *  by `cognition.ai/category` in first-appearance order ('Other' last). */
export function helpEntries(
	s: State,
	local: SlashCommand[],
	keys: readonly {key: string; desc: string}[],
): HelpEntry[] {
	const out: HelpEntry[] = [
		{header: 'TUI commands'},
		...local.map<HelpEntry>(c => ({
			entry: {
				name: `/${c.name}`,
				desc: c.description,
				insert: `/${c.name} `,
			},
		})),
		{header: 'Keys'},
		...keys.map<HelpEntry>(k => ({entry: {name: k.key, desc: k.desc}})),
		{header: 'Devin commands'},
	];
	const cmds = agentCommands(s);
	if (cmds.length === 0) {
		out.push({note: "connect to see Devin's commands"});
		return out;
	}
	const cats: {name: string; cmds: SlashCommand[]}[] = [];
	for (const c of cmds) {
		const cat = c.category ?? 'Other';
		let g = cats.find(x => x.name === cat);
		if (!g) {
			g = {name: cat, cmds: []};
			cats.push(g);
		}
		g.cmds.push(c);
	}
	for (const g of cats) {
		out.push({sub: g.name});
		for (const c of g.cmds) {
			out.push({
				entry: {
					name: `/${c.name}`,
					desc: c.description,
					hint: c.hint,
					insert: `/${c.name} `,
				},
			});
		}
	}
	return out;
}

/** Substring filter over command/key rows; headers follow their rows. */
export function filterHelp(rows: HelpEntry[], query: string): HelpEntry[] {
	const q = query.trim().toLowerCase();
	if (!q) return rows;
	return rows.filter(
		r =>
			'entry' in r &&
			(r.entry.name.toLowerCase().includes(q) ||
				r.entry.desc.toLowerCase().includes(q) ||
				(r.entry.hint ?? '').toLowerCase().includes(q)),
	);
}

/**
 * Centered borderless help overlay — the command panel's chrome (title +
 * `esc`, `Search` filter row, selection bar) with scrolling `↑/↓ n more`
 * markers when it exceeds `maxH`. `sel` indexes entry rows only.
 */
export function helpBlock(
	rows: HelpEntry[],
	sel: number,
	query: string,
	w: number,
	maxH: number,
): Seg[][] {
	const pad = padSegs([], w, 'overlay');
	const nEnt = rows.reduce((n, r) => n + ('entry' in r ? 1 : 0), 0);
	const selN = Math.min(Math.max(0, sel), Math.max(0, nEnt - 1));
	let count = -1;
	const selDisp = rows.findIndex(r => 'entry' in r && ++count === selN);
	let cap = Math.max(4, maxH - 5); // pad + title + search + pad + pad
	if (rows.length > cap) cap -= 2; // room for the two scroll markers
	const start = Math.min(
		Math.max(0, selDisp - cap + 1),
		Math.max(0, rows.length - cap),
	);
	const win = rows.slice(start, start + cap);
	const above = rows.slice(0, start).filter(r => 'entry' in r).length;
	const below = rows.slice(start + cap).filter(r => 'entry' in r).length;

	const nameW =
		Math.max(
			4,
			...rows
				.filter((r): r is {entry: HelpCommand} => 'entry' in r)
				.map(r => strWidth(r.entry.name) + (r.entry.hint ? strWidth(r.entry.hint) + 1 : 0)),
		) + 2;
	const right = (s: string) => w - 2 - strWidth(s);

	const out: Seg[][] = [
		pad,
		padSegs(
			[
				seg('  Help', 'title', 'overlay'),
				seg(' '.repeat(Math.max(0, right('esc') - 2 - strWidth('Help'))), 'plain', 'overlay'),
				seg('esc', 'muted', 'overlay'),
				seg('  ', 'plain', 'overlay'),
			],
			w,
			'overlay',
		),
		padSegs(
			[
				seg('  Search  ', 'muted', 'overlay'),
				query
					? seg(query, 'bright', 'overlay')
					: seg('type to filter', 'faint', 'overlay'),
			],
			w,
			'overlay',
		),
		pad,
	];
	if (above > 0) {
		out.push(padSegs([seg(`  ↑ ${above} more above`, 'faint', 'overlay')], w, 'overlay'));
	}
	let idx = -1;
	for (const r of win) {
		if ('header' in r) {
			out.push(padSegs([seg(`  ${r.header}`, 'muted', 'overlay')], w, 'overlay'));
			continue;
		}
		if ('sub' in r || 'note' in r) {
			const t = 'sub' in r ? r.sub : r.note;
			out.push(padSegs([seg(`    ${t}`, 'faint', 'overlay')], w, 'overlay'));
			continue;
		}
		idx++;
		const selected = idx === selN;
		const e = r.entry;
		const hint = e.hint ? ` ${e.hint}` : '';
		const rowSegs: Seg[] = [
			seg('  ', 'plain', 'overlay'),
			seg(e.name, 'bright', 'overlay'),
			...(e.hint ? [seg(` ${e.hint}`, 'faint', 'overlay')] : []),
			seg(' '.repeat(Math.max(1, nameW - strWidth(e.name) - strWidth(hint))), 'plain', 'overlay'),
			...truncSegs(
				[seg(e.desc, 'muted', 'overlay')],
				Math.max(0, w - nameW - 6),
			),
		];
		out.push(
			padSegs(
				selected
					? rowSegs.map(s => ({...s, k: 'sel' as const, bg: 'sel' as const}))
					: rowSegs,
				w,
				selected ? 'sel' : 'overlay',
			),
		);
	}
	if (below > 0) {
		out.push(padSegs([seg(`  ↓ ${below} more below`, 'faint', 'overlay')], w, 'overlay'));
	}
	out.push(pad);
	return out;
}

// ---- handoff confirm --------------------------------------------------------

export interface HandoffInfo {
	task: string;
	repo?: string;
	branch?: string;
	diffKb: number;
	contextKb: number;
}

/** Inline `/handoff` confirmation above the composer — same slot as the
 *  slash dropdown. Enter sends, Esc cancels. */
export function handoffBlock(h: HandoffInfo, w: number): Seg[][] {
	return [
		padSegs(
			[seg(' Hand off to a cloud Devin?', 'bright', 'overlay')],
			w,
			'overlay',
		),
		padSegs(
			truncSegs(
				[
					seg(
						`  repo ${h.repo ?? 'none'} · branch ${h.branch ?? 'none'} · diff ${h.diffKb} KB · context ${h.contextKb} KB`,
						'faint',
						'overlay',
					),
				],
				w,
			),
			w,
			'overlay',
		),
		padSegs(
			truncSegs([seg(`  task: ${h.task}`, 'faint', 'overlay')], w),
			w,
			'overlay',
		),
		padSegs(
			[
				seg('  ↵', 'bright', 'overlay'),
				seg(' confirm · ', 'muted', 'overlay'),
				seg('esc', 'bright', 'overlay'),
				seg(' cancel', 'muted', 'overlay'),
			],
			w,
			'overlay',
		),
	];
}

// ---- slash dropdown --------------------------------------------------------

/** Two-column dropdown shown above the input panel —
 *  `/` commands or `@` file mentions (prefix). */
export function slashMenuBlock(
	items: {name: string; description?: string}[],
	sel: number,
	w: number,
	prefix = '/',
): Seg[][] {
	const shown = items.slice(0, 8);
	const nameW = Math.min(
		18,
		Math.max(6, ...shown.map(i => strWidth(i.name) + 2)),
	);
	return shown.map((item, i) => {
		const selected = i === sel;
		const name = `${prefix}${item.name}`;
		const rowSegs: Seg[] = [
			seg(' ', 'plain', 'overlay'),
			seg(name + ' '.repeat(Math.max(1, nameW - strWidth(name))), 'bright', 'overlay'),
			...truncSegs(
				[seg(item.description ?? '', 'muted', 'overlay')],
				Math.max(0, w - nameW - 2),
			),
		];
		return padSegs(
			selected
				? rowSegs.map(s => ({...s, k: 'sel' as const, bg: 'sel' as const}))
				: rowSegs,
			w,
			selected ? 'sel' : 'overlay',
		);
	});
}
