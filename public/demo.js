'use strict';

// Seeded tenant IDs, used only to build the *forged* request below.
const TENANTS = {
  '6f1c2a3e-8b4d-4e7f-9a1b-2c3d4e5f6a7b': 'Tenant A',
  '9d8e7f6a-5b4c-4d3e-8f2a-1b0c9d8e7f6a': 'Tenant B',
};

// Kept in memory only: a reload logs you out.
let session = null;

const $ = (id) => document.getElementById(id);

function setSession(next) {
  session = next;
  $('who').textContent = '';
  if (session) {
    $('who').append('Logged in as ', bold(session.username), ' — ', bold(session.tenantName), ` (${session.tenantId})`);
  } else {
    $('who').textContent = 'Not logged in.';
  }
  for (const id of ['mine', 'forge', 'logout']) $(id).disabled = !session;
}

function bold(text) {
  const el = document.createElement('strong');
  el.textContent = text;
  return el;
}

async function login() {
  const res = await fetch('/auth/demo-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: $('username').value, password: $('password').value }),
  });
  if (!res.ok) {
    setSession(null);
    $('who').textContent = `Login failed (HTTP ${res.status}). Check the password (DEMO_PASSWORD in .env).`;
    return;
  }
  setSession(await res.json());
  $('result').hidden = true;
}

async function callPatients({ token, forgedTenant }) {
  const url = forgedTenant ? `/patients?tenant_id=${forgedTenant}` : '/patients';
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (forgedTenant) headers['X-Tenant-Id'] = forgedTenant;

  const res = await fetch(url, { headers });
  const body = await res.json().catch(() => null);

  const parts = [`GET ${url}`];
  parts.push(token ? `Authorization: Bearer <${session.username}'s token>` : 'no Authorization header');
  if (forgedTenant) parts.push(`X-Tenant-Id: ${forgedTenant}`);
  render(res.status, body, parts.join('  ·  '), forgedTenant);
}

function render(status, body, requestText, forgedTenant) {
  $('result').hidden = false;
  $('request').textContent = requestText;
  $('status').textContent = `HTTP ${status}`;
  $('status').className = `status ${status === 200 ? 'ok' : 'bad'}`;
  $('raw').textContent = JSON.stringify(body, null, 2);

  const rows = Array.isArray(body) ? body : [];
  $('table').hidden = rows.length === 0;
  $('rows').replaceChildren(
    ...rows.map((p) => {
      const tr = document.createElement('tr');
      for (const [text, mono] of [[p.patientName], [TENANTS[p.tenantId] ?? p.tenantId], [p.id, true]]) {
        const td = document.createElement('td');
        td.textContent = text;
        if (mono) td.className = 'mono';
        tr.append(td);
      }
      return tr;
    }),
  );

  let verdict = '';
  if (status === 401) {
    verdict = 'Rejected: no valid token, so no tenant identity. Nothing reached the database.';
  } else if (status === 200 && forgedTenant) {
    const leaked = rows.some((p) => p.tenantId === forgedTenant);
    verdict = leaked
      ? `LEAK: rows from ${TENANTS[forgedTenant]} were returned.`
      : `The forged ${TENANTS[forgedTenant]} ID in the header and query was ignored — the server used the tenant from your token, and RLS returned only ${session.tenantName}'s ${rows.length} patients.`;
  } else if (status === 200) {
    verdict = `${rows.length} patients — all from ${session.tenantName}. The query has no tenant WHERE clause; PostgreSQL RLS filtered the rows.`;
  }
  $('verdict').textContent = verdict;
}

$('login').addEventListener('click', login);
$('password').addEventListener('keydown', (e) => e.key === 'Enter' && login());
$('logout').addEventListener('click', () => {
  setSession(null);
  $('result').hidden = true;
});
$('mine').addEventListener('click', () => callPatients({ token: session.accessToken }));
$('forge').addEventListener('click', () => {
  const other = Object.keys(TENANTS).find((id) => id !== session.tenantId);
  callPatients({ token: session.accessToken, forgedTenant: other });
});
$('anon').addEventListener('click', () => callPatients({ token: null }));
