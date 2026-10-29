"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

/** Generate admission codes on the device; never send ticket tokens to an image service. */
export function TicketEntryCode({ token }: { token: string }) {
  const [image, setImage] = useState<{ token: string; url: string } | null>(
    null,
  );
  const [failedToken, setFailedToken] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    void import("qrcode")
      .then((qr) =>
        qr.toDataURL(token, {
          width: 220,
          margin: 4,
          color: { dark: "#102110", light: "#FFFFFF" },
        }),
      )
      .then((url) => {
        if (current) setImage({ token, url });
      })
      .catch(() => {
        if (current) setFailedToken(token);
      });
    return () => {
      current = false;
    };
  }, [token, attempt]);

  if (image?.token === token) {
    return (
      <Image
        src={image.url}
        alt="Ticket QR Code"
        width={220}
        height={220}
        className="rounded-xl"
        unoptimized
      />
    );
  }
  if (failedToken === token) {
    return (
      <div role="alert" className="text-center text-sm text-muted-foreground">
        <p>Couldn’t display your entry code.</p>
        <button
          type="button"
          className="min-h-11 font-semibold text-primary"
          onClick={() => {
            setFailedToken(null);
            setAttempt((value) => value + 1);
          }}
        >
          Try again
        </button>
      </div>
    );
  }
  return (
    <p role="status" className="py-12 text-sm text-muted-foreground">
      Preparing entry code…
    </p>
  );
}
