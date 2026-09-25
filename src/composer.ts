import {execFile} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import type {ContentBlock} from '@agentclientprotocol/sdk';

const execFileP = promisify(execFile);

// ---- visual lines (multiline composer) --------------------------------------

export interface VLine {
	/** char offset of this row's first char inside the input value */
	start: number;
	/** row length in chars (excludes the '\n' ending a logical line) */
	len: number;
}

/** Split the input into hard-wrapped visual rows of `room` chars. */
export function visualLines(value: string, room: number): VLine[] {
	const w = Math.max(1, room);
	const out: VLine[] = [];
	let i = 0;
	for (const logical of value.split('\n')) {
		if (logical.length === 0) {
			out.push({start: i, len: 0});
		} else {
			for (let off = 0; off < logical.length; off += w) {
				out.push({start: i + off, len: Math.min(w, logical.length - off)});
			}
		}
		i += logical.length + 1;
	}
	return out;
}

/** Visual row index holding `cursor` (a '\n' belongs to the line it ends). */
export function cursorLine(vls: VLine[], cursor: number): number {
	let idx = 0;
	for (let i = 0; i < vls.length; i++) {
		if (vls[i].start <= cursor) idx = i;
	}
	return idx;
}

/** Move the cursor one visual row up/down keeping the column. Returns null
 *  when there's no row in that direction — callers fall back to prompt
 *  history (↑ on the first row, ↓ on the last). */
export function moveVertical(
	value: string,
	cursor: number,
	room: number,
	dir: -1 | 1,
): number | null {
	const vls = visualLines(value, room);
	const cur = cursorLine(vls, cursor);
	const target = cur + dir;
	if (target < 0 || target >= vls.length) return null;
	const col = cursor - vls[cur].start;
	return vls[target].start + Math.min(col, vls[target].len);
}

// ---- @file mentions ---------------------------------------------------------

export interface MentionToken {
	/** index of the '@' */
	start: number;
	/** end of the token (next whitespace or EOL) */
	end: number;
	/** text between '@' and the cursor */
	q: string;
}

/** The `@…` token under the cursor — only when `@` begins the token. */
export function mentionToken(
	value: string,
	cursor: number,
): MentionToken | null {
	let s = cursor;
	while (s > 0 && !/\s/.test(value[s - 1])) s--;
	if (s === cursor || value[s] !== '@') return null;
	let e = cursor;
	while (e < value.length && !/\s/.test(value[e])) e++;
	return {start: s, end: e, q: value.slice(s + 1, cursor)};
}

const MAX_FILES = 5000;

/** Files under cwd: `git ls-files -co --exclude-standard` inside a repo,
 *  otherwise a bounded walk that skips node_modules/.git. */
export async function listProjectFiles(cwd: string): Promise<string[]> {
	try {
		const {stdout} = await execFileP(
			'git',
			['-C', cwd, 'ls-files', '-co', '--exclude-standard'],
			{maxBuffer: 16 * 1024 * 1024},
		);
		const files = stdout.split('\n').filter(Boolean);
		if (files.length > 0) return files.slice(0, MAX_FILES);
	} catch {
		// not a git repo (or git missing) — fall through to the walk
	}
	return walkFiles(cwd);
}

function walkFiles(cwd: string): string[] {
	const out: string[] = [];
	const stack = [''];
	while (stack.length > 0 && out.length < MAX_FILES) {
		const dir = stack.pop()!;
		let ents: fs.Dirent[];
		try {
			ents = fs.readdirSync(path.join(cwd, dir), {withFileTypes: true});
		} catch {
			continue;
		}
		for (const e of ents) {
			if (e.name === 'node_modules' || e.name === '.git') continue;
			const rel = dir ? `${dir}/${e.name}` : e.name;
			if (e.isDirectory()) {
				if (stack.length + out.length < MAX_FILES * 2) stack.push(rel);
			} else if (e.isFile()) {
				out.push(rel);
				if (out.length >= MAX_FILES) break;
			}
		}
	}
	return out.sort();
}

