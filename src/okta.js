import * as client from 'openid-client';

const required = (name) => {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required env var ${name}. Copy .env.example to .env`);
	return value;
};

export const config = {
	issuer: required('OKTA_ISSUER'),
	clientId: required('OKTA_CLIENT_ID'),
	clientSecret: required('OKTA_CLIENT_SECRET'),
	scopes: process.env.OKTA_SCOPES ?? 'openid profile email offline_access',
	redirectUri: `${required('APP_BASE_URL')}/callback`,
};

/**
 * Discovery hits <issuer>/.well-known/openid-configuration once at boot, so every
 * endpoint below (authorize, token, introspect) comes from Okta rather than being
 * hardcoded here. Same document n8n's resolver reads.
 */
const oidc = await client.discovery(
	new URL(config.issuer),
	config.clientId,
	config.clientSecret,
);

/** Step 1 of the login: build the Okta URL and hand back the PKCE state to stash in the session. */
export async function beginLogin() {
	const codeVerifier = client.randomPKCECodeVerifier();
	const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
	const state = client.randomState();

	const url = client.buildAuthorizationUrl(oidc, {
		redirect_uri: config.redirectUri,
		scope: config.scopes,
		code_challenge: codeChallenge,
		code_challenge_method: 'S256',
		state,
	});

	return { url: url.href, codeVerifier, state };
}

/** Step 2: exchange ?code= for tokens. */
export async function completeLogin(currentUrl, { codeVerifier, state }) {
	const tokens = await client.authorizationCodeGrant(oidc, currentUrl, {
		pkceCodeVerifier: codeVerifier,
		expectedState: state,
	});

	return {
		accessToken: tokens.access_token,
		refreshToken: tokens.refresh_token,
		// Kept raw, not just its claims: Okta's end-session endpoint requires the
		// original JWT as `id_token_hint` to know whose session to terminate.
		idToken: tokens.id_token,
		idTokenClaims: tokens.claims(),
		expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
	};
}

/**
 * Okta access tokens live one hour. Renew a minute early so a call that starts
 * valid cannot finish expired.
 */
export async function refreshIfNeeded(session) {
	const auth = session.auth;
	if (!auth?.refreshToken) return auth;
	if (Date.now() < auth.expiresAt - 60_000) return auth;

	const tokens = await client.refreshTokenGrant(oidc, auth.refreshToken);
	session.auth = {
		...auth,
		accessToken: tokens.access_token,
		refreshToken: tokens.refresh_token ?? auth.refreshToken,
		expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
	};
	return session.auth;
}

/**
 * RP-initiated logout. Ends the session at Okta itself, not just here — without this,
 * clearing the local cookie only means the next "Sign in" silently re-authenticates
 * from Okta's still-live session cookie, which looks like sign-out doing nothing.
 *
 * Note this does NOT touch the user's Gmail connection stored in n8n. That is a
 * separate OAuth relationship with its own lifecycle; use Disconnect on /status.
 */
export function buildLogoutUrl(idToken, postLogoutRedirectUri) {
	if (!oidc.serverMetadata().end_session_endpoint) return null;

	const parameters = { post_logout_redirect_uri: postLogoutRedirectUri };
	// Okta rejects the request without a hint naming the session to end.
	if (idToken) parameters.id_token_hint = idToken;

	return client.buildEndSessionUrl(oidc, parameters).href;
}

/**
 * Ending the Okta session does not invalidate tokens we already hold, so a refresh
 * token would outlive the sign-out. Best-effort: a failure here must not block the
 * user from signing out.
 */
export async function revokeTokens({ refreshToken, accessToken }) {
	for (const [token, hint] of [
		[refreshToken, 'refresh_token'],
		[accessToken, 'access_token'],
	]) {
		if (!token) continue;
		try {
			await client.tokenRevocation(oidc, token, { token_type_hint: hint });
		} catch (error) {
			console.warn(`Could not revoke ${hint}:`, error.message);
		}
	}
}

/**
 * Okta's custom authorization server issues JWT access tokens, so we can read the
 * claims locally. This is for the debug page only — never a substitute for the
 * introspection n8n does, which also checks the token has not been revoked.
 */
export function decodeJwtPayload(token) {
	try {
		const [, payload] = token.split('.');
		return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
	} catch {
		return null;
	}
}

/** Ask Okta the same question n8n's resolver asks, so you can compare answers. */
export async function introspect(token) {
	const endpoint = oidc.serverMetadata().introspection_endpoint;
	if (!endpoint) throw new Error('Issuer metadata has no introspection_endpoint');

	const basic = Buffer.from(
		`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`,
	).toString('base64');

	const res = await fetch(endpoint, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Authorization: `Basic ${basic}`,
		},
		body: new URLSearchParams({ token, token_type_hint: 'access_token' }),
		signal: AbortSignal.timeout(10_000),
	});

	return await res.json();
}
