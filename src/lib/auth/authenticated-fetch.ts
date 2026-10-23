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
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(result.message || result.error || "Request failed"),
      { status: response.status, code: result.error },
    );
  return result;
}
