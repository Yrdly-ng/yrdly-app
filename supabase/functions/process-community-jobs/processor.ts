export type CommunityJob = {
  id: string;
  community_id: string;
  kind: 'moderation' | 'notification';
  payload: Record<string, any>;
  attempt_count: number;
};
type Review = {
  id: string;
  author_id: string;
  status: string;
  content: string;
  image_urls: string[];
  video_urls: string[];
};
type Verdict = { isSafe: boolean; reason?: string };
export type CommunityJobPorts = {
  loadReview: (id: string) => Promise<Review | null>;
  member: (
    communityId: string,
    userId: string
  ) => Promise<{ status: string; is_muted: boolean } | null>;
  community: (id: string) => Promise<{ name: string; approval_status: string } | null>;
  checkText: (text: string) => Promise<Verdict>;
  checkImages: (references: string[]) => Promise<Verdict>;
  approve: (id: string) => Promise<void>;
  note: (id: string, reason: string) => Promise<void>;
  saveNotification: (notification: Record<string, any>) => Promise<void>;
  sendNotification: (notification: Record<string, any>) => Promise<void>;
};
export async function processCommunityJob(
  job: CommunityJob,
  ports: CommunityJobPorts
): Promise<{ status: 'done' | 'retry' | 'manual'; error?: string }> {
  try {
    const community = await ports.community(job.community_id);
    if (!community || community.approval_status !== 'approved') return { status: 'done' };
    if (job.kind === 'moderation') {
      const review = await ports.loadReview(job.payload.reviewId);
      if (!review || review.status !== 'pending') return { status: 'done' };
      const member = await ports.member(job.community_id, review.author_id);
      if (member?.status !== 'active') {
        await ports.note(review.id, 'Author is no longer an active member.');
        return { status: 'manual' };
      }
      if (review.video_urls?.length) {
        await ports.note(review.id, 'Video requires a moderator’s review.');
        return { status: 'manual' };
      }
      const text = await ports.checkText(review.content);
      const images = await ports.checkImages(review.image_urls || []);
      for (const verdict of [text, images]) {
        if (!verdict.isSafe) {
          if (!verdict.reason || verdict.reason === 'moderation_error')
            throw new Error('Automatic moderation unavailable');
          await ports.note(review.id, verdict.reason);
          return { status: 'manual' };
        }
      }
      await ports.approve(review.id);
      return { status: 'done' };
    }
    const recipient = job.payload.userId;
    if (typeof recipient !== 'string') return { status: 'done' };
    const postId = job.payload.postId;
    const url = `/communities/${job.community_id}${postId ? `/posts/${postId}` : ''}`;
    const notification = {
      id: job.id,
      user_id: recipient,
      type: 'community_update',
      title: community.name,
      message: job.payload.message,
      sender_id: job.payload.senderId || null,
      related_id: job.community_id,
      related_type: 'community',
      data: {
        type: 'community_update',
        communityId: job.community_id,
        ...(postId ? { postId } : {}),
        event: job.payload.event,
        url,
        recipientId: recipient,
        notificationId: job.id,
        deliveryKey: job.id,
      },
    };
    await ports.saveNotification(notification);
    const member = await ports.member(job.community_id, recipient);
    const requiresMembership = ['reply', 'mention', 'announcement'].includes(job.payload.event);
    if (!member?.is_muted && (!requiresMembership || member?.status === 'active'))
      await ports.sendNotification(notification);
    return { status: 'done' };
  } catch {
    if (job.attempt_count >= 3) {
      if (job.kind === 'moderation')
        await ports.note(
          job.payload.reviewId,
          'Automatic review unavailable after three attempts. Awaiting a moderator.'
        );
      return { status: 'manual', error: 'Community processing could not complete' };
    }
    return { status: 'retry', error: 'Community processing temporarily unavailable' };
  }
}
