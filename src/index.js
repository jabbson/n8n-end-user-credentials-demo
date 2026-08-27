import express from 'express';
import session from 'express-session';

import * as n8n from './n8n.js';
import {
	beginLogin,
	buildLogoutUrl,
	completeLogin,
	config,
	decodeJwtPayload,
	introspect,
	refreshIfNeeded,
	revokeTokens,
} from './okta.js';
import {
	banner,
	chain,
	copyButton,
	escapeHtml,
	facts,
	logo,
	page,
	raw,
	serviceLogo,
	statusPill,
	tokenBlock,
} from './views.js';

const app = express();
const port = Number(process.env.PORT ?? 3000);
const baseUrl = process.env.APP_BASE_URL ?? `http://localhost:${port}`;

// Mirrors the Subject Claim configured on the n8n resolver, so this app can show you
// which claim actually becomes the storage key. It is display-only — n8n decides.
const subjectClaim = process.env.SUBJECT_CLAIM ?? 'uid';

app.use('/logo', express.static('public/logo', { maxAge: '1h', immutable: false }));
app.use(express.urlencoded({ extended: false }));
app.use(
	session({
		secret: process.env.SESSION_SECRET ?? 'dev-only-insecure-secret',
		resave: false,
		saveUninitialized: false,
		cookie: { httpOnly: true, sameSite: 'lax', secure: baseUrl.startsWith('https://') },
	}),
);

async function requireAuth(req, res, next) {
	if (!req.session.auth) return res.redirect('/');
	try {
		await refreshIfNeeded(req.session);
		next();
	} catch (error) {
		req.session.destroy(() => {});
		next(error);
	}
}

const userLabel = (req) =>
	req.session.auth?.idTokenClaims?.email ?? req.session.auth?.idTokenClaims?.sub;

/**
 * Guard against calling n8n with a blank workflow id or webhook URL. Without this the
 * request still goes out — as `/rest/workflows//execution-status`, which misses the
 * dynamic-credentials route entirely and returns a session-auth 401 that looks
 * convincingly like a broken token.
 */
function renderIfUnconfigured(req, res, { varName, value, where, active }) {
	if (value) return false;

	res.send(
		page({
			title: 'Not configured yet',
			user: userLabel(req),
			active,
			body:
				banner('warn', `<strong>${escapeHtml(varName)}</strong> is not set in <code>.env</code>.`) +
				`<p>${escapeHtml(where)}</p>
         <p class="lede">Restart the app after editing <code>.env</code>.
         <code>npm start</code> reads it once at boot; <code>npm run dev</code> reloads.</p>`,
		}),
	);
	return true;
}

// --------------------------------------------------------------------------
// Okta sign-in / sign-out
// --------------------------------------------------------------------------

app.get('/', (req, res) => {
	if (!req.session.auth) {
		return res.send(
			page({
				title: 'Sign in',
				bare: true,
				hideSignIn: true,
				body: `<div class="hero">
             <h1>Call n8n as yourself</h1>
             <p>This app stands in for a third-party product that triggers an n8n
                workflow. The access token Okta hands back becomes the identity n8n
                resolves to your own Gmail connection.</p>
             <div class="actions"><a class="btn primary" href="/login">${logo(
							'okta',
						)}Sign in with Okta</a></div>
             <p class="note" style="margin-top:1.2rem">End-user credentials is a preview
                capability. This demo was built against n8n 2.36.7, and the n8n interfaces
                it calls are not a stable API. Re-test after upgrading.</p>
             <h2>Identity provider</h2>
             ${facts([{ label: 'issuer', value: config.issuer }])}
           </div>`,
			}),
		);
	}

	const claims = req.session.auth.idTokenClaims;
	res.send(
		page({
			title: 'Overview',
			user: userLabel(req),
			active: '/',
			body: `<p class="lede">Okta has identified you. Two OAuth grants have to line up
             before the workflow can read your mail. This app walks you through the
             second one.</p>
         <h2>Steps</h2>
         <ol>
           <li><a href="/status">Credentials</a>: does n8n hold a Gmail token for you yet?</li>
           <li>Connect from that page. A second OAuth flow, this time against Google.</li>
           <li><a href="/run">Run workflow</a>: reads your own inbox.</li>
         </ol>
         <h2>Signed in as</h2>
         ${facts([
						{ label: 'email', value: claims.email },
						{ label: 'sub', value: claims.sub, note: 'The Okta user ID, taken from the ID token' },
					])}
         <h2>Reference</h2>
         ${raw('ID token claims', claims)}`,
		}),
	);
});

