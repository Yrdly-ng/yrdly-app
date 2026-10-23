import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export const communityField =
  "w-full min-h-12 rounded-2xl border border-border bg-background px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 sm:text-sm";
export const communityButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50";
export const communityPrimaryButton =
  communityButton +
  " border-primary bg-primary text-primary-foreground hover:bg-primary/90";
export const communityDialog =
  "max-h-[calc(100dvh-2rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-y-auto rounded-3xl border-border bg-background p-5 font-yrdly-body sm:p-7";

export function communityInitials(name?: string | null) {
  return (
    (name || "Community")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "C"
  );
}

export function CommunityAvatar({
  name,
  src,
  className = "h-12 w-12",
}: {
  name?: string | null;
  src?: string | null;
  className?: string;
}) {
  return (
    <Avatar className={className + " rounded-2xl"}>
      <AvatarImage src={src || undefined} alt="" />
      <AvatarFallback className="rounded-2xl bg-primary/10 font-yrdly-display text-lg font-semibold text-primary">
        {communityInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
