# Conversation-First Advisor Flow

This document describes the implemented Phase 2.4 advisor flow. It is a deterministic product flow with structured interpretation and scoring. It does not provide long-term memory, autonomous research, or an unrestricted chatbot.

## User Journey

1. The user starts with a natural-language description of the car they want.
2. `PreferenceInterpretation` extracts concrete facts, soft preferences, uncertainties, and conflicts.
3. The clarification session asks one focused question at a time when an answer would materially improve the recommendation.
4. The user reviews a `ConfirmedPreferenceProfile` and can confirm, change, remove, or adjust required/preferred/flexible status.
5. Confirmed preferences are converted into the existing `BuyerProfile`.
6. The deterministic recommendation engine evaluates the catalog through the existing candidate pipeline and scoring system.
7. Results use `RecommendationObject` and `DecisionReport` data for visible explanations.
8. The user can open fine-tuning controls to adjust the same active `BuyerProfile`.
9. Fine-tune changes remain pending until the user chooses `Update my recommendation`.

## Preference Interpretation

`lib/preferenceInterpretation.ts` maps natural language into structured preference patches. It records evidence phrases and confidence. Interpretation can infer preferences, but it does not directly rank vehicles.

Known limitation: the interpreter is rule-based and intentionally narrow. It handles common first-car language, but not every possible request.

## Clarification Session

`lib/conversationIntake.ts` manages the session state, current question, accumulated interpretation, and conversation turns. The session is local component state only.

The advisor asks one useful question at a time. If the user skips a question, the system preserves known information and discloses remaining uncertainty during confirmation.

## ConfirmedPreferenceProfile

`lib/confirmedPreferenceProfile.ts` creates the user-reviewable preference profile. Each item includes:

- a user-facing label
- value and display value
- evidence phrase
- certainty
- required/preferred/flexible strength
- whether it can be edited or removed

Only confirmed items are converted into active recommendation inputs.

## BuyerProfile Conversion

`lib/confirmedProfileConversion.ts` converts confirmed preferences into the existing `BuyerProfile` schema. Required constraints become explicit filters where the engine already supports them. Soft preferences remain ranking inputs.

Mapping limitations are preserved and shown to the user instead of silently inventing unsupported fields.

## Deterministic Recommendation Engine

`lib/recommendations.ts` remains the source of truth for candidate generation, constraint filtering, suitability scoring, ranking, `RecommendationObject`, and `DecisionReport` creation.

The conversation layer does not choose winners. It only prepares the profile and displays structured outputs from the recommendation engine.

## Fine-Tuning Synchronization

`lib/fineTuneProfile.ts` tracks field source, certainty, and constraint strength for editable fields. Manual edits update the same active `BuyerProfile`; they do not create a separate questionnaire-only path.

Fine-tune edits:

- override earlier inferred values
- become confirmed manual edits
- stay pending until the user updates the recommendation
- preserve the current recommendation while pending
- produce a before/after summary from structured data

## Advisor Explanation Boundary

Visible advisor text must be grounded in structured objects:

- `ConfirmedPreferenceProfile`
- `ConfirmedProfileConversion`
- `BuyerProfile`
- `RecommendationObject`
- `DecisionReport`

No LLM is used to select vehicles or invent ranking explanations in the current release.

## Remaining Limitations

- Live listing photos and market listings require configured external provider access.
- Natural-language interpretation is deterministic and limited to supported patterns.
- Fine-tune text entry is not implemented; fine-tuning is done through structured controls.
- User feedback is not stored for long-term learning.
- There is no Jarvis-style open conversation layer yet.
