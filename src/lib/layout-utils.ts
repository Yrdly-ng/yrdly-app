export type WidthTier = 'narrow' | 'default' | 'wide' | 'xwide' | 'full';

export function getPageWidthTier(pathname: string): string {
  if (pathname.startsWith('/settings')) {
    return 'max-w-[680px] mx-auto lg:max-w-5xl';
  }

  if (pathname.startsWith('/transactions')) {
    return 'max-w-[680px] mx-auto lg:max-w-4xl';
  }

  if (pathname.startsWith('/admin')) {
    return 'max-w-[680px] mx-auto lg:max-w-none';
  }

  if (
    pathname.startsWith('/payment') ||
    pathname.startsWith('/verify-phone') ||
    pathname === '/profile/payout-settings'
  ) {
    return 'max-w-[680px] mx-auto lg:max-w-xl';
  }

  if (
    pathname === '/profile' ||
    (pathname.startsWith('/profile/') &&
      pathname !== '/profile/purchases' &&
      pathname !== '/profile/sold-items' &&
      pathname !== '/profile/payouts' &&
      pathname !== '/profile/payout-settings')
  ) {
    return 'max-w-[680px] mx-auto lg:max-w-4xl min-[1440px]:max-w-7xl';
  }

  if (
    (pathname.startsWith('/marketplace') && pathname !== '/marketplace/create') ||
    pathname === '/profile/payouts' ||
    pathname.startsWith('/my-listings') ||
    pathname.startsWith('/disputes')
  ) {
    return 'max-w-[680px] mx-auto lg:max-w-5xl';
  }

  if (pathname.startsWith('/posts')) {
    return 'max-w-[680px] mx-auto lg:max-w-5xl min-[1440px]:max-w-6xl';
  }

  return 'max-w-[680px] mx-auto lg:max-w-2xl';
}
