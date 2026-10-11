import { supabase } from './supabase';
import { StorageService } from './storage-service';

// ─── Types ────────────────────────────────────────────────────────────────────
export type CommunityType = 'ward' | 'lga' | 'interest';
export type CommunityPrivacy = 'open' | 'request' | 'invite';
export type MemberRole = 'member' | 'moderator' | 'admin';
export type MemberStatus = 'active' | 'pending' | 'banned';

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
  member_count: number;
  post_daily_limit: number;
  created_at: string;
  approval_status?: 'pending' | 'approved' | 'rejected';
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
  status: 'pending' | 'approved' | 'rejected';
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
  moderation_status: 'pending' | 'approved' | 'rejected' | 'moderation_error';
  created_at: string;
  updated_at: string;
  // joined
  author?: { id: string; name: string; avatar_url?: string | null; phone_verified?: boolean };
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
}

// ─── CommunityService ─────────────────────────────────────────────────────────
export class CommunityService {
  // ── Discovery & Feed ──────────────────────────────────────────────────────

  /** List communities the current user is a member of */
  static async listMyCommunities(): Promise<Community[]> {
    const { data, error } = await supabase
      .from('community_memberships')
      .select('community:communities(*)')
      .eq('status', 'active')
      .order('joined_at', { ascending: false });

    if (error) throw error;
    return (data ?? []).map((row: any) => row.community as Community);
  }

  /** Discover open/request communities directory — defaults to nearby state + interest groups */
  static async discoverCommunities(
    opts: { type?: CommunityType; state?: string; lga?: string; query?: string; page?: number } = {}
  ): Promise<Community[]> {
    const PAGE = 30;
    let q = supabase.from('communities').select('*').eq('approval_status', 'approved');

    if (opts.query?.trim()) {
      // Searching across all communities nationwide
      q = q.ilike('name', `%${opts.query.trim()}%`);
    } else {
      // Default view: filter by nearby state OR interest groups
      if (opts.type) {
        q = q.eq('type', opts.type);
      } else if (opts.state) {
        q = q.or(`state.eq."${opts.state}",type.eq.interest`);
      }
      if (opts.lga && !opts.query) {
        q = q.eq('lga', opts.lga);
      }
    }

    const { data, error } = await q
      .order('member_count', { ascending: false })
      .range((opts.page ?? 0) * PAGE, (opts.page ?? 0) * PAGE + PAGE - 1);

    if (error) throw error;
    return (data ?? []) as Community[];
  }

  static async listMyCommunitySubmissions(userId: string): Promise<Community[]> {
    const { data, error } = await supabase.from('communities').select('*')
      .eq('created_by', userId).in('approval_status', ['pending', 'rejected'])
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as Community[];
  }

  static async submitCommunity(input: {
    createdBy: string;
    name: string;
    description: string;
    avatarFile?: File | null;
    bannerFile?: File | null;
    privacy: CommunityPrivacy;
  }): Promise<Community> {
    const submissionId = crypto.randomUUID();
    const avatarUrl = input.avatarFile ? await this.uploadCommunityImage(input.createdBy, submissionId, 'avatar', input.avatarFile) : null;
    const bannerUrl = input.bannerFile ? await this.uploadCommunityImage(input.createdBy, submissionId, 'banner', input.bannerFile) : null;
    const slugBase = input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'community';
    const { data, error } = await supabase.from('communities').insert({
      name: input.name.trim(),
      slug: `${slugBase}-${Date.now().toString(36)}`,
      description: input.description.trim(),
      avatar_url: avatarUrl,
      banner_url: bannerUrl,
      type: 'interest',
      privacy: input.privacy,
      created_by: input.createdBy,
      is_official: false,
      approval_status: 'pending',
    }).select('*').single();
    if (error) throw error;
    return data as Community;
  }

  private static async uploadCommunityImage(userId: string, submissionId: string, kind: 'avatar' | 'banner', file: File): Promise<string> {
    if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
    if (file.size > 10 * 1024 * 1024) throw new Error('Each image must be 10 MB or smaller.');
    const extension = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
    const path = `${userId}/${submissionId}/${kind}.${extension}`;
    const { error } = await StorageService.uploadFile('community-images', path, file, { contentType: file.type, cacheControl: '31536000' });
    if (error) throw error;
    return StorageService.getPublicUrl('community-images', path);
  }

  static async reviewCommunity(communityId: string, reviewerId: string, decision: 'approved' | 'rejected', rejectionReason?: string): Promise<void> {
    const { error } = await supabase.from('communities').update({
      approval_status: decision,
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
      rejection_reason: decision === 'rejected' ? (rejectionReason?.trim() || 'Does not meet community guidelines.') : null,
    }).eq('id', communityId).eq('approval_status', 'pending');
    if (error) throw error;
  }

