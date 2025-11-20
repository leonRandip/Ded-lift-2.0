import { NextRequest, NextResponse } from "next/server";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

export async function POST(request: NextRequest) {
  // Parse request body first so it's accessible in catch block
  let body: { text?: string; voiceId?: string; modelId?: string };
  try {
    body = await request.json();
  } catch (parseError) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    
    if (!apiKey) {
      return NextResponse.json(
        { error: "ElevenLabs API key not configured" },
        { status: 500 }
      );
    }

    // Initialize ElevenLabs client with API key
    const client = new ElevenLabsClient({
      apiKey: apiKey,
    });

    // Using newer model available on free tier: eleven_turbo_v2_5 or eleven_turbo_v2
    const { text, voiceId = "21m00Tcm4TlvDq8ikWAM", modelId = "eleven_turbo_v2_5" } = body;

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Text is required" },
        { status: 400 }
      );
    }

    // Use ElevenLabs SDK to generate speech
    const audioStream = await client.textToSpeech.convert(voiceId, {
      text: text,
      modelId: modelId,
      voiceSettings: {
        stability: 0.5,
        similarityBoost: 0.75,
      },
    });

    // Convert the ReadableStream to a buffer
    const reader = audioStream.getReader();
    const chunks: Uint8Array[] = [];
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Combine all chunks into a single buffer
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const audioBuffer = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      audioBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    // Return the audio as a blob
    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error("Error in text-to-speech API route:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    // Handle specific ElevenLabs errors
    if (error instanceof Error) {
      if (error.message.includes("401") || error.message.includes("Unauthorized")) {
        return NextResponse.json(
          { error: "Invalid API key. Please check your ElevenLabs API key." },
          { status: 401 }
        );
      }
      // Handle model errors
      if (error.message.includes("model") || error.message.includes("deprecated")) {
        console.error("Model error, trying fallback model");
        // Try with a different model as fallback
        if (!body.text || typeof body.text !== "string") {
          return NextResponse.json(
            { error: "Text is required" },
            { status: 400 }
          );
        }
        try {
          const fallbackClient = new ElevenLabsClient({
            apiKey: process.env.ELEVENLABS_API_KEY || "",
          });
          const fallbackStream = await fallbackClient.textToSpeech.convert(
            body.voiceId || "21m00Tcm4TlvDq8ikWAM",
            {
              text: body.text,
              modelId: "eleven_turbo_v2", // Fallback model
              voiceSettings: {
                stability: 0.5,
                similarityBoost: 0.75,
              },
            }
          );
          const reader = fallbackStream.getReader();
          const chunks: Uint8Array[] = [];
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) {
                chunks.push(value);
              }
            }
          } finally {
            reader.releaseLock();
          }
          const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
          const audioBuffer = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            audioBuffer.set(chunk, offset);
            offset += chunk.length;
          }
          return new NextResponse(audioBuffer, {
            status: 200,
            headers: {
              "Content-Type": "audio/mpeg",
              "Content-Length": audioBuffer.length.toString(),
            },
          });
        } catch (fallbackError) {
          console.error("Fallback model also failed:", fallbackError);
        }
      }
    }
    
    return NextResponse.json(
      { error: `Failed to generate speech: ${errorMessage}` },
      { status: 500 }
    );
  }
}

