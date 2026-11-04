'use strict';

/*
 * TenantGuard demo page. Talks to the real API only:
 *   POST /auth/demo-login {username, password}  -> {accessToken, username, tenantId, tenantName}
 *   GET  /patients  (Authorization: Bearer <token>)
 * Every status shown is derived from actual responses; nothing is mocked.
 */

// Seeded tenant IDs, used only to label rows and to build the *forged* request.
const TENANTS = {
  '6f1c2a3e-8b4d-4e7f-9a1b-2c3d4e5f6a7b': 'Tenant A',
  '9d8e7f6a-5b4c-4d3e-8f2a-1b0c9d8e7f6a': 'Tenant B',
};
const HTTP_TEXT = { 200: 'OK', 201: 'Created', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 500: 'Internal Server Error', 503: 'Service Unavailable' };

const state = {
  session: null, // {username, tenantId, tenantName, accessToken, expiresAt} — token kept in memory only
  api: 'checking', // checking | up | down
  rls: 'untested', // untested | verified | failed  (from the cross-tenant test in this session)
  view: { mode: 'formatted', open: true },
  last: null,
};
let expiryTimer = null;

/* ---------------------------------------------------------------- helpers */

const $ = (id) => document.getElementById(id);

/** Creates an element. Text is always set via text nodes, never innerHTML. */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

