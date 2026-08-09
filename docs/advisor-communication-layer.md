# Advisor Communication Layer

## Purpose

The communication layer translates the deterministic decision system into
language a first-time buyer can understand. It never selects a vehicle,
changes a score, reconstructs a profile, or adds evidence. Its sources are:

- the current `BuyerProfile`;
- `RecommendationReadiness`;
- the confirmed preference draft;
- the current `RecommendationDecisionSet`;
- the current `DecisionReport`;
- the winning `RecommendationObject`;
- its effective scoring policy, contribution records, constraints, confidence
  factors, assumptions, estimates, and missing-information records.

`lib/advisorCommunication.ts` is the shared translation boundary.

## Language audit

| Current area | Previous wording | User purpose | Treatment |
| --- | --- | --- | --- |
| Confirmation badges | Used today / Not used directly | Distinguish scoreable from remembered context | Rewritten as Affects the search / Remembered context and moved behind detail review |
| Confirmation certainty | Needs confirmation / unresolved | Show uncertainty | Rewritten as Please review / Still open |
| Confirmation body | Flexible, required, inferred, evidence | Correct individual interpretations | Concise summary is primary; item-level state remains behind disclosure |
| Not-ready confirmation | Disabled Find Cars button | Prevent invalid search | Search action is absent; Answer one more question becomes primary |
| No-match panel | Blockers grid and counts | Explain why no car qualified | One conversational explanation is primary; counts move behind disclosure |
| Recommendation reasons | Score, weight, contribution | Explain why the winner won | Natural reasons are primary; arithmetic moves to Technical details |
| Confidence | Data quality percentage beside recommendation confidence | Explain decision certainty and evidence certainty | Separate natural explanations; exact factors remain technical |
| Candidate pipeline | Candidate and exclusion counts | Audit the search funnel | Technical details only |
| Effective weights | Internal percentages | Reproduce ranking | Technical details only |
| Contribution records | Internal arithmetic | Reproduce score | Technical details only |
| Constraint-only mode | Internal ranking mode | Disclose weak personalization | Rewritten as a fit-based shortlist with a request for another preference |
| Unsupported concepts | Not used directly | Preserve understood intent honestly | “Understood, but the current data cannot score it reliably yet” |
| Out-of-scope vehicle | Unknown term | Explain product scope | Recognized explicitly as outside passenger-car/light-truck scope |

Developer diagnostics remain available through development logging and the
collapsed technical section. Raw object keys and enum values are not primary
product copy.

## Three information layers

### 1. Advisor response

Immediately visible:

- the recommended vehicle;
- one recommendation summary;
- up to three structured reasons;
- the biggest tradeoff;
- one verification caution;
- a concise no-match or not-ready explanation when applicable.

### 2. Decision details

Collapsed by default:

- priorities that influenced the decision;
- hard requirements;
- intentionally ignored dimensions;
- flexible and unresolved items;
- runner-up explanation;
- assumptions and data limitations;
- separate recommendation-confidence and vehicle-data-confidence language.

### 3. Technical transparency

Collapsed by default:

- effective weights;
- exact contribution records;
- candidate and exclusion counts;
- confidence inputs;
- constraints checked;
- field provenance.

## View model

`AdvisorCommunicationViewModel` contains:

- mode: recommendation, constraint-only, or no-match;
- recommendation snapshot vehicle ID;
- advisor headline and summary;
- main reason and up to three reasons;
- main tradeoff and verification note;
- runner-up explanation;
- policy summary;
- separate confidence narratives;
- assumptions and data limitations;
- optional no-match guidance;
- formatted technical details.

`AdvisorConfirmationViewModel` contains the advisor summary, a human policy
summary, and an optional readiness message.

The snapshot vehicle ID must equal the first primary recommendation. Components
do not search for or sort another winner.

## Policy wording

- top: “Safety: top priority.”
- high: “Reliability: important.”
- normal: “Fuel and energy cost: considered normally.”
- deprioritized: “Reliability: considered, but less important than your other
  priorities.”
- disabled: “Fuel and energy cost: not part of this recommendation.”
- unresolved: “I still need to know whether this matters to you.”
- enforced: “SUV: required.”

Numeric multipliers are available only in technical transparency.

## Not-ready behavior

Not-ready confirmation never renders a Find Cars action. It explains that one
useful detail is still needed and offers `Answer one more question`. During
clarification, the advisor asks one question and provides Answer and Skip.
Disabled dimensions are excluded from clarification selection by the existing
policy-aware planner.

## Recommendation behavior

The opening vehicle and reasons come directly from the current
`RecommendationObject`. A reason is eligible only when its contribution record
states that it affected ranking. Disabled categories cannot become visible
winner reasons.

The runner-up is the `DecisionReport.runnerUp`. Its explanation uses the
matching structured runner-up loss record. Primary copy does not expose score
arithmetic.

## Constraint-only behavior

Constraint-only results are described as fit-based shortlists, not decisive
personal winners. The advisor identifies how many cars survived and explains
that another positive preference would improve personalization. Exact
tie-breaking remains technical.

## No-match behavior

The primary message states that no responsible match satisfies every confirmed
requirement. At most one concise blocker explanation leads. Full blocker counts
remain collapsed. The advisor never fabricates an unavailable vehicle.

## Unsupported and out-of-scope behavior

Understood but unsupported concepts remain in confirmation as remembered
context with an explicit disclosure that current data cannot score them.

Motorcycles, scooters, RVs, ATVs, and boats are recognized as outside the
current passenger-car and light-truck scope. They do not trigger a generic car
recommendation.

## Confidence

Recommendation confidence describes whether confirmed priorities support a
decisive winner. Vehicle-data confidence separately describes missing or
estimated evidence. Exact scores and factors remain in technical transparency.

## Follow-up behavior

After a result, the user can describe a change without restarting. The current
profile becomes the base profile, the old recommendation is cleared
immediately, the change passes through semantic interpretation and one
confirmation, and a fresh recommendation snapshot is created. No previous
recommendation explanation remains mounted during the update.

## Prohibited primary language

Primary UX must not expose:

- participation state enums;
- effective or normalized weight terminology;
- contribution arithmetic;
- qualification mode names;
- raw TypeScript fields;
- candidate-pipeline terminology;
- internal confidence factor codes.

## Known limitations

- Unsupported emotional or appearance concepts remain advisory context until
  the catalog gains validated evidence for them.
- Follow-up interpretation still requires one confirmation before recalculation.
- The semantic provider may phrase equivalent policy drafts differently; after
  confirmation, the communication view model is deterministic.
- Technical transparency is formatted for trust and debugging, not for editing
  policies directly.
