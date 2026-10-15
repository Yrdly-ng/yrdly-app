"use client";
import type { Post } from "@/types/index";
interface Snapshot {
  posts: Post[];
  hasMore: boolean;
  oldest: string | null;
  savedAt: number;
  scrollTop: number;
}
let account: string | null = null;
const snapshots = new Map<string, Snapshot>();
export const clientFeedState = {
  setAccount(next: string | null) {
    if (next !== account) {
      account = next;
      snapshots.clear();
    }
  },
  read(owner: string, key: string) {
    if (owner !== account) return null;
    const value = snapshots.get(key);
    return value && Date.now() - value.savedAt < 5 * 60000 ? value : null;
  },
  write(owner: string, key: string, value: Snapshot) {
    if (owner !== account) return;
    snapshots.set(key, value);
    if (snapshots.size > 6) snapshots.delete(snapshots.keys().next().value!);
  },
  scroll(owner: string, key: string, scrollTop: number) {
    const value = this.read(owner, key);
    if (value) snapshots.set(key, { ...value, scrollTop });
  },
};
