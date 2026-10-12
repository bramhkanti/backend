# Production Go-Live Guide

Step-by-step to put the Bramhkanti backend + admin live at **`https://api.bramhkanti.com`**
(admin at `https://api.bramhkanti.com/app`). The storefront (`https://bramhkanti.com`) is
deployed separately by the storefront developer.

> Steps marked **⚠ real money / real couriers** must be done deliberately by the owner.

---

## 0. What you need before starting

| Item | Notes |
|---|---|
| **VPS** (Ubuntu 24.04, ≥ 2 vCPU, 4 GB RAM, 40 GB SSD) | e.g. Hostinger **KVM VPS**. Shared/web hosting **cannot** run Medusa (it needs a long-running Node process). |
| Domain DNS access | `bramhkanti.com` (managed at Hostinger) |
| Object storage for images | Cloudflare R2 (cheap, no egress fees) or AWS S3 (ap-south-1) |
| Razorpay account, KYC **activated** | live keys come only after activation |
| Shiprocket account, KYC done | API user + pickup address |
| Business data | final prices, GST rate, shipping fees, pickup address, real stock |

Managed alternative (less server work, higher monthly cost): Medusa Cloud, or Railway/Render
for the app with managed Postgres + Redis. The env variables below are the same.

---

## 1. DNS

In Hostinger → Domains → `bramhkanti.com` → DNS:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `api` | `<VPS public IP>` | 300 |

The storefront developer sets `@`/`www` for the storefront host. Check with `dig +short api.bramhkanti.com`.

## 2. Prepare the server

SSH in as root once, then work as a normal user:

```bash
adduser deploy && usermod -aG sudo deploy
# copy your SSH key, then in /etc/ssh/sshd_config: PasswordAuthentication no, PermitRootLogin no
sudo systemctl restart ssh

sudo apt update && sudo apt -y upgrade
sudo apt -y install git nginx ufw fail2ban unattended-upgrades
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable

# Docker (official script) - for Postgres + Redis
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker deploy   # log out / in

# Node 24 via nvm (matches .nvmrc)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc && nvm install 24.14.0
npm install -g pm2
```

## 3. Get the code

Push the repo to a **private** GitHub repository first (never commit `.env` files), then:

```bash
cd ~ && git clone git@github.com:<you>/bramhkanti-backend.git
cd bramhkanti-backend && nvm use && npm ci
```

## 4. Database + Redis

```bash
cp .env.example .env
nano .env   # POSTGRES_PASSWORD=$(openssl rand -hex 24) ; keep ports 5442/6389
docker compose up -d && docker compose ps   # both "healthy"
```

Ports are bound to `127.0.0.1` only, so they're not reachable from the internet. Keep it that way.

## 5. Image storage (Cloudflare R2 example)

1. Cloudflare → R2 → Create bucket `bramhkanti-media`.
2. Bucket → Settings → **Public access**: connect custom domain `media.bramhkanti.com`
   (or enable the r2.dev URL).
3. R2 → Manage API tokens → create token with **Object Read & Write** on that bucket.
4. Values for step 6:
   ```bash
   S3_BUCKET=bramhkanti-media
   S3_REGION=auto
   S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
   S3_FILE_URL=https://media.bramhkanti.com
   S3_ACCESS_KEY_ID=...
   S3_SECRET_ACCESS_KEY=...
   ```

## 6. Production environment

```bash
cp apps/backend/.env.example apps/backend/.env
nano apps/backend/.env
```

Set at least:

```bash
NODE_ENV=production
MEDUSA_BACKEND_URL=https://api.bramhkanti.com
DATABASE_URL=postgres://bramhkanti:<POSTGRES_PASSWORD>@localhost:5442/bramhkanti_medusa
REDIS_URL=redis://localhost:6389

STORE_CORS=https://bramhkanti.com,https://www.bramhkanti.com
ADMIN_CORS=https://api.bramhkanti.com
AUTH_CORS=https://bramhkanti.com,https://www.bramhkanti.com,https://api.bramhkanti.com

JWT_SECRET=<openssl rand -hex 32>
COOKIE_SECRET=<openssl rand -hex 32>
AUTH_MFA_ENCRYPTION_KEY=<openssl rand -hex 32>

# S3_* from step 5
# Razorpay: leave EMPTY until step 11
# Shiprocket: fill in step 12
```

**Use new secrets. Never reuse the development `.env`.** Production refuses to start with weak
JWT/COOKIE secrets.

## 7. Migrate, build, create admin

```bash
cd ~/bramhkanti-backend/apps/backend
npx medusa db:migrate                   # schema + India store structure (first run only)
npx medusa build
cp .env .medusa/server/.env
cd .medusa/server && npm install --omit=dev
npx medusa user -e brahmkantioffice@gmail.com -p '<strong unique password>'
```

## 8. Run with pm2

```bash
cd ~/bramhkanti-backend/apps/backend/.medusa/server
NODE_ENV=production pm2 start "npx medusa start" --name bramhkanti-api
pm2 save && pm2 startup     # run the printed sudo command so it restarts on reboot
curl -s localhost:9000/health   # OK
pm2 logs bramhkanti-api --lines 50
```

## 9. Nginx + HTTPS

`/etc/nginx/sites-available/bramhkanti-api`:

```nginx
server {
    server_name api.bramhkanti.com;
    client_max_body_size 20m;          # product image uploads

    location / {
        proxy_pass http://127.0.0.1:9000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/bramhkanti-api /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt -y install certbot python3-certbot-nginx
sudo certbot --nginx -d api.bramhkanti.com     # auto-renews
curl -s https://api.bramhkanti.com/health      # OK
```

