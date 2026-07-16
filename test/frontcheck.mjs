import * as onto from '../public/ontology.js';
const need = ['CLASS_COLORS','CLASS_SHAPES','NODE_CLASSES','CLASS_PROPS','CAPTION_FIELD','EDGE_RULES','outgoingRelations'];
let ok = true;
for (const k of need) { if (!(k in onto)) { console.log('MISSING export:', k); ok = false; } }
for (const c of onto.NODE_CLASSES) {
  const f = onto.CAPTION_FIELD[c];
  const cap = ({}[f]) || `(new ${c})`;
  if (!cap) { console.log('caption failed for', c); ok = false; }
  if (!Array.isArray(onto.outgoingRelations(c))) { console.log('rels not array', c); ok = false; }
}
console.log(ok ? 'FRONTEND MODULE CHECK: PASS' : 'FRONTEND MODULE CHECK: FAIL');
process.exit(ok?0:1);