  /** Load a community by id (respects RLS invite-only) */
  static async getCommunity(id: string): Promise<Community | null> {
    const { data, error } = await supabase.from('communities').select('*').eq('id', id).single();
    if (error) return null;
    return data as Community;
  }

  /** Get current user's membership for a community */
  static async getMyMembership(communityId: string, userId: string): Promise<CommunityMembership | null> {
    const { data, error } = await supabase
      .from('community_memberships')
      .select('*')
      .eq('community_id', communityId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) return null;
    return data as CommunityMembership | null;
  }

  /** Get the current user's request status for a community. */
  static async getMyJoinRequest(communityId: string, userId: string): Promise<CommunityJoinRequest | null> {
    const { data, error } = await supabase
      .from('community_join_requests')
      .select('id, community_id, user_id, status, created_at')
      .eq('community_id', communityId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) return null;
    return data as CommunityJoinRequest | null;
  }

  // ── Membership ────────────────────────────────────────────────────────────

  /** Join an open community */
  static async joinCommunity(communityId: string, userId: string): Promise<void> {
    const { error } = await supabase.from('community_memberships').insert({
      community_id: communityId,
      user_id: userId,
      role: 'member',
      status: 'active',
      is_auto_joined: false,
    });
    if (error) throw error;
  }

  /** Submit a join request for request-to-join communities */
  static async requestToJoin(communityId: string, userId: string, message?: string): Promise<void> {
    const { error } = await supabase.from('community_join_requests').insert({
      community_id: communityId,
      user_id: userId,
      message: message ?? null,
    });
    if (error) throw error;
  }

  /** Leave a community */
  static async leaveCommunity(communityId: string, userId: string): Promise<void> {
    const { error } = await supabase
      .from('community_memberships')
      .delete()
      .eq('community_id', communityId)
      .eq('user_id', userId);
    if (error) throw error;
  }

  /** Toggle per-community notification mute */
  static async setMuted(communityId: string, userId: string, muted: boolean): Promise<void> {
    const { error } = await supabase
      .from('community_memberships')
      .update({ is_muted: muted, muted_at: muted ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
      .eq('community_id', communityId)
      .eq('user_id', userId);
    if (error) throw error;
  }

  // ── Posts ─────────────────────────────────────────────────────────────────

  /** Fetch paginated feed for a community. Pinned posts are always first. */
  static async fetchPosts(communityId: string, page = 0): Promise<CommunityPost[]> {
    const PAGE = 20;
    const { data, error } = await supabase
      .from('community_posts')
      .select(`
        *,
        author:public_profiles!community_posts_author_id_fkey(id, name, avatar_url, phone_verified)
      `)
      .eq('community_id', communityId)
      .eq('moderation_status', 'approved')
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);

    if (error) throw error;
    return (data ?? []) as CommunityPost[];
  }

  /**
   * Create a top-level community post.
   * New posts enter the database-backed moderation queue before appearing in feeds.
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
  }): Promise<CommunityPost> {
    const { data, error } = await supabase
      .from('community_posts')
      .insert({
        community_id: params.communityId,
        author_id: params.authorId,
        author_name: params.authorName,
        author_image: params.authorImage ?? null,
        content: params.content,
        image_urls: params.imageUrls?.length ? params.imageUrls : null,
        video_urls: params.videoUrls?.length ? params.videoUrls : null,
        moderation_status: 'pending',
      })
      .select('*')
      .single();

    if (error) throw error;

    return data as CommunityPost;
  }

  /** Toggle like on a community post */
  static async togglePostLike(postId: string, userId: string): Promise<{ liked: boolean }> {
    const { data: existing } = await supabase
      .from('community_post_likes')
      .select('post_id')
      .eq('post_id', postId)
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase.rpc('community_toggle_post_like', { p_post_id: postId, p_user_id: userId, p_action: 'unlike' });
      if (error) throw error;
      return { liked: false };
    } else {
      const { error } = await supabase.rpc('community_toggle_post_like', { p_post_id: postId, p_user_id: userId, p_action: 'like' });
      if (error) throw error;
      return { liked: true };
    }
  }

  /** Delete a post (author or moderator) */
  static async deletePost(postId: string): Promise<void> {
    const { error } = await supabase.from('community_posts').delete().eq('id', postId);
    if (error) throw error;
  }

  // ── Comments ──────────────────────────────────────────────────────────────