const tenantName = (id) => TENANTS[id] ?? 'Unknown tenant';
const shortId = (id) => `${id.slice(0, 8)}…${id.slice(-4)}`;
const time = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Reads the token's exp claim (not its signature — the server verifies that). */
function tokenExpiry(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? new Date(payload.exp * 1000) : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- components */

/** tone: ok | bad | warn | info | neutral */
function badge(tone, text, withDot = true) {
  return h('span', { class: `badge ${tone}` }, withDot ? h('span', { class: `dot ${tone}` }) : null, text);
}

const ALERT_ICON = { ok: 'check-circle', bad: 'x-circle', warn: 'alert', info: 'info' };
function alertBox(tone, ...content) {
  return h('div', { class: `alert ${tone}` }, icon(ALERT_ICON[tone] ?? 'info'), h('div', {}, ...content));
}

function statCard(el, { iconName, label, value, detail, status }) {
  el.replaceChildren(
    h('div', { class: 'stat-icon' }, icon(iconName)),
    h('div', { class: 'stat-main' },
      h('div', { class: 'stat-label' }, label),
      h('div', { class: 'stat-value' }, value),
      h('p', { class: 'stat-detail' }, detail),
      status),
  );
}

function headerPill(dotId, textId, tone, text) {
  $(dotId).className = `dot ${tone}`;
  $(textId).textContent = text;
}

/** JSON with syntax colouring; every token is inserted as text. */
function highlightJson(text) {
  const frag = document.createDocumentFragment();
  const re = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    frag.append(text.slice(last, m.index));
    const cls = m[1] ? (m[2] ? 'j-key' : 'j-str') : m[3] ? 'j-lit' : 'j-num';
    frag.append(h('span', { class: cls }, m[1] ?? m[0]));
    if (m[2]) frag.append(m[2]);
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

/* ----------------------------------------------------------------- render */

function renderHeader() {
  const s = state.session;
  headerPill('h-tenant-dot', 'h-tenant', s ? 'ok' : 'neutral', s ? `${s.tenantName} · ${s.username}` : 'Not authenticated');
  headerPill('h-api-dot', 'h-api', { checking: 'neutral', up: 'ok', down: 'bad' }[state.api],
    { checking: 'Checking…', up: 'Connected', down: 'Unreachable' }[state.api]);
  headerPill('h-rls-dot', 'h-rls', { untested: 'neutral', verified: 'ok', failed: 'bad' }[state.rls],
    { untested: 'Not tested', verified: 'Verified', failed: 'Leak detected' }[state.rls]);
  $('h-logout').disabled = !s;
}

function renderOverview() {
  const s = state.session;
  statCard($('card-tenant'), {
    iconName: 'building',
    label: 'Active Tenant',
    value: s ? s.tenantName : 'None',
    detail: s ? `User ${s.username} · ID ${shortId(s.tenantId)}` : 'No valid token. Log in to authenticate a tenant.',
    status: s
      ? badge('ok', s.expiresAt ? `Authenticated · token expires ${time(s.expiresAt)}` : 'Authenticated')
      : badge('neutral', 'Not authenticated'),
  });
  statCard($('card-rls'), {
    iconName: 'database',
    label: 'Database Security',
    value: 'Row-Level Security',
    detail: 'ENABLE + FORCE RLS on patients; SELECT, INSERT, UPDATE and DELETE policies keyed on the transaction’s tenant.',
    status: {
      untested: badge('neutral', 'Not tested this session — run Test 2'),
      verified: badge('ok', 'Isolation verified this session'),
      failed: badge('bad', 'Cross-tenant leak detected'),
    }[state.rls],
  });
  statCard($('card-pool'), {
    iconName: 'layers',
    label: 'Connection Pool',
    value: 'Transaction-Scoped Context',
    detail: 'Tenant set with set_config(…, true) inside each request’s transaction and cleared at COMMIT/ROLLBACK, before the connection returns to the pool.',
    // Not observable from the browser: report what backs the claim, not a live status.
    status: badge('info', 'Covered by automated tests', false),
  });
}

function renderAuth(message) {
  const s = state.session;
  $('auth-badge').replaceChildren(s ? badge('ok', 'Authenticated') : badge('neutral', 'Not authenticated'));
  $('logout').disabled = !s;
  $('test-own').disabled = !s;
  $('test-cross').disabled = !s;
  $('console-note').hidden = Boolean(s);
  if (message !== undefined) $('auth-message').replaceChildren(message ?? '');

  const idBox = $('identity');
  idBox.hidden = !s;
  if (s) {
    const row = (k, v, mono) => h('div', { class: 'identity-row' }, h('span', { class: 'k' }, k), h('span', { class: mono ? 'v mono' : 'v' }, v));
    idBox.replaceChildren(
      row('User', s.username),
      row('Tenant', s.tenantName),
      row('Tenant ID', s.tenantId, true),
      row('Access token', s.expiresAt ? `In memory · expires ${time(s.expiresAt)}` : 'In memory'),
    );
  }
}

function renderAll(authMessage) {
  renderHeader();
  renderOverview();
  renderAuth(authMessage);
}

function renderResponse() {
  const r = state.last;
  const box = $('response');
  if (!r) return;

  const statusTone = r.status === null ? 'warn' : r.status >= 200 && r.status < 300 ? 'ok' : 'bad';
  $('response-badge').replaceChildren(
    r.check === true ? badge('ok', 'Expected result') : r.check === false ? badge('bad', 'Security check failed') : badge('warn', 'Inconclusive'),
  );

  const meta = h('dl', { class: 'meta' },
    h('dt', {}, 'Test'), h('dd', {}, r.testName),
    h('dt', {}, 'Authentication'), h('dd', {}, r.auth),
    r.forged ? [h('dt', {}, 'Forged identifiers'), h('dd', {}, h('code', {}, 'X-Tenant-Id'), ' and ', h('code', {}, '?tenant_id='), ` = ${tenantName(r.forged)}`)] : null,
    Array.isArray(r.body) ? [h('dt', {}, 'Records returned'), h('dd', {}, recordSummary(r.body))] : null,
  );

  const rows = Array.isArray(r.body) ? r.body : [];
  const table = rows.length
    ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Patient'), h('th', {}, 'Tenant'), h('th', {}, 'Patient ID'), h('th', {}, 'Created'))),
        h('tbody', {}, rows.map((p) => h('tr', {},
          h('td', {}, p.patientName),
          h('td', {}, h('span', { class: 'tenant-chip' }, h('span', { class: `dot ${p.tenantId === r.ownTenant || !r.ownTenant ? 'info' : 'bad'}` }), tenantName(p.tenantId))),
          h('td', { class: 'mono' }, p.id),
          h('td', { class: 'mono' }, p.createdAt ? new Date(p.createdAt).toLocaleString() : '')))),
      ))
    : null;

  box.replaceChildren(
    h('div', { class: 'resp-line' },
      h('span', { class: 'method' }, 'GET'),
      h('span', { class: 'endpoint' }, r.url),
      r.status === null ? badge('warn', 'No response') : badge(statusTone, `${r.status} ${HTTP_TEXT[r.status] ?? ''}`.trim()),
      h('span', { class: 'elapsed' }, `${r.ms} ms`)),
    alertBox(r.tone, h('strong', {}, r.title), ' ', r.message),
    meta,
    table,
    codeViewer(r),
  );
}

function recordSummary(rows) {
  if (rows.length === 0) return '0 records';
  const counts = {};
  for (const p of rows) counts[tenantName(p.tenantId)] = (counts[tenantName(p.tenantId)] ?? 0) + 1;
  return `${rows.length} record${rows.length === 1 ? '' : 's'} — ${Object.entries(counts).map(([t, n]) => `${n} from ${t}`).join(', ')}`;
}

