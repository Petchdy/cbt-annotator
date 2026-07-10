import { api, state, navigate } from '../app.js';
import {
  CLASS_COLORS, CLASS_SHAPES, NODE_CLASSES, CLASS_PROPS, CAPTION_FIELD,
  EDGE_RULES, outgoingRelations, ORPHAN_OK,
} from '../ontology.js';

export async function renderLabeler(root, sessionId) {
  // ── Load session ──────────────────────────────────────────────────────────
  let data;
  try { data = await api.get(`/api/sessions/${sessionId}`); }
  catch (e) {
    root.innerHTML = `<div class="login-wrap"><div class="login-card">
      <h1>Could not open session</h1><p>${e.message}</p>
      <button class="primary" id="back">Back to list</button></div></div>`;
    root.querySelector('#back').onclick = () => navigate({ name: 'list' });
    return;
  }

  // ── Local editable model ──────────────────────────────────────────────────
  // nodes/edges stay in the exact Neo4j-import shape. Canvas positions live in
  // ui_state and are merged in for rendering only.
  const model = {
    nodes: (data.annotation?.nodes || []).map(n => ({ ...n })),
    edges: (data.annotation?.edges || []).map(e => ({ ...e })),
  };
  const ui = data.ui_state || { canvasPositions: {}, view: { panX: 40, panY: 20, scale: 1 } };
  ui.canvasPositions = ui.canvasPositions || {};
  ui.view = ui.view || { panX: 40, panY: 20, scale: 1 };
  let status = data.status;

  // ensure every node has a stable id and a position
  let idCounter = Date.now();
  for (const n of model.nodes) {
    if (!n.id) n.id = 'n' + (idCounter++);
    if (!ui.canvasPositions[n.id]) ui.canvasPositions[n.id] = { x: 200, y: 200 };
  }
  for (const e of model.edges) { if (!e._eid) e._eid = 'e' + (idCounter++); }

  // ── View state ────────────────────────────────────────────────────────────
  let selected = null;      // node id
  let panelMode = 'coverage';
  let evidenceMode = false;
  let linking = null;       // { fromId, type, toClasses, edgeProps } while choosing a target
  let dirty = false;
  const markDirty = () => { dirty = true; updateSaveState(); };

  // ── Shell ─────────────────────────────────────────────────────────────────
  const el = document.createElement('div');
  el.className = 'labeler';
  el.innerHTML = `
    <div class="topbar">
      <button id="back">← Back</button>
      <span class="brand">${data.title}</span>
      <span class="spacer"></span>
      <label style="margin:0">Status</label>
      <select id="status" style="width:auto">
        ${['not started','in progress','done'].map(s =>
          `<option ${status === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
      <span id="savestate" class="muted">Saved</span>
      <button id="export">Export</button>
      <button class="primary" id="save">Save</button>
    </div>
    <div class="labeler-body">
      <div class="panel-left">
        <div class="panel-head">Transcript</div>
        <div class="transcript-scroll" id="transcript"></div>
      </div>
      <div class="resize-handle" id="leftresize" title="Resize transcript panel"></div>
      <div class="viewport" id="viewport">
        <div class="world" id="world">
          <svg class="edge-svg" id="edgesvg"></svg>
          <div id="canvas" style="position:relative"></div>
        </div>
        <div class="hint-banner" id="hint" style="display:none"></div>
        <div class="canvas-tools">
          <button id="addnode">+ New node</button>
        </div>
        <div class="zoom-tools">
          <button id="zoomout">−</button>
          <span class="zoom-label" id="zoomlabel">100%</span>
          <button id="zoomin">+</button>
        </div>
      </div>
      <div class="panel-right">
        <div class="panel-head" id="panelhead">Coverage</div>
        <div class="panel-scroll" id="panelbody"></div>
      </div>
    </div>`;
  root.appendChild(el);

  const q = (s) => el.querySelector(s);
  const viewport = q('#viewport');
  const world = q('#world');
  const canvas = q('#canvas');
  const svg = q('#edgesvg');
  const leftPanel = q('.panel-left');
  const leftResize = q('#leftresize');

  const savedLeftWidth = Number(localStorage.getItem('cbt:leftPanelWidth'));
  if (Number.isFinite(savedLeftWidth)) {
    leftPanel.style.width = `${Math.min(520, Math.max(160, savedLeftWidth))}px`;
  }
  leftResize.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = leftPanel.getBoundingClientRect().width;
    document.body.classList.add('resizing-panel');
    const move = (ev) => {
      const next = Math.min(520, Math.max(160, startWidth + ev.clientX - startX));
      leftPanel.style.width = `${Math.round(next)}px`;
    };
    const up = () => {
      document.body.classList.remove('resizing-panel');
      localStorage.setItem('cbt:leftPanelWidth', String(Math.round(leftPanel.getBoundingClientRect().width)));
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });

  // ── Save / dirty ──────────────────────────────────────────────────────────
  function updateSaveState() {
    const ss = q('#savestate');
    ss.textContent = dirty ? 'Unsaved changes' : 'Saved';
    ss.style.color = dirty ? 'var(--warning)' : 'var(--text-muted)';
  }
  async function save() {
    // strip UI-only helper fields (_eid) before persisting the graph
    const cleanEdges = model.edges.map(({ _eid, ...rest }) => rest);
    await api.put(`/api/sessions/${sessionId}`, {
      annotation: { nodes: model.nodes, edges: cleanEdges },
      ui_state: ui,
      status,
    });
    dirty = false; updateSaveState();
  }
  q('#save').onclick = () => save().catch(e => alert('Save failed: ' + e.message));
  q('#status').onchange = (e) => { status = e.target.value; markDirty(); };
  q('#export').onclick = () => {
    const cleanEdges = model.edges.map(({ _eid, ...rest }) => rest);
    const blob = new Blob([JSON.stringify({ nodes: model.nodes, edges: cleanEdges }, null, 2)],
      { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${sessionId}_annotation.json`; a.click();
    URL.revokeObjectURL(url);
  };
  q('#back').onclick = () => {
    if (dirty) {
      confirmLeave(root, () => save().then(() => navigate({ name: 'list' })),
        () => navigate({ name: 'list' }));
    } else navigate({ name: 'list' });
  };
  window.addEventListener('beforeunload', (ev) => {
    if (dirty) { ev.preventDefault(); ev.returnValue = ''; }
  });

  // ── Pan / zoom ────────────────────────────────────────────────────────────
  function applyTransform() {
    world.style.transform = `translate(${ui.view.panX}px,${ui.view.panY}px) scale(${ui.view.scale})`;
    q('#zoomlabel').textContent = Math.round(ui.view.scale * 100) + '%';
  }
  q('#zoomin').onclick = () => { ui.view.scale = Math.min(2, ui.view.scale + 0.15); applyTransform(); markDirty(); };
  q('#zoomout').onclick = () => { ui.view.scale = Math.max(0.4, ui.view.scale - 0.15); applyTransform(); markDirty(); };
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    ui.view.scale = Math.min(2, Math.max(0.4, ui.view.scale - e.deltaY * 0.001));
    applyTransform();
  }, { passive: false });
  let panning = false, psx, psy, ppx, ppy;
  viewport.addEventListener('mousedown', (e) => {
    if (e.target !== viewport && e.target !== world && e.target !== canvas && e.target !== svg) return;
    if (linking) return; // clicking empty space cancels link below
    panning = true; psx = e.clientX; psy = e.clientY; ppx = ui.view.panX; ppy = ui.view.panY;
    viewport.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', (e) => {
    if (panning) { ui.view.panX = ppx + (e.clientX - psx); ui.view.panY = ppy + (e.clientY - psy); applyTransform(); }
  });
  window.addEventListener('mouseup', () => { panning = false; viewport.style.cursor = 'grab'; });

  // clicking empty canvas cancels an in-progress link or deselects
  viewport.addEventListener('click', (e) => {
    if (e.target === viewport || e.target === world || e.target === canvas || e.target === svg) {
      if (linking) { linking = null; updateHint(); renderCanvas(); }
      else if (selected) { selected = null; panelMode = 'coverage'; renderAll(); }
    }
  });

  // ── Shapes ────────────────────────────────────────────────────────────────
  function badge(shape, hex) {
    const c = `width="13" height="13" viewBox="0 0 14 14"`;
    if (shape === 'circle') return `<svg ${c}><circle cx="7" cy="7" r="6" fill="${hex}"/></svg>`;
    if (shape === 'hex') return `<svg ${c}><polygon points="7,0 13,3.5 13,10.5 7,14 1,10.5 1,3.5" fill="${hex}"/></svg>`;
    if (shape === 'diamond') return `<svg ${c}><polygon points="7,0 14,7 7,14 0,7" fill="${hex}"/></svg>`;
    if (shape === 'triangle') return `<svg ${c}><polygon points="7,0 14,13 0,13" fill="${hex}"/></svg>`;
    return `<svg ${c}><rect x="1" y="1" width="12" height="12" rx="2" fill="${hex}"/></svg>`;
  }

  function caption(n) {
    const f = CAPTION_FIELD[n.label];
    return (n.properties && n.properties[f]) || `(new ${n.label})`;
  }

  // ── Transcript ────────────────────────────────────────────────────────────
  function renderTranscript() {
    const host = q('#transcript');
    const active = (panelMode === 'inspector' && selected)
      ? (model.nodes.find(n => n.id === selected)?.evidence || []) : [];
    host.innerHTML = data.transcript.map((t, i) => {
      const turn = i + 1;
      const isEv = active.includes(turn);
      return `<div class="turn ${isEv ? 'evidence' : ''} ${evidenceMode ? 'clickable' : ''}" data-turn="${turn}">
        <div class="meta">turn ${turn} · ${t.speaker}</div>
        <div class="text">${escapeHtml(t.text)}</div>
      </div>`;
    }).join('');
    if (evidenceMode && selected) {
      host.querySelectorAll('.turn').forEach(row => {
        row.onclick = () => {
          const n = model.nodes.find(x => x.id === selected);
          const turn = +row.dataset.turn;
          n.evidence = n.evidence || [];
          const idx = n.evidence.indexOf(turn);
          if (idx > -1) n.evidence.splice(idx, 1); else n.evidence.push(turn);
          n.evidence.sort((a, b) => a - b);
          markDirty(); renderTranscript(); renderInspector();
        };
      });
    }
  }

  // ── Canvas nodes ──────────────────────────────────────────────────────────
  function renderCanvas() {
    canvas.innerHTML = '';
    for (const n of model.nodes) {
      const col = CLASS_COLORS[n.label] || { bg: '#ccc', border: '#999', text: '#000' };
      const pos = ui.canvasPositions[n.id] || { x: 200, y: 200 };
      const d = document.createElement('div');
      d.className = 'node' + (selected === n.id ? ' selected' : '') +
        (linking && linking.toClasses.includes(n.label) && n.id !== linking.fromId ? ' link-target' : '');
      d.style.left = pos.x + 'px'; d.style.top = pos.y + 'px';
      d.style.background = col.bg; d.style.color = col.text; d.style.borderColor = col.border;
      d.innerHTML = `<div class="row" style="gap:5px">${badge(CLASS_SHAPES[n.label], 'rgba(0,0,0,0.35)')}
        <span class="cls">${n.label}</span></div><div class="cap">${escapeHtml(caption(n))}</div>`;

      d.onclick = (e) => {
        e.stopPropagation();
        if (linking) { tryCompleteLink(n); return; }
        selected = n.id; panelMode = 'inspector'; evidenceMode = false; renderAll();
      };
      // drag (zoom-aware)
      let dragging = false, sx, sy, ox, oy, moved = false;
      d.onmousedown = (e) => {
        if (linking) return;
        dragging = true; moved = false; sx = e.clientX; sy = e.clientY;
        ox = pos.x; oy = pos.y; e.stopPropagation(); e.preventDefault();
      };
      const move = (e) => {
        if (!dragging) return;
        pos.x = ox + (e.clientX - sx) / ui.view.scale;
        pos.y = oy + (e.clientY - sy) / ui.view.scale;
        moved = true;
        d.style.left = pos.x + 'px'; d.style.top = pos.y + 'px';
        renderEdges();
      };
      const up = () => {
        if (dragging && moved) { ui.canvasPositions[n.id] = pos; markDirty(); }
        dragging = false;
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
      canvas.appendChild(d);
    }
    requestAnimationFrame(renderEdges);
  }

  function anchor(rect, tx, ty) {
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    const dx = tx - cx, dy = ty - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    const s = Math.min(dx ? (rect.w / 2) / Math.abs(dx) : Infinity,
                       dy ? (rect.h / 2) / Math.abs(dy) : Infinity);
    return { x: cx + dx * s, y: cy + dy * s };
  }

  function renderEdges() {
    const rects = {};
    model.nodes.forEach((n, i) => {
      const child = canvas.children[i];
      const pos = ui.canvasPositions[n.id];
      if (child && pos) rects[n.id] = { x: pos.x, y: pos.y, w: child.offsetWidth, h: child.offsetHeight };
    });
    let out = `<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
      <path d="M0,0 L7,3 L0,6 Z" fill="var(--text-muted)"/></marker></defs>`;
    for (const e of model.edges) {
      const ra = rects[e.from], rb = rects[e.to];
      if (!ra || !rb) continue;
      const ca = { x: ra.x + ra.w / 2, y: ra.y + ra.h / 2 };
      const cb = { x: rb.x + rb.w / 2, y: rb.y + rb.h / 2 };
      const p1 = anchor(ra, cb.x, cb.y), p2 = anchor(rb, ca.x, ca.y);
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      const w = e.type.length * 6 + 8;
      out += `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}"
        stroke="var(--text-muted)" stroke-width="1.5" marker-end="url(#arrow)"/>
        <rect x="${mx - w/2}" y="${my - 8}" width="${w}" height="14" rx="3"
          fill="var(--surface-0)" opacity="0.9"/>
        <text x="${mx}" y="${my + 3}" font-size="10" fill="var(--text-secondary)"
          text-anchor="middle">${e.type}</text>`;
    }
    svg.innerHTML = out;
  }

  // ── Linking (add edge) ────────────────────────────────────────────────────
  function startLink(fromId, rel) {
    linking = { fromId, type: rel.type, toClasses: rel.to, edgeProps: rel.edgeProps };
    updateHint(); renderCanvas();
  }
  function tryCompleteLink(targetNode) {
    if (targetNode.id === linking.fromId) return;
    if (!linking.toClasses.includes(targetNode.label)) return; // illegal target ignored
    const edge = { _eid: 'e' + (idCounter++), type: linking.type, from: linking.fromId, to: targetNode.id, evidence: [] };
    if (linking.edgeProps && linking.edgeProps.length) edge.properties = {};
    model.edges.push(edge);
    linking = null; updateHint(); markDirty(); renderAll();
  }
  function updateHint() {
    const hint = q('#hint');
    if (linking) {
      hint.style.display = 'block';
      hint.textContent = `Click a ${linking.toClasses.join(' or ')} to link “${linking.type}” (click empty space to cancel)`;
    } else if (evidenceMode) {
      hint.style.display = 'block';
      hint.textContent = 'Click a turn on the left to add/remove it as evidence';
    } else {
      hint.style.display = 'none';
    }
  }

  // ── New node ──────────────────────────────────────────────────────────────
  q('#addnode').onclick = (e) => {
    e.stopPropagation();
    closeMenus();
    const menu = document.createElement('div');
    menu.className = 'dropdown';
    menu.style.left = '12px'; menu.style.bottom = '44px'; menu.style.position = 'absolute';
    menu.innerHTML = NODE_CLASSES.map(c =>
      `<div class="item" data-c="${c}">${badge(CLASS_SHAPES[c], CLASS_COLORS[c].bg)} ${c}</div>`).join('');
    viewport.appendChild(menu);
    menu.querySelectorAll('.item').forEach(it => {
      it.onclick = (ev) => {
        ev.stopPropagation();
        const cls = it.dataset.c;
        const id = 'n' + (idCounter++);
        // spawn near current viewport centre
        const cx = (-ui.view.panX + viewport.clientWidth / 2) / ui.view.scale - 75;
        const cy = (-ui.view.panY + viewport.clientHeight / 2) / ui.view.scale - 20;
        model.nodes.push({ id, label: cls, parent: sessionId, properties: {}, evidence: [] });
        ui.canvasPositions[id] = { x: Math.round(cx), y: Math.round(cy) };
        selected = id; panelMode = 'inspector'; menu.remove(); markDirty(); renderAll();
      };
    });
    document.addEventListener('click', closeMenus, { once: true });
  };
  function closeMenus() { viewport.querySelectorAll('.dropdown').forEach(m => m.remove()); }

  // ── Inspector / coverage panel ────────────────────────────────────────────
  function renderInspector() {
    const head = q('#panelhead');
    const body = q('#panelbody');
    if (panelMode === 'inspector' && selected) {
      const n = model.nodes.find(x => x.id === selected);
      if (!n) { panelMode = 'coverage'; selected = null; return renderInspector(); }
      head.innerHTML = `<span class="row" style="gap:8px">
          <button class="icon-btn" id="pback">←</button>${n.label}</span>
        <button class="icon-btn danger" id="delnode" title="Delete node">🗑</button>`;

      const props = CLASS_PROPS[n.label] || [];
      n.properties = n.properties || {};
      let fieldsHtml = props.map(f => {
        if (f.showIf && n.properties[f.showIf.key] !== f.showIf.equals) return '';
        return `<div class="field-block">${propControl(f, n.properties[f.key])}</div>`;
      }).join('');

      // existing edges touching this node
      const touching = model.edges.filter(e => e.from === n.id || e.to === n.id);
      const edgesHtml = touching.length ? touching.map(e => {
        const other = model.nodes.find(x => x.id === (e.from === n.id ? e.to : e.from));
        const dir = e.from === n.id ? '→' : '←';
        return `<div class="edge-item">
          <span>${dir} ${e.type} ${dir} ${escapeHtml(other ? caption(other) : '?')}</span>
          <button class="icon-btn deledge" data-eid="${e._eid}" title="Delete edge">✕</button>
        </div>`;
      }).join('') : '<div class="muted" style="font-size:11px">none</div>';

      const rels = outgoingRelations(n.label);
      const addHtml = rels.length ? rels.map(r =>
        `<button class="addrel small" data-type="${r.type}" style="width:100%;text-align:left;margin-bottom:4px">
          ${r.type} → ${r.to.join(' / ')}</button>`).join('')
        : '<div class="muted" style="font-size:11px">no outgoing relations for this class</div>';

      body.innerHTML = `
        ${fieldsHtml}
        <div class="section">
          <div class="row" style="justify-content:space-between;margin-bottom:4px">
            <label style="margin:0">Grounded turns (evidence)</label>
            <button class="small" id="evtoggle">${evidenceMode ? 'Done' : 'Edit'}</button>
          </div>
          <div class="row" style="flex-wrap:wrap;gap:4px">
            ${(n.evidence && n.evidence.length)
              ? n.evidence.map(t => `<span class="chip">turn ${t}</span>`).join('')
              : '<span class="muted" style="font-size:11px">none yet</span>'}
          </div>
        </div>
        <div class="section">
          <label>Edges</label>
          <div style="margin-top:4px">${edgesHtml}</div>
        </div>
        <div class="section">
          <label>Add edge</label>
          <div style="margin-top:6px">${addHtml}</div>
        </div>`;

      // wire property controls
      props.forEach(f => {
        const input = body.querySelector(`[data-prop="${f.key}"]`);
        if (!input) return;
        input.onchange = () => {
          if (f.kind === 'bool') n.properties[f.key] = input.checked;
          else n.properties[f.key] = input.value;
          markDirty();
          renderCanvas();       // caption may change
          renderInspector();    // conditional fields may appear/disappear
        };
        if (f.kind === 'text') input.oninput = () => { n.properties[f.key] = input.value; markDirty(); };
      });

      q('#pback').onclick = () => { selected = null; panelMode = 'coverage'; evidenceMode = false; renderAll(); };
      q('#delnode').onclick = () => {
        model.edges = model.edges.filter(e => e.from !== n.id && e.to !== n.id);
        model.nodes = model.nodes.filter(x => x.id !== n.id);
        delete ui.canvasPositions[n.id];
        selected = null; panelMode = 'coverage'; markDirty(); renderAll();
      };
      body.querySelector('#evtoggle').onclick = () => { evidenceMode = !evidenceMode; updateHint(); renderAll(); };
      body.querySelectorAll('.deledge').forEach(b => {
        b.onclick = () => { model.edges = model.edges.filter(e => e._eid !== b.dataset.eid); markDirty(); renderAll(); };
      });
      body.querySelectorAll('.addrel').forEach(b => {
        b.onclick = () => {
          const rel = rels.find(r => r.type === b.dataset.type);
          startLink(n.id, rel);
        };
      });
    } else {
      head.textContent = 'Coverage';
      const counts = {};
      NODE_CLASSES.forEach(c => counts[c] = model.nodes.filter(n => n.label === c).length);
      const orphans = model.nodes.filter(n =>
        !ORPHAN_OK.has(n.label) && !model.edges.some(e => e.from === n.id || e.to === n.id));
      // turns with no node grounded to them
      const grounded = new Set();
      model.nodes.forEach(n => (n.evidence || []).forEach(t => grounded.add(t)));
      const unlinked = data.transcript.map((_, i) => i + 1).filter(t => !grounded.has(t));

      body.innerHTML = `
        <div style="margin-bottom:14px">
          ${NODE_CLASSES.map(c => `
            <div class="coverage-row ${counts[c] === 0 ? 'warn' : 'ok'}">
              <span class="lbl">${badge(CLASS_SHAPES[c], CLASS_COLORS[c].bg)} ${c}</span>
              <span style="font-weight:500">${counts[c]}</span>
            </div>`).join('')}
        </div>
        <div class="section">
          <label>Possible orphan nodes</label>
          <div style="margin-top:4px">
            ${orphans.length ? orphans.map(o =>
              `<div class="coverage-row warn" style="cursor:pointer" data-id="${o.id}">
                <span>${o.label}: ${escapeHtml(caption(o))}</span></div>`).join('')
              : '<div class="muted" style="font-size:11px">none</div>'}
          </div>
        </div>
        <div class="section">
          <label>Turns with no grounded node (${unlinked.length})</label>
          <div class="row" style="flex-wrap:wrap;gap:4px;margin-top:4px">
            ${unlinked.length ? unlinked.map(t => `<span class="chip">turn ${t}</span>`).join('')
              : '<span class="muted" style="font-size:11px">all turns covered</span>'}
          </div>
        </div>`;

      body.querySelectorAll('[data-id]').forEach(r => {
        r.onclick = () => { selected = r.dataset.id; panelMode = 'inspector'; renderAll(); };
      });
    }
  }

  function propControl(f, val) {
    if (f.kind === 'bool') {
      return `<label class="row" style="gap:8px;cursor:pointer">
        <input type="checkbox" data-prop="${f.key}" style="width:auto" ${val ? 'checked' : ''}/>
        <span>${f.label}</span></label>`;
    }
    if (f.kind === 'enum') {
      return `<label>${f.label}${f.optional ? ' <span class="muted">(optional)</span>' : ''}</label>
        <select data-prop="${f.key}">
          <option value="">${f.optional ? '— none —' : '— select —'}</option>
          ${f.options.map(o => `<option ${val === o ? 'selected' : ''}>${o}</option>`).join('')}
        </select>`;
    }
    // text
    const long = ['content', 'description', 'statement', 'taskDescription', 'context'].includes(f.key);
    return `<label>${f.label}${f.optional ? ' <span class="muted">(optional)</span>' : ''}</label>` +
      (long
        ? `<textarea data-prop="${f.key}" rows="2">${escapeHtml(val || '')}</textarea>`
        : `<input data-prop="${f.key}" value="${escapeAttr(val || '')}"/>`);
  }

  // ── Render orchestration ──────────────────────────────────────────────────
  function renderAll() {
    renderTranscript();
    renderCanvas();
    renderInspector();
    updateHint();
    applyTransform();
  }
  renderAll();
}

// ── Helpers ───────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
}
function escapeAttr(s) {
  return String(s ?? '').replace(/"/g, '&quot;');
}
function confirmLeave(root, onSave, onDiscard) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Unsaved changes</h3>
      <p>You have edits that haven’t been saved. What would you like to do?</p>
      <div class="modal-actions">
        <button id="lcancel">Cancel</button>
        <button id="ldiscard">Discard</button>
        <button class="primary" id="lsave">Save and leave</button>
      </div>
    </div>`;
  root.appendChild(overlay);
  overlay.querySelector('#lcancel').onclick = () => overlay.remove();
  overlay.querySelector('#ldiscard').onclick = () => { overlay.remove(); onDiscard(); };
  overlay.querySelector('#lsave').onclick = () => { overlay.remove(); onSave(); };
}
