"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-supabase-auth";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, Camera, Plus, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { StorageService } from "@/lib/storage-service";

const NIGERIAN_STATES = ["Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno","Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT - Abuja","Gombe","Imo","Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nassarawa","Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba","Yobe","Zamfara"];

type Profile = {
  name: string;
  bio: string;
  avatar_url: string;
  location?: { state?: string; lga?: string; ward?: string };
};

export default function EditProfilePage() {
  const router = useRouter();
  const { user, profile: authProfile, updateProfile } = useAuth();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName]             = useState("");
  const [bio, setBio]               = useState("");
  const [avatarUrl, setAvatarUrl]   = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState("");

  const [saving, setSaving]         = useState(false);

  useEffect(() => {
    if (!authProfile) return;
    const p = authProfile as any;
    setName(p.name || "");
    setBio(p.bio || "");
    setAvatarUrl(p.avatar_url || "");

  }, [authProfile]);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      let finalAvatarUrl = avatarUrl;

      if (avatarFile) {
        const { url, error: uploadErr } = await StorageService.uploadUserAvatar(user.id, avatarFile);
        if (!uploadErr && url) {
          finalAvatarUrl = url;
        } else {
          console.error("Avatar upload failed:", uploadErr);
          throw new Error("Failed to upload profile picture. Please try again.");
        }
      }

      await updateProfile({
        name,
        bio,
        avatar_url: finalAvatarUrl,

        updated_at: new Date().toISOString(),
      });

      window.dispatchEvent(new Event("refresh-profile"));
      toast({ title: "Profile saved!", description: "Your changes have been saved." });
      router.back();
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Could not save profile.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-[100dvh] pb-36 bg-[var(--yrdly-dark)] font-yrdly-body text-foreground">

      {/* Sticky Header */}
      <header
        className="sticky top-[calc(4rem+env(safe-area-inset-top))] md:top-[calc(84px+env(safe-area-inset-top))] z-40 flex items-center justify-between px-6 py-4 bg-[var(--yrdly-dark)]/80 backdrop-blur-md border-b border-[var(--yrdly-glass-border)]"
      >
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full transition-colors hover:bg-accent">
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <h1 className="font-yrdly-display text-lg text-foreground font-bold">Edit Profile</h1>
        </div>
        <span className="font-yrdly-display text-xl font-extrabold text-primary">Yrdly</span>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-12">

        {/* ── Avatar ── */}
        <section className="flex flex-col items-center py-4">
          <div className="relative">
            <div className="absolute -inset-2 rounded-full border-2 border-dashed border-primary opacity-60 animate-spin" style={{ animationDuration: "8s" }} />
            <div className="relative w-24 h-24 rounded-full overflow-hidden border-4 border-[var(--yrdly-glass-border)]">
              <Avatar className="w-full h-full">
                <AvatarImage src={avatarPreview || avatarUrl} className="object-cover" />
                <AvatarFallback className="bg-primary text-primary-foreground text-2xl font-bold font-yrdly-display">
                  {name?.charAt(0)?.toUpperCase() || "U"}
                </AvatarFallback>
              </Avatar>
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              className="absolute bottom-0 right-0 w-8 h-8 rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-90 bg-primary text-primary-foreground"
              style={{ transform: "translate(4px, 4px)" }}
            >
              <Camera className="w-4 h-4" />
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
          </div>
          <p className="mt-6 text-sm text-[var(--yrdly-label)] font-yrdly-body">Change profile photo</p>
        </section>

        {/* ── Block 1: Identity ── */}
        <section className="space-y-6">
          <SectionHeader color="hsl(var(--primary))" label="Identity" />
          <div className="space-y-4">
            <Field label="Display Name">
              <input
                type="text" value={name} onChange={e => setName(e.target.value)}
                className="w-full rounded-full px-6 py-4 text-sm outline-none transition-all bg-[var(--yrdly-glass-bg)] border border-[var(--yrdly-glass-border)] text-foreground font-yrdly-body focus:border-primary"
              />
            </Field>
            <Field label="Bio">
              <div className="relative">
                <textarea
                  value={bio} onChange={e => setBio(e.target.value.slice(0, 150))} rows={3}
                  className="w-full px-6 py-4 text-sm outline-none resize-none transition-all rounded-2xl bg-[var(--yrdly-glass-bg)] border border-[var(--yrdly-glass-border)] text-foreground font-yrdly-body focus:border-primary"
                />
                <span className="absolute bottom-3 right-4 text-[0.625rem] text-[var(--yrdly-label)]">{bio.length}/150</span>
              </div>
            </Field>
          </div>
        </section>

        {/* ── Save bar ── */}
        <div className="pt-8">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-4 rounded-full flex items-center justify-center gap-3 text-primary-foreground font-extrabold uppercase tracking-[0.2em] transition-all active:scale-[0.98] shadow-lg bg-primary font-yrdly-body disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Changes"}
            {!saving && (
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5l-4-4 1.41-1.41L10 13.67l6.59-6.59L18 8.5l-8 8z"/></svg>
            )}
          </button>
        </div>
      </main>
    </div>
  );
}

/* ── Helper components ── */
function SectionHeader({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-1 h-6 rounded-full flex-shrink-0 bg-primary" />
      <h2 className="font-bold uppercase tracking-widest text-lg font-yrdly-display text-primary">{label}</h2>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-bold uppercase tracking-tighter ml-4 text-[var(--yrdly-label)] font-yrdly-body">{label}</label>
      {children}
    </div>
  );
}
