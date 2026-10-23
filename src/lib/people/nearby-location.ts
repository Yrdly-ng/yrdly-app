export interface ProfileArea {
  home_state?: string | null;
  home_lga?: string | null;
  location?: { state?: string | null; lga?: string | null } | null;
}

export interface SelectedArea {
  state?: string | null;
  lga?: string | null;
}

/** Resolve the user's local government area even when the global filter is all Nigeria. */
export function resolveNearbyLocation(
  selected: SelectedArea | null | undefined,
  profile: ProfileArea | null | undefined,
): { state: string; lga: string } | null {
  const profileState = profile?.home_state || profile?.location?.state || undefined;
  const state = selected?.state || profileState;
  const lga =
    selected?.lga ||
    (state && state === profileState
      ? profile?.home_lga || profile?.location?.lga || undefined
      : undefined);

  return state && lga ? { state, lga } : null;
}
