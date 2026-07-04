# Deploy PEPEW Light Wallet

Production wallet URL:

```text
https://light.pepepow.net/wallet/
```

Deploy target:

```text
/var/www/pepew-light/wallet/
```

Build and deploy:

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

Nginx routing note:

```text
/wallet/index.html -> /var/www/pepew-light/wallet/index.html
```

Verify:

```bash
grep -R "Disabled in Beta" /var/www/pepew-light/wallet/ || true
grep -R "Send PEPEW" /var/www/pepew-light/wallet/assets/ | head
sudo nginx -T | grep -nE "pepew-light|/wallet|root|alias" | head -80
```

Notes:

- `/wallet/` is a Vite/React static build.
- Wallet-only static updates do not require restarting FastAPI.
- Reload Nginx after syncing the static files.
- Keep the Vite/React app basename as `/wallet`.
