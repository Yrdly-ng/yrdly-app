/**
 * User-friendly error message utilities
 * Converts technical errors into helpful, actionable messages
 */

export interface ErrorContext {
  field?: string;
  action?: string;
  suggestion?: string;
}

export class ErrorMessageFormatter {
  /**
   * Convert technical error messages to user-friendly ones
   */
  static formatAuthError(error: string, context?: ErrorContext): string {
    const errorLower = error.toLowerCase();
    
    // Authentication errors
    if (errorLower.includes('invalid login credentials') || errorLower.includes('invalid credentials')) {
      return 'The email or password you entered is incorrect. Please check your credentials and try again.';
    }
    
    if (errorLower.includes('email not confirmed')) {
      return 'Please verify your email address before signing in. Check your inbox for a verification link.';
    }
    
    if (errorLower.includes('user not found')) {
      return 'No account found with this email address. Please sign up first or check your email.';
    }
    
    if (errorLower.includes('email already registered') || errorLower.includes('user already registered')) {
      return 'An account with this email already exists. Please sign in instead or use a different email.';
    }
    
    if (errorLower.includes('password')) {
      if (errorLower.includes('weak')) {
        return 'Password is too weak. Please use at least 6 characters with a mix of letters and numbers.';
      }
      if (errorLower.includes('short')) {
        return 'Password must be at least 6 characters long.';
      }
      return 'There was an issue with your password. Please check it and try again.';
    }
    
    if (errorLower.includes('email')) {
      if (errorLower.includes('invalid')) {
        return 'Please enter a valid email address.';
      }
      if (errorLower.includes('already')) {
        return 'This email is already registered. Please sign in or use a different email.';
      }
      return 'There was an issue with your email address. Please check it and try again.';
    }
    
    if (errorLower.includes('network') || errorLower.includes('fetch')) {
      return 'Network error. Please check your internet connection and try again.';
    }
    
    if (errorLower.includes('rate limit') || errorLower.includes('too many')) {
      return 'Too many attempts. Please wait a few minutes before trying again.';
    }
    
    if (errorLower.includes('timeout')) {
      return 'Request timed out. Please check your connection and try again.';
    }
    
    // Default fallback
    return 'Something went wrong. Please try again or contact support if the problem persists.';
  }
  
  /**
   * Get helpful suggestions based on error type
   */
  static getSuggestion(error: string, context?: ErrorContext): string | null {
    const errorLower = error.toLowerCase();
    
    if (errorLower.includes('invalid login credentials')) {
      return 'Try resetting your password or check if Caps Lock is on.';
    }
    
    if (errorLower.includes('email not confirmed')) {
      return 'Check your spam folder or request a new verification email.';
    }
    
    if (errorLower.includes('user not found')) {
      return 'Make sure you\'re using the correct email address or create a new account.';
    }
    
    if (errorLower.includes('network') || errorLower.includes('fetch')) {
      return 'Check your internet connection and try refreshing the page.';
    }
    
    if (errorLower.includes('rate limit')) {
      return 'Wait 15 minutes before trying again, or contact support if you need immediate help.';
    }
    
    return null;
  }
  
  /**
   * Format field-specific errors
   */
  static formatFieldError(field: string, error: string): string {
    const fieldLower = field.toLowerCase();
    const errorLower = error.toLowerCase();
    
    if (fieldLower === 'email') {
      if (errorLower.includes('required')) {
        return 'Email address is required.';
      }
      if (errorLower.includes('invalid')) {
        return 'Please enter a valid email address.';
      }
      return 'Please check your email address.';
    }
    
    if (fieldLower === 'password') {
      if (errorLower.includes('required')) {
        return 'Password is required.';
      }
      if (errorLower.includes('min')) {
        return 'Password must be at least 6 characters long.';
      }
      return 'Please check your password.';
    }
    
    if (fieldLower === 'name' || fieldLower === 'username') {
      if (errorLower.includes('required')) {
        return `${field} is required.`;
      }
      if (errorLower.includes('taken')) {
        return 'This username is already taken. Please choose another one.';
      }
      return `Please check your ${field}.`;
    }
    
    return error;
  }
}

/**
 * Common error messages for consistency
 */
export const COMMON_ERRORS = {
  NETWORK: 'Network error. Please check your connection and try again.',
  TIMEOUT: 'Request timed out. Please try again.',
  RATE_LIMITED: 'Too many attempts. Please wait before trying again.',
  INVALID_CREDENTIALS: 'Invalid email or password. Please check and try again.',
  EMAIL_NOT_CONFIRMED: 'Please verify your email address first.',
  USER_NOT_FOUND: 'No account found with this email address.',
  EMAIL_ALREADY_EXISTS: 'An account with this email already exists.',
  WEAK_PASSWORD: 'Password is too weak. Use at least 6 characters with letters and numbers.',
  INVALID_EMAIL: 'Please enter a valid email address.',
  GENERIC: 'Something went wrong. Please try again.',
} as const;
