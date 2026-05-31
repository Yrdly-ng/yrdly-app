"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  User,
  MapPin,
  Lock,
  ShieldCheck,
  Moon,
  Bell,
  Mail,
  HelpCircle,
  FileText,
  ChevronRight,
  Pencil,
  Wallet,
  ArrowLeft,
} from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useTheme } from "@/components/ThemeProvider";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

const FONT = "\"Pacifico\", cursive";
const PACIFICO = "Pacifico, cursive";
const GREEN = "#388E3C";
const CARD = "var(--c-card)";

interface SettingsScreenProps {
  onBack?: () => void;
}

/* ── Custom Toggle ── */
function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200"
      style={{ background: checked ? GREEN : "var(--c-card2)" }}
    >
      <span
        className="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200"
        style={{
          transform: checked ? "translateX(20px)" : "translateX(2px)",
          marginTop: 2,
        }}
      />
    </button>
  );
}

/* ── Row components ── */
function NavRow({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between px-4 py-4 transition-colors"
      style={{ background: 'var(--c-card)', borderRadius: 11 }}
      onMouseEnter={(e) =>
        ((e.currentTarget as HTMLElement).style.background = "var(--c-card2)")
      }
      onMouseLeave={(e) =>
        ((e.currentTarget as HTMLElement).style.background = CARD)
      }
    >
      <div className="flex items-center gap-3">
        <Icon className="w-5 h-5 flex-shrink-0" style={{ color: GREEN }} />
        <span
          className="text-foreground text-[0.875rem]"
          style={{ fontFamily: FONT }}
        >
          {label}
        </span>
      </div>
      <ChevronRight className="w-5 h-5" style={{ color: "#6b7280" }} />
    </button>
  );
}

function ToggleRow({
  icon: Icon,
  label,
  checked,
  onChange,
}: {
  icon: React.ElementType;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      className="flex items-center justify-between px-4 py-4"
      style={{ background: 'var(--c-card)', borderRadius: 11 }}
    >
      <div className="flex items-center gap-3">
        <Icon className="w-5 h-5 flex-shrink-0" style={{ color: GREEN }} />
        <span
          className="text-foreground text-[0.875rem]"
          style={{ fontFamily: FONT }}
        >
          {label}
        </span>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-foreground text-[1rem] px-1"
      style={{ fontFamily: PACIFICO, fontWeight: 400 }}
    >
      {children}
    </h2>
  );
}

