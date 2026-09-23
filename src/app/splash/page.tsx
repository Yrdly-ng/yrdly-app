'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const YRDLY_MARK_D =
  'M5705 8661 c-248 -46 -439 -174 -590 -395 -127 -188 -175 -359 -175 -628 0 -223 37 -384 125 -545 138 -252 381 -418 670 -459 93 -14 307 -14 400 0 286 41 532 207 670 454 88 161 125 322 125 545 0 274 -48 444 -178 635 -149 217 -342 346 -592 393 -91 17 -364 17 -455 0z m440 -432 c162 -35 301 -140 376 -285 53 -102 74 -194 74 -329 0 -137 -21 -228 -76 -333 -74 -142 -214 -249 -374 -285 -99 -23 -271 -23 -370 0 -160 36 -300 143 -374 285 -55 105 -76 196 -76 333 0 135 21 227 74 329 74 143 214 249 373 285 91 22 263 22 348 0z M5598 4402 c-314 -42 -571 -207 -709 -454 -88 -161 -125 -322 -125 -545 0 -274 48 -444 178 -635 150 -217 342 -346 593 -393 91 -17 363 -17 454 0 248 46 439 174 590 395 127 188 175 359 175 628 0 223 -37 384 -125 545 -138 252 -381 418 -670 459 -93 14 -307 14 -400 0z m437 -433 c161 -35 301 -142 375 -287 53 -102 74 -194 74 -329 0 -137 -21 -228 -76 -333 -74 -142 -214 -249 -374 -285 -99 -23 -271 -23 -370 0 -160 36 -300 143 -374 285 -55 105 -76 196 -76 333 0 135 21 227 74 329 74 143 214 249 373 285 91 22 263 22 348 0z';

export default function SplashScreen() {
  const router = useRouter();

  useEffect(() => {
    const navTimer = setTimeout(() => {
      router.push('/home');
    }, 2200);

    return () => {
      clearTimeout(navTimer);
    };
  }, [router]);

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-background z-50 select-none">
      <div className="relative flex flex-col items-center gap-6 animate-fade-in transition-all duration-700">
        <div className="text-center space-y-1">
          <h1
            className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground"
            style={{ fontFamily: 'var(--font-raleway)' }}
          >
            YRDLY
          </h1>
          <p className="text-xs sm:text-sm font-medium text-muted-foreground uppercase tracking-widest">
            Your Local Neighborhood Network
          </p>
        </div>
      </div>
    </div>
  );
}
