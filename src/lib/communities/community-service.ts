import { supabase } from "../supabase/supabase";
import { communityApi as api } from "./community-api";
import { StorageService } from "../media/storage-service";
type MobileFile = File;

// ─── Types ────────────────────────────────────────────────────────────────────
export type CommunityType = "ward" | "lga" | "interest";
export type CommunityPrivacy = "open" | "request" | "invite";
export type MemberRole = "member" | "moderator" | "admin";
export type MemberStatus = "active" | "pending" | "banned" | "left";

export interface Community {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  avatar_url?: string | null;
  banner_url?: string | null;
  type: CommunityType;
  privacy: CommunityPrivacy;
  state?: string | null;
  lga?: string | null;
  ward?: string | null;
  parent_community_id?: string | null;
  is_official: boolean;
  owner_id?: string | null;
  rules?: string[];
  member_count: number;
  post_daily_limit: number;
  created_at: string;
  approval_status?: "pending" | "approved" | "rejected";
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  rejection_reason?: string | null;
}

export interface CommunityMembership {
  id: string;
  community_id: string;
  user_id: string;
  role: MemberRole;
  status: MemberStatus;
  is_auto_joined: boolean;
  is_muted: boolean;
  joined_at: string;
}

export interface CommunityJoinRequest {
  id: string;
  community_id: string;
  user_id: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  reviewed_at?: string | null;
  created_at: string;
}

export interface CommunityPost {
  id: string;
  community_id: string;
  author_id: string;
  author_name?: string | null;
  author_image?: string | null;
  content: string;
  image_urls?: string[] | null;
  video_urls?: string[] | null;
  is_pinned: boolean;
  is_edited: boolean;
  like_count: number;
  comment_count: number;
  moderation_status: "pending" | "approved" | "rejected" | "moderation_error";
  created_at: string;
  updated_at: string;
  is_announcement?: boolean;
  mentioned_user_ids?: string[];
  resolved_image_urls?: string[];
  resolved_video_urls?: string[];
  revision_status?: string;
  revision_reason?: string | null;
  // joined
  author?: {
    id: string;
    name: string;
    avatar_url?: string | null;
    phone_verified?: boolean;
  };
  liked_by_me?: boolean;
}

export interface CommunityComment {
  id: string;
  post_id: string;
  community_id: string;
  author_id: string;
  author_name?: string | null;
  author_image?: string | null;
  parent_comment_id?: string | null;
  content: string;
  like_count: number;
  moderation_status: string;
  created_at: string;
  liked_by_me?: boolean;
  replies?: CommunityComment[];
  author?: {
    id: string;
    name: string;
    avatar_url?: string | null;
    phone_verified?: boolean;
  };
  mentioned_user_ids?: string[];
  revision_status?: string;
  revision_reason?: string | null;
}

// ─── CommunityService ─────────────────────────────────────────────────────────
export class CommunityService {
  /** Staff controls use profile rows; database commands enforce the permission. */
  static isStaffProfile(profile: unknown): boolean {
    if (!profile || typeof profile !== "object") return false;
    return (
      ("is_admin" in profile && profile.is_admin === true) ||
      ("role" in profile &&
        (profile.role === "admin" || profile.role === "moderator"))
    );
  }
  // ── Discovery & Feed ──────────────────────────────────────────────────────

