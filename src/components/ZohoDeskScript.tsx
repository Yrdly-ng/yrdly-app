'use client';

import Script from 'next/script';

export function ZohoDeskScript() {
  if (process.env.NODE_ENV !== 'production') {
    return null;
  }

  return (
    <>
      <Script id="zohodeskasap" strategy="lazyOnload">
        {`
          window.ZohoDeskAsapReady=function(s){var e=window.ZohoDeskAsap__asyncalls=window.ZohoDeskAsap__asyncalls||[];window.ZohoDeskAsapReadyStatus?(s&&e.push(s),e.forEach(s=>s&&s()),window.ZohoDeskAsap__asyncalls=null):s&&e.push(s)};
          window.ZohoDeskAsapReady(function() {
            if (window.ZohoDeskAsap) {
              window.ZohoDeskAsap.invoke('hide', 'launcher');
            }
          });
        `}
      </Script>
      <Script 
        id="zohodeskasapscript" 
        strategy="lazyOnload" 
        src="https://desk.zoho.com/portal/api/web/asapApp/1369927000000404854?orgId=925875390" 
        onError={(e) => {
          console.warn('Zoho Desk ASAP script failed to load:', e);
        }}
      />
    </>
  );
}
