import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Geo-restriction: Restrict account creation to Nigeria ('NG')
  const isSignupPath = pathname === '/signup' || pathname.startsWith('/onboarding') || pathname.startsWith('/api/auth/signup');
  if (isSignupPath) {
    const country = request.headers.get('x-vercel-ip-country') || request.headers.get('cf-ipcountry');
    if (country && country.toUpperCase() !== 'NG') {
      return NextResponse.json(
        { error: 'Account creation is currently only available to users located in Nigeria.' },
        { status: 403 }
      );
    }
  }

  // Nextdoor-style handoff: redirect the app's /login page back to the marketing site
  if (pathname === '/login' || pathname === '/signup') {
    const marketingUrl = process.env.NEXT_PUBLIC_MARKETING_URL || 'https://yrdly.ng';
    return NextResponse.redirect(marketingUrl);
  }

  const maintenanceEnabled = process.env.MAINTENANCE_MODE === 'true';

  if (!maintenanceEnabled) {
    return NextResponse.next();
  }

  // Allow the maintenance page itself and common static assets to load
  const isAllowedPath =
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.startsWith('/images') ||
    pathname.startsWith('/monitoring') ||
    pathname === '/favicon.ico' ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml' ||
    pathname.startsWith('/maintenance');

  if (isAllowedPath) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = '/maintenance';
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/((?!_next|static|images|favicon\.ico|robots\.txt|sitemap\.xml|monitoring|maintenance).*)'],
};


