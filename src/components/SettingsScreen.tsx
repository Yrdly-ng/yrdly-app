"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  User,
  Mail,
  ShoppingBag,
  Wallet,
  Landmark,
  Lock,
  MapPin,
  Shield,
  Moon,
  Bell,
  UserPlus,
  BookOpen,
  HelpCircle,
  Flag,
  Inbox,
  AlertTriangle,
  LogOut,
  Trash2,
  ChevronRight,
  ArrowLeft,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useTheme } from "@/components/ThemeProvider";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const FONT = "var(--font-work-sans)";
const RALEWAY = "var(--font-raleway)";
const GREEN = "hsl(var(--primary))";

/* ── Custom Toggle Switch ── */
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
      style={{ background: checked ? GREEN : "rgba(255,255,255,0.15)" }}
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

/* ── Section Wrapper ── */
function SettingSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <h2
        className="text-[0.75rem] font-bold uppercase tracking-wider mb-2.5 px-1"
        style={{ color: "var(--c-text-muted)", fontFamily: FONT }}
      >
        {title}
      </h2>
      <div
        className="rounded-[20px] overflow-hidden border border-[var(--c-border)]"
        style={{ background: "var(--c-card)" }}
      >
        {children}
      </div>
    </div>
  );
}

function SettingDivider() {
  return (
    <div
      className="h-[1px] ml-16"
      style={{ background: "var(--c-border)" }}
    />
  );
}

