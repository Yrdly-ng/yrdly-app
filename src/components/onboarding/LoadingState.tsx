"use client";

import { CheckCircle, RefreshCw, Mail, User, MapPin, Sparkles } from 'lucide-react';
import { cn } from "@/lib/utils";

interface LoadingStateProps {
  type: 'email' | 'profile' | 'location' | 'general';
  message?: string;
  progress?: number;
}

const loadingConfig = {
  email: {
    icon: Mail,
    defaultMessage: "Setting up your email verification...",
    color: "#388E3C",
    accent: "rgba(56, 142, 60, 0.2)"
  },
  profile: {
    icon: User,
    defaultMessage: "Creating your profile...",
    color: "#388E3C",
    accent: "rgba(56, 142, 60, 0.2)"
  },
  location: {
    icon: MapPin,
    defaultMessage: "Loading location data...",
    color: "#388E3C",
    accent: "rgba(56, 142, 60, 0.2)"
  },
  general: {
    icon: RefreshCw,
    defaultMessage: "Loading...",
    color: "#388E3C",
    accent: "rgba(56, 142, 60, 0.2)"
  }
};

export function LoadingState({ type, message, progress }: LoadingStateProps) {
  const config = loadingConfig[type];
  const Icon = config.icon;

  return (
    <div className="flex flex-col items-center justify-center p-8 space-y-12 animate-in fade-in zoom-in duration-1000 min-h-[500px] relative overflow-hidden" style={{ fontFamily: "\"Pacifico\", cursive" }}>
      
      {/* Dynamic Background Glows */}
      <div 
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full blur-[120px] opacity-20 animate-pulse"
        style={{ background: config.color }}
      />
      
      {/* Animated Orbiting Element */}
      <div className="relative">
        <div className="relative w-40 h-40">
          {/* Layered Orbiting Rings */}
          <div className="absolute inset-0 rounded-full border border-[#388E3C]/20 animate-[spin_10s_linear_infinite]" />
          <div className="absolute inset-4 rounded-full border border-[#388E3C]/10 animate-[spin_6s_linear_reverse_infinite]" />
          <div className="absolute inset-8 rounded-full border-t-2 border-[#388E3C] animate-[spin_3s_ease-in-out_infinite]" />
          
          {/* Main Icon Container - Premium Glassmorphism */}
          <div 
            className="absolute inset-0 rounded-[48px] flex items-center justify-center backdrop-blur-3xl overflow-hidden group shadow-[0_0_50px_-12px_rgba(56,142,60,0.5)]"
            style={{ 
              background: "linear-gradient(135deg, rgba(30, 33, 38, 0.8) 0%, rgba(13, 15, 17, 0.9) 100%)",
              border: "1px solid var(--c-border)",
            }}
          >
            {/* Animated Gradient Shine */}
            <div className="absolute inset-0 bg-gradient-to-tr from-[#388E3C]/10 via-transparent to-transparent opacity-50" />
            
            <div className="relative z-10 flex flex-col items-center gap-3">
              <Icon 
                className={cn("w-16 h-16 text-foreground drop-shadow-[0_0_15px_rgba(255,255,255,0.3)]", type === 'general' ? 'animate-spin' : 'animate-bounce')} 
                style={{ animationDuration: type === 'general' ? '2.5s' : '3s' }}
              />
              <div className="flex gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-[#388E3C] animate-bounce" style={{ animationDelay: '0s' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-[#388E3C] animate-bounce" style={{ animationDelay: '0.2s' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-[#388E3C] animate-bounce" style={{ animationDelay: '0.4s' }} />
              </div>
            </div>
            
            {/* Floating particles */}
            <Sparkles className="absolute top-6 right-6 w-5 h-5 text-[#388E3C] opacity-40 animate-pulse" />
            <Sparkles className="absolute bottom-6 left-6 w-3 h-3 text-[#388E3C] opacity-20 animate-pulse" style={{ animationDelay: '1s' }} />
          </div>
        </div>
      </div>
      
      <div className="text-center space-y-8 max-w-sm relative z-10">
        <div className="space-y-3">
          <h3 className="text-4xl font-black tracking-tight text-foreground leading-tight">
            {message || config.defaultMessage}
          </h3>
          <p className="text-muted-foreground text-lg font-medium leading-relaxed opacity-80">
            {type === 'email' && "Verifying your digital signature and securing your neighborhood presence..."}
            {type === 'profile' && "Syncing your identity with the neighborhood network..."}
            {type === 'location' && "Calibrating local sector data for your experience..."}
            {type === 'general' && "Crafting your premium neighborhood experience..."}
          </p>
        </div>

        {progress !== undefined && (
          <div className="w-full max-w-[280px] mx-auto space-y-5">
            <div className="h-2.5 w-full bg-white/5 rounded-full overflow-hidden p-0.5 border border-border shadow-inner">
              <div 
                className="h-full transition-all duration-1000 ease-out rounded-full relative overflow-hidden"
                style={{ 
                  width: `${Math.min(100, Math.max(0, progress))}%`, 
                  background: "linear-gradient(90deg, #388E3C 0%, #82DB7E 100%)",
                  boxShadow: "0 0 25px rgba(56, 142, 60, 0.6)"
                }}
              >
                {/* High-speed shimmer effect */}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent translate-x-[-100%] animate-[shimmer_1.5s_infinite]" />
              </div>
            </div>
            <div className="flex justify-between items-center px-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[#388E3C] animate-pulse" />
                <span className="text-[0.6875rem] uppercase tracking-[0.25em] font-black text-[#388E3C]">Optimizing</span>
              </div>
              <span className="text-[0.6875rem] uppercase tracking-[0.25em] font-black text-foreground">{Math.round(progress)}%</span>
            </div>
          </div>
        )}
      </div>

      {/* Security/Encouragement Badge */}
      <div className="flex items-center gap-3 px-6 py-3 rounded-2xl bg-white/[0.03] border border-border backdrop-blur-xl shadow-xl animate-in slide-in-from-bottom-4 duration-1000 delay-500">
        <CheckCircle className="w-5 h-5 text-[#388E3C]" />
        <span className="text-[0.6875rem] uppercase tracking-[0.3em] font-black text-muted-foreground">Secure Handshake Active</span>
      </div>
    </div>
  );
}
