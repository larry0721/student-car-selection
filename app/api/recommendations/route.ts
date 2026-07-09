import { NextResponse } from "next/server";
import type { BuyerProfile } from "@/types/buyer";
import type { AiRecommendation, ScoredVehicle } from "@/types/vehicle";

type RecommendationRequest = {
  profile: BuyerProfile;
  vehicles: ScoredVehicle[];
};

export async function POST(request: Request) {
  const payload = (await request.json()) as RecommendationRequest;

  if (!payload.profile || !Array.isArray(payload.vehicles)) {
    return NextResponse.json({ error: "Profile and vehicles are required." }, { status: 400 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({
      configured: false,
      recommendations: buildFallbackRecommendations(payload.vehicles),
    });
  }

  try {
    const recommendations = await getOpenAiRecommendations(payload);
    return NextResponse.json({ configured: true, recommendations });
  } catch (error) {
    return NextResponse.json(
      {
        configured: false,
        error: error instanceof Error ? error.message : "Could not generate personalized recommendations.",
        recommendations: buildFallbackRecommendations(payload.vehicles),
      },
      { status: 200 },
    );
  }
}

async function getOpenAiRecommendations(payload: RecommendationRequest): Promise<AiRecommendation[]> {
  const model = process.env.OPENAI_RECOMMENDATION_MODEL || "gpt-4.1-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "You are a careful first-car buying advisor. Return concise JSON only. Do not recommend unsafe or unaffordable choices.",
        },
        {
          role: "user",
          content: JSON.stringify({
            task:
              "For each candidate, write a personalized summary, 2-3 reasons, and 2 watchouts for this first-time buyer.",
            responseShape: {
              recommendations: [
                {
                  vehicleId: "string",
                  summary: "string",
                  reasons: ["string"],
                  watchouts: ["string"],
                },
              ],
            },
            profile: payload.profile,
            vehicles: payload.vehicles.map((vehicle) => ({
              id: vehicle.id,
              name: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
              price: vehicle.price,
              mileage: vehicle.mileage,
              mpg: vehicle.mpg,
              insurance: vehicle.insurance,
              score: vehicle.score,
              scoreBreakdown: vehicle.scoreBreakdown,
              weightedContributions: vehicle.weightedContributions,
              reliabilityScore: vehicle.reliabilityScore,
              safetyScore: vehicle.safetyScore,
              ownership: vehicle.ownership,
              localReasons: vehicle.reasons,
              localWatchouts: vehicle.watchouts,
              commonIssues: vehicle.commonIssues,
              similarAlternatives: vehicle.similarAlternatives,
              buyingTips: vehicle.buyingTips,
            })),
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with status ${response.status}.`);
  }

  const data = await response.json();
  const text = getResponseText(data);

  if (!text) {
    throw new Error("OpenAI response did not include recommendation text.");
  }

  const parsed = JSON.parse(text) as { recommendations?: AiRecommendation[] };
  return normalizeRecommendations(parsed.recommendations || [], payload.vehicles);
}

function buildFallbackRecommendations(vehicles: ScoredVehicle[]): AiRecommendation[] {
  return vehicles.map((vehicle) => ({
    vehicleId: vehicle.id,
    summary: `${vehicle.make} ${vehicle.model} is a ${vehicle.score}/100 compatibility fit with estimated $${vehicle.ownership.insuranceMonthly}/mo insurance, $${vehicle.ownership.maintenanceMonthly}/mo maintenance, and $${vehicle.ownership.fuelMonthly}/mo fuel.`,
    reasons: vehicle.reasons.slice(0, 3),
    watchouts: vehicle.watchouts.slice(0, 2),
  }));
}

function getResponseText(data: unknown) {
  if (typeof data !== "object" || data === null) return "";
  const outputText = "output_text" in data ? data.output_text : undefined;
  if (typeof outputText === "string") return outputText;

  const output = "output" in data ? data.output : undefined;
  if (!Array.isArray(output)) return "";

  return output
    .flatMap((item) => {
      if (typeof item !== "object" || item === null || !("content" in item)) return [];
      return Array.isArray(item.content) ? item.content : [];
    })
    .map((content) => {
      if (typeof content !== "object" || content === null || !("text" in content)) return "";
      return typeof content.text === "string" ? content.text : "";
    })
    .join("")
    .trim();
}

function normalizeRecommendations(recommendations: AiRecommendation[], vehicles: ScoredVehicle[]) {
  const vehicleIds = new Set(vehicles.map((vehicle) => vehicle.id));

  return recommendations
    .filter((recommendation) => vehicleIds.has(recommendation.vehicleId))
    .map((recommendation) => ({
      vehicleId: recommendation.vehicleId,
      summary: String(recommendation.summary || "").slice(0, 260),
      reasons: normalizeNotes(recommendation.reasons).slice(0, 3),
      watchouts: normalizeNotes(recommendation.watchouts).slice(0, 2),
    }));
}

function normalizeNotes(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}
