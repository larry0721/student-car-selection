import { NextResponse } from "next/server";
import {
  answerConversationQuestionWithSemantic,
  createSemanticConversationIntakeSession,
  type ConversationIntakeSession,
} from "@/lib/conversationIntake";
import { createSemanticUnderstandingService } from "@/lib/semanticUnderstandingService";

type AdvisorConversationRequest =
  | { action: "start"; message?: string }
  | { action: "answer"; answer?: string; session?: ConversationIntakeSession };

const MAX_REQUEST_BYTES = 48_000;

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    if (rawBody.length > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: "Advisor conversation request is too large." }, { status: 413 });
    }

    const payload = JSON.parse(rawBody) as AdvisorConversationRequest;
    const service = createSemanticUnderstandingService();

    if (payload.action === "start") {
      const message = String(payload.message || "").trim();
      if (!message) return NextResponse.json({ error: "Starting message is required." }, { status: 400 });
      const session = await createSemanticConversationIntakeSession(message, service);
      return NextResponse.json({ session });
    }

    if (payload.action === "answer") {
      const answer = String(payload.answer || "").trim();
      if (!answer || !payload.session) return NextResponse.json({ error: "Session and answer are required." }, { status: 400 });
      const session = await answerConversationQuestionWithSemantic(payload.session, answer, service);
      return NextResponse.json({ session });
    }

    return NextResponse.json({ error: "Unsupported advisor conversation action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not process advisor conversation." },
      { status: 400 },
    );
  }
}