app.get('/login', async (req, res, next) => {
	try {
		const { url, codeVerifier, state } = await beginLogin();
		req.session.pkce = { codeVerifier, state };
		res.redirect(url);
	} catch (error) {
		next(error);
	}
});

app.get('/callback', async (req, res, next) => {
	try {
		const pkce = req.session.pkce;
		if (!pkce) return res.redirect('/login');
		delete req.session.pkce;

		req.session.auth = await completeLogin(new URL(req.originalUrl, baseUrl), pkce);
		res.redirect('/status');
	} catch (error) {
		next(error);
	}
});

/**
 * Revoke the tokens we hold, drop the local session, then let Okta end its own.
 * Skipping the last step is why "sign out" can appear to do nothing — the next
 * sign-in round-trips through Okta's cookie and returns instantly.
 */
app.get('/logout', async (req, res) => {
	const auth = req.session.auth;

	if (!auth?.idToken) {
		return req.session.destroy(() => res.redirect('/signed-out'));
	}

	await revokeTokens(auth);
	const logoutUrl = buildLogoutUrl(auth.idToken, `${baseUrl}/signed-out`);
	req.session.destroy(() => res.redirect(logoutUrl ?? '/signed-out'));
});

app.get('/signed-out', (req, res) => {
	res.send(
		page({
			title: 'Signed out',
			bare: true,
			body: `<div class="hero">
           <h1>Signed out</h1>
           <p>Your Okta session ended and this app's tokens were revoked.</p>
           <p>Your Gmail connection inside n8n is untouched. That is a separate grant,
              keyed on your Okta subject, and it survives sign-out on purpose, so you
              connect once rather than every session. Clear it with
              <strong>Disconnect</strong> on the credentials page.</p>
           <div class="actions"><a class="btn primary" href="/">Back to start</a></div>
         </div>`,
		}),
	);
});

// --------------------------------------------------------------------------
// Token inspector
// --------------------------------------------------------------------------

app.get('/token', requireAuth, async (req, res, next) => {
	try {
		const accessToken = req.session.auth.accessToken;
		const jwtClaims = decodeJwtPayload(accessToken);

		let introspection;
		try {
			introspection = await introspect(accessToken);
		} catch (error) {
			introspection = { error: error.message };
		}

		const subject = introspection?.[subjectClaim];
		const audience = Array.isArray(introspection?.aud)
			? introspection.aud.join(', ')
			: introspection?.aud;

		const rows = [
			{
				label: 'active',
				value: String(introspection?.active ?? 'unknown'),
				note: introspection?.active
					? 'Okta recognizes this token and it has not been revoked'
					: 'Introspection did not confirm this token',
			},
			{
				label: 'aud',
				value: audience,
				note: "Must equal the resolver's Expected Audience, or every call is refused",
			},
			{
				label: 'sub',
				value: introspection?.sub,
				note: 'The Okta login. It can change, which makes it a poor storage key.',
			},
			{
				label: subjectClaim,
				value: subject,
				mark: true,
				note: `Subject Claim in use. This is the key your Gmail token is stored under.`,
			},
			{ label: 'client_id', value: introspection?.client_id },
			{ label: 'scope', value: introspection?.scope },
		];

		const expiresAt = req.session.auth.expiresAt;

		res.send(
			page({
				title: 'Token',
				user: userLabel(req),
				active: '/token',
				body: `<p class="lede">Everything below comes from Okta's introspection endpoint,
               the same request n8n's resolver makes when it decides who you are.</p>

           <h2>What the resolver reads</h2>
           ${facts(rows)}
           <p class="lede" style="margin:.9rem 0 0">Access token expiry:
             <strong data-expires="${expiresAt}">shortly</strong>.
             The app refreshes automatically a minute before that.</p>

           <h2>The join key</h2>
           ${chain([
							{ logo: 'okta', label: 'Okta says', value: introspection?.sub ?? 'unknown' },
							{ label: `${subjectClaim} claim`, value: subject ?? 'missing' },
							{ logo: 'n8n', label: 'n8n stores under', value: subject ?? 'nothing yet' },
							{ logo: 'gmail', label: 'unlocks', value: 'your Gmail token' },
						])}
           <p class="lede" style="margin:.9rem 0 0">Two unrelated OAuth grants, one from
             Okta and one from Google, meet at exactly one value. Change which claim you
             key on and every stored connection is orphaned.</p>

           <h2>Reference</h2>
           <div class="actions" style="flex-direction:column;align-items:stretch;gap:.6rem">
             ${raw('Introspection response', introspection)}
             ${raw('Decoded JWT payload', jwtClaims)}
           </div>

           <h2>Raw token</h2>
           ${tokenBlock(accessToken)}`,
			}),
		);
	} catch (error) {
		next(error);
	}
});

