export interface GiphyGif {
  id: string;
  title: string;
  images: {
    fixed_height_small?: { url: string };
    fixed_width?: { url: string };
    downsized?: { url: string };
    downsized_large?: { url: string };
    original?: { url: string };
  };
  analytics?: { on_sent?: { url: string } };
}

export function getGiphyMediaUrl(gif: GiphyGif): string {
  const source =
    gif.images.downsized?.url ||
    gif.images.downsized_large?.url ||
    gif.images.original?.url;
  if (!source)
    throw new Error("This GIF is unavailable. Please choose another.");
  const url = new URL(source);
  if (
    url.protocol !== "https:" ||
    !/^(?:media\d*|i)\.giphy\.com$/.test(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new Error("This GIF is unavailable. Please choose another.");
  }
  return source;
}

export function registerGiphySend(gif: GiphyGif): void {
  const source = gif.analytics?.on_sent?.url;
  if (!source) return;
  try {
    const url = new URL(source);
    if (
      url.protocol === "https:" &&
      url.hostname.endsWith(".giphy.com") &&
      !url.username &&
      !url.password &&
      !url.port
    ) {
      void fetch(source, { mode: "no-cors", keepalive: true }).catch(() => {});
    }
  } catch {
    /* Analytics must never block message delivery. */
  }
}
