import type { SignupAttribution } from "./signup";

/**
 * Server-side event for first-time Google/Apple registrations. Runs only
 * after a verified Supabase OAuth session and successful profile bootstrap.
 * Project token is public, but no PII or raw visitor URL is sent.
 */
export async function captureNewOAuthAccount(
  userId: string,
  method: "google" | "apple",
  attribution: SignupAttribution,
): Promise<void> {
  if (process.env.VERCEL_ENV !== "production") return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY ||
    process.env.NEXT_PUBLIC_POSTHOG_API_KEY;
  if (!key || !/^[0-9a-f-]{36}$/i.test(userId)) return;
  const region = /^https:\/\/eu(?:\.i)?\.posthog\.com\/?$/.test(
    process.env.NEXT_PUBLIC_POSTHOG_HOST || "",
  ) ? "eu" : "us";
  try {
    const response = await fetch(`https://${region}.i.posthog.com/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        event: "account_created",
        properties: {
          distinct_id: userId,
          app_platform: "web",
          app_environment: "production",
          $geoip_disable: true,
          acquisition_first_source: attribution.first.source,
          acquisition_first_medium: attribution.first.medium,
          acquisition_first_campaign: attribution.first.campaign,
          acquisition_last_source: attribution.last.source,
          acquisition_last_medium: attribution.last.medium,
          acquisition_last_campaign: attribution.last.campaign,
          signup_method: method,
        },
      }),
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) console.warn("Signup analytics service unavailable");
  } catch {
    // User onboarding always proceeds even when optional analytics fails.
  }
}
