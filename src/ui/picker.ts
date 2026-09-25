import type {SessionConfigOption, SessionInfo} from '@agentclientprotocol/sdk';
import {configGroups, configValues} from '../state/store.js';
import {padSegs, seg, strWidth, truncSegs, type Seg} from './lines.js';
import {shortCwd} from './panel.js';

/**
 * The /model picker — styled after the Devin CLI's model picker (the one
 * allowed hue exception): selected row in blue on #1c2530, effort bars.
 * Rendered inline directly above the input panel, like the slash dropdown.
 * `pickerShell` is shared with the /fusion picker.
 */
export interface PickerView {
	sel: number; // index into the filtered option list
	filter: string;
	effortIdx: number; // pending thought_level index
}

interface Flat {
	value: string;
	name: string;
}

type Row = {header: string} | {opt: Flat; idx: number};

const MAX_ROWS = 8;

export function filteredOptions(
	modelOpt: SessionConfigOption,
	filter: string,
): Flat[] {
	const q = filter.trim().toLowerCase();
	return configValues(modelOpt).filter(
		o => !q || o.name.toLowerCase().includes(q),
	);
}

// ---- shared picker shell ---------------------------------------------------

interface ShellSpec {
	/** caption row above the search line (e.g. 'Fusion · lead + sidekick') */
	title?: string;
	filter: string;
	/** display rows — {opt, idx} where idx is the position in the full list */
	display: Row[];
	/** index into the option list that is selected */
	sel: number;
	/** mark a row `•` (the currently applied value) */
	isCurrent?: (o: Flat) => boolean;
	/** right-side control on the selected row (effort bars / sidekick cycler) */
	control?: (o: Flat, bg: 'pkSel' | 'overlay') => Seg[];
	/** right-aligned meta on every row (e.g. resume picker's time + id) */
	rowMeta?: (o: Flat, bg: 'pkSel' | 'overlay') => Seg[];
	/** ↑↓ verb in the footer ('select' default, 'lead' for fusion) */
	selectHint?: string;
	/** ←→ label in the footer ('reasoning effort' / 'sidekick') */
	midHint?: string;
	w: number;
}

function pickerShell(spec: ShellSpec): Seg[][] {
	const {display, w} = spec;
	const nOpts = display.reduce((n, r) => n + ('opt' in r ? 1 : 0), 0);
	const sel = Math.min(spec.sel, Math.max(0, nOpts - 1));
	const selDisp = display.findIndex(r => 'opt' in r && r.idx === sel);
	const start = Math.min(
		Math.max(0, selDisp - MAX_ROWS + 1),
		Math.max(0, display.length - MAX_ROWS),
	);
	const window_ = display.slice(start, start + MAX_ROWS);
	const above = display.slice(0, start).filter(r => 'opt' in r).length;
	const below = display
		.slice(start + MAX_ROWS)
		.filter(r => 'opt' in r).length;

	const rows: Seg[][] = [];

	if (spec.title) {
		rows.push(
			padSegs([seg(` ${spec.title}`, 'muted', 'overlay')], w, 'overlay'),
		);
	}

	// filter row
	rows.push(
		padSegs(
			[
				seg(' / ', 'muted', 'overlay'),
				spec.filter
					? seg(spec.filter, 'bright', 'overlay')
					: seg('type to search', 'faint', 'overlay'),
			],
			w,
			'overlay',
		),
	);

	if (above > 0) {
		rows.push(
			padSegs([seg(`   ↑ ${above} more above`, 'faint', 'overlay')], w, 'overlay'),
		);
	}

	for (const r of window_) {
		if ('header' in r) {
			rows.push(
				padSegs([seg(`   ${r.header}`, 'faint', 'overlay')], w, 'overlay'),
			);
			continue;
		}
		const isSel = r.idx === sel;
		const isCurrent = spec.isCurrent?.(r.opt) ?? false;
		const meta = spec.rowMeta?.(r.opt, isSel ? 'pkSel' : 'overlay') ?? [];
		const metaW = meta.reduce((a, s) => a + strWidth(s.t), 0);
		if (isSel) {
			const ctl = [
				...(spec.control?.(r.opt, 'pkSel') ?? []),
				...meta,
			];
			const ctlW = ctl.reduce((a, s) => a + strWidth(s.t), 0);
			const nameW = strWidth(`❯ ${r.opt.name}`);
			const gap = Math.max(1, w - 2 - nameW - ctlW);
			rows.push(
				padSegs(
					truncSegs(
						[
							seg(' ❯ ', 'pk', 'pkSel'),
							seg(r.opt.name, 'pk', 'pkSel'),
							seg(' '.repeat(gap), 'plain', 'pkSel'),
							...ctl,
							seg('  ', 'plain', 'pkSel'),
						],
						w,
					),
					w,
					'pkSel',
				),
			);
		} else {
			const nameSegs = [
				seg('   ', 'plain', 'overlay'),
				seg(r.opt.name, 'text', 'overlay'),
				...(isCurrent ? [seg(' •', 'faint', 'overlay')] : []),
			];
			if (meta.length === 0) {
				rows.push(padSegs(truncSegs(nameSegs, w), w, 'overlay'));
			} else {
				const gap = Math.max(
					1,
					w - 4 - nameSegs.reduce((a, s) => a + strWidth(s.t), 0) - metaW,
				);
				rows.push(
					padSegs(
						truncSegs(
							[...nameSegs, seg(' '.repeat(gap), 'plain', 'overlay'), ...meta],
							w,
						),
						w,
						'overlay',
					),
				);
			}
		}
	}

	if (below > 0) {
		rows.push(
			padSegs([seg(`   ↓ ${below} more below`, 'faint', 'overlay')], w, 'overlay'),
		);
	}

	// footer hints
	rows.push(
		padSegs(
			[
				seg(' '),
				seg('↑↓', 'bright', 'overlay'),
				seg(` ${spec.selectHint ?? 'select'} · `, 'muted', 'overlay'),
				...(spec.midHint
					? [
							seg('←→', 'bright', 'overlay'),
							seg(` ${spec.midHint} · `, 'muted', 'overlay'),
						]
					: []),
				seg('↵', 'bright', 'overlay'),
				seg(' confirm · ', 'muted', 'overlay'),
				seg('esc', 'bright', 'overlay'),
				seg(' cancel', 'muted', 'overlay'),
			],
			w,
			'overlay',
		),
	);

	return rows;
}