  /** List communities the current user is a member of */
  static async listMyCommunities(): Promise<Community[]> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) return [];
    const { data, error } = await supabase
      .from("community_memberships")
      .select("community:communities!inner(*)")
      .eq("user_id", session.user.id)
      .eq("community.approval_status", "approved")
      .eq("status", "active")
      .order("joined_at", { ascending: false });

    if (error) throw error;
    return Array.from(
      new Map(
        (data ?? [])
          .map((row: any) => row.community as Community)
          .filter((community) => community?.approval_status === "approved")
          .map((community) => [community.id, community]),
      ).values(),
    );
  }

  /** Discover open/request communities directory — defaults to nearby state + interest groups */
  static async discoverCommunities(
    opts: {
      type?: CommunityType;
      state?: string;
      lga?: string;
      query?: string;
      page?: number;
    } = {},
  ): Promise<Community[]> {
    const PAGE = 30;
    let q = supabase
      .from("communities")
      .select("*")
      .eq("approval_status", "approved")
      .neq("privacy", "invite");

    if (opts.query?.trim()) {
      // Searching across all communities nationwide
      q = q.ilike("name", `%${opts.query.trim()}%`);
    } else {
      // Default view: filter by nearby state OR interest groups
      if (opts.type) {
        q = q.eq("type", opts.type);
      } else if (opts.state) {
        q = q.or(`state.eq."${opts.state}",type.eq.interest`);
      }
      if (opts.lga && !opts.query) {
        q = q.eq("lga", opts.lga);
      }
    }

    const { data, error } = await q
      .order("member_count", { ascending: false })
      .range((opts.page ?? 0) * PAGE, (opts.page ?? 0) * PAGE + PAGE - 1);

    if (error) throw error;
    return (data ?? []) as Community[];
  }

  static async listMyCommunitySubmissions(
    userId: string,
  ): Promise<Community[]> {
    const [submitted, dismissed] = await Promise.all([
      supabase
        .from("communities")
        .select("*")
        .eq("created_by", userId)
        .in("approval_status", ["pending", "rejected"])
        .order("created_at", { ascending: false }),
      supabase
        .from("community_submission_dismissals")
        .select("community_id")
        .eq("user_id", userId),
    ]);
    if (submitted.error) throw submitted.error;
    if (dismissed.error) throw dismissed.error;
    const hidden = new Set(
      (dismissed.data ?? []).map((row) => row.community_id),
    );
    return (submitted.data ?? []).filter(
      (row) => !hidden.has(row.id),
    ) as Community[];
  }

  static async dismissCommunitySubmission(
    communityId: string,
    userId: string,
  ): Promise<void> {
    const { error } = await supabase
      .from("community_submission_dismissals")
      .insert({ user_id: userId, community_id: communityId });
    if (error && error.code !== "23505") throw error;
  }

  static async pendingSubmissionNames(userId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from("communities")
      .select("name")
      .eq("created_by", userId)
      .eq("approval_status", "pending");
    if (error) throw error;
    return (data ?? []).map((row) =>
      row.name.trim().replace(/\s+/g, " ").toLowerCase(),
    );
  }

  static async submitCommunity(input: {
    createdBy: string;
    name: string;
    description: string;
    avatarFile?: MobileFile | null;
    bannerFile?: MobileFile | null;
    privacy: CommunityPrivacy;
  }): Promise<Community> {
    const normalizedName = input.name.trim().replace(/\s+/g, " ").toLowerCase();
    const { data: pending, error: pendingError } = await supabase
      .from("communities")
      .select("name")
      .eq("created_by", input.createdBy)
      .eq("approval_status", "pending");
    if (pendingError) throw pendingError;
    if (
      pending?.some(
        (row) =>
          row.name.trim().replace(/\s+/g, " ").toLowerCase() === normalizedName,
      )
    ) {
      throw new Error("This community is already awaiting approval.");
    }
    const submissionId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const avatarUrl = input.avatarFile
      ? await this.uploadCommunityImage(
          input.createdBy,
          submissionId,
          "avatar",
          input.avatarFile,
        )
      : null;
    const bannerUrl = input.bannerFile
      ? await this.uploadCommunityImage(
          input.createdBy,
          submissionId,
          "banner",
          input.bannerFile,
        )
      : null;
    const slugBase =
      input.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 48) || "community";
    const { data, error } = await supabase
      .from("communities")
      .insert({
        name: input.name.trim(),
        slug: `${slugBase}-${Date.now().toString(36)}`,
        description: input.description.trim(),
        avatar_url: avatarUrl,
        banner_url: bannerUrl,
        type: "interest",
        privacy: input.privacy,
        created_by: input.createdBy,
        is_official: false,
        approval_status: "pending",
      })
      .select("*")
      .single();
    if (error?.code === "23505")
      throw new Error("This community is already awaiting approval.");
    if (error) throw error;
    return data as Community;
  }

  static async uploadCommunityImage(
    userId: string,
    submissionId: string,
    kind: "avatar" | "banner",
    file: MobileFile,
  ): Promise<string> {
    if (!file.type?.startsWith("image/"))
      throw new Error("Choose an image file.");
    if ((file.size ?? 0) > 10 * 1024 * 1024)
      throw new Error("Each image must be 10 MB or smaller.");
    const extension =
      file.name
        .split(".")
        .pop()
        ?.replace(/[^a-z0-9]/gi, "") || "jpg";
    const path = `${userId}/${submissionId}/${kind}.${extension}`;
    const { error } = await StorageService.uploadFile(
      "community-images",
      path,
      file,
      {
        contentType: file.type,
        cacheControl: "31536000",
      },
    );
    if (error) throw error;
    return StorageService.getPublicUrl("community-images", path);
  }

  static async reviewCommunity(
    communityId: string,
    reviewerId: string,
    decision: "approved" | "rejected",
    rejectionReason?: string,
  ): Promise<void> {
    const { error } = await supabase
      .from("communities")
      .update({
        approval_status: decision,
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString(),
        rejection_reason:
          decision === "rejected"
            ? rejectionReason?.trim() || "Does not meet community guidelines."
            : null,
      })
      .eq("id", communityId)
      .eq("approval_status", "pending");
    if (error) throw error;
  }

  /** Load a community by id (respects RLS invite-only) */
  static async getCommunity(id: string): Promise<Community | null> {
    const { data, error } = await supabase
      .from("communities")
      .select("*")
      .eq("id", id)
      .eq("approval_status", "approved")
      .maybeSingle();
    if (error) throw error;
    return data as Community;
  }

  /** Get current user's membership for a community */
  static async getMyMembership(
    communityId: string,
    userId: string,
  ): Promise<CommunityMembership | null> {
    const { data, error } = await supabase
      .from("community_memberships")
      .select("*")
      .eq("community_id", communityId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data as CommunityMembership | null;
  }

  /** Get the current user's request status for a community. */
  static async getMyJoinRequest(
    communityId: string,
    userId: string,
  ): Promise<CommunityJoinRequest | null> {
    const { data, error } = await supabase
      .from("community_join_requests")
      .select("id, community_id, user_id, status, created_at, reviewed_at")
      .eq("community_id", communityId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data as CommunityJoinRequest | null;
  }

  // ── Membership ────────────────────────────────────────────────────────────

  static async getMyInvite(communityId: string, userId: string) {
    const result = await supabase
      .from("community_invites")
      .select("*")
      .eq("community_id", communityId)
      .eq("invited_user_id", userId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (result.error) throw result.error;
    return result.data;
  }
  static async listPendingInvites(communityId: string) {
    const result = await supabase
      .from("community_invites")
      .select(
        "*,recipient:public_profiles!community_invites_invited_user_id_fkey(id,name)",
      )
      .eq("community_id", communityId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    if (result.error) throw result.error;
    return result.data || [];
  }
  static async getPost(
    communityId: string,
    postId: string,
  ): Promise<CommunityPost | null> {
    const result = await supabase
      .from("community_posts")
      .select(
        "*,author:public_profiles!community_posts_author_id_fkey(id,name,avatar_url,phone_verified)",
      )
      .eq("id", postId)
      .eq("community_id", communityId)
      .maybeSingle();
    if (result.error) throw result.error;
    return result.data
      ? (await this.withMedia([result.data as CommunityPost]))[0]
      : null;
  }

  /** All mutations are checked and committed atomically by the database. */
  static async command(
    communityId: string,
    action: string,
    data: Record<string, unknown> = {},
  ): Promise<any> {
    const result = await supabase.rpc("community_action", {
      p_community_id: communityId,
      p_action: action,
      p_data: data,
    });
    if (result.error) throw result.error;
    // Durable jobs remain queued if the immediate worker wake-up is unavailable.
    void api.post("/api/communities/process", { communityId }).catch(() => {});
    return result.data;
  }
  static async joinCommunity(id: string, _userId?: string) {
    await this.command(id, "join");
  }
  static async requestToJoin(id: string, _userId?: string, message?: string) {
    await this.command(id, "request", { message });
  }
  static async withdrawRequest(id: string) {
    await this.command(id, "withdraw");
  }
  static async leaveCommunity(id: string, _userId?: string) {
    await this.command(id, "leave");
  }
  static async setMuted(id: string, _userId: string, muted: boolean) {
    await this.command(id, "mute", { muted });
  }

  // ── Posts ─────────────────────────────────────────────────────────────────

  /** Fetch paginated feed for a community. Pinned posts are always first. */
  static async fetchPosts(
    communityId: string,
    page = 0,
  ): Promise<CommunityPost[]> {
    const PAGE = 20;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const { data, error } = await supabase
      .from("community_posts")
      .select(
        `
        *,
        author:public_profiles!community_posts_author_id_fkey(id, name, avatar_url, phone_verified)
      `,
      )
      .eq("community_id", communityId)
      .or(`moderation_status.eq.approved,author_id.eq.${session?.user.id}`)
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);

    if (error) throw error;
    return this.withMedia((data ?? []) as CommunityPost[]);
  }

  /**
   * Create a top-level community post.
   * The database queues trusted moderation and derives the author from the session.
   */
  static async createPost(params: {
    communityId: string;
    authorId: string;
    authorName: string;
    authorImage?: string | null;
    content: string;
    imageUrls?: string[];
    videoUrls?: string[];
    phoneVerified?: boolean;
    memberRole?: MemberRole;
    announcement?: boolean;
    mentions?: string[];
    postId?: string;
  }): Promise<CommunityPost> {
    return this.command(
      params.communityId,
      params.postId ? "edit_post" : "submit_post",
      {
        content: params.content,
        imageUrls: params.imageUrls || [],
        videoUrls: params.videoUrls || [],
        announcement: params.announcement || false,
        mentions: params.mentions || [],
        postId: params.postId,
      },
    );
  }
  static async togglePostLike(
    postId: string,
    userId: string,
    liked?: boolean,
  ): Promise<{ liked: boolean }> {
    if (liked === undefined) {
      const result = await supabase
        .from("community_post_likes")
        .select("post_id")
        .eq("post_id", postId)
        .eq("user_id", userId)
        .maybeSingle();
      if (result.error) throw result.error;
      liked = !!result.data;
    }
    const { error } = await supabase.rpc("community_toggle_post_like", {
      p_post_id: postId,
      p_user_id: userId,
      p_action: liked ? "unlike" : "like",
    });
    if (error) throw error;
    return { liked: !liked };
  }
  static async deletePost(postId: string, communityId?: string): Promise<void> {
    if (!communityId) {
      const result = await supabase
        .from("community_posts")
        .select("community_id")
        .eq("id", postId)
        .single();
      if (result.error) throw result.error;
      communityId = result.data.community_id;
    }
    await this.command(communityId!, "delete_post", { postId });
  }

  // ── Comments ──────────────────────────────────────────────────────────────

  static async fetchComments(postId: string): Promise<CommunityComment[]> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const { data, error } = await supabase
      .from("community_comments")
      .select(
        "*, author:public_profiles!community_comments_author_id_fkey(id, name, avatar_url, phone_verified)",
      )
      .eq("post_id", postId)
      .is("parent_comment_id", null)
      .or(`moderation_status.eq.approved,author_id.eq.${session?.user.id}`)
      .order("created_at", { ascending: true });

    if (error) throw error;
    const revisions = await this.revisionStates(
      (data || []).map((row) => row.id),
    );
    return (data ?? []).map((row) => ({
      ...row,
      ...revisions.get(row.id),
    })) as CommunityComment[];
  }

  static async createComment(params: {
    postId: string;
    communityId: string;
    authorId: string;
    authorName: string;
    authorImage?: string | null;
    content: string;
    parentCommentId?: string | null;
    phoneVerified?: boolean;
    commentId?: string;
    mentions?: string[];
  }): Promise<CommunityComment> {
    return this.command(
      params.communityId,
      params.commentId ? "edit_comment" : "submit_comment",
      {
        postId: params.postId,
        commentId: params.commentId,
        content: params.content,
        mentions: params.mentions || [],
      },
    );
  }
  static async deleteComment(
    commentId: string,
    communityId?: string,
  ): Promise<void> {
    if (!communityId) {
      const result = await supabase
        .from("community_comments")
        .select("community_id")
        .eq("id", commentId)
        .single();
      if (result.error) throw result.error;
      communityId = result.data.community_id;
    }
    await this.command(communityId!, "delete_comment", { commentId });
  }

  // ── Sparse ward helper ─────────────────────────────────────────────────────
  /** Returns true if ward community has <5 posts in the last 7 days */
  static async isWardSparse(communityId: string): Promise<boolean> {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("community_posts")
      .select("id", { count: "exact", head: true })
      .eq("community_id", communityId)
      .eq("moderation_status", "approved")
      .gte("created_at", since);
    return (count ?? 0) < 5;
  }

  /** Fetch LGA community posts for sparse-ward "More from [LGA]" section */
  static async fetchParentLgaPosts(
    wardCommunityId: string,
    page = 0,
  ): Promise<CommunityPost[]> {
    const PAGE = 10;
    // Resolve parent
    const { data: ward } = await supabase
      .from("communities")
      .select("parent_community_id")
      .eq("id", wardCommunityId)
      .single();

    if (!ward?.parent_community_id) return [];

    const { data, error } = await supabase
      .from("community_posts")
      .select(
        "*, author:public_profiles!community_posts_author_id_fkey(id, name, avatar_url)",
      )
      .eq("community_id", ward.parent_community_id)
      .eq("moderation_status", "approved")
      .order("created_at", { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);

    if (error) throw error;
    return this.withMedia((data ?? []) as CommunityPost[]);
  }

  static async banMember(id: string, userId: string) {
    await this.command(id, "ban", { userId });
  }
  static async updateMemberRole(id: string, userId: string, role: MemberRole) {
    await this.command(id, "role", { userId, role });
  }
  static async listJoinRequests(id: string) {
    const result = await supabase
      .from("community_join_requests")
      .select(
        "*,user:public_profiles!community_join_requests_user_id_fkey(id,name,avatar_url,phone_verified)",
      )
      .eq("community_id", id)
      .eq("status", "pending")
      .order("created_at");
    if (result.error) throw result.error;
    return result.data || [];
  }
  static async approveJoinRequest(
    id: string,
    userId: string,
    _reviewerId?: string,
  ) {
    await this.command(id, "review_request", { userId, decision: "approved" });
  }
  static async rejectJoinRequest(
    id: string,
    userId: string,
    _reviewerId?: string,
  ) {
    await this.command(id, "review_request", { userId, decision: "rejected" });
  }
  static async inviteCandidates(id: string, query = "") {
    const result = await supabase.rpc("community_invite_candidates", {
      p_community_id: id,
      p_query: query,
    });
    if (result.error) throw result.error;
    return result.data || [];
  }
  static async listInvitations(userId: string) {
    const result = await supabase
      .from("community_invites")
      .select("*,community:communities(id,name,description,avatar_url)")
      .eq("invited_user_id", userId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    if (result.error) throw result.error;
    return result.data || [];
  }
  static async members(id: string, query = "", page = 0) {
    const result = await supabase
      .from("community_memberships")
      .select(
        "*,user:public_profiles!community_memberships_user_id_fkey!inner(id,name,avatar_url,phone_verified)",
      )
      .eq("community_id", id)
      .ilike("user.name", `%${query}%`)
      .order("joined_at")
      .range(page * 50, page * 50 + 49);
    if (result.error) throw result.error;
    return result.data || [];
  }
  static async reviews(id: string) {
    const result = await supabase
      .from("community_content_reviews")
      .select("*")
      .eq("community_id", id)
      .eq("status", "pending")
      .order("created_at");
    if (result.error) throw result.error;
    return result.data || [];
  }
  static async reports(id: string) {
    const result = await supabase
      .from("community_reports")
      .select("*")
      .eq("community_id", id)
      .eq("status", "pending")
      .order("created_at");
    if (result.error) throw result.error;
    return result.data || [];
  }
  static async ownershipOffer(id: string) {
    const result = await supabase
      .from("community_ownership_transfers")
      .select("*")
      .eq("community_id", id)
      .maybeSingle();
    if (result.error) throw result.error;
    return result.data;
  }
  static async resolveMedia(references: string[]): Promise<string[]> {
    return Promise.all(
      references.map(async (reference) => {
        const prefix = "storage://community-media/";
        if (!reference.startsWith(prefix)) return reference;
        const result = await supabase.storage
          .from("community-media")
          .createSignedUrl(reference.slice(prefix.length), 300);
        return result.error ? "" : result.data.signedUrl;
      }),
    );
  }
  static async withMedia<T extends CommunityPost>(posts: T[]): Promise<T[]> {
    const revisions = await this.revisionStates(posts.map((post) => post.id));
    return Promise.all(
      posts.map(async (post) => ({
        ...post,
        ...revisions.get(post.id),
        resolved_image_urls: await this.resolveMedia(post.image_urls || []),
        resolved_video_urls: await this.resolveMedia(post.video_urls || []),
      })),
    );
  }
  static async revisionStates(ids: string[]) {
    const states = new Map<
      string,
      { revision_status?: string; revision_reason?: string | null }
    >();
    if (!ids.length) return states;
    const result = await supabase
      .from("community_content_reviews")
      .select("target_id,status,reason,created_at")
      .in("target_id", ids)
      .eq("is_revision", true)
      .order("created_at", { ascending: false });
    if (result.error) throw result.error;
    for (const review of result.data || [])
      if (!states.has(review.target_id))
        states.set(
          review.target_id,
          review.status === "pending" || review.status === "rejected"
            ? { revision_status: review.status, revision_reason: review.reason }
            : {},
        );
    return states;
  }
  static async uploadPostMedia(
    id: string,
    userId: string,
    file: MobileFile,
  ): Promise<string> {
    const isVideo = file.type.startsWith("video/");
    if (!isVideo && !file.type.startsWith("image/"))
      throw new Error("Choose a photo or video");
    if ((file.size || 0) > (isVideo ? 40 : 10) * 1024 * 1024)
      throw new Error(
        isVideo ? "Videos must be under 40 MB" : "Photos must be under 10 MB",
      );
    const extension = file.type
      .split("/")[1]
      .replace("jpeg", "jpg")
      .replace("quicktime", "mov");
    const path = `${id}/${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
    const result = await StorageService.uploadFile(
      "community-media",
      path,
      file,
      {
        contentType: file.type,
      },
    );
    if (result.error) throw result.error;
    return `storage://community-media/${path}`;
  }
}
