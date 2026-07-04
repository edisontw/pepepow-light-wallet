# Deployment Layout

PEPEW Light Wallet is deployed as static files under:

```text
https://light.pepepow.net/wallet/
```

The backend API belongs to `pepepow-electrumx-service`.

## Production layout

```text
/home/ubuntu/pepepow-light-wallet/        source checkout
/home/ubuntu/pepepow-electrumx-service/   FastAPI gateway checkout
/var/www/pepew-light/wallet/              deployed wallet static files
```

Public routing:

```text
https://light.pepepow.net/          PEPEW Light status / lookup site
https://light.pepepow.net/wallet/   PEPEW Light Wallet static app
https://light.pepepow.net/api/*     FastAPI gateway
```

## Build

```bash
cd /home/ubuntu/pepepow-light-wallet
git pull origin main
export PATH="/home/ubuntu/node-dist/bin:$PATH"
rm -rf apps/web/dist
npm run build
```

The wallet build output is:

```text
apps/web/dist/
```

`apps/web/vite.config.ts` must keep:

```ts
base: "/wallet/"
```

## Deploy static files

```bash
sudo mkdir -p /var/www/pepew-light/wallet
sudo rsync -a --delete apps/web/dist/ /var/www/pepew-light/wallet/
sudo nginx -t
sudo systemctl reload nginx
```

## Nginx path rule

Production uses:

```text
root /var/www/pepew-light
```

So this public path:

```text
/wallet/index.html
```

maps to this file:

```text
/var/www/pepew-light/wallet/index.html
```

## Smoke tests

```bash
curl -I https://light.pepepow.net/wallet/
curl -s https://light.pepepow.net/api/health
curl -s https://light.pepepow.net/api/status
curl -s https://light.pepepow.net/api/wallet/address/PRfbEeHAKKbz6Voz85WJudrJwTA3ZbHunb
```

Browser checks:

- `/wallet/` opens without long blank screen.
- Logo and bundled assets load from `/wallet/assets/...`.
- Import mnemonic flow is local and shows safety warning.
- Balance and history display from PEPEW Light API.
- Send submits only signed raw tx to `/api/wallet/broadcast`.
- Invalid address and API unavailable states show friendly messages.

## Rollback

Because deployment is static, rollback can be as simple as restoring the previous `dist` copy or redeploying a previous Git commit.
