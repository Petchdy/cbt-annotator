import { api, state, navigate } from '../app.js';

export function renderLogin(root) {
  const wrap = document.createElement('div');
  wrap.className = 'login-wrap';
  wrap.innerHTML = `
    <div class="login-card">
      <h1>CBT KG Annotator</h1>
      <p>Sign in to label therapy transcripts.</p>
      <div class="field"><label>Username</label><input id="u" autocomplete="username" /></div>
      <div class="field"><label>Password</label><input id="p" type="password" autocomplete="current-password" /></div>
      <button class="primary" id="go" style="width:100%">Sign in</button>
      <div class="login-error" id="err"></div>
    </div>`;
  root.appendChild(wrap);

  const u = wrap.querySelector('#u');
  const p = wrap.querySelector('#p');
  const err = wrap.querySelector('#err');
  const go = wrap.querySelector('#go');

  async function submit() {
    err.textContent = '';
    try {
      state.user = await api.post('/api/login', { username: u.value.trim(), password: p.value });
      navigate({ name: 'list' });
    } catch (e) {
      err.textContent = e.message || 'Login failed';
    }
  }
  go.onclick = submit;
  p.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
  u.focus();
}
