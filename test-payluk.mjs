import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const PAYLUK_SECRET_KEY = process.env.PAYLUK_SECRET_KEY;
const PAYLUK_BASE_URL = 'https://staging.api.payluk.ng';

async function run() {
  console.log("Key:", PAYLUK_SECRET_KEY ? "Found" : "Missing");

  // 1. Try to create a dummy customer to see what error it returns when it already exists.
  // First, create once to ensure it exists.
  let res = await fetch(`${PAYLUK_BASE_URL}/v1/customer/create`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PAYLUK_SECRET_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      firstname: "Test",
      lastname: "Existing",
      email: "test.existing@yrdly.com",
      phone: "08012345678"
    })
  });
  let data = await res.json();
  console.log("Create 1:", res.status, data);

  // Then create again
  res = await fetch(`${PAYLUK_BASE_URL}/v1/customer/create`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PAYLUK_SECRET_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      firstname: "Test",
      lastname: "Existing",
      email: "test.existing@yrdly.com",
      phone: "08012345678"
    })
  });
  data = await res.json();
  console.log("Create 2:", res.status, data);

  // 2. Try the list endpoint using GET /v1/customers?phone=...
  res = await fetch(`${PAYLUK_BASE_URL}/v1/customers?phone=08012345678`, {
    headers: {
      Authorization: `Bearer ${PAYLUK_SECRET_KEY}`
    }
  });
  data = await res.json();
  console.log("GET by phone:", res.status, JSON.stringify(data));
  
  // 3. Try GET /v1/customer/list or whatever
  res = await fetch(`${PAYLUK_BASE_URL}/v1/customer?phone=08012345678`, {
    headers: {
      Authorization: `Bearer ${PAYLUK_SECRET_KEY}`
    }
  });
  data = await res.json();
  console.log("GET /v1/customer by phone:", res.status, JSON.stringify(data));
}

run().catch(console.error);
