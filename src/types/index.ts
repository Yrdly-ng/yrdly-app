// Types for Yrdly — backed by Supabase

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface Location {
  address: string;
  geopoint?: GeoPoint;
}

export interface Business {
  id: string;
  owner_id: string;
  name: string;
  category: string;
  description: string;
  location: Location;
  image_urls?: string[];
  created_at: string;
  state?: string | null;
  lga?: string | null;
  ward?: string | null;
  rating?: number;
  review_count?: number;
  hours?: string;
  phone?: string;
  email?: string;
  website?: string;
  owner_name?: string;
  owner_avatar?: string;
  cover_image?: string;
  logo?: string;
  distance?: string;
  catalog?: CatalogItem[];
}

export interface CatalogItem {
  id: string;
  business_id: string;
  title: string;
  description: string;
  price: number;
  images: string[];
  category: string;
  in_stock: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface BusinessMessage {
  id: string;
  business_id: string;
  sender_id: string;
  sender_name: string;
  sender_avatar?: string;
  content: string;
  timestamp: string;
  is_read: boolean;
  item_id?: string;
  created_at?: string;
}

export interface BusinessReview {
  id: string;
  business_id: string;
  user_id: string;
  user_name: string;
  user_avatar?: string;
  rating: number;
  comment: string;
  created_at: string;
  transaction_id?: string;
  verified_purchase?: boolean;
}

export type PostCategory = 'General' | 'Event' | 'For Sale' | 'Business';

export interface Post {
  id: string;
  user_id: string;
  author_name: string;
  author_image?: string;
  text: string;
  description?: string;
  image_url?: string;
  image_urls?: string[];
  video_url?: string | null;
  video_thumbnail_url?: string | null;
  timestamp: string;
  comment_count: number;
  category: PostCategory;
  state?: string | null;
  lga?: string | null;
  ward?: string | null;
  title?: string;
  event_date?: string;
  event_time?: string;
  event_link?: string;
  event_location?: Location;
  attendees?: string[];
  price?: number;
  condition?: string;
  is_sold?: boolean;
  liked_by: string[];
  created_at?: string;
  updated_at?: string;
  user?: {
    id: string;
    name: string;
    avatar_url?: string;
    created_at?: string;
  };
}

export interface Comment {
  id: string;
  userId: string;
  authorName: string;
  authorImage: string;
  text: string;
  timestamp: string;
  parentId: string | null;
  reactions: { [key: string]: string[] };
}

export interface User {
  id: string;
  uid: string;
  name: string;
  email?: string;
  avatar_url?: string;
  bio?: string;
  location?: {
    state?: string;
    lga?: string;
    city?: string;
    ward?: string;
  };
  friends?: string[];
  blockedUsers?: string[];
  interests?: string[];
  shareLocation?: boolean;
  currentLocation?: {
    lat: number;
    lng: number;
    address?: string;
    lastUpdated: string;
  };
  locationUpdatedAt?: string;
  notificationSettings?: NotificationSettings;
  timestamp?: string;
  isOnline?: boolean;
  lastSeen?: string;
}

export interface FriendRequest {
  id: string;
  from_user_id: string;
  to_user_id: string;
  participant_ids: string[];
  status: 'pending' | 'accepted' | 'declined';
  timestamp: string;
}

export interface Conversation {
  id: string;
  participantIds: string[];
  participant: User;
  lastMessage?: {
    id?: string;
    senderId: string;
    text: string;
    timestamp: string;
    isRead?: boolean;
    readBy?: string[];
  };
  messages: Message[];
  typing?: { [key: string]: boolean };
}

export interface Message {
  id: string;
  senderId: string;
  sender: User;
  text?: string;
  imageUrl?: string;
  videoUrl?: string;
  timestamp: string;
  isRead: boolean;
}

export interface NotificationSettings {
  friendRequests: boolean;
  messages: boolean;
  postUpdates: boolean;
  comments: boolean;
  postLikes: boolean;
  eventInvites: boolean;
}


