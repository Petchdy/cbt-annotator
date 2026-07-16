import {
  TBOX_NODES, TBOX_EDGES,
  SESSION_STRUCTURE_HAS, DERIVED_DEFAULT_FALSE,
} from './ontology.js';

export function buildExportPayload({
  sessionId,
  title,
  transcript,
  annotation,
  assignedTo,
  language,
  notes,
  updatedAt,
}) {
  const turns = Array.isArray(transcript) ? transcript : [];
  const nodesIn = Array.isArray(annotation?.nodes) ? annotation.nodes : [];
  const edgesIn = Array.isArray(annotation?.edges) ? annotation.edges : [];
  const goldNotes = Array.isArray(notes) ? notes : [];

  const speakers = [];
  for (const t of turns) {
    const sp = t?.speaker;
    if (sp && !speakers.includes(sp)) speakers.push(sp);
  }

  const structuralNodes = [
    { id: 'client_1',  label: 'Client',  parent: null, properties: {}, evidence: [] },
    { id: 'session_1', label: 'Session', parent: null, properties: { sessionType: 'therapy' }, evidence: [] },
  ];

  const exportedNodes = nodesIn.map(n => {
    const props = { ...(n.properties || {}) };
    if (DERIVED_DEFAULT_FALSE.has(n.label) && props.derived === undefined) {
      props.derived = false;
    }
    return {
      id: n.id,
      label: n.label,
      parent: null,
      properties: props,
      evidence: Array.isArray(n.evidence) ? n.evidence : [],
    };
  });

  const structuralEdges = [
    { type: 'hasSession', from: 'client_1', to: 'session_1', evidence: [] },
  ];
  for (const n of nodesIn) {
    const rel = SESSION_STRUCTURE_HAS[n.label];
    if (rel) structuralEdges.push({ type: rel, from: 'session_1', to: n.id, evidence: [] });
  }

  const exportedEdges = edgesIn.map(({ _eid, ...rest }) => ({
    type: rest.type,
    from: rest.from,
    to: rest.to,
    evidence: Array.isArray(rest.evidence) ? rest.evidence : [],
    ...(rest.properties ? { properties: rest.properties } : {}),
  }));

  const allNodes = [...structuralNodes, ...exportedNodes];
  const allEdges = [...structuralEdges, ...exportedEdges];

  const byLabel = {};
  for (const n of allNodes) byLabel[n.label] = (byLabel[n.label] || 0) + 1;

  return {
    meta: {
      schema_version: 'ontology_v4_flat',
      session_id: sessionId,
      title,
      language: language || 'english',
      session_type: 'therapy',
      n_turns: turns.length,
      speaker_enum: speakers,
      generated_by: 'CBT annotator (manual)',
      annotated_by: assignedTo || null,
      annotated_at: updatedAt || null,
      exported_at: new Date().toISOString(),
      gold_notes: goldNotes,
    },
    transcript: turns,
    tbox_nodes: TBOX_NODES,
    tbox_edges: TBOX_EDGES,
    nodes: allNodes,
    edges: allEdges,
    summary_counts: {
      nodes_total: allNodes.length,
      by_label: byLabel,
      edges_total: allEdges.length,
    },
  };
}
