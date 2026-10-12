"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function ProfilePicture({ src, name, className }: { src?: string | null; name: string; className?: string }) {
  const avatar = <Avatar className={className}>
    <AvatarImage src={src || undefined} alt={name} />
    <AvatarFallback>{name.charAt(0).toUpperCase()}</AvatarFallback>
  </Avatar>;
  if (!src) return avatar;
  return <Dialog>
    <DialogTrigger asChild>
      <button type="button" aria-label={`View ${name}'s profile picture`} className="block rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{avatar}</button>
    </DialogTrigger>
    <DialogContent className="max-w-2xl border-0 bg-background p-6">
      <DialogTitle className="sr-only">{`${name}'s profile picture`}</DialogTitle>
      <img src={src} alt={`${name}'s profile picture`} className="max-h-[80dvh] w-full object-contain" />
    </DialogContent>
  </Dialog>;
}
