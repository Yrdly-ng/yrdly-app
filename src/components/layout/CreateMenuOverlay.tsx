"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  MessageSquareText,
  ShoppingBag,
  CalendarDays,
  ShieldAlert,
  ArrowUpRight,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { cn } from "@/lib/shared/utils";

const FONT = "var(--font-work-sans)";

interface CreateOption {
  key: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  iconClassName: string;
  tint: string;
  glyph: string;
  ordinal: string;
  requiresPhoneVerification: boolean;
  action: "post" | "listing" | "event" | "alert";
}

interface CreateMenuOverlayProps {
  open: boolean;
  onClose: () => void;
  onPost?: () => void;
  onListing?: () => void;
  onEvent?: () => void;
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
  const reducedMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    requestAnimationFrame(() => closeButtonRef.current?.focus());
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      returnFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const options: CreateOption[] = [
    {
      key: "post",
      title: "Community post",
      subtitle: "Share thoughts, photos and stories",
      icon: MessageSquareText,
      iconClassName: "text-emerald-700 dark:text-emerald-300",
      tint: "rgba(130,219,126,0.16)",
      glyph: "rgba(130,219,126,0.13)",
      ordinal: "01",
      requiresPhoneVerification: false,
      action: "post",
    },
    {
      key: "listing",
      title: "Marketplace listing",
      subtitle: "Sell or give away something nearby",
      icon: ShoppingBag,
      iconClassName: "text-blue-700 dark:text-blue-300",
      tint: "rgba(91,154,246,0.15)",
      glyph: "rgba(91,154,246,0.13)",
      ordinal: "02",
      requiresPhoneVerification: true,
      action: "listing",
    },
    {
      key: "event",
      title: "Event",
      subtitle: "Bring your neighbourhood together",
      icon: CalendarDays,
      iconClassName: "text-violet-700 dark:text-violet-300",
      tint: "rgba(172,114,233,0.16)",
      glyph: "rgba(172,114,233,0.12)",
      ordinal: "03",
      requiresPhoneVerification: true,
      action: "event",
    },
    {
      key: "alert",
      title: "Safety alert",
      subtitle: "Help neighbours stay informed",
      icon: ShieldAlert,
      iconClassName: "text-rose-700 dark:text-rose-300",
      tint: "rgba(225,109,94,0.15)",
      glyph: "rgba(225,109,94,0.11)",
      ordinal: "04",
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
        if (onPost) onPost();
        else router.push("/posts/create");
        break;
      case "listing":
        if (onListing) onListing();
        else router.push("/marketplace/create");
        break;
      case "event":
        if (onEvent) onEvent();
        else router.push("/events/create");
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
            className="fixed inset-0 z-[120] bg-black/55"
            style={{ backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}
            onClick={onClose}
          />

          <motion.div
            ref={panelRef}
            key="panel"
            initial={reducedMotion ? { opacity: 0 } : { y: "100%", opacity: 0.92 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { y: "100%", opacity: 0.92 }}
            transition={reducedMotion ? { duration: 0.1 } : { type: "spring", damping: 31, stiffness: 380 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-menu-title"
            className="fixed bottom-0 left-0 right-0 z-[121] mx-auto max-h-[min(94dvh,760px)] w-full overflow-y-auto overscroll-contain rounded-t-[28px] border-t border-border/70 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+1.75rem)] sm:max-w-[540px] sm:rounded-[28px] sm:bottom-5 sm:border sm:px-6 sm:shadow-2xl"
            style={{
              background: "var(--c-card)",
              boxShadow: "0 -18px 65px rgba(0,0,0,0.30)",
            }}
          >
            {/* Grabber */}
            <div className="mx-auto mb-5 h-1 w-11 rounded-full bg-[var(--c-border)] sm:hidden" />

            <div className="mb-5 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.18em] text-primary">Your neighbourhood, your voice</p>
                <h2
                  id="create-menu-title"
                  className="text-[1.375rem] font-bold leading-tight text-foreground sm:text-2xl"
                  style={{ fontFamily: FONT }}
                >
                  What would you like to create?
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  Pick how you want to contribute to YRDLY.
                </p>
              </div>
              <button
                ref={closeButtonRef}
                onClick={onClose}
                aria-label="Close"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--c-text-muted)] hover:bg-[var(--c-card2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <X size={20} strokeWidth={2.5} />
              </button>
            </div>

            <div role="group" aria-label="Choose what to create" className="grid grid-cols-2 gap-2.5 sm:gap-3">
              {options.map((option, i) => {
                const Icon = option.icon;
                return (
                  <motion.button
                    type="button"
                    key={option.key}
                    data-create-action={option.action}
                    initial={reducedMotion ? false : { opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={reducedMotion ? { duration: 0 } : { delay: 0.05 + i * 0.04, duration: 0.2, ease: "easeOut" }}
                    onClick={() => handleSelect(option)}
                    aria-label={`${option.title}. ${option.subtitle}`}
                    className={cn(
                      "group relative flex min-h-[174px] flex-col items-start overflow-hidden rounded-[22px] border border-border/75 bg-[var(--c-card2)] p-3.5 text-left shadow-sm",
                      "transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg active:translate-y-0",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                      "sm:min-h-[184px] sm:p-4"
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute -right-6 -top-7 h-28 w-28 rounded-full"
                      style={{ background: option.glyph }}
                    />
                    <span className="relative flex w-full items-center justify-between">
                      <span
                        className="flex h-14 w-14 items-center justify-center rounded-[18px] border border-white/10 shadow-sm sm:h-16 sm:w-16"
                        style={{ background: option.tint }}
                      >
                        <Icon size={30} strokeWidth={1.85} className={option.iconClassName} aria-hidden="true" />
                      </span>
                      <span className="text-xs font-semibold tabular-nums text-muted-foreground/70" aria-hidden="true">
                        {option.ordinal}
                      </span>
                    </span>
                    <span
                      className="relative mt-4 block text-[0.9375rem] font-bold leading-tight text-foreground sm:text-base"
                      style={{ fontFamily: FONT }}
                    >
                      {option.title}
                    </span>
                    <span className="relative mt-1.5 line-clamp-2 text-xs leading-[1.45] text-muted-foreground sm:text-[13px]">
                      {option.subtitle}
                    </span>
                    <ArrowUpRight size={16} strokeWidth={2} aria-hidden="true" className="absolute bottom-3 right-3 text-muted-foreground/60 transition-colors group-hover:text-primary" />
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
