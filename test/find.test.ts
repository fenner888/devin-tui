import assert from 'node:assert/strict';
import test from 'node:test';
import {findMatches, highlightRow, seg} from '../src/ui/lines.js';

test('findMatches searches case-insensitive laid-out rows independently', () => {
	assert.deepEqual(
		findMatches(
			[[seg('Word wraps')], [seg('other word, WORD')]],
			'word',
		),
		[
			{row: 0, start: 0, end: 4},
			{row: 1, start: 6, end: 10},
			{row: 1, start: 12, end: 16},
		],
	);
	assert.deepEqual(findMatches([[seg('word')]], ''), []);
	assert.deepEqual(findMatches([[seg('wo')], [seg('rd')]], 'word'), []);
});

test('highlightRow splits segments and retains link and token metadata', () => {
	const link = {
		...seg('https://example.com'),
		k: 'bright' as const,
		link: 'https://example.com',
	};
	assert.deepEqual(
		highlightRow(
			[seg('see '), link],
			[{start: 12, end: 19}, {start: 0, end: 3}],
			{start: 12, end: 19},
		),
		[
			{...seg('see'), k: 'sel', bg: 'sel'},
			seg(' '),
			{
				...link,
				t: 'https://',
			},
			{...link, t: 'example', k: 'pk', bg: 'pkSel'},
			{...link, t: '.com'},
		],
	);
});
