/**
 * Verify the /handoff request shape against a local HTTP server — no real
 * API calls. Creates a temp git repo (commit + origin remote + dirty file)
 * so gatherGitContext exercises repo/branch/diff, records the POST, and
 * prints it with the API key redacted.
 *
 *   npx tsx test/handoff-req.ts
 */
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	buildHandoffPrompt,
	gatherGitContext,
	sendHandoff,
} from '../src/handoff.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-repo-'));
const g = (args: string[]) =>
	execFileSync('git', args, {cwd: dir, stdio: 'pipe'});
g(['init', '-b', 'main']);
g(['config', 'user.email', 't@example.com']);
g(['config', 'user.name', 't']);
fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
g(['add', 'a.txt']);
g(['commit', '-m', 'init']);
fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\nworld\n');
g(['remote', 'add', 'origin', 'git@github.com:acme/widgets.git']);

process.env.DEVIN_API_KEY ??= 'apk_test_dummy_key';

interface Recorded {
	method?: string;
	url?: string;
	headers: http.IncomingHttpHeaders;
	body: string;
}
let recorded: Recorded | null = null;
const server = http.createServer((req, res) => {
	let body = '';
	req.on('data', c => (body += c));
	req.on('end', () => {
		recorded = {method: req.method, url: req.url, headers: req.headers, body};
		res.setHeader('content-type', 'application/json');
		res.end(
			JSON.stringify({
				url: 'https://app.devin.ai/sessions/fake123',
				session_id: 'devin-fake123',
			}),
		);
	});
});
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const port = (server.address() as {port: number}).port;
process.env.DEVIN_API_URL = `http://127.0.0.1:${port}`;

const gc = await gatherGitContext(dir);
console.log('git context:', JSON.stringify({repo: gc.repo, branch: gc.branch, diffBytes: gc.diff?.length ?? 0}));
const prompt = buildHandoffPrompt('fix the flaky test', {
	...gc,
	context: 'User: hi\nDevin: working on it\n- Ran command: npm test',
});
const url = await sendHandoff(prompt, 'fix the flaky test');
server.close();

console.log('session url:', url);
if (!recorded) {
	console.error('FAIL: no request recorded');
	process.exit(1);
}
const r = recorded as Recorded;
const headers = {...r.headers};
if (typeof headers.authorization === 'string') {
	headers.authorization = headers.authorization.replace(/apk_\S+/, 'apk_***');
}
const parsed = JSON.parse(r.body);
console.log('method:', r.method);
console.log('path:', r.url);
console.log('headers:', JSON.stringify(headers, null, 2));
console.log('body keys:', Object.keys(parsed).join(', '));
console.log('title:', JSON.stringify(parsed.title));
console.log('tags:', JSON.stringify(parsed.tags));
console.log('--- prompt ---');
console.log(parsed.prompt);
console.log('--------------');
// sanity assertions
const ok =
	r.method === 'POST' &&
	r.url === '/v1/sessions' &&
	parsed.tags?.[0] === 'handoff' &&
	typeof parsed.prompt === 'string' &&
	parsed.prompt.includes('Repo: acme/widgets') &&
	parsed.prompt.includes('Branch: main') &&
	parsed.prompt.includes('```diff') &&
	parsed.title === 'fix the flaky test';
console.log(ok ? 'OK: request matches the script contract' : 'FAIL: mismatch');
process.exit(ok ? 0 : 1);
