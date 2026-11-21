// Run with a Shipbubble sandbox key and SHIPBUBBLE_QA_RATE_REQUEST set to a JSON
// rate request containing test address codes, a pickup date, category, and package details.
// Set SHIPBUBBLE_QA_COURIER to a service code returned by sandbox rates to book and
// simulate tracking. Leave it unset to check the available pickup quotes only.
const key = process.env.SHIPBUBBLE_API_KEY;
if (!/^sb_sandbox_.+$/.test(key ?? '')) {
  throw new Error('SHIPBUBBLE_API_KEY must be a Shipbubble sandbox key.');
}

const requestedCourier = process.env.SHIPBUBBLE_QA_COURIER;
if (requestedCourier && !/^[a-z0-9_-]+$/i.test(requestedCourier)) {
  throw new Error('SHIPBUBBLE_QA_COURIER must be a courier service code.');
}

let rateRequest;
try {
  rateRequest = JSON.parse(process.env.SHIPBUBBLE_QA_RATE_REQUEST ?? '');
  if (!rateRequest || typeof rateRequest !== 'object' || Array.isArray(rateRequest)) {
    throw new Error();
  }
} catch {
  throw new Error('SHIPBUBBLE_QA_RATE_REQUEST must be a JSON rate request.');
}

async function post(operation, path, body) {
  const response = await fetch('https://api.shipbubble.com/v1/shipping/' + path, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.status !== 'success') {
    throw new Error(operation + ' failed (HTTP ' + response.status + ').');
  }
  return result.data;
}

const ratePath = requestedCourier === 'kwik' ? 'fetch_rates/kwik' : 'fetch_rates';
const rates = await post('Pickup quote', ratePath, { ...rateRequest, service_type: 'pickup' });
const pickupQuotes = rates?.couriers?.filter((quote) => quote.service_type === 'pickup');
if (!rates?.request_token || !pickupQuotes?.length) {
  throw new Error('Shipbubble returned no bookable pickup quotes for the fixture.');
}
console.log('Pickup courier codes:', pickupQuotes.map((quote) => quote.service_code).join(', '));
if (!pickupQuotes.some((quote) => quote.service_code === 'kwik')) {
  console.log('Kwik was absent from the sandbox response. Check Kwik coverage and rates separately before rollout.');
}

if (requestedCourier) {
  const quote = pickupQuotes.find((candidate) => candidate.service_code === requestedCourier);
  if (!quote?.courier_id) {
    throw new Error('Requested courier was absent from the returned pickup quotes.');
  }

  const shipment = await post('Sandbox booking', 'labels', {
    request_token: rates.request_token,
    service_code: quote.service_code,
    courier_id: quote.courier_id,
  });
  if (!shipment?.order_id || !shipment?.tracking_url) {
    throw new Error('Sandbox booking response omitted the shipment ID or tracking URL.');
  }

  for (const status of ['confirmed', 'picked_up', 'in_transit', 'completed']) {
    await post('Sandbox webhook simulation (' + status + ')',
      'labels/webhooks/' + encodeURIComponent(shipment.order_id), { status_code: status });
    console.log('Shipbubble accepted simulation for:', status);
  }
  console.log('Verify receipt on the configured test webhook; simulation acceptance alone does not confirm delivery to YRDLY.');
}
