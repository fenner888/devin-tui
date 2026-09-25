import {realpathSync} from 'node:fs';
import {
	type Seg,
	seg,
	wrapSegs,
	padSegs,
	blankLine,
	segsWidth,
	truncSegs,
	strWidth,
	cpWidth,
} from './lines.js';
import {renderMarkdown} from './markdown.js';
import {SPINNER, type Bg, type Token} from '../theme.js';
import {
	configLabel,
	displayMode,
	displayModel,
	findConfigOption,
	type PermissionReq,
	type State,
	type TranscriptItem,
} from '../state/store.js';
import {shortCwd} from './panel.js';

type ToolItem = Extract<TranscriptItem, {kind: 'tool'}>;

const isRunning = (status: string) =>
	status === 'pending' || status === 'in_progress';

function fmtElapsed(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	return `${m}m${s % 60}s`;
}

// ---- transcript items ------------------------------------------------------

/** User message: panel-shaded block; first line prefixed `❯ ` muted. */
function userLines(item: {text: string}, w: number): Seg[][] {
	const text = item.text.replace(/\n+/g, ' ');
	const rows: Seg[][] = [blankLine(w, 'panel')];
	for (const [i, l] of wrapSegs(
		[seg(text, 'bright', 'panel')],
		Math.max(1, w - 2),
	).entries()) {
		rows.push(
			padSegs([seg(i === 0 ? '❯ ' : '  ', 'muted', 'panel'), ...l], w, 'panel'),
		);
	}
	rows.push(blankLine(w, 'panel'));
	return rows;
}

/** Agent message: plain text on bg; fenced code on panel bg with a │ gutter. */
function agentLines(item: {text: string}, w: number, cursor: boolean): Seg[][] {
	const md = renderMarkdown(item.text);
	// trim leading/trailing blank lines so the block hugs its content
	while (md.length > 0 && segsWidth(md[md.length - 1].segs) === 0) md.pop();
	while (md.length > 0 && segsWidth(md[0].segs) === 0) md.shift();
	const rows: Seg[][] = [];
	for (const ml of md) {
		if (ml.code) {
			for (const l of wrapSegs(ml.segs, Math.max(1, w - 2))) {
				rows.push(
					padSegs(
						[
							seg('│ ', 'rule', 'panel'),
							...l.map(sg => ({...sg, bg: 'panel' as const})),
						],
						w,
						'panel',
					),
				);
			}
		} else if (segsWidth(ml.segs) === 0) {
			rows.push(blankLine(w));
		} else {
			const indent = ml.indent ?? 0;
			for (const [li, l] of wrapSegs(
				ml.segs,
				Math.max(1, w - indent),
			).entries()) {
				rows.push(
					padSegs(
						li === 0 ? l : [seg(' '.repeat(indent)), ...l],
						w,
					),
				);
			}
		}
	}
	if (rows.length === 0) rows.push(blankLine(w));
	if (cursor) {
		const last = rows[rows.length - 1];
		const lw = segsWidth(last);
		if (lw < w) {
			rows[rows.length - 1] = [
				...truncSegs(last, Math.max(0, w - 1)),
				seg('▌', 'bright'),
				seg(' '.repeat(Math.max(0, w - lw - 1)), 'plain'),
			];
		}
	}
	return rows;
}

function thoughtLines(item: {text: string}, w: number): Seg[][] {
	const tail = item.text.trim().split('\n').pop()?.trim() ?? '';
	return [
		padSegs(
			truncSegs(
				[seg('∴ Thinking', 'thought'), seg(` · ${tail}`, 'ghost')],
				w,
			),
			w,
		),
	];
}

// ---- tool call blocks (Devin CLI style) ------------------------------------

/** Verb phrases by kind: [while running, when done]. 'other' uses the title. */
const TOOL_VERBS: Record<string, [string, string]> = {
	execute: ['Running command', 'Ran command'],
	edit: ['Editing', 'Edited'],
	read: ['Reading', 'Read'],
	search: ['Searching', 'Searched'],
	fetch: ['Fetching', 'Fetched'],
	delete: ['Deleting', 'Deleted'],
	move: ['Moving', 'Moved'],
	think: ['Thinking', 'Thought'],
	switch_mode: ['Switching mode', 'Switched mode'],
};

