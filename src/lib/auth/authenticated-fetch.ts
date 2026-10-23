import { supabase } from "../supabase/supabase";

export async function authenticatedFetch<T = any>(
  path: string,
  body: unknown,
  method = "POST",
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session)
    throw Object.assign(new Error("Please sign in again."), { status: 401 });
  const response = await fetch(path, {
    method,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: ["GET", "HEAD"].includes(method.toUpperCase())
      ? undefined
      : JSON.stringify(body),
  });
  // Safari exposes a cryptic SyntaxError when an API gateway returns HTML or
  // an empty timeout response. Preserve HTTP status without leaking that parser
  // error (or the gateway document) into a payment form.
  let result: any;
  try {
    result = JSON.parse(await response.text());
  } catch {
    throw Object.assign(
      new Error(
        response.status === 401
          ? "Please sign in again."
          : "The service is temporarily unavailable. Please check My Tickets or your order before trying again.",
      ),
      { status: response.status, code: "INVALID_RESPONSE" },
    );
  }
  if (!response.ok)
    throw Object.assign(
      new Error(
        typeof result?.message === "string" ? result.message
          : typeof result?.error === "string" ? result.error : "Request failed",
      ),
      { status: response.status, code: result?.error },
    );
  return result;
}
