/**
 * Onboarding Analytics and Tracking
 * Tracks user progress through the onboarding flow for insights and optimization
 */

export interface OnboardingEvent {
  event: string;
  properties?: Record<string, any>;
  timestamp: string;
  userId?: string;
}

export interface OnboardingMetrics {
  step: string;
  completionRate: number;
  averageTimeSpent: number;
  dropoffRate: number;
  commonIssues: string[];
}

class OnboardingAnalytics {
  private events: OnboardingEvent[] = [];
  private stepStartTimes: Map<string, number> = new Map();

  /**
   * Track an onboarding event
   */
  track(event: string, properties?: Record<string, any>) {
    const trackingEvent: OnboardingEvent = {
      event,
      properties: {
        ...properties,
        timestamp: new Date().toISOString(),
        userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : undefined,
        url: typeof window !== 'undefined' ? window.location.href : undefined,
      },
      timestamp: new Date().toISOString(),
    };

    this.events.push(trackingEvent);
    
    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
    }

    // Send to analytics service (implement based on your analytics provider)
    this.sendToAnalytics(trackingEvent);
  }

  /**
   * Track step start
   */
  trackStepStart(step: string, properties?: Record<string, any>) {
    this.stepStartTimes.set(step, Date.now());
    this.track('onboarding_step_started', {
      step,
      ...properties,
    });
  }

  /**
   * Track step completion
   */
  trackStepComplete(step: string, properties?: Record<string, any>) {
    const startTime = this.stepStartTimes.get(step);
    const timeSpent = startTime ? Date.now() - startTime : 0;

    this.track('onboarding_step_completed', {
      step,
      timeSpent,
      ...properties,
    });

    this.stepStartTimes.delete(step);
  }

  /**
   * Track step skip
   */
  trackStepSkip(step: string, reason?: string, properties?: Record<string, any>) {
    this.track('onboarding_step_skipped', {
      step,
      reason,
      ...properties,
    });
  }

  /**
   * Track onboarding completion
   */
  trackOnboardingComplete(totalTime: number, properties?: Record<string, any>) {
    this.track('onboarding_completed', {
      totalTime,
      stepsCompleted: this.events.filter(e => e.event === 'onboarding_step_completed').length,
      ...properties,
    });
  }

  /**
   * Track onboarding abandonment
   */
  trackOnboardingAbandoned(lastStep: string, reason?: string, properties?: Record<string, any>) {
    this.track('onboarding_abandoned', {
      lastStep,
      reason,
      totalSteps: this.events.filter(e => e.event === 'onboarding_step_started').length,
      ...properties,
    });
  }

  /**
   * Track specific onboarding events
   */
  trackEmailVerificationSent(email: string) {
    this.track('email_verification_sent', { email });
  }

  trackEmailVerificationCompleted(email: string, method: 'link' | 'manual') {
    this.track('email_verification_completed', { email, method });
  }

  trackProfileSetupStarted(hasLocation: boolean) {
    this.track('profile_setup_started', { hasLocation });
  }

  trackProfileSetupCompleted(profileData: {
    hasUsername: boolean;
    hasLocation: boolean;
    hasAvatar: boolean;
    locationCompleteness: number;
  }) {
    this.track('profile_setup_completed', profileData);
  }

  trackWelcomeMessageSent(email: string) {
    this.track('welcome_message_sent', { email });
  }

  trackTourStarted() {
    this.track('tour_started');
  }

  trackTourCompleted(stepsCompleted: number, totalSteps: number) {
    this.track('tour_completed', { stepsCompleted, totalSteps });
  }

  trackTourSkipped(reason?: string) {
    this.track('tour_skipped', { reason });
  }

  /**
   * Track errors during onboarding
   */
  trackError(step: string, error: string, properties?: Record<string, any>) {
    this.track('onboarding_error', {
      step,
      error,
      ...properties,
    });
  }

  /**
   * Get onboarding metrics
   */
  getMetrics(): OnboardingMetrics[] {
    const stepMetrics: Map<string, {
      started: number;
      completed: number;
      skipped: number;
      totalTime: number;
      errors: string[];
    }> = new Map();

    // Process events to calculate metrics
    this.events.forEach(event => {
      if (event.event === 'onboarding_step_started') {
        const step = event.properties?.step;
        if (step) {
          const current = stepMetrics.get(step) || { started: 0, completed: 0, skipped: 0, totalTime: 0, errors: [] };
          current.started++;
          stepMetrics.set(step, current);
        }
      } else if (event.event === 'onboarding_step_completed') {
        const step = event.properties?.step;
        const timeSpent = event.properties?.timeSpent || 0;
        if (step) {
          const current = stepMetrics.get(step) || { started: 0, completed: 0, skipped: 0, totalTime: 0, errors: [] };
          current.completed++;
          current.totalTime += timeSpent;
          stepMetrics.set(step, current);
        }
      } else if (event.event === 'onboarding_step_skipped') {
        const step = event.properties?.step;
        if (step) {
          const current = stepMetrics.get(step) || { started: 0, completed: 0, skipped: 0, totalTime: 0, errors: [] };
          current.skipped++;
          stepMetrics.set(step, current);
        }
      } else if (event.event === 'onboarding_error') {
        const step = event.properties?.step;
        const error = event.properties?.error;
        if (step && error) {
          const current = stepMetrics.get(step) || { started: 0, completed: 0, skipped: 0, totalTime: 0, errors: [] };
          current.errors.push(error);
          stepMetrics.set(step, current);
        }
      }
    });

    // Convert to metrics array
    return Array.from(stepMetrics.entries()).map(([step, data]) => ({
      step,
      completionRate: data.started > 0 ? (data.completed / data.started) * 100 : 0,
      averageTimeSpent: data.completed > 0 ? data.totalTime / data.completed : 0,
      dropoffRate: data.started > 0 ? ((data.started - data.completed - data.skipped) / data.started) * 100 : 0,
      commonIssues: [...new Set(data.errors)],
    }));
  }

  /**
   * Send event to analytics service
   */
  private sendToAnalytics(event: OnboardingEvent) {
    // Implement based on your analytics provider
    // Examples:
    
    // Google Analytics 4
    if (typeof window !== 'undefined' && (window as any).gtag) {
      (window as any).gtag('event', event.event, {
        event_category: 'onboarding',
        event_label: event.properties?.step || 'unknown',
        ...event.properties,
      });
    }

    // Mixpanel
    if (typeof window !== 'undefined' && (window as any).mixpanel) {
      (window as any).mixpanel.track(event.event, event.properties);
    }

    // PostHog
    if (typeof window !== 'undefined' && (window as any).posthog) {
      (window as any).posthog.capture(event.event, event.properties);
    }

    // Custom analytics endpoint
    // To be implemented when custom analytics backend is ready
  }

  /**
   * Clear all tracked events (useful for testing)
   */
  clear() {
    this.events = [];
    this.stepStartTimes.clear();
  }
}

// Export singleton instance
export const onboardingAnalytics = new OnboardingAnalytics();

// Export individual tracking functions for convenience
export const trackOnboardingEvent = (event: string, properties?: Record<string, any>) => {
  onboardingAnalytics.track(event, properties);
};

export const trackStepStart = (step: string, properties?: Record<string, any>) => {
  onboardingAnalytics.trackStepStart(step, properties);
};

export const trackStepComplete = (step: string, properties?: Record<string, any>) => {
  onboardingAnalytics.trackStepComplete(step, properties);
};

export const trackStepSkip = (step: string, reason?: string, properties?: Record<string, any>) => {
  onboardingAnalytics.trackStepSkip(step, reason, properties);
};

export const trackOnboardingComplete = (totalTime: number, properties?: Record<string, any>) => {
  onboardingAnalytics.trackOnboardingComplete(totalTime, properties);
};

export const trackOnboardingAbandoned = (lastStep: string, reason?: string, properties?: Record<string, any>) => {
  onboardingAnalytics.trackOnboardingAbandoned(lastStep, reason, properties);
};
