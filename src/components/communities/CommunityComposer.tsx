"use client";
import React, { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  CommunityService,
  CommunityPost,
  CommunityComment,
} from "@/lib/communities/community-service";
import { useAuth } from "@/hooks/use-supabase-auth";
import {
  CommunityAvatar,
  communityField,
  communityButton,
  communityDialog,
  communityPrimaryButton,
} from "./CommunityTools";
export function CommunityComposer({
  communityId,
  post,
  comment,
  replyTo,
  canAnnounce = false,
  onClose,
  onSaved,
}: {
  communityId: string;
  post?: CommunityPost;
  comment?: CommunityComment;
  replyTo?: string;
  canAnnounce?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user, profile } = useAuth();
  const [text, setText] = useState(comment?.content || post?.content || "");
  const [files, setFiles] = useState<File[]>([]);
  const [images, setImages] = useState(post?.image_urls || []);
  const [videos, setVideos] = useState(post?.video_urls || []);
  const [announcement, setAnnouncement] = useState(
    post?.is_announcement || false,
  );
  const [mentions, setMentions] = useState<string[]>(
    comment?.mentioned_user_ids || post?.mentioned_user_ids || [],
  );
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<any[]>([]);
  const [mentioning, setMentioning] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  const reply = !!replyTo || !!comment;
  useEffect(() => {
    if (!mentioning) return;
    let current = true;
    const timer = setTimeout(() => {
      CommunityService.members(communityId, query)
        .then((rows) => {
          if (current)
            setMembers(rows.filter((row) => row.status === "active"));
        })
        .catch(() => {
          if (current) setMembers([]);
        });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [mentioning, communityId, query]);
  const selectFiles = (selected: File[]) => {
    const next = [...files, ...selected];
    if (
      next.filter((file) => file.type.startsWith("image/")).length +
        images.length >
        10 ||
      next.filter((file) => file.type.startsWith("video/")).length +
        videos.length >
        3
    ) {
      setError("Use up to 10 photos and 3 videos.");
      return;
    }
    if (
      selected.some(
        (file) =>
          (!file.type.startsWith("image/") &&
            !file.type.startsWith("video/")) ||
          file.size > (file.type.startsWith("video/") ? 40 : 10) * 1024 * 1024,
      )
    ) {
      setError("Use photos under 10 MB and videos under 40 MB.");
      return;
    }
    setFiles(next);
    setError("");
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const uploaded = await Promise.all(
        files.map(async (file) => ({
          type: file.type,
          url: await CommunityService.uploadPostMedia(
            communityId,
            user.id,
            file,
          ),
        })),
      );
      if (reply)
        await CommunityService.createComment({
          communityId,
          postId: replyTo || comment!.post_id,
          commentId: comment?.id,
          authorId: user.id,
          authorName: "",
          content: text,
          mentions,
        });
      else
        await CommunityService.createPost({
          communityId,
          authorId: user.id,
          authorName: "",
          content: text,
          postId: post?.id,
          announcement,
          mentions,
          imageUrls: [
            ...images,
            ...uploaded
              .filter((file) => file.type.startsWith("image/"))
              .map((file) => file.url),
          ],
          videoUrls: [
            ...videos,
            ...uploaded
              .filter((file) => file.type.startsWith("video/"))
              .map((file) => file.url),
          ],
        });
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.message || "Could not submit. Please try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className={communityDialog + " max-w-xl"}>
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          The conversation starts with you
        </p>
        <DialogTitle className="pr-6 font-yrdly-display text-2xl">
          {post || comment
            ? "Edit content"
            : reply
              ? "Write a reply"
              : "Write a post"}
        </DialogTitle>
        <p className="text-sm text-muted-foreground">
          Safe content publishes after moderation. Pending submissions remain
          visible to you. Videos may require a moderator’s review.
        </p>
        <form onSubmit={submit} className="space-y-5">
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
            <CommunityAvatar name={profile?.name} src={profile?.avatar_url} />
            <div>
              <p className="font-semibold">{profile?.name || "You"}</p>
              <p className="text-xs text-muted-foreground">
                {reply
                  ? "Replying to the conversation"
                  : "Sharing with your community"}
              </p>
            </div>
          </div>
          <label className="block text-sm">
            Message
            <textarea
              autoFocus
              className={communityField + " mt-2 min-h-36"}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={
                reply ? "Add your reply…" : "What would you like to share?"
              }
              maxLength={reply ? 500 : 1000}
              disabled={busy}
            />
          </label>
          <p
            className="text-right text-xs text-muted-foreground"
            aria-live="off"
          >
            {text.length} / {reply ? 500 : 1000}
          </p>
          {!reply && (
            <label className="block text-sm">
              Photos or videos
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/quicktime,video/webm"
                multiple
                disabled={busy}
                onChange={(event) => {
                  selectFiles(Array.from(event.target.files || []));
                  event.target.value = "";
                }}
                className="mt-2 block w-full rounded-2xl border border-dashed border-border p-4 text-sm file:mr-3 file:rounded-xl file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:font-semibold file:text-primary"
              />
            </label>
          )}
          {images.map((url, index) => (
            <button
              key={url}
              type="button"
              disabled={busy}
              onClick={() => setImages(images.filter((_, i) => i !== index))}
              className={communityButton}
            >
              Remove photo {index + 1}
            </button>
          ))}
          {videos.map((url, index) => (
            <button
              key={url}
              type="button"
              disabled={busy}
              onClick={() => setVideos(videos.filter((_, i) => i !== index))}
              className={communityButton}
            >
              Remove video {index + 1}
            </button>
          ))}
          {files.map((file, index) => (
            <div
              key={index}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="truncate">{file.name}</span>
              <button
                type="button"
                disabled={busy}
                className={communityButton}
                onClick={() => setFiles(files.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            </div>
          ))}
          {!reply && canAnnounce && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={announcement}
                onChange={(event) => setAnnouncement(event.target.checked)}
                disabled={busy}
              />
              Publish as an announcement
            </label>
          )}
          <button
            type="button"
            className={communityButton}
            onClick={() => setMentioning(!mentioning)}
          >
            Mention members ({mentions.length})
          </button>
          {mentioning && (
            <div className="space-y-2">
              <input
                aria-label="Find members to mention"
                className={communityField}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {members.map((member) => (
                <label
                  key={member.id}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={mentions.includes(member.user_id)}
                    onChange={() =>
                      setMentions(
                        mentions.includes(member.user_id)
                          ? mentions.filter((id) => id !== member.user_id)
                          : [...mentions, member.user_id],
                      )
                    }
                  />
                  <CommunityAvatar
                    name={member.user?.name}
                    src={member.user?.avatar_url}
                    className="h-8 w-8"
                  />
                  {member.user?.name || "Member"}
                </label>
              ))}
            </div>
          )}
          {!!error && (
            <p role="alert" className="text-sm text-red-500">
              {error}
            </p>
          )}
          <button
            disabled={
              busy ||
              (!text.trim() &&
                !files.length &&
                !images.length &&
                !videos.length)
            }
            className={communityPrimaryButton + " w-full"}
          >
            {busy
              ? "Submitting…"
              : post || comment
                ? "Save changes"
                : reply
                  ? "Send reply"
                  : "Share post"}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
