
import { useState, useEffect, useCallback } from 'react';
// Removed Firebase imports - now using Supabase
import { useAuth } from '@/hooks/use-supabase-auth';
import { supabase } from '@/lib/supabase';
import { StorageService } from '@/lib/storage-service';
import { UserActivityService } from '@/lib/user-activity-service';

import { Post, Business } from '@/types';
import { useToast } from './use-toast';



export const usePosts = (opts?: { filterState?: string | null; filterLga?: string | null }) => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  const filterState = opts?.filterState;
  const filterLga = opts?.filterLga;

  useEffect(() => {
    const fetchPosts = async () => {
      try {
        let query = supabase
          .from('posts')
          .select(`
            *,
            user:users!posts_user_id_fkey(
              id,
              name,
              avatar_url,
              created_at
            )
          `);

        // Apply location filters
        if (filterState) {
          query = query.eq('state', filterState);
        }
        if (filterLga) {
          query = query.eq('lga', filterLga);
        }

        const { data, error } = await query.order('timestamp', { ascending: false });

        if (error) {
          return;
        }

        setPosts(data as Post[]);
        setLoading(false);
      } catch (error) {
        setLoading(false);
      }
    };

    fetchPosts();

    // Set up real-time subscription for all posts
    let filterString: string | undefined = undefined;
    if (filterLga) {
      filterString = `lga=eq.${filterLga}`;
    } else if (filterState) {
      filterString = `state=eq.${filterState}`;
    }

    const channel = supabase
      .channel('posts-all')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'posts',
        filter: filterString,
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const newPost = payload.new as Post;
          
          // Double check filter client-side just in case
          if (filterState && newPost.state && newPost.state !== filterState) return;
          if (filterLga && newPost.lga && newPost.lga !== filterLga) return;
          
          // Check if post already exists in state
          setPosts(currentPosts => {
            if (currentPosts.some(p => p.id === newPost.id)) return currentPosts;
            return [newPost, ...currentPosts];
          });
          
          // Fetch user data for the new post
          const fetchUserData = async () => {
            try {
              const { data: userData, error: userError } = await supabase
                .from('users')
                .select('id, name, avatar_url, created_at')
                .eq('id', newPost.user_id)
                .single();
              
              if (!userError && userData) {
                const postWithUser = {
                  ...newPost,
                  user: userData
                };
                setPosts(prevPosts => prevPosts.map(p => p.id === newPost.id ? postWithUser : p));
              } else {
                // Keep the post as is (already added)
              }
            } catch (error) {
              // Keep the post as is (already added)
            }
          };
          
          fetchUserData();
        } else if (payload.eventType === 'UPDATE') {
          // Update existing post in the list
          const updatedPost = payload.new as Post;
          
          // Fetch user data for the updated post
          const fetchUserData = async () => {
            try {
              const { data: userData, error: userError } = await supabase
                .from('users')
                .select('id, name, avatar_url, created_at')
                .eq('id', updatedPost.user_id)
                .single();
              
              if (!userError && userData) {
                const postWithUser = {
                  ...updatedPost,
                  user: userData
                };
                setPosts(prevPosts => 
                  prevPosts.map(post => 
                    post.id === updatedPost.id ? postWithUser : post
                  )
                );
              } else {
                // Fallback to post without user data
                setPosts(prevPosts => 
                  prevPosts.map(post => 
                    post.id === updatedPost.id ? updatedPost : post
                  )
                );
              }
            } catch (error) {
              setPosts(prevPosts => 
                prevPosts.map(post => 
                  post.id === updatedPost.id ? updatedPost : post
                )
              );
            }
          };
          
          fetchUserData();
        } else if (payload.eventType === 'DELETE') {
          // Remove deleted post from the list
          const deletedId = payload.old.id;
          setPosts(prevPosts => 
            prevPosts.filter(post => post.id !== deletedId)
          );
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [filterState, filterLga]);

  // Listen for profile changes to refresh posts with updated user data
  useEffect(() => {
    if (!user || !profile) return;

    const refreshUserPosts = async () => {
      try {
        // Update posts that belong to the current user with fresh profile data
        setPosts(prevPosts => 
          prevPosts.map(post => {
            if (post.user_id === user.id) {
              return {
                ...post,
                author_name: profile.name || post.author_name || 'Unknown User',
                author_image: profile.avatar_url || post.author_image,
                user: {
                  id: user.id,
                  name: profile.name || post.user?.name || 'Unknown User',
                  avatar_url: profile.avatar_url || post.user?.avatar_url,
                  created_at: post.user?.created_at
                }
              };
            }
            return post;
          })
        );
      } catch (error) {
        // Error refreshing user posts
      }
    };

    refreshUserPosts();
  }, [user, profile]);

  const uploadImages = useCallback(async (
    files: FileList,
    path: 'posts' | 'event_images' | 'businesses' | 'avatars'
  ): Promise<string[]> => {
    if (!user) return [];
    
    // Check if files is valid and has items
    if (!files || files.length === 0) {
      return [];
    }
    
    const uploadedUrls = await Promise.all(
        Array.from(files).map(async (file) => {
            // Additional check for individual file
            if (!file || !file.name || !file.size || !(file instanceof File)) {
              return null;
            }
            
            try {
              const { url, error } = await StorageService.uploadPostImage(user.id, file);
              if (error) {
                  return null;
              }
              return url;
            } catch (error) {
              return null;
            }
        })
    );
    return uploadedUrls.filter(url => url !== null) as string[];
  }, [user]);

  const createPost = useCallback(
    async (
      postData: Partial<Omit<Post, 'id'>>,
      postIdToUpdate?: string,
      imageFiles?: FileList
    ) => {
      if (!user || !profile) {
        toast({ variant: 'destructive', title: 'Error', description: 'You must be logged in.' });
        return;
      }

      try {
        let imageUrls: string[] = [];
        
        // For editing: preserve existing images
        if (postIdToUpdate && postData.image_urls) {
          imageUrls = [...postData.image_urls];
        }
        
        // Add new images if any are uploaded
        if (imageFiles && imageFiles.length > 0) {
            const uploadedUrls = await uploadImages(imageFiles, postData.category === 'Event' ? 'event_images' : 'posts');
            imageUrls = [...imageUrls, ...uploadedUrls];
        }

        // Clean up the data to remove undefined values and exclude imageFiles
        const cleanedPostData = Object.fromEntries(
          Object.entries(postData).filter(([key, value]) => 
            value !== undefined && key !== 'imageFiles'
          )
        );

        // Auto-stamp the creator's location from their profile
        const userLocation = profile.location as { state?: string; lga?: string; ward?: string } | undefined;

        const finalPostData = {
          ...cleanedPostData,
          user_id: user.id,
          author_name: profile.name || 'Anonymous',
          author_image: profile.avatar_url || '',
          image_urls: imageUrls.length > 0 ? imageUrls : [],
          timestamp: postIdToUpdate ? postData.timestamp : new Date().toISOString(),
          category: postData.category || 'General',
          // Location stamping — only set on new posts, preserve on edits
          ...(postIdToUpdate ? {} : {
            state: userLocation?.state || null,
            lga: userLocation?.lga || null,
            ward: userLocation?.ward || null,
            author_location: userLocation ? { state: userLocation.state, lga: userLocation.lga, ward: userLocation.ward } : null,
          }),
        };

        if (postIdToUpdate) {
            const { data: updatedPost, error } = await supabase
              .from('posts')
              .update(finalPostData)
              .eq('id', postIdToUpdate)
              .select(`*, user:users!posts_user_id_fkey(id, name, avatar_url, created_at)`)
              .single();
            
            if (error) throw error;
            if (updatedPost) {
              setPosts(prev => prev.map(p => p.id === updatedPost.id ? (updatedPost as Post) : p));
            }
            toast({ title: 'Success', description: 'Post updated successfully.' });
        } else {
            const { data: newPost, error } = await supabase
              .from('posts')
              .insert({
                ...finalPostData,
                comment_count: 0,
                liked_by: [],
              })
              .select(`*, user:users!posts_user_id_fkey(id, name, avatar_url, created_at)`)
              .single();
            
            if (error) throw error;
            if (newPost) {
              setPosts(prev => {
                if (prev.some(p => p.id === newPost.id)) return prev;
                return [newPost as Post, ...prev];
              });
            }
            toast({ title: 'Success', description: 'Post created successfully.' });
        }
        
        // Update user activity after successful post creation/update
        if (user) {
          await UserActivityService.updateUserActivity(user.id);
        }
      } catch (error) {
        toast({ variant: 'destructive', title: 'Error', description: 'Failed to save post.' });
      }
    },
    [user, profile, toast, uploadImages]
  );

  const createBusiness = useCallback(
    async (
      businessData: Omit<Business, 'id' | 'owner_id' | 'created_at'>,
      businessIdToUpdate?: string,
      imageFiles?: FileList
    ) => {
      if (!user) {
        toast({ variant: 'destructive', title: 'Error', description: 'You must be logged in.' });
        return;
      }

      try {
        let imageUrls: string[] = businessData.image_urls || [];
        if (imageFiles && imageFiles.length > 0) {
            const uploadedUrls = await uploadImages(imageFiles, 'businesses');
            imageUrls = businessIdToUpdate ? [...imageUrls, ...uploadedUrls] : uploadedUrls;
        }

        // Auto-stamp the creator's location from their profile
        const bizLocation = profile?.location as { state?: string; lga?: string; ward?: string } | undefined;

        const finalBusinessData = {
            ...businessData,
            owner_id: user.id,
            image_urls: imageUrls,
            // Location stamping — only set on new businesses, preserve on edits
            ...(businessIdToUpdate ? {} : {
              state: bizLocation?.state || null,
              lga: bizLocation?.lga || null,
              ward: bizLocation?.ward || null,
              admin_location: bizLocation ? { state: bizLocation.state, lga: bizLocation.lga, ward: bizLocation.ward } : null,
            }),
        }

        if (businessIdToUpdate) {
            const { error } = await supabase
                .from('businesses')
                .update(finalBusinessData)
                .eq('id', businessIdToUpdate);
            
            if (error) throw error;
            toast({ title: 'Success', description: 'Business updated successfully.' });
        } else {
            const { error } = await supabase
                .from('businesses')
                .insert({
                    ...finalBusinessData,
                    created_at: new Date().toISOString(),
                });
            
            if (error) throw error;
            toast({ title: 'Success', description: 'Business added successfully.' });
        }
        
        // Update user activity after successful business creation/update
        if (user) {
          await UserActivityService.updateUserActivity(user.id);
        }
      } catch (error) {
        toast({ variant: 'destructive', title: 'Error', description: 'Failed to save business.' });
      }
    },
    [user, profile, toast, uploadImages]
  );

  const deletePost = useCallback(
    async (postId: string) => {
        if (!user) {
            toast({ variant: 'destructive', title: 'Error', description: 'You must be logged in to delete a post.' });
            return;
        }
        try {
            // First, get the post to retrieve image URLs
            const { data: postData, error: fetchError } = await supabase
                .from('posts')
                .select('image_urls')
                .eq('id', postId)
                .single();

            if (fetchError) {
                // Error fetching post for deletion
            }

            // Delete the post from database
            const { error } = await supabase
                .from('posts')
                .delete()
                .eq('id', postId);
            
            if (error) throw error;

            // Delete associated images from storage
            if (postData?.image_urls && postData.image_urls.length > 0) {
                const deletePromises = postData.image_urls.map(async (imageUrl: string) => {
                    try {
                        // Extract the path from the full URL
                        const url = new URL(imageUrl);
                        const pathParts = url.pathname.split('/');
                        const bucket = pathParts[2]; // post-images
                        const path = pathParts.slice(3).join('/'); // posts/userId/filename
                        
                        const { error: deleteError } = await supabase.storage
                            .from(bucket)
                            .remove([path]);
                        
                        if (deleteError) {
                            // Error deleting image
                        }
                    } catch (error) {
                        // Error processing image deletion
                    }
                });

                await Promise.all(deletePromises);
            }

            toast({ title: 'Success', description: 'Post deleted successfully.' });
        } catch (error) {
            toast({ variant: 'destructive', title: 'Error', description: 'Failed to delete post.' });
        }
    },
    [user, toast]
  );

  const deleteBusiness = useCallback(
    async (businessId: string) => {
        if (!user) {
            toast({ variant: 'destructive', title: 'Error', description: 'You must be logged in to delete a business.' });
            return;
        }
        try {
            const { error } = await supabase
                .from('businesses')
                .delete()
                .eq('id', businessId);
            
            if (error) throw error;
            toast({ title: 'Success', description: 'Business deleted successfully.' });
        } catch (error) {
            toast({ variant: 'destructive', title: 'Error', description: 'Failed to delete business.' });
        }
    },
    [user, toast]
  );

  const refreshPosts = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('posts')
        .select('*')
        .order('timestamp', { ascending: false });

      if (error) {
        return;
      }

      setPosts(data as Post[]);
    } catch (error) {
      // Error fetching posts
    }
  }, []);

  return { posts, loading, createPost, createBusiness, deletePost, deleteBusiness, refreshPosts };
};
