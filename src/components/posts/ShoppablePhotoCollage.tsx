"use client";

import Image from "next/image";

interface ShoppablePhotoCollageProps {
  images: string[];
  priceLabel: string;
  title: string;
  onOpen: (index: number) => void;
}

/**
 * Existing For Sale posts only: 2+ photographs from the *same* listing.
 * 2 images: side-by-side; 3+: one prominent image and two stacked.
 * Mixed media keeps the original carousel. Never fabricates product variants.
 */
export function ShoppablePhotoCollage({
  images,
  priceLabel,
  title,
  onOpen,
}: ShoppablePhotoCollageProps) {
  const photos = images.slice(0, 3);
  const remaining = Math.max(0, images.length - 3);

  const tile = (index: number, className: string) => (
    <button
      key={index}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen(index);
      }}
      aria-label={`View photo ${index + 1} of ${images.length} for ${title}`}
      className={`group relative block min-w-0 overflow-hidden bg-muted focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${className}`}
    >
      <Image
        src={photos[index]}
        alt={`${title}, photo ${index + 1}`}
        fill
        sizes="(max-width: 640px) 65vw, 400px"
        className="object-cover transition-transform duration-200 group-hover:scale-[1.02]"
      />
      {index === 2 && remaining > 0 && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-xl font-bold text-white">
          +{remaining}
        </span>
      )}
    </button>
  );

  return (
    <div className="relative overflow-hidden rounded-2xl">
      <div className="flex h-56 gap-1 sm:h-72">
        <div className="min-w-0 flex-[1.7]">
          {tile(0, "h-full w-full")}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {photos.length === 2
            ? tile(1, "h-full w-full")
            : (
              <>
                {tile(1, "min-h-0 flex-1 w-full")}
                {tile(2, "min-h-0 flex-1 w-full")}
              </>
            )}
        </div>
      </div>
      <span className="pointer-events-none absolute bottom-3 right-3 rounded-lg bg-emerald-950/95 px-3 py-2 font-yrdly-display text-sm font-bold text-white shadow-sm">
        {priceLabel}
      </span>
    </div>
  );
}
