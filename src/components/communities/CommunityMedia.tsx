"use client";
export function CommunityMedia({
  post,
}: {
  post: { resolved_image_urls?: string[]; resolved_video_urls?: string[] };
}) {
  return (
    <div className="space-y-3">
      {!!post.resolved_image_urls?.length && (
        <div className="flex gap-3 overflow-x-auto">
          {post.resolved_image_urls.filter(Boolean).map((url, index) => (
            <a
              key={index}
              href={url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open photo ${index + 1}`}
            >
              <img
                src={url}
                alt={`Community attachment ${index + 1}`}
                className="h-52 w-64 shrink-0 rounded-xl object-cover"
              />
            </a>
          ))}
        </div>
      )}
      {post.resolved_video_urls?.filter(Boolean).map((url, index) => (
        <video
          key={index}
          controls
          preload="metadata"
          src={url}
          className="max-h-96 w-full rounded-xl"
        />
      ))}
    </div>
  );
}
