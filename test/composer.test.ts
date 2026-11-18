import assert from 'node:assert/strict';
import test from 'node:test';
import {editGrapheme, wordLeft, wordRight} from '../src/composer.js';

for (const grapheme of ['a', '😀', '👍🏽', '👨‍👩‍👧‍👦', '🇺🇸', 'e\u0301']) {
	test(`composer edits whole graphemes: ${grapheme}`, () => {
		const value = `hi ${grapheme}!`;
		const start = 3;
		const end = start + grapheme.length;
		assert.deepEqual(editGrapheme(value, end, 'backspace'), {value: 'hi !', cursor: start});
		assert.deepEqual(editGrapheme(value, start, 'delete'), {value: 'hi !', cursor: start});
		assert.deepEqual(editGrapheme(value, end, 'left'), {value, cursor: start});
		assert.deepEqual(editGrapheme(value, start, 'right'), {value, cursor: end});
	});
}

test('composer editing is a no-op at empty input and input boundaries', () => {
	for (const action of ['left', 'right', 'backspace', 'delete'] as const) {
		assert.deepEqual(editGrapheme('', 0, action), {value: '', cursor: 0});
	}
	for (const action of ['left', 'backspace'] as const) {
		assert.deepEqual(editGrapheme('😀', 0, action), {value: '😀', cursor: 0});
	}
	for (const action of ['right', 'delete'] as const) {
		assert.deepEqual(editGrapheme('😀', 2, action), {value: '😀', cursor: 2});
	}
});

test('composer repairs cursor offsets inside a grapheme without splitting it', () => {
	for (const action of ['backspace', 'delete'] as const) {
		assert.deepEqual(editGrapheme('a😀b', 2, action), {value: 'ab', cursor: 1});
	}
	assert.deepEqual(editGrapheme('a😀b', 2, 'left'), {value: 'a😀b', cursor: 1});
	assert.deepEqual(editGrapheme('a😀b', 2, 'right'), {value: 'a😀b', cursor: 3});
});

test('wordLeft skips trailing punctuation and whitespace, then the word', () => {
	const sentence = 'hello brave new world';
	assert.equal(wordLeft(sentence, sentence.length), 16);
	assert.equal(wordLeft('foo  ', 5), 0);
	const path = 'path/to/file.ts';
	assert.equal(wordLeft(path, path.length), 13);
});

test('wordLeft handles the start of input and newline boundaries', () => {
	assert.equal(wordLeft('hello', 0), 0);
	assert.equal(wordLeft('hello\nworld', 8), 6);
});

test('wordRight skips punctuation and whitespace, then the next word', () => {
	assert.equal(wordRight('hello world', 0), 5);
	assert.equal(wordRight('hello world', 5), 11);
});

test('word boundaries treat astral Unicode letters as one word character', () => {
	assert.equal(wordLeft('a 𝒜', 'a 𝒜'.length), 2);
	assert.equal(wordRight('𝒜x', 0), 3);
});

test('wordRight treats newlines as separators', () => {
	assert.equal(wordRight('hello\nworld', 5), 11);
});
