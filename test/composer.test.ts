import assert from 'node:assert/strict';
import test from 'node:test';
import {wordLeft, wordRight} from '../src/composer.js';

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
