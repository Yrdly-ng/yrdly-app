/** Fixed categories only: never send the original server payload or user content. */
export function diagnosticMessage(value: unknown): string {
  const text = value instanceof Error ? value.message :
    value && typeof value === 'object' && 'message' in value && typeof value.message === 'string' ? value.message : '';
  if (diagnosticMessages.has(text)) return text;
  if (/^(?:Abort|SIGABRT)$/.test(text)) return 'Native abort';
  if (/out of memory|failed to allocate a [0-9]+ byte allocation/i.test(text)) return 'Memory allocation failed';
  if (/^The (?:operation|user request) was aborted[.!]?$/.test(text)) return 'Operation cancelled';
  // Emit only fixed categories (or a bounded React error number), never the
  // property name, component content, URL or provider payload in the message.
  const reactError = text.match(/^Minified React error #([0-9]{1,3});/);
  if (reactError) return `React runtime error #${reactError[1]}`;
  if (/^React runtime error #[0-9]{1,3}$/.test(text)) return text;
  if (/maximum call stack size exceeded|too much recursion/i.test(text)) return 'JavaScript stack overflow';
  if (/cannot (?:read|set) propert(?:y|ies) of undefined|undefined is not an object/i.test(text)) return 'Undefined property access';
  if (/cannot (?:read|set) propert(?:y|ies) of null|null is not an object/i.test(text)) return 'Null property access';
  if (/loading (?:css )?chunk .+ failed|chunkloaderror|failed to fetch dynamically imported module|importing a module script failed/i.test(text)) return 'Application chunk unavailable';
  if (/RefererNotAllowedMapError/.test(text)) return 'Google Maps referrer rejected';
  if (/InvalidKeyMapError|MissingKeyMapError/.test(text)) return 'Google Maps API key unavailable';
  if (/ApiNotActivatedMapError/.test(text)) return 'Google Maps API not enabled';
  if (/BillingNotEnabledMapError/.test(text)) return 'Google Maps billing unavailable';
  if (/cannot add.*callbacks.*after.*subscribe/i.test(text)) return 'Realtime channel listener registered after subscription';
  if (/API key not found|com.google.android.geo.API_KEY/i.test(text)) return 'Native Google Maps API key missing';
  if (/foreign key constraint|23503/i.test(text)) return 'Database relationship unavailable';
  if (/network request failed|failed to fetch|networkerror/i.test(text)) return 'Network request unavailable';
  if (/timeout|timed out/i.test(text)) return 'Operation timed out';
  if (/invalid session|jwt expired|auth session missing/i.test(text)) return 'Authentication session unavailable';
  return 'Application operation failed';
}

export const diagnosticMessages = new Set([
  'Native abort',
  'Memory allocation failed',
  'Operation cancelled',
  'JavaScript stack overflow',
  'Undefined property access',
  'Null property access',
  'Application chunk unavailable',
  'Google Maps referrer rejected',
  'Google Maps API key unavailable',
  'Google Maps API not enabled',
  'Google Maps billing unavailable',
  'Realtime channel listener registered after subscription',
  'Native Google Maps API key missing',
  'Database relationship unavailable',
  'Network request unavailable',
  'Operation timed out',
  'Authentication session unavailable',
  'Application operation failed',
]);
