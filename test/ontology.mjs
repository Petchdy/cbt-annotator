import {
  CLASS_COLORS, CLASS_SHAPES, NODE_CLASSES, CLASS_PROPS, CAPTION_FIELD,
  EDGE_RULES, outgoingRelations,
} from '../public/ontology.js';

let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };

// every manual class has full metadata
for (const c of NODE_CLASSES) {
  check(`${c} has color`, !!CLASS_COLORS[c]);
  check(`${c} has shape`, !!CLASS_SHAPES[c]);
  check(`${c} has props`, Array.isArray(CLASS_PROPS[c]));
  check(`${c} has caption field`, !!CAPTION_FIELD[c]);
  // caption field must be one of the class's own property keys
  const keys = CLASS_PROPS[c].map(p => p.key);
  check(`${c} caption field is a real prop`, keys.includes(CAPTION_FIELD[c]));
}

// conditional fields reference a real sibling key
for (const c of NODE_CLASSES) {
  const keys = new Set(CLASS_PROPS[c].map(p => p.key));
  for (const p of CLASS_PROPS[c]) {
    if (p.showIf) check(`${c}.${p.key} showIf references real key`, keys.has(p.showIf.key));
    if (p.kind === 'enum') check(`${c}.${p.key} enum has options`, Array.isArray(p.options) && p.options.length > 0);
  }
}

// edge rules reference real classes (source + target)
const known = new Set(NODE_CLASSES);
for (const r of EDGE_RULES) {
  for (const f of r.from) check(`edge ${r.type} from ${f} is real class`, known.has(f));
  for (const t of r.to) check(`edge ${r.type} to ${t} is real class`, known.has(t));
}

// spot-check outgoingRelations for a couple of classes
const atRels = outgoingRelations('AutomaticThought').map(r => r.type).sort();
check('AutomaticThought outgoing = leadsTo,stemsFrom,hasAdaptiveResponse',
  JSON.stringify(atRels) === JSON.stringify(['hasAdaptiveResponse', 'leadsTo', 'stemsFrom']));
const sitRels = outgoingRelations('Situation');
check('Situation.triggers targets AT and Reaction',
  sitRels.find(r => r.type === 'triggers').to.sort().join(',') === 'AutomaticThought,Reaction');
const leads = outgoingRelations('AutomaticThought').find(r => r.type === 'leadsTo');
check('leadsTo carries reportedIntensity edge prop',
  leads.edgeProps.some(p => p.key === 'reportedIntensity'));

// associatedWith (fallback) must NOT be present
check('fallback associatedWith excluded',
  !EDGE_RULES.some(r => r.type === 'associatedWith'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
