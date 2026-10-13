import 'server-only';

export class MapsInputError extends Error {}

const PARAMETERS = new Set([
  'key', 'input', 'language', 'components', 'types', 'placeid', 'place_id',
  'latlng', 'sessiontoken', 'fields',
]);

/** Construct only the Google requests used by our address inputs. */
export function buildMapsRequest(path: string[], query: URLSearchParams): URL {
  const endpoint = path.join('/');
  if (!['place/autocomplete/json', 'place/details/json', 'geocode/json'].includes(endpoint)) {
    throw new MapsInputError('Unsupported address request');
  }
  for (const name of query.keys()) {
    if (!PARAMETERS.has(name) || query.getAll(name).length !== 1) {
      throw new MapsInputError('Invalid address parameters');
    }
  }

  const url = new URL(`https://maps.googleapis.com/maps/api/${endpoint}`);
  url.searchParams.set('language', 'en');
  if (endpoint === 'place/autocomplete/json') {
    const input = query.get('input')?.trim();
    if (!input || input.length > 200) throw new MapsInputError('Enter a valid address');
    url.searchParams.set('input', input);
    url.searchParams.set('components', 'country:ng');
    const types = query.get('types');
    if (types) {
      if (!['geocode', 'address', 'establishment', '(cities)', '(regions)'].includes(types)) {
        throw new MapsInputError('Invalid address type');
      }
      url.searchParams.set('types', types);
    }
  } else if (endpoint === 'place/details/json') {
    if (query.has('placeid') && query.has('place_id')) throw new MapsInputError('Duplicate place ID');
    const placeId = query.get('placeid') ?? query.get('place_id');
    if (!placeId || !/^[A-Za-z0-9_-]{1,256}$/.test(placeId)) throw new MapsInputError('Invalid place ID');
    url.searchParams.set('place_id', placeId);
    // Callers cannot request contact, review or other unnecessary billable fields.
    url.searchParams.set('fields', 'address_components,formatted_address,geometry,name,place_id');
  } else {
    const parts = query.get('latlng')?.split(',');
    if (!parts || parts.length !== 2 || parts.some(part => !part.trim())) {
      throw new MapsInputError('Invalid coordinates');
    }
    const [lat, lng] = parts.map(Number);
    if (![lat, lng].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new MapsInputError('Invalid coordinates');
    }
    url.searchParams.set('latlng', `${lat},${lng}`);
  }

  const sessionToken = query.get('sessiontoken');
  if (sessionToken !== null) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionToken)) throw new MapsInputError('Invalid session token');
    if (endpoint !== 'geocode/json') url.searchParams.set('sessiontoken', sessionToken);
  }
  // Incoming key, language, components and fields never override server settings.
  return url;
}