const realCache = new Map<string, string>();
function realDir(p: string): string {
	let r = realCache.get(p);
	if (r === undefined) {
		try {
			r = realpathSync(p);
		} catch {
			r = p;
		}
		realCache.set(p, r);
	}
	return r;
}

/** Path relative to the session cwd; ~-collapsed when outside. Devin
 *  reports symlink-resolved paths (macOS /tmp → /private/tmp), so the
 *  cwd's real path is tried too. */
function relPath(p: string, cwd: string): string {
	for (const base of new Set([cwd, realDir(cwd)])) {
		if (p === base) return '.';
		if (p.startsWith(base + '/')) return p.slice(base.length + 1);
	}
	return shortCwd(p);
}

/** Header label + subject tuned to real Devin payloads: execute headers
 *  are the agent's own title (`Listed ~/projects`, `Ran find`), file tools
 *  keep `<Verb> <relpath>` (Devin's `Read file` title is generic), and
 *  everything else — including kind-less calls like `Invoked skill …` —
 *  shows the title as-is. */
const FILE_KINDS = new Set(['edit', 'read', 'delete', 'move']);

function toolLabel(
	item: ToolItem,
	cwd: string,
): {label: string; subject: string} {
	const kind = String(item.toolKind);
	const running = isRunning(item.status);
	const pair = TOOL_VERBS[kind];
	if (kind === 'execute') {
		return {
			label: item.title || (running ? 'Running command' : 'Ran command'),
			subject: '',
		};
	}
	const loc = item.locations?.[0];
	if (FILE_KINDS.has(kind) && loc?.path) {
		return {
			label: running ? (pair?.[0] ?? 'Running') : (pair?.[1] ?? 'Done'),
			subject:
				relPath(loc.path, cwd) +
				(loc.line != null ? `:${loc.line}` : ''),
		};
	}
	return {label: item.title || 'Tool', subject: ''};
}

interface DiffLike {
	path?: string;
	oldText?: string | null;
	newText: string;
}

function diffsOf(item: ToolItem): DiffLike[] {
	const out: DiffLike[] = [];
	for (const c of item.content ?? []) {
		if (
			c &&
			typeof c === 'object' &&
			(c as {type?: string}).type === 'diff'
		) {
			const d = c as DiffLike;
			if (typeof d.newText === 'string') out.push(d);
		}
	}
	return out;
}

interface DiffOp {
	type: 'same' | 'del' | 'add';
	oldNo: number;
	newNo: number;
	text: string;
}

/** Small LCS line diff — only called for texts ≤ 400 lines per side. */
function lineDiff(a: string[], b: string[]): DiffOp[] {
	const n = a.length;
	const m = b.length;
	const dp: number[][] = Array.from({length: n + 1}, () =>
		new Array<number>(m + 1).fill(0),
	);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i][j] =
				a[i] === b[j]
					? dp[i + 1][j + 1] + 1
					: Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}
	const ops: DiffOp[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			ops.push({type: 'same', oldNo: i + 1, newNo: j + 1, text: a[i]});
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			ops.push({type: 'del', oldNo: i + 1, newNo: 0, text: a[i]});
			i++;
		} else {
			ops.push({type: 'add', oldNo: 0, newNo: j + 1, text: b[j]});
			j++;
		}
	}
	while (i < n) ops.push({type: 'del', oldNo: i + 1, newNo: 0, text: a[i++]});
	while (j < m) ops.push({type: 'add', oldNo: 0, newNo: j + 1, text: b[j++]});
	return ops;
}

const DIFF_TOO_BIG = 400;

/** +N −M for an edit tool header (from its diff content). */
function diffStats(item: ToolItem): {add: number; del: number} | undefined {
	const diffs = diffsOf(item);
	if (diffs.length === 0) return undefined;
	let add = 0;
	let del = 0;
	for (const d of diffs) {
		const newLines = d.newText.split('\n');
		const oldLines = d.oldText == null ? [] : d.oldText.split('\n');
		if (
			d.oldText == null ||
			oldLines.length > DIFF_TOO_BIG ||
			newLines.length > DIFF_TOO_BIG
		) {
			add += newLines.length;
			del += oldLines.length;
			continue;
		}
		for (const op of lineDiff(oldLines, newLines)) {
			if (op.type === 'add') add++;
			else if (op.type === 'del') del++;
		}
	}
	return {add, del};
}