  static async fetchComments(postId: string): Promise<CommunityComment[]> {
    const { data, error } = await supabase
      .from('community_comments')
      .select('*, author:public_profiles!community_comments_author_id_fkey(id, name, avatar_url)')
      .eq('post_id', postId)
      .is('parent_comment_id', null)
      .eq('moderation_status', 'approved')
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data ?? []) as CommunityComment[];
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
  }): Promise<CommunityComment> {
    const { data, error } = await supabase
      .from('community_comments')
      .insert({
        post_id: params.postId,
        community_id: params.communityId,
        author_id: params.authorId,
        author_name: params.authorName,
        author_image: params.authorImage ?? null,
        parent_comment_id: params.parentCommentId ?? null,
        content: params.content,
        moderation_status: 'pending',
      })
      .select('*')
      .single();

    if (error) throw error;

    return data as CommunityComment;
  }

  static async deleteComment(commentId: string): Promise<void> {
    const { error } = await supabase.from('community_comments').delete().eq('id', commentId);
    if (error) throw error;
  }

  // ── Sparse ward helper ─────────────────────────────────────────────────────
  /** Returns true if ward community has <5 posts in the last 7 days */
  static async isWardSparse(communityId: string): Promise<boolean> {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from('community_posts')
      .select('id', { count: 'exact', head: true })
      .eq('community_id', communityId)
      .eq('moderation_status', 'approved')
      .gte('created_at', since);
    return (count ?? 0) < 5;
  }

  /** Fetch LGA community posts for sparse-ward "More from [LGA]" section */
  static async fetchParentLgaPosts(wardCommunityId: string, page = 0): Promise<CommunityPost[]> {
    const PAGE = 10;
    // Resolve parent
    const { data: ward } = await supabase
      .from('communities')
      .select('parent_community_id')
      .eq('id', wardCommunityId)
      .single();

    if (!ward?.parent_community_id) return [];

    const { data, error } = await supabase
      .from('community_posts')
      .select('*, author:public_profiles!community_posts_author_id_fkey(id, name, avatar_url)')
      .eq('community_id', ward.parent_community_id)
      .eq('moderation_status', 'approved')
      .order('created_at', { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);

    if (error) throw error;
    return (data ?? []) as CommunityPost[];
  }

  // ── Moderation (mod/admin) ──────────────────────────────────────────────────
  static async updatePostStatus(postId: string, status: 'approved' | 'rejected'): Promise<void> {
    const { error } = await supabase
      .from('community_posts')
      .update({ moderation_status: status, updated_at: new Date().toISOString() })
      .eq('id', postId);
    if (error) throw error;
  }

  static async banMember(communityId: string, userId: string): Promise<void> {
    const { error } = await supabase
      .from('community_memberships')
      .update({ status: 'banned', updated_at: new Date().toISOString() })
      .eq('community_id', communityId)
      .eq('user_id', userId);
    if (error) throw error;
  }

  static async updateMemberRole(communityId: string, userId: string, role: MemberRole): Promise<void> {
    const { error } = await supabase
      .from('community_memberships')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('community_id', communityId)
      .eq('user_id', userId);
    if (error) throw error;
  }

  // ── Admin: create interest community ───────────────────────────────────────
  static async createInterestCommunity(params: {
    name: string;
    description?: string;
    privacy: CommunityPrivacy;
    createdBy: string;
    avatarUrl?: string;
  }): Promise<Community> {
    const slug = params.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const { data, error } = await supabase
      .from('communities')
      .insert({
        name: params.name,
        slug,
        type: 'interest',
        privacy: params.privacy,
        description: params.description ?? null,
        avatar_url: params.avatarUrl ?? null,
        created_by: params.createdBy,
        is_official: false,
        post_daily_limit: 0,
      })
      .select('*')
      .single();

    if (error) throw error;
    // Auto-add creator as admin member
    await supabase.from('community_memberships').insert({
      community_id: (data as any).id,
      user_id: params.createdBy,
      role: 'admin',
      status: 'active',
      is_auto_joined: false,
    });

    return data as Community;
  }

  // ── Join Request management (admin/mod) ────────────────────────────────────
  static async listJoinRequests(communityId: string) {
    const { data, error } = await supabase
      .from('community_join_requests')
      .select('*, user:public_profiles!community_join_requests_user_id_fkey(id, name, avatar_url)')
      .eq('community_id', communityId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  static async approveJoinRequest(communityId: string, userId: string, reviewerId: string): Promise<void> {
    await supabase
      .from('community_join_requests')
      .update({ status: 'approved', reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
      .eq('community_id', communityId)
      .eq('user_id', userId);

    await supabase.from('community_memberships').insert({
      community_id: communityId,
      user_id: userId,
      role: 'member',
      status: 'active',
      is_auto_joined: false,
    });
  }

  static async rejectJoinRequest(communityId: string, userId: string, reviewerId: string): Promise<void> {
    await supabase
      .from('community_join_requests')
      .update({ status: 'rejected', reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
      .eq('community_id', communityId)
      .eq('user_id', userId);
  }
}
