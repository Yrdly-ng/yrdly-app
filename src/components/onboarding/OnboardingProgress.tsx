"use client";

import { useOnboarding } from '@/hooks/use-onboarding';
import { Progress } from '@/components/ui/progress';
import { CheckCircle } from 'lucide-react';

interface OnboardingProgressProps {
  className?: string;
}

const steps = [
  { key: 'signup', label: 'Sign Up', completed: true },
  { key: 'email_verification', label: 'Verify Email', completed: false },
  { key: 'profile_setup', label: 'Profile Setup', completed: false },
  { key: 'welcome', label: 'Welcome', completed: false },
  { key: 'tour', label: 'Tour', completed: false },
];

export function OnboardingProgress({ className = '' }: OnboardingProgressProps) {
  const { currentStep } = useOnboarding();

  const currentStepIndex = steps.findIndex(step => step.key === currentStep);
  const progress = ((currentStepIndex + 1) / steps.length) * 100;

  return (
    <div 
      className={`sticky top-0 z-50 ${className}`}
      style={{ 
        background: "var(--c-bg)", 
        borderBottom: "1px solid var(--c-border)",
        backdropFilter: "blur(20px)",
        fontFamily: "Inter, sans-serif"
      }}
    >
      <div className="max-w-md mx-auto px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium" style={{ color: "#a1a1aa" }}>
            Step {currentStepIndex + 1} of {steps.length}
          </span>
          <span className="text-sm" style={{ color: "#a1a1aa" }}>
            {Math.round(progress)}% Complete
          </span>
        </div>
        
        {/* Progress Bar Container */}
        <div className="h-1.5 w-full rounded-full mb-3 bg-white/5 border border-border overflow-hidden">
          <div 
            className="h-full rounded-full transition-all duration-1000 ease-out relative overflow-hidden"
            style={{ 
              width: `${progress}%`, 
              background: "linear-gradient(90deg, #388E3C 0%, #82DB7E 100%)",
              boxShadow: "0 0 15px rgba(56, 142, 60, 0.4)"
            }}
          >
            {/* Animated shimmer */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-100%] animate-[shimmer_2s_infinite]" />
          </div>
        </div>
        
        <div className="flex items-center justify-between">
          {steps.map((step, index) => (
            <div
              key={step.key}
              className={`flex items-center gap-1 text-xs`}
              style={{
                color: index <= currentStepIndex ? "#388E3C" : "#666",
                fontWeight: index <= currentStepIndex ? "600" : "400"
              }}
            >
              {index < currentStepIndex ? (
                <CheckCircle className="w-3 h-3" style={{ color: "#388E3C" }} />
              ) : (
                <div
                  className="w-3 h-3 rounded-full border-2"
                  style={{
                    borderColor: index === currentStepIndex ? "#388E3C" : "#555",
                    background: index === currentStepIndex ? "#388E3C" : "transparent"
                  }}
                />
              )}
              <span className="hidden sm:inline">{step.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
