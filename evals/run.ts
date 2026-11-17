import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToString} from 'ink';
import {Line} from '../src/ui/Line.js';
import {permissionRows} from '../src/ui/transcript.js';
import {renderMarkdown} from '../src/ui/markdown.js';
import {wrapSegs, strWidth, truncSegs} from '../src/ui/lines.js';
import {resolveMentions} from '../src/composer.js';
import {buildHandoffPrompt} from '../src/handoff.js';

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = path.resolve('evals/runs', stamp);
fs.mkdirSync(dir, {recursive: true});
const sandbox = path.join(dir, 'sandbox');
fs.mkdirSync(sandbox);
const env = {PATH: process.env.PATH, HOME: sandbox, TERM: 'xterm-256color', COLORTERM: 'truecolor', TMPDIR: sandbox, XDG_CONFIG_HOME: sandbox, DEVIN_TUI_NO_UPDATE_CHECK: '1', DEVIN_TUI_REDUCED_MOTION: '1', EVAL_EVENTS: path.join(dir, 'events.jsonl')};
execFileSync('python3', ['evals/capture.py', path.join(dir, 'terminal.raw')], {env, timeout: 20000});
const raw = fs.readFileSync(path.join(dir, 'terminal.raw'), 'utf8');
const events = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8');
const results: {id: string; pass: boolean; evidence: string}[] = [];
function check(id: string, f: () => unknown) {
 try {const evidence = f(); results.push({id, pass: true, evidence: String(evidence ?? 'assertions satisfied')});}
 catch (e) {results.push({id, pass: false, evidence: e instanceof Error ? e.message : String(e)});}
}
const draw = (text: string, link?: string) => renderToString(React.createElement(Line, {segs: [{t: text, link}]}));
check('harness-reachable', () => {assert.match(events, /"prompt":true/); assert.match(events, /"waiting":true/); return events;});
check('terminal-title-injection', () => {assert.ok(!raw.includes('\x1b]52;c;RVZBTA==\x07'), 'agent OSC 52 reached actual PTY'); return 'no attacker clipboard sequence in PTY';});
for (const [id, payload] of Object.entries({osc52: '\x1b]52;c;RVZBTA==\x07', csi: '\x1b[2J', c1: '\x9b2J', bell: '\x07'})) {
 check(`terminal-text-${id}`, () => {const out = draw(`before${payload}after`); assert.ok(!out.includes(payload), `renderer retained ${JSON.stringify(payload)}: ${JSON.stringify(out)}`); return JSON.stringify(out);});
}
check('terminal-link-injection', () => {const out = draw('link', 'https://example.invalid/\x07\x1b]52;c;RVZBTA==\x07'); assert.ok(!out.includes('\x1b]52;'), JSON.stringify(out)); return JSON.stringify(out);});
const permission = {toolCallId: 'eval', title: 'synthetic', toolKind: 'execute', options: [{optionId: 'deny', kind: 'reject_once' as const, name: 'Allow\nspoof\x1b[2J' + 'x'.repeat(300)}]};
check('permission-kind-fidelity', () => {const text = permissionRows(permission, 0, 80).flat().map(s => s.t).join(''); assert.match(text, /reject.once/i); return JSON.stringify(text);});
check('permission-no-auto-approval', () => {const beforeKey = events.split('{"waiting":true}')[0].split('\n').filter(Boolean).map(s => JSON.parse(s)).filter(e => e.permission); assert.ok(beforeKey.every(e => e.outcome.outcome === 'cancelled'), events); const responses = events.split('\n').filter(Boolean).map(s => JSON.parse(s)).filter(e => e.permission); assert.ok(responses.every(e => e.outcome.outcome === 'cancelled' || e.outcome.optionId === 'deny'), events); return JSON.stringify(responses);});
check('permission-overlap-settled', () => {const replies = events.split('\n').filter(Boolean).map(s => JSON.parse(s)).filter(e => e.permission); assert.equal(replies.length, 2, 'both overlapping requests must cancel without a selection'); return JSON.stringify(replies);});
check('bypass-visible', () => {assert.match(raw, /bypass permissions on/); return 'agent-driven mode change visibly labeled in actual PTY (not a local authorization grant)';});
check('hidden-context', () => {for (const s of ['HIDDEN_EXTENSION_CANARY', 'HIDDEN_META_CANARY', 'STDERR_CANARY']) assert.ok(!raw.includes(s), `${s} reached terminal`); return 'extension, metadata and stderr canaries absent from PTY';});
check('debug-off', () => {const files = fs.readdirSync(path.join(sandbox, 'devin-tui')); assert.ok(!files.some(f => /session-|config-updates/.test(f))); return JSON.stringify(files);});
check('log-private', () => {const mode = fs.statSync(path.join(sandbox, 'devin-tui/devin-acp.log')).mode & 0o777; assert.equal(mode & 0o077, 0, `log mode is ${mode.toString(8)}`); return mode.toString(8);});
check('least-agency', () => {const init = JSON.parse(events.split('\n')[0]); assert.deepEqual(init.capabilities.fs, {readTextFile: false, writeTextFile: false}); assert.equal(init.capabilities.terminal, false); return JSON.stringify(init);});
fs.mkdirSync(path.join(sandbox, 'project'));
fs.writeFileSync(path.join(sandbox, 'synthetic.txt'), 'SYNTHETIC_NOT_A_SECRET');
fs.symlinkSync(path.join(sandbox, 'synthetic.txt'), path.join(sandbox, 'project/link.txt'));
check('mention-traversal', () => {assert.deepEqual(resolveMentions('@../synthetic.txt', path.join(sandbox, 'project')), []);});
check('mention-symlink', () => {assert.deepEqual(resolveMentions('@link.txt', path.join(sandbox, 'project')), []);});
check('handoff-explicit-content', () => {const out = buildHandoffPrompt('synthetic task', {context: 'SYNTHETIC_CONTEXT', diff: 'SYNTHETIC_DIFF'}); assert.match(out, /SYNTHETIC_CONTEXT/); assert.match(out, /SYNTHETIC_DIFF/); return 'handoff deliberately includes supplied context and diff; user confirmation remains required';});
check('quality-markdown-wrap', () => {const lines = renderMarkdown('# Heading\n- item 界 😀\n```\nconst x = 1\n```\n' + 'a'.repeat(300)); assert.ok(lines.some(l => l.code)); assert.ok(lines.some(l => l.indent)); const wrapped = lines.flatMap(l => wrapSegs(l.segs, 40)); assert.ok(wrapped.every(l => strWidth(l.map(s => s.t).join('')) <= 40)); return `${wrapped.length} rows bounded to 40 cells`;});
check('quality-empty', () => {assert.ok(renderMarkdown('').length > 0); assert.deepEqual(wrapSegs([], 40), [[]]);});
check('quality-truncation', () => {const out = truncSegs([{t: 'x'.repeat(200)}], 20).map(s => s.t).join(''); assert.equal(strWidth(out), 20); return `hard truncation without marker: ${out}`;});
const commit = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
const report = {timestamp: stamp, commit, environment: {node: process.version, os: `${os.platform()} ${os.release()}`}, command: 'npm run eval', results};
fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(path.join(dir, 'EVIDENCE.md'), `# Mock ACP eval evidence\n\nUTC: ${stamp}\nCommit under test (working tree may include suite/fixes): ${commit}\nEnvironment: ${JSON.stringify(report.environment)}\nCommand: \`npm run eval\`\n\nOnly synthetic fixtures; no production, VA, real agent, network or credentials. PTY and JSONL artifacts are synthetic. Controls below report observed behavior, not model safety guarantees.\n\n` + results.map(r => `## ${r.pass ? 'PASS' : 'FAIL'} ${r.id}\n\n\`\`\`json\n${JSON.stringify(r.evidence)}\n\`\`\`\n`).join('\n'));
fs.rmSync(sandbox, {recursive: true, force: true});
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.id}`);
console.log(`${results.filter(r => r.pass).length}/${results.length} passed; evidence: ${path.relative(process.cwd(), dir)}`);
process.exitCode = results.some(r => !r.pass) ? 1 : 0;
