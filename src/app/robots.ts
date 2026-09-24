import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.yrdly.ng';
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/auth/', '/marketplace', '/events', '/businesses', '/map', '/_next/'],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
