"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  NotePencil,
  Storefront,
  CalendarPlus,
  Warning,
  CaretRight,
  X,
} from "@phosphor-icons/react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { cn } from "@/lib/utils";

const FONT = "var(--font-work-sans)";

interface CreateOption {
  key: string;
  title: string;
  subtitle: string;
  icon: typeof NotePencil;
  iconBg: string;
  iconColor: string;
  requiresPhoneVerification: boolean;
  action: "post" | "listing" | "event" | "alert";
}

interface CreateMenuOverlayProps {
  open: boolean;
  onClose: () => void;
  onPost: () => void;
  onListing: () => void;
  onEvent: () => void;
}

export function CreateMenuOverlay({
  open,
  onClose,
  onPost,
  onListing,
  onEvent,
}: CreateMenuOverlayProps) {
  const router = useRouter();
  const { profile } = useAuth();

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const options: CreateOption[] = [
    {
      key: "post",
      title: "Post",
      subtitle: "Share thoughts or photos",
      icon: NotePencil,
      iconBg: "rgba(56,142,60,0.12)",
      iconColor: "hsl(var(--primary))",
      requiresPhoneVerification: false,
      action: "post",
    },
    {
      key: "listing",
      title: "Listing",
      subtitle: "Sell or give away items",
      icon: Storefront,
      iconBg: "rgba(25,118,210,0.10)",
      iconColor: "#1976D2",
      requiresPhoneVerification: true,
      action: "listing",
    },
    {
      key: "event",
      title: "Event",
      subtitle: "Host a gathering or party",
      icon: CalendarPlus,
      iconBg: "rgba(123,31,162,0.10)",
      iconColor: "#7B1FA2",
      requiresPhoneVerification: true,
      action: "event",
    },
    {
      key: "alert",
      title: "Alert",
      subtitle: "Notify neighbors of danger",
      icon: Warning,
      iconBg: "rgba(239,68,68,0.10)",
      iconColor: "#ef4444",
      requiresPhoneVerification: false,
      action: "alert",
    },
  ];

  const handleSelect = (option: CreateOption) => {
    onClose();

    if (option.requiresPhoneVerification && !profile?.phone_verified) {
      router.push("/verify-phone");
      return;
    }

    switch (option.action) {
      case "post":
        onPost();
        break;
      case "listing":
        onListing();
        break;
      case "event":
        onEvent();
        break;
      case "alert":
        router.push("/alerts/new");
        break;
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="fixed inset-0 z-[120] bg-black/45"
            style={{ backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}
            onClick={onClose}
          />

          <motion.div
            key="panel"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 380 }}
            className="fixed bottom-0 left-0 right-0 z-[121] mx-auto w-full sm:max-w-[520px] rounded-t-[24px] px-5 pt-3 pb-8"
            style={{
              background: "var(--c-card)",
              borderTop: "0.5px solid var(--c-border)",
              boxShadow: "0 -16px 48px rgba(0,0,0,0.25)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
            }}
          >
            {/* Grabber */}
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--c-border)]" />

            <div className="flex items-center justify-between mb-4">
              <h2
                className="text-lg font-bold text-foreground"
                style={{ fontFamily: FONT }}
              >
                Create
              </h2>
              <button
                onClick={onClose}
                aria-label="Close"
                className="flex items-center justify-center w-8 h-8 rounded-full text-[var(--c-text-muted)] hover:bg-[var(--c-card2)] transition-colors"
              >
                <X size={18} weight="bold" />
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {options.map((option, i) => {
                const Icon = option.icon;
                return (
                  <motion.button
                    key={option.key}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 + i * 0.045, duration: 0.2, ease: "easeOut" }}
                    onClick={() => handleSelect(option)}
                    className={cn(
                      "flex items-center gap-3.5 w-full p-3.5 rounded-2xl text-left",
                      "border border-[var(--c-border)] bg-[var(--c-card2)]",
                      "hover:shadow-md hover:scale-[0.99] active:scale-[0.98] transition-all duration-150"
                    )}
                  >
                    <span
                      className="flex items-center justify-center w-11 h-11 rounded-xl flex-shrink-0"
                      style={{ background: option.iconBg }}
                    >
                      <Icon size={22} weight="fill" style={{ color: option.iconColor }} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span
                        className="block text-[0.9375rem] font-bold text-foreground leading-tight"
                        style={{ fontFamily: FONT }}
                      >
                        {option.title}
                      </span>
                      <span
                        className="block text-[0.8125rem] text-[var(--c-text-muted)] mt-0.5 truncate"
                        style={{ fontFamily: FONT }}
                      >
                        {option.subtitle}
                      </span>
                    </span>
                    <CaretRight
                      size={16}
                      className="text-[var(--c-text-muted)] flex-shrink-0"
                      weight="bold"
                    />
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
