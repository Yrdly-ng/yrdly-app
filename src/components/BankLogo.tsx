"use client";

import Image from 'next/image';
import { useState } from 'react';
import { useBankLogos } from '@/hooks/use-bank-logos';

export function BankLogo({ code, name, size = 24 }: { code: string; name: string; size?: number }) {
  const { getBankLogo } = useBankLogos();
  const logoUrl = getBankLogo(code, name);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (logoUrl && failedUrl !== logoUrl) {
    return <Image src={logoUrl} alt={name} width={size} height={size} unoptimized
      onError={() => setFailedUrl(logoUrl)}
      className="rounded-full object-contain border border-border bg-white p-0.5 shrink-0" />;
  }

  return <div role="img" aria-label={name || 'Bank'}
    className="rounded-full flex items-center justify-center font-bold bg-primary/10 text-primary border border-primary/20 shrink-0"
    style={{ width: size, height: size, fontSize: size * 0.4 }}>
    {(name || 'Bank').substring(0, 2).toUpperCase()}
  </div>;
}