/** Expand tabs and drop control bytes: cpWidth counts C0 chars 0 but a
 *  real terminal jumps 8 cols on \t (and acts on escape bytes), so raw
 *  tool text would overflow/wrap its row. Newlines are preserved. */
function cleanText(s: string): string {
	let out = '';
	let col = 0;
	for (const ch of s) {
		const cp = ch.codePointAt(0) ?? 0;
		if (ch === '\n') {
			out += ch;
			col = 0;
		} else if (ch === '\t') {
			const n = 4 - (col % 4);
			out += ' '.repeat(n);
			col += n;
		} else if (cp < 32 || cp === 0x7f) {
			continue;
		} else {
			out += ch;
			col += cpWidth(cp);
		}
	}
	return out;
}

/** Cut a string to `w` cols; when it doesn't fit the last col is `…`. */
function fitStr(s: string, w: number): string {
	if (strWidth(s) <= w) return s;
	if (w <= 0) return '';
	let out = '';
	let col = 0;
	for (const ch of s) {
		const cw = cpWidth(ch.codePointAt(0) ?? 0);
		if (col + cw > w - 1) break;
		out += ch;
		col += cw;
	}
	return out + '…';
}

/** Extract displayable text: content[] text blocks, else
 *  rawOutput.output/stdout. Devin's `tool://preview` shell-command
 *  resource is not text content, so it never counts as output. */
function outputText(item: ToolItem): string | undefined {
	const parts: string[] = [];
	for (const c of item.content ?? []) {
		if (
			c &&
			typeof c === 'object' &&
			(c as {type?: string}).type === 'content'
		) {
			const inner = (c as {content?: {type?: string; text?: string}}).content;
			if (inner && inner.type === 'text' && typeof inner.text === 'string') {
				parts.push(inner.text);
			}
		}
	}
	if (parts.length > 0) return cleanText(parts.join('\n'));
	const ro = item.rawOutput;
	if (ro && typeof ro === 'object') {
		const o =
			(ro as {output?: unknown}).output ??
			(ro as {stdout?: unknown}).stdout;
		if (typeof o === 'string') return cleanText(o);
	}
	return undefined;
}

function exitCode(item: ToolItem): number | undefined {
	if (item.exitCode !== undefined) return item.exitCode;
	const ro = item.rawOutput;
	if (!ro || typeof ro !== 'object') return undefined;
	const r = ro as Record<string, unknown>;
	const v = r.exitCode ?? r.exit_code ?? r.code;
	return typeof v === 'number' ? v : undefined;
}

/** Light $ command highlighting: first word bright, -flags blue,
 *  "quoted strings" orange, the rest text. */
function cmdSegs(cmd: string): Seg[] {
	const out: Seg[] = [];
	const re = /"[^"\n]*"|'[^'\n]*'|\S+/g;
	let m: RegExpExecArray | null;
	let i = 0;
	while ((m = re.exec(cmd))) {
		if (out.length > 0) out.push(seg(' '));
		const tok = m[0];
		const k: Token =
			i === 0
				? 'bright'
				: /^["']/.test(tok)
					? 'cmdString'
					: tok.startsWith('-')
						? 'cmdFlag'
						: 'text';
		out.push(seg(tok, k));
		i++;
	}
	return out;
}

/** Devin sends the command as a `tool://preview` resource content item
 *  flagged `_meta["cognition.ai/preview_is_shell_command"]`. */
function previewCommand(item: ToolItem): string | undefined {
	for (const c of item.content ?? []) {
		if (!c || typeof c !== 'object') continue;
		const inner = (
			c as {
				content?: {
					type?: string;
					resource?: {text?: unknown};
					_meta?: Record<string, unknown>;
				};
				_meta?: Record<string, unknown>;
			}
		).content;
		const meta = inner?._meta ?? (c as {_meta?: Record<string, unknown>})._meta;
		if (
			inner?.type === 'resource' &&
			meta?.['cognition.ai/preview_is_shell_command'] &&
			typeof inner.resource?.text === 'string'
		) {
			return inner.resource.text;
		}
	}
	return undefined;
}

