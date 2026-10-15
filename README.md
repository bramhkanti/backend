# Bramhkanti Backend

Ecommerce backend for **Bramhkanti** (Indian achar / pickles): Medusa **2.21.2** + built-in
admin dashboard, PostgreSQL 16, Redis 7. The storefront lives in a separate repository.

| Doc | For |
|---|---|
| [STOREFRONT_INTEGRATION.md](STOREFRONT_INTEGRATION.md) | storefront developer |
| [PAYMENTS_SETUP.md](PAYMENTS_SETUP.md) | Razorpay |
| [SHIPPING_SETUP.md](SHIPPING_SETUP.md) | delivery, Shiprocket |
| [OTP_LOGIN.md](OTP_LOGIN.md) | mobile OTP login, SMS providers, test mode |
| [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md) | going live on a VPS |
| [postman/](postman/) | Postman collection + environments for the Store API |

## Layout

```
bramhkanti-backend/
├── docker-compose.yml        # project-only Postgres (5442) + Redis (6389)
├── .env                      # compose vars (gitignored) - template: .env.example
└── apps/backend/             # Medusa app
    ├── .env                  # app config + secrets (gitignored) - template: .env.example
    ├── medusa-config.ts      # DB, Redis modules, CORS, providers
    └── src/
        ├── migration-scripts/initial-data-seed.ts   # India store structure (runs once on migrate)
        ├── modules/razorpay/                         # payment provider
        ├── modules/shiprocket/                       # fulfillment provider + API client
        ├── modules/phone-auth/                       # mobile OTP login + SMS providers
        ├── workflows/register-phone-customer.ts      # customer for a new OTP login
        └── api/
            ├── store/brand/                          # public logo/name/tagline
            ├── store/shipping/serviceability/        # pincode check
            ├── store/phone-auth/customer/            # register a new OTP customer
            ├── admin/shiprocket/fulfillments/[id]/pickup/
            └── hooks/courier-tracking/               # Shiprocket tracking webhook
```

## Prerequisites

- Node **24.14.0** (`.nvmrc`; Medusa 2.21 needs ≥ 22.22): `nvm use`
- Docker Desktop running

## First-time setup

```bash
nvm use
npm install

cp .env.example .env                              # set POSTGRES_PASSWORD (openssl rand -hex 24)
cp apps/backend/.env.example apps/backend/.env    # set DATABASE_URL password + secrets (openssl rand -hex 32)

npm run services:up        # start Postgres + Redis, wait for "healthy": npm run services:status
npm run backend:migrate    # schema + one-time India store setup
```

Create an admin user (Medusa 2.21 CLI):

```bash
cd apps/backend
npx medusa user -e you@bramhkanti.com -p '<strong password>'
```

## Run

```bash
npm run backend:dev                      # http://localhost:9000
```

- Admin dashboard: http://localhost:9000/app
- Health: `curl http://localhost:9000/health` → `OK`

Production:

```bash
npm run build                            # outputs apps/backend/.medusa/server
cd apps/backend && npm run start:prod    # NODE_ENV=production; refuses weak JWT/COOKIE secrets
```

In production, copy the env into `.medusa/server/.env`, use managed Postgres/Redis, set
`S3_*` for image storage, and set the real storefront domains in `STORE_CORS` / `AUTH_CORS`.
For scale, run one `MEDUSA_WORKER_MODE=server` instance (admin enabled) and one
`MEDUSA_WORKER_MODE=worker` (`DISABLE_MEDUSA_ADMIN=true`).

## Services

| Service | Container | Host access | From another container on the compose network |
|---|---|---|---|
| Postgres 16 | `bramhkanti-postgres` | `localhost:5442` (loopback only) | `postgres:5432` |
| Redis 7 | `bramhkanti-redis` | `localhost:6389` (loopback only) | `redis:6379` |

Data is kept in the named volumes `bramhkanti_bramhkanti_pg_data` and `bramhkanti_bramhkanti_redis_data`.

```bash
npm run services:up        # start
npm run services:down      # stop (keeps data)
npm run services:status
```

> `docker compose down -v` **deletes the database volumes**. Don't run it unless you mean to wipe all data.

Redis backs the event bus, workflow engine, locking and sessions.

## Sample catalog (development / demos)

```bash
cd apps/backend
SAMPLE_IMAGE_BASE_URL=http://localhost:3000 npm run seed:sample
```

Creates Pickles / Makhana / Sweets categories with subcategories, 8 products, 3 collections
with banners (Best Sellers, Grandma's Specials, Diwali Gifting) and Standard/Express delivery
options. It also gives a sample price to existing unpriced products. **Prices, stock and delivery fees are
sample values** (`metadata.sample_data = true`); replace them before going live. Safe to run
again: nothing is duplicated. Images are served by the storefront (`public/images/home`).

Storefront content set in the admin as **metadata**:

| Where | Key | Used for |
|---|---|---|
| Collection | `banner_url`, `banner_mobile_url`, `banner_alt` | collection page hero + menu image |
| Collection | `description`, `subtitle`, `badge`, `highlights` (JSON list) | menu and collection page text |
| Category | `image_url`, `badge` | header categories menu |
| Product | `featured: true` | shown first in home Bestsellers |

## Admin: what to do first

1. **Settings > Locations & Shipping**: fill in the pickup address; create shipping option(s) and fees.
2. **Settings > Tax Regions > India**: set the GST rate.
3. **Products > Create**: e.g. Mango Pickle, option "Jar Size" (250 g / 500 g), price per
   variant in ₹ (GST-inclusive), images, sales channel "Bramhkanti Website", category "Pickles", **Publish**.
4. **Inventory**: set stocked quantity per variant at the pickup location.
5. **Settings > Publishable API Keys**: copy "Bramhkanti Storefront" for the storefront developer.

The backend was created **without** products, prices, stock, shipping fees or a GST rate.
Those are business decisions.

## Already configured

Store "Bramhkanti" (INR, tax-inclusive) · Region "India" · Tax region IN · Sales channel
"Bramhkanti Website" · Publishable key "Bramhkanti Storefront" · Stock location + India
delivery zone (manual provider) · Category "Pickles" · Product option "Jar Size".

## Pending external setup

| Item | Needs |
|---|---|
| Razorpay | test keys + webhook secret, then enable on India region ([PAYMENTS_SETUP.md](PAYMENTS_SETUP.md)) |
| Shiprocket | API user, pickup location, box size, webhook ([SHIPPING_SETUP.md](SHIPPING_SETUP.md)) |
| Image storage (prod) | S3/R2 bucket + `S3_*` env |
| Public URL | needed for Razorpay/Shiprocket webhooks |
| SMS for OTP login | provider account + DLT template; until then OTP test mode is on ([OTP_LOGIN.md](OTP_LOGIN.md)) |
| Transactional email | not configured (order confirmation emails), add a notification provider later |

## Scripts

| Command | What |
|---|---|
| `npm run services:up/down/status` | Docker services |
| `npm run backend:dev` | dev server with reload |
| `npm run backend:migrate` | run migrations |
| `npm run build` / `npm run start` | production build / start |
| `npm run lint` | Medusa lint rules |