// --------------------------------------------------------------------------
// Credential status and the self-service connect handoff
// --------------------------------------------------------------------------

app.get('/status', requireAuth, async (req, res, next) => {
	if (
		renderIfUnconfigured(req, res, {
			varName: 'N8N_WORKFLOW_ID',
			value: n8n.workflowId,
			where: 'Copy it from the editor URL, the part after /workflow/.',
			active: '/status',
		})
	) {
		return;
	}

	try {
		const status = await n8n.getExecutionStatus(req.session.auth.accessToken);
		const credentials = status.credentials ?? [];

		// Only worth asking once something is actually connected, and only for Google —
		// the probe workflow answers for the Gmail credential specifically.
		const anyConnected = credentials.some((cred) => cred.credentialStatus === 'configured');
		const account = anyConnected
			? await n8n.getConnectedAccount(req.session.auth.accessToken)
			: undefined;

		const rows = credentials
			.map(
				(cred) => `<tr>
        <td class="subject">${serviceLogo(cred.credentialType)}${escapeHtml(cred.credentialName)}
          <span class="from">${escapeHtml(cred.credentialType)}</span></td>
        <td>${
					cred.credentialStatus === 'configured'
						? account
							? `<span class="from">${escapeHtml(account)}</span>`
							: '<span class="note">not reported</span>'
						: ''
				}</td>
        <td>${statusPill(cred.credentialStatus)}</td>
        <td class="actions">
          ${
						cred.authorizationUrl
							? `<form method="post" action="/authorize" data-popup data-busy>
                   <input type="hidden" name="url" value="${escapeHtml(cred.authorizationUrl)}">
                   <button class="${cred.credentialStatus === 'configured' ? 'caution' : 'primary'}"
                           data-busy-label="Opening Google">${
																			cred.credentialStatus === 'configured' ? 'Reconnect' : 'Connect'
																		}</button>
                 </form>`
							: '<span class="note">No resolver on this credential</span>'
					}
          ${
						cred.revokeUrl && cred.credentialStatus === 'configured'
							? `<form method="post" action="/revoke" data-busy>
                   <input type="hidden" name="url" value="${escapeHtml(cred.revokeUrl)}">
                   <button class="danger" data-busy-label="Disconnecting">Disconnect</button>
                 </form>`
							: ''
					}
        </td>
      </tr>`,
			)
			.join('');

		const head = status.readyToExecute
			? banner('ok', 'Ready to run. n8n holds a token for every credential this workflow needs.')
			: banner(
					'warn',
					'Not ready. Connect the accounts below. You only have to do this once.',
				);

		res.send(
			page({
				title: 'Credentials',
				user: userLabel(req),
				active: '/status',
				body: `${head}
           <p class="lede">n8n was asked, as you, whether it can run
             <code>${escapeHtml(status.workflowId)}</code>. A credential reads
             <em>missing</em> when no token is stored under your subject, not when
             something is broken.</p>
           <table>
             <thead><tr><th>Credential</th><th>Connected as</th><th>Status</th><th></th></tr></thead>
             <tbody>${
								rows ||
								'<tr><td colspan="4" class="note">This workflow uses no end-user credentials.</td></tr>'
							}</tbody>
           </table>
           ${
							anyConnected && !account && n8n.accountWebhookUrl
								? '<p class="note">Could not read the connected address. The probe workflow may be unpublished, or missing its resolver under Settings.</p>'
								: ''
						}
           ${
							anyConnected && !n8n.accountWebhookUrl
								? '<p class="note">Set <code>N8N_ACCOUNT_WEBHOOK_URL</code> to show which Google account each connection uses.</p>'
								: ''
						}
           <h2>Reference</h2>
           ${raw('execution-status response', status)}`,
			}),
		);
	} catch (error) {
		next(error);
	}
});

app.post('/authorize', requireAuth, async (req, res, next) => {
	try {
		const providerUrl = await n8n.requestAuthorizationUrl(req.session.auth.accessToken, req.body.url);

		// The popup path asks for JSON so it can open the window itself; a plain form
		// post with no JS still works via redirect.
		if (req.get('accept')?.includes('application/json')) {
			res.json({ url: providerUrl });
		} else {
			res.redirect(providerUrl);
		}
	} catch (error) {
		next(error);
	}
});

app.post('/revoke', requireAuth, async (req, res, next) => {
	try {
		await n8n.revoke(req.session.auth.accessToken, req.body.url);
		res.redirect('/status');
	} catch (error) {
		next(error);
	}
});

// --------------------------------------------------------------------------
// Run
// --------------------------------------------------------------------------

const runButton = (label) =>
	`<form method="post" action="/run" data-busy>
     <button class="primary" data-busy-label="Reading your mail">${label}</button>
   </form>`;

