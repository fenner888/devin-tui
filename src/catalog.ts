import {execFile} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {resolveBin} from './acp/connection.js';

/**
 * Model catalog (pricing + badges) for the /model and /fusion pickers.
 *
 * Source order:
 *   1. `DEVIN_TUI_MODELS_FILE` env — read that JSON directly (tests).
 *   2. `devin models list --format json` — on success the payload is also
 *      written to the persistent cache `~/.cache/devin-tui/models.json`.
 *   3. the cache file — when the CLI fails (not logged in, timeout, …).
 *   4. unavailable — the picker renders without pricing and shows one
 *      faint footer hint.
 */

export interface CatalogPrices {
	input: number;
	cached?: number;
	output: number;
}

export interface CatalogEntry {
	label: string;
	/** 'Free' | 'Low cost' | 'Med cost' | 'High cost' */
	costTier?: string;
	prices?: CatalogPrices;
	isNew: boolean;
	isBeta: boolean;
	maxContext?: number;
	/** family_uid this variant belongs to */
	family?: string;
	/** family_label (for fusion-family detection) */
	familyLabel?: string;
	/** normalized reasoning-level name ('Low','Medium','High','XHigh',
	 *  'Max','None'); undefined when the label suffix isn't a level */
	level?: string;
	/** modifier key shared by sibling variants — '' / 'fast' / '1m' /
	 *  '1m,fast' (sorted, comma-joined) */
	mods?: string;
}

export type ModelCatalog = Map<string, CatalogEntry>;

export type CatalogState =
	| {status: 'loading'}
	| {status: 'ready'; catalog: ModelCatalog}
	| {status: 'unavailable'};

const CACHE_FILE = path.join(os.homedir(), '.cache', 'devin-tui', 'models.json');
const TIMEOUT_MS = 20_000;

/** `$10 / 1M Input · $0.25 / 1M Cached input · $50 / 1M Output` → numbers.
 *  Tolerant: decimals, extra segments like `· Sidekick: Free` ignored. */
function parsePrices(summary: unknown): CatalogPrices | undefined {
	if (typeof summary !== 'string') return undefined;
	const out: {input?: number; cached?: number; output?: number} = {};
	const re = /\$([\d.]+)\s*\/\s*1M\s+([A-Za-z ]+)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(summary))) {
		const n = Number.parseFloat(m[1]);
		if (!Number.isFinite(n)) continue;
		const label = m[2].trim().toLowerCase();
		if (label.startsWith('cached')) out.cached = n;
		else if (label === 'input') out.input = n;
		else if (label === 'output') out.output = n;
	}
	return out.input !== undefined && out.output !== undefined
		? {input: out.input, cached: out.cached, output: out.output}
		: undefined;
}

// ---- reasoning levels -------------------------------------------------------

/** Canonical level names by rank (higher = more effort). */
const LEVEL_NAMES = ['None', 'Low', 'Medium', 'High', 'XHigh', 'Max'];
const LEVEL_RANK = new Map(LEVEL_NAMES.map((n, i) => [n.toLowerCase(), i]));

/** Rank of a level name (-1 when unrecognized). */
export function levelRank(name: string): number {
	return LEVEL_RANK.get(name.toLowerCase()) ?? -1;
}

/** `label` minus the family prefix → normalized `level` + `mods`.
 *  Suffix like 'Medium Thinking' → Medium; 'No Thinking' → None;
 *  'Max Fast' / 'High 1M' → level + a mods key so Fast/1M variants form
 *  their own level list. Empty suffix → no level. */
function parseLevel(
	suffix: string,
): {level?: string; mods: string} {
	const mods = new Set<string>();
	const rest: string[] = [];
	for (const w of suffix.split(/\s+/).filter(Boolean)) {
		const lw = w.toLowerCase();
		if (lw === 'fast' || lw === '1m') mods.add(lw);
		else if (lw === 'thinking') continue;
		else rest.push(w);
	}
	const modsKey = [...mods].sort().join(',');
	let name = rest.join(' ');
	if (name === 'No') name = 'None';
	if (!name) return {mods: modsKey};
	const canon = LEVEL_NAMES.find(l => l.toLowerCase() === name.toLowerCase());
	return canon ? {level: canon, mods: modsKey} : {mods: modsKey};
}

