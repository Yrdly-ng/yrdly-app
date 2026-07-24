
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function timeAgo(date: Date | undefined | null): string {
  if (!date) {
    return "just now";
  }

  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
  let interval = seconds / 31536000;

  if (interval > 1) {
    return Math.floor(interval) + " years ago";
  }
  interval = seconds / 2592000;
  if (interval > 1) {
    return Math.floor(interval) + " months ago";
  }
  interval = seconds / 86400;
  if (interval > 1) {
    return Math.floor(interval) + " days ago";
  }
  interval = seconds / 3600;
  if (interval > 1) {
    return Math.floor(interval) + " hours ago";
  }
  interval = seconds / 60;
  if (interval > 1) {
    return Math.floor(interval) + " minutes ago";
  }
  return Math.floor(seconds) + " seconds ago";
}

export const formatPrice = (price?: number) => {
    if (price === undefined || price === null) return "Free";
    return new Intl.NumberFormat('en-NG', {
        style: 'currency',
        currency: 'NGN',
    }).format(price);
};

export const shortenAddress = (address: string, maxLength: number = 50): string => {
    if (!address || address.length <= maxLength) {
        return address;
    }
    
    // Try to find a good breaking point (comma, space, etc.)
    const truncated = address.substring(0, maxLength);
    const lastComma = truncated.lastIndexOf(',');
    const lastSpace = truncated.lastIndexOf(' ');
    
    // Use the last comma if it's within a reasonable range, otherwise use last space
    const breakPoint = lastComma > maxLength * 0.7 ? lastComma : lastSpace;
    
    if (breakPoint > maxLength * 0.5) {
        return address.substring(0, breakPoint) + '...';
    }
    
    // If no good break point, just truncate and add ellipsis
    return truncated + '...';
};