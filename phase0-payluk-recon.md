# Phase 0 — Payluk Integration Recon

> **Scope**: Read-only reconnaissance. No code changes, no commits, no migrations applied.
> Generated: 2026-08-19

---

## 1. `src/lib/paystack-service.ts` (yrdly-app)

335 lines, 11 284 bytes. Full verbatim content:

```typescript
// Server-side only - Paystack service
// This service should only be used in API routes, not in client components

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

if (typeof window === 'undefined' && !PAYSTACK_SECRET_KEY) {
  console.warn('[Yrdly] Missing PAYSTACK_SECRET_KEY — Paystack features will not work.');
}

async function paystackRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  if (!PAYSTACK_SECRET_KEY) {
    throw new Error('Paystack service not available - PAYSTACK_SECRET_KEY is not set');
  }

  const res = await fetch(`${PAYSTACK_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.message || `Paystack API error: ${res.status}`);
  }

  return data;
}

export interface PaymentInitiationData {
  transactionId: string;
  amount: number; // in NGN (will be converted to kobo)
  buyerEmail: string;
  buyerName: string;
  itemTitle: string;
  sellerName: string;
  callbackUrl?: string;
  subaccount?: string;
  metadata?: Record<string, any>;
}

export interface PaymentVerificationResult {
  success: boolean;
  transactionReference?: string;
  amount?: number;
  status?: string;
  error?: string;
  metadata?: any;
}

export class PaystackService {
  static async initializePayment(data: PaymentInitiationData): Promise<string> {
    const callback_url = data.callbackUrl || `${process.env.NEXT_PUBLIC_APP_URL}/payment/verify?tx_ref=${data.transactionId}`;
    const payload: any = {
      reference: data.transactionId,
      amount: Math.round(data.amount * 100), // convert NGN → kobo
      email: data.buyerEmail,
      currency: 'NGN',
      callback_url,
      channels: ['card', 'bank', 'ussd', 'bank_transfer'],
      metadata: {
        ...data.metadata,
        buyer_name: data.buyerName,
        item_title: data.itemTitle,
        seller_name: data.sellerName,
        transaction_id: data.transactionId,
        custom_fields: [
          { display_name: 'Item', variable_name: 'item_title', value: data.itemTitle },
          { display_name: 'Seller', variable_name: 'seller_name', value: data.sellerName },
        ],
      },
    };
    if (data.subaccount) { payload.subaccount = data.subaccount; }
    const response = await paystackRequest<{ status: boolean; data: { authorization_url: string } }>(
      '/transaction/initialize', { method: 'POST', body: JSON.stringify(payload) }
    );
    if (!response.status || !response.data?.authorization_url) {
      throw new Error('Failed to initialize payment');
    }
    return response.data.authorization_url;
  }

  static async verifyPayment(reference: string): Promise<PaymentVerificationResult> {
    try {
      const response = await paystackRequest<{
        status: boolean;
        data: { status: string; reference: string; amount: number; requested_amount?: number; metadata: any };
      }>(`/transaction/verify/${encodeURIComponent(reference)}`);
      if (response.status && response.data.status === 'success') {
        return {
          success: true,
          transactionReference: response.data.reference,
          amount: (response.data.requested_amount || response.data.amount) / 100, // kobo → NGN
          status: response.data.status,
          metadata: response.data.metadata,
        };
      }
      return { success: false, error: 'Payment verification failed or not successful' };
    } catch (error: any) {
      console.error('[PaystackService] verifyPayment error:', error);
      return { success: false, error: error?.message || 'Payment verification failed' };
    }
  }

  static async refundTransaction(transactionReference: string, amount?: number): Promise<boolean> {
    try {
      const body: Record<string, any> = { transaction: transactionReference };
      if (amount) { body.amount = Math.round(amount * 100); }
      const response = await paystackRequest<{ status: boolean }>('/refund', {
        method: 'POST', body: JSON.stringify(body),
      });
      return response.status === true;
    } catch (error) {
      console.error('[PaystackService] refundTransaction error:', error);
      return false;
    }
  }

