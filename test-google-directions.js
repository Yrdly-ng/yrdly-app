require('dotenv').config({ path: '.env.local' });
const origin = { lat: 6.5244, lng: 3.3792 };
const destination = { lat: 6.4281, lng: 3.4219 };
const params = new URLSearchParams({
  origin: `${origin.lat},${origin.lng}`,
  destination: `${destination.lat},${destination.lng}`,
  departure_time: 'now',
  key: process.env.GOOGLE_DIRECTIONS_API_KEY,
});
fetch(`https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`)
  .then(res => res.json())
  .then(data => {
    console.log("Status:", data.status);
    console.log("Polyline:", data.routes?.[0]?.overview_polyline?.points);
  })
  .catch(console.error);
