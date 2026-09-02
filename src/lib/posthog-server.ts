/** Dummy PostHog client stub */
const dummyClient = {
  capture: () => {},
  identify: () => {},
  shutdown: async () => {},
};

export function getPostHogClient(): any {
  return dummyClient;
}
