import type {CatalogState, CatalogEntry} from './catalog.js';

/** One `_cognition.ai/turn_stats` notification, distilled. Token values are
 *  PER TURN (not cumulative); `input` excludes cached tokens (cached is a
 *  separate dimension). */
export interface TurnStat {
	turnRequestId: string;
	/** catalog variant label, e.g. 'Claude Opus 5.5 XHigh' */
	model?: string;
	input: number;
	cached: number;
	output: number;
	/** other cumulativeMetric dimensions (ACUs, credits…) summed by uid */
	extra: {uid: string; label: string; value: number; tail: string; pluralTail: string}[];
}

const CORE_UIDS = new Set([
	'agent_messages',
	'input_tokens',
	'output_tokens',
	'cached_input_tokens',
]);

/** Parse a `_cognition.ai/turn_stats` notification params object. Tolerant:
 *  returns null without a sessionId/turnRequestId; missing/odd dimensions
 *  are skipped rather than fatal. */
export function parseTurnStats(
	params: unknown,
): {sessionId: string; stat: TurnStat} | null {
	if (typeof params !== 'object' || params === null) return null;
	const p = params as Record<string, unknown>;
	const sessionId = p.sessionId;
	const turnRequestId = p.turnRequestId;
	if (typeof sessionId !== 'string' || typeof turnRequestId !== 'string')
		return null;
	const stat: TurnStat = {
		turnRequestId,
		input: 0,
		cached: 0,
		output: 0,
		extra: [],
	};
	const dims = p.responseDimensions;
	if (Array.isArray(dims)) {
		for (const d of dims) {
			if (typeof d !== 'object' || d === null) continue;
			const dim = d as {
				uid?: unknown;
				label?: unknown;
				kind?: {
					type?: unknown;
					value?: unknown;
					tail?: unknown;
					pluralTail?: unknown;
				};
			};
			const uid = dim.uid;
			const kind = dim.kind;
			if (typeof uid !== 'string' || typeof kind !== 'object' || !kind)
				continue;
			if (kind.type === 'metric' && typeof kind.value === 'string') {
				if (uid === 'model') stat.model = kind.value;
				continue;
			}
			if (kind.type !== 'cumulativeMetric' || typeof kind.value !== 'number')
				continue;
			if (uid === 'input_tokens') stat.input = kind.value;
			else if (uid === 'output_tokens') stat.output = kind.value;
			else if (uid === 'cached_input_tokens') stat.cached = kind.value;
			else if (!CORE_UIDS.has(uid)) {
				stat.extra.push({
					uid,
					label: typeof dim.label === 'string' ? dim.label : uid,
					value: kind.value,
					tail: typeof kind.tail === 'string' ? kind.tail : '',
					pluralTail:
						typeof kind.pluralTail === 'string'
							? kind.pluralTail
							: typeof kind.tail === 'string'
								? kind.tail
								: '',
				});
			}
		}
	}
	return {sessionId, stat};
}

export interface Spend {
	turns: number;
	input: number;
	cached: number;
	output: number;
	/** USD summed over priced turns */
	usd: number;
	/** turns whose model couldn't be priced (unpriced/fusion/unknown) */
	unpriced: number;
	extra: {label: string; value: number; tail: string; pluralTail: string}[];
	/** Devin's own cumulative figure when usage_update carried `cost` —
	 *  always wins over the computed `usd` */
	reported?: {amount: number; currency: string};
}

/** Sum per-turn stats into a session spend. Token prices come from the
 *  catalog by model LABEL; `Fusion (…)` labels are never priced (a pair's
 *  main vs sidekick tokens can't be split). */
export function sessionSpend(
	stats: TurnStat[],
	catalog: CatalogState,
	reported?: {amount: number; currency: string},
): Spend {
	// label → entry index (catalog is uid-keyed; turn_stats carries labels)
	const byLabel = new Map<string, CatalogEntry>();
	if (catalog.status === 'ready') {
		for (const e of catalog.catalog.values()) byLabel.set(e.label, e);
	}
	const out: Spend = {
		turns: stats.length,
		input: 0,
		cached: 0,
		output: 0,
		usd: 0,
		unpriced: 0,
		extra: [],
		reported,
	};
	const extraByUid = new Map<string, number>();
	const extraMeta = new Map<string, {label: string; tail: string; pluralTail: string}>();
	for (const t of stats) {
		out.input += t.input;
		out.cached += t.cached;
		out.output += t.output;
		for (const x of t.extra) {
			extraByUid.set(x.uid, (extraByUid.get(x.uid) ?? 0) + x.value);
			if (!extraMeta.has(x.uid))
				extraMeta.set(x.uid, {
					label: x.label,
					tail: x.tail,
					pluralTail: x.pluralTail,
				});
		}
		const label = t.model;
		if (!label || label.startsWith('Fusion (')) {
			out.unpriced++;
			continue;
		}
		const e = byLabel.get(label);
		if (!e?.prices) {
			// Free tier counts as priced-at-$0; anything else is unpriced
			if (e?.costTier === 'Free') continue;
			out.unpriced++;
			continue;
		}
		out.usd +=
			(t.input * e.prices.input +
				t.cached * (e.prices.cached ?? e.prices.input) +
				t.output * e.prices.output) /
			1e6;
	}
	out.extra = [...extraByUid.entries()].map(([uid, value]) => ({
		label: extraMeta.get(uid)!.label,
		value,
		tail: extraMeta.get(uid)!.tail,
		pluralTail: extraMeta.get(uid)!.pluralTail,
	}));
	return out;
}

/** `$0.04` / `<$0.01` / `12.34 EUR`; computed figures get a trailing `+`
 *  when some turns couldn't be priced. */
export function fmtSpend(s: Spend): string {
	const r = s.reported;
	const base = r
		? r.currency === 'USD'
			? fmtUsd(r.amount)
			: `${r.amount.toFixed(2)} ${r.currency}`
		: fmtUsd(s.usd);
	return !r && s.unpriced > 0 ? `${base}+` : base;
}

function fmtUsd(n: number): string {
	if (n > 0 && n < 0.01) return '<$0.01';
	return `$${n.toFixed(2)}`;
}

/** `10.5k` / `1.24M` / `46` — compact token counts for the /status line. */
export function fmtTokens(n: number): string {
	if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(Math.round(n));
}
