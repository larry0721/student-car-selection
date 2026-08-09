import { NextResponse } from "next/server";
import {
  createSemanticUnderstandingService,
  validateSemanticUnderstandingRequestPayload,
} from "@/lib/semanticUnderstandingService";

const MAX_REQUEST_BYTES = 24_000;

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    if (rawBody.length > MAX_REQUEST_BYTES) {
      return NextResponse.json(
        { error: "Semantic understanding request is too large." },
        { status: 413 },
      );
    }

    const payload = JSON.parse(rawBody) as unknown;
    const semanticRequest = validateSemanticUnderstandingRequestPayload(payload);
    const service = createSemanticUnderstandingService();
    const result = await service.understand(semanticRequest);

    return NextResponse.json(result, {
      status: result.status === "fatal_failure" ? 500 : 200,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "recoverable_failure",
        error: error instanceof Error ? error.message : "Malformed semantic understanding request.",
      },
      { status: 400 },
    );
  }
}