/** Parse `devin models list --format json` output → model_uid index. */
export function parseCatalog(text: string): ModelCatalog {
	const data = JSON.parse(text) as {
		families?: {
			family_label?: string;
			family_uid?: string;
			variants?: {
				model_uid?: string;
				label?: string;
				cost_tier?: string;
				cost_summary?: string;
				is_new?: boolean;
				is_beta?: boolean;
				max_context_tokens?: number;
			}[];
		}[];
	};
	const byUid: ModelCatalog = new Map();
	for (const f of data.families ?? []) {
		const famLabel = f.family_label ?? '';
		for (const v of f.variants ?? []) {
			if (!v.model_uid) continue;
			const label = v.label ?? v.model_uid;
			const suffix = label.startsWith(famLabel)
				? label.slice(famLabel.length).trim()
				: label.trim();
			const {level, mods} = parseLevel(suffix);
			byUid.set(v.model_uid, {
				label,
				costTier: v.cost_tier,
				prices: parsePrices(v.cost_summary),
				isNew: v.is_new === true,
				isBeta: v.is_beta === true,
				maxContext: v.max_context_tokens,
				family: f.family_uid,
				familyLabel: famLabel || undefined,
				level,
				mods,
			});
		}
	}
	return byUid;
}

/** The reasoning levels available for `uid`: sibling variants in the same
 *  family with the same `mods` key and a recognized level — deduped,
 *  rank-sorted. [] for the Fusion family, unknown uids and families with
 *  fewer than two levels (e.g. Adaptive). */
export function levelsFor(
	cat: ModelCatalog,
	uid: string,
): {id: string; name: string}[] {
	const entry = cat.get(uid);
	if (!entry?.family) return [];
	if (
		entry.family.toLowerCase().startsWith('fusion') ||
		(entry.familyLabel ?? '').startsWith('Fusion')
	)
		return [];
	const mods = entry.mods ?? '';
	const names = new Set<string>();
	for (const e of cat.values()) {
		if (e.family !== entry.family || (e.mods ?? '') !== mods) continue;
		if (e.level) names.add(e.level);
	}
	const out = [...names]
		.sort((a, b) => levelRank(a) - levelRank(b))
		.map(name => ({id: name.toLowerCase(), name}));
	return out.length < 2 ? [] : out;
}

function runModelsList(): Promise<string | null> {
	return new Promise(resolve => {
		const child = execFile(
			resolveBin('devin'),
			['models', 'list', '--format', 'json'],
			{timeout: TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024},
			(err, stdout) => {
				resolve(err || !stdout.trim() ? null : stdout);
			},
		);
		child.on('error', () => resolve(null));
	});
}

function readFileCatalog(file: string): ModelCatalog | null {
	try {
		return parseCatalog(fs.readFileSync(file, 'utf8'));
	} catch {
		return null;
	}
}

let pending: Promise<CatalogState> | null = null;

/** Load the catalog once — CLI → persistent cache → unavailable. */
export function loadCatalog(): Promise<CatalogState> {
	pending ??= (async (): Promise<CatalogState> => {
		const fixture = process.env.DEVIN_TUI_MODELS_FILE;
		if (fixture) {
			const catalog = readFileCatalog(fixture);
			return catalog
				? {status: 'ready', catalog}
				: {status: 'unavailable'};
		}
		const text = await runModelsList();
		if (text !== null) {
			try {
				const catalog = parseCatalog(text);
				fs.mkdirSync(path.dirname(CACHE_FILE), {recursive: true});
				fs.writeFileSync(CACHE_FILE, text);
				return {status: 'ready', catalog};
			} catch {
				// unparsable payload — fall through to the cache
			}
		}
		const cached = readFileCatalog(CACHE_FILE);
		return cached
			? {status: 'ready', catalog: cached}
			: {status: 'unavailable'};
	})();
	return pending;
}
