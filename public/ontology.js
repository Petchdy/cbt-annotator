// ─────────────────────────────────────────────────────────────────────────
// CBT KG ontology v4_flat — single source of truth for the annotation UI.
// Node classes, property schemas (with conditional fields), edge rules,
// and Neo4j-style colours (from neo4j_style_v4_flat.grass).
// Fallback-only elements (associatedWith edge) are intentionally excluded.
// ─────────────────────────────────────────────────────────────────────────

// Colours copied from the Neo4j .grass style. AdaptiveResponse given a
// distinct deep-teal so it does not collide with AutomaticThought's mint.
export const CLASS_COLORS = {
  Problem:            { bg: '#F87171', border: '#EF4444', text: '#FFFFFF' },
  Goal:               { bg: '#34D399', border: '#10B981', text: '#1F2937' },
  Intervention:       { bg: '#A78BFA', border: '#8B5CF6', text: '#FFFFFF' },
  Homework:           { bg: '#FBBF24', border: '#F59E0B', text: '#1F2937' },
  CoreBelief:         { bg: '#9D174D', border: '#831843', text: '#FFFFFF' },
  IntermediateBelief: { bg: '#BE185D', border: '#9D174D', text: '#FFFFFF' },
  Situation:          { bg: '#FDE047', border: '#FACC15', text: '#1F2937' },
  AutomaticThought:   { bg: '#6EE7B7', border: '#34D399', text: '#1F2937' },
  Reaction:           { bg: '#FCA5A5', border: '#F87171', text: '#1F2937' },
  AdaptiveResponse:   { bg: '#0D9488', border: '#0F766E', text: '#FFFFFF' },
};

// Redundant shape encoding so classes are distinguishable without colour.
export const CLASS_SHAPES = {
  Problem: 'square', Goal: 'square', Intervention: 'triangle', Homework: 'square',
  CoreBelief: 'hex', IntermediateBelief: 'diamond', Situation: 'circle',
  AutomaticThought: 'triangle', Reaction: 'circle', AdaptiveResponse: 'hex',
};

// The classes the expert labels manually. Session / Client / Utterance are
// attached automatically on import and are NOT in this list.
export const NODE_CLASSES = [
  'Problem', 'Goal', 'Intervention', 'Homework',
  'CoreBelief', 'IntermediateBelief', 'Situation',
  'AutomaticThought', 'Reaction', 'AdaptiveResponse',
];

// Field kinds: 'text' (freeform), 'enum' (dropdown), 'multi-enum' (multi-select dropdown), 'bool' (checkbox).
// `showIf` makes a field conditional on a sibling property value.
// `optional` marks non-required fields.
export const CLASS_PROPS = {
  Problem: [
    { key: 'description', kind: 'text', label: 'Description' },
    { key: 'domain', kind: 'multi-enum', label: 'Domains',
      options: ['academic','work','social','family','financial','health','personal','other'] },
    { key: 'derived', kind: 'bool', label: 'Derived (inferred, not stated)', optional: true },
  ],
  Goal: [
    { key: 'statement', kind: 'text', label: 'Statement' },
  ],
  Intervention: [
    { key: 'description', kind: 'text', label: 'Description' },
    { key: 'technique', kind: 'enum', label: 'Technique', options: [
      'efficiencyEvaluation','alternativePerspective','decatastrophizing',
      'prosAndConsAnalysis','evidenceBasedQuestioning','realityTesting',
      'continuumTechnique','changingRulesToWishes','behaviorExperiment',
      'problemSolvingSkillsTraining','systematicExposure','rolePlaying','other' ] },
    { key: 'techniqueLabel', kind: 'text', label: 'Technique label (free text)',
      optional: true, showIf: { key: 'technique', equals: 'other' } },
  ],
  Homework: [
    { key: 'taskDescription', kind: 'text', label: 'Task description' },
    { key: 'taskType', kind: 'enum', label: 'Task type', options: [
      'thoughtRecord','behavioralExperiment','activityScheduling',
      'copingCard','skillsPractice','reading','other' ] },
    { key: 'isOptional', kind: 'bool', label: 'Optional (therapist framed it so)', optional: true },
  ],
  CoreBelief: [
    { key: 'content', kind: 'text', label: 'Content' },
    { key: 'domain', kind: 'enum', label: 'Domain', options: ['self','world','others'] },
    { key: 'category', kind: 'enum', label: 'Category', optional: true,
      options: ['helpless','unlovable','worthless'],
      showIf: { key: 'domain', equals: 'self' } },
    { key: 'derived', kind: 'bool', label: 'Derived (inferred, not stated)', optional: true },
  ],
  IntermediateBelief: [
    { key: 'content', kind: 'text', label: 'Content' },
    { key: 'subtype', kind: 'enum', label: 'Subtype', options: ['attitude','rule','assumption'] },
    { key: 'derived', kind: 'bool', label: 'Derived (inferred, not stated)', optional: true },
  ],
  Situation: [
    { key: 'description', kind: 'text', label: 'Description (minimal trigger)' },
    { key: 'context', kind: 'text', label: 'Context (elaboration)', optional: true },
    { key: 'kind', kind: 'enum', label: 'Kind (trigger channel)', options: [
      'externalSituation','thoughtStream','image','emotion','behavior','physiological' ] },
    { key: 'temporality', kind: 'enum', label: 'Temporality', optional: true,
      options: ['past','present','anticipated'] },
  ],
  AutomaticThought: [
    { key: 'content', kind: 'text', label: 'Content' },
    { key: 'modality', kind: 'enum', label: 'Modality', options: ['verbal','image'] },
    { key: 'distortionType', kind: 'enum', label: 'Distortion type', optional: true, options: [
      'allOrNothing','catastrophizing','discountingPositive','fortuneTelling',
      'labeling','mentalFiltering','mindReading','overgeneralization',
      'personalization','shouldStatements','none' ] },
  ],
  Reaction: [
    { key: 'content', kind: 'text', label: 'Content' },
    { key: 'channel', kind: 'enum', label: 'Channel', options: ['emotional','behavioral','physiological'] },
    { key: 'valence', kind: 'enum', label: 'Valence', optional: true,
      options: ['positive','negative'],
      showIf: { key: 'channel', equals: 'emotional' } },
  ],
  AdaptiveResponse: [
    { key: 'content', kind: 'text', label: 'Content (balanced response)' },
  ],
};

