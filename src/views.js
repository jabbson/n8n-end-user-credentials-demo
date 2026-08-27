export const escapeHtml = (value) =>
	String(value ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);

/** Raw payloads are reference material, so they start collapsed rather than dominating the page. */
export const raw = (summary, value) =>
	`<details class="raw"><summary>${escapeHtml(summary)}</summary>
   <pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre></details>`;

export const statusPill = (status) => {
	const tone = status === 'configured' ? 'ok' : status === 'missing' ? 'warn' : 'err';
	const label = status === 'configured' ? 'connected' : status;
	return `<span class="pill ${tone}">${escapeHtml(label)}</span>`;
};

/** Long tokens wrap instead of scrolling sideways — you need to read the whole thing. */
export const tokenBlock = (value) =>
	`<div class="token">${escapeHtml(value)}</div>
   <p class="actions">${copyButton(value, 'Copy token')}</p>`;

export const copyButton = (value, label = 'Copy') =>
	`<button type="button" class="quiet copy" data-copy="${escapeHtml(value)}">${escapeHtml(label)}</button>`;

/**
 * Logos mark which service a thing belongs to. Used only where that is the question
 * being answered, never as decoration. Empty alt: the adjacent text already names the
 * service, so announcing it twice is noise for a screen reader.
 */
export const logo = (name) => `<img class="logo logo-${name}" src="/logo/${name}.png" alt="" />`;

/** Credential type to the service that issues it. Unknown types simply get no mark. */
export const serviceLogo = (credentialType = '') =>
	credentialType.toLowerCase().startsWith('gmail') || credentialType.toLowerCase().startsWith('google')
		? logo('gmail')
		: '';

export const banner = (tone, text) => `<p class="banner ${tone}">${text}</p>`;

/**
 * Label/value rows. `note` explains what the value is for; `mark` flags the one row
 * that actually decides behaviour, which on this app is always the subject claim.
 */
export const facts = (rows) =>
	`<div class="facts">${rows
		.map(
			(row) => `<div${row.mark ? ' class="marked"' : ''}>
        <span class="k">${row.logo ? logo(row.logo) : ''}${escapeHtml(row.label)}</span>
        <span class="v">${escapeHtml(row.value ?? 'unknown')}${
					row.note ? `<span class="note">${escapeHtml(row.note)}</span>` : ''
				}</span>
      </div>`,
		)
		.join('')}</div>`;

/** The join key, drawn. Two independent OAuth grants, linked by one claim. */
export const chain = (steps) =>
	`<div class="chain">${steps
		.map(
			(step) => `<span class="step">
       <span class="step-k">${step.logo ? logo(step.logo) : ''}${escapeHtml(step.label)}</span>
       <span class="step-v">${escapeHtml(step.value)}</span></span>`,
		)
		.join('<span class="arrow" aria-hidden="true">→</span>')}</div>`;

