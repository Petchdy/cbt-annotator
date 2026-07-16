import { api, state, navigate } from '../app.js';
import {
  CLASS_COLORS, CLASS_SHAPES, NODE_CLASSES, CLASS_PROPS, CAPTION_FIELD,
  EDGE_RULES, outgoingRelations, SUPPORTED_LANGUAGES,
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
  ui.highlights = ui.highlights || {};
  let status = data.status;
  let language = SUPPORTED_LANGUAGES.includes(data.language) ? data.language : 'english';
  let notesText = (Array.isArray(data.notes) ? data.notes : []).join('\n');

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
      <label style="margin:0">Language</label>
      <select id="lang" style="width:auto">
        ${SUPPORTED_LANGUAGES.map(l =>
          `<option value="${l}" ${language === l ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
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
        <div class="panel-head">
          <span>Transcript</span>
          <button class="read-btn" id="readtranscript">Read</button>
        </div>
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
  function notesArray() {
    return notesText.split('\n').map(s => s.trim()).filter(Boolean);
  }
  async function save() {
    // strip UI-only helper fields (_eid) before persisting the graph
    const cleanEdges = model.edges.map(({ _eid, ...rest }) => rest);
    await api.put(`/api/sessions/${sessionId}`, {
      annotation: { nodes: model.nodes.map(normalizeNodeForSave), edges: cleanEdges },
      ui_state: ui,
      status,
      language,
      notes: notesArray(),
    });
    dirty = false; updateSaveState();
  }
  q('#save').onclick = () => save().catch(e => alert('Save failed: ' + e.message));
  q('#readtranscript').onclick = () => openTranscriptModal(root, data.title, data.transcript, {
    highlights: ui.highlights,
    onChange: () => { markDirty(); renderTranscript(); },
  });
  q('#status').onchange = (e) => { status = e.target.value; markDirty(); };
  q('#lang').onchange = (e) => { language = e.target.value; markDirty(); };
  q('#export').onclick = async () => {
    try {
      if (dirty) await save();
    } catch (e) {
      alert('Save failed: ' + e.message);
      return;
    }
    const a = document.createElement('a');
    a.href = `/api/sessions/${sessionId}/export`;
    a.download = `${sessionId}_annotation.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
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

  function propValues(val) {
    if (Array.isArray(val)) return val;
    if (val === undefined || val === null || val === '') return [];
    return [val];
  }

  function propMatchesShowIf(props, showIf) {
    const val = props[showIf.key];
    return Array.isArray(val) ? val.includes(showIf.equals) : val === showIf.equals;
  }

  function normalizeNodeForSave(n) {
    const properties = { ...(n.properties || {}) };
    for (const f of CLASS_PROPS[n.label] || []) {
      if (f.kind === 'multi-enum') properties[f.key] = propValues(properties[f.key]);
    }
    return { ...n, properties };
  }

  // ── Transcript ────────────────────────────────────────────────────────────
  function renderTranscript() {
    const host = q('#transcript');
    const active = (panelMode === 'inspector' && selected)
      ? (model.nodes.find(n => n.id === selected)?.evidence || []) : [];
    host.innerHTML = data.transcript.map((t, i) => {
      const turn = i + 1;
      const isEv = active.includes(turn);
      const ranges = Array.isArray(ui.highlights[turn]) ? ui.highlights[turn] : [];
      return `<div class="turn ${isEv ? 'evidence' : ''} ${evidenceMode ? 'clickable' : ''}" data-turn="${turn}">
        <div class="meta">turn ${turn} · ${t.speaker}</div>
        <div class="text">${renderHighlighted(t.text, ranges, highlightColorFor)}</div>
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
    const dup = model.edges.some(e =>
      e.type === linking.type && e.from === linking.fromId && e.to === targetNode.id);
    if (dup) { linking = null; updateHint(); renderCanvas(); return; }
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
        <button class="delete-node-btn" id="delnode" title="Delete node">Delete</button>`;

      const props = CLASS_PROPS[n.label] || [];
      n.properties = n.properties || {};
      let fieldsHtml = props.map(f => {
        if (f.showIf && !propMatchesShowIf(n.properties, f.showIf)) return '';
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
        if (f.kind === 'multi-enum') return;
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
      body.querySelectorAll('.multi-enum').forEach(box => {
        const key = box.dataset.prop;
        const field = props.find(f => f.key === key);
        const btn = box.querySelector('.multi-enum-button');
        const menu = box.querySelector('.multi-enum-menu');
        const updateLabel = () => {
          const selected = propValues(n.properties[key]);
          btn.textContent = selected.length ? selected.join(', ') : `-- select ${field.label.toLowerCase()} --`;
        };
        btn.onclick = (e) => {
          e.stopPropagation();
          body.querySelectorAll('.multi-enum.open').forEach(other => {
            if (other !== box) other.classList.remove('open');
          });
          box.classList.toggle('open');
        };
        menu.onclick = (e) => e.stopPropagation();
        menu.querySelectorAll('input[type="checkbox"]').forEach(input => {
          input.onchange = (e) => {
            e.stopPropagation();
            n.properties[key] = [...menu.querySelectorAll('input:checked')].map(x => x.value);
            updateLabel();
            markDirty();
            renderCanvas();
          };
        });
        updateLabel();
      });
      document.addEventListener('click', () => {
        body.querySelectorAll('.multi-enum.open').forEach(box => box.classList.remove('open'));
      }, { once: true });

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
        !model.edges.some(e => e.from === n.id || e.to === n.id));
      // turns with no node grounded to them
      const grounded = new Set();
      model.nodes.forEach(n => (n.evidence || []).forEach(t => grounded.add(t)));
      const unlinked = data.transcript.map((_, i) => i + 1).filter(t => !grounded.has(t));

      body.innerHTML = `
        <div class="section">
          <label>Session notes <span class="muted">(one per line)</span></label>
          <textarea id="notes" rows="4" placeholder="Notes about this annotation…">${escapeHtml(notesText)}</textarea>
        </div>
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

      const notesEl = body.querySelector('#notes');
      notesEl.oninput = () => { notesText = notesEl.value; markDirty(); };
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
    if (f.kind === 'multi-enum') {
      const selected = new Set(propValues(val));
      const display = selected.size ? [...selected].join(', ') : `-- select ${f.label.toLowerCase()} --`;
      return `<label>${f.label}${f.optional ? ' <span class="muted">(optional)</span>' : ''}</label>
        <div class="multi-enum" data-prop="${f.key}">
          <button type="button" class="multi-enum-button">${escapeHtml(display)}</button>
          <div class="multi-enum-menu">
            ${f.options.map(o => `<label class="multi-enum-option">
              <input type="checkbox" value="${escapeAttr(o)}" ${selected.has(o) ? 'checked' : ''}/>
              <span>${escapeHtml(o)}</span>
            </label>`).join('')}
          </div>
        </div>`;
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
const HIGHLIGHT_PALETTE = [
  ...NODE_CLASSES.map(c => ({ id: c, label: c, color: CLASS_COLORS[c].bg })),
  { id: 'Review',    label: 'Review',    color: '#BFDBFE' }, // light blue — no class uses blue
  { id: 'Important', label: 'Important', color: '#D1D5DB' }, // grey — no class uses grey
];
const HIGHLIGHT_ERASER = '__eraser__';
const ERASER_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/>
  <path d="M22 21H7"/>
  <path d="m5 11 9 9"/>
</svg>`;
const HIGHLIGHTER_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="m9 11-6 6v3h9l3-3"/>
  <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>
</svg>`;
const highlightColorFor = (id) => HIGHLIGHT_PALETTE.find(p => p.id === id)?.color;

function openTranscriptModal(root, title, transcript, opts = {}) {
  const highlights = opts.highlights || {};
  // migrate any legacy per-turn shape (string) to the new range-array shape
  for (const k of Object.keys(highlights)) {
    if (!Array.isArray(highlights[k])) delete highlights[k];
  }
  const ERASER = HIGHLIGHT_ERASER;
  const palette = HIGHLIGHT_PALETTE;
  const colorFor = highlightColorFor;
  let armed = null; // color id, ERASER, or null

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay transcript-modal-overlay';
  overlay.innerHTML = `
    <div class="transcript-modal" role="dialog" aria-modal="true" aria-label="Transcript read mode">
      <div class="transcript-modal-head">
        <div>
          <h3>${escapeHtml(title)}</h3>
          <div class="muted">${transcript.length} turns</div>
        </div>
        <button id="tclose">Close</button>
      </div>
      <div class="highlight-palette" id="tpalette">
        <span class="highlight-palette-icon" aria-hidden="true">${HIGHLIGHTER_SVG}</span>
        ${palette.map(p => `
          <button class="highlight-swatch" style="background:${p.color}"
            data-id="${escapeAttr(p.id)}" title="${escapeAttr(p.label)}"
            aria-label="${escapeAttr(p.label)}"></button>`).join('')}
        <button class="highlight-swatch hl-eraser" data-id="${ERASER}"
          title="Eraser" aria-label="Eraser">${ERASER_SVG}</button>
      </div>
      <div class="transcript-reader" id="treader">
        ${transcript.map((t, i) => {
          const turn = i + 1;
          const ranges = Array.isArray(highlights[turn]) ? highlights[turn] : [];
          return `<article class="reader-turn" data-turn="${turn}">
            <div class="reader-meta">Turn ${turn} · ${escapeHtml(t.speaker || 'unknown')}</div>
            <p class="hl-text" data-turn="${turn}">${renderHighlighted(t.text || '', ranges, colorFor)}</p>
          </article>`;
        }).join('')}
      </div>
    </div>`;
  root.appendChild(overlay);

  const paletteEl = overlay.querySelector('#tpalette');
  const readerEl  = overlay.querySelector('#treader');

  const paintTurn = (turn) => {
    const el = readerEl.querySelector(`.hl-text[data-turn="${turn}"]`);
    if (!el) return;
    const text = transcript[turn - 1].text || '';
    el.innerHTML = renderHighlighted(text, highlights[turn] || [], colorFor);
  };

  const updateArmedUi = () => {
    paletteEl.querySelectorAll('.highlight-swatch').forEach(s =>
      s.classList.toggle('active', s.dataset.id === armed));
    readerEl.classList.toggle('armed', armed !== null && armed !== ERASER);
    readerEl.classList.toggle('armed-eraser', armed === ERASER);
  };

  const getSelectionInReader = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    const startEl = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer;
    const turnEl = startEl && startEl.closest('.hl-text');
    if (!turnEl) return null;
    if (!turnEl.contains(range.endContainer)) return null; // cross-turn selection ignored
    const before = document.createRange();
    before.setStart(turnEl, 0);
    before.setEnd(range.startContainer, range.startOffset);
    const s = before.toString().length;
    const e = s + range.toString().length;
    if (s === e) return null;
    return { turn: Number(turnEl.dataset.turn), s, e };
  };

  const applyToSelection = (id) => {
    const r = getSelectionInReader();
    if (!r) return false;
    const list = Array.isArray(highlights[r.turn]) ? highlights[r.turn] : [];
    const next = id === ERASER
      ? eraseRange(list, r.s, r.e)
      : addRange(list, { s: r.s, e: r.e, c: id });
    if (next.length) highlights[r.turn] = next;
    else delete highlights[r.turn];
    paintTurn(r.turn);
    window.getSelection().removeAllRanges();
    opts.onChange?.();
    return true;
  };

  paletteEl.querySelectorAll('.highlight-swatch').forEach(sw => {
    // keep the text selection alive while clicking the swatch
    sw.addEventListener('mousedown', (e) => e.preventDefault());
    sw.onclick = () => {
      const id = sw.dataset.id;
      // Eraser never applies to a text selection — click-on-highlight is its only edit path.
      if (id !== ERASER) {
        const applied = applyToSelection(id);
        if (applied) return;
      }
      armed = (armed === id) ? null : id;
      updateArmedUi();
    };
  });

  // Auto-apply on mouseup while armed (color only — eraser is click-on-mark)
  readerEl.addEventListener('mouseup', () => {
    if (!armed || armed === ERASER) return;
    setTimeout(() => applyToSelection(armed), 0);
  });

  // Click an existing highlight → popover (or, with eraser armed, remove the whole range)
  let popover = null;
  const closePopover = () => { if (popover) { popover.remove(); popover = null; } };
  const removeWholeMark = (mark) => {
    const turnEl = mark.closest('.hl-text');
    const turn = Number(turnEl.dataset.turn);
    const s = Number(mark.dataset.s);
    const eOff = Number(mark.dataset.e);
    const list = Array.isArray(highlights[turn]) ? highlights[turn] : [];
    const next = eraseRange(list, s, eOff);
    if (next.length) highlights[turn] = next;
    else delete highlights[turn];
    paintTurn(turn);
    opts.onChange?.();
  };
  readerEl.addEventListener('click', (e) => {
    const mark = e.target.closest('mark.hl');
    if (!mark) return;
    // If there's an active drag selection, let the mouseup handler apply it — skip.
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) return;
    if (armed === ERASER) {
      e.stopPropagation();
      removeWholeMark(mark);
      return;
    }
    if (armed !== null) return; // color painting mode wins
    e.stopPropagation();
    closePopover();
    const turnEl = mark.closest('.hl-text');
    const turn = Number(turnEl.dataset.turn);
    const s = Number(mark.dataset.s);
    const eOff = Number(mark.dataset.e);
    popover = document.createElement('div');
    popover.className = 'hl-popover';
    popover.innerHTML = '<button type="button">Remove highlight</button>';
    document.body.appendChild(popover);
    const rect = mark.getBoundingClientRect();
    const pw = popover.getBoundingClientRect().width;
    const left = Math.min(window.innerWidth - pw - 8, Math.max(8, e.clientX - pw / 2));
    popover.style.left = `${left}px`;
    popover.style.top  = `${rect.bottom + 4}px`;
    popover.querySelector('button').onclick = (ev) => {
      ev.stopPropagation();
      const list = Array.isArray(highlights[turn]) ? highlights[turn] : [];
      const next = eraseRange(list, s, eOff);
      if (next.length) highlights[turn] = next;
      else delete highlights[turn];
      paintTurn(turn);
      closePopover();
      opts.onChange?.();
    };
  });
  document.addEventListener('mousedown', (e) => {
    if (popover && !popover.contains(e.target)) closePopover();
  });

  const close = () => {
    window.removeEventListener('keydown', onKey);
    closePopover();
    overlay.remove();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#tclose').onclick = close;
  window.addEventListener('keydown', onKey);
}

function renderHighlighted(text, ranges, colorFor) {
  if (!ranges || !ranges.length) return escapeHtml(text);
  const sorted = [...ranges].sort((a, b) => a.s - b.s);
  let out = '';
  let cursor = 0;
  for (const r of sorted) {
    if (r.s > cursor) out += escapeHtml(text.slice(cursor, r.s));
    const bg = colorFor(r.c) || '#ffd54f';
    out += `<mark class="hl" data-s="${r.s}" data-e="${r.e}" style="background:${bg}">${escapeHtml(text.slice(r.s, r.e))}</mark>`;
    cursor = r.e;
  }
  if (cursor < text.length) out += escapeHtml(text.slice(cursor));
  return out;
}

function addRange(ranges, add) {
  const out = [];
  for (const r of ranges) {
    if (r.e <= add.s || r.s >= add.e) { out.push(r); continue; }
    if (r.s < add.s) out.push({ ...r, e: add.s });
    if (r.e > add.e) out.push({ ...r, s: add.e });
  }
  out.push(add);
  out.sort((a, b) => a.s - b.s);
  const merged = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && last.c === r.c && last.e === r.s) last.e = r.e;
    else merged.push({ ...r });
  }
  return merged;
}

function eraseRange(ranges, s, e) {
  const out = [];
  for (const r of ranges) {
    if (r.e <= s || r.s >= e) { out.push(r); continue; }
    if (r.s < s) out.push({ ...r, e: s });
    if (r.e > e) out.push({ ...r, s: e });
  }
  return out;
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
