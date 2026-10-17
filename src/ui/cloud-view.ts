import type {CloudMessage, CloudSession} from '../cloud.js';
import {
	type Seg,
	blankLine,
	padSegs,
	seg,
	segsWidth,
	strWidth,
	truncSegs,
} from './lines.js';
import {agentLines, userLines} from './transcript.js';

export interface CloudView {
	session: CloudSession;
	messages: CloudMessage[];
	scroll: number;
	value: string;
	cursor: number;
	loading: boolean;
	sending: boolean;
	notice?: string;
}

function contentLines(view: CloudView, w: number): Seg[][] {
	const lines: Seg[][] = [];
	for (const [i, message] of view.messages.entries()) {
		if (i > 0) lines.push(blankLine(w));
		lines.push(
			...(message.from === 'user'
				? userLines({text: message.text}, w)
				: agentLines({text: message.text}, w, false)),
		);
	}
	if (view.loading && lines.length === 0) {
		lines.push(padSegs([seg('Loading cloud messages…', 'faint')], w));
	} else if (lines.length === 0) {
		lines.push(blankLine(w));
	}
	return lines;
}

function inputLine(view: CloudView, cols: number): Seg[] {
	const prefix = seg('  reply ❯ ', 'muted');
	const room = Math.max(1, cols - segsWidth([prefix]));
	const chars = [...view.value];
	const cursor = Math.max(0, Math.min(chars.length, view.cursor));
	let start = cursor;
	while (
		start > 0 &&
		strWidth(chars.slice(start, cursor).join('')) < Math.max(0, room - 1)
	) {
		start--;
	}
	const left = chars.slice(start, cursor).join('');
	const marker = chars[cursor] ?? ' ';
	const used = strWidth(left) + strWidth(marker);
	let right = '';
	for (let i = cursor + 1; i < chars.length; i++) {
		const next = chars[i]!;
		if (used + strWidth(right) + strWidth(next) > room) break;
		right += next;
	}
	return padSegs(
		truncSegs(
			[
				prefix,
				...(left ? [seg(left, 'text')] : []),
				seg(marker, 'sel', 'sel'),
				...(right ? [seg(right, 'text')] : []),
			],
			cols,
		),
		cols,
	);
}

/** Full-screen cloud session view, independent from the local ACP transcript. */
export function cloudViewLines(
	view: CloudView,
	cols: number,
	rows: number,
): Seg[][] {
	const lines: Seg[][] = Array.from({length: rows}, () => blankLine(cols));
	const title = view.session.title || 'Untitled';
	const header = padSegs(
		truncSegs(
			[
				seg('  ▸ Cloud · ', 'muted'),
				{...seg(title, 'bright'), link: view.session.url},
				seg(` · ${view.session.status}`, 'muted'),
			],
			cols,
		),
		cols,
	);
	const rule = padSegs(
		[seg('  '), seg('─'.repeat(Math.max(0, cols - 4)), 'rule')],
		cols,
	);
	const w = Math.max(1, cols - 4);
	const content = contentLines(view, w);
	const bodyH = Math.max(0, rows - 6);
	const scroll = Math.min(view.scroll, content.length);
	const end = Math.max(0, content.length - scroll);
	const start = Math.max(0, end - bodyH);

	lines[0] = header;
	if (rows > 1) lines[1] = rule;
	for (let i = 0; i < end - start && 2 + i < rows - 4; i++) {
		lines[2 + i] = padSegs([seg('  '), ...content[start + i]!], cols);
	}
	if (rows >= 4) {
		lines[rows - 4] = inputLine(view, cols);
		lines[rows - 3] = padSegs(
			truncSegs(
				[
					...(view.notice
						? [seg(view.notice, view.notice === 'sent' ? 'ok' : 'bright'), seg(' · ', 'faint')]
						: []),
					seg(
						'↵ send · ↑↓ scroll · ctrl+o open in browser · esc close',
						'faint',
					),
				],
				cols,
			),
			cols,
		);
	}
	return lines;
}

export function cloudViewContentHeight(view: CloudView, cols: number): number {
	return contentLines(view, Math.max(1, cols - 4)).length;
}
