import type { CanonicalSemanticIntent } from "./carDomainOntology";

type Mention = {
  canonicalValue?: string;
  evidence: string;
};

const relaxedPattern = /\b(?:not required|not mandatory|isn['’]?t required|is not required|doesn['’]?t have to|does not have to)\b/i;
const excludedPattern = /\b(?:do not want|don['’]?t want|dont want|anything\s+(?:but|except)|neither|avoid|stay away from|exclude|except|no|not)\b/gi;
const requiredPattern = /\b(?:only|must|need|want|looking for|look for|find|show me|has to be|required|non[-\s]?negotiable)\b/gi;
const preferredPattern = /\b(?:maybe|prefer|preferred|would like)\b/gi;
const allowedPattern = /\b(?:acceptable|okay|ok|fine|allowed|if necessary|fallback)\b/gi;

/**
 * Resolves the user's explicit relationship to one mentioned vehicle value.
 * Coordinating commas and conjunctions intentionally remain in one scope.
 */
export function resolveScopedRelationshipIntent(
  message: string,
  mention: Mention,
): CanonicalSemanticIntent | undefined {
  const scope = relationshipScopeForMention(message, mention);
  const mentionIndex = findMentionIndex(scope, mention);
  if (mentionIndex < 0) return undefined;

  const localSuffix = scope.slice(mentionIndex).split(/[,;]/, 1)[0];
  const directSuffix = localSuffix.slice(findMentionLength(scope, mention, mentionIndex));
  const suffixIntent = suffixRelationshipIntent(directSuffix);
  const prefixIntent = latestPrefixIntent(scope.slice(0, mentionIndex));

  if (suffixIntent) {
    const suffixHasCoordinator = /\b(?:and|or|nor)\b/i.test(
      directSuffix.slice(0, firstIntentMarkerIndex(directSuffix)),
    );
    if (!(prefixIntent === "excluded" && suffixHasCoordinator)) return suffixIntent;
  }
  if (prefixIntent) return prefixIntent;

  const wholeScopeIntent = relationshipIntentFromText(scope);
  if (wholeScopeIntent === "excluded" || wholeScopeIntent === "uncertain") return wholeScopeIntent;
  return undefined;
}

export function relationshipScopeForMention(message: string, mention: Mention): string {
  const mentionIndex = findMentionIndex(message, mention);
  if (mentionIndex < 0) return message;
  const boundaries = contrastBoundaries(message);
  const start = boundaries.filter((boundary) => boundary.end <= mentionIndex).at(-1)?.end ?? 0;
  const end = boundaries.find((boundary) => boundary.start > mentionIndex)?.start ?? message.length;
  return message.slice(start, end).trim();
}

export function relationshipIntentFromText(text: string): CanonicalSemanticIntent | undefined {
  if (relaxedPattern.test(text)) return "uncertain";
  const exclusions = markerMatches(text, excludedPattern, "excluded");
  const candidates = [
    ...exclusions,
    ...markerMatches(text, requiredPattern, "required"),
    ...markerMatches(text, preferredPattern, "preferred"),
    ...markerMatches(text, allowedPattern, "allowed"),
  ].filter((candidate) => !(
    candidate.intent === "required"
    && exclusions.some((exclusion) => exclusion.index <= candidate.index && exclusion.end >= candidate.end)
  ));
  return candidates.sort((a, b) => b.index - a.index)[0]?.intent;
}

function suffixRelationshipIntent(text: string): CanonicalSemanticIntent | undefined {
  if (relaxedPattern.test(text)) return "uncertain";
  if (/\b(?:is|are|would be)?\s*(?:a\s+)?deal[-\s]?breakers?\b|\bwon['’]?t consider\b/i.test(text)) {
    return "excluded";
  }
  const allowed = firstMatchIndex(text, allowedPattern);
  const preferred = firstMatchIndex(text, preferredPattern);
  const required = firstMatchIndex(text, requiredPattern);
  if (required >= 0 && (allowed < 0 || required < allowed) && (preferred < 0 || required < preferred)) return "required";
  if (allowed >= 0 && (preferred < 0 || allowed < preferred)) return "allowed";
  if (preferred >= 0) return "preferred";
  return undefined;
}

function latestPrefixIntent(text: string): CanonicalSemanticIntent | undefined {
  if (relaxedPattern.test(text)) return "uncertain";
  return relationshipIntentFromText(text);
}

function firstIntentMarkerIndex(text: string) {
  const indexes = [allowedPattern, preferredPattern, excludedPattern, requiredPattern]
    .map((pattern) => firstMatchIndex(text, pattern))
    .filter((index) => index >= 0);
  return indexes.length ? Math.min(...indexes) : text.length;
}

function markerMatches(
  text: string,
  pattern: RegExp,
  intent: CanonicalSemanticIntent,
) {
  pattern.lastIndex = 0;
  return Array.from(text.matchAll(pattern), (match) => ({
    index: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
    intent,
  }));
}

function firstMatchIndex(text: string, pattern: RegExp) {
  pattern.lastIndex = 0;
  return text.search(pattern);
}

function contrastBoundaries(message: string) {
  const boundaries: Array<{ start: number; end: number }> = [];
  const pattern = /[.;!?]|\b(?:but|however|although|though|yet)\b/gi;
  for (const match of message.matchAll(pattern)) {
    const value = match[0].toLowerCase();
    const prefix = message.slice(Math.max(0, (match.index ?? 0) - 12), match.index ?? 0);
    if (value === "but" && /\b(?:anything|nothing|all)\s*$/i.test(prefix)) continue;
    boundaries.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  return boundaries;
}

function findMentionIndex(text: string, mention: Mention) {
  const canonicalIndex = mention.canonicalValue
    ? text.toLowerCase().indexOf(mention.canonicalValue.toLowerCase())
    : -1;
  if (canonicalIndex >= 0) return canonicalIndex;
  return text.toLowerCase().indexOf(mention.evidence.toLowerCase());
}

function findMentionLength(text: string, mention: Mention, index: number) {
  if (
    mention.canonicalValue
    && text.slice(index, index + mention.canonicalValue.length).toLowerCase() === mention.canonicalValue.toLowerCase()
  ) {
    return mention.canonicalValue.length;
  }
  return mention.evidence.length;
}
