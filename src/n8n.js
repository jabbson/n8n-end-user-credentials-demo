const baseUrl = (process.env.N8N_BASE_URL ?? '').replace(/\/$/, '');
const endpointAuthToken = process.env.N8N_ENDPOINT_AUTH_TOKEN ?? '';

export const workflowId = process.env.N8N_WORKFLOW_ID ?? '';
export const webhookUrl = process.env.N8N_WEBHOOK_URL ?? '';
export const accountWebhookUrl = process.env.N8N_ACCOUNT_WEBHOOK_URL ?? '';

/**
 * Two independent headers on every dynamic-credential call:
 *   Authorization  — the Okta token; this is the *user's* identity, the thing the
 *                    resolver introspects and turns into a subject.
 *   x-authorization — a static shared secret proving the *app* may talk to these
 *                    endpoints at all. n8n reads it from
 *                    N8N_DYNAMIC_CREDENTIALS_ENDPOINT_AUTH_TOKEN and 500s if unset.
 */
function headers(accessToken) {
	return {
		Authorization: `Bearer ${accessToken}`,
		'x-authorization': `Bearer ${endpointAuthToken}`,
		Accept: 'application/json',
	};
}

async function parse(res) {
	const text = await res.text();
	let body;
	try {
		body = JSON.parse(text);
	} catch {
		body = text;
	}
	if (!res.ok) {
		const detail = typeof body === 'string' ? body : JSON.stringify(body);
		throw new Error(`n8n responded ${res.status}: ${detail}`);
	}
	// n8n's REST layer wraps successful payloads in { data: ... }
	return body?.data ?? body;
}

/**
 * Every call here crosses the network to an n8n instance that might be down, mid-restart,
 * or simply slow. Without a deadline a hung n8n holds the request open until the platform
 * kills it — 300s on Vercel — which during a demo looks like the app itself having frozen.
 * The timeout message names the call, because "the operation was aborted" does not.
 */
async function timedFetch(url, options, ms, what) {
	try {
		return await fetch(url, { ...options, signal: AbortSignal.timeout(ms) });
	} catch (error) {
		if (error.name === 'TimeoutError') {
			throw new Error(`${what} did not respond within ${ms / 1000}s. Is n8n reachable?`);
		}
		throw error;
	}
}

/**
 * Is this workflow runnable *for this caller*? Returns readyToExecute plus, for each
 * dynamic credential, a per-credential status of missing | configured |
 * resolver_missing and the URLs to authorize or revoke it.
 */
export async function getExecutionStatus(accessToken) {
	const res = await timedFetch(
		`${baseUrl}/rest/workflows/${workflowId}/execution-status`,
		{ headers: headers(accessToken) },
		15_000,
		'Checking execution status',
	);
	return await parse(res);
}

/**
 * Turn a `missing` credential into a provider consent URL. The response is the
 * Google (or whichever provider) authorization URL — send the user's browser there.
 * `authorizationUrl` comes straight from getExecutionStatus, resolverId included.
 */
export async function requestAuthorizationUrl(accessToken, authorizationUrl) {
	assertSameInstance(authorizationUrl);
	const res = await timedFetch(
		authorizationUrl,
		{ method: 'POST', headers: headers(accessToken) },
		15_000,
		'Requesting the consent URL',
	);
	return await parse(res);
}

/** Drop this caller's stored provider tokens for one credential. */
export async function revoke(accessToken, revokeUrl) {
	assertSameInstance(revokeUrl);
	const res = await timedFetch(
		revokeUrl,
		{ method: 'DELETE', headers: headers(accessToken) },
		15_000,
		'Disconnecting the credential',
	);
	if (!res.ok && res.status !== 204) await parse(res);
}

/** Fire the workflow itself. Same bearer token, so the run happens as this user. */
export async function callWebhook(accessToken, payload) {
	const res = await timedFetch(
		webhookUrl,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
				Accept: 'application/json',
			},
			body: JSON.stringify(payload ?? {}),
		},
		// Longer than the rest: this one runs the workflow, which reads a mailbox.
		60_000,
		'Running the workflow',
	);
	const text = await res.text();
	let body;
	try {
		body = JSON.parse(text);
	} catch {
		body = text;
	}
	return { status: res.status, body };
}

/**
 * Which Google account this caller is bound to. Gmail requests no identity scope, so
 * the stored token carries no email claim and n8n has nothing to report — a workflow
 * has to ask Google. Best-effort by design: the credentials page is still useful
 * without it, so every failure returns undefined rather than breaking the page.
 */
export async function getConnectedAccount(accessToken) {
	if (!accountWebhookUrl) return undefined;

	try {
		const res = await fetch(accountWebhookUrl, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
				Accept: 'application/json',
			},
			body: '{}',
			signal: AbortSignal.timeout(10_000),
		});

		if (!res.ok) return undefined;
		const body = await res.json();
		return typeof body?.account === 'string' ? body.account : undefined;
	} catch {
		return undefined;
	}
}

/**
 * The authorize/revoke URLs are echoed back to us by n8n and then used as fetch
 * targets carrying both bearer tokens, so pin them to the configured instance
 * rather than following wherever the response points.
 */
function assertSameInstance(url) {
	if (!url?.startsWith(`${baseUrl}/`)) {
		throw new Error(`Refusing to call ${url} because it is not on ${baseUrl}`);
	}
}
