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

import { motion, AnimatePresence } from 'framer-motion';
import TextareaAutosize from 'react-textarea-autosize';

/* ─── design tokens ─────────────────────────────────────────────── */
const BG = 'var(--c-bg)';
const CARD_BG = 'var(--c-card)';
const FONT_RALEWAY = 'Inter, sans-serif';
const FONT_PACIFICO = "var(--font-jersey25)";

interface Comment {
    id: string;
    userId: string;
    authorName: string;
    authorImage: string;
    text: string;
    timestamp: string;
    parentId?: string | null;
    likeCount: number;
    isLikedByMe: boolean;
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


/* ─── L-bracket pointer for "View Replies" ──────────────────────── */
function Pointer({ className }: { className?: string }) {
    return (
        <div
            className={[cn('w-4 h-5 flex-shrink-0', className), "border-primary"].filter(Boolean).join(" ")}
            style={{
                borderWidth: '0px 0px 1px 1px',
                borderStyle: 'solid',
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
                let userLikes = new Set<string>();
                if (data.length > 0) {
                    const { data: likes } = await supabase
                        .from('comment_likes')
                        .select('comment_id')
                        .eq('user_id', currentUser.id)
                        .in('comment_id', data.map(c => c.id));
                    if (likes) {
                        likes.forEach(l => userLikes.add(l.comment_id));
                    }
                }

                const mapped = data.map((c: any) => ({
                    id: c.id,
                    userId: c.user_id,
                    authorName: c.author_name,
                    authorImage: c.author_image,
                    text: c.text,
                    timestamp: c.timestamp,
                    parentId: c.parent_id,
                    likeCount: c.like_count || 0,
                    isLikedByMe: userLikes.has(c.id),
                }));
                setComments(mapped);
                setLikedComments(new Set(userLikes));
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
                    const nc: Comment = { id: d.id, userId: d.user_id, authorName: d.author_name, authorImage: d.author_image, text: d.text, timestamp: d.timestamp, parentId: d.parent_id, likeCount: d.like_count || 0, isLikedByMe: false };
                    setComments(prev => [...prev.filter(c => c.id !== nc.id), nc].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()));
                    setTimeout(() => commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
                } else if (payload.eventType === 'UPDATE' && payload.new) {
                    const d = payload.new as any;
                    setComments(prev => prev.map(c => c.id === d.id ? { ...c, text: d.text, likeCount: d.like_count || 0 } : c));
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
            likeCount: 0,
            isLikedByMe: false,
        };
        setComments(prev => [...prev, optimistic]);
        setNewComment('');
        setReplyingTo(null);
        setTimeout(() => commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);

        try {
            const { data, error } = await supabase.from('comments').insert({ post_id: postId, user_id: currentUser.id, author_name: optimistic.authorName, author_image: optimistic.authorImage, text, parent_id: parentId || null }).select().single();
            if (error) throw error;
            setComments(prev => prev.map(c => c.id === optimistic.id ? { id: data.id, userId: data.user_id, authorName: data.author_name, authorImage: data.author_image, text: data.text, timestamp: data.timestamp, parentId: data.parent_id, likeCount: 0, isLikedByMe: false } : c));
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
        const isLiked = likedComments.has(commentId);

        // Optimistic UI update
        if (isLiked) {
            setLikedComments(prev => { const s = new Set(prev); s.delete(commentId); return s; });
            setComments(prev => prev.map(c => c.id === commentId ? { ...c, likeCount: Math.max(0, c.likeCount - 1), isLikedByMe: false } : c));
        } else {
            setLikedComments(prev => new Set(prev).add(commentId));
            setComments(prev => prev.map(c => c.id === commentId ? { ...c, likeCount: c.likeCount + 1, isLikedByMe: true } : c));
        }

        try {
            if (isLiked) {
                const { error } = await supabase.from('comment_likes').delete().eq('comment_id', commentId).eq('user_id', currentUser.id);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('comment_likes').insert({ comment_id: commentId, user_id: currentUser.id });
                if (error) throw error;
            }
        } catch {
            // Revert on failure
            if (isLiked) {
                setLikedComments(prev => new Set(prev).add(commentId));
                setComments(prev => prev.map(c => c.id === commentId ? { ...c, likeCount: c.likeCount + 1, isLikedByMe: true } : c));
            } else {
                setLikedComments(prev => { const s = new Set(prev); s.delete(commentId); return s; });
                setComments(prev => prev.map(c => c.id === commentId ? { ...c, likeCount: Math.max(0, c.likeCount - 1), isLikedByMe: false } : c));
            }
        }
    }, [currentUser, likedComments]);

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
        const replyCount = replies.length;

        return (
            <motion.div 
                initial={{ opacity: 0, y: 10 }} 
                animate={{ opacity: 1, y: 0 }} 
                exit={{ opacity: 0, scale: 0.95 }}
                key={comment.id} 
                className={cn('flex gap-3 pt-2', isReply && 'ml-11')}
            >
                {/* Avatar */}
                <div className="flex flex-col items-center gap-0 flex-shrink-0">
                    <Avatar className="h-8 w-8">
                        <AvatarImage src={comment.authorImage} />
                        <AvatarFallback className="text-xs bg-primary text-primary-foreground">{comment.authorName?.charAt(0)}</AvatarFallback>
                    </Avatar>
                    {/* vertical connector to replies */}
                    {hasReplies && showReplies && (
                        <div className="w-[1.5px] flex-1 mt-2 rounded-full" style={{ background: 'var(--c-border)', minHeight: '24px' }} />
                    )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pb-1">
                    {/* Header + Text */}
                    <div className="mb-0.5">
                        <div className="flex items-center gap-2">
                            <span className="text-[0.875rem] font-bold text-foreground leading-tight truncate">
                                {comment.authorName}
                            </span>
                            <span className="text-[0.75rem] text-muted-foreground font-light leading-tight whitespace-nowrap">
                                {timeAgoStr(comment.timestamp)}
                            </span>
                        </div>
                        {editingComment === comment.id ? (
                            <form onSubmit={async (e) => {
                                e.preventDefault();
                                if (!currentUser || !editText.trim()) return;
                                try { await supabase.from('comments').update({ text: editText.trim() }).eq('id', comment.id); setEditingComment(null); } catch { }
                            }} className="flex gap-2 mt-1">
                                <input value={editText} onChange={e => setEditText(e.target.value)} className="flex-1 bg-transparent text-foreground text-sm outline-none border-b border-border" />
                                <button type="submit" className="text-xs text-primary font-semibold">Save</button>
                                <button type="button" onClick={() => setEditingComment(null)} className="text-xs text-muted-foreground">Cancel</button>
                            </form>
                        ) : (
                            <p className="text-[0.875rem] font-normal text-foreground leading-[1.3] mt-0.5 break-words whitespace-pre-wrap">
                                {comment.text}
                            </p>
                        )}
                    </div>

                    {/* Reactions & Actions Row */}
                    <div className="flex items-center gap-4 mt-1">
                        <motion.button 
                            whileTap={{ scale: 1.3 }}
                            onClick={() => handleLikeComment(comment.id)} 
                            className="flex items-center gap-1.5 group"
                        >
                            <Heart className={cn("w-3.5 h-3.5 transition-colors", isLiked ? "fill-[#ED1111] text-[#ED1111]" : "text-muted-foreground group-hover:text-foreground")} />
                            {comment.likeCount > 0 && <span className={cn("text-xs font-medium transition-colors", isLiked ? "text-[#ED1111]" : "text-muted-foreground")}>{fmt(comment.likeCount)}</span>}
                        </motion.button>
                        
                        <button onClick={() => setReplyingTo(comment.id)} className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
                            Reply
                        </button>
                        
                        {/* Own comment menu */}
                        {currentUser?.id === comment.userId && (
                            <AlertDialog>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <button className="text-muted-foreground hover:text-foreground">
                                            <MoreHorizontal className="h-4 w-4" />
                                        </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="bg-card border-border rounded-2xl shadow-xl min-w-[150px] p-1.5">
                                        <DropdownMenuItem onClick={() => { setEditingComment(comment.id); setEditText(comment.text); }} className="text-foreground focus:bg-accent rounded-xl cursor-pointer py-2 px-3 text-sm font-medium">
                                            <Edit2 className="mr-2 h-4 w-4" /> Edit
                                        </DropdownMenuItem>
                                        <AlertDialogTrigger asChild>
                                            <DropdownMenuItem className="text-red-400 focus:text-red-400 focus:bg-red-500/10 rounded-xl cursor-pointer py-2 px-3 text-sm font-medium">
                                                <Trash2 className="mr-2 h-4 w-4" /> Delete
                                            </DropdownMenuItem>
                                        </AlertDialogTrigger>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                                <AlertDialogContent className="bg-card border-border text-foreground rounded-[24px] max-w-[400px]">
                                    <AlertDialogHeader className="text-center">
                                        <AlertDialogTitle>Delete comment?</AlertDialogTitle>
                                        <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter className="flex-col sm:flex-col gap-2 mt-4">
                                        <AlertDialogAction onClick={() => handleDeleteComment(comment.id)} className="w-full bg-red-600 hover:bg-red-700 text-primary-foreground rounded-[14px] h-12 font-semibold">Delete</AlertDialogAction>
                                        <AlertDialogCancel className="w-full mt-0 bg-transparent hover:bg-accent text-foreground border border-border rounded-[14px] h-12 font-semibold">Cancel</AlertDialogCancel>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        )}
                    </div>

                    {/* View Replies */}
                    {hasReplies && !isReply && (
                        <button
                            onClick={() => toggleReplies(comment.id)}
                            className="flex items-center gap-2 mt-2"
                        >
                            <div className="w-6 h-[1px] bg-border" />
                            <span className="text-[0.8125rem] font-semibold text-muted-foreground hover:text-foreground transition-colors">
                                {showReplies ? 'Hide' : 'View'} replies ({replyCount})
                            </span>
                        </button>
                    )}

                    {/* Replies list */}
                    {showReplies && hasReplies && (
                        <div className="mt-2 flex flex-col gap-1">
                            <AnimatePresence initial={false}>
                                {replies.map(reply => renderComment(reply, true))}
                            </AnimatePresence>
                        </div>
                    )}
                </div>
            </motion.div>
        );
    }, [repliesByParent, expandedReplies, likedComments, currentUser, handleLikeComment, handleDeleteComment, toggleReplies, editingComment, editText]);

    /* ── guards ─────────────────────────────────────────────────── */
    if (isAuthLoading) return <div className="p-4 text-center text-muted-foreground text-sm" style={{ fontFamily: FONT_RALEWAY }}>Loading comments…</div>;
    if (!currentUser) return <div className="p-4 text-center text-muted-foreground text-sm" style={{ fontFamily: FONT_RALEWAY }}>Sign in to view comments.</div>;

    const isInline = variant === 'inline';

    /* ── comment input box ──────────────────────────────────────── */
    const inputBox = (
        <div className="flex flex-col w-full">
            {replyingTo && (
                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground font-medium px-2">
                    <span>Replying to {comments.find(c => c.id === replyingTo)?.authorName}</span>
                    <button onClick={() => setReplyingTo(null)} className="hover:text-foreground font-semibold">Cancel</button>
                </div>
            )}
            <form onSubmit={handlePostComment} className="flex items-end gap-3 w-full">
                <Avatar className="h-9 w-9 flex-shrink-0 mb-1">
                    <AvatarImage src={userDetails?.avatar_url} />
                    <AvatarFallback className="text-xs bg-primary text-primary-foreground">{userDetails?.name?.charAt(0) || 'U'}</AvatarFallback>
                </Avatar>
                <div className="flex-1 relative flex items-end rounded-[20px] bg-accent/50 border border-transparent focus-within:border-primary/50 focus-within:bg-transparent transition-all overflow-hidden p-1">
                    <TextareaAutosize
                        ref={inputRef as any}
                        value={newComment}
                        onChange={e => setNewComment(e.target.value)}
                        placeholder={replyingTo ? 'Add a reply…' : 'Add a comment...'}
                        minRows={1}
                        maxRows={4}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handlePostComment(e);
                            }
                        }}
                        className="flex-1 bg-transparent px-3 py-2 text-[0.875rem] text-foreground outline-none placeholder:text-muted-foreground resize-none"
                    />
                    <button 
                        type="submit" 
                        disabled={!newComment.trim()}
                        className="mb-2 mr-3 text-sm font-bold text-primary disabled:opacity-0 transition-opacity flex-shrink-0"
                    >
                        Post
                    </button>
                </div>
            </form>
        </div>
    );

    /* ── DEFAULT variant: the standalone popup / sheet ─────────── */
    if (!isInline) {
        return (
            <div
                className="flex flex-col w-full max-h-[80vh] rounded-[11px] overflow-hidden relative"
                style={{ background: BG, border: '0.2px solid var(--c-border)' }}
            >
                {/* Post preview block */}
                {!hidePostPreview && post && author && (
                    <div className="px-4 pt-4 pb-3 flex-shrink-0">
                        <div className="flex items-start gap-3">
                            {/* Poster avatar + vertical line */}
                            <div className="flex flex-col items-center">
                                <Avatar className="h-10 w-10 flex-shrink-0">
                                    <AvatarImage src={author.avatar_url} />
                                    <AvatarFallback className="text-xs bg-primary text-primary-foreground">{author.name?.charAt(0)}</AvatarFallback>
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

                {/* Divider */}
                <div className="mx-4 flex-shrink-0" style={{ borderTop: '0.2px solid var(--c-border)' }} />

                {/* Toolbar */}
                <div className="flex flex-shrink-0 items-center justify-start px-4 py-2.5">
                    <div className="flex items-center gap-3">
                        <button className="text-muted-foreground hover:text-foreground transition-colors">
                            <Paperclip className="w-5 h-5 text-primary" />
                        </button>

                        <button className="text-muted-foreground hover:text-foreground transition-colors">
                            <MapPin className="w-5 h-5 text-primary" />
                        </button>
                    </div>
                </div>

                {/* Comments */}
                <div className="px-4 pb-4 space-y-3 overflow-y-auto flex-1">
                    {parentComments.length === 0 ? (
                        <div className="py-8 text-center">
                            <p className="text-[0.8125rem] text-muted-foreground" style={{ fontFamily: FONT_RALEWAY }}>No comments yet. Be the first!</p>
                        </div>
                    ) : (
                        parentComments.map(c => renderComment(c))
                    )}
                    <div ref={commentsEndRef} />
                </div>

                {/* Sticky Comment input */}
                <div className="sticky bottom-0 w-full backdrop-blur-md bg-background/80 border-t border-border/50 p-3 z-10 flex-shrink-0">
                    {inputBox}
                </div>
            </div>
        );
    }

    /* ── INLINE variant: embedded beneath a post card ─────────── */
    return (
        <div className="flex flex-col h-auto relative">
            <div className="px-4 pb-4 space-y-3 overflow-y-auto flex-1" style={{ maxHeight: 'min(60vh, 400px)' }}>
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
            {/* Sticky Comment input */}
            <div className="sticky bottom-0 w-full backdrop-blur-md bg-background/80 border-t border-border/50 p-3 z-10">
                {inputBox}
            </div>
        </div>
    );
}
