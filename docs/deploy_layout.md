# Deployment Layout

PEPEW Light Wallet should be deployed as static files. The backend API belongs to `pepepow-electrumx-service`.

## Recommended production layout

```text
/home/ubuntu/pepepow-light-wallet/        source checkout
/home/ubuntu/pepepow-electrumx-service/   FastAPI gateway checkout
/var/www/pepew-light-wallet/              deployed static wallet files
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
git pull
npm install
npm run build
```

The wallet build output is:

```text
apps/web/dist/
```

`apps/web/vite.config.ts` uses:

```ts
base: "/wallet/"
```

This is required for static assets to resolve correctly under `https://light.pepepow.net/wallet/`.

## Deploy static files

Example:

```bash
sudo mkdir -p /var/www/pepew-light-wallet
sudo rsync -a --delete apps/web/dist/ /var/www/pepew-light-wallet/
sudo nginx -t
sudo systemctl reload nginx
```

## Nginx requirements

Nginx should:

- serve `/wallet/` from the static wallet build
- apply SPA fallback for wallet subroutes
- proxy `/api/*` to the local FastAPI gateway
- keep ElectrumX inaccessible from the public internet
- apply static cache headers for built assets
- apply rate limiting for API routes

Shape:

```nginx
location /wallet/ {
    alias /var/www/pepew-light-wallet/;
    try_files $uri $uri/ /wallet/index.html;
}

location /api/ {
    proxy_pass http://127.0.0.1:8088/api/;
}
```

Adjust the final production config to match the existing `pepepow-electrumx-service/deploy/nginx` configuration.

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
- Invalid address and API unavailable states show friendly messages.

## Rollback

Because deployment is static, rollback can be as simple as restoring the previous `dist` copy or redeploying a previous Git commit.

Do not rollback the wallet by changing backend API behavior unless the wallet/API contract changed.
