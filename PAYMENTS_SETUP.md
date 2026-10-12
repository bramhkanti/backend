# Payments Setup (Razorpay)

Status: **code ready, not yet connected to Razorpay.** No real or test transactions have been made.
The provider loads only when keys are present in `apps/backend/.env`.

## Why a custom provider

Checked on 2026-10-12 against Medusa **2.21.2**:

| Package | Problem |
|---|---|
| (none official) | Medusa ships no Razorpay provider |
| `medusa-plugin-razorpay-v2@0.1.4` | peer-pins Medusa **2.12.3** exactly; last release Dec 2025 |
| `@devx-commerce/razorpay@6.0.0-beta.0` | beta only; peer-pins Medusa **2.14.2** |
| `@sgftech/payment-razorpay` | last release Nov 2024 |
| `medusa-payment-razorpay` | Medusa **v1** only |

So the backend uses a small provider built on Razorpay's **official Node SDK** (`razorpay@2.9.8`)
and Medusa's documented `AbstractPaymentProvider` contract:
`apps/backend/src/modules/razorpay/service.ts`.

## How it works

1. **Initiate.** The storefront creates a payment session with `pp_razorpay_razorpay`. The backend
   creates a Razorpay **Order** (amount in paise, `notes.session_id` = Medusa session).
   The session data returned to the browser holds `razorpay_order_id`, `amount`, `currency`
   and the public `key_id`. **No secrets.**
2. **Pay.** The customer pays in Razorpay Checkout (UPI / cards / netbanking / wallets).
3. **Verify.** On `POST /store/carts/:id/complete`, `authorizePayment` calls
   Razorpay **server-to-server** (`orders.fetchPayments`) and authorizes only if a payment
   for the **exact order amount** is `authorized` or `captured`. A frontend success callback
   alone can never mark an order paid.
4. **Webhooks.** `POST /hooks/payment/razorpay_razorpay` (Medusa's built-in route):
   - the `X-Razorpay-Signature` HMAC-SHA256 of the raw body is verified with `RAZORPAY_WEBHOOK_SECRET`. Invalid or unsigned events are ignored.
   - `payment.authorized` → authorized, `payment.captured` / `order.paid` → captured,
     `payment.failed` → failed.
   - Events are queued and processed by Medusa's `processPaymentWorkflow`, which locks the cart and
     skips already-processed states, so **duplicate or retried webhooks are idempotent**. It also
     completes the order if the customer closed the browser after paying.
5. **Capture.** With Razorpay auto-capture ON (recommended), payments arrive captured.
   If it's off, use Admin > Order > Payment > Capture.
6. **Refund.** Admin > Order > Refund calls `payments.refund` for the given amount.
7. **Cancel.** Razorpay has no "void" API; uncaptured payments are auto-refunded by Razorpay
   after the capture window.

## What you must supply

1. Razorpay account → **Test Mode** → Account & Settings → API Keys → Generate Test Key.
2. Put into `apps/backend/.env`:
   ```bash
   RAZORPAY_KEY_ID=rzp_test_xxxxxxxx
   RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxx
   RAZORPAY_WEBHOOK_SECRET=<a long random string you choose: openssl rand -hex 32>
   ```
3. Razorpay Dashboard (Test Mode) → Webhooks → Add:
   - URL: `https://<public-backend-url>/hooks/payment/razorpay_razorpay`
     (for local testing expose port 9000 with a tunnel such as ngrok or cloudflared)
   - Secret: the same `RAZORPAY_WEBHOOK_SECRET`
   - Events: `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`
4. Recommended: Account & Settings → Payment Capture → **Automatic**.
5. Restart the backend. Then **Admin > Settings > Regions > India > Edit** → add payment provider
   **razorpay** (`pp_razorpay_razorpay`). Optionally remove `pp_system_default` (the manual
   provider) so customers can't place unpaid orders.

## Test plan (test mode only)

1. Create a real product with a price (test mode charges nothing).
2. Walk the storefront flow (STOREFRONT_INTEGRATION.md §6–9) and pay with Razorpay's
   [test UPI IDs / cards](https://razorpay.com/docs/payments/payments/test-card-upi-details/).
3. Check: the order appears in Admin with payment `captured`; Razorpay Dashboard shows the payment.
4. Pay, then close the tab before `complete`: the webhook should still create the order.
5. Use the failure test card: no order, cart stays open.
6. Refund from Admin and check it in the Razorpay dashboard.

## Go-live (needs your explicit approval; never done automatically)

- Complete Razorpay KYC/activation; generate **Live** keys (`rzp_live_...`).
- Replace keys and webhook (a live-mode webhook is separate) in the **production** env only.
- Make one small real payment and refund it.

## What was verified locally (2026-10-12)

- Provider registers as `pp_razorpay_razorpay` when keys are set and is absent when they're not.
- Webhook with a bad signature → rejected ("invalid signature" logged).
- Webhook with a valid HMAC signature → handed to Medusa's payment workflow.
- **Not verified:** calls to the real Razorpay API (no credentials available).
