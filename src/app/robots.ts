import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      // Let crawlers read each route's noindex metadata. Blocking these paths
      // prevents Google from seeing the noindex directive and can leave stale
      // app URLs in search results. Keep API and auth endpoints private.
      allow: '/',
      disallow: ['/api/', '/auth/'],
    },
  };
}