export function SettingsScreen({ onBack }: SettingsScreenProps) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { user, profile, signOut, updateProfile } = useAuth();
  const { toast } = useToast();

  const [privacy, setPrivacy] = useState({
    locationVisible: profile?.shareLocation ?? false,
    onlineStatus: true,
  });

  const [isDark, setIsDark] = useState(theme === "dark");
  const [emailReminders, setEmailReminders] = useState(true);

  useEffect(() => {
    if (profile) {
      setPrivacy((prev) => ({
        ...prev,
        locationVisible: profile.shareLocation ?? false,
      }));
    }
  }, [profile]);

  // Load email reminder preference from DB
  useEffect(() => {
    if (!user) return;
    supabase
      .from("users")
      .select("email_reminders_enabled")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data && data.email_reminders_enabled !== null) {
          setEmailReminders(data.email_reminders_enabled);
        }
      });
  }, [user]);

  const handleLogout = async () => {
    try {
      await signOut();
      router.push("/login");
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  const handleLocationSharingToggle = async (checked: boolean) => {
    try {
      await updateProfile({
        shareLocation: checked,
        updated_at: new Date().toISOString(),
      });
      setPrivacy((prev) => ({ ...prev, locationVisible: checked }));
    } catch (error) {
      console.error("Error updating location sharing preference:", error);
    }
  };

  const handleDarkModeToggle = (checked: boolean) => {
    setIsDark(checked);
    setTheme(checked ? "dark" : "light");
  };

  const handleEmailRemindersToggle = async (checked: boolean) => {
    setEmailReminders(checked);
    if (user) {
      await supabase
        .from("users")
        .update({ email_reminders_enabled: checked })
        .eq("id", user.id);
    }
  };

  const displayName = profile?.name || user?.user_metadata?.name || "User";
  const email = user?.email || "user@example.com";
  const avatarUrl = profile?.avatar_url || "/placeholder.svg";

  return (
    <div
      className="min-h-[100dvh] pb-32"
      style={{ background: "var(--c-bg)" }}
    >
      {/* Sticky Header */}
      <header
        className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 border-b border-[var(--c-border)]"
        style={{ background: "var(--c-bg)" }}
      >
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full transition-colors hover:bg-accent">
            <ArrowLeft className="w-5 h-5 text-foreground" style={{ color: "var(--c-text)" }} />
          </button>
          <h1 style={{ fontFamily: "\"Pacifico\", cursive", fontSize: 18, fontWeight: 700, color: "var(--c-text)" }}>Settings</h1>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 pt-8 space-y-8">

        {/* ── Profile Card ── */}
        <section
          className="flex items-center gap-4 p-4"
          style={{ background: 'var(--c-card)', borderRadius: 11 }}
        >
          <Avatar className="w-16 h-16 flex-shrink-0">
            <AvatarImage src={avatarUrl} alt={displayName} />
            <AvatarFallback
              style={{
                background: GREEN,
                color: "#fff",
                fontFamily: FONT,
                fontWeight: 700,
                fontSize: 24,
              }}
            >
              {displayName.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <h1
              className="text-foreground text-[0.875rem] truncate"
              style={{ fontFamily: FONT, fontWeight: 700 }}
            >
              {displayName}
            </h1>
            <p
              className="text-[0.75rem] truncate"
              style={{ fontFamily: FONT, color: "var(--c-text-muted)" }}
            >
              {email}
            </p>
          </div>
          <button
            onClick={() => router.push("/settings/profile")}
            className="p-2 rounded-full transition-colors"
            style={{ background: "var(--c-card2)" }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLElement).style.background =
                "transparent")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.background = "var(--c-card2)")
            }
          >
            <Pencil className="w-4 h-4" style={{ color: GREEN }} />
          </button>
        </section>

        {/* ── Account ── */}
        <div className="space-y-3">
          <SectionLabel>Account</SectionLabel>
          <NavRow
            icon={User}
            label="Edit Profile"
            onClick={() => router.push("/settings/profile")}
          />
          <NavRow
            icon={MapPin}
            label="Location"
            onClick={() => router.push("/settings/location")}
          />
        </div>

        {/* ── Marketplace ── */}
        <div className="space-y-3">
          <SectionLabel>Marketplace</SectionLabel>
          <NavRow
            icon={Wallet}
            label="Payout Settings"
            onClick={() => router.push("/profile/payout-settings")}
          />
        </div>



        {/* ── Appearance ── */}
        <div className="space-y-3">
          <SectionLabel>Appearance</SectionLabel>
          <ToggleRow
            icon={Moon}
            label="Dark mode"
            checked={isDark}
            onChange={handleDarkModeToggle}
          />
        </div>

        {/* ── Notifications ── */}
        <div className="space-y-3">
          <SectionLabel>Notifications</SectionLabel>
          <NavRow
            icon={Bell}
            label="Push Notifications"
            onClick={() => router.push("/settings/notifications")}
          />
          <ToggleRow
            icon={Mail}
            label="Email Reminders"
            checked={emailReminders}
            onChange={handleEmailRemindersToggle}
          />
          <div
            className="px-4 pb-2"
            style={{ color: "var(--c-text-muted)", fontFamily: FONT, fontSize: 12, lineHeight: 1.5 }}
          >
            Get an email when you have unread messages or notifications after 30 minutes away.
          </div>
        </div>

        {/* ── Support ── */}
        <div className="space-y-3">
          <SectionLabel>Support</SectionLabel>
          <NavRow
            icon={HelpCircle}
            label="Help & Support"
            onClick={() => {
              // Try to open Zoho Desk ASAP widget if it exists
              if (typeof window !== "undefined" && (window as any).ZohoDeskAsap) {
                (window as any).ZohoDeskAsap.invoke('open');
              } else {
                toast({
                  title: "Support",
                  description: "Support widget is still loading. Please try again in a moment.",
                });
              }
            }}
          />
          <NavRow
            icon={FileText}
            label="Privacy Policy"
            onClick={() => router.push("/legal/privacy")}
          />
        </div>

        {/* ── Logout ── */}
        <div className="pt-8 pb-12 flex justify-center">
          <button
            onClick={handleLogout}
            className="rounded-full px-12 py-3 transition-colors"
            style={{
              border: "0.5px solid #E53935",
              color: "#E53935",
              fontFamily: FONT,
              fontWeight: 700,
              background: "transparent",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLElement).style.background =
                "rgba(229,57,53,0.1)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.background = "transparent")
            }
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}
