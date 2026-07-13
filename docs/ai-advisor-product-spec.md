# AI Advisor Product Specification

Status: foundation planning document

Date: July 12, 2026

This document defines the next product direction for the AI car advisor. It is not an implementation plan and does not authorize rebuilding the current app from scratch. The current website should be improved incrementally unless a specific component is proven too weak to preserve.

## 1. Primary Users

The foundation release must support these user groups:

- First-time car buyers who do not know how to compare vehicles beyond price and appearance.
- Students who need low total ownership cost, reliability, insurance awareness, and practical transportation.
- Parents helping a student or young driver choose a safe first car.
- General used-car buyers who want a clear shortlist without doing hours of research.
- Buyers comparing different priorities such as cash purchase, financing, snow driving, fuel economy, cargo, safety, performance, and resale value.

Acceptance requirements:

- The questionnaire must support budget, monthly payment, ownership-cost, safety, reliability, body-style, drivetrain, climate, mileage, and family-size needs.
- The system must produce recommendations even when a user leaves optional fields unanswered.
- The system must clearly show when no vehicle satisfies all strict requirements.

## 2. User Problems

The product must solve these problems:

- Users cannot easily tell which cars are affordable after insurance, fuel, maintenance, and depreciation.
- Users often compare cars using incomplete or inconsistent data.
- Users do not know which tradeoffs matter most for first ownership.
- Users may overvalue appearance, performance, or a single listing while missing safety, reliability, or cost risks.
- Users need a concise answer first, with a deeper explanation available when they want it.
- Users need to know which information is verified source data and which information is estimated.
- Users need a car-specific explanation, not generic AI advice.

Acceptance requirements:

- Every recommendation must show price, mileage, overall match, estimated monthly ownership cost, and three specific match reasons.
- Every deeper report must show at least affordability, reliability, safety, ownership cost, practicality, first-year ownership cost, source/date, common issues, alternatives, and buying tips.
- Every recommendation must separate source-supplied facts from estimates.

## 3. Product Promise

The product promise is:

The advisor gives a buyer a trustworthy shortlist of cars that fit their budget, lifestyle, and risk tolerance, with clear reasons and tradeoffs, faster than manual research.

The product must be more useful than sending a raw database to a general AI model because:

- It uses structured scoring before AI text generation.
- It applies strict requirement filtering.
- It validates suspicious vehicle data before recommending.
- It calculates ownership cost and buying power.
- It explains ranking decisions with user-specific numbers.
- It labels data sources and estimate boundaries.

Acceptance requirements:

- A recommendation cannot be based only on AI-generated text.
- Vehicle ranking must be reproducible from deterministic data and scoring logic.
- AI-generated summaries must not override strict filters or deterministic scores.

## 4. Product Principles

The foundation release must follow these principles:

- Simple first screen: show only the most important result information first.
- Depth on demand: keep detailed reports behind an expandable area or details page.
- Trust before persuasion: never hide missing data, estimates, or uncertainty.
- Specific over generic: explanations must include user numbers, vehicle numbers, or selected preferences.
- Helpful disagreement: warn when a car is risky, but respect the user's final preference.
- Improve current app first: preserve useful existing components and data flow unless a component blocks the product promise.
- Fast enough for exploration: users should be able to change requirements and rerun search without feeling trapped.
- No false precision: estimates should use realistic ranges or clear labels when exact data is unavailable.

Acceptance requirements:

- The initial recommendation section must show no more than three vehicles before expansion.
- The details view must include the full score breakdown and ownership estimate explanation.
- The UI must not present estimated values as verified listing facts.

## 5. Advisor Personality and Tone

The advisor must act like:

- A car expert who understands models, body styles, drivetrain, reliability, safety, common issues, and ownership realities.
- A research analyst who can compare data sources and explain tradeoffs.
- A financial guide who considers monthly payment room, insurance, fuel, maintenance, depreciation, and first-year cost.
- A personal coach who helps the user make a confident choice without talking down to them.

Tone requirements:

- Concise by default.
- Calm and direct when warning about risk.
- Polite when disagreeing.
- Plain English, not dealership language.
- No hype, pressure, or fake certainty.
- No shaming the user for preferring a car that scores lower.

Acceptance requirements:

- Risk warnings must explain the specific reason for concern.
- Advice must use phrases such as "I would be cautious because..." or "This can still work if..." rather than blunt rejection.
- Recommendation copy must avoid unsupported claims like "best car" unless the data supports the context.

## 6. Core User Journey

The foundation user journey:

