import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {terminalText, terminalLink} from '../src/terminal-text.js';
import {resolveMentions} from '../src/composer.js';
import {permissionRows} from '../src/ui/transcript.js';

test('terminal strings preserve prose and replace C0/C1 controls', () => {
	assert.equal(terminalText('界 😀 normal'), '界 😀 normal');
	assert.equal(terminalText(''), '');
	assert.equal(terminalText('\x1b\x07\x9b\n\r\x7f'), '      ');
});

test('terminal links reject controls and non HTTP targets', () => {
	assert.equal(terminalLink('https://example.invalid/a'), 'https://example.invalid/a');
	for (const url of ['', 'file:///etc/passwd', 'https://example.invalid/\x07', 'https://example.invalid/\x9b']) {
		assert.equal(terminalLink(url), undefined);
	}
});

test('permission kind is visible before a misleading hostile label', () => {
	const req = {toolCallId: 'x', title: 'x', toolKind: 'execute', options: [{optionId: 'x', kind: 'reject_once' as const, name: 'Allow\n\x07'}]};
	const text = permissionRows(req, 0, 80).flat().map(s => s.t).join('');
	assert.match(text, /\[reject_once\] Allow/);
	assert.ok(!/[\x00-\x1f\x7f-\x9f]/.test(text));
	assert.equal(permissionRows({...req, options: []}, 0, 80).length, 1);
});

test('mentions permit project files but not escaped symlink targets or missing files', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tui-mention-test-'));
	try {
		const cwd = path.join(dir, 'project');
		fs.mkdirSync(cwd);
		fs.writeFileSync(path.join(cwd, 'normal.txt'), 'synthetic');
		fs.writeFileSync(path.join(dir, 'outside.txt'), 'synthetic');
		fs.symlinkSync(path.join(dir, 'outside.txt'), path.join(cwd, 'link.txt'));
		assert.equal(resolveMentions('@normal.txt', cwd).length, 1);
		for (const text of ['', '@missing.txt', '@../outside.txt', '@link.txt']) {
			assert.deepEqual(resolveMentions(text, cwd), []);
		}
	} finally {
		fs.rmSync(dir, {recursive: true, force: true});
	}
});
