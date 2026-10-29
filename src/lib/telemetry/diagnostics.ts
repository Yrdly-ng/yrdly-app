/** Fixed categories only: never send the original server payload or user content. */
export function diagnosticMessage(value: unknown): string {
  const text = value instanceof Error ? value.message :
    value && typeof value === 'object' && 'message' in value && typeof value.message === 'string' ? value.message : '';
  if (diagnosticMessages.has(text)) return text;
  if (/cannot add.*callbacks.*after.*subscribe/i.test(text)) return 'Realtime channel listener registered after subscription';
  if (/API key not found|com.google.android.geo.API_KEY/i.test(text)) return 'Native Google Maps API key missing';
  if (/foreign key constraint|23503/i.test(text)) return 'Database relationship unavailable';
  if (/network request failed|failed to fetch|networkerror/i.test(text)) return 'Network request unavailable';
  if (/timeout|timed out/i.test(text)) return 'Operation timed out';
  if (/invalid session|jwt expired|auth session missing/i.test(text)) return 'Authentication session unavailable';
  return 'Application operation failed';
}

export const diagnosticMessages = new Set([
  'Realtime channel listener registered after subscription',
  'Native Google Maps API key missing',
  'Database relationship unavailable',
  'Network request unavailable',
  'Operation timed out',
  'Authentication session unavailable',
  'Application operation failed',
]);
