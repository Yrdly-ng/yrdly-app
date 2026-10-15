/** Use the activated YRDLY API domain for the production project only. */
export function brandedSupabaseUrl(configuredUrl: string): string {
  try {
    const url = new URL(configuredUrl);
    if (url.hostname === 'yoiyqxtpmxnrrbqqidcs.supabase.co') {
      return 'https://api.yrdly.ng';
    }
  } catch {
    // Preserve missing/invalid configuration for the client's normal validation.
  }
  return configuredUrl;
}
