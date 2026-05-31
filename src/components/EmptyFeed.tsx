"use client";

import { CreatePostDialog } from "@/components/CreatePostDialog";

interface EmptyFeedProps {
  createPost?: (postData: any, postId?: string, imageFiles?: FileList) => Promise<void>;
}

export function EmptyFeed({ createPost }: EmptyFeedProps) {
  return (
    <div
      className="text-center p-8 md:p-12 rounded-2xl mx-4 my-6"
      style={{
        background: "var(--c-card)",
        border: "1px solid var(--c-border)",
        boxShadow: "0 10px 30px rgba(0,0,0,0.2)"
      }}
    >
      <div className="flex justify-center mb-6">
        <span 
          className="text-6xl animate-bounce" 
          role="img" 
          aria-label="Waving hand"
          style={{ animationDuration: '2s' }}
        >
          👋
        </span>
      </div>
      
      <h2 
        className="text-2xl font-extrabold mb-3"
        style={{ 
          fontFamily: "Pacifico", cursive, 
          color: "var(--c-text)",
          letterSpacing: "-0.02em"
        }}
      >
        Welcome to your neighborhood!
      </h2>
      
      <p 
        className="mb-8 max-w-sm mx-auto text-[0.9375rem] leading-relaxed"
        style={{ 
          fontFamily: "Pacifico", cursive, 
          color: "var(--c-text-muted)" 
        }}
      >
        This is where you&apos;ll see updates from your neighbors. Be the first to share something with your community!
      </p>
      
      <CreatePostDialog createPost={createPost || (() => Promise.resolve())}>
        <button
          className="w-full sm:w-auto px-8 py-3.5 rounded-full flex items-center justify-center text-foreground font-bold transition-all active:scale-95 shadow-[0_8px_20px_rgba(56,142,60,0.25)] hover:shadow-[0_10px_25px_rgba(56,142,60,0.35)]"
          style={{
            background: "#388E3C",
            fontFamily: "Pacifico", cursive,
            letterSpacing: "0.02em"
          }}
        >
          Create Your First Post
        </button>
      </CreatePostDialog>
    </div>
  );
}
