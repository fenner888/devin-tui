/**
 * /handoff — hand the session off to a cloud Devin. Mirrors the
 * open-source devin-handoff.sh `create` command:
 *   POST {api}/v1/sessions            (personal apk_* keys)
 *   POST {api}/v3/organizations/{org}/sessions  (service cog_* keys)
 * with `{prompt, title, tags: ["handoff"]}` — the prompt embeds repo,
 * branch, context and the uncommitted diff in <details> blocks.
 * DEVIN_API_URL overrides the API base (default https://api.devin.ai).
 * The API key is only ever sent in the Authorization header — never
 * logged or written to disk.
 */
import {execFile} from 'node:child_process';

const MAX_DIFF_BYTES = 102400; // 100KB, same as the script

export interface GitContext {
	repo?: string;
	branch?: string;
	diff?: string;
}

function git(args: string[], cwd: string): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			'git',
			args,
			{cwd, maxBuffer: 8 * 1024 * 1024},
			(err, stdout) => (err ? reject(err) : resolve(String(stdout))),
		);
	});
}

/** `git remote get-url origin` → `owner/repo` (the script's sed chain). */
function repoSlug(remote: string): string {
	return remote
		.trim()
		.replace(/^(ssh:\/\/)?git@[^:/]+[:/]/, '')
		.replace(/^https?:\/\/[^/]+\//, '')
		.replace(/\.git$/, '');
}

/** Byte-cap like `head -c` (a partial trailing UTF-8 sequence drops out). */
function capBytes(s: string, max: number): string {
	const buf = Buffer.from(s, 'utf8');
	return buf.length <= max ? s : buf.subarray(0, max).toString('utf8');
}

/** Current branch name (short sha when detached); undefined outside a
 *  git repo or on any error. */
export async function currentBranch(cwd: string): Promise<string | undefined> {
	try {
		const name = (
			await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
		).trim();
		if (name && name !== 'HEAD') return name;
		const sha = (await git(['rev-parse', '--short', 'HEAD'], cwd)).trim();
		return sha || undefined;
	} catch {
		return undefined;
	}
}

/** Best-effort git context — {} when cwd isn't inside a git repo. */
export async function gatherGitContext(cwd: string): Promise<GitContext> {
	try {
		await git(['rev-parse', '--git-dir'], cwd);
	} catch {
		return {};
	}
	const [remote, branch, diff] = await Promise.all([
		git(['remote', 'get-url', 'origin'], cwd)
			.then(repoSlug)
			.catch(() => ''),
		git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
			.then(b => b.trim())
			.catch(() => ''),
		git(['diff', 'HEAD'], cwd)
			.then(d => capBytes(d, MAX_DIFF_BYTES))
			.catch(() => ''),
	]);
	return {
		repo: remote || undefined,
		branch: branch || undefined,
		diff: diff || undefined,
	};
}

/** Prompt assembly — identical shape to the script's `create`. */
export function buildHandoffPrompt(
	task: string,
	c: GitContext & {context?: string},
): string {
	let prompt = task;
	let details = '';
	if (c.repo) details += `Repo: ${c.repo}\n`;
	if (c.branch) details += `Branch: ${c.branch}\n`;
	if (c.context) details += `\n${c.context}\n`;
	if (details) {
		prompt += `\n\n<details>\n<summary>Context from local environment</summary>\n\n${details}\n</details>`;
	}
	if (c.diff) {
		prompt +=
			`\n\n<details>\n<summary>Uncommitted local changes (diff)</summary>\n\n` +
			`\`\`\`diff\n${c.diff}\n\`\`\`\n\n</details>`;
	}
	return prompt;
}

export interface HandoffBody {
	prompt: string;
	title: string;
	tags: string[];
	create_as_user_id?: string;
}

export interface HandoffRequest {
	url: string;
	headers: Record<string, string>;
	body: HandoffBody;
}

/** Build the POST request the script would send for `create`. */
export function handoffRequest(prompt: string, task: string): HandoffRequest {
	const apiUrl = (
		process.env.DEVIN_API_URL ?? 'https://api.devin.ai'
	).replace(/\/+$/, '');
	const key = process.env.DEVIN_API_KEY ?? '';
	const org = process.env.DEVIN_ORG_ID ?? '';
	const uid = process.env.DEVIN_USER_ID ?? '';
	let base: string;
	if (key.startsWith('cog_')) {
		if (!org) {
			throw new Error(
				'DEVIN_ORG_ID is required for service keys (cog_*)',
			);
		}
		base = `${apiUrl}/v3/organizations/${org}`;
	} else {
		base = `${apiUrl}/v1`;
	}
	const body: HandoffBody = {
		prompt,
		title: task.slice(0, 100),
		tags: ['handoff'],
	};
	if (uid && key.startsWith('cog_')) body.create_as_user_id = uid;
	return {
		url: `${base}/sessions`,
		headers: {
			Authorization: `Bearer ${key}`,
			'Content-Type': 'application/json',
		},
		body,
	};
}

/** POST the request; resolves the session URL (.url, else derived from
 *  .session_id like the script). Errors carry HTTP status + server detail —
 *  never the API key. */
export async function sendHandoff(
	prompt: string,
	task: string,
): Promise<string> {
	const req = handoffRequest(prompt, task);
	let res: Response;
	try {
		res = await fetch(req.url, {
			method: 'POST',
			headers: req.headers,
			body: JSON.stringify(req.body),
		});
	} catch (e) {
		throw new Error(e instanceof Error ? e.message : String(e));
	}
	const raw = await res.text();
	let data: Record<string, unknown> = {};
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === 'object') {
			data = parsed as Record<string, unknown>;
		}
	} catch {
		// non-JSON body
	}
	if (res.status < 200 || res.status >= 300) {
		const detail =
			data.detail ?? data.message ?? data.error ?? (raw || 'Unknown error');
		throw new Error(`HTTP ${res.status}: ${String(detail)}`);
	}
	const url = typeof data.url === 'string' ? data.url : '';
	const sid = typeof data.session_id === 'string' ? data.session_id : '';
	if (url) return url;
	if (sid) {
		return `https://app.devin.ai/sessions/${sid.replace(/^devin-/, '')}`;
	}
	throw new Error('no session URL in response');
}
