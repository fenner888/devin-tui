import {test} from 'node:test';
import assert from 'node:assert/strict';
import {menuWindow} from '../src/ui/overlays.js';

test('menuWindow: scrolling down past row 8 pushes the window down', () => {
	let top = 0;
	// walk selection 0 → 10 across 16 items; the window follows only
	// once sel leaves the visible 8
	const tops = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(sel => {
		top = menuWindow(16, sel, top);
		return top;
	});
	assert.deepEqual(tops, [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3]);
	// sel 10 visible as last row (top+7)
	assert.equal(top + 7, 10);
});

test('menuWindow: scrolling back up pulls the window up', () => {
	let top = menuWindow(16, 12, 0); // top 5
	assert.equal(top, 5);
	top = menuWindow(16, 4, top); // sel above window
	assert.equal(top, 4);
	top = menuWindow(16, 3, top);
	assert.equal(top, 3);
	top = menuWindow(16, 0, top);
	assert.equal(top, 0);
});

test('menuWindow: wrap last → first gives top 0', () => {
	const top = menuWindow(16, 15, 0);
	assert.equal(top, 8); // window at the bottom
	assert.equal(menuWindow(16, 0, top), 0);
});

test('menuWindow: wrap first → last shows the final 8', () => {
	assert.equal(menuWindow(16, 15, 0), 8);
	// non-multiple-of-8 tail: last window is n-8 even if sel is mid-window
	assert.equal(menuWindow(17, 16, 0), 9);
});

test('menuWindow: n <= 8 always gives 0', () => {
	for (const n of [0, 1, 5, 8]) {
		for (const sel of [0, 3, 7]) {
			assert.equal(menuWindow(n, sel, 4), 0, `n=${n} sel=${sel}`);
		}
	}
});
