"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

/** A fixed-size image and a visible fallback for missing or failed photos. */
export function NavigationAvatar({ profile }: { profile?: { avatar_url?: string | null; name?: string | null } | null }) {
  const name = profile?.name?.trim() || "Your profile";
  const src = profile?.avatar_url?.trim() || undefined;
  return (
    <Avatar className="h-8 w-8 shrink-0 rounded-full">
      <AvatarImage src={src} alt={`${name}'s avatar`} />
      <AvatarFallback className="bg-primary text-primary-foreground text-sm font-semibold">
        {name === "Your profile" ? "U" : Array.from(name)[0].toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}
