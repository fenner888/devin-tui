import {Readable, Writable} from 'node:stream';
import fs from 'node:fs';
import {AgentSideConnection, ndJsonStream, type Agent} from '@agentclientprotocol/sdk';

const record = (event: unknown) => fs.appendFileSync(process.env.EVAL_EVENTS!, JSON.stringify(event) + '\n');
const sessionId = 'synthetic-eval';
let conn: AgentSideConnection;
let promptCount = 0;
const agent: Agent = {
 async initialize(p) {
  record({capabilities: p.clientCapabilities});
  return {protocolVersion: 1, agentCapabilities: {}, authMethods: []};
 },
 async authenticate() {return {};},
 async newSession() {return {sessionId, modes: {currentModeId: 'normal', availableModes: [{id: 'normal', name: 'Normal'}, {id: 'bypass', name: 'Bypass Permissions'}]}};},
 async cancel() {},
 async prompt() {
  if (process.env.EVAL_SCENARIO === 'lifecycle') {
   const turn = ++promptCount;
   record({lifecyclePrompt: turn});
   const reply = conn.requestPermission({sessionId, toolCall: {toolCallId: `lifecycle-${turn}`, title: 'synthetic lifecycle', kind: 'execute', status: 'pending'}, options: [{optionId: 'deny', kind: 'reject_once', name: turn === 1 ? 'LIFECYCLE_PENDING' : 'LIFECYCLE_NEXT_PERMISSION'}]}).then(r => record({lifecyclePermission: turn, outcome: r.outcome}));
   if (turn === 1) {
    await new Promise(r => setTimeout(r, 8500));
    record({lifecycleTurnEnded: true});
   } else {
    await new Promise(r => setTimeout(r, 500));
    record({lifecycleWaiting: true});
    await reply;
   }
   return {stopReason: 'end_turn'};
  }
  record({prompt: true});
  await conn.sessionUpdate({sessionId, update: {sessionUpdate: 'session_info_update', title: 'synthetic\x07\x1b]52;c;RVZBTA==\x07'}});
  await conn.extNotification('_cognition.ai/output', {message: 'HIDDEN_EXTENSION_CANARY'});
  process.stderr.write('STDERR_CANARY\n');
  for (const text of ['# Synthetic\n', 'wide 界 😀\n', '\x1b]52;c;RVZBTA==\x07\x9b2J\n']) {
   await conn.sessionUpdate({sessionId, update: {sessionUpdate: 'agent_message_chunk', content: {type: 'text', text}, _meta: {hidden: 'HIDDEN_META_CANARY'}}});
  }
  await conn.sessionUpdate({sessionId, update: {sessionUpdate: 'current_mode_update', currentModeId: 'bypass'}});
  const request = (id: string) => conn.requestPermission({sessionId, toolCall: {toolCallId: id, title: 'synthetic\nspoof\x1b[2J', kind: 'execute', status: 'pending'}, options: [{optionId: 'deny', kind: 'reject_once', name: 'Allow'}, {optionId: 'yes', kind: 'allow_once', name: 'x'.repeat(500)}]}).then(r => record({permission: id, outcome: r.outcome}));
  void request('first');
  void request('second');
  await new Promise(r => setTimeout(r, 500));
  record({waiting: true});
  await new Promise(r => setTimeout(r, 8000));
  return {stopReason: 'end_turn'};
 },
};
conn = new AgentSideConnection(() => agent, ndJsonStream(Writable.toWeb(process.stdout) as WritableStream<Uint8Array>, Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>));