/** Substring match first, then subsequence (fuzzy) — for the @ dropdown. */
export function matchFile(file: string, q: string): boolean {
	const f = file.toLowerCase();
	const needle = q.toLowerCase();
	if (f.includes(needle)) return true;
	let i = 0;
	for (const ch of f) {
		if (ch === needle[i]) i++;
		if (i === needle.length) return true;
	}
	return needle.length === 0;
}

/** Every `@path` token in `text` that resolves to an existing file inside
 *  cwd — these render as `⌗` chips and send as resource_link blocks. */
export function resolveMentions(
	text: string,
	cwd: string,
): {rel: string; abs: string; name: string}[] {
	const out: {rel: string; abs: string; name: string}[] = [];
	const seen = new Set<string>();
	for (const m of text.matchAll(/(?:^|\s)@(\S+)/g)) {
		const rel = m[1];
		const abs = path.resolve(cwd, rel);
		if (!abs.startsWith(cwd + path.sep)) continue;
		if (seen.has(abs)) continue;
		let st: fs.Stats;
		try {
			st = fs.statSync(abs);
		} catch {
			continue;
		}
		if (!st.isFile()) continue;
		seen.add(abs);
		out.push({rel, abs, name: path.basename(abs)});
	}
	return out;
}

// ---- image attachments ------------------------------------------------------

export interface ImageAttachment {
	/** absolute path */
	path: string;
	name: string;
	mimeType: string;
}

const IMAGE_MIME: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
};

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** The whitespace-bounded token ending at `cursor` (cursor must sit at the
 *  token's end — mid-token positions return null). */
export function tokenEndingAt(
	value: string,
	cursor: number,
): {start: number; end: number; text: string} | null {
	let s = cursor;
	while (s > 0 && !/\s/.test(value[s - 1])) s--;
	let e = cursor;
	while (e < value.length && !/\s/.test(value[e])) e++;
	if (e !== cursor || s === e) return null;
	return {start: s, end: e, text: value.slice(s, e)};
}

/** A typed/pasted token that is a path to an existing image file (quoted
 *  or shell-escaped, `~` ok) becomes an attachment chip. Returns
 *  'tooLarge' past the 5 MB cap. */
export function asImage(
	token: string,
	cwd: string,
): ImageAttachment | 'tooLarge' | null {
	let t = token.trim();
	if (
		t.length >= 2 &&
		((t.startsWith('"') && t.endsWith('"')) ||
			(t.startsWith("'") && t.endsWith("'")))
	) {
		t = t.slice(1, -1);
	}
	t = t.replace(/\\(.)/g, '$1'); // unescape (\ , \" …)
	if (t.startsWith('~/')) t = os.homedir() + t.slice(1);
	if (!t) return null;
	const abs = path.isAbsolute(t) ? t : path.resolve(cwd, t);
	const mimeType = IMAGE_MIME[path.extname(abs).toLowerCase()];
	if (!mimeType) return null;
	let st: fs.Stats;
	try {
		st = fs.statSync(abs);
	} catch {
		return null;
	}
	if (!st.isFile()) return null;
	if (st.size > MAX_IMAGE_BYTES) return 'tooLarge';
	return {path: abs, name: path.basename(abs), mimeType};
}

// ---- prompt blocks ----------------------------------------------------------

/** The ACP content blocks for a prompt: the text block (keeping the
 *  original `@path` tokens), one resource_link per resolved mention, then
 *  one base64 image block per attachment. */
export function buildBlocks(
	text: string,
	images: ImageAttachment[],
	cwd: string,
): ContentBlock[] {
	const blocks: ContentBlock[] = [{type: 'text', text}];
	for (const m of resolveMentions(text, cwd)) {
		blocks.push({
			type: 'resource_link',
			uri: pathToFileURL(m.abs).href,
			name: m.name,
		});
	}
	for (const a of images) {
		blocks.push({
			type: 'image',
			mimeType: a.mimeType,
			data: fs.readFileSync(a.path).toString('base64'),
		});
	}
	return blocks;
}
