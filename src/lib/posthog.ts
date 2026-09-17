/** Safe no-op stub replacing posthog-js */
const posthog = {
  capture: (_event?: string, _properties?: Record<string, any>) => {},
  identify: (_distinctId?: string, _properties?: Record<string, any>) => {},
  reset: () => {},
};

export default posthog;