// ---- /model picker ---------------------------------------------------------

export function pickerLines(
	modelOpt: SessionConfigOption,
	effortOpt: SessionConfigOption | undefined,
	view: PickerView,
	w: number,
): Seg[][] {
	const groups = configGroups(modelOpt);
	const filtered = filteredOptions(modelOpt, view.filter);
	const sel = Math.min(view.sel, Math.max(0, filtered.length - 1));

	// display rows: group headers only when not filtering
	let display: Row[] = [];
	if (groups && !view.filter.trim()) {
		let idx = 0;
		for (const g of groups) {
			display.push({header: g.name});
			for (const o of g.options) display.push({opt: o, idx: idx++});
		}
	} else {
		display = filtered.map((o, i) => ({opt: o, idx: i}));
	}

	const effortVals = effortOpt ? configValues(effortOpt) : [];
	const effortIdx = Math.min(view.effortIdx, Math.max(0, effortVals.length - 1));

	return pickerShell({
		filter: view.filter,
		display,
		sel,
		isCurrent: o => o.value === modelOpt.currentValue,
		control: (_o, bg) =>
			effortVals.length === 0
				? []
				: [
						seg('← ', 'pkDim', bg),
						...effortVals.map((_, i) =>
							seg('■', i <= effortIdx ? 'pk' : 'pkOff', bg),
						),
						seg(' →  ', 'pkDim', bg),
						seg(effortVals[effortIdx]?.name ?? '', 'pk', bg),
					],
		midHint: effortVals.length > 0 ? 'reasoning effort' : undefined,
		w,
	});
}

// ---- /fusion picker --------------------------------------------------------

export interface FusionPair {
	value: string;
	sidekick: string;
}

export interface FusionLead {
	name: string;
	pairs: FusionPair[];
}

const FUSION_RE = /^Fusion \((.+) \+ (.+)\)$/;

/** Fusion entries inside the `model` select: `fusion-…` values named
 *  `Fusion (<lead> + <sidekick>)` — grouped by lead, first-appearance
 *  order for both axes. */
export function fusionData(modelOpt: SessionConfigOption): FusionLead[] {
	const leads: FusionLead[] = [];
	for (const o of configValues(modelOpt)) {
		if (!o.value.startsWith('fusion-')) continue;
		const m = FUSION_RE.exec(o.name);
		if (!m) continue;
		const [, lead, sidekick] = m;
		let l = leads.find(x => x.name === lead);
		if (!l) {
			l = {name: lead, pairs: []};
			leads.push(l);
		}
		l.pairs.push({value: o.value, sidekick});
	}
	return leads;
}

