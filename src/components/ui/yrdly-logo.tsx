"use client";

import Image from "next/image";

export function YrdlyLogo() {
  return (
    <div className="flex items-center gap-1">
      <Image 
        src="/logo.png" 
        alt="Yrdly Logo" 
        width={64} 
        height={64}
        className="w-16 h-16"
        priority
      />
    </div>
  );
}