function codeViewer(r) {
  const { mode, open } = state.view;
  let formatted = r.text;
  if (r.body !== undefined) formatted = JSON.stringify(r.body, null, 2);
  const shown = mode === 'formatted' ? formatted : r.text || '(empty body)';

  const seg = (value, label) => h('button', {
    type: 'button', 'aria-pressed': String(mode === value),
    onclick: () => { state.view.mode = value; state.view.open = true; renderResponse(); },
  }, label);

  return h('div', {},
    h('div', { class: 'code-head' },
      h('span', { class: 'label' }, 'Response body'),
      h('button', {
        type: 'button', class: 'toggle-link', 'aria-expanded': String(open), 'aria-controls': 'code-panel',
        onclick: () => { state.view.open = !state.view.open; renderResponse(); },
      }, open ? 'Collapse' : 'Expand', icon('chevron')),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Body view' }, seg('formatted', 'Formatted'), seg('raw', 'Raw'))),
    open
      ? h('pre', { class: mode === 'raw' ? 'code wrap' : 'code', id: 'code-panel', tabindex: '0' },
          mode === 'formatted' && r.body !== undefined ? highlightJson(shown) : shown)
      : null,
  );
}

/* ------------------------------------------------------------ evaluation */

/** Turns an actual response into a verdict. Nothing here assumes success. */
function evaluate(kind, status, body, own, forged) {
  if (status === null) {
    return { tone: 'warn', title: 'API unreachable.', message: 'The request did not reach the server, so no security conclusion can be drawn.', check: null };
  }
  const rows = Array.isArray(body) ? body : null;
  const foreign = rows ? rows.filter((p) => p.tenantId !== own) : [];

  if (kind === 'anon') {
    if (status === 401) return { tone: 'bad', title: 'Request rejected.', message: 'No valid authentication token was provided. The request was stopped before reaching the database.', check: true };
    if (status === 200) return { tone: 'bad', title: 'Security failure.', message: 'Data was returned without authentication.', check: false };
    return { tone: 'warn', title: `Unexpected response (HTTP ${status}).`, message: 'Expected 401 for an unauthenticated request.', check: null };
  }

  if (status === 401) {
    return { tone: 'warn', title: 'Token rejected.', message: 'The session token is no longer valid (for example, it expired). You have been signed out — log in again.', check: null, expired: true };
  }

  if (kind === 'own') {
    if (status === 200 && rows) {
      if (foreign.length) return { tone: 'bad', title: 'Isolation failure.', message: `${foreign.length} record(s) from another tenant were returned.`, check: false, leak: true };
      if (rows.length === 0) return { tone: 'warn', title: 'Request completed with no records.', message: `No patients exist for ${tenantName(own)}; no other tenant's data was returned.`, check: true };
      return { tone: 'ok', title: 'Request completed.', message: 'Only records belonging to the authenticated tenant were returned.', check: true };
    }
    return { tone: 'bad', title: `Request failed (HTTP ${status}).`, message: 'The API did not return patient records.', check: null };
  }

  // kind === 'cross'
  if (status === 403) return { tone: 'ok', title: 'Access denied.', message: "The authenticated tenant cannot access another tenant's records.", check: true, isolationHeld: true };
  if (status === 200 && rows) {
    if (foreign.length) return { tone: 'bad', title: 'Cross-tenant leak detected.', message: `${foreign.length} record(s) from ${tenantName(forged)} were returned.`, check: false, leak: true };
    return {
      tone: 'ok',
      title: 'Cross-tenant access blocked.',
      message: `The forged ${tenantName(forged)} identifier was ignored; the server used the tenant from the verified token, and only ${tenantName(own)}'s records were returned.`,
      check: true,
      isolationHeld: true,
    };
  }
  return { tone: 'bad', title: `Request failed (HTTP ${status}).`, message: 'No conclusion about isolation can be drawn from this response.', check: null };
}

/* ---------------------------------------------------------------- actions */

const TEST_NAMES = { own: 'Load My Patients', cross: 'Attempt Cross-Tenant Access', anon: 'Request Without Authentication' };

async function runTest(kind) {
  const s = state.session;
  const token = kind === 'anon' ? null : s?.accessToken;
  if (kind !== 'anon' && !token) return;
  const own = s?.tenantId ?? null;
  const forged = kind === 'cross' ? Object.keys(TENANTS).find((id) => id !== own) : null;

  // Same requests as before the redesign: forged ID in both header and query.
  const url = forged ? `/patients?tenant_id=${forged}` : '/patients';
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (forged) headers['X-Tenant-Id'] = forged;

  const button = $(`test-${kind}`);
  button.setAttribute('aria-busy', 'true');
  const started = performance.now();
  let status = null;
  let text = '';
  try {
    const res = await fetch(url, { headers });
    status = res.status;
    text = await res.text();
    state.api = 'up';
  } catch {
    state.api = 'down';
  } finally {
    button.removeAttribute('aria-busy');
  }
  const ms = Math.round(performance.now() - started);

  let body;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = undefined; }

  const verdict = evaluate(kind, status, body, kind === 'anon' ? null : own, forged);
  if (verdict.leak) state.rls = 'failed';
  else if (verdict.isolationHeld && state.rls !== 'failed') state.rls = 'verified';

  state.last = {
    testName: TEST_NAMES[kind],
    url,
    status,
    ms,
    text,
    body,
    forged,
    ownTenant: kind === 'anon' ? null : own,
    auth: token ? `Bearer token — ${s.username} (${s.tenantName})` : 'None — no Authorization header sent',
    ...verdict,
  };
  state.view.mode = 'formatted';
  state.view.open = true;

  if (verdict.expired) signOut(alertBox('warn', 'Your session token was rejected by the server. Please log in again.'));
  else renderAll();
  renderResponse();
}

