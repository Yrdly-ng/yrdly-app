import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Public VAPID keys are designed for browsers. Never return the private key
// or a server API credential; the Supabase sender exposes only the public key.
export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    return NextResponse.json({ error: "web_push_unavailable" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const endpoint = new URL("/functions/v1/send-push-notification", supabaseUrl);
    if (endpoint.protocol !== "https:") throw new Error("Invalid backend URL");
    const response = await fetch(endpoint, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      return NextResponse.json({ error: "web_push_unavailable" }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
    const result: unknown = await response.json();
    const publicKey =
      typeof result === "object" && result && "publicKey" in result
        ? (result as { publicKey: unknown }).publicKey
        : null;
    if (typeof publicKey !== "string" ||
        !/^[A-Za-z0-9_-]{85,90}$/.test(publicKey)) {
      return NextResponse.json({ error: "web_push_unavailable" }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return NextResponse.json({ publicKey }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "web_push_unavailable" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
