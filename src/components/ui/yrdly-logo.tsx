"use client";

import Image from "next/image";

export function YrdlyLogo() {
  return (
    <div className="flex items-center gap-1">
      <Image 
        src="/yrdly-logo.png" 
        alt="Yrdly Logo" 
        width={40} 
        height={40}
        className="w-10 h-10"
        priority
      />
    </div>
  );
}

