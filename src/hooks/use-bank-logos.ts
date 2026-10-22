import { resolveBankLogo } from '@/lib/payments/bank-logo';

// Bundled catalogue avoids one network request per picker and works offline.
export function useBankLogos() {
  return {
    getBankLogo(code: string | number | null | undefined, name?: string): string | null {
      const file = resolveBankLogo(code, name);
      return file ? `/bank-logos/${file}` : null;
    },
    isLoaded: true,
  };
}