/** The command an execute tool ran: rawInput.command (string or array),
 *  else the flagged preview resource, else `alt` (the permission
 *  request's editableCommand), else the title. */
function execCommand(item: ToolItem, alt?: string): string | undefined {
	const ri = item.rawInput;
	let cmd: string | undefined;
	if (ri && typeof ri === 'object') {
		const c = (ri as {command?: unknown}).command;
		if (typeof c === 'string') cmd = c;
		else if (Array.isArray(c)) cmd = c.map(String).join(' ');
	}
	return (
		cleanText(cmd ?? previewCommand(item) ?? alt ?? (item.title || '')) ||
		undefined
	);
}

/** The `$ <command>` body line with syntax highlighting. */
function execCmdLine(item: ToolItem, room: number, alt?: string): Seg[] {
	const cmd = execCommand(item, alt);
	if (!cmd) return [];
	return truncSegs([seg('$ ', 'muted'), ...cmdSegs(cmd)], room);
}

function execBody(item: ToolItem, room: number, alt?: string): Seg[][] {
	const rows: Seg[][] = [];
	const cmdLine = execCmdLine(item, room, alt);
	if (cmdLine.length > 0) rows.push(cmdLine);
	const out = outputText(item);
	const failed = item.status === 'failed';
	if (out) {
		const lines = out.replace(/\n+$/, '').split('\n');
		const max = failed ? 3 : 10;
		for (const l of lines.slice(0, max)) {
			rows.push([seg(fitStr(l, room), failed ? 'err' : 'faint')]);
		}
		if (lines.length > max) {
			rows.push([seg(`… ${lines.length - max} more lines`, 'faint')]);
		}
	}
	const code = exitCode(item);
	if (code !== undefined) {
		rows.push([seg(`Exited with code ${code}`, 'faint')]);
	}
	return rows;
}

/** One diff content row: `nnnn ± text` — new-file line numbers in a
 *  4-col faint gutter (oldNo for deletions), hue only on the text. Text
 *  is detabbed and `…`-truncated to fit; the bg fill stops at `room`. */
function diffRow(
	num: string,
	text: string,
	tok: Token,
	bg: Bg | undefined,
	room: number,
): Seg[] {
	const avail = Math.max(0, room - 5);
	const shown = fitStr(cleanText(text), avail);
	const pad = bg ? ' '.repeat(Math.max(0, avail - strWidth(shown))) : '';
	return [seg(num.padStart(4), 'faint'), seg(' '), seg(shown + pad, tok, bg)];
}

const DIFF_MAX_CHANGED = 12;

function editBody(item: ToolItem, room: number): Seg[][] {
	const rows: Seg[][] = [];
	for (const d of diffsOf(item)) {
		if (d.oldText == null) {
			// new file — first 8 lines as +
			const lines = d.newText.split('\n');
			lines.slice(0, 8).forEach((l, i) => {
				rows.push(diffRow(String(i + 1), `+ ${l}`, 'ok', 'diffAdd', room));
			});
			if (lines.length > 8) {
				rows.push(
					diffRow('', `… ${lines.length - 8} more lines`, 'faint', undefined, room),
				);
			}
			continue;
		}
		const a = d.oldText.split('\n');
		const b = d.newText.split('\n');
		if (a.length > DIFF_TOO_BIG || b.length > DIFF_TOO_BIG) {
			rows.push(
				diffRow('', `+${b.length} −${a.length} (large diff)`, 'faint', undefined, room),
			);
			continue;
		}
		const ops = lineDiff(a, b);
		let shown = 0;
		let hidden = 0;
		for (const [idx, op] of ops.entries()) {
			if (op.type === 'same') {
				const near =
					(idx > 0 && ops[idx - 1].type !== 'same') ||
					(idx < ops.length - 1 && ops[idx + 1].type !== 'same');
				if (!near) continue;
				rows.push(
					diffRow(String(op.newNo), `  ${op.text}`, 'faint', undefined, room),
				);
				continue;
			}
			if (shown >= DIFF_MAX_CHANGED) {
				hidden++;
				continue;
			}
			shown++;
			rows.push(
				op.type === 'del'
					? diffRow(String(op.oldNo), `− ${op.text}`, 'err', 'diffDel', room)
					: diffRow(String(op.newNo), `+ ${op.text}`, 'ok', 'diffAdd', room),
			);
		}
		if (hidden > 0) {
			rows.push(
				diffRow('', `… ${hidden} more changed lines`, 'faint', undefined, room),
			);
		}
	}
	return rows;
}

