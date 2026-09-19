import type { ComponentType } from "react";
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
} from "lucide-react";

export interface SettingsMenuItem {
  key: string;
  label: string;
  sub?: string;
  href?: string;
  icon: ComponentType<{ className?: string }>;
  danger?: boolean;
  toggle?: boolean;
  chevron?: boolean;
  action?: "email_dialog" | "sign_out_dialog" | "verify_phone" | "dark_mode";
}

export interface SettingsGroup {
  title: string;
  adminOnly?: boolean;
  items: SettingsMenuItem[];
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    title: "Account & Identity",
    items: [
      {
        key: "edit-profile",
        label: "Edit Profile",
        sub: "Update your name, photo and bio",
        href: "/settings/profile",
        icon: User,
      },
      {
        key: "phone-number",
        label: "Phone Number",
        action: "verify_phone",
        icon: User, // rendered dynamically in SettingsScreen with flag emoji
      },
      {
        key: "email-address",
        label: "Email Address",
        action: "email_dialog",
        icon: Mail,
      },
    ],
  },
  {
    title: "Commerce",
    items: [
      {
        key: "transactions",
        label: "Transactions",
        sub: "Track your orders & marketplace activity",
        href: "/settings/transactions",
        icon: ShoppingBag,
      },
      {
        key: "payouts",
        label: "Payouts",
        sub: "Manage your earnings & balances",
        href: "/settings/payouts",
        icon: Wallet,
      },
      {
        key: "bank-account",
        label: "Bank Account",
        sub: "Manage your linked payout account",
        href: "/settings/payout-settings",
        icon: Landmark,
      },
    ],
  },
  {
    title: "Privacy & Location",
    items: [
      {
        key: "privacy",
        label: "Privacy & Discoverability",
        sub: "Manage location sharing and visibility",
        href: "/settings/privacy",
        icon: Lock,
      },
      {
        key: "location",
        label: "Location",
        sub: "Your neighbourhood & location alerts",
        href: "/settings/location",
        icon: MapPin,
      },
      {
        key: "blocked",
        label: "Blocked Users",
        sub: "Manage who can't see or contact you",
        href: "/settings/blocked",
        icon: Shield,
      },
    ],
  },
  {
    title: "Preferences",
    items: [
      {
        key: "dark-mode",
        label: "Dark Mode",
        sub: "Toggle dark mode theme",
        toggle: true,
        action: "dark_mode",
        icon: Moon,
      },
      {
        key: "notifications",
        label: "Notifications",
        sub: "Choose what you want to hear",
        href: "/settings/notifications",
        icon: Bell,
      },
    ],
  },
  {
    title: "Community & Support",
    items: [
      {
        key: "invite",
        label: "Invite Neighbours",
        sub: "Invite neighbours to join your community",
        href: "/settings/invite",
        icon: UserPlus,
      },
      {
        key: "guidelines",
        label: "Neighbourhood Guidelines",
        sub: "What we stand for in every community",
        href: "/settings/guidelines",
        icon: BookOpen,
      },
      {
        key: "help",
        label: "Help Center",
        sub: "FAQs, tutorials and getting support",
        href: "/settings/help",
        icon: HelpCircle,
      },
      {
        key: "report",
        label: "Report an Issue",
        sub: "Flag a problem or inappropriate content",
        href: "/settings/report",
        icon: Flag,
      },
    ],
  },
  {
    title: "Admin Tools",
    adminOnly: true,
    items: [
      {
        key: "disputes",
        label: "Dispute Resolution",
        sub: "Review and resolve marketplace disputes",
        href: "/settings/disputes",
        icon: Inbox,
      },
      {
        key: "moderation",
        label: "Moderation Queue",
        sub: "Review flagged content and users",
        href: "/settings/moderation",
        icon: Shield,
      },
      {
        key: "safety",
        label: "Safety Alerts",
        sub: "Create and manage community safety alerts",
        href: "/settings/safety",
        icon: AlertTriangle,
      },
    ],
  },
  {
    title: "Account",
    items: [
      {
        key: "sign-out",
        label: "Sign Out",
        sub: "Log out of your YRDLY account",
        action: "sign_out_dialog",
        icon: LogOut,
        danger: true,
        chevron: false,
      },
      {
        key: "delete-account",
        label: "Request Account Deletion",
        sub: "We'll process your request within 30 days",
        href: "/settings/delete-account",
        icon: Trash2,
        danger: true,
        chevron: false,
      },
    ],
  },
];
