// Read-only credential check. Never prints keys or creates provider resources.
const key = process.env.PAYSTACK_SECRET_KEY || '';
if (!key.startsWith('sk_test_')) throw new Error('A Paystack test secret key is required.');
const response = await fetch('https://api.paystack.co/bank?country=nigeria&currency=NGN&perPage=100', {
  headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000),
});
const result = await response.json();
if (!response.ok || result.status !== true || !Array.isArray(result.data)) {
  throw new Error(`Paystack test credential check failed (HTTP ${response.status}).`);
}
console.log(JSON.stringify({ testCredentialsAccepted: true, banksReturned: result.data.length, providerMutations: 0 }));
