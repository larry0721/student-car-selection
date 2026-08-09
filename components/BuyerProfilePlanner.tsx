"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { DataImportPanel } from "@/components/DataImportPanel";
import { VisibleIntelligenceResults } from "@/components/VisibleIntelligenceResults";
import { vehicleCatalog } from "@/data/vehicleCatalog";
import { calculateBudget, formatMoney, formatNumber } from "@/lib/affordability";
import {
  buildAdvisorCommunicationViewModel,
  buildConfirmationCommunicationViewModel,
  getOutOfScopeAdvisorMessage,
  type AdvisorPolicySummary,
} from "@/lib/advisorCommunication";
import { assessCatalogIntentFeasibility } from "@/lib/advisorIntegrity";
import {
  answerConversationQuestion,
  createDeterministicSemanticConversationIntakeSession,
  getConciseUnderstanding,
  getLatestAdvisorTurn,
  prepareConversationRevisionSession,
  requestAnotherConversationQuestion,
  skipConversationQuestion,
  type ConversationIntakeSession,
} from "@/lib/conversationIntake";
import {
  approveConfirmedPreferenceProfile,
  carryForwardConfirmedPreferenceDraft,
  createConfirmedPreferenceProfile,
  hasBlockingConfirmationIssue,
  removePreferenceItem,
  updateConfirmedPreferenceItem,
  type ConfirmationCertainty,
  type ConfirmedPreferenceItem,
  type ConfirmedPreferenceProfile,
  type ConstraintStrength,
} from "@/lib/confirmedPreferenceProfile";
import {
  convertConfirmedPreferencesToBuyerProfile,
  type ConfirmedProfileConversion,
  type ProfileConversionEntry,
} from "@/lib/confirmedProfileConversion";
import { mergeVehicleData } from "@/lib/data/mergeVehicleData";
import {
  createFineTuneMetadataFromConversion,
  getFineTuneFieldLabel,
  getProfileSourceLabel,
  markManualFieldEdit,
  summarizeFineTuneChanges,
  summarizeRecommendationChange,
  type FineTuneFieldMeta,
  type FineTuneMetadata,
} from "@/lib/fineTuneProfile";
import {
  buildDecisionReport,
  defaultScoreWeights,
  getRecommendationDecisionSet,
  getRequirementMatches,
  getVehicleRequirementMisses,
  normalizeScoreWeights,
  rankVehicles,
  scoreWeightLabels,
} from "@/lib/recommendations";
import {
  assessConfirmedPreferenceDraftReadiness,
  assessConfirmedProfileConversionReadiness,
  assessManualProfileReadiness,
} from "@/lib/recommendationReadiness";
import type { BuyerProfile, ScoreWeights } from "@/types/buyer";
import type { DataProviderStatus, VehicleDataOverlay } from "@/types/data";
import type { AiRecommendation, DecisionReport, RecommendationDecisionSet, ScoredVehicle, Vehicle } from "@/types/vehicle";

const defaultProfile: BuyerProfile = {
  maxPurchaseBudget: 18000,
  monthlyBudget: 650,
  downPayment: 2000,
  loanTermMonths: 60,
  apr: 8.5,
  paymentMethod: "not-sure",
  purchaseCondition: "any",
  expectedAnnualMileage: 9000,
  fuelPrice: 4.25,
  insuranceBudget: 145,
  minYear: 2014,
  maxMileage: 110000,
  minMpg: 24,
  fuelEconomyImportance: 3,
  reliabilityImportance: 4,
  performanceImportance: 2,
  cargoNeed: "not-sure",
  familySize: 1,
  drivetrainPreference: "any",
  transmissionPreference: "any",
  bodyStyle: "any",
  climate: "not-sure",
  resaleValueImportance: 3,
  modificationPlans: "not-sure",
  advancedFeaturesImportance: 3,
  safetyPriority: "not-sure",
  scoreWeights: defaultScoreWeights,
};

type NumericField = {
  [Key in keyof BuyerProfile]-?: NonNullable<BuyerProfile[Key]> extends number ? Key : never;
}[keyof BuyerProfile];

type ScoreWeightField = keyof ScoreWeights;
type AppView = "advisor" | "compare" | "advanced";
type AdvisorStage = "describe" | "clarify" | "confirm" | "results" | "fine-tune";

type AdvisorConversationPayload =
  | { action: "start"; message: string }
  | { action: "answer"; answer: string; session: ConversationIntakeSession };

type RecommendationSearchSnapshot = {
  sessionId: string;
  source: "detailed" | "confirmed-profile" | "fine-tune" | "follow-up";
  profile: BuyerProfile;
  rankedVehicles: ScoredVehicle[];
  decisionSet: RecommendationDecisionSet;
  decisionReport: DecisionReport;
  inputFingerprint: string;
  resultFingerprint: string;
};

async function requestAdvisorConversation(payload: AdvisorConversationPayload): Promise<ConversationIntakeSession> {
  const response = await fetch("/api/advisor-conversation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Advisor conversation request failed.");
  const data = await response.json() as { session?: ConversationIntakeSession };
  if (!data.session) throw new Error("Advisor conversation response did not include a session.");
  return data.session;
}

const conversationStarterPrompts = [
  "I want something fun but still reliable.",
  "I need a safe first car under $15,000.",
  "I want something that looks expensive without costing too much.",
  "I drive in snow and need room for my family.",
  "I don’t know much about cars. Help me figure it out.",
];

