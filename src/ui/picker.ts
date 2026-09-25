import type {SessionConfigOption, SessionInfo} from '@agentclientprotocol/sdk';
import {configGroups, configValues} from '../state/store.js';
import {levelRank, levelsFor} from '../catalog.js';
import type {CatalogState, ModelCatalog} from '../catalog.js';
import type {Token} from '../theme.js';
import {padSegs, seg, segsWidth, strWidth, truncSegs, type Seg} from './lines.js';
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
	/** pending reasoning-level id per model value (each row keeps its own) */
	effort: Record<string, string>;
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
	/** right-side control per row (effort bars / sidekick cycler); called
	 *  for every visible row — return [] for none. Controls render in a
	 *  fixed-width column (the widest control over the visible window),
	 *  padded on the right so bars/names align in columns */
	control?: (o: Flat, isSel: boolean, bg: 'pkSel' | 'overlay') => Seg[];
	/** right-aligned meta on every row (e.g. resume picker's time + id) */
	rowMeta?: (o: Flat, bg: 'pkSel' | 'overlay') => Seg[];
	/** ✱ badge token after the name ('pkGreen' new / 'pkYellow' beta) */
	badge?: (o: Flat) => Token | null;
	/** detail rows under the list for the selected option (pricing) */
	detail?: (o: Flat | undefined) => DetailRow[];
	/** cap on total block height — legend drops first, then the slider
	 *  row, then the rest of the detail */
	maxRows?: number;
	/** ↑↓ verb in the footer ('select' default, 'lead' for fusion) */
	selectHint?: string;
	/** ←→ label in the footer ('reasoning effort' / 'sidekick') */
	midHint?: string;
	w: number;
}

/** A detail row tagged so height pressure knows what to drop first. */
interface DetailRow {
	row: Seg[];
	kind: 'other' | 'slider' | 'legend' | 'pad';
}

