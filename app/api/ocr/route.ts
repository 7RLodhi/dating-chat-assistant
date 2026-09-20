import { NextRequest, NextResponse } from "next/server";
import { LLMError, transcribeImageToText } from "@/lib/llm";
import { OcrRequestBody } from "@/lib/types";

const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];
// Base64 is ~33% larger than raw bytes; 7M chars is roughly a 5MB image.
const MAX_BASE64_CHARS = 7_000_000;

export async function POST(req: NextRequest) {
  let body: OcrRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { imageBase64, mimeType, kind } = body;

  if (!imageBase64) {
    return NextResponse.json({ error: "imageBase64 is required." }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return NextResponse.json(
      { error: `Unsupported image type. Use one of: ${ALLOWED_MIME_TYPES.join(", ")}` },
      { status: 400 }
    );
  }
  if (imageBase64.length > MAX_BASE64_CHARS) {
    return NextResponse.json(
      { error: "Image too large (max ~5MB). Try a cropped screenshot." },
      { status: 400 }
    );
  }

  try {
    const text = await transcribeImageToText({ imageBase64, mimeType, kind });
    if (!text) {
      return NextResponse.json(
        { error: "Couldn't read any text from that image." },
        { status: 502 }
      );
    }
    return NextResponse.json({ text });
  } catch (err) {
    const message = err instanceof LLMError ? err.message : "Unexpected error.";
    // eslint-disable-next-line no-console
    console.error("ocr route error:", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
