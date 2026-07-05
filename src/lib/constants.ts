/**
 * ⚠️ DUPLICATED ACROSS REPOS
 * This file is manually kept in sync with the equivalent file in the sibling repo:
 *   yrdly-app  ↔  yrdly-mobile  (src/lib/constants.ts)
 * Any change to COMMISSION_RATE, AUTO_RELEASE_HOURS, or other business constants
 * MUST be applied to both repos in the same change.
 */

/**
 * Application Constants
 * Central location for all magic numbers, limits, and configuration values
 */

// Auth & Security
export const AUTH_CONSTANTS = {
  PASSWORD_MIN_LENGTH: 6,
  PASSWORD_MAX_LENGTH: 128,
  MAX_LOGIN_ATTEMPTS: 5,
  LOGIN_LOCKOUT_DURATION: 15 * 60 * 1000, // 15 minutes in milliseconds
  MAX_EMAIL_RESEND_ATTEMPTS: 5,
  EMAIL_RESEND_COOLDOWN: 60 * 1000, // 60 seconds in milliseconds
  SESSION_TIMEOUT: 24 * 60 * 60 * 1000, // 24 hours
};

// Onboarding
export const ONBOARDING_CONSTANTS = {
  SPLASH_SCREEN_DURATION: 2000, // 2 seconds
  FADE_IN_DELAY: 100, // 100ms
  USERNAME_MIN_LENGTH: 3,
  USERNAME_MAX_LENGTH: 20,
  VERIFICATION_CHECK_FALLBACK: 5000, // 5 seconds
  CONFETTI_DURATION: 3000, // 3 seconds
  TIP_ROTATION_INTERVAL: 4000, // 4 seconds
};

// UI & UX
export const UI_CONSTANTS = {
  DEBOUNCE_DELAY: 500, // 500ms for input debouncing
  TOAST_DURATION: 3000, // 3 seconds
  ANIMATION_DURATION: 300, // 300ms for transitions
  SCROLL_THRESHOLD: 100, // pixels
};

// Pagination
export const PAGINATION_CONSTANTS = {
  ITEMS_PER_PAGE: 20,
  TRANSACTIONS_PER_PAGE: 20,
  MESSAGES_PER_PAGE: 50,
  NOTIFICATIONS_PER_PAGE: 30,
};

// File Upload
export const FILE_CONSTANTS = {
  MAX_IMAGE_SIZE: 5 * 1024 * 1024, // 5MB
  MAX_VIDEO_SIZE: 15 * 1024 * 1024, // 15MB — capped for Supabase free plan (1 GB total storage)
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  ALLOWED_VIDEO_TYPES: ['video/mp4', 'video/webm', 'video/quicktime'],
};

// Community Stats Fallback
export const STATS_FALLBACK = {
  TOTAL_USERS: 500,
  LOCAL_USERS: 25,
  ACTIVE_TODAY: 42,
  TOTAL_POSTS: 234,
};

// Error Messages
export const ERROR_MESSAGES = {
  GENERIC: 'An unexpected error occurred. Please try again.',
  NETWORK: 'Network error. Please check your connection and try again.',
  AUTH_FAILED: 'Authentication failed. Please check your credentials.',
  TOO_MANY_ATTEMPTS: 'Too many attempts. Please try again later.',
  SESSION_EXPIRED: 'Your session has expired. Please log in again.',
  UNAUTHORIZED: 'You don\'t have permission to perform this action.',
  NOT_FOUND: 'The requested resource was not found.',
};

// Marketplace & Escrow
export const MARKETPLACE_CONSTANTS = {
  COMMISSION_RATE: 0.03, // 3% platform commission
  AUTO_RELEASE_HOURS: 48, // Hours before auto-releasing funds to seller
  CURRENCY: 'NGN',
  MIN_PRICE: 100, // Minimum item price in NGN
};

// Events & Ticketing
export const EVENT_CONSTANTS = {
  COMMISSION_RATE: 0.05,  // 5% platform commission on ticket sales
  AUTO_RELEASE_HOURS: 24, // Hours after event ends before payout is released
  CURRENCY: 'NGN',
  MIN_TICKET_PRICE: 100,  // Minimum paid ticket price in NGN
  MAX_TICKET_TIERS: 5,    // Maximum number of ticket tiers per event
  TICKET_CODE_PREFIX: 'YRD',
};

// Success Messages
export const SUCCESS_MESSAGES = {
  LOGIN: 'Welcome back!',
  SIGNUP: 'Account created successfully!',
  EMAIL_VERIFIED: 'Email verified successfully!',
  PROFILE_UPDATED: 'Profile updated successfully!',
  POST_CREATED: 'Post created successfully!',
  MESSAGE_SENT: 'Message sent!',
};

