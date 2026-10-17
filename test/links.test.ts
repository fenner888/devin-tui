import assert from 'node:assert/strict';
import test from 'node:test';
import {findHttpUrls, linkify, seg, wrapSegs} from '../src/ui/lines.js';
import {inlineSegs} from '../src/ui/markdown.js';

test('linkify styles a plain URL in the middle of a sentence', () => {
	const result = linkify([{
		t: 'Read https://example.com/docs now',
		k: 'text',
		bg: 'panel',
		hex: '#123456',
	}]);
	assert.deepEqual(result, [
		{t: 'Read ', k: 'text', bg: 'panel', hex: '#123456'},
		{
			t: 'https://example.com/docs',
			k: 'text',
			bg: 'panel',
			hex: '#123456',
			link: 'https://example.com/docs',
		},
		{t: ' now', k: 'text', bg: 'panel', hex: '#123456'},
	]);
});

test('linkify trims trailing prose punctuation and unmatched closing parentheses', () => {
	assert.deepEqual(
		linkify([seg('https://a.test/page., https://b.test/page)')]),
		[
			{...seg('https://a.test/page'), link: 'https://a.test/page'},
			seg('.,'),
			seg(' '),
			{...seg('https://b.test/page'), link: 'https://b.test/page'},
			seg(')'),
		],
	);
});

test('linkify keeps balanced parentheses inside a URL', () => {
	assert.deepEqual(linkify([seg('(see https://x.com/a_(b))')]), [
		seg('(see '),
		{...seg('https://x.com/a_(b)'), link: 'https://x.com/a_(b)'},
		seg(')'),
	]);
});

test('linkify handles two URLs in one segment', () => {
	assert.deepEqual(
		linkify([seg('https://one.test and https://two.test')]),
		[
			{...seg('https://one.test'), link: 'https://one.test'},
			seg(' and '),
			{...seg('https://two.test'), link: 'https://two.test'},
		],
	);
});

test('linkify leaves already-linked segments untouched', () => {
	const existing = {t: 'https://x.test', k: 'bright' as const, link: 'https://other.test'};
	assert.strictEqual(linkify([existing])[0], existing);
});

test('linkify rejects a URL match containing a control character', () => {
	const source = seg('https://x.test/\u0001unsafe');
	assert.deepEqual(linkify([source]), [source]);
});

test('URL collection includes Markdown targets in source order', () => {
	assert.deepEqual(
		findHttpUrls(
			'First https://one.test, then [docs](https://two.test/help).',
		),
		['https://one.test', 'https://two.test/help'],
	);
});

test('wrapped URL fragments retain the full hyperlink target', () => {
	const url = 'https://example.com/a/very/long/path/that/wraps';
	const fragments = wrapSegs(linkify([seg(url)]), 8).flat();
	assert.ok(fragments.length > 1);
	assert.ok(fragments.every(fragment => fragment.link === url));
});

test('inline Markdown links render labels as linked bright text', () => {
	assert.deepEqual(inlineSegs('See [docs](https://example.com/help).'), [
		seg('See ', 'text'),
		{...seg('docs', 'bright'), link: 'https://example.com/help'},
		seg('.', 'text'),
	]);
});

test('inline Markdown links keep non-HTTP targets literal', () => {
	assert.deepEqual(inlineSegs('[mail](mailto:help@example.com)'), [
		seg('[mail](mailto:help@example.com)', 'text'),
	]);
});

test('inline Markdown links reject control characters in the target', () => {
	assert.deepEqual(inlineSegs('[docs](https://example.com/\u0001path)'), [
		seg('[docs](https://example.com/\u0001path)', 'text'),
	]);
});
