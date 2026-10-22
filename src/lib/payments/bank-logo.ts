import catalogue from './bank-logo-catalogue.json';

/** Match identities, never approximate bank names or truncate provider codes. */
export function normalizeBankName(name: string): string {
  return name.toLowerCase().replace(/&/g, 'and')
    .replace(/\bmfb\b/g, 'microfinance bank')
    .replace(/\b(ltd|limited|plc|ng)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

const names = new Map<string, string>();
const codes = new Map<string, string>();
for (const bank of catalogue) {
  for (const name of bank.names) names.set(normalizeBankName(name), bank.file);
  for (const code of bank.codes) codes.set(code, bank.file);
}

export function resolveBankLogo(code: string | number | null | undefined, name?: string): string | null {
  // A supplied name wins: different providers can assign the same code to different banks.
  if (name?.trim()) return names.get(normalizeBankName(name)) ?? null;
  const value = String(code ?? '').trim();
  return codes.get(value) ?? (/^\d{1,2}$/.test(value) ? codes.get(value.padStart(3, '0')) : undefined) ?? null;
}
