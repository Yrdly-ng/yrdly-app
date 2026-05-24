'use client';

import { useState, useEffect, useCallback, useRef, FormEvent } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
    MoreHorizontal,
    Heart,
    Trash2,
    Edit2,
    MessageCircle,
    Paperclip,
    MapPin,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-supabase-auth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import type { Post, User } from '@/types';
import Image from 'next/image';

/* ─── design tokens ─────────────────────────────────────────────── */
const BG = 'var(--c-bg)';
const CARD_BG = 'var(--c-card)';
const GREEN = '#388E3C';
const FONT_RALEWAY = 'Inter, sans-serif';
const FONT_PACIFICO = 'Pacifico, cursive';

interface Comment {
    id: string;
    userId: string;
    authorName: string;
    authorImage: string;
    text: string;
    timestamp: string;
    parentId?: string | null;
    reactions: Record<string, string[]>;
    likedBy?: string[];
}

interface CommentSectionProps {
    postId: string;
    post?: Post;
    author?: User | null;
    onCommentCountChange?: (count: number) => void;
    onClose?: () => void;
    variant?: 'default' | 'inline';
    hidePostPreview?: boolean;
}

/* ─── GIF badge icon ──────────────────────────────────────────── */
function GifIcon() {
    return (
        <div
            className="w-6 h-6 flex items-center justify-center rounded-sm"
            style={{ border: `1.3px solid ${GREEN}` }}
        >
            <span className="text-[0.625rem] font-bold leading-none" style={{ color: GREEN, fontFamily: 'Rajdhani, sans-serif' }}>
                GIF
            </span>
        </div>
    );
}

/* ─── L-bracket pointer for "View Replies" ──────────────────────── */
function Pointer({ className }: { className?: string }) {
    return (
        <div
            className={cn('w-4 h-5 flex-shrink-0', className)}
            style={{
                borderWidth: '0px 0px 1px 1px',
                borderStyle: 'solid',
                borderColor: GREEN,
                borderRadius: '0px 6px 6px 6px',
            }}
        />
    );
}

/* ─── format time ──────────────────────────────────────────────── */
function timeAgoStr(timestamp: string): string {
    const diff = (Date.now() - new Date(timestamp).getTime()) / 1000;
    if (diff < 60) return 'now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

/* ─── format counts ─────────────────────────────────────────────── */
function fmt(n: number) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
    return String(n);
}

