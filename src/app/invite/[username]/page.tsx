"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ShieldCheck, ArrowRight } from "lucide-react";

const FONT = "var(--font-work-sans)";
const RALEWAY = "var(--font-jersey25)";

export default function PublicInviteRedirectPage() {
  const params = useParams();
  const router = useRouter();
  const username = params?.username as string;

  const [inviter, setInviter] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!username) return;

    async function resolveInviter() {
      // Try username match first
      const { data: userByUsername } = await supabase
        .from("users")
        .select("id, name, username, avatar_url, verified")
        .ilike("username", username)
        .maybeSingle();

      if (userByUsername) {
        setInviter(userByUsername);
        setLoading(false);
        return;
      }

      // Try ID prefix match if 8 chars
      if (username.length >= 8) {
        const { data: userById } = await supabase
          .from("users")
          .select("id, name, username, avatar_url, verified")
          .filter("id", "gte", username)
          .limit(1)
          .maybeSingle();

        if (userById) {
          setInviter(userById);
          setLoading(false);
          return;
        }
      }

      setLoading(false);
    }

    resolveInviter();
  }, [username]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6 flex flex-col items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="mt-4 text-xs font-bold text-muted-foreground uppercase tracking-wider" style={{ fontFamily: FONT }}>
          Resolving invite link...
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6 text-center">
      <div className="max-w-md w-full p-8 rounded-3xl bg-card border border-border/40 space-y-6 shadow-2xl">
        {inviter ? (
          <>
            <Avatar className="w-20 h-20 mx-auto border-4 border-primary/20">
              <AvatarImage src={inviter.avatar_url} />
              <AvatarFallback className="bg-primary text-white text-2xl font-bold">
                {inviter.name?.charAt(0) || "U"}
              </AvatarFallback>
            </Avatar>

            <div className="space-y-1">
              <div className="flex items-center justify-center gap-1.5">
                <h1 className="text-2xl font-extrabold text-foreground" style={{ fontFamily: RALEWAY }}>
                  {inviter.name}
                </h1>
                {inviter.verified && <ShieldCheck className="w-5 h-5 text-primary" />}
              </div>
              <p className="text-xs text-muted-foreground" style={{ fontFamily: FONT }}>
                invited you to join their local network on Yrdly.
              </p>
            </div>

            <button
              onClick={() => router.push(`/profile/${inviter.id}`)}
              className="w-full py-3.5 rounded-2xl bg-primary text-primary-foreground font-bold text-sm shadow-lg hover:opacity-90 transition-all flex items-center justify-center gap-2"
              style={{ fontFamily: FONT }}
            >
              View Profile & Connect <ArrowRight className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-extrabold text-foreground" style={{ fontFamily: RALEWAY }}>
              Welcome to Yrdly!
            </h1>
            <p className="text-sm text-muted-foreground" style={{ fontFamily: FONT }}>
              Discover local neighborhood deals, events, and community alerts.
            </p>
            <button
              onClick={() => router.push("/")}
              className="w-full py-3.5 rounded-2xl bg-primary text-primary-foreground font-bold text-sm shadow-lg hover:opacity-90 transition-all flex items-center justify-center gap-2"
              style={{ fontFamily: FONT }}
            >
              Explore Yrdly <ArrowRight className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
