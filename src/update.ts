import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {defaultLogFile} from './acp/connection.js';

const PKG_URL =
	'https://raw.githubusercontent.com/fenner888/devin-tui/main/package.json';
const DAY_MS = 24 * 60 * 60 * 1000;

/** `version` from the project's own package.json — resolved relative to
 *  this module file (import.meta.url), never cwd. */
export function localVersion(): string {
	try {
		const pkg = JSON.parse(
			fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
		) as {version?: unknown};
		return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
	} catch {
		return '0.0.0';
	}
}

/** Numeric semver compare on major.minor.patch (prerelease/build
 *  ignored): >0 when a is newer than b. */
export function cmpSemver(a: string, b: string): number {
	const parts = (v: string) =>
		v
			.trim()
			.replace(/^v/, '')
			.split(/[-+]/)[0]
			.split('.')
			.map(n => parseInt(n, 10) || 0);
	const pa = parts(a);
	const pb = parts(b);
	for (let i = 0; i < 3; i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d) return d;
	}
	return 0;
}

interface UpdateCache {
	checkedAt: number;
	latest?: string;
}

/** Check GitHub for a newer package.json version — at most one network
 *  request per 24 h (cached at ~/.cache/devin-tui/update-check.json or
 *  DEVIN_TUI_UPDATE_CACHE). Returns the remote version only when it is
 *  newer than the local one.
 *
 *  Skipped entirely when `DEVIN_TUI_NO_UPDATE_CHECK=1`, and when
 *  `opts.enabled` is false (a `--agent` override — tests/fake agent never
 *  touch the network) unless `DEVIN_TUI_FORCE_UPDATE_CHECK=1`.
 *  `DEVIN_TUI_UPDATE_URL` overrides the remote URL. Any error → silent
 *  (one line in devin-acp.log). */
export async function checkForUpdate(opts: {
	enabled: boolean;
}): Promise<string | undefined> {
	if (process.env.DEVIN_TUI_NO_UPDATE_CHECK === '1') return undefined;
	if (!opts.enabled && process.env.DEVIN_TUI_FORCE_UPDATE_CHECK !== '1')
		return undefined;
	try {
		const cacheFile =
			process.env.DEVIN_TUI_UPDATE_CACHE ??
			path.join(os.homedir(), '.cache', 'devin-tui', 'update-check.json');
		let latest: string | undefined;
		let checkedAt = 0;
		try {
			const c = JSON.parse(
				fs.readFileSync(cacheFile, 'utf8'),
			) as UpdateCache;
			if (typeof c.checkedAt === 'number') checkedAt = c.checkedAt;
			if (typeof c.latest === 'string') latest = c.latest;
		} catch {
			// no or unreadable cache — a fetch will follow
		}
		if (Date.now() - checkedAt > DAY_MS) {
			const url = process.env.DEVIN_TUI_UPDATE_URL ?? PKG_URL;
			const res = await fetch(url, {signal: AbortSignal.timeout(3000)});
			if (!res.ok) throw new Error(`http ${res.status}`);
			const pkg = (await res.json()) as {version?: unknown};
			if (typeof pkg.version !== 'string')
				throw new Error('no version in package.json');
			latest = pkg.version;
			checkedAt = Date.now();
			try {
				fs.mkdirSync(path.dirname(cacheFile), {recursive: true});
				fs.writeFileSync(
					cacheFile,
					JSON.stringify({checkedAt, latest}),
				);
			} catch {
				// a read-only cache dir must not break anything
			}
		}
		if (latest && cmpSemver(latest, localVersion()) > 0) return latest;
		return undefined;
	} catch (e) {
		try {
			fs.appendFileSync(
				defaultLogFile(),
				`update check: ${e instanceof Error ? e.message : String(e)}\n`,
			);
		} catch {
			// diagnostics must never throw
		}
		return undefined;
	}
}
