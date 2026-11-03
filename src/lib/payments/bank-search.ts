import catalogue from './bank-logo-catalogue.json';
import { normalizeBankName } from './bank-logo';

const searchText = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const aliasesByName = new Map<string, string[]>();
for (const bank of catalogue) {
  const aliases = bank.names.map(searchText);
  for (const name of bank.names) aliasesByName.set(normalizeBankName(name), aliases);
}

/** Search provider results without replacing their names or opaque payout codes. */
export function filterBanks<T extends { name: string; code: string }>(banks: T[], query: string): T[] {
  const search = searchText(query);
  if (!search) return banks;
  return banks.filter(bank =>
    searchText(bank.name).includes(search) ||
    aliasesByName.get(normalizeBankName(bank.name))?.some(alias => alias.includes(search))
  );
}