/** ≤3 text lines for read/search/fetch/other (err-red when failed). */
function textBody(item: ToolItem, room: number): Seg[][] {
	const out = outputText(item);
	if (!out) return [];
	const failed = item.status === 'failed';
	return out
		.replace(/\n+$/, '')
		.split('\n')
		.slice(0, 3)
		.map(l => [seg(fitStr(l, room), failed ? 'err' : 'faint')]);
}

/** A completed non-execute tool whose output is a single short line
 *  (read's `22 lines`) shows it inline on the header instead of a body. */
function shortResult(item: ToolItem): string | undefined {
	if (String(item.toolKind) === 'execute' || item.status !== 'completed') {
		return undefined;
	}
	const out = outputText(item)?.replace(/\n+$/, '');
	if (!out || out.includes('\n') || strWidth(out) > 40) return undefined;
	return out;
}

/** Collapsed one-liner for a done execute call:
 *  `● Listed ./src · $ <cmd> · <n> lines · exit <N> ▸` — the command keeps
 *  its syntax highlight and is ellipsized so the whole line fits. */
function execCollapsed(
	item: ToolItem,
	head: Seg[],
	w: number,
	alt?: string,
): Seg[] {
	const cmd = execCommand(item, alt) ?? '';
	const suffix: Seg[] = [];
	const out = outputText(item);
	const nLines = out ? out.replace(/\n+$/, '').split('\n').length : 0;
	const code = exitCode(item);
	if (nLines > 0) suffix.push(seg(` · ${nLines} lines`, 'faint'));
	if (code !== undefined && code !== 0) {
		suffix.push(seg(' · ', 'faint'), seg(`exit ${code}`, 'err'));
	}
	suffix.push(seg(' ▸', 'faint'));
	// budget for the command: head + ' · ' + '$ ' + suffix (+ '…')
	const fixed = segsWidth(head) + 5 + segsWidth(suffix);
	const room = Math.max(0, w - fixed);
	const line = [...head, seg(' · ', 'faint'), seg('$ ', 'muted')];
	if (strWidth(cmd) <= room) {
		line.push(...cmdSegs(cmd));
	} else {
		line.push(
			...truncSegs(cmdSegs(cmd), Math.max(0, room - 1)),
			seg('…', 'faint'),
		);
	}
	line.push(...suffix);
	return line;
}

/**
 * Devin CLI-style tool block:
 *   ` ○ Running command` / `● Ran command` header (status dot + verb +
 *   subject), body rows under a faint `│` gutter — `$` command, output,
 *   `╰ Exited with code N` — `╰` only closes the block once it's done.
 * Execute calls collapse to a single `… ▸` line once done (ctrl+o or a
 * pending permission expands them); while running they show just the
 * `$ command` line.
 */
