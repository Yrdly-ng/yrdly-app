import states from '../../data/states.json';

/** Only the selected profile state, never an address or an Explore filter. */
export function homeState(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (['fct', 'abuja', 'federal capital territory'].includes(normalized))
    return 'Federal Capital Territory';
  if (['nasarawa', 'nassarawa'].includes(normalized)) return 'Nasarawa';
  return states.find((state) => state.toLowerCase() === normalized) ?? null;
}

export function deviceLabel(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-zA-Z0-9 ._()+/-]{1,80}$/.test(value)
    ? value
    : undefined;
}
