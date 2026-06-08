#!/usr/bin/env bash
# One-time VPS setup for Hostinger (Ubuntu/Debian). Run as root on the server.
set -euo pipefail

APP_DIR="/var/www/lawyer-ai-backend"
REPO_URL="${REPO_URL:-https://github.com/MuhammadTahaSheikh/lawyer_ai_backend.git}"

echo "==> Installing system packages..."
apt-get update
apt-get install -y curl git nginx ufw

echo "==> Installing Node.js 20..."
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "==> Installing PM2..."
npm install -g pm2

echo "==> Cloning/updating app..."
mkdir -p "$(dirname "$APP_DIR")"
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR" && git pull origin main
else
  git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

echo "==> Installing dependencies..."
npm ci --omit=dev 2>/dev/null || npm install --omit=dev

echo "==> Creating upload directories..."
mkdir -p case-documents case-media case-eSignTemplate case_templates logs
chown -R www-data:www-data case-documents case-media case-eSignTemplate case_templates logs 2>/dev/null || true

if [ ! -f .env ]; then
  echo ""
  echo "!! Copy your .env to $APP_DIR/.env before starting the app."
  echo "   scp .env root@YOUR_VPS_IP:$APP_DIR/.env"
  echo ""
fi

echo "==> Starting app with PM2..."
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root

echo "==> Firewall (allow SSH, HTTP, HTTPS, API port)..."
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3001/tcp
ufw --force enable

echo ""
echo "Done. Next steps:"
echo "  1. Upload .env to $APP_DIR/.env"
echo "  2. Copy deploy/nginx-api.conf to /etc/nginx/sites-available/lawyer-ai-api"
echo "  3. ln -s /etc/nginx/sites-available/lawyer-ai-api /etc/nginx/sites-enabled/"
echo "  4. nginx -t && systemctl reload nginx"
echo "  5. (Optional) certbot --nginx -d api.yourdomain.com"
