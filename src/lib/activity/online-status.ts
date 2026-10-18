export const ONLINE_STATUS_MAX_AGE_MS = 90_000;
export const AWAY_STATUS_MAX_AGE_MS = 5 * 60_000;

export type UserActivityStatus = "active" | "away" | "offline";

export function isUserOnline(
  isOnline: boolean | null | undefined,
  lastSeen: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!isOnline || !lastSeen) return false;

  const lastSeenAt = Date.parse(lastSeen);
  const age = now - lastSeenAt;
  return (
    Number.isFinite(lastSeenAt) && age >= 0 && age <= ONLINE_STATUS_MAX_AGE_MS
  );
}

export function getUserActivityStatus(
  isOnline: boolean | null | undefined,
  lastSeen: string | null | undefined,
  now = Date.now(),
): UserActivityStatus {
  if (isUserOnline(isOnline, lastSeen, now)) return "active";
  if (!lastSeen) return "offline";

  const lastSeenAt = Date.parse(lastSeen);
  const age = now - lastSeenAt;
  return Number.isFinite(lastSeenAt) &&
    age >= 0 &&
    age <= AWAY_STATUS_MAX_AGE_MS
    ? "away"
    : "offline";
}
