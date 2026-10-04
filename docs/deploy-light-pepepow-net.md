# Deploy PEPEW Light Wallet

Production wallet URL:

```text
https://light.pepepow.net/wallet/
```

Production source checkout:

```text
/home/ubuntu/pepepow-light-wallet
```

Static deploy target:

```text
/var/www/pepew-light/wallet/
```

The wallet is a static Vite/React application. A wallet-only deploy does **not** require restarting PEPEW Light API, ElectrumX, or PEPEPOWd.

## 1. Preflight

```bash
cd /home/ubuntu/pepepow-light-wallet

git status --short
git pull --ff-only origin main

export PATH="/home/ubuntu/node-dist/bin:$PATH"

node --version
npm --version
```

If `git status --short` shows unexpected local changes, stop and review them before pulling or deploying.

## 2. Install reproducible dependencies

```bash
npm ci
npm --prefix packages/wallet-core ci
npm --prefix apps/web ci
```

## 3. Test and build

```bash
npm run test:uint64
npm run test:client
npm run test:amount
npm run build
npm run scan:readonly-api
```

The build output must be:

```text
apps/web/dist/
```

The wallet is served under `/wallet/`, so Vite must keep:

```ts
base: '/wallet/'
```

## 4. Back up current static wallet

Keep one simple rollback copy before replacing production files:

```bash
sudo mkdir -p \
  /var/www/pepew-light/wallet \
  /var/www/pepew-light/wallet.previous

sudo rsync -a --delete \
  /var/www/pepew-light/wallet/ \
  /var/www/pepew-light/wallet.previous/
```

## 5. Publish

```bash
sudo rsync -a --delete \
  apps/web/dist/ \
  /var/www/pepew-light/wallet/

sudo nginx -t
sudo systemctl reload nginx
```

Do not reboot the host for a wallet-only deploy.

## 6. Verify production

```bash
curl -I https://light.pepepow.net/wallet/
curl -I https://light.pepepow.net/wallet/send

curl -fsS https://light.pepepow.net/api/health
curl -fsS https://light.pepepow.net/api/status

curl -fsS https://light.pepepow.net/api/price | jq
curl -fsS https://light.pepepow.net/api/market | jq
curl -fsS https://light.pepepow.net/api/network | jq
```

Browser acceptance:

1. Open `https://light.pepepow.net/wallet/`.
2. Confirm the Public Beta text says sending is enabled.
3. Confirm the non-custodial warning is visible.
4. Confirm balance/history load.
5. Open Send and verify a small signed transaction can be broadcast.
6. Confirm no mnemonic/private key appears in Network requests or server-bound payloads.

Nginx routing note:

```text
/wallet/index.html -> /var/www/pepew-light/wallet/index.html
```

Useful routing check:

```bash
sudo nginx -T | grep -nE "pepew-light|/wallet|root|alias" | head -80
```

## Rollback

If the new static wallet has a regression:

```bash
sudo rsync -a --delete \
  /var/www/pepew-light/wallet.previous/ \
  /var/www/pepew-light/wallet/

sudo nginx -t
sudo systemctl reload nginx
```

Then re-run:

```bash
curl -I https://light.pepepow.net/wallet/
```

## Backend boundary

Wallet frontend source of truth:

```text
edisontw/pepepow-light-wallet
```

PEPEW Light API backend source of truth:

```text
edisontw/pepepow-electrumx-service
```

Deploy backend changes separately using that repository's deployment procedure. Do not copy backend/API code into this wallet repository.