/* ── Setting Row ── */
function SettingRow({
  icon,
  label,
  sub,
  value,
  danger,
  toggle,
  toggled,
  onToggle,
  chevron = true,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  sub?: string;
  value?: string;
  danger?: boolean;
  toggle?: boolean;
  toggled?: boolean;
  onToggle?: (v: boolean) => void;
  chevron?: boolean;
  onPress?: () => void;
}) {
  return (
    <div
      onClick={onPress}
      className={`flex items-center px-5 py-4 transition-colors ${
        onPress || toggle ? "cursor-pointer hover:bg-white/5" : ""
      }`}
    >
      <div
        className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 border ${
          danger
            ? "bg-red-500/10 border-red-500/20 text-red-500"
            : "bg-white/5 border-white/10 text-foreground"
        }`}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0 pl-3.5 pr-2">
        <p
          className={`text-sm font-semibold truncate ${
            danger ? "text-red-500" : "text-foreground"
          }`}
          style={{ fontFamily: RALEWAY }}
        >
          {label}
        </p>
        {sub && (
          <p
            className="text-xs truncate mt-0.5"
            style={{ color: "var(--c-text-muted)", fontFamily: FONT }}
          >
            {sub}
          </p>
        )}
      </div>
      {value && (
        <span
          className="text-xs font-semibold px-2 py-1 rounded-md bg-white/5 mr-1"
          style={{ color: "var(--c-text-muted)", fontFamily: FONT }}
        >
          {value}
        </span>
      )}
      {toggle && (
        <Toggle checked={!!toggled} onChange={(v) => onToggle && onToggle(v)} />
      )}
      {!toggle && chevron && (
        <ChevronRight
          className="w-4 h-4 flex-shrink-0"
          style={{ color: "var(--c-text-muted)" }}
        />
      )}
    </div>
  );
}

export function SettingsScreen({ onBack }: { onBack?: () => void }) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { user, profile, signOut } = useAuth();
  const { toast } = useToast();

  const [showSignOutDialog, setShowSignOutDialog] = useState(false);
  const [showEmailDialog, setShowEmailDialog] = useState(false);

  const isAdmin =
    (profile as any)?.is_admin || (profile as any)?.role === "admin";

  const isDarkMode = theme === "dark";

  const toggleDarkMode = (value: boolean) => {
    setTheme(value ? "dark" : "light");
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      router.push("/login");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to sign out",
      });
    }
  };

  return (
    <div
      className="min-h-[100dvh] pb-32"
      style={{ background: "var(--c-bg)" }}
    >
      {/* ── Header ── */}
      <header
        className="sticky top-0 z-40 flex items-center justify-between px-4 py-3.5 border-b border-[var(--c-border)] backdrop-blur-md"
        style={{ background: "var(--c-bg)" }}
      >
        <button
          onClick={() => (onBack ? onBack() : router.back())}
          className="w-9 h-9 rounded-xl flex items-center justify-center border border-white/10 transition-colors hover:bg-white/5"
          style={{ background: "var(--c-card)" }}
        >
          <ArrowLeft className="w-4 h-4 text-foreground" />
        </button>
        <h1
          className="text-base font-bold text-foreground"
          style={{ fontFamily: RALEWAY }}
        >
          Settings
        </h1>
        <div className="w-9" />
      </header>

      <div className="max-w-xl mx-auto px-4 pt-6">
        {/* ── Account & Identity ── */}
        <SettingSection title="Account & Identity">
          <SettingRow
            icon={<User className="w-4 h-4 text-primary" />}
            label="Edit Profile"
            sub="Update your name, photo and bio"
            onPress={() => router.push("/settings/profile")}
          />
          <SettingDivider />
          <SettingRow
            icon={<span className="text-base leading-none">🇳🇬</span>}
            label="Phone Number"
            sub={
              (profile as any)?.phone_verified
                ? `${(profile as any)?.phone || "Phone"} · Verified`
                : "Verify phone number"
            }
            onPress={
              (profile as any)?.phone_verified
                ? undefined
                : () => router.push("/verify-phone")
            }
            chevron={!(profile as any)?.phone_verified}
          />
          <SettingDivider />
          <SettingRow
            icon={<Mail className="w-4 h-4 text-primary" />}
            label="Email Address"
            sub={user?.email || "No email linked"}
            onPress={() => setShowEmailDialog(true)}
          />
        </SettingSection>

        {/* ── Commerce ── */}
        <SettingSection title="Commerce">
          <SettingRow
            icon={<ShoppingBag className="w-4 h-4 text-primary" />}
            label="Transactions"
            sub="Track your orders & marketplace activity"
            onPress={() => router.push("/transactions")}
          />
          <SettingDivider />
          <SettingRow
            icon={<Wallet className="w-4 h-4 text-primary" />}
            label="Payouts"
            sub="Manage your earnings & balances"
            onPress={() => router.push("/settings/payouts")}
          />
          <SettingDivider />
          <SettingRow
            icon={<Landmark className="w-4 h-4 text-primary" />}
            label="Bank Account"
            sub="Manage your linked payout account"
            onPress={() => router.push("/profile/payout-settings")}
          />
        </SettingSection>

        {/* ── Privacy & Location ── */}
        <SettingSection title="Privacy & Location">
          <SettingRow
            icon={<Lock className="w-4 h-4 text-primary" />}
            label="Privacy & Discoverability"
            sub="Manage location sharing and visibility"
            onPress={() => router.push("/settings/privacy")}
          />
          <SettingDivider />
          <SettingRow
            icon={<MapPin className="w-4 h-4 text-primary" />}
            label="Location"
            sub="Your neighbourhood & location alerts"
            onPress={() => router.push("/settings/location")}
          />
          <SettingDivider />
          <SettingRow
            icon={<Shield className="w-4 h-4 text-primary" />}
            label="Blocked Users"
            sub="Manage who can't see or contact you"
            value={
              (profile as any)?.blocked_users?.length
                ? String((profile as any).blocked_users.length)
                : "0"
            }
            onPress={() => router.push("/settings/blocked")}
          />
        </SettingSection>

        {/* ── Preferences ── */}
        <SettingSection title="Preferences">
          <SettingRow
            icon={<Moon className="w-4 h-4 text-primary" />}
            label="Dark Mode"
            sub="Toggle dark mode theme"
            toggle
            toggled={isDarkMode}
            onToggle={toggleDarkMode}
          />
          <SettingDivider />
          <SettingRow
            icon={<Bell className="w-4 h-4 text-primary" />}
            label="Notifications"
            sub="Choose what you want to hear"
            onPress={() => router.push("/settings/notifications")}
          />
        </SettingSection>

        {/* ── Community & Support ── */}
        <SettingSection title="Community & Support">
          <SettingRow
            icon={<UserPlus className="w-4 h-4 text-primary" />}
            label="Invite Neighbours"
            sub="Invite neighbours to join your community"
            value="Invite"
            onPress={() => router.push("/settings/invite")}
          />
          <SettingDivider />
          <SettingRow
            icon={<BookOpen className="w-4 h-4 text-primary" />}
            label="Neighbourhood Guidelines"
            sub="What we stand for in every community"
            onPress={() => router.push("/settings/guidelines")}
          />
          <SettingDivider />
          <SettingRow
            icon={<HelpCircle className="w-4 h-4 text-primary" />}
            label="Help Center"
            sub="FAQs, tutorials and getting support"
            onPress={() => router.push("/settings/help")}
          />
          <SettingDivider />
          <SettingRow
            icon={<Flag className="w-4 h-4 text-primary" />}
            label="Report an Issue"
            sub="Flag a problem or inappropriate content"
            onPress={() => router.push("/settings/report")}
          />
        </SettingSection>

        {/* ── Admin Tools (if admin) ── */}
        {isAdmin && (
          <div className="mb-6">
            <div
              className="flex items-center gap-3 p-4 rounded-[18px] mb-3 border border-emerald-500/20"
              style={{ background: "rgba(130,219,126,0.06)" }}
            >
              <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-emerald-500/10 border border-emerald-500/20 text-emerald-500">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-emerald-500 text-sm" style={{ fontFamily: RALEWAY }}>
                  Admin Portal
                </p>
                <p className="text-xs text-muted-foreground" style={{ fontFamily: FONT }}>
                  You have administrator privileges
                </p>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-500 border border-emerald-500/25">
                ADMIN
              </span>
            </div>
            <SettingSection title="Admin Tools">
              <SettingRow
                icon={<Inbox className="w-4 h-4 text-primary" />}
                label="Dispute Resolution"
                sub="Review and resolve marketplace disputes"
                onPress={() => router.push("/admin/disputes")}
              />
              <SettingDivider />
              <SettingRow
                icon={<Shield className="w-4 h-4 text-primary" />}
                label="Moderation Queue"
                sub="Review flagged content and users"
                onPress={() => router.push("/admin/moderation")}
              />
              <SettingDivider />
              <SettingRow
                icon={<AlertTriangle className="w-4 h-4 text-primary" />}
                label="Safety Alerts"
                sub="Create and manage community safety alerts"
                onPress={() => router.push("/settings/safety")}
              />
            </SettingSection>
          </div>
        )}

        {/* ── Account ── */}
        <SettingSection title="Account">
          <SettingRow
            icon={<LogOut className="w-4 h-4 text-red-500" />}
            label="Sign Out"
            sub="Log out of your YRDLY account"
            danger
            chevron={false}
            onPress={() => setShowSignOutDialog(true)}
          />
          <SettingDivider />
          <SettingRow
            icon={<Trash2 className="w-4 h-4 text-red-500" />}
            label="Request Account Deletion"
            sub="We'll process your request within 30 days"
            danger
            chevron={false}
            onPress={() => router.push("/settings/delete-account")}
          />
        </SettingSection>

        <p
          className="text-center text-xs py-6"
          style={{ color: "var(--c-text-muted)", fontFamily: FONT }}
        >
          YRDLY v1.01
        </p>
      </div>

      {/* ── Sign Out Dialog ── */}
      {showSignOutDialog && (
        <AlertDialog
          open={showSignOutDialog}
          onOpenChange={setShowSignOutDialog}
        >
          <AlertDialogContent
            style={{
              background: "var(--c-card)",
              border: "1px solid rgba(130,219,126,0.2)",
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle className="text-foreground">
                Sign Out
              </AlertDialogTitle>
              <AlertDialogDescription style={{ color: "var(--c-text-muted)" }}>
                Are you sure you want to sign out of your YRDLY account?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                style={{
                  background: "var(--c-card)",
                  border: "1px solid var(--c-border)",
                  color: "var(--c-text)",
                }}
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                style={{ background: "#E53935" }}
                onClick={handleSignOut}
              >
                Sign Out
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* ── Email Support Dialog ── */}
      {showEmailDialog && (
        <AlertDialog open={showEmailDialog} onOpenChange={setShowEmailDialog}>
          <AlertDialogContent
            style={{
              background: "var(--c-card)",
              border: "1px solid rgba(130,219,126,0.2)",
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle className="text-foreground">
                Change Email
              </AlertDialogTitle>
              <AlertDialogDescription style={{ color: "var(--c-text-muted)" }}>
                To change your email address, please contact support@yrdly.ng
                with a valid ID for verification.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction
                style={{ background: GREEN }}
                onClick={() => setShowEmailDialog(false)}
              >
                OK
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}