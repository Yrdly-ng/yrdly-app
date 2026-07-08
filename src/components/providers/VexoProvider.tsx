'use client';

import { useEffect } from 'react';
import { vexo } from 'vexo-analytics';

export function VexoProvider() {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_VEXO_API_KEY) {
      try {
        vexo(process.env.NEXT_PUBLIC_VEXO_API_KEY);
      } catch (e) {
        console.warn('Failed to initialize Vexo analytics:', e);
      }
    }
  }, []);

  return null;
}