// The "content" caption field per class — what shows on the node card.
export const CAPTION_FIELD = {
  Problem: 'description', Goal: 'statement', Intervention: 'technique',
  Homework: 'taskDescription', CoreBelief: 'content', IntermediateBelief: 'content',
  Situation: 'description', AutomaticThought: 'content', Reaction: 'content',
  AdaptiveResponse: 'content',
};

// Edge rules: for each relation type, which source class(es) and which
// target class(es) are legal. Fallback-only `associatedWith` is excluded.
// `edgeProps` lists optional properties carried on that relation type.
export const EDGE_RULES = [
  { type: 'givesRiseTo',            from: ['CoreBelief'],         to: ['IntermediateBelief'] },
  { type: 'influencesPerceptionOf', from: ['IntermediateBelief'], to: ['Situation'] },
  { type: 'triggers',              from: ['Situation'],          to: ['AutomaticThought','Reaction'] },
  { type: 'leadsTo',               from: ['AutomaticThought'],   to: ['Reaction'],
    edgeProps: [{ key: 'reportedIntensity', kind: 'text', label: 'Reported intensity', optional: true }] },
  { type: 'leadsTo',               from: ['Reaction'],           to: ['Reaction'] },
  { type: 'stemsFrom',             from: ['AutomaticThought'],   to: ['CoreBelief'] },
  { type: 'reinforces',            from: ['Reaction'],           to: ['CoreBelief'] },
  { type: 'becomesSituation',      from: ['Reaction'],           to: ['Situation'] },
  { type: 'hasAdaptiveResponse',   from: ['AutomaticThought'],   to: ['AdaptiveResponse'] },
  { type: 'manifestsAs',           from: ['Problem'],            to: ['Situation'] },
  { type: 'targetsProblem',        from: ['Goal'],               to: ['Problem'] },
  { type: 'targets',               from: ['Homework'],           to: ['Problem','AutomaticThought','IntermediateBelief','CoreBelief'] },
  { type: 'appliedTo',             from: ['Intervention'],       to: ['AutomaticThought','IntermediateBelief','CoreBelief','Problem'] },
  { type: 'produces',              from: ['Intervention'],       to: ['AdaptiveResponse'] },
];

// Return the legal outgoing relation types for a given source class,
// each with its allowed target classes and any edge properties.
export function outgoingRelations(sourceClass) {
  return EDGE_RULES
    .filter(r => r.from.includes(sourceClass))
    .map(r => ({ type: r.type, to: r.to, edgeProps: r.edgeProps || [] }));
}

// Classes that are legitimately allowed to be orphans (no edges) — used to
// soften the coverage warning. AdaptiveResponse and Reaction can fan off an
// AT that itself may be unanchored; Goal often stands alone early. This is a
// soft nudge, never a hard block.
export const ORPHAN_OK = new Set(['AdaptiveResponse']);