  static async transferToSeller(params: {
    bankCode: string; accountNumber: string; amount: number;
    reference: string; narration: string; accountName?: string;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const recipientResponse = await paystackRequest<{
        status: boolean; data: { recipient_code: string };
      }>('/transferrecipient', {
        method: 'POST',
        body: JSON.stringify({
          type: 'nuban', currency: 'NGN',
          bank_code: params.bankCode, account_number: params.accountNumber,
          name: params.accountName || 'Yrdly Seller',
        }),
      });
      if (!recipientResponse.status || !recipientResponse.data?.recipient_code) {
        return { success: false, error: 'Failed to create transfer recipient' };
      }
      const recipientCode = recipientResponse.data.recipient_code;
      const transferResponse = await paystackRequest<{ status: boolean; message?: string }>('/transfer', {
        method: 'POST',
        body: JSON.stringify({
          source: 'balance', reason: params.narration,
          amount: Math.round(params.amount * 100), recipient: recipientCode,
          reference: params.reference, currency: 'NGN',
        }),
      });
      if (transferResponse.status) { return { success: true }; }
      return { success: false, error: transferResponse.message || 'Transfer failed' };
    } catch (error: any) {
      console.error('[PaystackService] transferToSeller error:', error);
      return { success: false, error: error?.message || 'Unknown transfer error' };
    }
  }

  static async resolveAccount(
    accountNumber: string, bankCode: string
  ): Promise<{ valid: boolean; accountName?: string }> {
    try {
      const response = await paystackRequest<{
        status: boolean; data: { account_name: string; account_number: string };
      }>(`/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`);
      if (response.status && response.data?.account_name) {
        return { valid: true, accountName: response.data.account_name };
      }
      if (process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_test_')) {
        console.warn('[PaystackService] Test mode: resolveAccount returned invalid, using fallback.');
        return { valid: true, accountName: 'Test Bank Account (Fallback)' };
      }
      return { valid: false };
    } catch (error: any) {
      console.error('[PaystackService] resolveAccount error:', error);
      if (process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_test_')) {
        console.warn('[PaystackService] Test mode: resolveAccount failed, using fallback.');
        return { valid: true, accountName: 'Test Bank Account (Fallback)' };
      }
      return { valid: false };
    }
  }

  static async createSubaccount(params: {
    businessName: string; bankCode: string; accountNumber: string; percentageCharge: number;
  }): Promise<{ success: boolean; subaccountCode?: string; error?: string }> {
    try {
      const response = await paystackRequest<{
        status: boolean; data?: { subaccount_code: string }; message?: string;
      }>('/subaccount', {
        method: 'POST',
        body: JSON.stringify({
          business_name: params.businessName, settlement_bank: params.bankCode,
          account_number: params.accountNumber, percentage_charge: params.percentageCharge,
          settlement_schedule: 'manual',
        }),
      });
      if (response.status && response.data?.subaccount_code) {
        return { success: true, subaccountCode: response.data.subaccount_code };
      }
      return { success: false, error: response.message || 'Failed to create subaccount' };
    } catch (error: any) {
      console.error('[PaystackService] createSubaccount error:', error);
      return { success: false, error: error?.message || 'Unknown subaccount error' };
    }
  }