const STYLE = `
:root {
  --paper: #fbfbfa; --ink: #17181c; --muted: #6c6f79; --line: #e2e2de;
  --surface: #f2f2ef; --accent: #3a4fd8;
  --ok: #14713f; --ok-bg: #14713f14; --warn: #96520a; --warn-bg: #96520a14;
  --err: #ab2027; --err-bg: #ab202714;
  --measure: 58rem;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #101114; --ink: #e8e8ec; --muted: #8d909a; --line: #292b30;
    --surface: #191b1f; --accent: #93a0ff;
    --ok: #56c883; --ok-bg: #56c88318; --warn: #e0a44a; --warn-bg: #e0a44a18;
    --err: #f0757c; --err-bg: #f0757c18;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink);
       font: 15px/1.6 var(--sans); -webkit-font-smoothing: antialiased; }
a { color: var(--accent); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 3px; }

/* ---- top bar ---------------------------------------------------------- */
.topbar { border-bottom: 1px solid var(--line); position: sticky; top: 0;
          background: var(--paper); z-index: 5; }
.topbar > .bar { display: flex; align-items: center; gap: 1.25rem; flex-wrap: wrap;
                 max-width: var(--measure); margin: 0 auto; padding: .8rem 1.5rem; }
.brand { font-family: var(--mono); font-size: .78rem; font-weight: 600;
         letter-spacing: .1em; text-transform: uppercase; white-space: nowrap; }
.brand a { color: inherit; text-decoration: none; }
.bar nav { display: flex; gap: .1rem; margin-right: auto; flex-wrap: wrap; }
.bar nav a { font-size: .88rem; padding: .28rem .6rem; border-radius: 6px;
             color: var(--muted); text-decoration: none; }
.bar nav a:hover { color: var(--ink); background: var(--surface); }
.bar nav a[aria-current="page"] { color: var(--ink); background: var(--surface); font-weight: 600; }
.session { display: flex; align-items: center; gap: .7rem; }
.who { font-family: var(--mono); font-size: .78rem; color: var(--muted);
       max-width: 15rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ---- page ------------------------------------------------------------- */
main { max-width: var(--measure); margin: 0 auto; padding: 2.25rem 1.5rem 5rem; }
h1 { font-size: 1.5rem; letter-spacing: -.012em; margin: 0 0 .35rem; }
.lede { color: var(--muted); margin: 0 0 2rem; max-width: 46rem; }
h2 { font-family: var(--mono); font-size: .76rem; font-weight: 600; text-transform: uppercase;
     letter-spacing: .1em; color: var(--muted); margin: 2.4rem 0 .7rem; }
main > *:first-child + h2 { margin-top: 1.6rem; }
ol, ul { padding-left: 1.2rem; }
li { margin: .3rem 0; }
code { font-family: var(--mono); font-size: .86em; background: var(--surface);
       padding: .08rem .3rem; border-radius: 4px; }
.actions { display: flex; gap: .5rem; flex-wrap: wrap; margin: .7rem 0 0; }

/* ---- service marks ----------------------------------------------------- */
.logo { height: 1.05em; width: auto; vertical-align: -.17em; flex-shrink: 0; }
/* Okta's mark ships white on transparent. Invert it for light backgrounds; it is
   flat monochrome, so the inversion is exact. */
.logo-okta { filter: invert(1); }
@media (prefers-color-scheme: dark) { .logo-okta { filter: none; } }
/* On the accent-filled button the white original is already correct. */
.btn.primary .logo-okta, button.primary .logo-okta { filter: none; }
.btn .logo, button .logo { margin-right: .45em; }
.brand .logo { height: 1.05em; vertical-align: -.18em; margin-right: .5em; }
.step-k .logo, .k .logo { height: .95em; vertical-align: -.12em; margin-right: .35em; }
td .logo { margin-right: .45em; }

/* ---- facts ------------------------------------------------------------ */
.facts { border: 1px solid var(--line); border-radius: 9px; overflow: hidden; }
.facts > div { display: grid; grid-template-columns: 9rem 1fr; gap: 1rem;
               padding: .55rem .9rem; border-top: 1px solid var(--line); }
.facts > div:first-child { border-top: 0; }
.facts > div.marked { background: var(--ok-bg); }
.k { font-family: var(--mono); font-size: .78rem; color: var(--muted); }
.v { font-family: var(--mono); font-size: .84rem; word-break: break-all; }
.note { display: block; font-family: var(--sans); font-size: .78rem;
        color: var(--muted); margin-top: .15rem; word-break: normal; }

/* ---- the join key ----------------------------------------------------- */
.chain { display: flex; align-items: stretch; gap: .5rem; flex-wrap: wrap; }
.chain .step { border: 1px solid var(--line); border-radius: 8px; padding: .45rem .7rem;
               background: var(--surface); min-width: 0; }
.chain .step-k { display: block; font-family: var(--mono); font-size: .68rem;
                 text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
.chain .step-v { display: block; font-family: var(--mono); font-size: .8rem;
                 word-break: break-all; margin-top: .1rem; }
.chain .arrow { align-self: center; color: var(--muted); font-size: .9rem; }

/* ---- token ------------------------------------------------------------ */
.token { font-family: var(--mono); font-size: .76rem; line-height: 1.55;
         background: var(--surface); border: 1px solid var(--line); border-radius: 9px;
         padding: .8rem .9rem; word-break: break-all; white-space: pre-wrap; }

/* ---- raw payloads ----------------------------------------------------- */
details.raw { border: 1px solid var(--line); border-radius: 9px; overflow: hidden; }
details.raw > summary { cursor: pointer; padding: .5rem .9rem; font-family: var(--mono);
                        font-size: .78rem; color: var(--muted); list-style: none; }
details.raw > summary::-webkit-details-marker { display: none; }
details.raw > summary::before { content: "\\25B8"; margin-right: .45rem; }
details.raw[open] > summary::before { content: "\\25BE"; }
details.raw > summary:hover { color: var(--ink); }
details.raw pre { margin: 0; padding: .8rem .9rem; border-top: 1px solid var(--line);
                  background: var(--surface); font-family: var(--mono); font-size: .76rem;
                  white-space: pre-wrap; word-break: break-word; }

/* ---- tables ----------------------------------------------------------- */
table { width: 100%; border-collapse: collapse; border: 1px solid var(--line);
        border-radius: 9px; overflow: hidden; }
th { font-family: var(--mono); font-size: .7rem; font-weight: 600; text-transform: uppercase;
     letter-spacing: .09em; color: var(--muted); text-align: left;
     padding: .5rem .9rem; background: var(--surface); border-bottom: 1px solid var(--line); }
td { padding: .6rem .9rem; border-bottom: 1px solid var(--line); vertical-align: middle; }
tr:last-child td { border-bottom: 0; }
td.subject { font-weight: 500; }
td.actions { margin: 0; min-width: 11rem; }
td.actions form { display: flex; flex: 1 1 8rem; margin: 0; }
td.actions button { width: 100%; text-align: center; }
td .from { font-family: var(--mono); font-size: .8rem; color: var(--muted); }

/* ---- pills and banners ------------------------------------------------ */
.pill { display: inline-block; font-family: var(--mono); font-size: .72rem; font-weight: 600;
        letter-spacing: .03em; padding: .12rem .5rem; border-radius: 999px; }
.pill.ok { color: var(--ok); background: var(--ok-bg); box-shadow: inset 0 0 0 1px var(--ok); }
.pill.warn { color: var(--warn); background: var(--warn-bg); box-shadow: inset 0 0 0 1px var(--warn); }
.pill.err { color: var(--err); background: var(--err-bg); box-shadow: inset 0 0 0 1px var(--err); }
.banner { padding: .75rem .95rem; border-radius: 9px; margin: 0 0 1.5rem; font-size: .92rem; }
.banner.ok { color: var(--ok); background: var(--ok-bg); box-shadow: inset 0 0 0 1px var(--ok); }
.banner.warn { color: var(--warn); background: var(--warn-bg); box-shadow: inset 0 0 0 1px var(--warn); }
.banner.err { color: var(--err); background: var(--err-bg); box-shadow: inset 0 0 0 1px var(--err); }
.banner strong { font-weight: 600; }

/* ---- controls --------------------------------------------------------- */
button, .btn { font: inherit; font-size: .89rem; padding: .38rem .85rem; border-radius: 7px;
               border: 1px solid var(--line); background: var(--surface); color: var(--ink);
               cursor: pointer; text-decoration: none; display: inline-block; }
button:hover:not([disabled]), .btn:hover { border-color: var(--accent); }
button.primary, .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.quiet { background: transparent; }
/* Reconnect replaces a working connection, Disconnect destroys one. Both borrow the
   existing warn/err tones rather than introducing new ones, so the page keeps a single
   vocabulary for "careful" and "destructive". */
button.caution, .btn.caution { color: var(--warn); background: var(--warn-bg);
                               border-color: color-mix(in srgb, var(--warn) 40%, transparent); }
button.caution:hover:not([disabled]), .btn.caution:hover { border-color: var(--warn); }
button.danger, .btn.danger { color: var(--err); background: var(--err-bg);
                             border-color: color-mix(in srgb, var(--err) 40%, transparent); }
button.danger:hover:not([disabled]), .btn.danger:hover { border-color: var(--err); }
button[disabled] { opacity: .6; cursor: progress; }
form { display: inline; }
.spinner { display: inline-block; width: .7em; height: .7em; margin-right: .45em;
           border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%;
           vertical-align: -.05em; animation: spin .6s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2.4s; } }

/* ---- sign in ---------------------------------------------------------- */
.hero { margin: 2.5rem 0 0; border: 1px solid var(--line);
        border-radius: 12px; padding: 1.9rem; background: var(--surface); }
.hero h1 { margin-bottom: .6rem; }
.hero p { color: var(--muted); }
.hero .actions { margin-top: 1.4rem; }

@media (max-width: 640px) {
  .topbar > .bar { gap: .6rem; }
  .bar nav { order: 3; width: 100%; margin-right: 0; }
  .session { margin-left: auto; }
  .facts > div { grid-template-columns: 1fr; gap: .15rem; }
  main { padding-top: 1.5rem; }
}
`;

