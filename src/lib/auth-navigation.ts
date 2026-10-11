/** Accept application paths only, after WHATWG URL normalization. */
export function safeRelativePath(value: string | null | undefined, fallback = '/', origin = 'https://app.yrdly.ng'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return fallback;
  try {
    const url = new URL(value,origin);
    return url.origin === new URL(origin).origin ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch { return fallback; }
}

export function productionAppHost(): string {
  return (process.env.NEXT_PUBLIC_APP_HOSTNAME || 'app.yrdly.ng').toLowerCase();
}

export function authCookieDomain(host: string): string | undefined {
  const hostname = host.toLowerCase().split(':')[0];
  return [productionAppHost(),'yrdly.ng','www.yrdly.ng'].includes(hostname) ? '.yrdly.ng' : undefined;
}
