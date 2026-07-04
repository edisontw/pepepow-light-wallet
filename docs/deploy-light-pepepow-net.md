# Deploy PEPEW Light Wallet

Production wallet URL:

```text
https://light.pepepow.net/wallet/
```

## Correct deploy target

The wallet static build must be deployed to:

```text
/var/www/pepew-light/wallet/
```

Do not use this old path for the active production wallet unless Nginx is changed:

```text
/var/www/pepepow-light-wallet/
```

## Reason

Current production Nginx routing uses `/wallet/` under this root:

```text
root /var/www/pepew-light;
```

Therefore `/wallet/index.html` maps to:

```text
/var/www/pepew-light/wallet/index.html
```

## Standard deploy steps

```bash
cd /home/ubuntu/pepepow-light-wallet
git pull origin main

export PATH="/home/ubuntu/node-dist/bin:$PATH"

rm -rf apps/web/dist
npm run build

sudo mkdir -p /var/www/pepew-light/wallet
sudo rsync -a --delete apps/web/dist/ /var/www/pepew-light/wallet/

sudo nginx -t
sudo systemctl reload nginx
```

## Verify

```bash
grep -R "Disabled in Beta" /var/www/pepew-light/wallet/ || true
grep -R "Send PEPEW" /var/www/pepew-light/wallet/assets/ | head
sudo nginx -T | grep -nE "pepew-light|/wallet|root|alias" | head -80
```

If the browser still shows stale content, test with:

```text
https://light.pepepow.net/wallet/send?v=<commit-sha>
```

## Notes

- `/wallet/` is a Vite/React static build.
- Wallet-only static updates do not require restarting FastAPI.
- Reload Nginx after syncing the static files.
- Keep the Vite/React app basename as `/wallet`.
