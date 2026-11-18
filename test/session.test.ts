import assert from 'node:assert/strict';
import test from 'node:test';
import {initialState, type State} from '../src/state/store.js';
import {sessionLines, type SessionUI} from '../src/ui/session.js';
import {transcriptLayout} from '../src/ui/transcript.js';

const ui: SessionUI = {
	value: '', cursor: 0, tick: 0, scrollOffset: 0,
	paletteSel: 0, slashItems: [], slashTop: 0, slashOpen: false,
	mentionItems: [], mentionOpen: false, mentionSel: 0,
	chips: [], permSel: 0, catalog: {status: 'unavailable'},
};

function state(count: number): State {
	return {
		...initialState('/project', undefined, ''),
		status: 'idle', sessionId: 'test', sidebar: false,
		items: Array.from({length: count}, (_, i) => ({
			kind: 'agent', id: `message-${i}`, text: `Message ${i}`, streaming: false,
		})),
	};
}

test('scrolling past the oldest message keeps the first full viewport', () => {
	const s = state(60);
	const result = sessionLines(s, {...ui, scrollOffset: 10000}, 80, 24);
	const layout = transcriptLayout(s, 76, 0, 0);
	assert.deepEqual(
		result.lines.slice(0, result.transcriptHeight).map(row => row.map(seg => seg.t).join('').trim()),
		layout.lines.slice(0, result.transcriptHeight).map(row => row.map(seg => seg.t).join('').trim()),
	);
	assert.ok(result.rowItem.includes('message-0'));
});

test('overscrolling short and empty transcripts preserves their content', () => {
	for (const count of [0, 1]) {
		const s = state(count);
		assert.deepEqual(
			sessionLines(s, {...ui, scrollOffset: 10000}, 80, 24),
			sessionLines(s, ui, 80, 24),
		);
	}
});

test('normal scrolling still moves back from the tail', () => {
	const s = state(60);
	const tail = sessionLines(s, ui, 80, 24);
	const scrolled = sessionLines(s, {...ui, scrollOffset: 3}, 80, 24);
	assert.notDeepEqual(tail.rowItem, scrolled.rowItem);
	assert.ok(tail.rowItem.includes('message-59'));
	assert.ok(!scrolled.rowItem.includes('message-59'));
});