function toolBlock(
	item: ToolItem,
	s: State,
	w: number,
	tick: number,
): Seg[][] {
	const kind = String(item.toolKind);
	const running = isRunning(item.status);
	const dot = running
		? seg(tick % 8 < 4 ? '○' : '◌', 'muted')
		: seg('●', item.status === 'completed' ? 'ok' : 'err');
	const {label, subject} = toolLabel(item, item.toolCwd ?? s.cwd);
	const head: Seg[] = [seg(' '), dot, seg(' '), seg(label, 'bright')];
	if (subject) head.push(seg(` ${subject}`, 'muted'));
	const stats = kind === 'edit' ? diffStats(item) : undefined;
	if (stats && (stats.add > 0 || stats.del > 0)) {
		head.push(
			seg('  '),
			seg(`+${stats.add}`, 'ok'),
			seg(' '),
			seg(`−${stats.del}`, 'err'),
		);
	}
	// completed non-execute tools with a one-line result show it inline
	const short = shortResult(item);
	if (short) head.push(seg(` · ${short}`, 'faint'));

	const room = Math.max(1, w - 4);

	if (kind === 'execute') {
		// a pending permission on this tool always expands it; its
		// editableCommand fills in when the tool has no command yet
		const permOpen = s.permission?.toolCallId === item.toolCallId;
		const permCmd = permOpen ? s.permission?.editableCommand : undefined;
		const expanded = s.expandTools || permOpen;
		if (!running && !expanded) {
			return [padSegs(truncSegs(execCollapsed(item, head, w, permCmd), w), w)];
		}
		if (running && !permOpen) {
			// compact while running: header + $ line, no output
			const rows = [padSegs(truncSegs(head, w), w)];
			const cmdLine = execCmdLine(item, room, permCmd);
			if (cmdLine.length > 0) {
				rows.push(padSegs([seg(' '), seg('│ ', 'rule'), ...cmdLine], w));
			}
			return rows;
		}
		head.push(seg(' ▾', 'faint'));
		const rows: Seg[][] = [padSegs(truncSegs(head, w), w)];
		execBody(item, room, permCmd).forEach((b, i, body) => {
			const last = !running && i === body.length - 1;
			rows.push(
				padSegs([seg(' '), seg(last ? '╰ ' : '│ ', 'rule'), ...b], w),
			);
		});
		return rows;
	}

	const rows: Seg[][] = [padSegs(truncSegs(head, w), w)];
	const body =
		kind === 'edit'
			? editBody(item, room)
			: short
				? []
				: textBody(item, room);
	body.forEach((b, i) => {
		const last = !running && i === body.length - 1;
		rows.push(
			padSegs([seg(' '), seg(last ? '╰ ' : '│ ', 'rule'), ...b], w),
		);
	});
	return rows;
}

// ---- inline permission prompt -----------------------------------------------

/** Numbered permission options rendered in the transcript under the tool
 *  call they belong to: selected `❯ 1 name` in picker blue + bold. */
export function permissionRows(
	req: PermissionReq,
	sel: number,
	w: number,
): Seg[][] {
	const rows: Seg[][] = req.options.map((o, i) =>
		padSegs(
			truncSegs(
				i === sel
					? [
							seg(' ❯ ', 'pkBold'),
							seg(`${i + 1} `, 'pkBold'),
							seg(o.name, 'pkBold'),
						]
					: [
							seg('   '),
							seg(`${i + 1}`, 'faint'),
							seg(' '),
							seg(o.name, 'text'),
						],
				w,
			),
			w,
		),
	);
	rows.push(
		padSegs([seg('↑↓ select · ↵ confirm · esc cancel', 'faint')], w),
	);
	return rows;
}

function systemLines(
	item: {text: string; bright?: string},
	w: number,
): Seg[][] {
	const segs = [seg('· ', 'faint'), seg(item.text, 'faint')];
	if (item.bright) segs.push(seg(item.bright, 'bright'));
	return [padSegs(truncSegs(segs, w), w)];
}

/** All items → padded line list (blank row between items). The pending
 *  permission prompt is inlined under its tool call (or at the bottom if
 *  the tool isn't in the transcript); queued prompts and the live activity
 *  row pin to the bottom while a turn runs. */
export function transcriptLines(
	s: State,
	w: number,
	tick: number,
	permSel = 0,
): Seg[][] {
	const out: Seg[][] = [];
	let permPlaced = false;
	s.items.forEach((it, i) => {
		if (out.length > 0) out.push(blankLine(w));
		if (it.kind === 'user') out.push(...userLines(it, w));
		else if (it.kind === 'agent') {
			const last = i === s.items.length - 1;
			out.push(
				...agentLines(it, w, last && it.streaming && s.status === 'working'),
			);
		} else if (it.kind === 'thought') out.push(...thoughtLines(it, w));
		else if (it.kind === 'tool') {
			out.push(...toolBlock(it, s, w, tick));
			if (s.permission && s.permission.toolCallId === it.toolCallId) {
				out.push(...permissionRows(s.permission, permSel, w));
				permPlaced = true;
			}
		} else out.push(...systemLines(it, w));
	});
	if (s.permission && !permPlaced) {
		if (out.length > 0) out.push(blankLine(w));
		// orphan request (no matching tool item) — head it with the command
		if (s.permission.editableCommand) {
			out.push(
				padSegs(
					truncSegs(
						[
							seg(' '),
							seg('$ ', 'muted'),
							...cmdSegs(s.permission.editableCommand),
						],
						w,
					),
					w,
				),
			);
		}
		out.push(...permissionRows(s.permission, permSel, w));
	}
	if (s.queued.length > 0) {
		if (out.length > 0) out.push(blankLine(w));
		for (const q of s.queued) {
			out.push(
				padSegs(
					truncSegs(
						[seg(`↳ queued: ${q.replace(/\s+/g, ' ')}`, 'faint')],
						w,
					),
					w,
				),
			);
		}
	}
	if (s.status === 'working' || s.loading) {
		if (out.length > 0) out.push(blankLine(w));
		out.push(activityLine(s, w, tick));
	}
	return out;
}