app.get('/run', requireAuth, (req, res) => {
	if (
		renderIfUnconfigured(req, res, {
			varName: 'N8N_WEBHOOK_URL',
			value: n8n.webhookUrl,
			where: "The workflow's production webhook URL, from the Webhook trigger node.",
			active: '/run',
		})
	) {
		return;
	}

	res.send(
		page({
			title: 'Run workflow',
			user: userLabel(req),
			active: '/run',
			body: `<p class="lede">Sends your Okta access token as the bearer, so the workflow
             runs against your mailbox rather than the credential's own account.</p>
         <h2>Endpoint</h2>
         ${facts([{ label: 'POST', value: n8n.webhookUrl }])}
         <div class="actions">${runButton('Run workflow')}</div>`,
		}),
	);
});

app.post('/run', requireAuth, async (req, res, next) => {
	if (
		renderIfUnconfigured(req, res, {
			varName: 'N8N_WEBHOOK_URL',
			value: n8n.webhookUrl,
			where: "The workflow's production webhook URL, from the Webhook trigger node.",
			active: '/run',
		})
	) {
		return;
	}

	try {
		const result = await n8n.callWebhook(req.session.auth.accessToken, { source: 'demo-app' });
		const emails = Array.isArray(result.body?.messages) ? result.body.messages : null;
		const account = result.body?.account;
		const count = emails?.length ?? 0;
		const oktaEmail = req.session.auth.idTokenClaims?.email;

		const head =
			result.status >= 400
				? banner(
						'err',
						`The workflow returned <strong>${result.status}</strong>. ` +
							(result.body?.error === 'gmail_not_connected'
								? 'No Gmail token is stored for you. Connect it on the credentials page.'
								: 'See the response below.'),
					)
				: banner(
						'ok',
						`Read ${count} ${count === 1 ? 'message' : 'messages'} from ` +
							`${escapeHtml(account ?? 'your mailbox')}.`,
					);

		// The two identities are independent: nothing forces the Google account you
		// consented with to be the same person Okta authenticated. Say so when they differ,
		// because otherwise the mismatch is invisible and the mail looks like your own.
		const mismatch =
			account && oktaEmail && account.toLowerCase() !== oktaEmail.toLowerCase()
				? banner(
						'warn',
						`This mail is from <strong>${escapeHtml(account)}</strong>, not ` +
							`<strong>${escapeHtml(oktaEmail)}</strong>. The Google grant is separate from ` +
							'the Okta sign-in, so both are legitimate, but the run is attributed to your ' +
							'Okta identity. Disconnect and reconnect to bind a different account.',
					)
				: '';

		const identities = account
			? `<h2>Which accounts ran this</h2>
         ${facts([
						{
							logo: 'okta',
							label: 'okta',
							value: oktaEmail,
							note: 'Who called. Decides which stored token is used.',
						},
						{
							logo: 'gmail',
							label: 'google',
							value: account,
							mark: !mismatch,
							note: 'Whose mailbox was read. Reported by Gmail users.getProfile.',
						},
					])}`
			: '';

		const table = emails?.length
			? `<table><thead><tr><th>From</th><th>Subject</th></tr></thead><tbody>
         ${emails
						.map(
							(email) => `<tr>
             <td><span class="from">${escapeHtml(email.from)}</span></td>
             <td class="subject">${escapeHtml(email.subject)}</td>
           </tr>`,
						)
						.join('')}
       </tbody></table>`
			: '';

		res.send(
			page({
				title: 'Run workflow',
				user: userLabel(req),
				active: '/run',
				body: `${head}${mismatch}${table}${identities}
           <h2>Reference</h2>
           ${raw(`Response body (HTTP ${result.status})`, result.body)}
           <div class="actions">${runButton('Run again')}</div>`,
			}),
		);
	} catch (error) {
		next(error);
	}
});

// --------------------------------------------------------------------------

app.use((error, req, res, _next) => {
	console.error(error);
	res.status(500).send(
		page({
			title: 'Something broke',
			user: userLabel(req),
			body:
				banner('err', escapeHtml(error.message)) +
				`<h2>Stack</h2><div class="token">${escapeHtml(error.stack ?? '')}</div>`,
		}),
	);
});

app.listen(port, () => {
	console.log(`\n  Demo app   ${baseUrl}`);
	console.log(`  Okta       ${config.issuer}`);
	console.log(`  n8n        ${process.env.N8N_BASE_URL}`);
	console.log(`  Workflow   ${n8n.workflowId || '(N8N_WORKFLOW_ID not set)'}`);
	console.log(`  Subject    ${subjectClaim}\n`);
});