async function login(event) {
  event.preventDefault();
  const button = $('login');
  const label = button.querySelector('span');
  button.disabled = true;
  button.querySelector('.icon').replaceWith(h('span', { class: 'spinner', 'aria-hidden': 'true' }));
  label.textContent = 'Signing in…';

  try {
    let res;
    try {
      res = await fetch('/auth/demo-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: $('username').value, password: $('password').value }),
      });
      state.api = 'up';
    } catch {
      state.api = 'down';
      clearSession();
      renderAll(alertBox('warn', 'Cannot reach the API. Check that the server is running.'));
      return;
    }

    if (!res.ok) {
      clearSession();
      const msg = res.status === 401
        ? 'Sign-in failed: incorrect user or password.'
        : res.status === 404
          ? 'Demo login is disabled on this server (DEMO_LOGIN_ENABLED is not "true").'
          : `Sign-in failed (HTTP ${res.status}).`;
      renderAll(alertBox('bad', msg));
      return;
    }

    const data = await res.json();
    state.session = {
      username: data.username,
      tenantId: data.tenantId,
      tenantName: data.tenantName,
      accessToken: data.accessToken,
      expiresAt: tokenExpiry(data.accessToken),
    };
    scheduleExpiry();
    $('password').value = '';
    renderAll(alertBox('ok', `Signed in as ${data.username}. Requests now carry a token for ${data.tenantName}.`));
  } finally {
    button.disabled = false;
    button.querySelector('.spinner')?.replaceWith(icon('login'));
    label.textContent = 'Log in';
  }
}

function clearSession() {
  state.session = null;
  clearTimeout(expiryTimer);
}

function signOut(message) {
  clearSession();
  $('password').value = '';
  renderAll(message);
}

/** Drop the session when the token expires so the UI never shows a stale tenant. */
function scheduleExpiry() {
  clearTimeout(expiryTimer);
  const exp = state.session?.expiresAt;
  if (!exp) return;
  expiryTimer = setTimeout(() => signOut(alertBox('warn', 'Your session token expired. Please log in again.')),
    Math.max(0, exp.getTime() - Date.now()));
}

async function checkApi() {
  try {
    const res = await fetch('/demo.js', { method: 'HEAD', cache: 'no-store' });
    state.api = res.ok ? 'up' : 'down';
  } catch {
    state.api = 'down';
  }
  renderHeader();
}

/* ------------------------------------------------------------------ wire */

$('login-form').addEventListener('submit', login);
$('logout').addEventListener('click', () => signOut(alertBox('info', 'Signed out. The access token was discarded.')));
$('h-logout').addEventListener('click', () => signOut(alertBox('info', 'Signed out. The access token was discarded.')));
$('test-own').addEventListener('click', () => runTest('own'));
$('test-cross').addEventListener('click', () => runTest('cross'));
$('test-anon').addEventListener('click', () => runTest('anon'));
$('toggle-password').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  const input = $('password');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.setAttribute('aria-pressed', String(show));
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  btn.replaceChildren(icon(show ? 'eye-off' : 'eye'));
});

renderAll();
checkApi();
