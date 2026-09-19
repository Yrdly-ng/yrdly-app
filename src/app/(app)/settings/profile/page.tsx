"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-supabase-auth";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, Camera, User, Phone, Mail, Globe, Check, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { StorageService } from "@/lib/storage-service";
import { AuthService } from "@/lib/auth-service";

export default function EditProfilePage() {
  const router = useRouter();
  const { user, profile: authProfile, updateProfile } = useAuth();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [bio, setBio] = useState("");
  const [website, setWebsite] = useState("");
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);

  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  const bioMax = 140;

  useEffect(() => {
    if (!authProfile) return;
    const p = authProfile as any;
    setName(p.name || user?.user_metadata?.name || "");
    setHandle(p.username || "");
    setBio(p.bio || "");
    setWebsite(p.website || "");
  }, [authProfile, user]);

  const displayAvatar =
    avatarUri || (authProfile as any)?.avatar_url || user?.user_metadata?.avatar_url || "";

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarUri(URL.createObjectURL(file));
  };

  const handleSave = async () => {
    if (!user) return;
    if (!name.trim()) {
      toast({ title: "Validation Error", description: "Name is required.", variant: "destructive" });
      return;
    }

    const cleanHandle = handle.trim();
    if (cleanHandle) {
      const usernameRegex = /^[a-zA-Z0-9_.]{3,30}$/;
      if (!usernameRegex.test(cleanHandle)) {
        toast({
          title: "Validation Error",
          description: "Username must be 3-30 characters long and can only contain letters, numbers, underscores, and dots.",
          variant: "destructive",
        });
        return;
      }
    }

    setLoading(true);
    try {
      let finalAvatarUrl = (authProfile as any)?.avatar_url;

      if (avatarFile) {
        const { url, error: uploadErr } = await StorageService.uploadUserAvatar(user.id, avatarFile);
        if (!uploadErr && url) {
          finalAvatarUrl = url;
        } else {
          console.error("Avatar upload failed:", uploadErr);
          throw new Error("Failed to upload profile picture.");
        }
      }

      await AuthService.updateUserProfile(user.id, {
        name: name.trim(),
        username: cleanHandle || undefined,
        bio: bio.trim() || undefined,
        ...(finalAvatarUrl ? { avatar_url: finalAvatarUrl } : {}),
      });

      if (finalAvatarUrl) {
        await supabase.auth.updateUser({
          data: { avatar_url: finalAvatarUrl, name: name.trim() },
        });
      }

      window.dispatchEvent(new Event("refresh-profile"));
      setSaved(true);
      toast({ title: "Profile saved!", description: "Your changes have been updated successfully." });
      setTimeout(() => {
        setSaved(false);
        router.back();
      }, 900);
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to update profile.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] pb-36 bg-[var(--yrdly-dark)] font-yrdly-body text-foreground">
      {/* ── Header (1:1 Mobile matching) ── */}
      <header className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-[var(--yrdly-dark)]/90 backdrop-blur-md border-b border-[var(--yrdly-glass-border)]">
        <button
          onClick={() => router.back()}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-surface border border-[var(--yrdly-glass-border)] text-foreground transition-all hover:bg-white/5 lg:hidden"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="font-yrdly-display text-base font-bold text-foreground">Edit Profile</h1>
        <button
          onClick={handleSave}
          disabled={loading}
          className={`h-9 px-5 rounded-full text-xs font-bold font-yrdly-display transition-all ${
            saved
              ? "bg-[#82DB7E]/15 border border-[#82DB7E] text-[#82DB7E]"
              : "bg-[#82DB7E] text-black hover:opacity-90 active:scale-95"
          } disabled:opacity-50`}
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin text-black" />
          ) : saved ? (
            "✓ Saved"
          ) : (
            "Save"
          )}
        </button>
      </header>

      <main className="max-w-xl mx-auto px-6 py-6 space-y-8">
        {/* ── Avatar Section ── */}
        <div className="flex flex-col items-center pt-2 pb-6 border-b border-[var(--yrdly-glass-border)]">
          <div
            onClick={() => fileRef.current?.click()}
            className="relative w-24 h-24 rounded-full cursor-pointer group mb-3"
          >
            <Avatar className="w-full h-full rounded-full border-2 border-[var(--yrdly-glass-border)] overflow-hidden">
              <AvatarImage src={displayAvatar} className="object-cover w-full h-full" />
              <AvatarFallback className="bg-[var(--yrdly-dark)] text-foreground font-yrdly-display text-3xl font-bold">
                {name?.charAt(0)?.toUpperCase() || "U"}
              </AvatarFallback>
            </Avatar>
            <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center transition-opacity opacity-90 group-hover:opacity-100">
              <Camera className="w-6 h-6 text-white" />
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
          </div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="text-xs font-semibold text-[#82DB7E] hover:underline font-yrdly-body"
          >
            Change photo
          </button>
          <span className="text-[11px] text-[var(--yrdly-label)] mt-1 font-yrdly-body">
            JPG or PNG · Max 5MB
          </span>
        </div>

        {/* ── Form Fields ── */}
        <div className="space-y-6">
          {/* DISPLAY NAME */}
          <div className="space-y-2">
            <label className="text-[11px] font-bold text-[var(--yrdly-label)] tracking-wider uppercase font-yrdly-body">
              DISPLAY NAME
            </label>
            <div className="flex items-center h-14 px-4 rounded-2xl bg-card border border-[var(--yrdly-glass-border)] focus-within:border-[#82DB7E]/40 transition-all">
              <User className="w-4 h-4 text-[var(--yrdly-label)] mr-3 flex-shrink-0" />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={50}
                placeholder="Your Name"
                className="w-full bg-transparent text-sm text-foreground outline-none font-yrdly-body placeholder:text-[var(--yrdly-label)]"
              />
            </div>
          </div>

          {/* USERNAME */}
          <div className="space-y-2">
            <label className="text-[11px] font-bold text-[var(--yrdly-label)] tracking-wider uppercase font-yrdly-body">
              USERNAME
            </label>
            <div className="flex items-center h-14 px-4 rounded-2xl bg-card border border-[var(--yrdly-glass-border)] focus-within:border-[#82DB7E]/40 transition-all">
              <span className="text-base font-bold text-[#82DB7E] font-yrdly-display mr-1">@</span>
              <input
                type="text"
                value={handle}
                onChange={(e) => setHandle(e.target.value.replace(/[^a-zA-Z0-9_.]/g, "").slice(0, 30))}
                placeholder="handle"
                className="w-full bg-transparent text-sm text-foreground outline-none font-yrdly-body placeholder:text-[var(--yrdly-label)]"
              />
            </div>
            <p className="text-[11px] text-[var(--yrdly-label)] pl-1 font-yrdly-body">
              Letters, numbers, underscores, and dots only.
            </p>
          </div>

          {/* BIO */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-[var(--yrdly-label)] tracking-wider uppercase font-yrdly-body">
                BIO
              </label>
              <span
                className={`text-[11px] font-yrdly-body ${
                  bio.length >= bioMax ? "text-red-400" : bio.length > bioMax * 0.85 ? "text-amber-400" : "text-[var(--yrdly-label)]"
                }`}
              >
                {bio.length}/{bioMax}
              </span>
            </div>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, bioMax))}
              rows={3}
              placeholder="Write a short bio…"
              className="w-full p-4 rounded-2xl bg-card border border-[var(--yrdly-glass-border)] text-sm text-foreground outline-none font-yrdly-body placeholder:text-[var(--yrdly-label)] focus:border-[#82DB7E]/40 transition-all resize-none"
            />
          </div>

          {/* WEBSITE */}
          <div className="space-y-2">
            <label className="text-[11px] font-bold text-[var(--yrdly-label)] tracking-wider uppercase font-yrdly-body">
              WEBSITE <span className="font-normal text-[var(--yrdly-label)] normal-case">(OPTIONAL)</span>
            </label>
            <div className="flex items-center h-14 px-4 rounded-2xl bg-card border border-[var(--yrdly-glass-border)] focus-within:border-[#82DB7E]/40 transition-all">
              <Globe className="w-4 h-4 text-[var(--yrdly-label)] mr-3 flex-shrink-0" />
              <input
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="yoursite.com"
                className="w-full bg-transparent text-sm text-foreground outline-none font-yrdly-body placeholder:text-[var(--yrdly-label)]"
              />
            </div>
          </div>

          {/* ── VERIFIED INFO SECTION ── */}
          <div className="pt-4 border-t border-[var(--yrdly-glass-border)] space-y-3">
            <label className="text-[11px] font-bold text-[var(--yrdly-label)] tracking-wider uppercase font-yrdly-body block mb-2">
              VERIFIED INFO
            </label>

            {(authProfile as any)?.phone_verified || (authProfile as any)?.phone || user?.phone ? (
              <div className="flex items-center h-14 px-4 rounded-2xl bg-card border border-[var(--yrdly-glass-border)]">
                <span className="text-base mr-3">🇳🇬</span>
                <div className="flex-1 min-w-0">
                  <span className="text-[10px] font-semibold text-[var(--yrdly-label)] uppercase block tracking-wide">
                    PHONE
                  </span>
                  <span className="text-sm font-medium text-muted-foreground truncate block">
                    {(authProfile as any)?.phone || user?.phone || "Verified Number"}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[#82DB7E] text-xs font-semibold">
                  <Check className="w-3.5 h-3.5" />
                  <span>Verified</span>
                </div>
              </div>
            ) : null}

            <div className="flex items-center h-14 px-4 rounded-2xl bg-card border border-[var(--yrdly-glass-border)]">
              <Mail className="w-4 h-4 text-[var(--yrdly-label)] mr-3 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-[10px] font-semibold text-[var(--yrdly-label)] uppercase block tracking-wide">
                  EMAIL
                </span>
                <span className="text-sm font-medium text-muted-foreground truncate block">
                  {user?.email || "user@example.com"}
                </span>
              </div>
            </div>

            <p className="text-xs text-[var(--yrdly-label)] pl-1 leading-relaxed font-yrdly-body">
              To update your phone or email, go to Settings → Account & Identity.
            </p>
          </div>

          {/* ── Full-width Save button ── */}
          <button
            type="button"
            onClick={handleSave}
            disabled={loading}
            className="w-full h-14 rounded-2xl font-bold font-yrdly-display text-sm text-black bg-[#82DB7E] hover:opacity-90 active:scale-98 transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 mt-4"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin text-black" />
            ) : (
              <span>{saved ? "✓ Profile Saved" : "Save Changes"}</span>
            )}
          </button>
        </div>
      </main>
    </div>
  );
}