  static async updateSubaccount(
    subaccountCode: string,
    params: { businessName: string; bankCode: string; accountNumber: string; percentageCharge: number; }
  ): Promise<{ success: boolean; subaccountCode?: string; error?: string }> {
    try {
      const response = await paystackRequest<{
        status: boolean; data?: { subaccount_code: string }; message?: string;
      }>(`/subaccount/${subaccountCode}`, {
        method: 'PUT',
        body: JSON.stringify({
          business_name: params.businessName, settlement_bank: params.bankCode,
          account_number: params.accountNumber, percentage_charge: params.percentageCharge,
          settlement_schedule: 'manual',
        }),
      });
      if (response.status && response.data?.subaccount_code) {
        return { success: true, subaccountCode: response.data.subaccount_code };
      }
      return { success: false, error: response.message || 'Failed to update subaccount' };
    } catch (error: any) {
      console.error('[PaystackService] updateSubaccount error:', error);
      return { success: false, error: error?.message || 'Unknown subaccount update error' };
    }
  }
}
```

**Observations:**
- Single env var consumed: `process.env.PAYSTACK_SECRET_KEY` (server-side only, module-level guard warns on missing key at cold start). A parallel `PAYLUK_SECRET_KEY` var will be the only env addition needed on the backend.
- Six public static methods cover the full surface: `initializePayment`, `verifyPayment`, `refundTransaction`, `transferToSeller`, `resolveAccount`, `createSubaccount`/`updateSubaccount`. Each has a direct Payluk API equivalent to be mapped.
- Amount encoding is NGN × 100 → kobo throughout; Payluk uses NGN natively (no kobo conversion), so every `Math.round(x * 100)` call and every `/ 100` on the receive side are migration touch-points.

---

## 2a. `src/app/api/payment/initialize/route.ts` (yrdly-app)

413 lines, 13 969 bytes. Key excerpts (verbatim line references):

```
L7:   import { PaystackService } from "@/lib/paystack-service";
L237: .select("verification_status, account_updated_at, updated_at, paystack_subaccount_id")
L333: if (!sellerAccount?.paystack_subaccount_id) {
L338: paymentLink = await PaystackService.initializePayment({
L346:   subaccount: sellerAccount?.paystack_subaccount_id || undefined,
L252–258: require('fs').writeFileSync('/Users/macbook/...yrdly-app/debug-payment.json', ...)  ← debug artefact
L306: payment_method: PaymentMethod.CARD,  ← hardwired on every insert
```

**Observations:**
- Route reads `seller_accounts.paystack_subaccount_id` to optionally route split payments; Payluk uses a virtual-account / customer-ID model instead of subaccounts, so this column reference and the `subaccount` field in `initializePayment` are both replacement touch-points.
- The route hardwires `payment_method: PaymentMethod.CARD` on every escrow insert; Payluk's wallet-funding path will require a new enum value (e.g. `WALLET`) or a `payment_provider` column write.
- There is a debug `require('fs').writeFileSync(...)` at lines 252–258 that writes seller secrets to a hardcoded local path — dev artefact that must be removed before Payluk work ships.

---

## 2b. `src/app/api/webhooks/paystack/route.ts` (yrdly-app)

260 lines, 11 048 bytes. Key excerpts (verbatim):

```
L1:  import { createHmac } from 'crypto';
L20: const signature = request.headers.get('x-paystack-signature');
L21: const secretKey = process.env.PAYSTACK_SECRET_KEY;
L29: const expectedSignature = createHmac('sha512', secretKey).update(rawBody).digest('hex');
L44: if (event === 'charge.success' && data?.status === 'success') {
L46: const amount = (data.amount as number) / 100; // Convert kobo → NGN
L54: const verification = await PaystackService.verifyPayment(txRef);
L85: if (Math.abs(amount - txRow.total_amount) > 1) {  ← amount-mismatch guard
```

**Observations:**
- Signature verification uses HMAC-SHA512 keyed on `PAYSTACK_SECRET_KEY`, header `x-paystack-signature`; Payluk's equivalent header name and HMAC scheme must be confirmed from Payluk docs and substituted here in a new `/api/webhooks/payluk/route.ts`.
- The webhook does a **server-side re-verification** call back to Paystack after receiving the event; the Payluk webhook route must replicate this double-check using `PaylukService.verifyPayment`.
- Amount is de-kobo'd (`/ 100`) at line 46 from the webhook payload and then used in the amount-mismatch guard at line 85; Payluk sends amounts in NGN directly, so both the divisor and the tolerance check must be adjusted.

---

## 3. `src/lib/escrow-service.ts` (yrdly-app)

95 lines, 2 495 bytes. Full verbatim content:

```typescript
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import {
  EscrowTransaction, EscrowStatus, PaymentMethod,
  DeliveryOption, DeliveryDetails, EscrowStats
} from '@/types/escrow';
import { MARKETPLACE_CONSTANTS } from '@/lib/constants';

const COMMISSION_RATE = MARKETPLACE_CONSTANTS.COMMISSION_RATE; // 3% platform commission

export class EscrowService {

  static async getTransaction(transactionId: string): Promise<EscrowTransaction | null> {
    const { data, error } = await supabase
      .from('escrow_transactions').select('*').eq('id', transactionId).single();
    if (error) throw error;
    return data as EscrowTransaction;
  }

  static async getUserTransactions(userId: string): Promise<EscrowTransaction[]> {
    const { data, error } = await supabase
      .from('escrow_transactions').select('*').eq('buyer_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data as EscrowTransaction[];
  }

  static async getSellerTransactions(sellerId: string): Promise<EscrowTransaction[]> {
    const { data, error } = await supabase
      .from('escrow_transactions').select('*').eq('seller_id', sellerId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data as EscrowTransaction[];
  }

  static async getStats(): Promise<EscrowStats> {
    const { data, error } = await supabase.from('escrow_transactions').select('*');
    if (error) throw error;
    let totalTransactions = 0, totalVolume = 0, totalCommission = 0,
        pendingTransactions = 0, completedTransactions = 0, disputedTransactions = 0;
    data.forEach((transaction) => {
      totalTransactions++;
      totalVolume += transaction.amount;
      totalCommission += transaction.commission;
      switch (transaction.status) {
        case EscrowStatus.PENDING:   pendingTransactions++;   break;
        case EscrowStatus.COMPLETED: completedTransactions++; break;
        case EscrowStatus.DISPUTED:  disputedTransactions++;  break;
      }
    });
    return { totalTransactions, totalVolume, totalCommission,
             pendingTransactions, completedTransactions, disputedTransactions };
  }
}
```

**Observations:**
- `EscrowService` is a **pure Supabase read layer** — it performs zero payment-provider calls. All Paystack coupling lives in route files and `paystack-service.ts`, not here; this class needs no direct Payluk changes.
- The class lacks write methods (`createTransaction`, `updateStatus`, `releaseEscrow`); those writes are currently inline in route handlers. Payluk Phase 1 should centralise them here.
- `getStats` performs a full-table scan with no filter or pagination — a pre-existing perf concern, not Payluk-related, but worth noting.

---

## 4a. `src/app/checkout/[id].tsx` (yrdly-mobile)

475 lines, 17 419 bytes. Key excerpts (verbatim):

```
L121: const callbackUrl = makeRedirectUri({ path: 'payment-verify' });
L122: const result = await api.post<{ paymentLink: string; transactionId: string }>(
L123:   '/api/payment/initialize', { ... }
L146: const browserResult = await WebBrowser.openAuthSessionAsync(result.paymentLink, callbackUrl);
L149: // Mock verification step
L150: setTimeout(() => {
L185:   <Text style={stylesheet.payingTitle}>Redirecting to Paystack</Text>
```

**Observations:**
- The entire payment UX is a single `WebBrowser.openAuthSessionAsync` redirect to a Paystack-hosted checkout URL. If Payluk uses wallet funding (buyer funds a virtual account rather than visiting an external URL), this block may be replaced entirely with an in-app balance check + confirmation flow.
- The "paying" state renders the hardcoded string `"Redirecting to Paystack"` (line 185) — this must be updated to a provider-agnostic label or `"Processing payment"`.
- Post-redirect verification at lines 149–155 is a `setTimeout` mock, not a real Supabase Realtime subscription; the inline comment confirms this (`// Mock verification step`). Phase 1 must replace this with a Realtime listener on `escrow_transactions.status`.

---

## 4b. `src/app/settings/payout-settings.tsx` (yrdly-mobile)

335 lines, 16 145 bytes. Key excerpts (verbatim):

```
L49:  const data = await api.get('/api/paystack/banks');
L73:  const data = await api.post('/api/paystack/resolve-account', {
L162: <Text style={s.verifiedTxt}>Verified by Paystack</Text>
L256: <Text style={s.verifyingTxt}>Verifying account with Paystack…</Text>
L266: <Text style={s.confirmedSub}>Verified by Paystack ✓</Text>
```

**Observations:**
- Two API calls are Paystack-branded by path (`/api/paystack/banks`, `/api/paystack/resolve-account`); these must be cloned or renamed for Payluk's bank-list and account-resolution endpoints.
- Three user-visible strings hardcode "Paystack" as the verifier; all must be updated to "Payluk" or a neutral label before shipping.
- Payluk's per-seller virtual-account issuance will add net-new UI states beyond the current `select → account → verifying → confirmed` flow; a `virtual_account_issued` step and account-number display screen are not yet present.

---

## 5. Supabase Schema (read-only, project: yoiyqxtpmxnrrbqqidcs — YRDLY BACKEND)

### 5a. `public.users` — full column list

| column_name | data_type | is_nullable | column_default |
|---|---|---|---|
| id | uuid | NO | _(none)_ |
| name | text | NO | _(none)_ |
| email | text | YES | _(none)_ |
| username | text | YES | _(none)_ |
| avatar_url | text | YES | _(none)_ |
| bio | text | YES | _(none)_ |
| location | jsonb | YES | _(none)_ |
| friends | ARRAY (uuid[]) | YES | `'{}'::uuid[]` |
| blocked_users | ARRAY (uuid[]) | YES | `'{}'::uuid[]` |
| notification_settings | jsonb | YES | `'{"comments":true,...}'::jsonb` |
| is_online | boolean | YES | `false` |
| last_seen | timestamp with time zone | YES | _(none)_ |
| onboarding_status | USER-DEFINED (onboarding_step) | YES | `'signup'::onboarding_step` |
| profile_completed | boolean | YES | `false` |
| onboarding_completed_at | timestamp with time zone | YES | _(none)_ |
| tour_completed | boolean | YES | `false` |
| welcome_message_sent | boolean | YES | `false` |
| created_at | timestamp with time zone | YES | `now()` |
| updated_at | timestamp with time zone | YES | `now()` |
| interests | ARRAY (text[]) | YES | `'{}'::text[]` |
| share_location | boolean | YES | `true` |
| current_location | jsonb | YES | _(none)_ |
| location_updated_at | timestamp with time zone | YES | _(none)_ |
| is_admin | boolean | NO | `false` |
| email_reminders_enabled | boolean | NO | `true` |
| digest_reminder_sent_at | timestamp with time zone | YES | _(none)_ |
| push_token | text | YES | _(none)_ |
| role | text | NO | `'user'::text` |
| discoverable | boolean | NO | `true` |
| legal_name | text | YES | _(none)_ |
| review_count | integer | YES | `0` |
| rating | numeric | YES | `0` |
| verified_seller | boolean | YES | `false` |
| phone | text | YES | _(none)_ |
| phone_verified | boolean | NO | `false` |
| phone_verified_at | timestamp with time zone | YES | _(none)_ |
| delete_requested_at | timestamp with time zone | YES | _(none)_ |
| delete_requested | boolean | YES | `false` |
| home_state | text | YES | _(none)_ |
| home_lga | text | YES | _(none)_ |
| home_ward | text | YES | _(none)_ |
| home_lat | double precision | YES | _(none)_ |
| home_lng | double precision | YES | _(none)_ |
| home_location_geom | USER-DEFINED (geometry) | YES | _(none)_ |

**Observations:**
- No `payluk_customer_id` column exists; a nullable `text` column must be added via a migration to store each user's Payluk `customerId` returned at customer-creation time.
- No `payluk_virtual_account_number` or equivalent column exists; a second column (or a `payluk_accounts` join table) will be needed if virtual accounts are per-user.
- Existing `phone` / `phone_verified` / `legal_name` fields may satisfy Payluk's BVN/phone KYC pre-check without duplication.

### 5b. `public.escrow_transactions` — full column list

| column_name | data_type | is_nullable | column_default |
|---|---|---|---|
| id | uuid | NO | `uuid_generate_v4()` |
| item_id | text | NO | _(none)_ |
| buyer_id | uuid | YES | _(none)_ |
| seller_id | uuid | YES | _(none)_ |
| amount | numeric | NO | _(none)_ |
| commission | numeric | NO | _(none)_ |
| total_amount | numeric | NO | _(none)_ |
| seller_amount | numeric | NO | _(none)_ |
| status | USER-DEFINED (escrow_status) | NO | `'pending'::escrow_status` |
| payment_method | USER-DEFINED | NO | _(none)_ |
| delivery_details | jsonb | NO | _(none)_ |
| paid_at | timestamp with time zone | YES | _(none)_ |
| shipped_at | timestamp with time zone | YES | _(none)_ |
| delivered_at | timestamp with time zone | YES | _(none)_ |
| completed_at | timestamp with time zone | YES | _(none)_ |
| dispute_reason | text | YES | _(none)_ |
| dispute_resolved_at | timestamp with time zone | YES | _(none)_ |
| created_at | timestamp with time zone | YES | `now()` |
| updated_at | timestamp with time zone | YES | `now()` |
| payment_reference | text | YES | _(none)_ |
| payment_provider | text | YES | `'flutterwave'::text` |
| flutterwave_tx_ref | text | YES | _(none)_ |
| item_type | text | NO | `'post'::text` |

**Observations:**
- `payment_provider` column **already exists** with a stale default of `'flutterwave'::text`; this default should be updated to `'paystack'` or `'payluk'` via migration. It is the correct column to write `'payluk'` to on new transactions.
- `flutterwave_tx_ref` is a legacy artefact from a prior provider migration; a parallel `payluk_tx_ref text` column will likely be needed alongside `payment_reference`.
- The `payment_method` column type is `USER-DEFINED` (enum); its allowed values are unknown from `information_schema` alone — must run `SELECT enum_range(NULL::payment_method)` before Phase 1 to confirm whether `'wallet'` exists or needs adding.

---

## 6. Env Var Grep — Every Hit (verbatim)

### 6a. yrdly-app — PAYSTACK references

```
src/lib/paystack-service.ts:4     const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
src/lib/paystack-service.ts:5     const PAYSTACK_BASE_URL = 'https://api.paystack.co';
src/lib/paystack-service.ts:7     if (typeof window === 'undefined' && !PAYSTACK_SECRET_KEY) {
src/lib/paystack-service.ts:8       console.warn('[Yrdly] Missing PAYSTACK_SECRET_KEY — Paystack features will not work.');
src/lib/paystack-service.ts:15    if (!PAYSTACK_SECRET_KEY) {
src/lib/paystack-service.ts:16      throw new Error('Paystack service not available - PAYSTACK_SECRET_KEY is not set');
src/lib/paystack-service.ts:19    const res = await fetch(`${PAYSTACK_BASE_URL}${endpoint}`, {
src/lib/paystack-service.ts:22      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
src/lib/paystack-service.ts:240   if (process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_test_')) {
src/lib/paystack-service.ts:251   if (process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_test_')) {
src/app/api/webhooks/paystack/route.ts:15  * We verify the webhook signature using HMAC SHA512 and PAYSTACK_SECRET_KEY.
src/app/api/webhooks/paystack/route.ts:21  const secretKey = process.env.PAYSTACK_SECRET_KEY;
src/app/api/webhooks/paystack/route.ts:24  console.error('[Webhook] CRITICAL: PAYSTACK_SECRET_KEY is not set');
src/app/api/paystack/banks/route.ts:11    const secretKey = process.env.PAYSTACK_SECRET_KEY;
src/app/api/paystack/banks/route.ts:13    console.error('[Paystack Banks] CRITICAL: PAYSTACK_SECRET_KEY is not set');
docs/app-reference.md:313               PAYSTACK_PUBLIC_KEY=pk_test_...
docs/app-reference.md:314               PAYSTACK_SECRET_KEY=sk_test_...
docs/app-reference.md:317               PAYSTACK_WEBHOOK_SECRET=your_secret_here
docs/app-reference.md:479               - [ ] Set `PAYSTACK_WEBHOOK_SECRET` in both `.env.local` and the Paystack dashboard
```

### 6b. yrdly-mobile — paystack references (case-insensitive)

```
src/app/events/[id]/index.tsx:360    // Add a 3s delay to allow Paystack's backend state to update to 'success'
src/app/checkout/[id].tsx:185        <Text style={stylesheet.payingTitle}>Redirecting to Paystack</Text>
src/app/settings/payout-settings.tsx:49   const data = await api.get('/api/paystack/banks');
src/app/settings/payout-settings.tsx:73   const data = await api.post('/api/paystack/resolve-account', {
src/app/settings/payout-settings.tsx:162  <Text style={s.verifiedTxt}>Verified by Paystack</Text>
src/app/settings/payout-settings.tsx:256  <Text style={s.verifyingTxt}>Verifying account with Paystack…</Text>
src/app/settings/payout-settings.tsx:266  <Text style={s.confirmedSub}>Verified by Paystack ✓</Text>
src/lib/paystack-service.ts:2       * Mobile Paystack Service
src/lib/paystack-service.ts:4       * On mobile we NEVER embed the Paystack secret key in the app bundle.
src/lib/paystack-service.ts:41      export class PaystackService {
src/lib/paystack-service.ts:44       * Returns the Paystack hosted payment URL to open in a WebView.
src/lib/paystack-service.ts:78      console.error('[PaystackService] initializePayment error:', error);
src/lib/paystack-service.ts:87       * comes from the Paystack webhook hitting the backend.
src/lib/paystack-service.ts:114     console.error('[PaystackService] verifyPayment error:', error);
src/lib/paystack-service.ts:138     * Returns true if the given URL is the Paystack checkout success/cancel redirect.
```

**No `EXPO_PUBLIC_PAYSTACK_*` env vars found in yrdly-mobile source.** The mobile client never embeds a key — all calls proxy through `EXPO_PUBLIC_API_URL` to the yrdly-app backend.

### Consolidated env vars needing Payluk equivalents

| Existing var | Consumed in | Payluk equivalent needed |
|---|---|---|
| `PAYSTACK_SECRET_KEY` | yrdly-app (paystack-service.ts, webhooks/paystack/route.ts, api/paystack/banks/route.ts) | `PAYLUK_SECRET_KEY` |
| `PAYSTACK_PUBLIC_KEY` | docs/app-reference.md only (not in live code) | `PAYLUK_PUBLIC_KEY` (if Payluk has a publishable key concept) |
| `PAYSTACK_WEBHOOK_SECRET` | docs/app-reference.md only (not in live code) | `PAYLUK_WEBHOOK_SECRET` |
| `NEXT_PUBLIC_APP_URL` | yrdly-app (callback URL construction) | No change — shared |
| `EXPO_PUBLIC_API_URL` | yrdly-mobile (backend proxy base URL) | No change — shared |

---

*End of Phase 0 recon. No code was modified. No migrations were applied. No Supabase writes were executed.*