const SCRIPT = `<script>
document.querySelectorAll('form[data-busy]').forEach(function (form) {
  form.addEventListener('submit', function () {
    var button = form.querySelector('button');
    if (!button || button.disabled) return;
    var label = button.getAttribute('data-busy-label') || 'Working';
    // Deferred a tick: disabling a submit button inside its own submit handler
    // cancels the submission in some browsers.
    setTimeout(function () {
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span>' + label;
    }, 0);
  });
});

document.querySelectorAll('button.copy').forEach(function (button) {
  button.addEventListener('click', function () {
    navigator.clipboard.writeText(button.getAttribute('data-copy')).then(function () {
      var previous = button.textContent;
      button.textContent = 'Copied';
      setTimeout(function () { button.textContent = previous; }, 1400);
    });
  });
});

document.querySelectorAll('[data-expires]').forEach(function (element) {
  var at = Number(element.getAttribute('data-expires'));
  function tick() {
    var left = Math.round((at - Date.now()) / 1000);
    if (left <= 0) { element.textContent = 'expired, sign out and back in'; return; }
    var minutes = Math.floor(left / 60);
    element.textContent = minutes > 0
      ? 'in ' + minutes + ' min ' + (left % 60) + ' s'
      : 'in ' + left + ' s';
  }
  tick();
  setInterval(tick, 1000);
});

// n8n's OAuth callback page ends by calling window.close(), which a browser only
// honours for a script-opened window. A full-tab redirect strands the user on
// "Connection successful" with no way back.
document.querySelectorAll('form[data-popup]').forEach(function (form) {
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    fetch('/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(new FormData(form)),
    })
      .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status)); })
      .then(function (data) {
        var popup = window.open(data.url, 'n8n-authorize', 'width=620,height=760');
        if (!popup) { window.location = data.url; return; }
        // Only signal available: once the popup is on the provider's origin we
        // cannot read its location.
        var timer = setInterval(function () {
          if (popup.closed) { clearInterval(timer); window.location.reload(); }
        }, 500);
      })
      .catch(function (error) { alert('Could not start authorization: ' + error.message); });
  });
});
<\/script>`;

