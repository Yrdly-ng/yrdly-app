import { useState, useEffect } from 'react';

// Global memory cache for the session
let mappingCache: Record<string, string> | null = null;
let fetchPromise: Promise<Record<string, string>> | null = null;

const MAPPING_URL = "https://yoiyqxtpmxnrrbqqidcs.supabase.co/storage/v1/object/public/bank-logos/mapping.json";

export function useBankLogos() {
  const [mapping, setMapping] = useState<Record<string, string>>(mappingCache || {});

  useEffect(() => {
    if (mappingCache) return;
    
    if (!fetchPromise) {
      fetchPromise = fetch(MAPPING_URL)
        .then(res => res.json())
        .then(data => {
          mappingCache = data;
          return data;
        })
        .catch(err => {
          console.error("Failed to fetch bank logos mapping:", err);
          fetchPromise = null; // allow retry
          return {};
        });
    }
    
    fetchPromise.then(data => {
      setMapping(data);
    });
  }, []);

  const getBankLogo = (code: string): string | null => {
    return mapping[code] || null;
  };

  return { getBankLogo, isLoaded: !!mappingCache };
}
