"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { GiphyGif } from "@/lib/messages/giphy";

const apiKey = process.env.NEXT_PUBLIC_GIPHY_API_KEY;

export function GiphyPicker({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (gif: GiphyGif) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [results, setResults] = useState<GiphyGif[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const sending = useRef(false);

  useEffect(() => {
    if (!apiKey) {
      setError("GIF search is not configured yet. Please try again later.");
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const deadline = setTimeout(() => {
      setError("GIF search timed out. Please try again.");
      setLoading(false);
      controller.abort();
    }, 15000);
    setLoading(true);
    setError("");
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          api_key: apiKey,
          limit: "24",
          offset: String(page * 24),
          rating: "pg",
          lang: "en",
          ...(query.trim() ? { q: query.trim() } : {}),
        });
        const endpoint = query.trim() ? "search" : "trending";
        const response = await fetch(
          `https://api.giphy.com/v1/gifs/${endpoint}?${params}`,
          { signal: controller.signal },
        );
        if (!response.ok)
          throw new Error("GIF search is temporarily unavailable.");
        const payload = await response.json();
        if (!Array.isArray(payload.data))
          throw new Error("Could not load GIFs.");
        if (controller.signal.aborted) return;
        clearTimeout(deadline);
        setResults((previous) =>
          page ? [...previous, ...payload.data] : payload.data,
        );
        const total = payload.pagination?.total_count;
        setHasMore(
          payload.data.length === 24 &&
            (typeof total !== "number" || (page + 1) * 24 < total),
        );
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error ? failure.message : "Could not load GIFs.",
          );
      } finally {
        clearTimeout(deadline);
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      clearTimeout(deadline);
      controller.abort();
    };
  }, [query, page, retry]);

  const send = async (gif: GiphyGif) => {
    if (sending.current) return;
    sending.current = true;
    setSelected(gif.id);
    setError("");
    try {
      await onSelect(gif);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not send this GIF.",
      );
    } finally {
      sending.current = false;
      setSelected(null);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !sending.current) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[85dvh] flex-col sm:max-w-xl"
        onInteractOutside={(event) => {
          if (sending.current) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Send a GIF</DialogTitle>
        </DialogHeader>
        <input
          autoFocus
          type="search"
          maxLength={50}
          value={query}
          disabled={!!selected}
          aria-label="Search GIFs"
          placeholder="Search GIFs"
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
            setResults([]);
          }}
          className="w-full rounded-xl border border-border bg-background px-4 py-3"
        />
        <div aria-busy={loading} className="min-h-40 overflow-y-auto">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {results.map((gif, index) => (
              <button
                key={`${gif.id}-${index}`}
                type="button"
                disabled={!!selected}
                aria-label={`Send ${gif.title || "GIF"}`}
                onClick={() => void send(gif)}
                className="relative overflow-hidden rounded-lg disabled:opacity-50"
              >
                <Image
                  src={
                    gif.images.fixed_height_small?.url ||
                    gif.images.fixed_width?.url ||
                    gif.images.original?.url ||
                    ""
                  }
                  alt={gif.title || "GIF"}
                  width={180}
                  height={140}
                  unoptimized
                  className="h-32 w-full object-contain"
                />
                {selected === gif.id && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-white">
                    Sending…
                  </span>
                )}
              </button>
            ))}
          </div>
          {loading && (
            <p role="status" className="p-4 text-center text-sm">
              Loading GIFs…
            </p>
          )}
          {!loading && !error && !results.length && (
            <p className="p-4 text-center text-sm">
              No GIFs found. Try another search.
            </p>
          )}
          {error && (
            <div className="p-3 text-sm" role="alert">
              <p>{error}</p>
              {apiKey && (
                <button
                  type="button"
                  className="mt-2 text-primary"
                  onClick={() => setRetry((value) => value + 1)}
                >
                  Try again
                </button>
              )}
            </div>
          )}
          {!loading && hasMore && !error && (
            <button
              type="button"
              className="w-full p-3 text-primary"
              disabled={!!selected}
              onClick={() => setPage((value) => value + 1)}
            >
              Load more
            </button>
          )}
        </div>
        <a
          href="https://giphy.com"
          target="_blank"
          rel="noreferrer"
          className="text-center text-xs font-semibold text-muted-foreground"
        >
          Powered by GIPHY
        </a>
      </DialogContent>
    </Dialog>
  );
}
