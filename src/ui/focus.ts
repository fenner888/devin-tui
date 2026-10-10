import {
	type Seg,
	seg,
	padSegs,
	blankLine,
	wrapSegs,
	truncSegs,
} from './lines.js';
import {
	agentLines,
	cleanText,
	systemLines,
	toolBlock,
	toolOneLiner,
	userLines,
} from './transcript.js';
import type {State, TranscriptItem} from '../state/store.js';

/** Focus view state — the focused transcript item + its scroll offset. */
export interface FocusState {
	id: string;
	scroll: number;
	copied?: boolean; // 'copied' flash after `c`
}

function label(item: TranscriptItem, cwd: string): string {
	if (item.kind === 'tool') return toolOneLiner(item, item.toolCwd ?? cwd);
	if (item.kind === 'user') return 'You';
	if (item.kind === 'agent') return 'Devin';
	if (item.kind === 'thought') return 'Thinking';
	return 'Note';
}

/** Full-content rows for one item — the same renderers as the transcript
 *  but uncapped (execute always expanded with wrapped output, diffs
 *  uncapped, thoughts show every line). */
function contentLines(
	item: TranscriptItem,
	s: State,
	w: number,
	tick: number,
): Seg[][] {
	if (item.kind === 'user') return userLines(item, w);
	if (item.kind === 'agent') return agentLines(item, w, false);
	if (item.kind === 'thought') {
		return item.text
			.trim()
			.split('\n')
			.flatMap(l => wrapSegs([seg(cleanText(l), 'thought')], w));
	}
	if (item.kind === 'tool') return toolBlock(item, s, w, tick, true);
	return systemLines(item, w);
}

/** The full-screen focus view for transcript item `id`:
 *  `⤢ <label> · <i>/<n>` header, a rule, scrolled content at cols-4
 *  with a 2-col inset, and a footer with the visible range + hints. */
export function focusLines(
	s: State,
	id: string,
	scroll: number,
	cols: number,
	rows: number,
	tick: number,
	copied = false,
): Seg[][] {
	const idx = s.items.findIndex(it => it.id === id);
	const item = idx >= 0 ? s.items[idx] : undefined;
	const lines: Seg[][] = Array.from({length: rows}, () => blankLine(cols));
	if (!item) return lines;

	const header = padSegs(
		[
			seg('  '),
			...truncSegs(
				[
					seg('⤢ ', 'muted'),
					seg(label(item, s.cwd), 'bright'),
					seg(` · ${idx + 1}/${s.items.length}`, 'muted'),
				],
				cols - 4,
			),
		],
		cols,
	);
	const rule = padSegs(
		[seg('  '), seg('─'.repeat(Math.max(0, cols - 4)), 'rule')],
		cols,
	);
	const w = Math.max(1, cols - 4);
	const content = contentLines(item, s, w, tick);
	const bodyH = focusBodyHeight(rows);
	const start = Math.min(scroll, Math.max(0, content.length - bodyH));
	const end = Math.min(content.length, start + bodyH);

	const range =
		content.length === 0
			? 'empty'
			: `lines ${start + 1}–${end} of ${content.length}`;
	const footer = padSegs(
		truncSegs(
			[
				seg('  ', 'faint'),
				seg(range, 'faint'),
				seg('   ', 'faint'),
				...(copied ? [seg('copied', 'ok'), seg(' · ', 'faint')] : []),
				seg('↑↓ scroll · ←→ prev/next · c copy · esc close', 'faint'),
			],
			cols,
		),
		cols,
	);

	lines[0] = header;
	lines[1] = rule;
	for (let i = 0; i < end - start && 2 + i < rows - 3; i++) {
		lines[2 + i] = padSegs([seg('  '), ...content[start + i]], cols);
	}
	// footer sits where the session status bar does — rows-3, with two
	// blank rows below it
	if (rows >= 3) lines[rows - 3] = footer;
	return lines;
}

/** Visible content rows in the focus view (header + rule + footer + the
 *  two blank rows below it). */
export function focusBodyHeight(rows: number): number {
	return Math.max(0, rows - 5);
}

/** Content height in rows for the focus view's scroll clamping. */
export function focusContentHeight(
	s: State,
	id: string,
	cols: number,
	tick: number,
): number {
	const item = s.items.find(it => it.id === id);
	if (!item) return 0;
	return contentLines(item, s, Math.max(1, cols - 4), tick).length;
}