export function BuyerProfilePlanner() {
  const [activeView, setActiveView] = useState<AppView>("advisor");
  const [profile, setProfile] = useState<BuyerProfile>(defaultProfile);
  const [lastAppliedProfile, setLastAppliedProfile] = useState<BuyerProfile>(defaultProfile);
  const [advisorConfirmedProfile, setAdvisorConfirmedProfile] = useState<BuyerProfile | null>(null);
  const [lastSavedProfile, setLastSavedProfile] = useState<BuyerProfile>(defaultProfile);
  const [, setAiRecommendations] = useState<AiRecommendation[]>([]);
  const [aiStatus, setAiStatus] = useState("Answer a few questions or browse the draft matches.");
  const [isPersonalizing, setIsPersonalizing] = useState(false);
  const [importedOverlays, setImportedOverlays] = useState<VehicleDataOverlay[]>([]);
  const [onlineOverlays, setOnlineOverlays] = useState<VehicleDataOverlay[]>([]);
  const [providerStatus, setProviderStatus] = useState<DataProviderStatus[]>([]);
  const [dataWarnings, setDataWarnings] = useState<string[]>([]);
  const [isLoadingOnlineData, setIsLoadingOnlineData] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [advisorOpeningText, setAdvisorOpeningText] = useState("");
  const [advisorOpeningMessage, setAdvisorOpeningMessage] = useState("");
  const [intakeSession, setIntakeSession] = useState<ConversationIntakeSession | null>(null);
  const [approvedPreferenceProfile, setApprovedPreferenceProfile] = useState<ConfirmedPreferenceProfile | null>(null);
  const [confirmedProfileConversion, setConfirmedProfileConversion] = useState<ConfirmedProfileConversion | null>(null);
  const [isInterpretingPreference, setIsInterpretingPreference] = useState(false);
  const [naturalRequirements, setNaturalRequirements] = useState("");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [hasDetailedSearchRun, setHasDetailedSearchRun] = useState(false);
  const [fineTuneMetadata, setFineTuneMetadata] = useState<FineTuneMetadata>({});
  const [unsavedFineTuneFields, setUnsavedFineTuneFields] = useState<Array<keyof BuyerProfile>>([]);
  const [lastFineTuneSummary, setLastFineTuneSummary] = useState("");
  const [manualConflictNotes, setManualConflictNotes] = useState<string[]>([]);
  const [isFineTuneOpen, setIsFineTuneOpen] = useState(false);
  const [lastProfileUpdateSequence, setLastProfileUpdateSequence] = useState(0);
  const [searchSnapshot, setSearchSnapshot] = useState<RecommendationSearchSnapshot | null>(null);
  const [advisorFollowUpText, setAdvisorFollowUpText] = useState("");
  const [isAdvisorFollowUp, setIsAdvisorFollowUp] = useState(false);
  const searchSequenceRef = useRef(0);
  const resultsRef = useRef<HTMLElement | null>(null);
  const fineTuneRef = useRef<HTMLDetailsElement | null>(null);

  const budget = useMemo(() => calculateBudget(profile), [profile]);
  const emptyDecisionSet = useMemo(() => getRecommendationDecisionSet(defaultProfile, []), []);
  const resultProfile = searchSnapshot?.profile || profile;
  const resultBudget = useMemo(() => calculateBudget(resultProfile), [resultProfile]);
  const enrichedVehicles = useMemo(
    () => mergeVehicleData(vehicleCatalog, [...importedOverlays, ...onlineOverlays]),
    [importedOverlays, onlineOverlays],
  );
  const emptyDecisionReport = useMemo(() => buildDecisionReport(emptyDecisionSet), [emptyDecisionSet]);
  const rankedVehicles = searchSnapshot?.rankedVehicles || [];
  const recommendationDecisionSet = searchSnapshot?.decisionSet || emptyDecisionSet;
  const decisionReport = searchSnapshot?.decisionReport || emptyDecisionReport;
  const normalizedWeights = useMemo(() => normalizeScoreWeights(profile.scoreWeights), [profile.scoreWeights]);
  const comparedVehicles = searchSnapshot ? getComparedVehicles(rankedVehicles, compareIds) : [];
  const hasNoMatch = Boolean(searchSnapshot) && rankedVehicles.length === 0;
  const unsavedSummary = useMemo(() => summarizeFineTuneChanges(unsavedFineTuneFields), [unsavedFineTuneFields]);
  const profileSourceLabel = getProfileSourceLabel({
    hasConversation: Boolean(approvedPreferenceProfile || advisorConfirmedProfile),
    hasManualEdits: Object.values(fineTuneMetadata).some((meta) => meta?.source === "manual-edit"),
  });
  const advisorStage: AdvisorStage = isFineTuneOpen && hasDetailedSearchRun
    ? "fine-tune"
    : hasDetailedSearchRun
      ? "results"
      : intakeSession?.currentQuestion
        ? "clarify"
        : intakeSession
          ? "confirm"
          : "describe";

  function clearCurrentSearchResult(status?: string) {
    setSearchSnapshot(null);
    setHasDetailedSearchRun(false);
    setCompareIds([]);
    setAiRecommendations([]);
    if (status) setAiStatus(status);
  }

  function updateProfile(nextProfile: BuyerProfile) {
    setConfirmedProfileConversion(null);
    setProfile(nextProfile);
    setLastSavedProfile(nextProfile);
    clearCurrentSearchResult("Preferences changed. Confirm or update the recommendation before I show a result.");
  }

  function updateFineTuneProfile(nextProfile: BuyerProfile, field: keyof BuyerProfile, label = getFineTuneFieldLabel(field)) {
    const note = getManualConflictNote(profile, nextProfile, field);
    setProfile(nextProfile);
    setFineTuneMetadata((current) => markManualFieldEdit(current, field, label, getConstraintStrengthForProfileField(nextProfile, field)));
    setUnsavedFineTuneFields((current) => Array.from(new Set([...current, field])));
    if (note) setManualConflictNotes((current) => Array.from(new Set([...current, note])));
    clearCurrentSearchResult("Fine-tuning changed the profile. The previous recommendation was cleared; update when you want me to check the new version.");
  }

  async function applyWrittenRequirements(currentProfile: BuyerProfile) {
    const description = naturalRequirements.trim();
    if (!description) return { profile: currentProfile, summary: "" };

    const response = await fetch("/api/profile-intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description, profile: currentProfile }),
    });
    const payload = (await response.json()) as {
      profile?: BuyerProfile;
      summary?: string;
      warning?: string;
    };

    if (!response.ok || !payload.profile) throw new Error(payload.warning || "Could not understand written requirements.");
    return { profile: payload.profile, summary: payload.summary || "" };
  }

  function updateScoreWeight(field: ScoreWeightField, value: number) {
    updateProfile({
      ...profile,
      scoreWeights: {
        ...profile.scoreWeights,
        [field]: value,
      },
    });
  }

  function resetAdvisor() {
    setAdvisorOpeningText("");
    setAdvisorOpeningMessage("");
    setIntakeSession(null);
    setApprovedPreferenceProfile(null);
    setConfirmedProfileConversion(null);
    setIsInterpretingPreference(false);
    setNaturalRequirements("");
    setHasDetailedSearchRun(false);
    setLastAppliedProfile(defaultProfile);
    setAdvisorConfirmedProfile(null);
    setLastSavedProfile(defaultProfile);
    setFineTuneMetadata({});
    setUnsavedFineTuneFields([]);
    setLastFineTuneSummary("");
    setManualConflictNotes([]);
    setIsFineTuneOpen(false);
    setLastProfileUpdateSequence(0);
    setSearchSnapshot(null);
    setAdvisorFollowUpText("");
    setIsAdvisorFollowUp(false);
    updateProfile(defaultProfile);
    setAiStatus("Answer a few questions or browse the draft matches.");
  }

  async function startAdvisorConversation() {
    if (!advisorOpeningText.trim()) return;
    setIsAdvisorFollowUp(false);
    const profileWithoutMakeState = clearMakeState(profile);
    setProfile(profileWithoutMakeState);
    setLastAppliedProfile(profileWithoutMakeState);
    setLastSavedProfile(profileWithoutMakeState);
    clearCurrentSearchResult("Starting a new advisor search.");
    setApprovedPreferenceProfile(null);
    setConfirmedProfileConversion(null);
    setAdvisorConfirmedProfile(null);
    setFineTuneMetadata({});
    setUnsavedFineTuneFields([]);
    setManualConflictNotes([]);
    setIsInterpretingPreference(true);
    setAdvisorOpeningMessage("I’m reading that carefully.");
    try {
      const session = await requestAdvisorConversation({
        action: "start",
        message: advisorOpeningText,
      }).catch(() => createDeterministicSemanticConversationIntakeSession(advisorOpeningText));
      setIntakeSession(session);
      setApprovedPreferenceProfile(null);
      setConfirmedProfileConversion(null);
      setManualConflictNotes([]);
      setAdvisorOpeningMessage("");
    } finally {
      setIsInterpretingPreference(false);
    }
  }

  async function startAdvisorFollowUp() {
    const message = advisorFollowUpText.trim();
    if (!message) return;
    clearCurrentSearchResult("I’m updating the current profile from your follow-up.");
    setApprovedPreferenceProfile(null);
    setConfirmedProfileConversion(null);
    setIsAdvisorFollowUp(true);
    setIsInterpretingPreference(true);
    setAdvisorOpeningText(message);
    setAdvisorOpeningMessage("I’m applying that change to the preferences you already confirmed.");
    try {
      const revisionSession = intakeSession
        ? prepareConversationRevisionSession(intakeSession, profile)
        : null;
      const session = await (
        revisionSession
          ? requestAdvisorConversation({
              action: "answer",
              answer: message,
              session: revisionSession,
            })
          : requestAdvisorConversation({
              action: "start",
              message,
            })
      ).catch(() => createDeterministicSemanticConversationIntakeSession(message));
      setIntakeSession(session);
      setAdvisorOpeningMessage("");
      setAdvisorFollowUpText("");
    } finally {
      setIsInterpretingPreference(false);
    }
  }

  async function answerIntakeQuestion(answer: string) {
    if (!intakeSession) return;
    clearCurrentSearchResult();
    setIsInterpretingPreference(true);
    try {
      const nextSession = await requestAdvisorConversation({
        action: "answer",
        answer,
        session: intakeSession,
      }).catch(() => answerConversationQuestion(intakeSession, answer));
      setIntakeSession(nextSession);
      setApprovedPreferenceProfile(null);
      setConfirmedProfileConversion(null);
    } finally {
      setIsInterpretingPreference(false);
    }
  }

  function skipIntakeQuestion() {
    if (!intakeSession) return;
    clearCurrentSearchResult();
    setIntakeSession(skipConversationQuestion(intakeSession));
    setApprovedPreferenceProfile(null);
    setConfirmedProfileConversion(null);
  }

  function askAnotherIntakeQuestion() {
    if (!intakeSession) return;
    clearCurrentSearchResult();
    setIntakeSession(requestAnotherConversationQuestion(intakeSession));
    setApprovedPreferenceProfile(null);
    setConfirmedProfileConversion(null);
  }

  async function approveIntakeDraft(draft: ConfirmedPreferenceProfile) {
    if (!intakeSession) return;
    const approved = approveConfirmedPreferenceProfile(draft, intakeSession.conversationTurns.length + 1);
    const conversion = convertConfirmedPreferencesToBuyerProfile(profile, approved);
    const readiness = assessConfirmedProfileConversionReadiness(conversion);
    setApprovedPreferenceProfile(approved);
    setConfirmedProfileConversion(conversion);
    setAdvisorConfirmedProfile(conversion.buyerProfile);
    setFineTuneMetadata(createFineTuneMetadataFromConversion(conversion));
    setUnsavedFineTuneFields([]);
    setManualConflictNotes([]);
    setLastProfileUpdateSequence((current) => current + 1);
    setIntakeSession({ ...intakeSession, intakeStatus: "confirmed" });
    if (!readiness.ready) {
      clearCurrentSearchResult(readiness.clarificationQuestion);
      setAiStatus(readiness.clarificationQuestion);
      return;
    }
    await searchRecommendations(conversion.buyerProfile, {
      source: isAdvisorFollowUp ? "follow-up" : "confirmed-profile",
      conversion,
      skipWrittenRequirements: true,
    });
  }

  function adjustConfirmedProfile() {
    setIsFineTuneOpen(true);
    setAiStatus("Adjust the details you want to change. I’ll keep the current recommendation until you update it.");
    setTimeout(() => {
      fineTuneRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function undoRecentFineTuneEdits() {
    setProfile(lastSavedProfile);
    setUnsavedFineTuneFields([]);
    setManualConflictNotes([]);
    setAiStatus("Recent fine-tuning edits were undone. The current result is unchanged.");
  }

  function resetToAdvisorConfirmedProfile() {
    if (!advisorConfirmedProfile) return;
    const changedFields = getFineTuneChangedFields(lastAppliedProfile, advisorConfirmedProfile);
    setProfile(advisorConfirmedProfile);
    setFineTuneMetadata(createFineTuneMetadataFromConversion(confirmedProfileConversion));
    setUnsavedFineTuneFields(changedFields);
    setLastFineTuneSummary("");
    setManualConflictNotes([]);
    setAiStatus(
      changedFields.length
        ? "Restored the advisor-confirmed profile. Update my recommendation when you want me to check it again."
        : "The advisor-confirmed profile is already active.",
    );
  }

  async function applyFineTuneChanges() {
    const changedFields = unsavedFineTuneFields;
    const beforeTop = getTopVehicleName(recommendationDecisionSet);
    const beforeQualified = recommendationDecisionSet.pipelineDebug.qualifiedCount;
    await searchRecommendations(profile, {
      source: "fine-tune",
      skipWrittenRequirements: true,
      changedFields,
      beforeTop,
      beforeQualified,
    });
  }

  function syncFineTuneConversion(searchProfile: BuyerProfile, changedFields: Array<keyof BuyerProfile>) {
    setConfirmedProfileConversion((current) => {
      if (!current) return current;
      return mergeFineTuneConversion(current, searchProfile, changedFields, fineTuneMetadata);
    });
  }

  function toggleCompare(vehicleId: string) {
    setCompareIds((current) => {
      if (current.includes(vehicleId)) return current.filter((id) => id !== vehicleId);
      return [...current, vehicleId].slice(-4);
    });
  }

  function importCsvOverlays(overlays: VehicleDataOverlay[], warnings: string[]) {
    setImportedOverlays(overlays);
    setAiRecommendations([]);
    setAiStatus(
      overlays.length
        ? `Imported ${overlays.length} custom score row${overlays.length === 1 ? "" : "s"}${warnings.length ? ` (${warnings.length} warning${warnings.length === 1 ? "" : "s"})` : ""}.`
        : warnings[0] || "No custom score rows were imported.",
    );
  }

  function getOnlineLookupVehicles(currentProfile: BuyerProfile) {
    const currentMatches = getRequirementMatches(currentProfile, mergeVehicleData(vehicleCatalog, importedOverlays));
    const shortlist = rankVehicles(currentProfile, currentMatches).slice(0, 10);
    return shortlist;
  }

  async function fetchOnlineDataOverlays(currentProfile: BuyerProfile = profile) {
    const lookupVehicles = getOnlineLookupVehicles(currentProfile);
    const response = await fetch("/api/vehicle-data/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vehicles: lookupVehicles.map((vehicle) => ({
          make: vehicle.make,
          model: vehicle.model,
          year: vehicle.year,
        })),
      }),
    });
    const payload = (await response.json()) as {
      overlays?: VehicleDataOverlay[];
      warnings?: string[];
      providerStatus?: DataProviderStatus[];
    };

    if (!response.ok) throw new Error("Online data enrichment failed.");
    return {
      overlays: payload.overlays || [],
      warnings: payload.warnings || [],
      providerStatus: payload.providerStatus || [],
    };
  }

  async function loadOnlineData() {
    setIsLoadingOnlineData(true);
    setAiRecommendations([]);
    setAiStatus("Loading NHTSA, FuelEconomy.gov, and listing data...");

    try {
      const { overlays, warnings, providerStatus: nextProviderStatus } = await fetchOnlineDataOverlays();
      setOnlineOverlays(overlays);
      setDataWarnings(warnings);
      setProviderStatus(nextProviderStatus);
      setAiStatus(
        overlays.length
          ? `Loaded ${overlays.length} online data overlay${overlays.length === 1 ? "" : "s"}.${warnings.length ? ` ${warnings.join(" ")}` : ""}`
          : `Online sources returned no matching rows; using the built-in car list.${warnings.length ? ` ${warnings.join(" ")}` : ""}`,
      );
    } catch (error) {
      setAiStatus(error instanceof Error ? error.message : "Could not load online vehicle data.");
    } finally {
      setIsLoadingOnlineData(false);
    }
  }

  async function searchRecommendations(
    baseProfile: BuyerProfile = profile,
    options: {
      conversion?: ConfirmedProfileConversion;
      skipWrittenRequirements?: boolean;
      source?: RecommendationSearchSnapshot["source"];
      changedFields?: Array<keyof BuyerProfile>;
      beforeTop?: string;
      beforeQualified?: number;
    } = {},
  ) {
    const searchSessionId = createRecommendationSessionId(++searchSequenceRef.current);
    clearCurrentSearchResult();
    setIsSearching(true);
    setIsLoadingOnlineData(true);
    setIsPersonalizing(true);
    setAiRecommendations([]);
    if (options.source === "confirmed-profile" || options.source === "follow-up") {
      const readiness = assessConfirmedProfileConversionReadiness(options.conversion);
      if (!readiness.ready) {
        setAiStatus(readiness.clarificationQuestion);
        setIsSearching(false);
        setIsLoadingOnlineData(false);
        setIsPersonalizing(false);
        return;
      }
      setAiStatus("I have enough to make a responsible recommendation. I’m checking the car list now.");
    } else if (options.source === "fine-tune") {
      const readiness = assessManualProfileReadiness(baseProfile, options.changedFields || []);
      if (!readiness.ready) {
        setAiStatus(readiness.clarificationQuestion);
        setIsSearching(false);
        setIsLoadingOnlineData(false);
        setIsPersonalizing(false);
        return;
      }
      setAiStatus("I’m checking the updated preferences once.");
    } else {
      setConfirmedProfileConversion(null);
      setAiStatus("I’m checking your preferences against the car list.");
    }

    let freshOnlineOverlays = onlineOverlays;
    let searchProfile = baseProfile;

    if (!options.skipWrittenRequirements) {
      try {
        const interpreted = await applyWrittenRequirements(baseProfile);
        searchProfile = interpreted.profile;
      } catch (error) {
        setAiStatus(error instanceof Error ? error.message : "Could not understand written requirements.");
        setIsSearching(false);
        setIsPersonalizing(false);
        setIsLoadingOnlineData(false);
        return;
      }
    }
    setProfile(searchProfile);
    setLastSavedProfile(searchProfile);

    try {
      const onlineData = await fetchOnlineDataOverlays(searchProfile);
      freshOnlineOverlays = onlineData.overlays;
      setOnlineOverlays(freshOnlineOverlays);
      setDataWarnings(onlineData.warnings);
      setProviderStatus(onlineData.providerStatus);
    } catch (error) {
      setDataWarnings((current) =>
        current.includes("Online vehicle data could not be refreshed.")
          ? current
          : [...current, "Online vehicle data could not be refreshed."],
      );
    } finally {
      setIsLoadingOnlineData(false);
    }

    try {
      const mergedVehicles = mergeVehicleData(vehicleCatalog, [...importedOverlays, ...freshOnlineOverlays]);
      const strictMatches = getRequirementMatches(searchProfile, mergedVehicles);
      if (!strictMatches.length) {
        const noMatchDecisionSet = getRecommendationDecisionSet(searchProfile, mergedVehicles);
        const noMatchDecisionReport = buildDecisionReport(noMatchDecisionSet);
        const noMatchSnapshot = createSearchSnapshot({
          decisionReport: noMatchDecisionReport,
          decisionSet: noMatchDecisionSet,
          profile: searchProfile,
          rankedVehicles: [],
          sessionId: searchSessionId,
          source: options.source || "detailed",
        });
        setSearchSnapshot(noMatchSnapshot);
        logRecommendationDiagnostics(noMatchSnapshot);
        setAiRecommendations([]);
        if (options.source === "fine-tune") {
          const summary = summarizeRecommendationChange({
            changedFields: options.changedFields || [],
            topBefore: options.beforeTop || "No match",
            topAfter: "No match",
            qualifiedBefore: options.beforeQualified ?? 0,
            qualifiedAfter: 0,
          });
          setLastFineTuneSummary(summary.message);
          syncFineTuneConversion(searchProfile, options.changedFields || []);
          setUnsavedFineTuneFields([]);
          setManualConflictNotes([]);
          setLastProfileUpdateSequence((current) => current + 1);
        }
        setHasDetailedSearchRun(true);
        setLastAppliedProfile(searchProfile);
        setAiStatus(
          options.source === "confirmed-profile" || options.source === "follow-up"
            ? "I applied the preferences you confirmed, but no vehicle passed every required condition."
            : "No vehicle in the current car list satisfies every selected requirement.",
        );
        return;
      }

      const searchVehicles = rankVehicles(
        searchProfile,
        strictMatches,
      ).slice(0, 10);
      const response = await fetch("/api/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: searchProfile, vehicles: searchVehicles }),
      });
      const payload = (await response.json()) as {
        recommendations?: AiRecommendation[];
        configured?: boolean;
        error?: string;
      };

      if (!response.ok) throw new Error(payload.error || "Recommendation request failed.");

      setAiRecommendations(payload.recommendations || []);
      const mergedDecisionSet = getRecommendationDecisionSet(searchProfile, mergedVehicles);
      const rankedSearchVehicles = rankVehicles(searchProfile, strictMatches).slice(0, 10);
      const mergedDecisionReport = buildDecisionReport(mergedDecisionSet);
      setSearchSnapshot(createSearchSnapshot({
        decisionReport: mergedDecisionReport,
        decisionSet: mergedDecisionSet,
        profile: searchProfile,
        rankedVehicles: rankedSearchVehicles,
        sessionId: searchSessionId,
        source: options.source || "detailed",
      }));
      logRecommendationDiagnostics({
        decisionReport: mergedDecisionReport,
        decisionSet: mergedDecisionSet,
        profile: searchProfile,
        rankedVehicles: rankedSearchVehicles,
        sessionId: searchSessionId,
        source: options.source || "detailed",
      });
      const afterTop = getTopVehicleName(mergedDecisionSet);
      const afterQualified = mergedDecisionSet.pipelineDebug.qualifiedCount;
      if (options.source === "fine-tune") {
        const summary = summarizeRecommendationChange({
          changedFields: options.changedFields || [],
          topBefore: options.beforeTop || "No match",
          topAfter: afterTop,
          qualifiedBefore: options.beforeQualified ?? 0,
          qualifiedAfter: afterQualified,
        });
        setLastFineTuneSummary(summary.message);
        syncFineTuneConversion(searchProfile, options.changedFields || []);
        setUnsavedFineTuneFields([]);
        setManualConflictNotes([]);
        setLastProfileUpdateSequence((current) => current + 1);
      }
      setLastAppliedProfile(searchProfile);
      setHasDetailedSearchRun(true);
      setAiStatus(
        options.source === "confirmed-profile"
          ? "Your recommendation is ready."
          : options.source === "follow-up"
            ? "I updated the recommendation using your latest correction."
          : options.source === "fine-tune"
            ? "I updated the recommendation from your fine-tuned preferences."
            : "I checked your preferences against the car list.",
      );
    } catch (error) {
      setAiStatus(error instanceof Error ? error.message : "Could not personalize recommendations");
    } finally {
      setIsSearching(false);
      setIsPersonalizing(false);
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto grid w-full max-w-[1500px] gap-6 px-4 py-5 md:px-7">
        <header className="sticky top-0 z-20 -mx-4 border-b border-white/10 bg-slate-950/80 px-4 py-3 backdrop-blur-xl md:-mx-7 md:px-7">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-300">Personalized Car Advisor</p>
              <h1 className="mt-1 text-2xl font-black tracking-tight text-white md:text-4xl">
                First-Car Advisor
              </h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <NavButton active={activeView === "advisor"} onClick={() => setActiveView("advisor")}>
                Advisor
              </NavButton>
              <NavButton active={activeView === "compare"} onClick={() => setActiveView("compare")}>
                Compare
              </NavButton>
              <NavButton active={activeView === "advanced"} onClick={() => setActiveView("advanced")}>
                Advanced options
              </NavButton>
            </div>
          </div>
        </header>

        {activeView === "advisor" ? (
          <>
            <StageProgress stage={advisorStage} />

            <ConversationStarter
              approvedDraft={approvedPreferenceProfile}
              baseProfile={profile}
              hasResults={hasDetailedSearchRun}
              intakeSession={intakeSession}
              isLoading={isInterpretingPreference}
              isRecommendationRunning={isSearching}
              message={advisorOpeningMessage}
              onChange={(value) => {
                setAdvisorOpeningText(value);
                setAdvisorOpeningMessage("");
                setIntakeSession(null);
                setApprovedPreferenceProfile(null);
                setConfirmedProfileConversion(null);
                setFineTuneMetadata({});
                clearCurrentSearchResult("New request started. Confirm preferences before I show a recommendation.");
              }}
              onPromptSelect={(prompt) => {
                setAdvisorOpeningText(prompt);
                setAdvisorOpeningMessage("");
                setIntakeSession(null);
                setApprovedPreferenceProfile(null);
                setConfirmedProfileConversion(null);
                setFineTuneMetadata({});
                clearCurrentSearchResult("New request started. Confirm preferences before I show a recommendation.");
              }}
              onAnswerQuestion={answerIntakeQuestion}
              onApproveDraft={approveIntakeDraft}
              onAskAnotherQuestion={askAnotherIntakeQuestion}
              onSkipQuestion={skipIntakeQuestion}
              onStart={startAdvisorConversation}
              onStartOver={resetAdvisor}
              prompts={conversationStarterPrompts}
              value={advisorOpeningText}
            />

            {!hasDetailedSearchRun ? (
              <FineTuneDetailsPanel
                conflictNotes={manualConflictNotes}
                fineTuneRef={fineTuneRef}
                isOpen={isFineTuneOpen}
                isRunning={isSearching || isPersonalizing || isLoadingOnlineData}
                lastFineTuneSummary={lastFineTuneSummary}
                lastProfileUpdateSequence={lastProfileUpdateSequence}
                metadata={fineTuneMetadata}
                onApply={applyFineTuneChanges}
                onOpenChange={setIsFineTuneOpen}
                onResetAdvisorConfirmed={resetToAdvisorConfirmedProfile}
                onStartOver={resetAdvisor}
                onUndo={undoRecentFineTuneEdits}
                onUpdateField={updateFineTuneProfile}
                profile={profile}
                profileSourceLabel={profileSourceLabel}
                unsavedSummary={unsavedSummary}
              />
            ) : null}

            {isSearching && !hasDetailedSearchRun ? (
              <section className="rounded-lg border border-cyan-200/15 bg-cyan-200/[0.06] p-4 text-sm font-bold leading-6 text-cyan-50">
                {confirmedProfileConversion
                  ? "I have enough to make a responsible recommendation. I’m checking the car list now."
                  : "I’m checking your preferences against the car list."}
              </section>
            ) : null}

            {hasDetailedSearchRun ? (
              <>
                <section className="grid scroll-mt-28 gap-4" ref={resultsRef}>
                  <div className="sr-only">
                    <h2>Recommendation</h2>
                    <p>{aiStatus}</p>
                  </div>

                  {hasNoMatch ? (
                    <NoMatchPanel
                      decisionReport={decisionReport}
                      decisionSet={recommendationDecisionSet}
                      onAdjust={adjustConfirmedProfile}
                      profile={resultProfile}
                    />
                  ) : (
                    <VisibleIntelligenceResults
                      compareIds={compareIds}
                      decisionReport={decisionReport}
                      decisionSet={recommendationDecisionSet}
                      onToggleCompare={toggleCompare}
                      profile={resultProfile}
                      rankedVehicles={rankedVehicles}
                    />
                  )}

                  {confirmedProfileConversion ? (
                    <PreferencesUsedPanel conversion={confirmedProfileConversion} onAdjust={adjustConfirmedProfile} />
                  ) : null}

                  <AdvisorRefinementPanel
                    isRunning={isInterpretingPreference || isSearching}
                    onChange={setAdvisorFollowUpText}
                    onSubmit={startAdvisorFollowUp}
                    value={advisorFollowUpText}
                  />
                </section>

                <FineTuneDetailsPanel
                  conflictNotes={manualConflictNotes}
                  fineTuneRef={fineTuneRef}
                  isOpen={isFineTuneOpen}
                  isRunning={isSearching || isPersonalizing || isLoadingOnlineData}
                  lastFineTuneSummary={lastFineTuneSummary}
                  lastProfileUpdateSequence={lastProfileUpdateSequence}
                  metadata={fineTuneMetadata}
                  onApply={applyFineTuneChanges}
                  onOpenChange={setIsFineTuneOpen}
                  onResetAdvisorConfirmed={resetToAdvisorConfirmedProfile}
                  onStartOver={resetAdvisor}
                  onUndo={undoRecentFineTuneEdits}
                  onUpdateField={updateFineTuneProfile}
                  profile={profile}
                  profileSourceLabel={profileSourceLabel}
                  unsavedSummary={unsavedSummary}
                />
              </>
            ) : (
              <section className="rounded-lg border border-white/10 bg-white/[0.035] p-4 text-sm font-semibold leading-6 text-slate-400">
                When you confirm your preferences, I’ll check the car list and show the recommendation here.
              </section>
            )}
          </>
        ) : null}

        {activeView === "compare" ? (
          searchSnapshot ? (
            <ComparisonView decisionReport={decisionReport} decisionSet={recommendationDecisionSet} profile={resultProfile} vehicles={comparedVehicles} />
          ) : (
            <section className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
              <h2 className="text-2xl font-black text-white">Comparison</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-400">
                Confirm preferences in Advisor first. I won’t show comparison vehicles until they belong to the current search.
              </p>
            </section>
          )
        ) : null}

        {activeView === "advanced" ? (
          <section className="grid gap-4">
            <DataImportPanel
              importedCount={importedOverlays.length}
              isLoadingOnlineData={isLoadingOnlineData}
              onImport={importCsvOverlays}
              onLoadOnlineData={loadOnlineData}
              onlineCount={onlineOverlays.length}
              providerStatus={providerStatus}
              warnings={dataWarnings}
            />

            <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.055] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur">
              <div>
                <h2 className="text-xl font-black text-white">Scoring Weights</h2>
                <p className="text-sm font-semibold text-slate-400">
                  Adjust how much each factor matters. I’ll keep the percentages balanced.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {(Object.keys(defaultScoreWeights) as ScoreWeightField[]).map((field) => (
                  <WeightField
                    field={field}
                    key={field}
                    label={scoreWeightLabels[field]}
                    normalizedValue={Math.round(normalizedWeights[field])}
                    onChange={updateScoreWeight}
                    value={profile.scoreWeights[field]}
                  />
                ))}
              </div>
            </section>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function StageProgress({ stage }: { stage: AdvisorStage }) {
  const stages: Array<{ id: AdvisorStage; label: string }> = [
    { id: "describe", label: "Describe" },
    { id: "clarify", label: "Clarify" },
    { id: "confirm", label: "Confirm" },
    { id: "results", label: "Results" },
    { id: "fine-tune", label: "Fine-tune" },
  ];
  const currentIndex = stages.findIndex((item) => item.id === stage);

  return (
    <nav aria-label="Advisor progress" className="rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2">
      <ol className="flex flex-wrap gap-2">
        {stages.map((item, index) => {
          const isCurrent = item.id === stage;
          const isComplete = index < currentIndex;
          return (
            <li key={item.id}>
              <span
                aria-current={isCurrent ? "step" : undefined}
                className={`inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-black transition ${
                  isCurrent
                    ? "border-cyan-300 bg-cyan-300 text-slate-950"
                    : isComplete
                      ? "border-cyan-300/25 bg-cyan-300/10 text-cyan-100"
                      : "border-white/10 bg-slate-950/25 text-slate-500"
                }`}
              >
                {item.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function ConversationStarter({
  approvedDraft,
  baseProfile,
  hasResults,
  intakeSession,
  isLoading,
  isRecommendationRunning,
  message,
  onAnswerQuestion,
  onApproveDraft,
  onAskAnotherQuestion,
  onChange,
  onPromptSelect,
  onSkipQuestion,
  onStart,
  onStartOver,
  prompts,
  value,
}: {
  approvedDraft: ConfirmedPreferenceProfile | null;
  baseProfile: BuyerProfile;
  hasResults: boolean;
  intakeSession: ConversationIntakeSession | null;
  isLoading: boolean;
  isRecommendationRunning: boolean;
  message: string;
  onAnswerQuestion: (answer: string) => void;
  onApproveDraft: (draft: ConfirmedPreferenceProfile) => void;
  onAskAnotherQuestion: () => void;
  onChange: (value: string) => void;
  onPromptSelect: (prompt: string) => void;
  onSkipQuestion: () => void;
  onStart: () => void;
  onStartOver: () => void;
  prompts: string[];
  value: string;
}) {
  const isEmpty = value.trim().length === 0;
  const showCompactOpening = Boolean(intakeSession);

  return (
    <section className="overflow-hidden rounded-lg border border-cyan-200/15 bg-white/[0.055] shadow-[0_28px_90px_rgba(0,0,0,0.28)] backdrop-blur">
      {showCompactOpening ? (
        <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between md:p-5">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-300">Request</p>
            <p className="mt-1 max-w-4xl text-sm font-bold leading-6 text-slate-200">{value}</p>
          </div>
          <button
            className="min-h-10 rounded-lg border border-white/10 bg-white/[0.05] px-4 text-sm font-black text-slate-200 transition hover:border-cyan-300/50 hover:bg-cyan-300/10"
            onClick={onStartOver}
            type="button"
          >
            Start over
          </button>
        </div>
      ) : (
        <div className="grid gap-6 p-5 md:p-8 lg:grid-cols-[minmax(0,1.08fr)_minmax(280px,0.92fr)] lg:items-end">
          <div className="grid gap-5">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-300">Advisor Intake</p>
              <h2 className="mt-3 max-w-4xl text-3xl font-black leading-tight tracking-tight text-white md:text-5xl">
                Car Search
              </h2>
              <p className="mt-4 max-w-2xl text-base font-semibold leading-7 text-slate-300 md:text-lg">
                You can be specific, uncertain, practical, or emotional. Start with what matters to you.
              </p>
            </div>

            <label className="grid gap-2" htmlFor="advisor-conversation-starter">
              <span className="text-sm font-black text-slate-200">Describe what you’re imagining</span>
              <textarea
                className="min-h-40 resize-y rounded-lg border border-white/10 bg-slate-950/55 px-4 py-4 text-base font-semibold leading-7 text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/80 focus:ring-4 focus:ring-cyan-300/15 md:min-h-48"
                id="advisor-conversation-starter"
                onChange={(event) => onChange(event.target.value)}
                placeholder="I want something fun and powerful, but I don’t want expensive repairs..."
                value={value}
              />
            </label>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                className="min-h-12 rounded-lg border border-cyan-300/40 bg-cyan-300 px-5 text-base font-black text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.05] disabled:text-slate-500"
                disabled={isEmpty || isLoading}
                onClick={onStart}
                type="button"
              >
                {isLoading ? "Processing" : "Start Advisor"}
              </button>
              {message ? (
                <p aria-live="polite" className="rounded-lg border border-cyan-200/15 bg-cyan-200/[0.07] px-3 py-2 text-sm font-bold leading-6 text-cyan-50">
                  {message}
                </p>
              ) : (
                <p className="text-sm font-semibold leading-6 text-slate-400">No car knowledge required. I’ll ask focused follow-up questions.</p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-slate-950/35 p-4">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Examples</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {prompts.map((prompt) => (
                <button
                  className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-sm font-bold leading-5 text-slate-200 transition hover:border-cyan-300/45 hover:bg-cyan-300/10 focus:border-cyan-300/80 focus:outline-none focus:ring-4 focus:ring-cyan-300/15"
                  key={prompt}
                  onClick={() => onPromptSelect(prompt)}
                  type="button"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {intakeSession && !hasResults ? (
        <div className="border-t border-white/10 p-5 md:p-8">
          <PreferenceInterpretationPanel
            approvedDraft={approvedDraft}
            baseProfile={baseProfile}
            onAnswerQuestion={onAnswerQuestion}
            onApproveDraft={onApproveDraft}
            onAskAnotherQuestion={onAskAnotherQuestion}
            onSkipQuestion={onSkipQuestion}
            onStartOver={onStartOver}
            isRecommendationRunning={isRecommendationRunning}
            session={intakeSession}
          />
        </div>
      ) : null}
    </section>
  );
}

function PreferencesUsedPanel({ conversion, onAdjust }: { conversion: ConfirmedProfileConversion; onAdjust: () => void }) {
  const strongestPreferences = conversion.appliedSoftPreferences.slice(0, 5);
  const visibleWarnings = [...conversion.mappingLimitations, ...conversion.conversionWarnings].slice(0, 4);

  return (
    <details className="group rounded-lg border border-white/10 bg-white/[0.025] p-3 md:p-4">
      <summary className="flex min-h-11 cursor-pointer list-none flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-[0.68rem] font-black uppercase tracking-[0.16em] text-slate-500">Inputs</p>
          <h3 className="mt-1 text-base font-black text-slate-100">Applied Preferences</h3>
        </div>
        <button
          className="min-h-9 rounded-lg border border-white/10 bg-slate-950/35 px-3 text-xs font-black text-slate-300 transition hover:border-cyan-300/50 hover:bg-cyan-300/10"
          onClick={(event) => {
            event.preventDefault();
            onAdjust();
          }}
          type="button"
        >
          Fine-tune preferences
        </button>
      </summary>

      <div className="mt-4 grid gap-3 border-t border-white/10 pt-4 lg:grid-cols-2">
        <ConversionList emptyText="No approved hard requirements were added." items={conversion.appliedHardConstraints} title="Requirements" />
        <ConversionList emptyText="No soft preferences were applied." items={strongestPreferences} title="Priorities" />
        <ConversionList emptyText="No extra advisor context was preserved." items={conversion.preservedSemanticPreferences} title="Understood Context" />
        <ConversionList emptyText="No important defaults were disclosed." items={conversion.preservedDefaults} title="Assumptions" />
        <ConversionList emptyText="No unresolved fields remained." items={conversion.unresolvedFields} title="Open Items" />
      </div>

      {visibleWarnings.length ? (
        <div className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/[0.08] p-3">
          <p className="text-sm font-black text-amber-50">Translation Notes</p>
          <ul className="mt-2 grid gap-1 text-sm font-semibold leading-6 text-amber-50/85">
            {visibleWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </details>
  );
}

function FineTuneDetailsPanel({
  conflictNotes,
  fineTuneRef,
  isOpen,
  isRunning,
  lastFineTuneSummary,
  lastProfileUpdateSequence,
  metadata,
  onApply,
  onOpenChange,
  onResetAdvisorConfirmed,
  onStartOver,
  onUndo,
  onUpdateField,
  profile,
  profileSourceLabel,
  unsavedSummary,
}: {
  conflictNotes: string[];
  fineTuneRef: { current: HTMLDetailsElement | null };
  isOpen: boolean;
  isRunning: boolean;
  lastFineTuneSummary: string;
  lastProfileUpdateSequence: number;
  metadata: FineTuneMetadata;
  onApply: () => void;
  onOpenChange: (value: boolean) => void;
  onResetAdvisorConfirmed: () => void;
  onStartOver: () => void;
  onUndo: () => void;
  onUpdateField: (profile: BuyerProfile, field: keyof BuyerProfile, label?: string) => void;
  profile: BuyerProfile;
  profileSourceLabel: string;
  unsavedSummary: ReturnType<typeof summarizeFineTuneChanges>;
}) {
  const hasChanges = unsavedSummary.changedFields.length > 0;
  const makeValue = profile.requiredMake || profile.preferredMake || "";
  const makeStrength: ConstraintStrength | "not-set" = profile.requiredMake ? "required" : profile.preferredMake ? "preferred" : "not-set";

  function update(field: keyof BuyerProfile, nextProfile: BuyerProfile, label?: string) {
    onUpdateField(nextProfile, field, label);
  }

  return (
    <details
      className="group rounded-lg border border-white/10 bg-white/[0.035] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.16)] backdrop-blur md:p-5"
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
      open={isOpen}
      ref={fineTuneRef}
    >
      <summary className="flex min-h-12 cursor-pointer list-none flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Preferences</p>
          <h2 className="mt-1 text-xl font-black text-white">Preference Controls</h2>
          <p className="mt-1 text-sm font-semibold leading-6 text-slate-400">
            Use these controls when you want precise limits or want to correct what the advisor understood.
          </p>
        </div>
        <span className="inline-flex min-h-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] px-4 text-sm font-black text-slate-200 transition group-open:border-cyan-300/40 group-open:bg-cyan-300/10 group-open:text-cyan-100">
          Fine-tune preferences
        </span>
      </summary>

      <div className="mt-5 grid gap-4 border-t border-white/10 pt-5">
        <section className="grid gap-3 rounded-lg border border-cyan-200/15 bg-cyan-200/[0.055] p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-cyan-200">Preference Source</p>
              <p className="mt-1 text-lg font-black text-white">{profileSourceLabel}</p>
              <p className="mt-1 text-sm font-semibold leading-6 text-slate-300">
                Last preference update in this session: {lastProfileUpdateSequence ? `#${lastProfileUpdateSequence}` : "not applied yet"}.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="min-h-10 rounded-lg border border-white/10 bg-white/[0.05] px-3 text-xs font-black text-slate-200" onClick={onUndo} type="button">
                Undo recent edits
              </button>
              <button
                className="min-h-10 rounded-lg border border-white/10 bg-white/[0.05] px-3 text-xs font-black text-slate-200"
                onClick={onResetAdvisorConfirmed}
                type="button"
              >
                Reset to advisor-confirmed profile
              </button>
              <button className="min-h-10 rounded-lg border border-white/10 bg-transparent px-3 text-xs font-black text-slate-400" onClick={onStartOver} type="button">
                Start over
              </button>
            </div>
          </div>
          {hasChanges ? (
            <div className="rounded-lg border border-amber-300/20 bg-amber-300/[0.08] p-3">
              <p className="text-sm font-bold leading-6 text-amber-50">{unsavedSummary.message}</p>
            </div>
          ) : null}
          {lastFineTuneSummary ? (
            <div className="rounded-lg border border-emerald-300/20 bg-emerald-300/[0.08] p-3">
              <p className="text-sm font-bold leading-6 text-emerald-50">{lastFineTuneSummary}</p>
            </div>
          ) : null}
          {conflictNotes.length ? (
            <div className="rounded-lg border border-sky-300/20 bg-sky-300/[0.08] p-3">
              <p className="text-sm font-black text-sky-50">Manual Overrides</p>
              <ul className="mt-1 grid gap-1 text-sm font-semibold leading-6 text-sky-50/85">
                {conflictNotes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <div className="grid gap-4 xl:grid-cols-2">
          <QuestionGroup title="Budget">
            <NumberField label="Purchase budget" meta={metadata.maxPurchaseBudget} field="maxPurchaseBudget" step={500} profile={profile} setProfile={(next) => update("maxPurchaseBudget", next)} />
            <NumberField label="Monthly budget" meta={metadata.monthlyBudget} field="monthlyBudget" step={25} profile={profile} setProfile={(next) => update("monthlyBudget", next)} />
            <NumberField label="Down payment" meta={metadata.downPayment} field="downPayment" step={100} profile={profile} setProfile={(next) => update("downPayment", next)} />
            <SelectField
              label="Cash or financing"
              meta={metadata.paymentMethod}
              value={profile.paymentMethod}
              onChange={(value) => update("paymentMethod", { ...profile, paymentMethod: value as BuyerProfile["paymentMethod"] })}
              options={[
                ["not-sure", "Not sure"],
                ["cash", "Cash"],
                ["financing", "Financing"],
              ]}
            />
            <NumberField label="Insurance comfort" meta={metadata.insuranceBudget} field="insuranceBudget" step={5} profile={profile} setProfile={(next) => update("insuranceBudget", next)} />
            <NumberField label="Annual mileage" meta={metadata.expectedAnnualMileage} field="expectedAnnualMileage" step={500} profile={profile} setProfile={(next) => update("expectedAnnualMileage", next)} />
          </QuestionGroup>

          <QuestionGroup title="Usage">
            <NumberField label="Family size" meta={metadata.familySize} field="familySize" step={1} profile={profile} setProfile={(next) => update("familySize", next)} />
            <SelectField
              label="Cargo"
              meta={metadata.cargoNeed}
              value={profile.cargoNeed}
              onChange={(value) => update("cargoNeed", { ...profile, cargoNeed: value as BuyerProfile["cargoNeed"] })}
              options={[
                ["not-sure", "Not sure"],
                ["low", "Low"],
                ["medium", "Medium"],
                ["high", "High"],
              ]}
            />
            <SelectField
              label="Climate"
              meta={metadata.climate}
              value={profile.climate}
              onChange={(value) => update("climate", { ...profile, climate: value as BuyerProfile["climate"] })}
              options={[
                ["not-sure", "Not sure"],
                ["mild", "Mostly mild"],
                ["rain", "Rain often"],
                ["snow", "Snow or ice"],
              ]}
            />
          </QuestionGroup>

          <QuestionGroup title="Vehicle Preferences">
            <MakePreferenceField
              makeValue={makeValue}
              metadata={metadata.requiredMake || metadata.preferredMake}
              onChange={(value, strength) => {
                const trimmed = value.trim();
                const nextProfile =
                  strength === "required"
                    ? { ...profile, requiredMake: trimmed || undefined, preferredMake: undefined }
                    : strength === "preferred"
                      ? { ...profile, preferredMake: trimmed || undefined, requiredMake: undefined }
                      : { ...profile, preferredMake: undefined, requiredMake: undefined };
                update(strength === "required" ? "requiredMake" : "preferredMake", nextProfile, strength === "required" ? "required make" : "preferred make");
              }}
              strength={makeStrength}
            />
            <SelectField
              impact="Cars that do not meet this will be excluded."
              label="Body style"
              meta={metadata.bodyStyle}
              value={profile.bodyStyle}
              onChange={(value) => update("bodyStyle", { ...profile, bodyStyle: value as BuyerProfile["bodyStyle"] })}
              options={[
                ["any", "Any"],
                ["sedan", "Sedan"],
                ["suv", "SUV"],
                ["hatchback", "Hatchback"],
                ["truck", "Truck"],
                ["coupe", "Coupe"],
                ["convertible", "Convertible"],
                ["wagon", "Wagon"],
                ["minivan", "Minivan"],
              ]}
            />
            <SelectField
              impact="Cars that do not meet this will be excluded."
              label="Drivetrain"
              meta={metadata.drivetrainPreference}
              value={profile.drivetrainPreference}
              onChange={(value) => update("drivetrainPreference", { ...profile, drivetrainPreference: value as BuyerProfile["drivetrainPreference"] })}
              options={[
                ["any", "Any"],
                ["FWD", "FWD"],
                ["AWD", "AWD"],
                ["RWD", "RWD"],
                ["4WD", "4WD"],
              ]}
            />
            <SelectField
              impact="Cars that do not meet this will be excluded."
              label="Transmission"
              meta={metadata.transmissionPreference}
              value={profile.transmissionPreference}
              onChange={(value) => update("transmissionPreference", { ...profile, transmissionPreference: value as BuyerProfile["transmissionPreference"] })}
              options={[
                ["any", "Any"],
                ["automatic", "Automatic"],
                ["manual", "Manual"],
              ]}
            />
            <SelectField
              label="New or used"
              meta={metadata.purchaseCondition}
              value={profile.purchaseCondition}
              onChange={(value) => update("purchaseCondition", { ...profile, purchaseCondition: value as BuyerProfile["purchaseCondition"] })}
              options={[
                ["any", "Either"],
                ["new", "Prefer new"],
                ["used", "Prefer used"],
              ]}
            />
            <RangeField label="Performance" meta={metadata.performanceImportance} field="performanceImportance" profile={profile} setProfile={(next) => update("performanceImportance", next)} />
          </QuestionGroup>

          <QuestionGroup title="Risk Priorities">
            <RangeField label="Reliability" meta={metadata.reliabilityImportance} field="reliabilityImportance" profile={profile} setProfile={(next) => update("reliabilityImportance", next)} />
            <NumberField label="Reliability minimum" meta={metadata.reliabilityMinimum} field="reliabilityMinimum" step={1} profile={profile} setProfile={(next) => update("reliabilityMinimum", next)} />
            <SelectField
              label="Safety priority"
              meta={metadata.safetyPriority}
              value={profile.safetyPriority}
              onChange={(value) => update("safetyPriority", { ...profile, safetyPriority: value as BuyerProfile["safetyPriority"] })}
              options={[
                ["not-sure", "Not sure"],
                ["standard", "Standard"],
                ["high", "High"],
                ["maximum", "Maximum"],
              ]}
            />
            <NumberField label="Safety minimum" meta={metadata.safetyMinimum} field="safetyMinimum" step={1} profile={profile} setProfile={(next) => update("safetyMinimum", next)} />
            <NumberField impact="Cars above this mileage will be excluded." label="Maximum mileage" meta={metadata.maxMileage} field="maxMileage" step={5000} profile={profile} setProfile={(next) => update("maxMileage", next)} />
            <NumberField impact="Cars older than this year will be excluded." label="Minimum model year" meta={metadata.minYear} field="minYear" step={1} profile={profile} setProfile={(next) => update("minYear", next)} />
          </QuestionGroup>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            className="min-h-11 rounded-lg border border-cyan-300/40 bg-cyan-300 px-4 text-sm font-black text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.05] disabled:text-slate-500"
            disabled={!hasChanges || isRunning}
            onClick={onApply}
            type="button"
          >
            {isRunning ? "Updating recommendation" : "Update Recommendation"}
          </button>
          <p className="text-sm font-semibold leading-6 text-slate-400">
            Changes wait here until you choose to update, so the current recommendation stays stable.
          </p>
        </div>
      </div>
    </details>
  );
}

function ConversionList({
  emptyText,
  items,
  title,
}: {
  emptyText: string;
  items: ProfileConversionEntry[];
  title: string;
}) {
  return (
    <section className="rounded-lg border border-white/10 bg-slate-950/35 p-4">
      <h4 className="text-sm font-black text-white">{title}</h4>
      {items.length ? (
        <ul className="mt-3 grid gap-2">
          {items.map((item) => (
            <li className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2" key={`${item.sourceItemId}-${item.field || item.label}`}>
              <span className="text-sm font-black text-slate-100">{item.label}</span>
              <span className="text-sm font-semibold leading-6 text-slate-300">{item.displayValue}</span>
              <span className="text-xs font-black uppercase tracking-[0.08em] text-slate-500">{item.constraintStrength}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm font-semibold leading-6 text-slate-400">{emptyText}</p>
      )}
    </section>
  );
}

function PreferenceInterpretationPanel({
  approvedDraft,
  baseProfile,
  isRecommendationRunning,
  onAnswerQuestion,
  onApproveDraft,
  onAskAnotherQuestion,
  onSkipQuestion,
  onStartOver,
  session,
}: {
  approvedDraft: ConfirmedPreferenceProfile | null;
  baseProfile: BuyerProfile;
  isRecommendationRunning: boolean;
  onAnswerQuestion: (answer: string) => void;
  onApproveDraft: (draft: ConfirmedPreferenceProfile) => Promise<void> | void;
  onAskAnotherQuestion: () => void;
  onSkipQuestion: () => void;
  onStartOver: () => void;
  session: ConversationIntakeSession;
}) {
  const [showAnswerInput, setShowAnswerInput] = useState(false);
  const [answer, setAnswer] = useState("");
  const [confirmationDraft, setConfirmationDraft] = useState<ConfirmedPreferenceProfile>(() =>
    createConfirmedPreferenceProfile(session, baseProfile),
  );
  const draftToPreserveRef = useRef<ConfirmedPreferenceProfile | null>(null);
  const conciseUnderstanding = getConciseUnderstanding(session);
  const latestAdvisorTurn = getLatestAdvisorTurn(session);
  const firstConflict = conciseUnderstanding.activeConflict;
  const firstUncertainty = conciseUnderstanding.remainingUncertainty;
  const currentQuestion = session.currentQuestion;
  const latestUserText = [...session.conversationTurns].reverse().find((turn) => turn.role === "user")?.text || "";
  const outOfScopeMessage = getOutOfScopeAdvisorMessage(latestUserText);
  const terminalCatalogNoMatch = assessCatalogIntentFeasibility(
    session.accumulatedInterpretation.suggestedProfileUpdates,
    vehicleCatalog,
  ).terminalNoMatch;
  const advisorContinuityMessage =
    latestAdvisorTurn && currentQuestion && session.conversationTurns.length > 2
      ? latestAdvisorTurn.text.replace(currentQuestion?.text || "", "").trim()
      : "";

  useEffect(() => {
    const nextDraft = createConfirmedPreferenceProfile(session, baseProfile);
    const preservedDraft = draftToPreserveRef.current;
    draftToPreserveRef.current = null;
    setConfirmationDraft(preservedDraft ? carryForwardConfirmedPreferenceDraft(nextDraft, preservedDraft) : nextDraft);
  }, [baseProfile, session]);

  function continueConversation() {
    if (!answer.trim()) return;
    draftToPreserveRef.current = confirmationDraft;
    onAnswerQuestion(answer);
    setAnswer("");
    setShowAnswerInput(false);
  }

  function skipQuestion() {
    draftToPreserveRef.current = confirmationDraft;
    onSkipQuestion();
    setAnswer("");
    setShowAnswerInput(false);
  }

  function askAnotherQuestion() {
    draftToPreserveRef.current = confirmationDraft;
    onAskAnotherQuestion();
  }

  function approveDraft(draft: ConfirmedPreferenceProfile) {
    draftToPreserveRef.current = draft;
    onApproveDraft(draft);
  }

  return (
    <section className="grid gap-5 rounded-lg border border-cyan-200/15 bg-slate-950/35 p-4 md:p-5">
      <div className="grid gap-2">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-300">
          {outOfScopeMessage ? "Current scope" : currentQuestion ? "Conversation" : "Final check"}
        </p>
        <h3 className="text-2xl font-black tracking-tight text-white">
          {outOfScopeMessage
            ? "This request is outside the current car catalog."
            : currentQuestion
              ? "Let me understand one thing first."
              : "Here’s what I’ll use."}
        </h3>
        <p className="max-w-3xl text-sm font-semibold leading-6 text-slate-300">
          {outOfScopeMessage
            ? outOfScopeMessage
            : currentQuestion
            ? "I’m keeping the setup simple and asking only what would change the recommendation most."
            : "Before I look for cars, check this summary once so I don’t turn a misunderstanding into a recommendation."}
        </p>
        {advisorContinuityMessage ? (
          <p className="max-w-3xl rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-bold leading-6 text-slate-200">
            {advisorContinuityMessage}
          </p>
        ) : null}
      </div>

      {!outOfScopeMessage && firstConflict ? (
        <div className="rounded-lg border border-amber-300/20 bg-amber-300/[0.07] p-4">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-200">One thing to resolve</p>
          <p className="mt-2 text-sm font-bold leading-6 text-amber-50">{firstConflict.description}</p>
        </div>
      ) : null}

      {!outOfScopeMessage && firstUncertainty ? (
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">What I’m still unsure about</p>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-200">{firstUncertainty.question}</p>
        </div>
      ) : null}

      {!outOfScopeMessage && currentQuestion ? (
        <div className="rounded-lg border border-cyan-200/15 bg-cyan-200/[0.06] p-4">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-cyan-200">Next question</p>
          <p className="mt-2 text-base font-black leading-7 text-white">{currentQuestion.text}</p>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        {!outOfScopeMessage && currentQuestion ? (
          <>
            <button
              className="min-h-11 rounded-lg border border-cyan-300/40 bg-cyan-300 px-4 text-sm font-black text-slate-950 transition hover:bg-cyan-200"
              onClick={() => setShowAnswerInput((current) => !current)}
              type="button"
            >
              Answer
            </button>
            <button
              className="min-h-11 rounded-lg border border-white/10 bg-white/[0.05] px-4 text-sm font-black text-slate-200 transition hover:border-cyan-300/50 hover:bg-cyan-300/10"
              onClick={skipQuestion}
              type="button"
            >
              Skip
            </button>
          </>
        ) : null}
        <button
          className="min-h-11 rounded-lg border border-white/10 bg-transparent px-4 text-sm font-black text-slate-400 transition hover:border-white/30 hover:text-slate-100"
          onClick={onStartOver}
          type="button"
        >
          Start over
        </button>
      </div>

      {!outOfScopeMessage && showAnswerInput && currentQuestion ? (
        <label className="grid gap-2 text-sm font-black text-slate-200" htmlFor="clarifying-answer">
          <span>{currentQuestion.text}</span>
          <textarea
            className="min-h-24 resize-y rounded-lg border border-white/10 bg-slate-950/55 px-3 py-3 text-sm font-semibold leading-6 text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/80 focus:ring-4 focus:ring-cyan-300/15"
            id="clarifying-answer"
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="Answer in your own words."
            value={answer}
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              className="min-h-10 rounded-lg border border-cyan-300/40 bg-cyan-300 px-4 text-sm font-black text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.05] disabled:text-slate-500"
              disabled={!answer.trim()}
              onClick={continueConversation}
              type="button"
            >
              Continue
            </button>
            <button
              className="min-h-10 rounded-lg border border-white/10 bg-white/[0.05] px-4 text-sm font-black text-slate-200 transition hover:border-cyan-300/50 hover:bg-cyan-300/10"
              onClick={skipQuestion}
              type="button"
            >
              Skip
            </button>
          </div>
        </label>
      ) : null}

      {!outOfScopeMessage && !currentQuestion ? (
        <ConfirmationProfilePanel
          approvedDraft={approvedDraft}
          draft={confirmationDraft}
          isRecommendationRunning={isRecommendationRunning}
          terminalCatalogNoMatch={terminalCatalogNoMatch}
          onApprove={approveDraft}
          onAskAnotherQuestion={askAnotherQuestion}
          onChangeDraft={setConfirmationDraft}
          onStartOver={onStartOver}
        />
      ) : null}
    </section>
  );
}

function ConfirmationProfilePanel({
  approvedDraft,
  draft,
  isRecommendationRunning,
  terminalCatalogNoMatch,
  onApprove,
  onAskAnotherQuestion,
  onChangeDraft,
  onStartOver,
}: {
  approvedDraft: ConfirmedPreferenceProfile | null;
  draft: ConfirmedPreferenceProfile;
  isRecommendationRunning: boolean;
  terminalCatalogNoMatch: boolean;
  onApprove: (draft: ConfirmedPreferenceProfile) => Promise<void> | void;
  onAskAnotherQuestion: () => void;
  onChangeDraft: (draft: ConfirmedPreferenceProfile) => void;
  onStartOver: () => void;
}) {
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const hasBlockingIssue = hasBlockingConfirmationIssue(draft) && !terminalCatalogNoMatch;
  const readiness = assessConfirmedPreferenceDraftReadiness(draft);
  const communication = buildConfirmationCommunicationViewModel(draft, readiness);

  function startEdit(item: ConfirmedPreferenceItem) {
    setEditingItemId(item.id);
    setEditingValue(String(item.value));
  }

  function saveEdit(item: ConfirmedPreferenceItem) {
    const nextValue = item.editableType === "number" ? Number(editingValue.replace(/[$,\s]/g, "")) : editingValue;
    if (item.editableType === "number" && !Number.isFinite(Number(nextValue))) return;
    onChangeDraft(
      updateConfirmedPreferenceItem(draft, item.id, {
        value: nextValue,
        certainty: "confirmed",
        constraintStrength: item.field === "maxPurchaseBudget" ? "required" : item.constraintStrength,
        evidencePhrase: `User correction: ${editingValue}`,
      }),
    );
    setEditingItemId(null);
    setEditingValue("");
  }

  return (
    <section className="grid gap-5 rounded-lg border border-white/10 bg-slate-950/50 p-4 md:p-5">
      <div className="grid gap-2">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-300">One final summary</p>
        <h3 className="text-2xl font-black tracking-tight text-white">Confirm your preferences</h3>
        <p className="max-w-3xl text-sm font-semibold leading-6 text-slate-300">
          Review this before I look for cars. You can correct anything I misunderstood.
        </p>
      </div>

      <div className="rounded-lg border border-cyan-200/15 bg-cyan-200/[0.06] p-4">
        <p className="text-xs font-black uppercase tracking-[0.14em] text-cyan-200">What I understood</p>
        <p className="mt-2 text-sm font-bold leading-6 text-white">{communication.advisorSummary}</p>
      </div>

      <ConfirmationPolicySummary summary={communication.policySummary} />

      <details className="group rounded-lg border border-white/10 bg-white/[0.025] p-3">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3">
          <span className="text-sm font-black text-slate-200">Review or correct individual details</span>
          <span className="grid h-7 w-7 place-items-center rounded-full border border-white/10 text-sm font-black text-cyan-200 transition group-open:rotate-45">+</span>
        </summary>
        <div className="mt-4 grid gap-4 border-t border-white/10 pt-4 xl:grid-cols-2">
          {(["your_situation", "what_matters_most", "preferences_and_requirements", "uncertainty_and_tradeoffs"] as const).map((group) => (
            <section className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.035] p-4" key={group}>
              <h4 className="text-sm font-black text-white">{confirmationGroupLabel(group)}</h4>
              {getConfirmationItemsForGroup(draft, group).length ? (
                <ul className="grid gap-3">
                  {getConfirmationItemsForGroup(draft, group).map((item) => (
                    <li className="grid gap-3 rounded-lg border border-white/10 bg-slate-950/35 p-3" key={item.id}>
                    <div className="grid gap-1">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-black text-white">{item.label}</p>
                          <p className="text-sm font-semibold leading-6 text-slate-300">{item.displayValue}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <StatusBadge certainty={item.certainty} />
                          <RecommendationSupportBadge support={item.recommendationSupport} />
                          {!item.policyDimension ? (
                            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-black uppercase tracking-[0.08em] text-slate-300">
                              {item.constraintStrength}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      {item.evidencePhrase ? (
                        <p className="text-xs font-bold text-slate-500">Evidence: &quot;{item.evidencePhrase}&quot;</p>
                      ) : null}
                      {item.recommendationSupport === "understood_not_ranked" ? (
                        <p className="text-xs font-bold leading-5 text-slate-400">
                          I understood this and will keep it in view, but the current car data cannot compare it reliably yet.
                        </p>
                      ) : null}
                    </div>

                    {editingItemId === item.id ? (
                      <div className="grid gap-2">
                        <input
                          className="min-h-10 rounded-lg border border-white/10 bg-slate-950/70 px-3 text-sm font-semibold text-white outline-none transition focus:border-cyan-300/80 focus:ring-4 focus:ring-cyan-300/15"
                          onChange={(event) => setEditingValue(event.target.value)}
                          type={item.editableType === "number" ? "number" : "text"}
                          value={editingValue}
                        />
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="min-h-9 rounded-lg border border-cyan-300/40 bg-cyan-300 px-3 text-xs font-black text-slate-950 transition hover:bg-cyan-200"
                            onClick={() => saveEdit(item)}
                            type="button"
                          >
                            Save
                          </button>
                          <button
                            className="min-h-9 rounded-lg border border-white/10 bg-white/[0.05] px-3 text-xs font-black text-slate-200 transition hover:border-white/30"
                            onClick={() => setEditingItemId(null)}
                            type="button"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {!item.policyDimension ? (
                          <button
                            className="min-h-9 rounded-lg border border-white/10 bg-white/[0.05] px-3 text-xs font-black text-slate-200 transition hover:border-cyan-300/50 hover:bg-cyan-300/10"
                            onClick={() => startEdit(item)}
                            type="button"
                          >
                            Change
                          </button>
                        ) : null}
                        {item.canRemove ? (
                          <button
                            className="min-h-9 rounded-lg border border-white/10 bg-transparent px-3 text-xs font-black text-slate-400 transition hover:border-rose-300/40 hover:text-rose-100"
                            onClick={() => onChangeDraft(removePreferenceItem(draft, item.id))}
                            type="button"
                          >
                            Remove
                          </button>
                        ) : null}
                        {!item.policyDimension && (item.group === "preferences_and_requirements" || item.field === "maxPurchaseBudget" || item.field === "drivetrainPreference") ? (
                          <ConstraintButtons
                            item={item}
                            onChange={(constraintStrength) =>
                              onChangeDraft(updateConfirmedPreferenceItem(draft, item.id, { constraintStrength, certainty: "confirmed" }))
                            }
                          />
                        ) : null}
                      </div>
                    )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm font-semibold leading-6 text-slate-400">Nothing in this group yet.</p>
              )}
            </section>
          ))}
        </div>
      </details>

      {approvedDraft?.userApproved ? (
        <div className="rounded-lg border border-emerald-300/25 bg-emerald-300/[0.08] p-4">
          <p className="text-sm font-black text-emerald-50">Your preferences are confirmed. Next, I&apos;ll check the car list against them.</p>
        </div>
      ) : null}

      {hasBlockingIssue ? (
        <div className="rounded-lg border border-amber-300/25 bg-amber-300/[0.08] p-4">
          <p className="text-sm font-bold leading-6 text-amber-50">
            I need a maximum budget so I don’t recommend cars that are unrealistic for you.
          </p>
        </div>
      ) : null}

      {!hasBlockingIssue && !readiness.ready ? (
        <div className="rounded-lg border border-amber-300/25 bg-amber-300/[0.08] p-4">
          <p className="text-sm font-black text-amber-50">Let’s narrow it down together.</p>
          <p className="mt-1 text-sm font-bold leading-6 text-amber-50/90">{communication.readinessMessage}</p>
          {readiness.preservedContext.length ? (
            <p className="mt-2 text-xs font-bold leading-5 text-amber-50/75">
              I’ll preserve {readiness.preservedContext.map((item) => item.label.toLowerCase()).join(", ")}, but today&apos;s ranking cannot score it directly.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        {!hasBlockingIssue && readiness.ready ? (
          <button
            className="min-h-11 rounded-lg border border-cyan-300/40 bg-cyan-300 px-4 text-sm font-black text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.05] disabled:text-slate-500"
            disabled={isRecommendationRunning}
            onClick={() => onApprove(draft)}
            type="button"
          >
            {isRecommendationRunning ? "Checking cars" : "Find Cars"}
          </button>
        ) : (
          <button
            className="min-h-11 rounded-lg border border-cyan-300/40 bg-cyan-300 px-4 text-sm font-black text-slate-950 transition hover:bg-cyan-200"
            onClick={onAskAnotherQuestion}
            type="button"
          >
            Answer one more question
          </button>
        )}
        {!hasBlockingIssue && readiness.ready ? (
          <button
            className="min-h-11 rounded-lg border border-white/10 bg-white/[0.05] px-4 text-sm font-black text-slate-200 transition hover:border-cyan-300/50 hover:bg-cyan-300/10"
            onClick={onAskAnotherQuestion}
            type="button"
          >
            Ask another question
          </button>
        ) : null}
        <button
          className="min-h-11 rounded-lg border border-white/10 bg-transparent px-4 text-sm font-black text-slate-400 transition hover:border-white/30 hover:text-slate-100"
          onClick={onStartOver}
          type="button"
        >
          Start over
        </button>
      </div>
    </section>
  );
}

function ConfirmationPolicySummary({ summary }: { summary: AdvisorPolicySummary }) {
  const sections = [
    { title: "What I’ll prioritize", items: summary.priorities },
    { title: "Requirements", items: summary.requirements },
    { title: "What I’ll leave flexible", items: summary.flexible },
    { title: "What I won’t use", items: summary.ignored },
    { title: "What I still need to know", items: summary.unresolved },
    { title: "Understood, but not scored", items: summary.understoodNotScored },
  ].filter((section) => section.items.length);

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {sections.map((section) => (
        <section className="rounded-lg border border-white/10 bg-white/[0.035] p-4" key={section.title}>
          <h4 className="text-sm font-black text-white">{section.title}</h4>
          <ul className="mt-2 grid gap-1 text-sm font-semibold leading-6 text-slate-300">
            {section.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function AdvisorRefinementPanel({
  isRunning,
  onChange,
  onSubmit,
  value,
}: {
  isRunning: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  value: string;
}) {
  return (
    <section className="rounded-lg border border-cyan-200/15 bg-cyan-200/[0.04] p-4 md:p-5">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-cyan-200">Adjust the recommendation</p>
      <h3 className="mt-1 text-lg font-black text-white">Tell me what you want to change.</h3>
      <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">
        I’ll keep the preferences you already confirmed and update only what your follow-up changes.
      </p>
      <label className="mt-4 grid gap-2" htmlFor="advisor-follow-up">
        <span className="sr-only">Describe a change to the current recommendation</span>
        <textarea
          className="min-h-24 resize-y rounded-lg border border-white/10 bg-slate-950/55 px-3 py-3 text-sm font-semibold leading-6 text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/80 focus:ring-4 focus:ring-cyan-300/15"
          id="advisor-follow-up"
          onChange={(event) => onChange(event.target.value)}
          placeholder="Make safety less important, use a $30,000 limit, or show me something faster..."
          value={value}
        />
      </label>
      <button
        className="mt-3 min-h-11 rounded-lg border border-cyan-300/40 bg-cyan-300 px-4 text-sm font-black text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.05] disabled:text-slate-500"
        disabled={!value.trim() || isRunning}
        onClick={onSubmit}
        type="button"
      >
        {isRunning ? "Updating" : "Update my recommendation"}
      </button>
    </section>
  );
}

function ConstraintButtons({ item, onChange }: { item: ConfirmedPreferenceItem; onChange: (value: ConstraintStrength) => void }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border border-white/10 bg-black/15 p-1">
      {(["required", "preferred", "flexible"] as ConstraintStrength[]).map((option) => (
        <button
          className={`min-h-8 rounded-md px-2.5 text-xs font-black uppercase tracking-[0.08em] transition ${
            item.constraintStrength === option ? "bg-cyan-300 text-slate-950" : "text-slate-400 hover:bg-white/[0.06] hover:text-slate-100"
          }`}
          key={option}
          onClick={() => onChange(option)}
          type="button"
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function StatusBadge({ certainty }: { certainty: ConfirmationCertainty }) {
  const labels: Record<ConfirmationCertainty, string> = {
    confirmed: "User provided",
    inferred: "Please review",
    needs_answer: "Still open",
    assumed_default: "Working assumption",
  };
  return (
    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-black uppercase tracking-[0.08em] text-slate-200">
      {labels[certainty]}
    </span>
  );
}

function RecommendationSupportBadge({ support }: { support: ConfirmedPreferenceItem["recommendationSupport"] }) {
  const label = support === "used_in_recommendation" ? "Affects the search" : "Remembered context";
  const className =
    support === "used_in_recommendation"
      ? "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-100"
      : "border-amber-300/20 bg-amber-300/[0.08] text-amber-100";

  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-black uppercase tracking-[0.08em] ${className}`}>
      {label}
    </span>
  );
}

function getConfirmationItemsForGroup(draft: ConfirmedPreferenceProfile, group: ConfirmedPreferenceItem["group"]) {
  if (group !== "uncertainty_and_tradeoffs") return draft.items.filter((item) => item.group === group);
  const conflictItems: ConfirmedPreferenceItem[] = draft.conflicts.map((conflict) => ({
    id: `conflict:${conflict.topic}`,
    group,
    label: conflict.topic,
    field: undefined,
    value: conflict.description,
    displayValue: conflict.description,
    certainty: "needs_answer" as ConfirmationCertainty,
    constraintStrength: "flexible" as ConstraintStrength,
    recommendationSupport: "understood_not_ranked",
    evidencePhrase: conflict.evidencePhrases.join(", "),
    userEdited: false,
    editableType: "text" as const,
    canRemove: false,
  }));
  return [...draft.items.filter((item) => item.group === group), ...conflictItems];
}

function confirmationGroupLabel(group: ConfirmedPreferenceItem["group"]) {
  const labels: Record<ConfirmedPreferenceItem["group"], string> = {
    your_situation: "Situation",
    what_matters_most: "Priorities",
    preferences_and_requirements: "Preferences and Requirements",
    uncertainty_and_tradeoffs: "Uncertainty",
  };
  return labels[group];
}

function ComparisonView({
  decisionReport,
  decisionSet,
  profile,
  vehicles,
}: {
  decisionReport: ReturnType<typeof buildDecisionReport>;
  decisionSet: ReturnType<typeof getRecommendationDecisionSet>;
  profile: BuyerProfile;
  vehicles: ScoredVehicle[];
}) {
  if (!vehicles.length) {
    return (
      <section className="grid gap-4">
        <div>
          <h2 className="text-2xl font-black text-white">Comparison</h2>
          <p className="text-sm font-semibold text-slate-400">No match. There are no cars to compare under the current requirements.</p>
        </div>
        <NoMatchPanel decisionReport={decisionReport} decisionSet={decisionSet} profile={profile} />
      </section>
    );
  }

  return (
    <section className="grid gap-4">
      <div>
        <h2 className="text-2xl font-black text-white">Comparison</h2>
        <p className="text-sm font-semibold text-slate-400">
          Add cars from Advisor to compare, or review the top three matches by default.
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-white/10 bg-white/[0.055] shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur">
        <div className="grid min-w-[920px]" style={{ gridTemplateColumns: `180px repeat(${vehicles.length}, minmax(210px, 1fr))` }}>
          <CompareLabel label="Vehicle" />
          {vehicles.map((vehicle) => (
            <div className="border-b border-white/10 p-4" key={vehicle.id}>
              <div className="aspect-[16/10] overflow-hidden rounded-lg bg-slate-900">
                {vehicle.imageUrl && vehicle.imageVerified ? (
                  <img alt={`${vehicle.make} ${vehicle.model}`} className="h-full w-full object-cover" src={vehicle.imageUrl} />
                ) : (
                  <div aria-hidden="true" className="relative h-full bg-slate-900">
                    <div className="absolute inset-x-5 bottom-8 h-8 rounded-t-full border border-white/10 bg-white/[0.035]" />
                    <div className="absolute bottom-6 left-1/2 h-2.5 w-20 -translate-x-1/2 rounded-full bg-cyan-300/18" />
                    <div className="absolute bottom-5 left-[34%] h-4 w-4 rounded-full border border-white/15 bg-slate-950" />
                    <div className="absolute bottom-5 right-[34%] h-4 w-4 rounded-full border border-white/15 bg-slate-950" />
                  </div>
                )}
              </div>
              <h3 className="mt-3 text-lg font-black text-white">
                {vehicle.make} {vehicle.model}
              </h3>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-cyan-300">{vehicle.year} · {vehicle.bodyType}</p>
            </div>
          ))}
          <CompareRow label="Overall match" values={vehicles.map((vehicle) => `${vehicle.matchSummary.overall}/100`)} />
          <CompareRow label="Affordability" values={vehicles.map((vehicle) => `${vehicle.matchSummary.affordability}/100`)} />
          <CompareRow label="Reliability match" values={vehicles.map((vehicle) => `${vehicle.matchSummary.reliability}/100`)} />
          <CompareRow label="Safety match" values={vehicles.map((vehicle) => `${vehicle.matchSummary.safety}/100`)} />
          <CompareRow label="Fuel cost" values={vehicles.map((vehicle) => `${vehicle.matchSummary.fuelEnergyCost}/100`)} />
          <CompareRow label="Insurance cost" values={vehicles.map((vehicle) => `${vehicle.matchSummary.insuranceCost}/100`)} />
          <CompareRow label="Maintenance risk" values={vehicles.map((vehicle) => `${vehicle.matchSummary.maintenanceRisk}/100`)} />
          <CompareRow label="Practicality" values={vehicles.map((vehicle) => `${vehicle.matchSummary.practicality}/100`)} />
          <CompareRow label="Driving fit" values={vehicles.map((vehicle) => `${vehicle.matchSummary.drivingPreferenceFit}/100`)} />
          <CompareRow label="Confidence" values={vehicles.map((vehicle) => `${vehicle.confidence.score}/100 ${vehicle.confidence.level}`)} />
          <CompareRow label="Price" values={vehicles.map((vehicle) => formatMoney(vehicle.price))} />
          <CompareRow label="Mileage" values={vehicles.map((vehicle) => formatNumber(vehicle.mileage))} />
          <CompareRow label="Insurance" values={vehicles.map((vehicle) => `${formatMoney(vehicle.ownership.insuranceMonthly)}/mo`)} />
          <CompareRow label="Maintenance" values={vehicles.map((vehicle) => `${formatMoney(vehicle.ownership.maintenanceMonthly)}/mo`)} />
          <CompareRow label="Fuel" values={vehicles.map((vehicle) => `${formatMoney(vehicle.ownership.fuelMonthly)}/mo`)} />
          <CompareRow label="Top pros" values={vehicles.map((vehicle) => vehicle.pros.slice(0, 2).join(", "))} />
          <CompareRow label="Watchouts" values={vehicles.map((vehicle) => vehicle.watchouts.slice(0, 2).join(", "))} />
        </div>
      </div>
    </section>
  );
}

function NoMatchPanel({
  decisionReport,
  decisionSet,
  onAdjust,
  profile,
}: {
  decisionReport: ReturnType<typeof buildDecisionReport>;
  decisionSet: ReturnType<typeof getRecommendationDecisionSet>;
  onAdjust?: () => void;
  profile: BuyerProfile;
}) {
  const communication = useMemo(
    () => buildAdvisorCommunicationViewModel({ decisionReport, decisionSet, profile }),
    [decisionReport, decisionSet, profile],
  );

  return (
    <div className="grid gap-4">
      <section className="rounded-lg border border-amber-300/25 bg-amber-300/10 p-5 shadow-[0_24px_70px_rgba(0,0,0,0.22)]">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-100">Advisor</p>
        <h3 className="mt-2 max-w-4xl text-2xl font-black tracking-tight text-amber-50">
          {communication.advisorHeadline}
        </h3>
        <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-amber-50/85">
          {communication.noMatch?.explanation}
        </p>
        <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-amber-50">
          {communication.mainTradeoff}
        </p>
        {communication.noMatch?.actions.length ? (
          <div className="mt-4 flex flex-wrap gap-2" aria-label="Possible next steps">
            {communication.noMatch.actions.map((action) => (
              <span
                className="rounded-full border border-amber-100/20 bg-amber-100/[0.07] px-3 py-1.5 text-xs font-bold text-amber-50/85"
                key={action}
              >
                {action}
              </span>
            ))}
          </div>
        ) : null}
        {onAdjust ? (
          <button
            className="mt-5 min-h-11 rounded-lg border border-amber-200/30 bg-amber-200/15 px-4 text-sm font-black text-amber-50 transition hover:bg-amber-200/25"
            onClick={onAdjust}
            type="button"
          >
            Adjust the requirements
          </button>
        ) : null}
      </section>
      <details className="group rounded-lg border border-white/10 bg-white/[0.035] p-4">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3">
          <span className="text-sm font-black text-slate-200">Why no car qualified</span>
          <span className="grid h-7 w-7 place-items-center rounded-full border border-white/10 text-sm font-black text-cyan-200 transition group-open:rotate-45">+</span>
        </summary>
        <div className="mt-4 grid gap-3 border-t border-white/10 pt-4">
          {(communication.noMatch?.blockers || []).map((blocker) => (
            <p className="rounded-lg border border-white/10 bg-slate-950/35 px-3 py-2 text-sm font-semibold leading-6 text-slate-300" key={blocker}>
              {blocker}
            </p>
          ))}
          <p className="text-xs font-bold leading-5 text-slate-500">
            Catalog reviewed: {decisionSet.pipelineDebug.catalogCount}. Excluded: {decisionSet.pipelineDebug.excludedCount}.
          </p>
        </div>
      </details>
    </div>
  );
}

function CompareLabel({ label }: { label: string }) {
  return <div className="border-b border-white/10 p-4 text-xs font-black uppercase tracking-[0.12em] text-slate-500">{label}</div>;
}

function CompareRow({ label, values }: { label: string; values: string[] }) {
  return (
    <>
      <CompareLabel label={label} />
      {values.map((value, index) => (
        <div className="border-b border-white/10 p-4 text-sm font-bold leading-6 text-slate-200" key={`${label}-${index}`}>
          {value}
        </div>
      ))}
    </>
  );
}

function NavButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      className={`min-h-10 rounded-lg border px-4 text-sm font-black transition ${
        active
          ? "border-cyan-300 bg-cyan-300 text-slate-950"
          : "border-white/10 bg-white/5 text-slate-300 hover:border-cyan-300/50 hover:bg-cyan-300/10"
      }`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function QuestionGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-white/10 bg-slate-950/35 p-3" open>
      <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 text-xs font-black uppercase tracking-[0.12em] text-slate-400">
        {title}
        <span className="text-slate-500 group-open:hidden">Open</span>
        <span className="hidden text-slate-500 group-open:inline">Close</span>
      </summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{children}</div>
    </details>
  );
}

function NumberField({
  impact,
  label,
  meta,
  field,
  step,
  profile,
  setProfile,
}: {
  impact?: string;
  label: string;
  meta?: FineTuneFieldMeta;
  field: NumericField;
  step: number;
  profile: BuyerProfile;
  setProfile: (profile: BuyerProfile) => void;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-black uppercase tracking-[0.1em] text-slate-400">
      <span>{label}</span>
      <input
        className="h-11 rounded-lg border border-white/10 bg-slate-950/50 px-3 text-sm font-extrabold text-white outline-none transition focus:border-cyan-300/80 focus:ring-4 focus:ring-cyan-300/15"
        min={0}
        onChange={(event) => setProfile({ ...profile, [field]: Number(event.target.value) || 0 })}
        step={step}
        type="number"
        value={profile[field] ?? ""}
      />
      <FieldMetaLine impact={impact} meta={meta} />
    </label>
  );
}

function RangeField({
  meta,
  label,
  field,
  profile,
  setProfile,
}: {
  meta?: FineTuneFieldMeta;
  label: string;
  field: NumericField;
  profile: BuyerProfile;
  setProfile: (profile: BuyerProfile) => void;
}) {
  return (
    <label className="grid gap-2 text-xs font-black uppercase tracking-[0.1em] text-slate-400">
      <span className="flex items-center justify-between gap-2">
        {label}
        <strong className="text-white">{profile[field]}/5</strong>
      </span>
      <input
        className="h-8 accent-cyan-300"
        max={5}
        min={1}
        onChange={(event) => setProfile({ ...profile, [field]: Number(event.target.value) })}
        step={1}
        type="range"
        value={profile[field] ?? 1}
      />
      <FieldMetaLine meta={meta} />
    </label>
  );
}

function WeightField({
  field,
  label,
  value,
  normalizedValue,
  onChange,
}: {
  field: ScoreWeightField;
  label: string;
  value: number;
  normalizedValue: number;
  onChange: (field: ScoreWeightField, value: number) => void;
}) {
  return (
    <label className="grid gap-2 text-xs font-black uppercase tracking-[0.1em] text-slate-400">
      <span className="flex items-center justify-between gap-2">
        {label}
        <strong className="text-white">{normalizedValue}%</strong>
      </span>
      <div className="grid grid-cols-[minmax(0,1fr)_72px] gap-2">
        <input
          className="h-8 accent-cyan-300"
          max={50}
          min={0}
          onChange={(event) => onChange(field, Number(event.target.value))}
          step={1}
          type="range"
          value={value}
        />
        <input
          aria-label={`${label} weight value`}
          className="h-9 rounded-lg border border-white/10 bg-slate-950/50 px-2 text-sm font-extrabold text-white outline-none transition focus:border-cyan-300/80 focus:ring-4 focus:ring-cyan-300/15"
          max={50}
          min={0}
          onChange={(event) => onChange(field, Number(event.target.value))}
          step={1}
          type="number"
          value={value}
        />
      </div>
    </label>
  );
}

function SelectField({
  impact,
  label,
  meta,
  value,
  onChange,
  options,
}: {
  impact?: string;
  label: string;
  meta?: FineTuneFieldMeta;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-black uppercase tracking-[0.1em] text-slate-400">
      <span>{label}</span>
      <select
        className="h-11 rounded-lg border border-white/10 bg-slate-950/50 px-3 text-sm font-extrabold text-white outline-none transition focus:border-cyan-300/80 focus:ring-4 focus:ring-cyan-300/15"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map(([optionValue, labelText]) => (
          <option key={optionValue} value={optionValue}>
            {labelText}
          </option>
        ))}
      </select>
      <FieldMetaLine impact={impact} meta={meta} />
    </label>
  );
}

function MakePreferenceField({
  makeValue,
  metadata,
  onChange,
  strength,
}: {
  makeValue: string;
  metadata?: FineTuneFieldMeta;
  onChange: (value: string, strength: ConstraintStrength | "not-set") => void;
  strength: ConstraintStrength | "not-set";
}) {
  const [draftMake, setDraftMake] = useState(makeValue);
  const [draftStrength, setDraftStrength] = useState<ConstraintStrength | "not-set">(strength);

  useEffect(() => {
    setDraftMake(makeValue);
    setDraftStrength(strength);
  }, [makeValue, strength]);

  return (
    <div className="grid gap-1.5 text-xs font-black uppercase tracking-[0.1em] text-slate-400">
      <span>Make</span>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px]">
        <input
          className="h-11 rounded-lg border border-white/10 bg-slate-950/50 px-3 text-sm font-extrabold normal-case tracking-normal text-white outline-none transition focus:border-cyan-300/80 focus:ring-4 focus:ring-cyan-300/15"
          onBlur={() => onChange(draftMake, draftStrength)}
          onChange={(event) => setDraftMake(event.target.value)}
          placeholder="Any make"
          value={draftMake}
        />
        <select
          className="h-11 rounded-lg border border-white/10 bg-slate-950/50 px-3 text-sm font-extrabold text-white outline-none transition focus:border-cyan-300/80 focus:ring-4 focus:ring-cyan-300/15"
          onChange={(event) => {
            const nextStrength = event.target.value as ConstraintStrength | "not-set";
            setDraftStrength(nextStrength);
            onChange(draftMake, nextStrength);
          }}
          value={draftStrength}
        >
          <option value="not-set">Any</option>
          <option value="preferred">Preferred</option>
          <option value="required">Required</option>
        </select>
      </div>
      <FieldMetaLine
        impact={
          draftStrength === "required"
            ? "Cars from other makes will be excluded."
            : draftStrength === "preferred"
              ? "This influences ranking but does not remove alternatives."
              : undefined
        }
        meta={metadata}
      />
    </div>
  );
}

function FieldMetaLine({ impact, meta }: { impact?: string; meta?: FineTuneFieldMeta }) {
  if (!meta && !impact) return null;
  return (
    <span className="text-[0.68rem] font-bold normal-case leading-5 tracking-normal text-slate-500">
      {meta ? `${meta.certainty === "assumed_default" ? "default" : meta.certainty} · ${meta.source.replace("-", " ")}${meta.constraintStrength !== "not-set" ? ` · ${meta.constraintStrength}` : ""}` : null}
      {meta && impact ? " · " : null}
      {impact}
    </span>
  );
}

function getComparedVehicles(vehicles: ScoredVehicle[], compareIds: string[]) {
  const selectedVehicles = vehicles.filter((vehicle) => compareIds.includes(vehicle.id));
  return selectedVehicles.length ? selectedVehicles : vehicles.slice(0, 3);
}

function createSearchSnapshot({
  decisionReport,
  decisionSet,
  profile,
  rankedVehicles,
  sessionId,
  source,
}: {
  decisionReport: DecisionReport;
  decisionSet: RecommendationDecisionSet;
  profile: BuyerProfile;
  rankedVehicles: ScoredVehicle[];
  sessionId: string;
  source: RecommendationSearchSnapshot["source"];
}): RecommendationSearchSnapshot {
  return {
    decisionReport,
    decisionSet,
    inputFingerprint: fingerprintProfile(profile),
    profile,
    rankedVehicles,
    resultFingerprint: fingerprintDecisionSet(decisionSet),
    sessionId,
    source,
  };
}

function createRecommendationSessionId(sequence: number) {
  return `search-${sequence}-${Date.now().toString(36)}`;
}

function fingerprintProfile(profile: BuyerProfile) {
  return stableFingerprint({
    bodyStyle: profile.bodyStyle,
    budget: profile.maxPurchaseBudget,
    drivetrain: profile.drivetrainPreference,
    allowedMakes: profile.allowedMakes || [],
    excludedMakes: profile.excludedMakes || [],
    familySize: profile.familySize,
    flexibleConstraints: profile.flexibleConstraints || [],
    fuelType: profile.requiredFuelType,
    maxMileage: profile.maxMileage,
    minYear: profile.minYear,
    requiredMake: profile.requiredMake,
    transmission: profile.transmissionPreference,
  });
}

function fingerprintDecisionSet(decisionSet: RecommendationDecisionSet) {
  return stableFingerprint({
    compromise: decisionSet.compromiseRecommendations.map((item) => item.vehicleId),
    excludedCount: decisionSet.pipelineDebug.excludedCount,
    noMatch: decisionSet.noMatch.noMatch,
    qualified: decisionSet.primaryRecommendations.map((item) => item.vehicleId),
    top: decisionSet.primaryRecommendations[0]?.vehicleId || "no-match",
  });
}

function stableFingerprint(value: unknown) {
  return JSON.stringify(value);
}

function logRecommendationDiagnostics(snapshot: Omit<RecommendationSearchSnapshot, "inputFingerprint" | "resultFingerprint">) {
  if (process.env.NODE_ENV !== "development") return;
  console.debug("[advisor-recommendation-diagnostics]", {
    buyerProfile: {
      bodyStyle: snapshot.profile.bodyStyle,
      budget: snapshot.profile.maxPurchaseBudget,
      allowedMakes: snapshot.profile.allowedMakes || [],
      excludedMakes: snapshot.profile.excludedMakes || [],
      flexibleConstraints: snapshot.profile.flexibleConstraints || [],
      requiredFuelType: snapshot.profile.requiredFuelType,
      requiredMake: snapshot.profile.requiredMake,
    },
    candidateCount: snapshot.decisionSet.pipelineDebug.candidateCount,
    compromiseCount: snapshot.decisionSet.pipelineDebug.compromiseCount,
    inputFingerprint: fingerprintProfile(snapshot.profile),
    qualifiedCount: snapshot.decisionSet.pipelineDebug.qualifiedCount,
    resultFingerprint: fingerprintDecisionSet(snapshot.decisionSet),
    sessionId: snapshot.sessionId,
    source: snapshot.source,
    visibleWinner: snapshot.decisionSet.primaryRecommendations[0]?.vehicleId || null,
  });
}

function getNoMatchReasons(profile: BuyerProfile, vehicles: Vehicle[]) {
  const counts = new Map<string, number>();
  vehicles.forEach((vehicle) => {
    getVehicleRequirementMisses(vehicle, profile).forEach((miss) => {
      counts.set(miss, (counts.get(miss) || 0) + 1);
    });
  });

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([reason, count]) => `${reason} (${count} car${count === 1 ? "" : "s"})`);
}

function getConstraintStrengthForProfileField(profile: BuyerProfile, field: keyof BuyerProfile): ConstraintStrength | "not-set" {
  if (field === "requiredMake" || (field === "preferredMake" && profile.requiredMake)) return "required";
  if (field === "preferredMake") return profile.preferredMake ? "preferred" : "not-set";
  if (field === "monthlyBudget") return profile.monthlyBudget > 0 ? "required" : "not-set";
  if (field === "bodyStyle") return profile.bodyStyle !== "any" ? "required" : "not-set";
  if (field === "drivetrainPreference") return profile.drivetrainPreference !== "any" ? "required" : "not-set";
  if (field === "transmissionPreference") return profile.transmissionPreference !== "any" ? "required" : "not-set";
  if (field === "purchaseCondition") return profile.purchaseCondition !== "any" ? "required" : "not-set";
  if (field === "reliabilityMinimum" || field === "safetyMinimum" || field === "performanceMinimum") {
    return Number(profile[field] || 0) > 0 ? "required" : "not-set";
  }
  if (
    field === "maxPurchaseBudget" ||
    field === "maxMileage" ||
    field === "minYear" ||
    field === "familySize" ||
    field === "requiredFuelType"
  ) {
    return "required";
  }
  return "preferred";
}

function getManualConflictNote(previousProfile: BuyerProfile, nextProfile: BuyerProfile, field: keyof BuyerProfile) {
  if (field === "requiredMake" && !previousProfile.requiredMake && nextProfile.requiredMake) {
    return `You originally treated ${nextProfile.requiredMake} as a preference. I’ll now treat it as required.`;
  }
  if (field === "preferredMake" && previousProfile.requiredMake && !nextProfile.requiredMake) {
    return `You relaxed ${previousProfile.requiredMake} from required to preferred. I’ll allow other makes again.`;
  }
  if (field === "drivetrainPreference" && previousProfile.drivetrainPreference === "any" && nextProfile.drivetrainPreference !== "any") {
    return `You made ${nextProfile.drivetrainPreference} a requirement. Cars without it will be excluded after you update.`;
  }
  return "";
}

function getTopVehicleName(decisionSet: ReturnType<typeof getRecommendationDecisionSet>) {
  const vehicle = decisionSet.primaryRecommendations[0]?.vehicle;
  return vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : "No match";
}

function mergeFineTuneConversion(
  conversion: ConfirmedProfileConversion,
  profile: BuyerProfile,
  changedFields: Array<keyof BuyerProfile>,
  metadata: FineTuneMetadata,
): ConfirmedProfileConversion {
  const fieldsToReplace = new Set<keyof BuyerProfile>(changedFields);
  if (fieldsToReplace.has("requiredMake") || fieldsToReplace.has("preferredMake")) {
    fieldsToReplace.add("requiredMake");
    fieldsToReplace.add("preferredMake");
  }

  const removeChangedFields = (entry: ProfileConversionEntry) => !entry.field || !fieldsToReplace.has(entry.field);
  const nextHardConstraints = conversion.appliedHardConstraints.filter(removeChangedFields);
  const nextSoftPreferences = conversion.appliedSoftPreferences.filter(removeChangedFields);
  const nextPreservedDefaults = conversion.preservedDefaults.filter(removeChangedFields);
  const nextPreservedSemanticPreferences = conversion.preservedSemanticPreferences.filter(removeChangedFields);
  const nextUnresolvedFields = conversion.unresolvedFields.filter(removeChangedFields);

  changedFields.forEach((field) => {
    const entry = createFineTuneConversionEntry(profile, field, metadata[field]);
    if (!entry) return;
    if (entry.constraintStrength === "required") nextHardConstraints.push(entry);
    else nextSoftPreferences.push(entry);
  });

  const manualWarning = changedFields.length
    ? `Manual fine-tune edits applied: ${changedFields.map(getFineTuneFieldLabel).join(", ")}.`
    : "";
  const conversionWarnings = manualWarning
    ? Array.from(new Set([...conversion.conversionWarnings, manualWarning]))
    : conversion.conversionWarnings;

  return {
    ...conversion,
    buyerProfile: profile,
    appliedUpdates: {
      ...conversion.appliedUpdates,
      ...Object.fromEntries(changedFields.map((field) => [field, profile[field]])),
    },
    appliedHardConstraints: nextHardConstraints,
    appliedSoftPreferences: nextSoftPreferences,
    preservedSemanticPreferences: nextPreservedSemanticPreferences,
    preservedDefaults: nextPreservedDefaults,
    unresolvedFields: nextUnresolvedFields,
    disclosedAssumptions: nextPreservedDefaults.map((item) => `${item.label}: ${item.displayValue}`),
    conversionWarnings,
  };
}

function createFineTuneConversionEntry(
  profile: BuyerProfile,
  field: keyof BuyerProfile,
  meta?: FineTuneFieldMeta,
): ProfileConversionEntry | null {
  const value = getFineTuneProfileValue(profile, field);
  if (value === undefined || value === "" || value === "any" || value === "not-sure") return null;
  const constraintStrength = getConstraintStrengthForProfileField(profile, field);
  if (constraintStrength === "not-set") return null;
  const label = meta?.label || getFineTuneFieldLabel(field);
  return {
    field,
    label,
    value,
    displayValue: formatFineTuneProfileValue(field, value),
    constraintStrength,
    sourceItemId: `manual:${String(field)}`,
  };
}

function getFineTuneProfileValue(profile: BuyerProfile, field: keyof BuyerProfile): string | number | boolean | undefined {
  if (field === "requiredMake") return profile.requiredMake;
  if (field === "preferredMake") return profile.preferredMake;
  const value = profile[field];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === undefined) return value;
  return undefined;
}

function formatFineTuneProfileValue(field: keyof BuyerProfile, value: string | number | boolean) {
  if (
    field === "maxPurchaseBudget" ||
    field === "monthlyBudget" ||
    field === "downPayment" ||
    field === "insuranceBudget"
  ) {
    return formatMoney(Number(value));
  }
  if (field === "expectedAnnualMileage" || field === "maxMileage") return `${formatNumber(Number(value))} miles`;
  if (field === "minYear") return String(value);
  if (field === "familySize") return `${value} people`;
  if (field === "reliabilityMinimum" || field === "safetyMinimum" || field === "performanceMinimum") return `${value}/100 minimum`;
  if (field === "fuelPrice") return `${formatMoney(Number(value))}/gal`;
  if (field === "requiredMake" || field === "preferredMake") return String(value);
  return String(value).replace(/-/g, " ");
}

const fineTuneTrackedFields: Array<keyof BuyerProfile> = [
  "maxPurchaseBudget",
  "monthlyBudget",
  "downPayment",
  "paymentMethod",
  "insuranceBudget",
  "expectedAnnualMileage",
  "familySize",
  "cargoNeed",
  "climate",
  "requiredMake",
  "preferredMake",
  "bodyStyle",
  "drivetrainPreference",
  "transmissionPreference",
  "purchaseCondition",
  "performanceImportance",
  "reliabilityImportance",
  "reliabilityMinimum",
  "safetyPriority",
  "safetyMinimum",
  "maxMileage",
  "minYear",
];

function clearMakeState(profile: BuyerProfile): BuyerProfile {
  return {
    ...profile,
    requiredMake: undefined,
    preferredMake: undefined,
    allowedMakes: undefined,
    excludedMakes: undefined,
    decisionPolicies: undefined,
  };
}

function getFineTuneChangedFields(previousProfile: BuyerProfile, nextProfile: BuyerProfile): Array<keyof BuyerProfile> {
  return fineTuneTrackedFields.filter((field) => {
    const previousValue = getFineTuneProfileValue(previousProfile, field);
    const nextValue = getFineTuneProfileValue(nextProfile, field);
    return previousValue !== nextValue;
  });
}