function pickerShell(spec: ShellSpec): Seg[][] {
	const {display, w} = spec;
	const nOpts = display.reduce((n, r) => n + ('opt' in r ? 1 : 0), 0);
	const sel = Math.min(spec.sel, Math.max(0, nOpts - 1));
	const selDisp = display.findIndex(r => 'opt' in r && r.idx === sel);
	const selRow = display.find(r => 'opt' in r && r.idx === sel);
	let det =
		spec.detail?.(selRow && 'opt' in selRow ? selRow.opt : undefined) ?? [];

	// the list window over `display` for a given visible-row budget
	const windowRows = (visN: number): Seg[][] => {
		const start = Math.min(
			Math.max(0, selDisp - visN + 1),
			Math.max(0, display.length - visN),
		);
		const window_ = display.slice(start, start + visN);
		const above = display.slice(0, start).filter(r => 'opt' in r).length;
		const below = display
			.slice(start + visN)
			.filter(r => 'opt' in r).length;
		const rows: Seg[][] = [];
		if (above > 0) {
			rows.push(
				padSegs(
					[seg(`   ↑ ${above} more above`, 'faint', 'overlay')],
					w,
					'overlay',
				),
			);
		}
		// badges line up in one column after the longest visible name
		badgeCol = Math.min(
			Math.max(20, w - 30),
			Math.max(0, ...window_.map(r => ('header' in r ? 0 : strWidth(r.opt.name)))),
		);
		// controls land in a fixed-width column (the widest in the window)
		// so bars/names line up across rows; [] → the row gets none
		rcMap = new Map();
		rcW = 0;
		for (const r of window_) {
			if ('header' in r) continue;
			const isSel = r.idx === sel;
			const rc =
				spec.control?.(r.opt, isSel, isSel ? 'pkSel' : 'overlay') ?? [];
			if (rc.length > 0) {
				rcMap.set(r.idx, rc);
				rcW = Math.max(rcW, segsWidth(rc));
			}
		}
		for (const r of window_) rows.push(optionRow(r));
		if (below > 0) {
			rows.push(
				padSegs(
					[seg(`   ↓ ${below} more below`, 'faint', 'overlay')],
					w,
					'overlay',
				),
			);
		}
		return rows;
	};

	let badgeCol = 0;
	let rcMap: Map<number, Seg[]> = new Map();
	let rcW = 0;
	const optionRow = (r: Row): Seg[] => {
		if ('header' in r) {
			return padSegs([seg(`   ${r.header}`, 'faint', 'overlay')], w, 'overlay');
		}
		const isSel = r.idx === sel;
		const isCurrent = spec.isCurrent?.(r.opt) ?? false;
		const badge = spec.badge?.(r.opt) ?? null;
		const bbg = isSel ? 'pkSel' : 'overlay';
		const badgeSegs = badge
			? [
					seg(' '.repeat(Math.max(0, badgeCol - strWidth(r.opt.name)) + 2), 'plain', bbg),
					seg('✱', badge, bbg),
				]
			: [];
		const meta = spec.rowMeta?.(r.opt, isSel ? 'pkSel' : 'overlay') ?? [];
		const metaW = meta.reduce((a, s) => a + strWidth(s.t), 0);
		if (isSel) {
			const ctl = [
				...padSegs(rcMap.get(r.idx) ?? [], rcW, 'pkSel'),
				...meta,
			];
			const ctlW = ctl.reduce((a, s) => a + strWidth(s.t), 0);
			const nameW = strWidth(`❯ ${r.opt.name}`) + segsWidth(badgeSegs);
			const gap = Math.max(1, w - 2 - nameW - ctlW);
			return padSegs(
				truncSegs(
					[
						seg(' ❯ ', 'pk', 'pkSel'),
						seg(r.opt.name, 'pk', 'pkSel'),
						...badgeSegs,
						seg(' '.repeat(gap), 'plain', 'pkSel'),
						...ctl,
						seg('  ', 'plain', 'pkSel'),
					],
					w,
				),
				w,
				'pkSel',
			);
		}
		const ctl = padSegs(rcMap.get(r.idx) ?? [], rcW, 'overlay');
		const rightW = segsWidth(ctl) + metaW;
		const nameSegs = [
			seg('   ', 'plain', 'overlay'),
			seg(r.opt.name, 'text', 'overlay'),
			...badgeSegs,
			...(isCurrent ? [seg(' •', 'faint', 'overlay')] : []),
		];
		const nameW = nameSegs.reduce((a, s) => a + strWidth(s.t), 0);
		// under width pressure the right-side control/meta drops before
		// the row's name does (the selected row keeps its control instead
		// and truncates the name — above)
		if (rightW === 0) {
			return padSegs(truncSegs(nameSegs, w), w, 'overlay');
		}
		if (nameW + 1 + rightW + 4 > w) {
			return padSegs(truncSegs(nameSegs, w), w, 'overlay');
		}
		const gap = Math.max(1, w - 1 - nameW - rightW);
		return padSegs(
			truncSegs(
				[
					...nameSegs,
					seg(' '.repeat(gap), 'plain', 'overlay'),
					...ctl,
					...meta,
				],
				w,
			),
			w,
			'overlay',
		);
	};

	// detail block (pricing) for the selected option — under height
	// pressure the legend drops first, then the slider row, then the pad
	// rows, then all of it; last resort shrinks the list window itself
	const chrome = (spec.title ? 1 : 0) + 1 + 1; // title + search + footer
	let visN = MAX_ROWS;
	if (spec.maxRows !== undefined) {
		const fits = (v: number, d: DetailRow[]) =>
			chrome + windowRows(v).length + d.length <= spec.maxRows!;
		if (!fits(visN, det)) det = det.filter(d => d.kind !== 'legend');
		if (!fits(visN, det)) det = det.filter(d => d.kind !== 'slider');
		if (!fits(visN, det)) det = det.filter(d => d.kind !== 'pad');
		if (!fits(visN, det)) det = [];
		while (!fits(visN, det) && visN > 3) visN--;
	}

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

	rows.push(...windowRows(visN));
	for (const d of det) rows.push(padSegs(truncSegs(d.row, w), w, 'overlay'));

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

// ---- pricing detail (model catalog) ----------------------------------------

const SLIDER_W = 30;

// green → yellow → orange → purple, RGB-interpolated per cell; the token
// is the nearest stop (ANSI fallback), `hex` the truecolor gradient color
const STOPS: {t: number; rgb: [number, number, number]; tok: Token}[] = [
	{t: 0.0, rgb: [0x3d, 0xdc, 0x84], tok: 'pkGreen'},
	{t: 0.4, rgb: [0xe6, 0xd1, 0x7a], tok: 'pkYellow'},
	{t: 0.7, rgb: [0xe5, 0xa0, 0x7a], tok: 'pkOrange'},
	{t: 1.0, rgb: [0xb4, 0x8e, 0xad], tok: 'pkPurple'},
];

function gradAt(t: number): {hex: string; tok: Token} {
	for (let i = 1; i < STOPS.length; i++) {
		if (t <= STOPS[i].t) {
			const a = STOPS[i - 1];
			const b = STOPS[i];
			const f = (t - a.t) / (b.t - a.t);
			const mix = a.rgb.map((v, j) =>
				Math.round(v + (b.rgb[j] - v) * f),
			);
			return {
				hex: `#${mix.map(v => v.toString(16).padStart(2, '0')).join('')}`,
				tok: f < 0.5 ? a.tok : b.tok,
			};
		}
	}
	const last = STOPS[STOPS.length - 1];
	return {hex: '#b48ead', tok: last.tok};
}

/** Three text columns spread across `span` cells: left/center/right. */
function spread3(a: string, b: string, c: string, span: number, k: Token): Seg[] {
	const aw = strWidth(a);
	const bw = strWidth(b);
	const cw = strWidth(c);
	const bx = Math.max(aw + 1, Math.floor((span - bw) / 2));
	const cx = Math.max(bx + bw + 1, span - cw);
	return [
		seg(a, k, 'overlay'),
		seg(' '.repeat(bx - aw), k, 'overlay'),
		seg(b, k, 'overlay'),
		seg(' '.repeat(cx - bx - bw), k, 'overlay'),
		seg(c, k, 'overlay'),
	];
}

function badgeFor(cat: ModelCatalog, uid: string): Token | null {
	const e = cat.get(uid);
	if (!e) return null;
	return e.isNew ? 'pkGreen' : e.isBeta ? 'pkYellow' : null;
}

/** The ` ✱ New  ✱ Beta` legend — only for badges present in `uids`. */
function legendRows(uids: string[], cat: ModelCatalog): DetailRow[] {
	const hasNew = uids.some(u => cat.get(u)?.isNew);
	const hasBeta = uids.some(u => cat.get(u)?.isBeta);
	if (!hasNew && !hasBeta) return [];
	const row: Seg[] = [seg('  ', 'plain', 'overlay')];
	if (hasNew) row.push(seg('✱', 'pkGreen', 'overlay'), seg(' New', 'muted', 'overlay'));
	if (hasNew && hasBeta) row.push(seg('   ', 'plain', 'overlay'));
	if (hasBeta) row.push(seg('✱', 'pkYellow', 'overlay'), seg(' Beta', 'muted', 'overlay'));
	return [{row, kind: 'legend'}];
}

/**
 * Detail rows under the picker list for the selected model uid: a blank
 * row, the ~30-col gradient price slider (knob at the model's output price
 * on a log scale between the min/max output price of `allUids`), label +
 * value rows, a blank, then the badge legend. Free models show the FREE
 * badge instead; uids missing from the catalog show only the legend; an
 * unavailable catalog shows the single faint hint.
 */
function pricingDetail(
	uid: string | undefined,
	allUids: string[],
	cat: CatalogState,
): DetailRow[] {
	if (cat.status === 'loading') return [];
	if (cat.status === 'unavailable') {
		return [
			{
				row: [
					seg(
						'  prices unavailable — log in the Devin CLI (devin auth login) to load them',
						'faint',
						'overlay',
					),
				],
				kind: 'other',
			},
		];
	}
	const legend = legendRows(allUids, cat.catalog);
	const entry = uid ? cat.catalog.get(uid) : undefined;
	if (!entry) return legend;
	const pad: DetailRow = {row: [seg(' ', 'plain', 'overlay')], kind: 'pad'};
	if (!entry.prices || entry.costTier === 'Free') {
		return [
			pad,
			{
				row: [
					seg('  ', 'plain', 'overlay'),
					seg(' FREE ', 'pkBadge', 'pkBlue'),
					seg('  no quota consumed', 'muted', 'overlay'),
				],
				kind: 'other',
			},
			pad,
			...legend,
		];
	}
	const outs = allUids
		.map(u => cat.catalog.get(u)?.prices?.output)
		.filter((n): n is number => n !== undefined);
	const lo = Math.min(...outs);
	const hi = Math.max(...outs);
	const pos =
		outs.length > 1 && hi > lo
			? (Math.log(entry.prices.output) - Math.log(lo)) /
				(Math.log(hi) - Math.log(lo))
			: 0.5;
	const knob = Math.round(pos * (SLIDER_W - 1));
	const slider: Seg[] = [seg('  ', 'plain', 'overlay')];
	for (let i = 0; i < SLIDER_W; i++) {
		if (i === knob) {
			slider.push(seg('●', 'bright', 'overlay'));
		} else {
			const g = gradAt(i / (SLIDER_W - 1));
			slider.push({t: '━', k: g.tok, bg: 'overlay', hex: g.hex});
		}
	}
	const fmt = (n?: number) => (n === undefined ? '—' : `$${n} / 1M`);
	return [
		pad,
		{row: slider, kind: 'slider'},
		{
			row: [
				seg('  ', 'plain', 'overlay'),
				...spread3('Input', 'Cached input', 'Output', SLIDER_W, 'muted'),
			],
			kind: 'other',
		},
		{
			row: [
				seg('  ', 'plain', 'overlay'),
				...spread3(
					fmt(entry.prices.input),
					fmt(entry.prices.cached),
					fmt(entry.prices.output),
					SLIDER_W,
					'bright',
				),
			],
			kind: 'other',
		},
		pad,
		...legend,
	];
}

// ---- /model picker ---------------------------------------------------------

export interface LevelOpt {
	id: string; // normalized lowercase level id ('high', 'xhigh', …)
	name: string; // display name ('High', 'XHigh', …)
}

/** The reasoning levels available on one model row. The applied model's
 *  row uses the ACP `thought_level` values (authoritative — real Devin
 *  changes them per model); every other row derives its list from the
 *  catalog's family variants (`levelsFor`). [] → no control. */
export function rowLevels(
	o: {value: string},
	modelOpt: SessionConfigOption,
	effortOpt: SessionConfigOption | undefined,
	catalog: CatalogState,
): LevelOpt[] {
	if (o.value === modelOpt.currentValue && effortOpt) {
		return configValues(effortOpt).map(v => ({
			id: v.value,
			name: v.name,
		}));
	}
	if (catalog.status === 'ready') return levelsFor(catalog.catalog, o.value);
	return [];
}

/** The selected level index for a row: the pending pick in
 *  `view.effort`, else the applied model's live value (current row) or
 *  the catalog entry's own level. When that id isn't in the row's list
 *  the nearest level by rank wins; unranked → the last entry. */
export function rowLevelIdx(
	levels: LevelOpt[],
	view: PickerView,
	o: {value: string},
	modelOpt: SessionConfigOption,
	effortOpt: SessionConfigOption | undefined,
	catalog: CatalogState,
): number {
	if (levels.length === 0) return -1;
	const isCurrent = o.value === modelOpt.currentValue;
	const want =
		view.effort[o.value] ??
		(isCurrent
			? effortOpt?.currentValue !== undefined
				? String(effortOpt.currentValue)
				: undefined
			: catalog.status === 'ready'
				? catalog.catalog.get(o.value)?.level?.toLowerCase()
				: undefined);
	const exact = levels.findIndex(l => l.id === want);
	if (exact >= 0) return exact;
	const wantRank = want !== undefined ? levelRank(want) : -1;
	if (wantRank >= 0) {
		let best = -1;
		for (let i = 0; i < levels.length; i++) {
			if (
				best === -1 ||
				Math.abs(levelRank(levels[i].name) - wantRank) <
					Math.abs(levelRank(levels[best].name) - wantRank)
			)
				best = i;
		}
		if (best >= 0) return best;
	}
	return levels.length - 1;
}

export function pickerLines(
	modelOpt: SessionConfigOption,
	effortOpt: SessionConfigOption | undefined,
	view: PickerView,
	w: number,
	catalog: CatalogState,
	maxRows?: number,
): Seg[][] {
	const groups = configGroups(modelOpt);
	const filtered = filteredOptions(modelOpt, view.filter);
	const sel = Math.min(view.sel, Math.max(0, filtered.length - 1));
	const selOpt = filtered[sel];
	const allUids = configValues(modelOpt).map(o => o.value);

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

	const lvlOf = (o: {value: string}) =>
		rowLevels(o, modelOpt, effortOpt, catalog);
	const idxOf = (o: {value: string}, lvls: LevelOpt[]) =>
		rowLevelIdx(lvls, view, o, modelOpt, effortOpt, catalog);
	const selLvls = selOpt ? lvlOf(selOpt) : [];
	// bars pad to the widest row so level names line up in one column
	const maxBars = Math.max(
		0,
		...display.map(r => ('opt' in r ? lvlOf(r.opt).length : 0)),
	);

	return pickerShell({
		filter: view.filter,
		display,
		sel,
		isCurrent: o => o.value === modelOpt.currentValue,
		badge: o =>
			catalog.status === 'ready' ? badgeFor(catalog.catalog, o.value) : null,
		detail: o => pricingDetail(o?.value, allUids, catalog),
		maxRows,
		control: (o, isSel, bg) => {
			const lvls = lvlOf(o);
			if (lvls.length === 0) return [];
			const i = Math.max(0, idxOf(o, lvls));
			const pad = seg(' '.repeat(maxBars - lvls.length), 'plain', bg);
			return isSel
				? [
						seg('← ', 'pkDim', bg),
						...lvls.map((_, j) =>
							seg('■', j <= i ? 'pk' : 'pkOff', bg),
						),
						seg(' →', 'pkDim', bg),
						pad,
						seg('  ', 'plain', bg),
						seg(lvls[i].name, 'pk', bg),
					]
				: [
						seg('  ', 'plain', bg),
						...lvls.map((_, j) =>
							seg('■', j <= i ? 'muted' : 'faint', bg),
						),
						pad,
						seg('    ', 'plain', bg),
						seg(lvls[i].name, 'muted', bg),
					];
		},
		midHint: selLvls.length > 0 ? 'reasoning effort' : undefined,
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
	catalog: CatalogState,
	maxRows?: number,
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
		control: (_o, isSel, bg) =>
			isSel && selLead
				? [
						seg('← ', 'pkDim', bg),
						seg('+ ', 'pkDim', bg),
						seg(selLead.pairs[skIdx]?.sidekick ?? '', 'pk', bg),
						seg(' →', 'pkDim', bg),
					]
				: [],
		// pricing for the currently selected lead+sidekick pair — the
		// `fusion-…` uid is in the catalog too; scale over all pair values
		detail: () =>
			pricingDetail(
				selLead?.pairs[skIdx]?.value,
				leads.flatMap(l => l.pairs.map(p => p.value)),
				catalog,
			),
		maxRows,
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
