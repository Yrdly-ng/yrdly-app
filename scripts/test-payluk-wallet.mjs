import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const PAYLUK_SECRET_KEY = process.env.PAYLUK_SECRET_KEY;
const PAYLUK_BASE_URL = 'https://staging.api.payluk.ng';

async function run() {
  const customerId = "6a8a2e5b54278cb65c78ea8a";
  const res = await fetch(`${PAYLUK_BASE_URL}/v1/wallet`, {
    headers: {
      Authorization: `Bearer ${PAYLUK_SECRET_KEY}`,
      'customer-id': customerId
    }
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

run().catch(console.error);
