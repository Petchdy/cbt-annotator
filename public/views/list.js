import { api, state, navigate, logout } from '../app.js';

const STATUS_CLASS = {
  'done': 'status-done',
  'in progress': 'status-inprogress',
  'not started': 'status-notstarted',
};

export async function renderSessionList(root) {
  const isAdmin = state.user.role === 'admin';

  const container = document.createElement('div');
  container.style.cssText = 'flex:1;display:flex;flex-direction:column;min-height:0';
  container.innerHTML = `
    <div class="topbar">
      <span class="brand">CBT KG Annotator</span>
      <span class="pill ${isAdmin ? 'status-inprogress' : 'status-notstarted'}">${state.user.role}</span>
      <span class="muted">${state.user.username}</span>
      <span class="spacer"></span>
      ${isAdmin ? '<button id="addbtn">+ Add session</button>' : ''}
      <button id="logout">Sign out</button>
    </div>
    <div class="list-wrap">
      <div class="list-head">
        <h2>${isAdmin ? 'All sessions' : 'Sessions to label'}</h2>
        <div class="sub" id="summary"></div>
      </div>
      <div class="list-cols" id="cols"></div>
      <div id="rows"></div>
    </div>`;
  root.appendChild(container);

  container.querySelector('#logout').onclick = logout;
  if (isAdmin) container.querySelector('#addbtn').onclick = () => openAddModal(root, refresh);

  const cols = container.querySelector('#cols');
  const rowsEl = container.querySelector('#rows');
  const summary = container.querySelector('#summary');

  const gridCols = isAdmin
    ? 'grid-template-columns:1fr 130px 80px 160px 90px;'
    : 'grid-template-columns:1fr 130px 80px 130px;';
  cols.style.cssText += gridCols;
  cols.innerHTML = isAdmin
    ? '<span>Transcript</span><span>Status</span><span>Length</span><span>Assigned to</span><span></span>'
    : '<span>Transcript</span><span>Status</span><span>Length</span><span>Last edited</span>';

  let experts = [];
  if (isAdmin) { try { experts = await api.get('/api/admin/experts'); } catch {} }

  async function refresh() {
    const sessions = await api.get('/api/sessions');
    const done = sessions.filter(s => s.status === 'done').length;
    const ip = sessions.filter(s => s.status === 'in progress').length;
    const ns = sessions.filter(s => s.status === 'not started').length;
    summary.textContent = `${sessions.length} sessions · ${done} done · ${ip} in progress · ${ns} not started`;

    rowsEl.innerHTML = '';
    for (const s of sessions) {
      const row = document.createElement('div');
      row.className = 'list-row';
      row.style.cssText = gridCols;
      const statusPill = `<span class="pill ${STATUS_CLASS[s.status]}">${s.status}</span>`;
      const updated = new Date(s.updated_at).toLocaleDateString();
      if (isAdmin) {
        row.innerHTML = `
          <span class="row" style="gap:8px">📄 ${s.title}</span>
          <span>${statusPill}</span>
          <span class="muted">${s.turn_count} turns</span>
          <span></span>
          <span></span>`;
        // assignment dropdown
        const assignCell = row.children[3];
        const sel = document.createElement('select');
        sel.innerHTML = `<option value="">— unassigned —</option>` +
          experts.map(e => `<option value="${e}" ${s.assigned_to === e ? 'selected' : ''}>${e}</option>`).join('');
        sel.onclick = (e) => e.stopPropagation();
        sel.onchange = async () => {
          await api.put(`/api/admin/sessions/${s.id}/assign`, { assigned_to: sel.value || null });
        };
        assignCell.appendChild(sel);
        // delete button
        const delCell = row.children[4];
        const del = document.createElement('button');
        del.className = 'danger small';
        del.textContent = 'Remove';
        del.onclick = (e) => {
          e.stopPropagation();
          confirmModal(root, `Remove “${s.title}”?`,
            'This deletes the transcript and any annotations for it.', async () => {
              await api.del(`/api/admin/sessions/${s.id}`);
              refresh();
            });
        };
        delCell.appendChild(del);
      } else {
        row.innerHTML = `
          <span class="row" style="gap:8px">📄 ${s.title}</span>
          <span>${statusPill}</span>
          <span class="muted">${s.turn_count} turns</span>
          <span class="muted">${updated}</span>`;
      }
      row.onclick = () => navigate({ name: 'labeler', id: s.id });
      rowsEl.appendChild(row);
    }
  }

  refresh();
}

// ── Admin: add-session modal (paste or upload transcript JSON) ───────────────
function openAddModal(root, onDone) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="width:420px">
      <h3>Add session</h3>
      <p>Upload or paste a transcript JSON — an array of {speaker, text}.</p>
      <div class="field-block"><label>Session id</label><input id="sid" placeholder="e.g. session_020" /></div>
      <div class="field-block"><label>Title (optional)</label><input id="stitle" /></div>
      <div class="field-block"><label>Transcript file</label><input id="sfile" type="file" accept="application/json,.json" /></div>
      <div class="field-block"><label>…or paste JSON</label><textarea id="sjson" rows="6" placeholder='[{"speaker":"therapist","text":"..."}]'></textarea></div>
      <div class="login-error" id="aerr"></div>
      <div class="modal-actions">
        <button id="acancel">Cancel</button>
        <button class="primary" id="asave">Add</button>
      </div>
    </div>`;
  root.appendChild(overlay);

  const q = (s) => overlay.querySelector(s);
  q('#acancel').onclick = () => overlay.remove();
  q('#sfile').onchange = async (e) => {
    const f = e.target.files[0];
    if (f) {
      q('#sjson').value = await f.text();
      if (!q('#sid').value) q('#sid').value = f.name.replace(/\.json$/i, '');
    }
  };
  q('#asave').onclick = async () => {
    const err = q('#aerr'); err.textContent = '';
    const id = q('#sid').value.trim();
    if (!id) { err.textContent = 'Session id is required.'; return; }
    let transcript;
    try {
      transcript = JSON.parse(q('#sjson').value);
      if (!Array.isArray(transcript)) throw new Error('Must be a JSON array');
      transcript = transcript.map(t => ({ speaker: t.speaker, text: t.text }));
    } catch (e) { err.textContent = 'Invalid JSON: ' + e.message; return; }
    try {
      await api.post('/api/admin/sessions', { id, title: q('#stitle').value.trim() || id, transcript });
      overlay.remove(); onDone();
    } catch (e) { err.textContent = e.message; }
  };
}

export function confirmModal(root, title, msg, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>${title}</h3>
      <p>${msg}</p>
      <div class="modal-actions">
        <button id="cno">Cancel</button>
        <button class="danger" id="cyes">Confirm</button>
      </div>
    </div>`;
  root.appendChild(overlay);
  overlay.querySelector('#cno').onclick = () => overlay.remove();
  overlay.querySelector('#cyes').onclick = async () => { overlay.remove(); await onConfirm(); };
}
