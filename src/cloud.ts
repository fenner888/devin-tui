export interface CloudSession {
	id: string;
	title: string | null;
	status: string;
	updatedAt: number;
	url: string;
}

export interface CloudMessage {
	from: 'user' | 'devin';
	text: string;
	at: number;
}

export interface ApiBase {
	base: string;
	headers: Record<string, string>;
	kind: 'v1' | 'v3';
}

/** Shared Devin API origin, auth header, and key-version routing. */
export function apiBase(): ApiBase {
	const api = (process.env.DEVIN_API_URL ?? 'https://api.devin.ai').replace(
		/\/+$/,
		'',
	);
	const key = process.env.DEVIN_API_KEY ?? '';
	const kind = key.startsWith('cog_') ? 'v3' : 'v1';
	const org = process.env.DEVIN_ORG_ID ?? '';
	if (kind === 'v3' && !org) {
		throw new Error('DEVIN_ORG_ID is required for service keys (cog_*)');
	}
	return {
		base:
			kind === 'v3' ? `${api}/v3/organizations/${org}` : `${api}/v1`,
		headers: {
			Authorization: `Bearer ${key}`,
			'Content-Type': 'application/json',
		},
		kind,
	};
}

class CloudHttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

function redact(text: string, key: string): string {
	return key ? text.split(key).join('[redacted]') : text;
}

