"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { User, Settings, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-supabase-auth";
import { AuthService } from "@/lib/auth-service";

interface ProfileDropdownProps {
  onClose: () => void;
}

const FONT = "Pacifico", cursive;
const GREEN = "#388E3C";

export function ProfileDropdown({ onClose }: ProfileDropdownProps) {
  const router = useRouter();
  const { user, profile } = useAuth();

  const displayName = profile?.name || user?.user_metadata?.name || "User";
  const email = user?.email || "user@example.com";
  const avatarUrl =
    profile?.avatar_url ||
    user?.user_metadata?.avatar_url ||
    "/placeholder.svg";

  const navigate = (path: string) => {
    onClose();
    router.push(path);
  };

  const handleLogout = async () => {
    onClose();
    await AuthService.signOut();
    router.push("/login");
  };

  const menuItems = [
    {
      label: "Profile",
      icon: User,
      onClick: () => navigate("/profile"),
    },
    {
      label: "Settings",
      icon: Settings,
      onClick: () => navigate("/settings"),
    },
  ];

  return (
    /* full-screen backdrop to close on outside click */
    <div className="fixed inset-0 z-[110]" onClick={onClose}>
      <div
        className="absolute top-[68px] right-3 w-[220px] overflow-hidden"
        style={{
          background: "var(--c-card)",
          borderRadius: 11,
          border: "0.5px solid var(--c-border)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── User info ── */}
        <div
          className="flex items-center gap-3 px-4 py-4"
          style={{ borderBottom: "0.5px solid var(--c-border)" }}
        >
          <Avatar className="w-10 h-10 flex-shrink-0">
            <AvatarImage src={avatarUrl} alt={displayName} />
            <AvatarFallback
              style={{ background: GREEN, color: "#fff", fontFamily: FONT, fontWeight: 700 }}
            >
              {displayName.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p
              className="truncate text-foreground text-[0.875rem] leading-[18px]"
              style={{ fontFamily: FONT, fontWeight: 700 }}
            >
              {displayName}
            </p>
            <p
              className="truncate text-[0.75rem] leading-[16px]"
              style={{ fontFamily: FONT, fontWeight: 300, color: "var(--c-text-muted)" }}
            >
              {email}
            </p>
          </div>
        </div>

        {/* ── Menu items ── */}
        <div className="py-1">
          {menuItems.map(({ label, icon: Icon, onClick }) => (
            <button
              key={label}
              onClick={onClick}
              className="w-full flex items-center gap-3 px-4 py-3 transition-colors"
              style={{ fontFamily: FONT, background: "transparent" }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.background =
                  "transparent")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.background =
                  "transparent")
              }
            >
              <Icon
                className="w-[18px] h-[18px] flex-shrink-0"
                style={{ color: "var(--c-text-muted)" }}
              />
              <span
                className="text-[0.875rem] text-foreground"
                style={{ fontFamily: FONT, fontWeight: 400 }}
              >
                {label}
              </span>
            </button>
          ))}

          {/* divider */}
          <div style={{ borderTop: "0.5px solid var(--c-border)", margin: "2px 0" }} />

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 transition-colors"
            style={{ fontFamily: FONT, background: "transparent" }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background =
                "rgba(229,57,53,0.08)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background =
                "transparent")
            }
          >
            <LogOut
              className="w-[18px] h-[18px] flex-shrink-0"
              style={{ color: "#E53935" }}
            />
            <span
              className="text-[0.875rem]"
              style={{ fontFamily: FONT, fontWeight: 400, color: "#E53935" }}
            >
              Logout
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
