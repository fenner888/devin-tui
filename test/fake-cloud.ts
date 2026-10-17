import http from 'node:http';

const port = Number(process.env.DEVIN_TUI_FAKE_CLOUD_PORT ?? 43123);
const firstUpdated = new Date().toISOString();
const secondUpdated = new Date(Date.now() - 60_000).toISOString();

const messages = [
	{
		type: 'user_message',
		message: 'Please help me check the forecast.',
		timestamp: new Date(Date.now() - 90_000).toISOString(),
	},
	{
		type: 'devin_message',
		message: 'The cloud Devin is ready to help.',
		timestamp: new Date(Date.now() - 30_000).toISOString(),
	},
];

const server = http.createServer((req, res) => {
	res.setHeader('Content-Type', 'application/json');
	const auth = req.headers.authorization;
	if (
		auth !== 'Bearer apk_cloud_test_key' &&
		auth !== 'Bearer cog_cloud_test_key'
	) {
		res.statusCode = 401;
		res.end(JSON.stringify({detail: 'fake API key rejected'}));
		return;
	}

	const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
	const pathname = url.pathname;
	const isV1 = pathname.startsWith('/v1/');
	const isV3 = pathname.startsWith('/v3/organizations/fake-org/');
	if (!isV1 && !isV3) {
		res.statusCode = 404;
		res.end(JSON.stringify({detail: 'unknown fake route'}));
		return;
	}

	if (req.method === 'GET' && pathname.endsWith('/sessions')) {
		if (isV1) {
			res.end(
				JSON.stringify({
					sessions: [
						{
							session_id: 'devin-cloud-weather',
							title: 'Weather lookup',
							status: 'active',
							status_enum: 'running',
							updated_at: firstUpdated,
						},
						{
							session_id: 'devin-cloud-build',
							title: null,
							status: 'finished',
							status_enum: 'finished',
							updated_at: secondUpdated,
						},
					],
				}),
			);
			return;
		}
		res.end(
			JSON.stringify({
				items: [
					{
						session_id: 'devin-cloud-weather',
						title: 'Weather lookup',
						status: 'running',
						updated_at: Date.now() / 1000,
						url: 'https://app.devin.ai/sessions/cloud-weather',
					},
				],
			}),
		);
		return;
	}

	const v1Message = pathname.match(
		/^\/v1\/sessions\/([^/]+)\/message$/,
	);
	const v1SingularMessage = pathname.match(
		/^\/v1\/session\/([^/]+)\/message$/,
	);
	const v1Session = pathname.match(/^\/v1\/sessions\/([^/]+)$/);
	const v1SingularSession = pathname.match(/^\/v1\/session\/([^/]+)$/);
	const v3Messages = pathname.match(
		/^\/v3\/organizations\/fake-org\/sessions\/([^/]+)\/messages$/,
	);

	if (req.method === 'GET' && (v1Session || v1SingularSession)) {
		res.end(JSON.stringify({messages}));
		return;
	}
	if (
		req.method === 'GET' &&
		v3Messages
	) {
		res.end(
			JSON.stringify({
				items: messages.map(message => ({
					source: message.type === 'user_message' ? 'user' : 'devin',
					message: message.message,
					created_at: Date.parse(message.timestamp) / 1000,
				})),
				has_next_page: false,
			}),
		);
		return;
	}
	if (
		req.method === 'POST' &&
		(v1Message || v1SingularMessage || v3Messages)
	) {
		let raw = '';
		req.on('data', chunk => (raw += chunk));
		req.on('end', () => {
			let body: {message?: unknown} = {};
			try {
				body = JSON.parse(raw) as {message?: unknown};
			} catch {
				// Respond with an explicit error below for malformed JSON.
			}
			if (typeof body.message !== 'string') {
				res.statusCode = 400;
				res.end(JSON.stringify({detail: 'message is required'}));
				return;
			}
			messages.push({
				type: 'user_message',
				message: body.message,
				timestamp: new Date().toISOString(),
			});
			res.end(JSON.stringify({ok: true}));
		});
		return;
	}

	res.statusCode = 404;
	res.end(JSON.stringify({detail: 'unknown fake route'}));
});

server.listen(port, '127.0.0.1', () => {
	console.log(`fake cloud API listening on 127.0.0.1:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => server.close(() => process.exit(0)));
}
