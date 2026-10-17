import assert from 'node:assert/strict';
import test, {type TestContext} from 'node:test';
import {
	getCloudMessages,
	listCloudSessions,
	sendCloudMessage,
} from '../src/cloud.js';

function configure(
	t: TestContext,
	values: Record<string, string | undefined>,
): void {
	const old = new Map<string, string | undefined>();
	for (const [key, value] of Object.entries(values)) {
		old.set(key, process.env[key]);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	t.after(() => {
		for (const [key, value] of old) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {'Content-Type': 'application/json'},
	});
}

function mockFetch(
	t: TestContext,
	handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): void {
	const old = globalThis.fetch;
	globalThis.fetch = (async (input, init) => {
		const url =
			typeof input === 'string'
				? input
				: input instanceof URL
					? input.href
					: input.url;
		return handler(url, init);
	}) as typeof fetch;
	t.after(() => {
		globalThis.fetch = old;
	});
}

test('v1 lists sessions with status_enum, derived URLs, and newest-first order', async t => {
	configure(t, {
		DEVIN_API_KEY: 'apk_cloud_test_secret',
		DEVIN_API_URL: 'https://api.test/',
		DEVIN_ORG_ID: undefined,
	});
	let requestUrl = '';
	let authorization = '';
	let contentType = '';
	mockFetch(t, (url, init) => {
		requestUrl = url;
		authorization = new Headers(init?.headers).get('authorization') ?? '';
		contentType = new Headers(init?.headers).get('content-type') ?? '';
		return json({
			sessions: [
				{
					session_id: 'devin-older',
					title: null,
					status: 'old status',
					status_enum: 'finished',
					updated_at: '2025-01-01T00:00:00.000Z',
					url: 'https://example.invalid/not-the-session',
				},
				{
					session_id: 'devin-newer',
					title: 'Latest task',
					status: 'running',
					status_enum: null,
					updated_at: '2025-02-01T00:00:00.000Z',
				},
			],
		});
	});

	const sessions = await listCloudSessions();
	assert.equal(requestUrl, 'https://api.test/v1/sessions?limit=20');
	assert.equal(authorization, 'Bearer apk_cloud_test_secret');
	assert.equal(contentType, 'application/json');
	assert.deepEqual(sessions.map(session => session.id), [
		'devin-newer',
		'devin-older',
	]);
	assert.equal(sessions[0]?.status, 'running');
	assert.equal(sessions[0]?.url, 'https://app.devin.ai/sessions/newer');
	assert.equal(sessions[1]?.title, null);
	assert.equal(sessions[1]?.status, 'finished');
});

test('v1 message lookup retries the singular endpoint on 404 and maps user types', async t => {
	configure(t, {
		DEVIN_API_KEY: 'apk_cloud_test_key',
		DEVIN_API_URL: 'https://api.test',
	});
	const urls: string[] = [];
	mockFetch(t, (url) => {
		urls.push(url);
		if (urls.length === 1) return json({detail: 'not found'}, 404);
		return json({
			messages: [
				{
					type: 'user_message',
					message: 'Please check this.',
					timestamp: '2025-01-01T00:00:00.000Z',
				},
				{
					type: 'assistant_message',
					message: 'Done.',
					timestamp: '2025-01-01T00:00:01.000Z',
				},
			],
		});
	});

	assert.deepEqual(await getCloudMessages('session-1'), [
		{from: 'user', text: 'Please check this.', at: Date.parse('2025-01-01T00:00:00.000Z')},
		{from: 'devin', text: 'Done.', at: Date.parse('2025-01-01T00:00:01.000Z')},
	]);
	assert.deepEqual(urls, [
		'https://api.test/v1/sessions/session-1',
		'https://api.test/v1/session/session-1',
	]);
});

test('v1 send retries singular route and treats detail in a 200 as failure', async t => {
	const key = 'apk_fake_secret_for_redaction';
	configure(t, {
		DEVIN_API_KEY: key,
		DEVIN_API_URL: 'https://api.test',
	});
	const requests: {url: string; method: string; body: string}[] = [];
	let detailResponse = false;
	mockFetch(t, (url, init) => {
		requests.push({
			url,
			method: init?.method ?? 'GET',
			body: String(init?.body ?? ''),
		});
		if (detailResponse) return json({detail: `suspended ${key}`});
		return requests.length === 1
			? json({detail: 'route moved'}, 404)
			: json({ok: true});
	});

	await sendCloudMessage('session-2', 'Please continue');
	assert.deepEqual(
		requests.slice(0, 2).map(request => [request.url, request.method, request.body]),
		[
			['https://api.test/v1/sessions/session-2/message', 'POST', '{"message":"Please continue"}'],
			['https://api.test/v1/session/session-2/message', 'POST', '{"message":"Please continue"}'],
		],
	);
	detailResponse = true;
	await assert.rejects(
		sendCloudMessage('session-2', 'another message'),
		error => {
			assert.match(String(error), /suspended \[redacted\]/);
			assert.ok(!String(error).includes(key));
			return true;
		},
	);
});

test('v1 HTTP errors redact the API key', async t => {
	const key = 'apk_do_not_leak_this';
	configure(t, {DEVIN_API_KEY: key, DEVIN_API_URL: 'https://api.test'});
	mockFetch(t, () => json({detail: `invalid key ${key}`}, 401));
	await assert.rejects(listCloudSessions(), error => {
		assert.match(String(error), /HTTP 401: invalid key \[redacted\]/);
		assert.ok(!String(error).includes(key));
		return true;
	});
});

test('v3 session listing retries without first on 422', async t => {
	configure(t, {
		DEVIN_API_KEY: 'cog_cloud_test_key',
		DEVIN_ORG_ID: 'org-42',
		DEVIN_API_URL: 'https://api.test',
	});
	const urls: string[] = [];
	mockFetch(t, url => {
		urls.push(url);
		if (urls.length === 1) return json({detail: 'unsupported query'}, 422);
		return json({
			items: [
				{
					session_id: 'devin-v3-old',
					title: 'Old',
					status: 'finished',
					updated_at: 1_700_000_000,
					url: 'https://app.devin.ai/sessions/old',
				},
				{
					session_id: 'devin-v3-new',
					title: 'New',
					status: 'running',
					updated_at: 1_800_000_000,
					url: 'https://app.devin.ai/sessions/new',
				},
			],
		});
	});

	const sessions = await listCloudSessions();
	assert.deepEqual(urls, [
		'https://api.test/v3/organizations/org-42/sessions?first=20',
		'https://api.test/v3/organizations/org-42/sessions',
	]);
	assert.deepEqual(sessions.map(session => session.id), [
		'devin-v3-new',
		'devin-v3-old',
	]);
	assert.equal(sessions[0]?.updatedAt, 1_800_000_000_000);
	assert.equal(sessions[0]?.url, 'https://app.devin.ai/sessions/new');
});

test('v3 messages paginate, prefix ids, and send as the configured user', async t => {
	configure(t, {
		DEVIN_API_KEY: 'cog_cloud_test_key',
		DEVIN_ORG_ID: 'org-42',
		DEVIN_USER_ID: 'user-7',
		DEVIN_API_URL: 'https://api.test',
	});
	const requests: {
		url: string;
		method: string;
		body: string;
		authorization: string;
		contentType: string;
	}[] = [];
	mockFetch(t, (url, init) => {
		requests.push({
			url,
			method: init?.method ?? 'GET',
			body: String(init?.body ?? ''),
			authorization: new Headers(init?.headers).get('authorization') ?? '',
			contentType: new Headers(init?.headers).get('content-type') ?? '',
		});
		if (init?.method === 'POST') return json({ok: true});
		if (requests.length === 1) {
			return json({
				items: [
					{source: 'user', message: 'Question', created_at: 1_700_000_001},
				],
				has_next_page: true,
				end_cursor: 'cursor-2',
			});
		}
		return json({
			items: [
				{source: 'devin', message: 'Answer', created_at: 1_700_000_002},
			],
			has_next_page: false,
		});
	});

	assert.deepEqual(await getCloudMessages('abc'), [
		{from: 'user', text: 'Question', at: 1_700_000_001_000},
		{from: 'devin', text: 'Answer', at: 1_700_000_002_000},
	]);
	assert.deepEqual(requests.slice(0, 2).map(request => request.url), [
		'https://api.test/v3/organizations/org-42/sessions/devin-abc/messages?first=100',
		'https://api.test/v3/organizations/org-42/sessions/devin-abc/messages?first=100&after=cursor-2',
	]);

	await sendCloudMessage('devin-abc', 'Follow up');
	assert.deepEqual(requests[2], {
		url: 'https://api.test/v3/organizations/org-42/sessions/devin-abc/messages',
		method: 'POST',
		body: '{"message":"Follow up","message_as_user_id":"user-7"}',
		authorization: 'Bearer cog_cloud_test_key',
		contentType: 'application/json',
	});
});

test('v3 message pagination is capped at five pages and keeps the last 200', async t => {
	configure(t, {
		DEVIN_API_KEY: 'cog_cloud_test_key',
		DEVIN_ORG_ID: 'org-42',
		DEVIN_API_URL: 'https://api.test',
	});
	let calls = 0;
	mockFetch(t, () => {
		const page = calls++;
		return json({
			items: Array.from({length: 100}, (_, i) => ({
				source: i % 2 ? 'devin' : 'user',
				message: `page ${page} message ${i}`,
				created_at: page * 100 + i,
			})),
			has_next_page: true,
			end_cursor: `cursor-${page + 1}`,
		});
	});

	const messages = await getCloudMessages('abc');
	assert.equal(calls, 5);
	assert.equal(messages.length, 200);
	assert.equal(messages[0]?.text, 'page 3 message 0');
	assert.equal(messages.at(-1)?.text, 'page 4 message 99');
});