const NAV = [
	{ href: '/status', label: 'Credentials' },
	{ href: '/run', label: 'Run workflow' },
	{ href: '/token', label: 'Token' },
];

/**
 * `hideSignIn` is for pages whose own body already offers the sign-in action. Rendering
 * it in the top bar too would put two identical primary buttons on one screen and make
 * the reader choose between them.
 */
export function page({ title, user, body, active, bare, hideSignIn }) {
	const nav = user
		? NAV.map(
				(item) =>
					`<a href="${item.href}"${item.href === active ? ' aria-current="page"' : ''}>${item.label}</a>`,
			).join('')
		: '';

	const session = user
		? `<span class="who" title="${escapeHtml(user)}">${escapeHtml(user)}</span>
       <a class="btn quiet" href="/logout">Sign out</a>`
		: hideSignIn
			? ''
			: `<a class="btn primary" href="/login">${logo('okta')}Sign in with Okta</a>`;

	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} - End-user credentials</title>
<link rel="icon" href="/logo/n8n.png">
<style>${STYLE}</style></head>
<body>
<header class="topbar">
  <div class="bar">
    <span class="brand"><a href="/">${logo('n8n')}End-user credentials</a></span>
    <nav>${nav}</nav>
    <div class="session">${session}</div>
  </div>
</header>
<main>${bare ? '' : `<h1>${escapeHtml(title)}</h1>`}${body}</main>
${SCRIPT}
</body></html>`;
}
