"use client";

import { RefreshCw, Mail, User, MapPin } from 'lucide-react';

interface LoadingStateProps {
  type: 'email' | 'profile' | 'location' | 'general';
  message?: string;
  progress?: number;
}

const loadingConfig = {
  email: {
    icon: Mail,
    defaultMessage: "Setting up your email verification...",
    subtext: "Verifying your details..."
  },
  profile: {
    icon: User,
    defaultMessage: "Creating your profile...",
    subtext: "Syncing your info..."
  },
  location: {
    icon: MapPin,
    defaultMessage: "Loading location data...",
    subtext: "Getting your local data..."
  },
  general: {
    icon: RefreshCw,
    defaultMessage: "Loading...",
    subtext: "Almost there..."
  }
};

export function LoadingState({ type, message, progress }: LoadingStateProps) {
  const config = loadingConfig[type];
  const Icon = config.icon;

  return (
    <div className="flex flex-col items-center justify-center p-8 space-y-8 min-h-[500px]" style={{ fontFamily: "var(--font-work-sans)" }}>

      <div
        className="w-24 h-24 rounded-3xl flex items-center justify-center"
        style={{
          background: "linear-gradient(135deg, rgba(30, 33, 38, 0.9) 0%, rgba(13, 15, 17, 0.95) 100%)",
          border: "1px solid var(--c-border)",
        }}
      >
        <Icon className="w-10 h-10 text-primary animate-spin" style={{ animationDuration: '2.5s' }} />
      </div>

      <div className="text-center space-y-2 max-w-sm">
        <h3 className="text-2xl font-bold tracking-tight text-foreground">
          {message || config.defaultMessage}
        </h3>
        <p className="text-muted-foreground text-sm font-medium opacity-80">
          {config.subtext}
        </p>
      </div>

      {progress !== undefined && (
        <div className="w-full max-w-[280px] space-y-2">
          <div className="h-2 w-full bg-background/10 rounded-full overflow-hidden border border-border">
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${Math.min(100, Math.max(0, progress))}%`,
                background: "#388E3C"
              }}
            />
          </div>
          <div className="flex justify-between items-center px-1">
            <span className="text-[0.6875rem] uppercase tracking-widest font-bold text-primary">Loading</span>
            <span className="text-[0.6875rem] uppercase tracking-widest font-bold text-foreground">{Math.round(progress)}%</span>
          </div>
        </div>
      )}
    </div>
  );
}