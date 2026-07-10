import { renderLogin } from './views/login.js';
import { renderSessionList } from './views/list.js';
import { renderLabeler } from './views/labeler.js';

// ── Tiny API client ─────────────────────────────────────────────────────────
export const api = {
  async get(url) {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) throw await asError(r);
    return r.json();
  },
  async send(method, url, body) {
    const r = await fetch(url, {
      method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw await asError(r);
    return r.json();
  },
  post(url, body) { return this.send('POST', url, body); },
  put(url, body) { return this.send('PUT', url, body); },
  del(url) { return this.send('DELETE', url); },
};
async function asError(r) {
  let msg = r.statusText;
  try { const j = await r.json(); msg = j.error || msg; } catch {}
  const e = new Error(msg); e.status = r.status; return e;
}

// ── App state + router ──────────────────────────────────────────────────────
export const state = {
  user: null,
  route: { name: 'login' }, // {name:'list'} | {name:'labeler', id}
};

export function navigate(route) {
  state.route = route;
  render();
}

export async function logout() {
  await api.post('/api/logout');
  state.user = null;
  navigate({ name: 'login' });
}

const root = document.getElementById('app');

export function render() {
  root.innerHTML = '';
  if (!state.user) { renderLogin(root); return; }
  if (state.route.name === 'labeler') { renderLabeler(root, state.route.id); return; }
  renderSessionList(root);
}

// ── Boot: check existing session ────────────────────────────────────────────
(async function boot() {
  try {
    state.user = await api.get('/api/me');
    navigate({ name: 'list' });
  } catch {
    navigate({ name: 'login' });
  }
})();