/** Live activity row pinned to the bottom of the transcript while a turn
 *  runs (or a session/load replay streams in):
 *  `⠋ <Label> · <elapsed> (esc twice to interrupt)`. */
function activityLine(s: State, w: number, tick: number): Seg[] {
	const last = s.items[s.items.length - 1];
	const toolRunning = s.items.some(
		it => it.kind === 'tool' && isRunning(it.status),
	);
	const label = s.loading
		? 'Loading session'
		: last?.kind === 'thought'
			? 'Thinking'
			: toolRunning
				? 'Running tools'
				: 'Working';
	// 3-char bright band sweeping left→right over the muted label, looping
	const pos = tick % label.length;
	const labelSegs = [...label].map((ch, i) =>
		seg(
			ch,
			i === pos || i === (pos + 1) % label.length || i === (pos + 2) % label.length
				? 'bright'
				: 'muted',
		),
	);
	const elapsed = fmtElapsed(Date.now() - (s.turnStartedAt ?? Date.now()));
	return padSegs(
		[
			seg(`${SPINNER[tick % SPINNER.length]} `, 'bright'),
			...labelSegs,
			s.loading
				? seg(` · ${elapsed}`, 'faint')
				: seg(` · ${elapsed} (esc twice to interrupt)`, 'faint'),
		],
		w,
	);
}

/** One-line tool summary for the /handoff transcript digest:
 *  `Listed ./src: ls ./src`, `Edited src/index.tsx`, `Read package.json`. */
export function toolOneLiner(item: ToolItem, cwd: string): string {
	const {label, subject} = toolLabel(item, item.toolCwd ?? cwd);
	if (String(item.toolKind) === 'execute') {
		const cmd = execCommand(item);
		return cmd && cmd !== label ? `${label}: ${cmd}` : label;
	}
	return subject ? `${label} ${subject}` : label;
}

/** Plain-text digest of the transcript for /handoff context — user and
 *  agent messages plus tool one-liners, capped to the last ~8KB. */
export function transcriptDigest(s: State, maxChars = 8192): string {
	const lines: string[] = [];
	for (const it of s.items) {
		if (it.kind === 'user') {
			lines.push(`User: ${it.text.replace(/\n+/g, ' ')}`);
		} else if (it.kind === 'agent') {
			const t = it.text.trim();
			if (t) lines.push(`Devin: ${t}`);
		} else if (it.kind === 'tool') {
			lines.push(`- ${toolOneLiner(it, s.cwd)}`);
		}
	}
	const text = lines.join('\n');
	return text.length > maxChars ? `…${text.slice(-maxChars)}` : text;
}

// ---- plan block ------------------------------------------------------------

/** Compact plan block shown above the input panel (toggled by ctrl+b). */
export function planLines(s: State, w: number, tick: number): Seg[][] {
	if (s.plan.length === 0) return [];
	const done = s.plan.filter(e => e.status === 'completed').length;
	// finished plan + idle → collapse to a single faint line
	if (done === s.plan.length && s.status === 'idle') {
		return [padSegs([seg(`Plan ${done}/${s.plan.length} ✓`, 'faint')], w)];
	}
	const rows: Seg[][] = [
		padSegs([seg(`Plan ${done}/${s.plan.length}`, 'muted')], w),
	];
	const max = 5;
	for (const e of s.plan.slice(0, max)) {
		const [icon, tok]: [string, 'faint' | 'bright' | 'muted'] =
			e.status === 'completed'
				? ['●', 'faint']
				: e.status === 'in_progress'
					? ['◐', 'bright']
					: ['○', 'muted'];
		rows.push(
			padSegs(
				truncSegs([seg(` ${icon} `, tok), seg(e.content, tok)], w),
				w,
			),
		);
	}
	if (s.plan.length > max) {
		rows.push(padSegs([seg(`   +${s.plan.length - max} more`, 'faint')], w));
	}
	return rows;
}