1. User lands on the advisor.
2. User enters optional structured preferences.
3. User may add written requirements in plain English.
4. User clicks search.
5. System interprets written requirements into structured filters where possible.
6. System loads or refreshes online/provider overlays when configured.
7. System validates vehicle data.
8. System filters out vehicles that violate strict requirements.
9. System scores remaining vehicles with weighted categories.
10. System shows the top three recommendations.
11. User opens a deeper report for one or more vehicles.
12. User compares selected vehicles side by side.
13. User can adjust preferences or weights and rerun search.
14. If no vehicle matches, system explains the main blockers.

Acceptance requirements:

- Search must have a visible loading state.
- Search must produce either recommendations or a no-match state.
- The no-match state must list likely blockers.
- Compare must work without requiring account login.
- Advanced options must remain separate from the main simple advisor flow.

## 7. Recommendation Result Structure

Each compact recommendation card must include:

- Vehicle year, make, model.
- Body style and drivetrain.
- Price.
- Mileage.
- Overall match score.
- Estimated monthly ownership cost.
- Three main reasons it matches.
- View details action.
- Compare action.

Each deeper report must include:

- Overall match.
- Affordability score.
- Reliability score.
- Safety score.
- Ownership-cost score.
- Practicality score.
- Weighted score breakdown.
- First-year ownership cost breakdown.
- Insurance estimate.
- Maintenance estimate.
- Fuel estimate.
- Depreciation estimate.
- Common issues.
- Pros and cons.
- Similar alternatives.
- Buying tips.
- Data source and data date.
- Clear source-supplied vs estimated-field labels.

Acceptance requirements:

- The compact card must remain understandable without opening details.
- The deeper report must explain enough for a buyer to understand why the vehicle ranked where it did.
- The result structure must support future conversation and feedback without changing the basic scoring contract.

## 8. Explainability Requirements

Every recommendation must answer:

- Why this car was selected.
- Which user requirements it satisfies.
- Which tradeoffs or risks remain.
- Why lower-ranked alternatives scored lower.
- Which facts came from data sources.
- Which values were estimated.

Specific explanation requirements:

- At least three match reasons must include concrete user or vehicle numbers when available.
- Ranking explanations must reference scoring categories, not vague preference language.
- Alternatives must include at least one reason they ranked lower when shown in a deeper report or future comparison report.
- If a car barely passes a requirement, the app must describe it as a close fit, not a perfect fit.
- If a requirement is unknown, the app must avoid pretending the user cared about that dimension.

Acceptance requirements:

- A recommendation explanation must be traceable to profile fields, vehicle fields, score breakdown, or source metadata.
- AI text must not introduce reasons that conflict with deterministic scoring data.
- The system must be able to fall back to deterministic explanations when AI is unavailable.

## 9. Data Trust Requirements

The advisor must clearly distinguish:

- Source-supplied facts.
- User-uploaded data.
- Public API overlays.
- Listing API overlays.
- Heuristic estimates.
- AI-generated explanation text.

Required data trust behavior:

- Display data source and data date for every recommendation.
- Validate vehicles before recommendation.
- Exclude invalid or suspicious records from recommendation results.
- Do not show car photos unless the image is verified to match the recommended year, make, and model or clearly comes from user-uploaded data.
- Show a polished fallback when no verified photo is available.
- Warn when live listing data is unavailable and catalog fallback is being used.
- Never expose API keys or secret environment values in the UI or documentation.

Acceptance requirements:

- Recommendation cards must include source/date in details.
- The validation test must audit year, make, model, body style, drivetrain, price, mileage, MPG, safety score, insurance, and maintenance.
- Provider status must indicate whether optional online listing data is connected.
- Missing provider credentials must not break recommendations.

## 10. Advisor Disagreement Rules

The advisor should disagree politely when a choice appears risky.

The advisor must warn when:

- Vehicle price exceeds buying power.
- Estimated monthly ownership cost exceeds the user's likely room.
- Insurance estimate exceeds the user's insurance budget.
- Mileage exceeds the user's maximum.
- MPG is below the user's minimum.
- Safety score is below high or maximum safety priority.
- Reliability score is below high reliability priority.
- Snow climate is selected but the vehicle is not AWD or 4WD.
- Family size exceeds seating.
- The vehicle has suspicious or invalid data.
- The car is likely a poor first-car fit because of ownership cost, safety, reliability, or practicality.

Disagreement style:

- Explain the risk in one or two sentences.
- Offer a safer alternative or condition for proceeding.
- Let the user keep the preference if they intentionally choose it.

Acceptance requirements:

