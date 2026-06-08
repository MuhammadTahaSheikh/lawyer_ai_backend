# Deploy Lawyer AI Backend to Hostinger VPS

Current production: `13.61.33.210:3001` (AWS)  
New VPS: `187.124.52.234`

## Prerequisites

- SSH access: `ssh root@187.124.52.234`
- Your backend `.env` (copy from current server or local)
- DNS A record pointing to `187.124.52.234` (optional but recommended for HTTPS)

## Step 1 — One-time server setup

On your **local machine**, copy the setup script to the VPS and run it:

```bash
scp laywer-ai-backend/cms-backend-dev/deploy/hostinger-setup.sh root@187.124.52.234:/root/
ssh root@187.124.52.234 "chmod +x /root/hostinger-setup.sh && /root/hostinger-setup.sh"
```

## Step 2 — Upload environment and files

```bash
# From laywer-ai-backend/cms-backend-dev/
scp .env root@187.124.52.234:/var/www/lawyer-ai-backend/.env

# If you have existing uploads on the old server, sync them:
# rsync -avz root@13.61.33.210:/path/to/case-documents/ root@187.124.52.234:/var/www/lawyer-ai-backend/case-documents/
# rsync -avz root@13.61.33.210:/path/to/case-media/ root@187.124.52.234:/var/www/lawyer-ai-backend/case-media/
```

Update these values in `.env` on the new server:

```env
PORT=3001
PUBLIC_API_BASE_URL=http://187.124.52.234:3001
# Or after nginx + SSL:
# PUBLIC_API_BASE_URL=https://api.yourdomain.com
```

Restart after `.env` changes:

```bash
ssh root@187.124.52.234 "cd /var/www/lawyer-ai-backend && pm2 restart lawyer-ai-api"
```

## Step 3 — Nginx reverse proxy (recommended)

```bash
scp laywer-ai-backend/cms-backend-dev/deploy/nginx-api.conf root@187.124.52.234:/etc/nginx/sites-available/lawyer-ai-api
ssh root@187.124.52.234 "ln -sf /etc/nginx/sites-available/lawyer-ai-api /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx"
```

For HTTPS:

```bash
ssh root@187.124.52.234 "apt-get install -y certbot python3-certbot-nginx && certbot --nginx -d api.yourdomain.com"
```

## Step 4 — Verify API

```bash
curl http://187.124.52.234:3001/api/endpoints
# Or through nginx:
curl http://187.124.52.234/api/endpoints
```

## Step 5 — Point frontend to new backend

### Vercel (`laywer-ai/vercel.json`)

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "http://187.124.52.234:3001/:path*" }
  ]
}
```

### Vercel environment variables

- `REACT_APP_BASE_URL` → `http://187.124.52.234:3001` (or `https://api.yourdomain.com`)

Redeploy the frontend on Vercel after changing env vars.

## Step 6 — Cutover checklist

- [ ] API responds on new VPS
- [ ] Login / auth works (Supabase)
- [ ] File uploads & downloads work (`case-documents`, `case-media`)
- [ ] Socket.IO real-time updates work
- [ ] WOPI / OnlyOffice document editing works (update `PUBLIC_API_BASE_URL`, `DOCUMENT_SERVER_ORIGIN`)
- [ ] Twilio / Telnyx webhooks updated to new URL
- [ ] Vercel redeployed with new `REACT_APP_BASE_URL`
- [ ] Old AWS server stopped after 24–48h soak test

## Useful PM2 commands

```bash
pm2 status
pm2 logs lawyer-ai-api
pm2 restart lawyer-ai-api
pm2 monit
```

## Updating code later

```bash
ssh root@187.124.52.234 "cd /var/www/lawyer-ai-backend && git pull && npm install --omit=dev && pm2 restart lawyer-ai-api"
```