// ---- scroll marker ---------------------------------------------------------

export function moreMarker(n: number, w: number): Seg[] {
	const label = `↓ ${n} more`;
	return padSegs(
		[seg(' '.repeat(Math.max(0, w - strWidth(label)))), seg(label, 'faint')],
		w,
	);
}

// ---- status bar ------------------------------------------------------------

export function statusBar(
	s: State,
	cols: number,
	tick: number,
	elapsedMs: number,
): Seg[] {
	const mode = displayMode(s) ?? 'default';
	const left: Seg[] = [
		seg('⣿ ', 'bright'),
		seg(mode, 'accent'),
	];
	const titleSegs: Seg[] = s.sessionTitle
		? [
				seg('  │  ', 'rule'),
				seg(s.sessionTitle.slice(0, 30), 'muted'),
			]
		: [];
	left.push(...titleSegs);
	const model = displayModel(s);
	const effortOpt = findConfigOption(s, 'thought_level');
	const effort = effortOpt ? configLabel(effortOpt) : undefined;
	if (model) {
		left.push(seg('  │  ', 'rule'), seg(model, 'bright'));
		if (effort) left.push(seg(` ${effort}`, 'text'));
	}
	// counters are dropped first when the bar gets tight
	const counters: Seg[] = [
		seg('  │  ', 'rule'),
		seg('turns ', 'muted'),
		seg(String(s.turns), 'bright'),
		seg('  │  ', 'rule'),
		seg('tools ', 'muted'),
		seg(String(s.toolCalls), 'bright'),
	];
	if (s.status === 'working') {
		counters.push(seg('  │  ', 'rule'), seg(fmtElapsed(elapsedMs), 'bright'));
	}
	// ctrl+o is the first hint dropped when the bar gets tight
	const expandHint: Seg[] = [
		seg('  '),
		seg('ctrl+o', 'bright'),
		seg(s.expandTools ? ' collapse' : ' expand', 'muted'),
	];
	const hints: Seg[] = [
		seg('  '),
		seg('esc', 'bright'),
		seg(' cancel  ', 'muted'),
		seg('ctrl+p', 'bright'),
		seg(' commands', 'muted'),
	];
	const working: Seg[] = s.notice
		? [seg(s.notice, 'bright')]
		: [
				...(s.status === 'working'
					? [
							seg(SPINNER[tick % SPINNER.length], 'spin'),
							seg(' working', 'bright'),
						]
					: [seg('○ idle', 'muted')]),
			];
	const ctx: Seg[] = s.usage
		? [
				seg(
					`Context: ${Math.round(s.usage.used / 1000)}k / ${Math.round(
						s.usage.size / 1000,
					)}k tokens (${Math.round((s.usage.used / s.usage.size) * 100)}%)`,
					'muted',
				),
				seg('   '),
			]
		: [];

	let l = [...left, ...counters];
	let r = [...ctx, ...working, ...expandHint, ...hints];
	if (segsWidth(l) + segsWidth(r) + 3 > cols) r = [...ctx, ...working, ...hints];
	if (segsWidth(l) + segsWidth(r) + 3 > cols) r = [...ctx, ...working];
	if (segsWidth(l) + segsWidth(r) + 3 > cols) l = left;
	// still tight (narrow terminals): drop the session title too
	if (segsWidth(l) + segsWidth(r) + 3 > cols) {
		l = left.filter(x => !titleSegs.includes(x));
	}
	const gap = Math.max(1, cols - segsWidth(l) - segsWidth(r) - 1);
	return padSegs([seg(' '), ...l, seg(' '.repeat(gap)), ...r], cols);
}