- The app must not recommend a strict mismatch as a top match unless the user explicitly relaxes that requirement.
- If the user chooses a lower-ranked risky car in a future version, the advisor must explain the risk and still support comparison.
- Disagreement text must include the specific failed dimension.

## 11. Feedback and Adaptive-Learning Vision

Future versions should learn from user feedback without silently changing core scoring in unexplainable ways.

Feedback signals may include:

- User likes a recommendation.
- User dislikes a recommendation.
- User saves a car.
- User removes a car.
- User chooses a lower-ranked car.
- User says a recommendation is too expensive, too boring, too small, too risky, or not their style.
- User asks for more cars like one result.

Adaptive behavior should eventually:

- Adjust future ranking weights for the current user.
- Improve explanation language.
- Remember persistent preferences when the user is logged in.
- Identify repeated mismatches between stated preferences and actual choices.
- Support a Jarvis-style conversational advisor that can ask follow-up questions and refine results.

Acceptance requirements for future adaptive work:

- Feedback must be visible and reversible.
- Learned preferences must be explainable.
- The user must be able to reset learned preferences.
- Personalization must not hide major safety, budget, or reliability risks.

## 12. Privacy Boundaries

The foundation release must protect user trust.

Privacy requirements:

- Do not require login for basic recommendations.
- Do not persist user questionnaire answers unless persistence is explicitly added and disclosed.
- Do not send more data to OpenAI than needed for profile parsing or recommendation explanation.
- Do not send API keys to the browser.
- Do not store uploaded CSV data remotely unless the user explicitly opts into saved profiles/imports in a future release.
- Do not expose secret environment variable values in UI, logs, or docs.

Acceptance requirements:

- The current foundation flow must work without a user account.
- Runtime user data must remain session-local unless a future persistence feature is implemented.
- Any future saved-profile feature must identify what is stored and why.

## 13. Success Metrics

The foundation release should be evaluated by measurable outcomes:

- Recommendation relevance: different user profiles produce meaningfully different top results.
- Match clarity: users can identify why the top car was selected without opening the deeper report.
- Trust clarity: users can tell which fields are facts and which are estimates.
- No-match usefulness: users understand which requirements blocked results.
- Search reliability: search returns recommendations or no-match state without crashing.
- Speed: default search should complete within an acceptable interactive wait on production.
- Responsiveness: advisor, recommendations, details, and compare view work on mobile and desktop.
- Data quality: invalid records are excluded from recommendations.

Acceptance requirements:

- Automated tests must cover very different user profiles and prove rankings change.
- Automated data validation must audit the catalog before recommendations.
- Production smoke testing must cover mobile, desktop, search, details, compare, loading state, and no-match state.

## 14. Features Excluded From The First Foundation Release

The first foundation release must not include:

- Full account system or mandatory login.
- Persistent user history.
- Automatic long-term learning from user behavior.
- Real-time dealership inventory across all markets unless a provider is configured.
- Loan preapproval.
- Insurance quote binding.
- Vehicle purchase checkout.
- Dealer messaging.
- VIN-level inspection reports.
- Guaranteed price accuracy.
- Autonomous AI agent actions that contact sellers or submit forms.
- Full Jarvis-style voice conversation.
- Rebuilding the entire app from scratch.

These exclusions do not block future versions. They keep the foundation release focused on trustworthy recommendation quality.

## 15. Acceptance Criteria For The Foundation Release

The foundation release is acceptable when all of the following are true:

- The app preserves the current working advisor flow unless a specific component is intentionally replaced.
- Users can enter structured preferences and written requirements.
- Written requirements can be converted into structured profile updates with AI or local fallback.
- Users can search and receive either top recommendations or a no-match explanation.
- The first recommendation screen shows only the top three compact vehicle cards.
- Each compact card includes vehicle identity, price, mileage, match score, estimated monthly ownership cost, three reasons, View details, and Compare.
- Each details report includes score breakdown, first-year ownership cost, source/date, source-supplied vs estimated labels, common issues, alternatives, and buying tips.
- Strict mismatches are excluded from recommendations.
- Invalid or suspicious data records are excluded from recommendations.
- Scores respond meaningfully to different profiles.
- AI summaries cannot override deterministic filtering or scoring.
- Provider failures or missing API keys do not crash the advisor.
- The app works without login.
- No secret values are exposed.
- Existing data validation and recommendation tests pass.
- Production build succeeds in the deployment environment.
- Production smoke testing verifies desktop, mobile, search, details, compare, loading, no-match, and provider-fallback behavior.
