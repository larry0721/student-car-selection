import type { CanonicalVehicleRecord } from "../../../../types/canonicalVehicle";
import {
  getSafetyRatingByVehicleId,
  getSafetyRatingCandidates,
  type NhtsaSafetyCandidate,
  type NhtsaSafetyRecord,
} from "./nhtsa-safety-client";

export const nhtsaSafetyMatchVersion = "1.0.0" as const;
export type NhtsaSafetySourceState = "RATED" | "NOT_RATED" | "NO_MATCH" | "AMBIGUOUS_MATCH" | "SOURCE_FAILURE";

export type NhtsaSafetyIdentity = Readonly<{
  modelYear: number;
  make: string;
  model: string;
  drivetrain: string | null;
  fuelType: string | null;
  bodyStyle: string | null;
}>;

export type NhtsaSafetyCandidateMatch = Readonly<{
  status: "EXACT" | "PROBABLE" | "AMBIGUOUS_MATCH" | "NO_MATCH";
  selectedCandidate: NhtsaSafetyCandidate | null;
  candidates: NhtsaSafetyCandidate[];
  rejectedCandidates: Array<{ vehicleId: number; reasons: string[] }>;
  confidence: number;
  reasons: string[];
}>;

export type NhtsaSafetyIntelligenceResult = Readonly<{
  state: NhtsaSafetySourceState;
  identity: NhtsaSafetyIdentity;
  match: NhtsaSafetyCandidateMatch | null;
  record: NhtsaSafetyRecord | null;
  error: string | null;
}>;

export function getNhtsaSafetyIdentity(cvr: CanonicalVehicleRecord): NhtsaSafetyIdentity {
  const modelYear = cvr.identity.modelYear.value;
  const make = cvr.identity.make.value;
  const model = cvr.identity.model.value;
  if (modelYear === null || !make || !model) throw new Error("NHTSA Safety discovery requires trusted model year, make, and model identity.");
  return {
    modelYear,
    make,
    model: normalizeDiscoveryModel(model),
    drivetrain: cvr.identity.drivetrain.value,
    fuelType: cvr.identity.fuelType.value,
    bodyStyle: cvr.identity.bodyStyle.value,
  };
}

export function matchNhtsaSafetyCandidate(
  identity: NhtsaSafetyIdentity,
  candidates: readonly NhtsaSafetyCandidate[],
): NhtsaSafetyCandidateMatch {
  if (!candidates.length) return { status: "NO_MATCH", selectedCandidate: null, candidates: [], rejectedCandidates: [], confidence: 0, reasons: ["NHTSA returned no safety-rating candidates."] };
  const rejectedCandidates: Array<{ vehicleId: number; reasons: string[] }> = [];
  const compatible = candidates.filter((candidate) => {
    const reasons = getConflicts(identity, candidate);
    if (reasons.length) rejectedCandidates.push({ vehicleId: candidate.vehicleId, reasons });
    return reasons.length === 0;
  });
  if (!compatible.length) {
    return { status: "NO_MATCH", selectedCandidate: null, candidates: [...candidates], rejectedCandidates, confidence: 0, reasons: ["Every candidate conflicts with known configuration evidence."] };
  }
  const scored = compatible.map((candidate) => ({ candidate, score: scoreCandidate(identity, candidate) }))
    .sort((left, right) => right.score - left.score || left.candidate.vehicleId - right.candidate.vehicleId);
  const best = scored[0];
  const tied = scored.filter((item) => item.score === best.score);
  if (tied.length > 1) {
    return { status: "AMBIGUOUS_MATCH", selectedCandidate: null, candidates: [...candidates], rejectedCandidates, confidence: 0, reasons: [`${tied.length} candidates remain equally plausible after configuration matching.`] };
  }
  const exactConfiguration = Boolean(
    (identity.drivetrain && best.candidate.drivetrain === identity.drivetrain)
    || (identity.fuelType === "electric" && best.candidate.powertrainDescription === "electric")
    || (identity.bodyStyle && best.candidate.bodyDescription === identity.bodyStyle),
  );
  return {
    status: exactConfiguration ? "EXACT" : "PROBABLE",
    selectedCandidate: best.candidate,
    candidates: [...candidates],
    rejectedCandidates,
    confidence: exactConfiguration ? 0.98 : compatible.length === 1 ? 0.9 : 0.78,
    reasons: exactConfiguration
      ? ["Known configuration evidence identifies one compatible NHTSA tested vehicle."]
      : ["One candidate remains and no known configuration evidence conflicts."],
  };
}

export async function getNhtsaSafetyIntelligence(
  identity: NhtsaSafetyIdentity,
): Promise<NhtsaSafetyIntelligenceResult> {
  try {
    const candidates = await getSafetyRatingCandidates(identity.modelYear, identity.make, identity.model);
    const match = matchNhtsaSafetyCandidate(identity, candidates);
    if (match.status === "NO_MATCH") return { state: "NO_MATCH", identity, match, record: null, error: null };
    if (match.status === "AMBIGUOUS_MATCH") return { state: "AMBIGUOUS_MATCH", identity, match, record: null, error: null };
    const record = await getSafetyRatingByVehicleId(match.selectedCandidate!.vehicleId);
    return { state: record.ratingState, identity, match, record, error: null };
  } catch (error) {
    return { state: "SOURCE_FAILURE", identity, match: null, record: null, error: error instanceof Error ? error.message : "Unknown NHTSA Safety source failure." };
  }
}

function getConflicts(identity: NhtsaSafetyIdentity, candidate: NhtsaSafetyCandidate) {
  const conflicts: string[] = [];
  if (candidate.modelYear !== identity.modelYear) conflicts.push("model year conflicts");
  if (normalize(identity.make) !== normalize(candidate.make)) conflicts.push("make conflicts");
  if (!modelCompatible(identity.model, candidate.model)) conflicts.push("model conflicts");
  if (identity.drivetrain && candidate.drivetrain && identity.drivetrain !== candidate.drivetrain) conflicts.push(`drivetrain ${candidate.drivetrain} conflicts with ${identity.drivetrain}`);
  if (identity.fuelType === "electric" && candidate.powertrainDescription && candidate.powertrainDescription !== "electric") conflicts.push("powertrain conflicts with electric identity");
  if (identity.fuelType && identity.fuelType !== "electric" && candidate.powertrainDescription === "electric") conflicts.push("electric candidate conflicts with non-electric identity");
  if (identity.bodyStyle && candidate.bodyDescription && identity.bodyStyle !== candidate.bodyDescription) conflicts.push(`body ${candidate.bodyDescription} conflicts with ${identity.bodyStyle}`);
  return conflicts;
}

function scoreCandidate(identity: NhtsaSafetyIdentity, candidate: NhtsaSafetyCandidate) {
  let score = 30;
  if (identity.drivetrain && candidate.drivetrain === identity.drivetrain) score += 40;
  if (identity.fuelType === "electric" && candidate.powertrainDescription === "electric") score += 20;
  if (identity.bodyStyle && candidate.bodyDescription === identity.bodyStyle) score += 10;
  return score;
}

function normalizeDiscoveryModel(model: string) {
  return model.replace(/\s+(?:4WD|AWD|FWD|RWD)$/i, "").trim();
}

function modelCompatible(expected: string, actual: string) {
  const left = normalize(expected);
  const right = normalize(actual);
  return left === right || left.startsWith(`${right}_`) || right.startsWith(`${left}_`);
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
