# Storefront Integration Guide

For the developer building the Bramhkanti Next.js storefront (separate repo).
Backend: Medusa **2.21.2**. Official references:
[Store API](https://docs.medusajs.com/api/store) ·
[JS SDK](https://docs.medusajs.com/resources/js-sdk) ·
[Storefront guides](https://docs.medusajs.com/resources/storefront-development).

## Postman collection

`postman/` contains:

- `Bramhkanti-Storefront.postman_collection.json`: every storefront call below, in checkout order
- `Bramhkanti-Local.postman_environment.json` / `Bramhkanti-Production.postman_environment.json`

Import all three, pick an environment, set `publishable_key`, and run folders **1 → 7** in order.
Test scripts save `region_id`, `product_id`, `variant_id`, `cart_id`, `payment_collection_id`
and `order_id` automatically; requests whose inputs are missing are skipped with a console note.
Folder 8 (customer account) creates a real customer. Use a test email.

Command line: `npx newman run postman/Bramhkanti-Storefront.postman_collection.json -e postman/Bramhkanti-Local.postman_environment.json --env-var publishable_key=pk_...`

---

## 1. Connection details

| Item | Development | Production |
|---|---|---|
| Backend base URL | `http://localhost:9000` | to be provided (e.g. `https://api.bramhkanti.com`) |
| Publishable API key | ask the backend owner (Admin > Settings > Publishable API Keys > "Bramhkanti Storefront") | same place, prod instance |
| Region | `India` (currency `inr`, country `in`) | same |
| Allowed storefront origins (CORS) | `http://localhost:3000`, `http://localhost:8000` | send your production domain(s) to the backend owner |

Storefront `.env.local`:

```bash
NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://localhost:9000
NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_...
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_...   # optional; also returned in the payment session
```

**Security rules**

- The publishable key (`pk_...`) is public by design; it only scopes requests to the Bramhkanti sales channel.
- Never put admin credentials, admin tokens, secret API keys, `RAZORPAY_KEY_SECRET` or Shiprocket credentials in the storefront.
- Every `/store/*` request must send `x-publishable-api-key`. Without it you get:
  `{"type":"not_allowed","message":"Publishable API key required in the request header: x-publishable-api-key..."}`
- If you run on a port other than 3000/8000, ask for it to be added to `STORE_CORS` and `AUTH_CORS`.

## 2. SDK setup (recommended)

```bash
npm install @medusajs/js-sdk@2.21.2 @medusajs/types@2.21.2
```

```ts
// lib/medusa.ts
import Medusa from "@medusajs/js-sdk"

export const sdk = new Medusa({
  baseUrl: process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL!,
  publishableKey: process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY!,
  auth: { type: "session" }, // or "jwt"; see section 5
})
```

All examples below show both the SDK call and the raw HTTP equivalent.

## 3. Region (do this once, cache it)

Prices are resolved per region. There is one region: **India / INR**.

```ts
const { regions } = await sdk.store.region.list()
const india = regions.find((r) => r.currency_code === "inr")!
```
`GET /store/regions`

## 3a. Brand (logo, name, tagline)

Custom endpoint for header/footer branding:

```http
GET /store/brand
x-publishable-api-key: pk_...
```

```json
{ "brand": { "name": "Bramhkanti", "logo_url": "https://.../bramhkanti-logo.png", "tagline": "स्वाद अपनेपन का" } }
```

The logo is also the last image on each product. Products without their own photos yet
(Mango, Lemon) only have the logo, so design the product card to handle a square logo image.

## 4. Products

### Listing

```ts
const { products, count } = await sdk.store.product.list({
  region_id: india.id,
  limit: 20,
  offset: 0,
  fields: "*variants.calculated_price,+variants.inventory_quantity",
})
```

`GET /store/products?region_id=reg_...&fields=*variants.calculated_price,%2Bvariants.inventory_quantity`

Useful filters: `handle`, `category_id[]`, `q` (search), `order=created_at`.

Response shape (trimmed; captured from the verification run, values are placeholders, not real prices or stock):

```json
{
  "products": [
    {
      "id": "prod_...",
      "title": "Mango Pickle",
      "handle": "mango-pickle",
      "thumbnail": "https://.../mango.jpg",
      "options": [{ "title": "Jar Size", "values": [{ "value": "250 g" }, { "value": "500 g" }] }],
      "variants": [
        {
          "id": "variant_...",
          "title": "250 g",
          "inventory_quantity": 5,
          "calculated_price": {
            "calculated_amount": 1,
            "currency_code": "inr",
            "is_calculated_price_tax_inclusive": true
          }
        }
      ]
    }
  ],
  "count": 1, "offset": 0, "limit": 20
}
```

**Money format:** amounts are in **rupees (major unit)**, not paise. `249` means ₹249.
Prices are **GST-inclusive** (`is_calculated_price_tax_inclusive: true`); show them as-is.

```ts
const fmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" })
fmt.format(variant.calculated_price.calculated_amount)
```

### Detail page

```ts
const { products } = await sdk.store.product.list({
  handle: "mango-pickle",
  region_id: india.id,
  fields: "*variants.calculated_price,+variants.inventory_quantity,*images,*categories",
})
const product = products[0]
```

Pick the variant by matching the selected "Jar Size" option value. Disable "Add to cart"
when `inventory_quantity <= 0` (inventory is tracked).

### Categories

`GET /store/product-categories` → `sdk.store.category.list()`. Products are in "Pickles".

## 5. Customers (optional; guest checkout works)

Register:

```ts
const token = await sdk.auth.register("customer", "emailpass", { email, password })
await sdk.store.customer.create({ email, first_name, last_name, phone })
```

Login / me / logout:

```ts
await sdk.auth.login("customer", "emailpass", { email, password })
const { customer } = await sdk.store.customer.retrieve()
await sdk.auth.logout()
```

Saved addresses: `sdk.store.customer.createAddress({...})`, `listAddress()`.
After login, link an existing guest cart: `sdk.store.cart.transferCart(cartId)`.

Raw HTTP: `POST /auth/customer/emailpass/register`, `POST /auth/customer/emailpass`,
`POST /store/customers`, `GET /store/customers/me`.

## 6. Cart

Persist `cart.id` (cookie or localStorage). Verified sequence:

```ts
// 1. create
const { cart } = await sdk.store.cart.create({ region_id: india.id })

// 2. add / update / remove items
await sdk.store.cart.createLineItem(cart.id, { variant_id, quantity: 1 })
await sdk.store.cart.updateLineItem(cart.id, lineItemId, { quantity: 2 })
await sdk.store.cart.deleteLineItem(cart.id, lineItemId)

// 3. email + addresses
await sdk.store.cart.update(cart.id, {
  email: "customer@example.com",
  shipping_address: {
    first_name: "Asha", last_name: "Verma",
    address_1: "12 MG Road", address_2: "",
    city: "Jaipur", province: "Rajasthan",
    postal_code: "302001", country_code: "in",
    phone: "+919876543210",
  },
  billing_address: { /* same shape; can copy shipping */ },
})
```

Raw HTTP: `POST /store/carts`, `POST /store/carts/{id}/line-items`,
`POST /store/carts/{id}/line-items/{line_id}`, `DELETE /store/carts/{id}/line-items/{line_id}`,
`POST /store/carts/{id}`.

**Address requirements** (needed for courier booking): `country_code` must be `in`,
`postal_code` a 6-digit pincode, `phone` present, `province` = Indian state name.

### Optional: pincode delivery check (custom endpoint)

```http
GET /store/shipping/serviceability?postcode=302001&weight_kg=0.5
x-publishable-api-key: pk_...
```

```json
{ "postcode": "302001", "serviceable": true, "estimated_delivery_days": 3 }
```

- `400 invalid_data` for a bad pincode.
- `503 {"type":"not_configured"}` until Shiprocket is set up. Treat 503 as "unknown", never as "not deliverable".
- This is informational. The fee charged comes from the shipping option (section 7).

## 7. Shipping options

After the shipping address is set:

```ts
const { shipping_options } = await sdk.store.fulfillment.listCartOptions({ cart_id: cart.id })
// [{ id: "so_...", name: "Standard Delivery", amount: 60, ... }]
await sdk.store.cart.addShippingMethod(cart.id, { option_id: shipping_options[0].id })
```

Raw HTTP: `GET /store/shipping-options?cart_id=...`, `POST /store/carts/{id}/shipping-methods`.

Shipping option names and fees are set by the business in the admin. Do not hard-code them.
An empty list means no option is configured yet, or the address is outside India.

## 8. Payment (Razorpay)

Provider id: **`pp_razorpay_razorpay`** (UPI, cards, netbanking, wallets all go through Razorpay Checkout).

```ts
// 1. initiate: creates a Razorpay Order server-side
const { payment_collection } = await sdk.store.payment.initiatePaymentSession(cart, {
  provider_id: "pp_razorpay_razorpay",
})
const session = payment_collection.payment_sessions!.find(
  (s) => s.provider_id === "pp_razorpay_razorpay"
)!
const { razorpay_order_id, amount, currency, key_id } = session.data as {
  razorpay_order_id: string; amount: number; currency: string; key_id: string
}
```

Raw HTTP: `POST /store/payment-collections` `{ "cart_id": "..." }`, then
`POST /store/payment-collections/{id}/payment-sessions` `{ "provider_id": "pp_razorpay_razorpay" }`.

`session.data.amount` is in **paise** (Razorpay's unit). Pass it straight to Checkout.

```ts
// 2. open Razorpay Checkout (https://checkout.razorpay.com/v1/checkout.js)
const rzp = new (window as any).Razorpay({
  key: key_id,
  order_id: razorpay_order_id,
  amount,
  currency,
  name: "Bramhkanti",
  prefill: { email: cart.email, contact: cart.shipping_address?.phone },
  handler: async () => {
    // 3. complete the cart. The BACKEND verifies the payment with Razorpay;
    //    the handler's payload is NOT trusted and need not be sent.
    await completeOrder(cart.id)
  },
  modal: { ondismiss: () => {/* let the user retry */} },
})
rzp.on("payment.failed", (resp: any) => showError(resp.error.description))
rzp.open()
```

**Important**

- If the cart total changes after initiating (quantity, shipping), call
  `initiatePaymentSession` again. The backend creates a fresh Razorpay order for the new amount.
- Never show "Order placed" based on the Razorpay `handler` alone. Show it only after step 9 returns an order.

## 9. Complete the order

```ts
async function completeOrder(cartId: string) {
  const result = await sdk.store.cart.complete(cartId)
  if (result.type === "order") {
    clearCartId()
    router.push(`/order/confirmed/${result.order.id}`)
  } else {
    // result.type === "cart": payment not confirmed by Razorpay yet, or an error
    showError(result.error?.message ?? "Payment not confirmed yet")
  }
}
```

Raw HTTP: `POST /store/carts/{id}/complete`.

Behaviour:

- The backend fetches the Razorpay order server-to-server and authorizes only if a payment
  for the **exact amount** is `authorized`/`captured`.
- If UPI is still settling, `complete` returns `type: "cart"`. Wait 2–3 s and retry a few
  times, then show "We're confirming your payment". Razorpay's webhook also completes the
  order on the backend even if the customer closed the tab, so check `GET /store/orders/{id}`
  or the customer's order list.

Order confirmation page:

```ts
const { order } = await sdk.store.order.retrieve(orderId)
// order.display_id, order.items, order.total, order.shipping_address, order.fulfillment_status
```

Logged-in customers: `sdk.store.order.list()` (`GET /store/orders`).

## 10. Order status for the customer

| `order.fulfillment_status` | Show as |
|---|---|
| `not_fulfilled` | Order confirmed, being packed |
| `fulfilled` | Packed, awaiting courier pickup |
| `shipped` / `partially_shipped` | Shipped (show `fulfillments[].labels[].tracking_url`) |
| `delivered` | Delivered |
| `canceled` | Cancelled |

`payment_status`: `authorized` / `captured` = paid; `refunded` / `partially_refunded` as named.

## 11. Errors

Medusa returns:

```json
{ "type": "invalid_data", "message": "Variant variant_... does not have the required inventory" }
```

| HTTP | `type` | Typical cause / handling |
|---|---|---|
| 400 | `invalid_data` | bad input, out of stock, invalid pincode: show `message` |
| 400 | `not_allowed` | missing publishable key, cart already completed: fix request / start new cart |
| 401 | `unauthorized` | customer session expired: re-login |
| 404 | `not_found` | stale cart id: create a new cart |
| 409 | `conflict` | concurrent cart update: retry once |
| 500 | `unknown_error` | log and show a generic message |

## 12. Checklist

- [ ] `x-publishable-api-key` on every `/store` call
- [ ] Prices displayed in ₹ from `calculated_price.calculated_amount` (rupees, GST-inclusive)
- [ ] Cart id persisted, recreated on 404
- [ ] Address validated (6-digit pincode, phone, state)
- [ ] Shipping options loaded from API, not hard-coded
- [ ] Razorpay session re-initiated after total changes
- [ ] Success page only after `cart.complete` returns `type: "order"`
- [ ] No secrets in client bundles