export function CommentSection({
    postId,
    post,
    author,
    onCommentCountChange,
    onClose,
    variant = 'default',
    hidePostPreview,
}: CommentSectionProps) {
    const { user: currentUser, profile: userDetails, loading } = useAuth();
    const { toast } = useToast();
    const inputRef = useRef<HTMLInputElement>(null);
    const commentsEndRef = useRef<HTMLDivElement>(null);

    const [comments, setComments] = useState<Comment[]>([]);
    const [newComment, setNewComment] = useState('');
    const [replyingTo, setReplyingTo] = useState<string | null>(null);
    const [editingComment, setEditingComment] = useState<string | null>(null);
    const [editText, setEditText] = useState('');
    const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set());
    const [likedComments, setLikedComments] = useState<Set<string>>(new Set());
    const [authTimeout, setAuthTimeout] = useState(false);

    useEffect(() => {
        const t = setTimeout(() => { if (loading) setAuthTimeout(true); }, 5000);
        return () => clearTimeout(t);
    }, [loading]);

    const isAuthLoading = loading && !authTimeout;

    /* ── fetch + realtime ── */
    useEffect(() => {
        if (!postId || !currentUser) return;
        const fetch = async () => {
            const { data, error } = await supabase
                .from('comments')
                .select('*')
                .eq('post_id', postId)
                .order('timestamp', { ascending: true });
            if (!error && data) {
                const mapped = data.map((c: any) => ({
                    id: c.id,
                    userId: c.user_id,
                    authorName: c.author_name,
                    authorImage: c.author_image,
                    text: c.text,
                    timestamp: c.timestamp,
                    parentId: c.parent_id,
                    reactions: c.reactions || {},
                    likedBy: c.reactions?.['❤️'] || [],
                }));
                setComments(mapped);
                const liked = new Set<string>();
                mapped.forEach(c => { if (c.likedBy?.includes(currentUser.id)) liked.add(c.id); });
                setLikedComments(liked);
                const count = mapped.length;
                onCommentCountChange?.(count);
                const { data: pr } = await supabase.from('posts').select('comment_count').eq('id', postId).single();
                if (pr && (pr.comment_count ?? 0) !== count) {
                    await supabase.from('posts').update({ comment_count: count }).eq('id', postId);
                }
            }
        };
        fetch();

        const ch = supabase
            .channel(`comments_${postId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `post_id=eq.${postId}` }, (payload) => {
                if (payload.eventType === 'INSERT' && payload.new) {
                    const d = payload.new as any;
                    const nc: Comment = { id: d.id, userId: d.user_id, authorName: d.author_name, authorImage: d.author_image, text: d.text, timestamp: d.timestamp, parentId: d.parent_id, reactions: d.reactions || {}, likedBy: d.reactions?.['❤️'] || [] };
                    setComments(prev => [...prev.filter(c => c.id !== nc.id), nc].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()));
                    setTimeout(() => commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
                } else if (payload.eventType === 'UPDATE' && payload.new) {
                    const d = payload.new as any;
                    setComments(prev => prev.map(c => c.id === d.id ? { ...c, text: d.text, reactions: d.reactions || {}, likedBy: d.reactions?.['❤️'] || [] } : c));
                } else if (payload.eventType === 'DELETE') {
                    setComments(prev => prev.filter(c => c.id !== payload.old.id));
                }
            })
            .subscribe();
        return () => { supabase.removeChannel(ch); };
    }, [postId, currentUser, onCommentCountChange]);

    const isFirstSync = useRef(true);
    useEffect(() => {
        if (isFirstSync.current) { isFirstSync.current = false; return; }
        onCommentCountChange?.(comments.length);
    }, [comments.length, onCommentCountChange]);

    useEffect(() => {
        if (replyingTo && inputRef.current) inputRef.current.focus();
    }, [replyingTo]);

    const handlePostComment = useCallback(async (e: FormEvent) => {
        e.preventDefault();
        if (!currentUser || !userDetails || !newComment.trim()) return;
        const text = newComment.trim();
        const parentId = replyingTo;
        const optimistic: Comment = {
            id: `temp-${Date.now()}`,
            userId: currentUser.id,
            authorName: userDetails.name || userDetails.email || 'Anonymous',
            authorImage: userDetails.avatar_url || '',
            text,
            timestamp: new Date().toISOString(),
            parentId: parentId || null,
            reactions: {},
            likedBy: [],
        };
        setComments(prev => [...prev, optimistic]);
        setNewComment('');
        setReplyingTo(null);
        setTimeout(() => commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);

        try {
            const { data, error } = await supabase.from('comments').insert({ post_id: postId, user_id: currentUser.id, author_name: optimistic.authorName, author_image: optimistic.authorImage, text, parent_id: parentId || null }).select().single();
            if (error) throw error;
            setComments(prev => prev.map(c => c.id === optimistic.id ? { id: data.id, userId: data.user_id, authorName: data.author_name, authorImage: data.author_image, text: data.text, timestamp: data.timestamp, parentId: data.parent_id, reactions: data.reactions || {}, likedBy: data.reactions?.['❤️'] || [] } : c));
            if (onCommentCountChange) {
                const { data: pr } = await supabase.from('posts').select('comment_count').eq('id', postId).single();
                if (pr) { const n = (pr.comment_count || 0) + 1; await supabase.from('posts').update({ comment_count: n }).eq('id', postId); onCommentCountChange(n); }
            }
            try { const { NotificationTriggers } = await import('@/lib/notification-triggers'); await NotificationTriggers.onPostCommented(postId, currentUser.id, text); } catch {}
        } catch {
            setComments(prev => prev.filter(c => c.id !== optimistic.id));
            toast({ variant: 'destructive', title: 'Error', description: 'Could not post comment.' });
        }
    }, [currentUser, userDetails, newComment, postId, replyingTo, toast, onCommentCountChange]);

    const handleLikeComment = useCallback(async (commentId: string) => {
        if (!currentUser) return;
        const comment = comments.find(c => c.id === commentId);
        if (!comment) return;
        const isLiked = likedComments.has(commentId);
        const hearts = comment.reactions?.['❤️'] || [];
        const newHearts = isLiked ? hearts.filter(id => id !== currentUser.id) : [...hearts, currentUser.id];
        const next: Record<string, string[]> = { ...comment.reactions };
        if (newHearts.length > 0) next['❤️'] = newHearts;
        else delete next['❤️'];
        if (isLiked) setLikedComments(prev => { const s = new Set(prev); s.delete(commentId); return s; });
        else setLikedComments(prev => new Set(prev).add(commentId));
        setComments(prev => prev.map(c => c.id === commentId ? { ...c, reactions: next, likedBy: next['❤️'] || [] } : c));
        try { const { error } = await supabase.from('comments').update({ reactions: next }).eq('id', commentId); if (error) throw error; } catch { /* revert */ }
    }, [currentUser, comments, likedComments]);

    const handleDeleteComment = useCallback(async (commentId: string) => {
        if (!currentUser) return;
        try {
            const { error } = await supabase.from('comments').delete().eq('id', commentId).eq('user_id', currentUser.id);
            if (error) throw error;
            if (onCommentCountChange) {
                const { data: pr } = await supabase.from('posts').select('comment_count').eq('id', postId).single();
                if (pr) { const n = Math.max((pr.comment_count || 0) - 1, 0); await supabase.from('posts').update({ comment_count: n }).eq('id', postId); onCommentCountChange(n); }
            }
            toast({ title: 'Comment deleted' });
        } catch { toast({ variant: 'destructive', title: 'Error', description: 'Could not delete comment.' }); }
    }, [currentUser, postId, toast, onCommentCountChange]);

    const toggleReplies = useCallback((id: string) => {
        setExpandedReplies(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
    }, []);

    const parentComments = comments.filter(c => !c.parentId);
    const repliesByParent = comments.reduce((acc, c) => {
        if (c.parentId) { if (!acc[c.parentId]) acc[c.parentId] = []; acc[c.parentId].push(c); }
        return acc;
    }, {} as Record<string, Comment[]>);

    /* ── single comment row ─────────────────────────────────────── */
    const renderComment = useCallback((comment: Comment, isReply: boolean = false) => {
        const replies = repliesByParent[comment.id] || [];
        const hasReplies = replies.length > 0;
        const showReplies = expandedReplies.has(comment.id);
        const isLiked = likedComments.has(comment.id);
        const likeCount = comment.reactions?.['❤️']?.length || 0;
        const replyCount = replies.length;

        return (
            <div key={comment.id} className={cn('flex gap-2.5', isReply && 'ml-9')}>
                {/* Avatar */}
                <div className="flex flex-col items-center gap-0 flex-shrink-0">
                    <Avatar className="h-8 w-8 ring-1 ring-white/10">
                        <AvatarImage src={comment.authorImage} />
                        <AvatarFallback className="text-xs bg-[#388E3C] text-white">{comment.authorName?.charAt(0)}</AvatarFallback>
                    </Avatar>
                    {/* vertical connector to replies */}
                    {hasReplies && showReplies && (
                        <div className="w-px flex-1 mt-1" style={{ background: GREEN, minHeight: '24px' }} />
                    )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pb-3">
                    {/* Comment bubble */}
                    <div className="rounded-[8px] px-3 py-2.5 mb-1" style={{ background: BG }}>
                        <p className="text-[0.75rem] font-semibold text-foreground leading-tight mb-0.5" style={{ fontFamily: FONT_RALEWAY }}>
                            {comment.authorName}
                        </p>
                        {editingComment === comment.id ? (
                            <form onSubmit={async (e) => {
                                e.preventDefault();
                                if (!currentUser || !editText.trim()) return;
                                try { await supabase.from('comments').update({ text: editText.trim() }).eq('id', comment.id); setEditingComment(null); } catch { }
                            }} className="flex gap-2 mt-1">
                                <input value={editText} onChange={e => setEditText(e.target.value)} className="flex-1 bg-transparent text-foreground text-base outline-none border-b border-white/30" style={{ fontFamily: FONT_RALEWAY }} />
                                <button type="submit" className="text-[0.625rem] text-[#388E3C]">Save</button>
                                <button type="button" onClick={() => setEditingComment(null)} className="text-[0.625rem] text-muted-foreground">Cancel</button>
                            </form>
                        ) : (
                            <p className="text-[0.75rem] font-normal text-foreground leading-[14px]" style={{ fontFamily: FONT_RALEWAY }}>{comment.text}</p>
                        )}
                    </div>

                    {/* Reactions row */}
                    <div className="flex items-center gap-3 px-1">
                        {/* Likes */}
                        <div className="flex items-center gap-1.5">
                            <button
                                onClick={() => handleLikeComment(comment.id)}
                                className="w-[26px] h-5 rounded-[10px] flex items-center justify-center flex-shrink-0"
                                style={{ background: '#D9D9D9' }}
                            >
                                <Heart className="w-[14px] h-[14px]" style={{ fill: isLiked ? '#ED1111' : 'transparent', stroke: isLiked ? '#FFFFFF' : '#888' }} />
                            </button>
                            {likeCount > 0 && (
                                <span className="text-[0.75rem] italic font-light text-muted-foreground" style={{ fontFamily: FONT_RALEWAY }}>{fmt(likeCount)}</span>
                            )}
                        </div>

                        {/* Separator dot */}
                        <div className="w-[2px] h-[2px] rounded-full bg-white" />

                        {/* Reply count */}
                        <div className="flex items-center gap-1.5">
                            <button
                                className="w-[26px] h-5 rounded-[10px] flex items-center justify-center flex-shrink-0"
                                style={{ background: '#D9D9D9' }}
                                onClick={() => setReplyingTo(comment.id)}
                            >
                                <MessageCircle className="w-[14px] h-[14px]" style={{ fill: 'transparent', stroke: '#888' }} />
                            </button>
                            {replyCount > 0 && (
                                <span className="text-[0.75rem] font-light text-muted-foreground" style={{ fontFamily: FONT_RALEWAY }}>{replyCount}</span>
                            )}
                        </div>

                        {/* Own comment menu */}
                        {currentUser?.id === comment.userId && (
                            <AlertDialog>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <button className="text-muted-foreground hover:text-foreground ml-1">
                                            <MoreHorizontal className="h-3.5 w-3.5" />
                                        </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="bg-card border-border">
                                        <DropdownMenuItem onClick={() => { setEditingComment(comment.id); setEditText(comment.text); }} className="text-foreground focus:bg-accent">
                                            <Edit2 className="mr-2 h-3.5 w-3.5" /> Edit
                                        </DropdownMenuItem>
                                        <AlertDialogTrigger asChild>
                                            <DropdownMenuItem className="text-red-400 focus:text-red-400 focus:bg-red-500/10">
                                                <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                                            </DropdownMenuItem>
                                        </AlertDialogTrigger>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                                <AlertDialogContent className="bg-card border-border text-foreground">
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Delete comment?</AlertDialogTitle>
                                        <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel className="bg-white/10 text-foreground border-0">Cancel</AlertDialogCancel>
                                        <AlertDialogAction onClick={() => handleDeleteComment(comment.id)} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        )}
                    </div>

                    {/* View Replies — L-bracket style */}
                    {hasReplies && !isReply && (
                        <button
                            onClick={() => toggleReplies(comment.id)}
                            className="flex items-center gap-1.5 mt-1 ml-1"
                        >
                            <Pointer className="w-4 h-4" />
                            <span className="text-[0.75rem] italic font-light text-muted-foreground" style={{ fontFamily: FONT_RALEWAY }}>
                                {showReplies ? 'Hide' : 'View'} Replies
                            </span>
                        </button>
                    )}

                    {/* Replies list */}
                    {showReplies && hasReplies && (
                        <div className="mt-2 space-y-3">
                            {replies.map(reply => renderComment(reply, true))}
                        </div>
                    )}
                </div>
            </div>
        );
    }, [repliesByParent, expandedReplies, likedComments, currentUser, handleLikeComment, handleDeleteComment, toggleReplies, editingComment, editText]);

    /* ── guards ─────────────────────────────────────────────────── */
    if (isAuthLoading) return <div className="p-4 text-center text-muted-foreground text-sm" style={{ fontFamily: FONT_RALEWAY }}>Loading comments…</div>;
    if (!currentUser) return <div className="p-4 text-center text-muted-foreground text-sm" style={{ fontFamily: FONT_RALEWAY }}>Sign in to view comments.</div>;

    const isInline = variant === 'inline';

    /* ── comment input box ──────────────────────────────────────── */
    const inputBox = (
        <div className={cn('flex-shrink-0', isInline ? 'px-4 py-3' : 'px-4 py-3 border-t border-border')}>
            {replyingTo && (
                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground" style={{ fontFamily: FONT_RALEWAY }}>
                    <span>Replying to {comments.find(c => c.id === replyingTo)?.authorName}</span>
                    <button onClick={() => setReplyingTo(null)} className="hover:text-foreground">Cancel</button>
                </div>
            )}
            <form onSubmit={handlePostComment} className="flex items-center gap-3">
                <Avatar className="h-9 w-9 flex-shrink-0">
                    <AvatarImage src={userDetails?.avatar_url} />
                    <AvatarFallback className="text-xs bg-[#388E3C] text-white">{userDetails?.name?.charAt(0) || 'U'}</AvatarFallback>
                </Avatar>
                <div className="flex-1 relative flex items-center rounded-full overflow-hidden" style={{ background: BG, border: `0.5px solid ${GREEN}` }}>
                    <input
                        ref={inputRef}
                        value={newComment}
                        onChange={e => setNewComment(e.target.value)}
                        placeholder={replyingTo ? 'Add a reply…' : 'Leave a comment'}
                        className="flex-1 h-[39px] bg-transparent px-4 text-base font-light text-foreground outline-none placeholder:text-muted-foreground"
                        style={{ fontFamily: FONT_RALEWAY }}
                    />
                </div>
            </form>
        </div>
    );

    /* ── DEFAULT variant: the standalone popup / sheet ─────────── */
    if (!isInline) {
        return (
            <div
                className="flex flex-col w-full rounded-[11px] overflow-hidden"
                style={{ background: BG, border: '0.2px solid var(--c-border)' }}
            >
                {/* Post preview block */}
                {!hidePostPreview && post && author && (
                    <div className="px-4 pt-4 pb-3">
                        <div className="flex items-start gap-3">
                            {/* Poster avatar + vertical line */}
                            <div className="flex flex-col items-center">
                                <Avatar className="h-10 w-10 flex-shrink-0">
                                    <AvatarImage src={author.avatar_url} />
                                    <AvatarFallback className="text-xs bg-[#388E3C] text-white">{author.name?.charAt(0)}</AvatarFallback>
                                </Avatar>
                                {/* green vertical connector */}
                                <div className="w-px flex-1 mt-1" style={{ background: GREEN, minHeight: '40px' }} />
                            </div>
                            {/* Post content */}
                            <div className="flex-1 min-w-0">
                                <p className="text-[0.875rem] font-bold text-foreground" style={{ fontFamily: FONT_RALEWAY }}>{author.name}</p>
                                <p className="text-[0.6875rem] text-foreground mb-2" style={{ fontFamily: FONT_RALEWAY }}>{timeAgoStr(post.timestamp)}</p>
                                <p className="text-[0.8125rem] font-light text-foreground leading-[15px]" style={{ fontFamily: FONT_RALEWAY }}>{post.text}</p>
                            </div>
                            {/* Close is handled by Sheet component */}
                        </div>
                    </div>
                )}

                {/* Comment input */}
                {inputBox}

                {/* Divider */}
                <div className="mx-4" style={{ borderTop: '0.2px solid #FFFFFF' }} />

                {/* Toolbar */}
                <div className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-3">
                        <button className="text-muted-foreground hover:text-foreground">
                            <Paperclip className="w-6 h-6" style={{ color: GREEN }} />
                        </button>
                        <GifIcon />
                        <button className="text-muted-foreground hover:text-foreground">
                            <MapPin className="w-6 h-6" style={{ color: GREEN }} />
                        </button>
                    </div>
                    <button
                        type="button"
                        onClick={e => handlePostComment(e as any)}
                        disabled={!newComment.trim()}
                        className="h-[36px] px-4 sm:px-8 rounded-full text-white text-[0.8125rem] sm:text-[0.875rem] font-medium disabled:opacity-50 transition-opacity hover:opacity-90 whitespace-nowrap"
                        style={{ background: GREEN, fontFamily: FONT_RALEWAY }}
                    >
                        Post
                    </button>
                </div>

                {/* Comments */}
                <div className="px-4 pb-4 space-y-3 overflow-y-auto" style={{ maxHeight: 'min(40vh, 300px)' }}>
                    {parentComments.length === 0 ? (
                        <div className="py-8 text-center">
                            <p className="text-[0.8125rem] text-muted-foreground" style={{ fontFamily: FONT_RALEWAY }}>No comments yet. Be the first!</p>
                        </div>
                    ) : (
                        parentComments.map(c => renderComment(c))
                    )}
                    <div ref={commentsEndRef} />
                </div>
            </div>
        );
    }

    /* ── INLINE variant: embedded beneath a post card ─────────── */
    return (
        <div className="flex flex-col h-auto">
            {inputBox}
            <div className="px-4 pb-4 space-y-3 overflow-y-auto" style={{ maxHeight: 'min(60vh, 400px)' }}>
                {parentComments.length === 0 ? (
                    <div className="py-8 text-center flex flex-col items-center gap-2">
                        <MessageCircle className="w-10 h-10 text-muted-foreground" />
                        <p className="text-[0.8125rem] text-muted-foreground" style={{ fontFamily: FONT_RALEWAY }}>No comments yet.</p>
                        <p className="text-[0.75rem] text-muted-foreground" style={{ fontFamily: FONT_RALEWAY }}>Be the first to comment!</p>
                    </div>
                ) : (
                    parentComments.map(c => renderComment(c))
                )}
                <div ref={commentsEndRef} />
            </div>
        </div>
    );
}
