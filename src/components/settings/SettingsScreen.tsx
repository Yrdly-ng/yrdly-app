"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  ArrowLeft,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useTheme } from "@/components/ThemeProvider";
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
import { GlassCard } from "@/components/ui/glass-card";
import { SETTINGS_GROUPS } from "@/components/settings/settings-menu";

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
      <h2 className="text-[0.75rem] font-bold uppercase tracking-wider mb-2.5 px-1 text-[var(--yrdly-label)] font-yrdly-display">
        {title}
      </h2>
      <GlassCard className="rounded-[20px] overflow-hidden p-0">
        {children}
      </GlassCard>
    </div>
  );
}

function SettingDivider() {
  return <div className="h-[1px] ml-16 bg-[var(--yrdly-glass-border)]" />;
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
            : "bg-[var(--yrdly-glass-bg)] border-[var(--yrdly-glass-border)] text-foreground"
        }`}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0 pl-3.5 pr-2">
        <p
          className={`text-sm font-bold truncate font-yrdly-display ${
            danger ? "text-red-500" : "text-foreground"
          }`}
        >
          {label}
        </p>
        {sub && (
          <p className="text-xs truncate mt-0.5 text-[var(--yrdly-label)] font-yrdly-body">
            {sub}
          </p>
        )}
      </div>
      {value && (
        <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-[var(--yrdly-glass-bg)] border border-[var(--yrdly-glass-border)] text-[var(--yrdly-label)] font-yrdly-body mr-1">
          {value}
        </span>
      )}
      {toggle && (
        <Toggle checked={!!toggled} onChange={(v) => onToggle && onToggle(v)} />
      )}
      {!toggle && chevron && (
        <ChevronRight className="w-4 h-4 flex-shrink-0 text-[var(--yrdly-label)]" />
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
    <div className="min-h-[100dvh] bg-[var(--yrdly-dark)] text-foreground font-yrdly-body pb-32">
      {/* ── Header ── */}
      <header className="sticky top-0 z-40 flex items-center justify-between px-4 py-3.5 border-b border-[var(--yrdly-glass-border)] bg-[var(--yrdly-dark)]/80 backdrop-blur-md">
        <button
          onClick={() => (onBack ? onBack() : router.back())}
          className="w-9 h-9 rounded-xl flex items-center justify-center border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-glass-bg)] transition-colors hover:bg-white/5"
        >
          <ArrowLeft className="w-4 h-4 text-foreground" />
        </button>
        <h1 className="text-base font-bold text-foreground font-yrdly-display">
          Settings
        </h1>
        <div className="w-9" />
      </header>

      <div className="max-w-xl mx-auto px-4 pt-6">
        {SETTINGS_GROUPS.map((group) => {
          if (group.adminOnly && !isAdmin) return null;

          return (
            <React.Fragment key={group.title}>
              {group.adminOnly && isAdmin && (
                <GlassCard className="flex items-center gap-3 p-4 rounded-[18px] mb-3 border border-emerald-500/20 bg-emerald-500/5">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-emerald-500/10 border border-emerald-500/20 text-emerald-500">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-emerald-500 text-sm font-yrdly-display">
                      Admin Portal
                    </p>
                    <p className="text-xs text-[var(--yrdly-label)] font-yrdly-body">
                      You have administrator privileges
                    </p>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-500 border border-emerald-500/25 font-yrdly-display">
                    ADMIN
                  </span>
                </GlassCard>
              )}

              <SettingSection title={group.title}>
                {group.items.map((item, idx) => {
                  const IconComponent = item.icon;
                  let iconNode: React.ReactNode = (
                    <IconComponent className={`w-4 h-4 ${item.danger ? "text-red-500" : "text-primary"}`} />
                  );
                  let itemSub = item.sub;
                  let itemChevron = item.chevron !== undefined ? item.chevron : true;
                  let itemValue: string | undefined;
                  let onPressAction: (() => void) | undefined;

                  // Handle dynamic values & actions for specific items
                  if (item.key === "phone-number") {
                    iconNode = <span className="text-base leading-none">🇳🇬</span>;
                    itemSub = (profile as any)?.phone_verified
                      ? `${(profile as any)?.phone || "Phone"} · Verified`
                      : "Verify phone number";
                    itemChevron = !(profile as any)?.phone_verified;
                    onPressAction = (profile as any)?.phone_verified
                      ? undefined
                      : () => router.push("/verify-phone");
                  } else if (item.key === "email-address") {
                    itemSub = user?.email || "No email linked";
                    onPressAction = () => setShowEmailDialog(true);
                  } else if (item.key === "blocked") {
                    itemValue = (profile as any)?.blocked_users?.length
                      ? String((profile as any).blocked_users.length)
                      : "0";
                    onPressAction = () => item.href && router.push(item.href);
                  } else if (item.key === "invite") {
                    itemValue = "Invite";
                    onPressAction = () => item.href && router.push(item.href);
                  } else if (item.key === "sign-out") {
                    onPressAction = () => setShowSignOutDialog(true);
                  } else if (item.href) {
                    onPressAction = () => router.push(item.href!);
                  }

                  return (
                    <React.Fragment key={item.key}>
                      <SettingRow
                        icon={iconNode}
                        label={item.label}
                        sub={itemSub}
                        value={itemValue}
                        danger={item.danger}
                        toggle={item.toggle}
                        toggled={item.toggle ? isDarkMode : undefined}
                        onToggle={item.toggle ? toggleDarkMode : undefined}
                        chevron={itemChevron}
                        onPress={onPressAction}
                      />
                      {idx < group.items.length - 1 && <SettingDivider />}
                    </React.Fragment>
                  );
                })}
              </SettingSection>
            </React.Fragment>
          );
        })}

        <p className="text-center text-xs py-6 text-[var(--yrdly-label)] font-yrdly-body">
          YRDLY v1.01
        </p>
      </div>

      {/* ── Sign Out Dialog ── */}
      {showSignOutDialog && (
        <AlertDialog
          open={showSignOutDialog}
          onOpenChange={setShowSignOutDialog}
        >
          <AlertDialogContent className="bg-[var(--yrdly-dark)] border border-[var(--yrdly-glass-border)]">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-foreground font-yrdly-display">
                Sign Out
              </AlertDialogTitle>
              <AlertDialogDescription className="text-[var(--yrdly-label)] font-yrdly-body">
                Are you sure you want to sign out of your YRDLY account?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="bg-[var(--yrdly-glass-bg)] border border-[var(--yrdly-glass-border)] text-foreground font-yrdly-body">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                style={{ background: "#E53935" }}
                className="font-yrdly-body"
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
          <AlertDialogContent className="bg-[var(--yrdly-dark)] border border-[var(--yrdly-glass-border)]">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-foreground font-yrdly-display">
                Change Email
              </AlertDialogTitle>
              <AlertDialogDescription className="text-[var(--yrdly-label)] font-yrdly-body">
                To change your email address, please contact support@yrdly.ng
                with a valid ID for verification.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction
                className="bg-primary text-foreground font-yrdly-body"
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