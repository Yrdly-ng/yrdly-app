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

const ONBOARDING_EVENTS = new Set([
  'onboarding_step_started', 'onboarding_step_completed',
  'onboarding_step_skipped', 'onboarding_completed', 'onboarding_abandoned',
  'onboarding_status_updated', 'email_verification_sent',
  'email_verification_completed', 'profile_setup_started', 'profile_setup_completed',
  'welcome_message_sent', 'tour_started', 'tour_completed', 'tour_skipped',
  'onboarding_error',
]);

const ONBOARDING_STEPS = new Set([
  'signup', 'email_verification', 'profile_setup', 'welcome', 'tour', 'completed',
]);

const ERROR_STEPS = new Set([...ONBOARDING_STEPS, 'update_status', 'tour_skip']);
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const NUMBER_LIMITS = {
  timeSpent: MAX_DURATION_MS,
  totalTime: MAX_DURATION_MS,
  stepsCompleted: 100,
  totalSteps: 100,
  locationCompleteness: 100,
};

type SafeParameters = Record<string, number | boolean | string>;

class OnboardingAnalytics {
  private events: OnboardingEvent[] = [];
  private stepStartTimes: Map<string, number> = new Map();

  /**
   * Track an onboarding event
   */
  track(event: string, properties?: Record<string, any>) {
    const trackingEvent: OnboardingEvent = {
      event,
      properties,
      timestamp: new Date().toISOString(),
    };

    this.events.push(trackingEvent);

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
  trackEmailVerificationSent(_email: string) {
    this.track('email_verification_sent');
  }

  trackEmailVerificationCompleted(_email: string, method: 'link' | 'manual') {
    this.track('email_verification_completed', { method });
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

  trackWelcomeMessageSent(_email: string) {
    this.track('welcome_message_sent');
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
  private sendToAnalytics({ event, properties }: OnboardingEvent) {
    if (typeof window === 'undefined' || !ONBOARDING_EVENTS.has(event)) return;

    const safe: SafeParameters = { event_category: 'onboarding' };
    for (const [key, max] of Object.entries(NUMBER_LIMITS)) {
      const value = properties?.[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max) {
        safe[key] = value;
      }
    }
    for (const key of ['hasLocation', 'hasUsername', 'hasAvatar', 'skipped']) {
      const value = properties?.[key];
      if (typeof value === 'boolean') safe[key] = value;
    }
    const step = properties?.step;
    const stepNames = event === 'onboarding_error' ? ERROR_STEPS : ONBOARDING_STEPS;
    if (typeof step === 'string' && stepNames.has(step)) {
      safe.step = step;
      safe.event_label = step;
    }
    for (const key of ['lastStep', 'status']) {
      const value = properties?.[key];
      if (typeof value === 'string' && ONBOARDING_STEPS.has(value)) safe[key] = value;
    }
    const method = properties?.method;
    if (method === 'link' || method === 'manual') safe.method = method;

    const providers = window as Window & {
      gtag?: (command: 'event', name: string, params: SafeParameters) => void;
      mixpanel?: { track: (name: string, params: SafeParameters) => void };
    };
    const page = 'https://app.yrdly.ng/onboarding';
    providers.gtag?.('event', event, {
      ...safe,
      // Google adds the current page and referrer when these are omitted.
      page_location: page,
      page_referrer: '',
      page_title: 'YRDLY onboarding',
    });
    providers.mixpanel?.track(event, {
      ...safe,
      $current_url: page,
      $referrer: '',
      $referring_domain: '',
      $initial_referrer: '',
      $initial_referring_domain: '',
    });
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