function jsonObject(raw: string): Record<string, unknown> {
	try {
		const value: unknown = JSON.parse(raw);
		return value && typeof value === 'object'
			? (value as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

function errorDetail(
	data: Record<string, unknown>,
	raw: string,
	status: number,
	key: string,
): CloudHttpError {
	const detail =
		data.detail ?? data.title ?? data.message ?? (raw || 'Unknown error');
	return new CloudHttpError(
		status,
		`HTTP ${status}: ${redact(String(detail), key)}`,
	);
}

async function requestJson(
	url: string,
	headers: Record<string, string>,
	key: string,
	method = 'GET',
	body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	let res: Response;
	try {
		res = await fetch(url, {
			method,
			headers,
			signal: AbortSignal.timeout(15_000),
			...(body ? {body: JSON.stringify(body)} : {}),
		});
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		throw new Error(redact(message, key));
	}
	let raw = '';
	try {
		raw = await res.text();
	} catch {
		// A missing body is handled like an empty JSON response.
	}
	const data = jsonObject(raw);
	if (!res.ok) throw errorDetail(data, raw, res.status, key);
	return data;
}

function millis(value: unknown, unixSeconds = false): number {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return unixSeconds ? value * 1000 : value;
	}
	if (typeof value === 'string') {
		const parsed = /^\d+(?:\.\d+)?$/.test(value)
			? Number(value) * (unixSeconds ? 1000 : 1)
			: Date.parse(value);
		return Number.isFinite(parsed) ? parsed : 0;
	}
	return 0;
}

function webUrl(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:'
			? url.href
			: undefined;
	} catch {
		return undefined;
	}
}

function sessionsFrom(rows: unknown[], kind: 'v1' | 'v3'): CloudSession[] {
	return rows
		.filter((row): row is Record<string, unknown> =>
			!!row && typeof row === 'object',
		)
		.map(row => {
			const id = String(row.session_id ?? '');
			const appId = encodeURIComponent(id.replace(/^devin-/, ''));
			const appUrl = `https://app.devin.ai/sessions/${appId}`;
			const status =
				kind === 'v1'
					? row.status_enum ?? row.status ?? ''
					: row.status ?? '';
			return {
				id,
				title:
					typeof row.title === 'string'
						? row.title.replace(/[\x00-\x1f\x7f]/g, '')
						: null,
				status: String(status).replace(/[\x00-\x1f\x7f]/g, ''),
				updatedAt: millis(row.updated_at, kind === 'v3'),
				url: kind === 'v3' ? webUrl(row.url) ?? appUrl : appUrl,
			};
		})
		.sort((a, b) => b.updatedAt - a.updatedAt);
}

function v3Id(id: string): string {
	return id.startsWith('devin-') ? id : `devin-${id}`;
}

export async function listCloudSessions(): Promise<CloudSession[]> {
	const {base, headers, kind} = apiBase();
	const key = process.env.DEVIN_API_KEY ?? '';
	if (kind === 'v1') {
		const data = await requestJson(
			`${base}/sessions?limit=20`,
			headers,
			key,
		);
		return sessionsFrom(
			Array.isArray(data.sessions) ? data.sessions : [],
			'v1',
		);
	}

	let data: Record<string, unknown>;
	try {
		data = await requestJson(`${base}/sessions?first=20`, headers, key);
	} catch (e) {
		if (!(e instanceof CloudHttpError) || e.status !== 422) throw e;
		data = await requestJson(`${base}/sessions`, headers, key);
	}
	return sessionsFrom(Array.isArray(data.items) ? data.items : [], 'v3');
}

function messagesFrom(rows: unknown[], unixSeconds: boolean): CloudMessage[] {
	return rows
		.filter((row): row is Record<string, unknown> =>
			!!row && typeof row === 'object',
		)
		.map(row => ({
			from:
				unixSeconds
					? row.source === 'user'
						? 'user'
						: 'devin'
					: /user/i.test(String(row.type ?? ''))
						? 'user'
						: 'devin',
			text: typeof row.message === 'string' ? row.message : '',
			at: millis(
				unixSeconds ? row.created_at : row.timestamp,
				unixSeconds,
			),
		}));
}

function lastMessages(messages: CloudMessage[]): CloudMessage[] {
	return messages
		.sort((a, b) => a.at - b.at)
		.slice(-200);
}

export async function getCloudMessages(id: string): Promise<CloudMessage[]> {
	const {base, headers, kind} = apiBase();
	const key = process.env.DEVIN_API_KEY ?? '';
	if (kind === 'v1') {
		let data: Record<string, unknown>;
		try {
			data = await requestJson(
				`${base}/sessions/${encodeURIComponent(id)}`,
				headers,
				key,
			);
		} catch (e) {
			if (!(e instanceof CloudHttpError) || e.status !== 404) throw e;
			data = await requestJson(
				`${base}/session/${encodeURIComponent(id)}`,
				headers,
				key,
			);
		}
		return lastMessages(
			messagesFrom(Array.isArray(data.messages) ? data.messages : [], false),
		);
	}

	const messages: CloudMessage[] = [];
	let cursor: string | undefined;
	for (let page = 0; page < 5; page++) {
		const query = new URLSearchParams({first: '100'});
		if (cursor) query.set('after', cursor);
		const data = await requestJson(
			`${base}/sessions/${encodeURIComponent(v3Id(id))}/messages?${query}`,
			headers,
			key,
		);
		messages.push(
			...messagesFrom(Array.isArray(data.items) ? data.items : [], true),
		);
		if (!data.has_next_page || typeof data.end_cursor !== 'string') break;
		if (data.end_cursor === cursor) break;
		cursor = data.end_cursor;
	}
	return lastMessages(messages);
}

export async function sendCloudMessage(
	id: string,
	text: string,
): Promise<void> {
	const {base, headers, kind} = apiBase();
	const key = process.env.DEVIN_API_KEY ?? '';
	if (kind === 'v1') {
		const body = {message: text};
		let data: Record<string, unknown>;
		try {
			data = await requestJson(
				`${base}/sessions/${encodeURIComponent(id)}/message`,
				headers,
				key,
				'POST',
				body,
			);
		} catch (e) {
			if (!(e instanceof CloudHttpError) || e.status !== 404) throw e;
			data = await requestJson(
				`${base}/session/${encodeURIComponent(id)}/message`,
				headers,
				key,
				'POST',
				body,
			);
		}
		if (typeof data.detail === 'string') {
			throw new Error(redact(data.detail, key));
		}
		return;
	}
	const body: Record<string, unknown> = {message: text};
	const userId = process.env.DEVIN_USER_ID;
	if (userId) body.message_as_user_id = userId;
	await requestJson(
		`${base}/sessions/${encodeURIComponent(v3Id(id))}/messages`,
		headers,
		key,
		'POST',
		body,
	);
}
