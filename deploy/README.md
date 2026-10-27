# Deploy on a VPS with Docker

One server runs everything in Docker:

| Container | What it is | Public address |
|---|---|---|
| `caddy` | HTTPS (free Let's Encrypt certificates), reverse proxy | ports 80 / 443 |
| `storefront` | Next.js shop | `https://SHOP_DOMAIN` |
| `medusa` | API, admin dashboard (`/app`), uploaded images (`/static`) | `https://API_DOMAIN` |
| `postgres` | Database (private) | none |
| `redis` | Cache, events, workflows (private) | none |

Sized for 2 vCPU / 4 GB RAM (works better with 8 GB). Ubuntu 24.04.

Files in this folder: `docker-compose.yml`, `Caddyfile`, `.env.example`, `backup.sh`,
`backend-entrypoint.sh` (runs database migrations on every start).

---

## 0. Before you start

- Server IP, SSH access as root (your SSH key added in the Bluehost panel).
- Your domain and access to its DNS (registrar or Cloudflare).
- Decide the two names, e.g. shop `bramhkanti.com`, API `api.bramhkanti.com`.

## 1. DNS

Add these records, all pointing at the server IP:

| Type | Name | Value |
|---|---|---|
| A | `@` (bramhkanti.com) | SERVER_IP |
| A | `www` | SERVER_IP |
| A | `api` | SERVER_IP |

On Cloudflare keep them **DNS only (grey cloud)** until step 9 works. Afterwards you may turn
the proxy on with SSL mode **Full (strict)**.

Check from your Mac: `dig +short bramhkanti.com api.bramhkanti.com` must print the server IP.

## 2. Prepare the server (once)

```bash
ssh root@SERVER_IP

apt update && apt -y upgrade
apt -y install git ufw fail2ban unattended-upgrades

# Firewall: only SSH and web
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# 4 GB swap: needed while the storefront image builds
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Docker (official script)
curl -fsSL https://get.docker.com | sh
docker compose version

# Key-only SSH login (do this only after `ssh root@SERVER_IP` works with your key)
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh
```

## 3. Get the code

Both repos go side by side under `/opt/bramhkanti`:

```bash
mkdir -p /opt/bramhkanti && cd /opt/bramhkanti
git clone https://github.com/bramhkanti/backend.git backend
git clone https://github.com/bramhkanti/storefront.git storefront
```

The repos are private: when git asks for a password, paste a GitHub
**fine-grained personal access token** with read-only "Contents" access to these two repos
(GitHub -> Settings -> Developer settings -> Personal access tokens).

## 4. Settings

```bash
cd /opt/bramhkanti/backend/deploy
cp .env.example .env
chmod 600 .env

# Generate the secrets and paste each into .env
for v in POSTGRES_PASSWORD JWT_SECRET COOKIE_SECRET OTP_HASH_SECRET REVALIDATE_SECRET; do
  echo "$v=$(openssl rand -hex 32)"
done

nano .env
```

Fill in at least: `SHOP_DOMAIN`, `API_DOMAIN`, `ACME_EMAIL`, the five secrets above,
`NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_WHATSAPP_NUMBER`, `NEXT_PUBLIC_FSSAI_LICENSE_NUMBER`.
Leave `MEDUSA_PUBLISHABLE_KEY` empty for now (step 6).

Keep a copy of `.env` in your password manager. Without `POSTGRES_PASSWORD` and the secrets you
cannot restore backups or keep logins working.

## 5. Start the backend

```bash
cd /opt/bramhkanti/backend/deploy
docker compose up -d --build postgres redis medusa
docker compose logs -f medusa        # wait for "Server is ready on port: 9000", then Ctrl+C
curl -s http://127.0.0.1:9000/health # prints OK
```

The first start creates the database tables plus the India / INR region, sales channel,
publishable API key, stock location and delivery zone.

## 6. Admin user and publishable key

```bash
# Admin login for https://API_DOMAIN/app  (use a strong password)
docker compose exec medusa npx medusa user -e you@example.com -p 'A-Strong-Password'

# Publishable key for the storefront
docker compose exec postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select token from api_key where type='"'"'publishable'"'"' and revoked_at is null"'
```

Put the `pk_...` value into `.env` as `MEDUSA_PUBLISHABLE_KEY=`.

## 7. Catalog data (pick one)

**A. Sample catalog** (8 sample products, categories, collections, delivery ₹49 / ₹99;
prices and stock are placeholders, marked `sample_data` in the admin):

```bash
docker compose exec -e SAMPLE_IMAGE_BASE_URL=https://SHOP_DOMAIN/images/home \
  medusa npx medusa exec ./src/scripts/seed-sample-catalog.js
```

**B. Empty store:** add products, categories, collections and delivery options in the admin.

**C. Move an existing database** (e.g. from Render): `pg_dump -Fc` the old database, copy the
file to the server, then before step 5's first start, or into an empty database:
`docker compose exec -T postgres pg_restore -U bramhkanti -d bramhkanti_medusa --clean --if-exists < old.dump`.
Product images uploaded to the old server must be uploaded again.

## 8. Build and start the storefront and HTTPS

The storefront build reads the catalog from Medusa, so Medusa must be running (step 5).

```bash
cd /opt/bramhkanti/backend/deploy
# The build reads the catalog from Medusa over the host network. Newer Docker
# requires an explicit permission for that, which `docker compose build` can't pass,
# so export the build plan and run it with buildx:
docker compose build --print storefront > /tmp/storefront-bake.json   # "No services to build" warning is harmless
docker buildx bake -f /tmp/storefront-bake.json --allow=network.host --load storefront   # 3-6 minutes
rm /tmp/storefront-bake.json
docker compose up -d
docker compose ps                    # all "running", medusa and storefront "healthy"
docker compose logs -f caddy         # look for "certificate obtained successfully"
```

## 9. Check it works

- `https://SHOP_DOMAIN` loads, with products and images.
- `https://API_DOMAIN/health` prints `OK`.
- `https://API_DOMAIN/app` admin login works.
- Shop: add to bag -> log in with OTP -> checkout -> cash on delivery -> order appears in the
  admin. While `OTP_TEST_MODE=true`, the code is `OTP_TEST_CODE` (no SMS is sent).
- Upload a product image in the admin; its URL must start with `https://API_DOMAIN/static/`.

## 10. Backups (before taking real orders)

```bash
chmod +x /opt/bramhkanti/backend/deploy/backup.sh
/opt/bramhkanti/backend/deploy/backup.sh       # test once
crontab -e
# add:  30 2 * * * /opt/bramhkanti/backend/deploy/backup.sh >> /var/log/bramhkanti-backup.log 2>&1
```

Backups land in `/opt/bramhkanti/backups` (14 days). Copy them **off the server** as well
(Cloudflare R2, Google Drive with rclone, or your Mac via `scp`), otherwise a lost server means
lost orders.

Restore the database:

```bash
docker compose exec -T postgres pg_restore -U bramhkanti -d bramhkanti_medusa --clean --if-exists \
  < /opt/bramhkanti/backups/db_YYYY-MM-DD_HHMM.dump
```

## 11. Deploy updates

```bash
cd /opt/bramhkanti/backend && git pull
cd /opt/bramhkanti/storefront && git pull
cd /opt/bramhkanti/backend/deploy

docker compose up -d --build medusa      # migrations run automatically on start
docker compose build --print storefront > /tmp/storefront-bake.json
docker buildx bake -f /tmp/storefront-bake.json --allow=network.host --load storefront
rm /tmp/storefront-bake.json && docker compose up -d storefront
docker image prune -f                    # remove old images
```

A storefront rebuild is also needed after changing any `NEXT_PUBLIC_*` value or
`MEDUSA_PUBLISHABLE_KEY` (they are built into the image).

## 12. Before real customers (go-live checklist)

- [ ] SMS: `SMS_PROVIDER=msg91`, `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`, **`OTP_TEST_MODE=false`**,
      then `docker compose up -d medusa`. Send one OTP to your own phone.
      While test mode is on, anyone can log in to any number with the test code.
- [ ] Real prices, stock and delivery fees (search the admin for `sample_data`).
- [ ] Remove or replace placeholder reviews on the home page.
- [ ] Razorpay (PAYMENTS_SETUP.md) if you take online payments; COD works without it.
- [ ] Strong admin password; remove test admin users and test customers.
- [ ] Backups running and copied off the server.

## Useful commands

```bash
docker compose ps                         # status
docker compose logs -f medusa             # logs (also: storefront, caddy, postgres)
docker compose restart storefront         # restart one service
docker stats                              # memory / CPU per container
docker compose exec postgres psql -U bramhkanti bramhkanti_medusa   # SQL shell
```