export interface FusionView {
	sel: number; // index into the filtered lead list
	filter: string;
	/** pending sidekick index per lead name */
	sk: Record<string, number>;
}

export function filterFusion(
	leads: FusionLead[],
	filter: string,
): FusionLead[] {
	const q = filter.trim().toLowerCase();
	return leads.filter(l => !q || l.name.toLowerCase().includes(q));
}

/** Sidekick index for a lead: the current pair's sidekick when the current
 *  model is a fusion pair of that lead, else the first available. */
export function defaultSidekickIdx(
	lead: FusionLead,
	currentValue: unknown,
): number {
	const i = lead.pairs.findIndex(p => p.value === currentValue);
	return i === -1 ? 0 : i;
}

export function fusionLines(
	leads: FusionLead[],
	currentValue: unknown,
	view: FusionView,
	w: number,
): Seg[][] {
	const filtered = filterFusion(leads, view.filter);
	const sel = Math.min(view.sel, Math.max(0, filtered.length - 1));
	const selLead = filtered[sel];
	const skIdx = selLead
		? Math.min(
				view.sk[selLead.name] ??
					defaultSidekickIdx(selLead, currentValue),
				selLead.pairs.length - 1,
			)
		: 0;
	return pickerShell({
		title: 'Fusion · lead + sidekick',
		filter: view.filter,
		display: filtered.map((l, i) => ({
			opt: {value: l.name, name: l.name},
			idx: i,
		})),
		sel,
		isCurrent: o =>
			leads
				.find(l => l.name === o.value)
				?.pairs.some(p => p.value === currentValue) ?? false,
		control: (_o, bg) =>
			selLead
				? [
						seg('← ', 'pkDim', bg),
						seg('+ ', 'pkDim', bg),
						seg(selLead.pairs[skIdx]?.sidekick ?? '', 'pk', bg),
						seg(' →', 'pkDim', bg),
					]
				: [],
		selectHint: 'lead',
		midHint: 'sidekick',
		w,
	});
}

// ---- /resume picker --------------------------------------------------------

export interface ResumeView {
	sel: number; // index into the filtered session list
	filter: string;
	sessions: SessionInfo[];
}

/** `just now` / `5m ago` / `2h ago` / `3d ago` for an ISO timestamp. */
export function relTime(iso?: string | null): string {
	if (!iso) return '';
	const ms = Date.now() - Date.parse(iso);
	if (!Number.isFinite(ms) || ms < 45_000) return 'just now';
	const m = Math.floor(ms / 60_000);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	return `${Math.floor(h / 24)}d ago`;
}

/** Newest-updated first; falls back to createdAt then id order. */
export function sortSessions(sessions: SessionInfo[]): SessionInfo[] {
	return [...sessions].sort((a, b) =>
		(b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''),
	);
}

export function filterResume(
	sessions: SessionInfo[],
	filter: string,
): SessionInfo[] {
	const q = filter.trim().toLowerCase();
	return sessions.filter(
		si =>
			!q ||
			(si.title ?? 'untitled').toLowerCase().includes(q) ||
			si.sessionId.toLowerCase().includes(q),
	);
}

/** The /resume picker — pickerShell chrome with title/rows of sessions for
 *  this cwd: title (or `Untitled`), right-aligned faint relative time +
 *  short id, `•` on the current session. */
export function resumeLines(
	view: ResumeView,
	currentId: string | undefined,
	cwd: string,
	w: number,
): Seg[][] {
	const filtered = filterResume(view.sessions, view.filter);
	return pickerShell({
		title: `Resume · ${shortCwd(cwd)}`,
		filter: view.filter,
		display: filtered.map((si, i) => ({
			opt: {value: si.sessionId, name: si.title || 'Untitled'},
			idx: i,
		})),
		sel: view.sel,
		isCurrent: o => o.value === currentId,
		rowMeta: (o, bg) => {
			const si = filtered.find(x => x.sessionId === o.value);
			if (!si) return [];
			const when = relTime(si.updatedAt);
			const tok = bg === 'pkSel' ? 'pkDim' : 'faint';
			return [
				...(when ? [seg(`${when} · `, tok, bg)] : []),
				seg(o.value.slice(0, 8), tok, bg),
			];
		},
		selectHint: 'session',
		w,
	});
}
