# Shipping Setup (India delivery + Shiprocket)

Status: **delivery structure configured; Shiprocket code ready but not connected.**
No shipments or pickups have been booked.

## What already exists in the backend

| Thing | Value |
|---|---|
| Stock location | "Bramhkanti Pickup Location" (**address is blank, fill it in**) |
| Fulfillment set / zone | "Bramhkanti India Delivery" → service zone "India" (country `in`) |
| Fulfillment providers | `manual_manual` (always), `shiprocket_shiprocket` (when credentials are set) |
| Shipping options | **none yet**: fees are your decision |

## Step 1: business setup in Admin (needed for any checkout)

Admin: `http://localhost:9000/app`

1. **Settings > Locations & Shipping > Bramhkanti Pickup Location**: enter the real pickup address.
2. In the same location, **India Delivery > India > Shipping options > Create**:
   - Name (e.g. "Standard Delivery"), fixed price in ₹ (your fee; ₹0 for free shipping)
   - Provider: `manual` for now, or `shiprocket` once connected (see below)
   - Optional: a free-shipping threshold via Promotions.
3. **Settings > Tax Regions > India**: set the GST rate your accountant confirms for pickles.
   Prices are entered **GST-inclusive** (MRP).

## Step 2: manual workflow (works today, no Shiprocket API needed)

For each paid order:

1. Admin > Orders > open the order > **Fulfill items** (stock is deducted from the pickup location).
2. Pack the jars.
3. In the **Shiprocket panel** create the order manually, assign courier/AWB, print the label,
   and schedule pickup.
4. Admin > Order > fulfillment > **Mark as shipped** and enter the AWB as tracking number.
5. When delivered, **Mark as delivered**.
6. RTO / return: handle in Shiprocket; in Admin create a Return/Refund as appropriate.

## Step 3: Shiprocket automation (when you're ready)

### What you must supply

1. Shiprocket account with KYC done and the **pickup address** added
   (Settings > Pickup Addresses). Note its exact **name**.
2. **API user** (Settings > API > Configure > Create API User). It must use a different email from
   your main login. Shiprocket requires API-user credentials, not your login.
3. Measure your standard packed box.
4. `apps/backend/.env`:
   ```bash
   SHIPROCKET_EMAIL=api-user@example.com
   SHIPROCKET_PASSWORD=...
   SHIPROCKET_PICKUP_LOCATION=<exact pickup location name>
   SHIPROCKET_PICKUP_POSTCODE=<pickup pincode>
   SHIPROCKET_WEBHOOK_TOKEN=<openssl rand -hex 32>
   SHIPROCKET_PACKAGE_LENGTH_CM=
   SHIPROCKET_PACKAGE_BREADTH_CM=
   SHIPROCKET_PACKAGE_HEIGHT_CM=
   SHIPROCKET_PACKAGE_WEIGHT_KG=
   ```
5. Restart the backend; set your shipping option's provider to **shiprocket**.
6. Shiprocket > Settings > API > Webhooks:
   - URL: `https://<public-backend-url>/hooks/courier-tracking`
     (Shiprocket rejects URLs containing "shiprocket", "kartrocket", "sr" or "kr", hence the name)
   - Security token: the same `SHIPROCKET_WEBHOOK_TOKEN` (sent as `x-api-key`)
   - Enable the toggle

### What the automation does

API endpoints were checked against the official collection at https://apidocs.shiprocket.in (2026-10-12).
Base: `https://apiv2.shiprocket.in/v1/external`; the token comes from `POST /auth/login`
(valid 10 days, refreshed automatically after 9).

| Event | Backend action | Shiprocket API |
|---|---|---|
| Admin clicks **Fulfill items** (option provider = shiprocket) | create Shiprocket order (Prepaid, box size from env), assign AWB, generate label; stored on the fulfillment; AWB shown as tracking number | `orders/create/adhoc`, `courier/assign/awb`, `courier/generate/label` |
| Admin calls **pickup** | books a **real courier pickup** (only once per shipment) | `courier/generate/pickup` |
| Fulfillment cancelled in Admin | Shiprocket order cancelled | `orders/cancel` |
| Tracking webhook: PICKED UP / SHIPPED / IN TRANSIT / OUT FOR DELIVERY | order marked **shipped** (once) | – |
| Tracking webhook: DELIVERED | order marked **delivered** (once) | – |
| Tracking webhook: RTO* / UNDELIVERED / LOST | status saved; warning logged for **manual** handling | – |
| Storefront pincode check | `GET /store/shipping/serviceability?postcode=` | `courier/serviceability/` |

Pickup request (admin token required; there is no button yet):

```bash
curl -X POST http://localhost:9000/admin/shiprocket/fulfillments/<ful_id>/pickup \
  -H "Authorization: Bearer <admin token>"
```

If AWB assignment fails (wallet balance, unserviceable pincode), the Shiprocket order still
exists. Finish it in the Shiprocket panel; nothing is reported as booked when it isn't.

### Known limitations / later work

- One standard box size for every order (env). Multi-box or weight-by-jar can be added once real weights are known.
- Returns / RTO restocking are manual.
- No COD (all orders are prepaid via Razorpay).
- Courier rates are not used for checkout pricing; checkout uses your flat shipping option prices.
- Manifest generation (`manifests/generate`) is done in the Shiprocket panel.

## What was verified locally (2026-10-12)

- Provider registers as `shiprocket_shiprocket` when credentials are set.
- Serviceability endpoint validates pincodes and returns `503 not_configured` when not set up.
- Tracking webhook: wrong token → 401; correct token → 200, fulfillment lookup by
  fulfillment id and by AWB runs without errors.
- Pickup route requires admin auth (401 without).
- **Not verified:** any real Shiprocket API call (no credentials), and webhook-driven
  shipped/delivered transitions on a real order (no test orders were created).
