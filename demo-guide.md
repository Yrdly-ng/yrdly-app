# Yrdly Events & Marketplace Demo Guide

This guide provides step-by-step instructions to test and demonstrate the newly built Events and Marketplace features, including the new creator onboarding flows, ticket tiers, and Escrow payment requirements.

---

## 1. The Creator Onboarding Flows

We've added a **3-step onboarding flow** for both Events and Marketplace to clearly set expectations with users before they spend time filling out forms.

### How to test Event Onboarding:
1. Go to the **Home Screen** and tap `Event`, OR go to the **Events Screen** and tap the floating `+` button.
2. **Step 1:** The modal asks "What kind of event are you hosting?"
   - **Test path A (Free):** Click "Free Event". It will skip payout setup and go straight to Step 3. Click "Build My Event".
   - **Test path B (Paid):** Click "Paid Event".
3. **Step 2 (Paid path):** If your account *doesn't* have a Flutterwave subaccount linked, it will explain how payouts work (95% to you, 5% fee) and ask you to link a bank account. Clicking the button routes you to `/settings/payout`.
   *(If you already linked an account, this step is automatically skipped).*

### How to test Marketplace Onboarding:
1. Go to the **Home Screen** and tap `Sell`, OR go to the **Marketplace Screen** and tap the floating `+` button.
2. Similar to events, select "Free Item" or "Paid Item".
3. **Paid Items** enforce Escrow and will ensure you have a payout account linked before opening the listing form.

---

## 2. Creating and Publishing an Event

Once you're in the `/events/create` form:

1. **Basic Info:** Fill out the Title, Date & Time, and select a location.
2. **Cover Image:** Upload an image. *(Note: We fixed the storage RLS bug, so image uploads will now succeed for all authenticated users).*
3. **Ticket Tiers:** 
   - Add a "Regular" tier. 
   - For a free event, set the price to `0`. 
   - For a paid event, set a price (e.g., `5000`). *(Note: You must have a payout account linked to publish paid tiers).*
4. Click **Publish Event**.
5. You'll be redirected to the **Event Detail page** (`/events/[id]`).
6. Go back to the **Events Screen** (`/events`). Your event will appear under "Events in your Area".

---

## 3. Buying a Ticket (Attendee Flow)

To test the buyer flow:
*(Ideally, use a second account so you aren't buying your own ticket, though the app allows testing it).*

1. From the **Events Screen**, tap on the newly created event.
2. On the Event Detail page, tap **Buy Ticket** (or **Get Ticket**).
3. The **Ticket Selection Sheet** opens. Select the quantity for the tiers you want.
4. **Checkout:**
   - If the ticket is free (Price: 0), it bypasses payment and instantly creates the ticket.
   - If it's a paid ticket, it opens the Flutterwave modal. Enter test card details to simulate a successful payment.
5. **Success:** 
   - A success modal will appear.
   - A confirmation email with a working Deep Link to the event will be sent to your email. *(Note: The broken email links bug is now fixed).*
6. Go to **Settings → My Tickets** to view your purchased ticket and QR code.

---

## 4. Selling an Item on the Marketplace

1. From the **Marketplace Screen**, tap the `+` button, pass the onboarding, and open the "Create Post" modal (which adapts to "For Sale").
2. Upload a clear photo of your item.
3. Add a Title, Description, and Price.
4. Hit **Post**.
5. The item immediately appears in the Marketplace feed.

---

## 5. Buying an Item (Escrow Flow)

*(Again, testing with a second account is best).*

1. Tap an item in the Marketplace feed.
2. Tap **Buy Now**.
3. **Escrow Checkout:** You pay for the item via Flutterwave. The money is held in Escrow by Yrdly.
4. The item is marked as "Sold" and disappears from the public feed.
5. You and the seller coordinate delivery via direct message.
6. **Releasing Funds:** Once you (the buyer) receive the item, go to the order in your dashboard and click "Confirm Delivery". This triggers the automated payout of 95% of the funds to the seller's linked Flutterwave subaccount.

---

## Summary of Recent Fixes Verified in this Demo:
- ✅ **Events RLS Bug:** Authenticated users can now successfully create events.
- ✅ **Storage Image Bug:** Uploading cover images to `post-images` no longer fails with a 400 Bad Request.
- ✅ **Empty Error 402:** Replaced with the intuitive 3-step Onboarding Flow so users link payout accounts *before* filling forms.
- ✅ **Broken Email Links:** RSVP confirmation emails now correctly deep-link back to the event.
- ✅ **UI Glitch:** The Login page now shows a clean, single, large Yrdly Logo without the redundant "rdly" text clipping.