Also block direct access to port 9000 from outside: the firewall already allows only SSH + 80/443.

## 10. Store data in the production admin

Log in at `https://api.bramhkanti.com/app`, then:

1. **Settings > Store > Metadata**: `logo_url` (upload logo via any product first, or put it
   in R2), `tagline`.
2. **Settings > Locations & Shipping**: the real pickup address, then shipping option(s) + fees.
3. **Settings > Tax Regions > India**: GST rate (confirm with your accountant).
4. **Products**: create Jimikand / Mango / Lemon again (or export/import CSV from local admin),
   upload photos (they now go to R2), set **prices**, **real stock**, then **Publish**.
   Local product image URLs (`http://localhost:9000/static/...`) don't work in production.
   Re-upload the images.
5. **Settings > Publishable API Keys**: copy "Bramhkanti Storefront" key to the storefront developer.
6. Create staff users (Settings > Users > Invite) instead of sharing one login.

## 11. Razorpay live ⚠ real money

1. Razorpay dashboard → switch to **Live mode** → API Keys → generate.
2. Webhooks (Live mode) → Add `https://api.bramhkanti.com/hooks/payment/razorpay_razorpay`,
   secret = new `openssl rand -hex 32`, events: `payment.authorized`, `payment.captured`,
   `payment.failed`, `order.paid`.
3. Account & Settings → Payment capture → **Automatic**.
4. `apps/backend/.env` **and** `.medusa/server/.env`:
   `RAZORPAY_KEY_ID=rzp_live_...`, `RAZORPAY_KEY_SECRET=...`, `RAZORPAY_WEBHOOK_SECRET=...`
5. `pm2 restart bramhkanti-api`
6. Admin → Settings → Regions → India → payment providers: **add Razorpay, remove "System
   default"** (manual) so nobody can place unpaid orders.
7. Place **one real ₹-small order**, confirm it shows as captured in admin and Razorpay, then
   refund it from admin and check the refund reaches Razorpay.

Full details: [PAYMENTS_SETUP.md](PAYMENTS_SETUP.md). Test everything in test mode on a
staging copy before this step.

## 12. Shiprocket ⚠ real couriers

1. Shiprocket → Settings → API → create **API user** (different email from the main login).
2. Fill `SHIPROCKET_*` in both env files (credentials, pickup location name, pickup pincode,
   box size/weight, webhook token). `pm2 restart bramhkanti-api`.
3. Shiprocket → Settings → API → Webhooks → `https://api.bramhkanti.com/hooks/courier-tracking`,
   token = `SHIPROCKET_WEBHOOK_TOKEN`, enable.
4. Admin: set shipping option provider to **shiprocket**.
5. Keep enough Shiprocket wallet balance (AWB assignment fails without it).
6. First real order: fulfill in admin → check the Shiprocket order + AWB + label → book pickup.

Full details: [SHIPPING_SETUP.md](SHIPPING_SETUP.md).

## 13. Backups (do this before taking orders)

Daily database dump, kept 14 days, copied off the server:

```bash
mkdir -p ~/backups
crontab -e
# 02:30 every day
30 2 * * * docker exec bramhkanti-postgres pg_dump -U bramhkanti -Fc bramhkanti_medusa > ~/backups/medusa-$(date +\%F).dump && find ~/backups -name '*.dump' -mtime +14 -delete
```

Copy `~/backups` off-server (R2 bucket via `rclone`, or Hostinger VPS snapshots). **Test a restore once:**

```bash
docker exec -i bramhkanti-postgres pg_restore -U bramhkanti -d <scratch_db> --clean < ~/backups/medusa-YYYY-MM-DD.dump
```

Product images live in R2, so they're not on the server.

## 14. Monitoring

- Uptime check on `https://api.bramhkanti.com/health` (UptimeRobot / Better Stack, free tier) with alerts to phone/email.
- `pm2 install pm2-logrotate` to stop logs filling the disk.
- Check weekly: `pm2 logs`, `df -h`, `docker compose ps`, and log warnings containing `needs attention` (RTO/undelivered parcels).

## 15. Deploying updates

```bash
cd ~/bramhkanti-backend && git pull && nvm use && npm ci
cd apps/backend && npx medusa db:migrate && npx medusa build
cp .env .medusa/server/.env && cd .medusa/server && npm install --omit=dev
pm2 restart bramhkanti-api && curl -s https://api.bramhkanti.com/health
```

Take a DB dump before any migration.

## 16. Go-live checklist

- [ ] `https://api.bramhkanti.com/health` → OK, valid HTTPS certificate
- [ ] Admin login works; default/verification users removed; strong passwords
- [ ] Production secrets are new, not the development ones
- [ ] Postgres/Redis not reachable from the internet (`nmap` from outside shows only 22/80/443)
- [ ] Images upload to R2 and load over HTTPS
- [ ] Products published with final prices, GST rate set, real stock entered
- [ ] Pickup address + shipping option fees set
- [ ] CORS contains only the real storefront domains
- [ ] Razorpay **live** keys, webhook, India region uses Razorpay only; one real order + refund tested
- [ ] Shiprocket API user, webhook, pickup location; first shipment tested
- [ ] Daily backup running and one restore tested
- [ ] Uptime monitor + alerts on
- [ ] Storefront developer has: API URL, publishable key, STOREFRONT_INTEGRATION.md
- [ ] Order confirmation emails: not built yet. Add a notification provider (e.g. SendGrid/Resend) or tell customers to expect WhatsApp/phone confirmation
- [ ] Policies published on the storefront: shipping, returns/refunds, privacy, terms, FSSAI licence number (food business)
