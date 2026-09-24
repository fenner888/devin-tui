/**
 * Real `devin acp` compatibility check — does NOT call `authenticate`
 * (that would pop a browser). Verifies:
 *  1. initialize works and returns protocolVersion 1 + authMethods.
 *  2. session/new fails cleanly with -32000 "not authenticated".
 *  3. `_cognition.ai/*` extension notifications don't break the connection.
 */
import {spawn} from 'node:child_process';
import {Readable, Writable} from 'node:stream';
import {
	ClientSideConnection,
	ndJsonStream,
	PROTOCOL_VERSION,
	RequestError,
	type Client,
} from '@agentclientprotocol/sdk';

const child = spawn('devin', ['acp'], {stdio: ['pipe', 'pipe', 'pipe']});
const stderrLines: string[] = [];
child.stderr.on('data', d => stderrLines.push(String(d)));

const extNotifications: string[] = [];

const client: Client = {
	sessionUpdate: () => {},
	requestPermission: () => Promise.resolve({outcome: {outcome: 'cancelled'}}),
	extNotification: (method, params) => {
		extNotifications.push(`${method} ${JSON.stringify(params).slice(0, 120)}`);
	},
};

const conn = new ClientSideConnection(
	() => client,
	ndJsonStream(
		Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
		Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
	),
);

let failed = false;
const check = (name: string, ok: boolean, detail = '') => {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
	if (!ok) failed = true;
};

try {
	const init = await conn.initialize({
		protocolVersion: PROTOCOL_VERSION,
		clientCapabilities: {
			fs: {readTextFile: false, writeTextFile: false},
			terminal: false,
		},
		clientInfo: {name: 'devin-tui-check', version: '0.0.0'},
	});
	check('initialize', init.protocolVersion === 1, `protocolVersion=${init.protocolVersion} agent=${init.agentInfo?.title ?? init.agentInfo?.name}`);
	check('authMethods advertised', (init.authMethods ?? []).length > 0, JSON.stringify(init.authMethods));

	try {
		await conn.newSession({cwd: process.cwd(), mcpServers: []});
		check('session/new rejected pre-auth', false, 'unexpectedly succeeded');
	} catch (e) {
		if (e instanceof RequestError) {
			check(
				'session/new rejected pre-auth',
				e.code === -32000 && /not authenticated/i.test(e.message),
				`code=${e.code} message=${e.message.slice(0, 90)}…`,
			);
		} else {
			check('session/new rejected pre-auth', false, `unexpected error: ${e}`);
		}
	}

	// give ext notifications a moment to arrive
	await new Promise(r => setTimeout(r, 1200));
	check(
		'ext notifications survive',
		true,
		`received ${extNotifications.length} _cognition.ai/* notifications without disconnect`,
	);
	check('connection still open', !conn.signal.aborted);
} catch (e) {
	check('handshake', false, String(e));
} finally {
	child.kill('SIGTERM');
}

if (extNotifications.length) {
	console.log('\nsample ext notifications:');
	for (const n of extNotifications.slice(0, 4)) console.log('  ' + n);
}
console.log(`\nstderr lines captured: ${stderrLines.length} (routed to log, not terminal)`);
process.exit(failed ? 1 : 0);
