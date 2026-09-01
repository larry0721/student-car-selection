# Semantic Authority Contract

## Purpose

The Advisor has one natural-language authority in its normal conversation
path. When the model provider returns a schema-valid `UnderstandingDraft`, that
draft is the authoritative interpretation of what the user meant. The
recommendation engine remains fully deterministic.

## Authority Boundaries

| Layer | Owns | Must not do |
| --- | --- | --- |
| Model-backed semantic provider | Interpret natural language, ambiguity, emotional goals, practical goals, intent, and clarification candidates | Choose vehicles, construct a `BuyerProfile`, qualify, score, or rank |
| Deterministic semantic provider | Recover obvious, supported meaning only after a recoverable model failure or unavailable model | Compete with a successful model interpretation |
| Runtime schema and ontology validation | Reject malformed fields, unsupported concepts, unsafe recommendation output, and preserve evidence | Change an accepted intent because a heuristic disagrees |
| Canonical normalization | Normalize known entity names and supported value formats | Infer relationship intent from wording after model success |
| Conversation state merger | Apply latest explicit revision, remove conflicting prior state, preserve uncertainty and conflict history | Reinterpret a new user statement with keyword rules when model understanding succeeded |
| Clarification planner | Select one useful question from unresolved supported information | Manufacture a profile value for unanswered information |
| Confirmation and profile conversion | Apply only user-approved, supported canonical destinations | Convert unsupported context into a synthetic score or constraint |
| Recommendation engine | Qualification, scoring, ranking, RecommendationObject, and DecisionReport | Interpret natural-language messages |

## Current Mutation Trace

The pre-consolidation implementation could change a valid model meaning in
three places:

1. `supplementExplicitObjectiveValues()` invoked the deterministic provider
   after a successful model response and could remove/rewrite model values or
   decision-policy instructions.
2. `normalizeRelationshipSets()` inferred intent again from raw text, including
   splitting coordinated phrases and applying global `or`/fallback rules.
3. `answerConversationQuestionWithSemantic()` merged a question-specific regex
   interpretation with the semantic result even when the model succeeded.

The legacy `/api/profile-intake` `ProfilePatch` endpoint is not called by the
current conversation-first Advisor flow. It remains isolated compatibility code
for now and must not be reintroduced into that flow.

## Consolidation Plan

1. Keep strict model output parsing, ontology validation, canonical value
   normalization, state precedence, and the Phase 3.4E polarity resolver.
2. Remove deterministic supplementation from successful model responses.
3. Apply relationship-intent recovery only to deterministic-fallback drafts;
   model intent passes through mapping unchanged.
4. Use question-specific deterministic clarification parsing only when the
   semantic service used fallback or returned no validated model result.
5. Add fixture-model regression tests proving the canonical mapping,
   confirmation draft, and `BuyerProfile` preserve successful model intent.

## Invariants

- A successful model result is never silently strengthened, weakened, reversed,
  or replaced by regex interpretation.
- A recoverable provider failure may use deterministic fallback.
- Explicit user revisions outrank prior values; excluded values cannot remain
  required, preferred, or allowed.
- Unknown, unsupported, and uncertain concepts remain visible as such rather
  than becoming defaults or constraints.
- No semantic component may choose, qualify, score, or rank a vehicle.
