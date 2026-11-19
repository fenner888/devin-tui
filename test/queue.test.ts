import assert from 'node:assert/strict';
import test from 'node:test';
import type {ImageAttachment} from '../src/composer.js';
import {initialState, reducer, type State} from '../src/state/store.js';

const shot: ImageAttachment = {path: '/tmp/shot.png', name: 'shot.png', mimeType: 'image/png'};

function queuedWithImage(): State {
	const s = {...initialState('/project', undefined, ''), status: 'working' as const};
	return reducer(s, {type: 'queueMsg', text: 'look at this', images: [shot]});
}

test('queued guidance keeps its images until the queue is cleared', () => {
	let s = queuedWithImage();
	s = reducer(s, {type: 'turnEnd', stopReason: 'cancelled'});
	assert.deepEqual(s.queued, ['look at this']);
	assert.deepEqual(s.queuedImages, [shot]);
	s = reducer(s, {type: 'clearQueue'});
	assert.deepEqual(s.queued, []);
	assert.deepEqual(s.queuedImages, []);
});

for (const action of [{type: 'clear'}, {type: 'logout'}, {type: 'loadStart'}] as const) {
	test(`${action.type} drops queued images with the queued text`, () => {
		const s = reducer(queuedWithImage(), action);
		assert.deepEqual(s.queued, []);
		assert.deepEqual(s.queuedImages, []);
	});
}

test('dropQueuedImages removes only the named images and keeps the queued text', () => {
	const other: ImageAttachment = {path: '/tmp/other.png', name: 'other.png', mimeType: 'image/png'};
	let s = reducer(queuedWithImage(), {type: 'queueMsg', text: 'and this', images: [other]});
	s = reducer(s, {type: 'dropQueuedImages', images: [shot]});
	assert.deepEqual(s.queued, ['look at this', 'and this']);
	assert.deepEqual(s.queuedImages, [other]);
});
