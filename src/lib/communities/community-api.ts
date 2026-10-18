import { supabase } from "../supabase/supabase";
export const communityApi = {
  async post(path: string, body: unknown) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    if (!response.ok)
      throw new Error("Community processing temporarily unavailable");
    return response.json();
  },
};
