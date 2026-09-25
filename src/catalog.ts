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

/** Parse `devin models list --format json` output → model_uid index. */
export function parseCatalog(text: string): ModelCatalog {
	const data = JSON.parse(text) as {
		families?: {
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
		for (const v of f.variants ?? []) {
			if (!v.model_uid) continue;
			byUid.set(v.model_uid, {
				label: v.label ?? v.model_uid,
				costTier: v.cost_tier,
				prices: parsePrices(v.cost_summary),
				isNew: v.is_new === true,
				isBeta: v.is_beta === true,
				maxContext: v.max_context_tokens,
			});
		}
	}
	return byUid;
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
