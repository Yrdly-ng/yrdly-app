import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const PAYLUK_SECRET_KEY = process.env.PAYLUK_SECRET_KEY;
const PAYLUK_BASE_URL = 'https://staging.api.payluk.ng';

async function run() {
  const phone = "08136312679";
  const res = await fetch(`${PAYLUK_BASE_URL}/v1/customers?phone=${phone}`, {
    headers: {
      Authorization: `Bearer ${PAYLUK_SECRET_KEY}`
    }
  });
  const data = await res.json();
  console.log("Matches:", data?.data?.data?.length || 0);
  console.log(JSON.stringify(data?.data?.data, null, 2));
}

run().catch(console.error);
