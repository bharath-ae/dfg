# Production Deployment Guide

## Cloudflare Pages Deployment

### 1. Prerequisites
- Node.js 18+  
- Cloudflare Account
- Git repository (GitHub, GitLab, etc.)
- Wrangler CLI installed globally: `npm install -g wrangler`

### 2. Project Structure
```
drivepro/
├── public/
│   ├── index.html              # Main application
│   ├── admin.js                # Admin module
│   ├── instructor.js           # Instructor module
│   ├── owner.js                # Owner module
│   └── firebase-messaging-sw.js # Service Worker
├── package.json                # Dependencies
├── wrangler.toml              # Cloudflare configuration
├── .gitignore                 # Git exclusions
├── _headers                   # Security headers
├── _redirects                 # Route handling
└── README.md
```

### 3. Setup Steps

#### Step 1: Install Dependencies
```bash
npm install
```

#### Step 2: Configure Environment
```bash
cp .env.example .env.production
```

Edit `.env.production` and add your Firebase credentials.

#### Step 3: Local Testing
```bash
npm run dev
# Visit http://localhost:8788
```

#### Step 4: Deploy to Cloudflare Pages

**Option A: Direct Cloudflare CLI**
```bash
wrangler pages deploy public
```

**Option B: GitHub Integration (Recommended)**
1. Push code to GitHub
2. Go to Cloudflare Dashboard → Pages
3. Click "Create a project"
4. Select your repository
5. Configure build settings:
   - Build command: (leave empty)
   - Build output directory: `public`
   - Root directory: `.` (or leave empty)
6. Deploy

### 4. Production Optimizations

#### Security Headers
The `_headers` file includes:
- X-Frame-Options (prevents clickjacking)
- X-Content-Type-Options (prevents MIME type sniffing)
- Content-Security-Policy (controls resource loading)
- Referrer-Policy (privacy)

#### URL Routing
The `_redirects` file handles:
- SPA routing (all routes → index.html)
- HTTPS enforcement
- Service Worker caching

#### Performance
- CSS/JS cached for 1 week (hash-based versioning recommended)
- HTML never cached (pulls latest on each visit)
- Service Worker revalidated on every request

### 5. Firebase Configuration

**Important:** Firebase credentials are embedded in `index.html`. To use environment variables:

In `index.html`, replace:
```javascript
const firebaseConfig = { ... };
```

With environment-based loading:
```javascript
const firebaseConfig = {
  apiKey: window.ENV.FIREBASE_API_KEY,
  projectId: window.ENV.FIREBASE_PROJECT_ID,
  // ... other config
};
```

Then inject via Wrangler environment secrets:
```bash
wrangler secret put FIREBASE_API_KEY
```

### 6. Service Worker Registration

The Service Worker (`firebase-messaging-sw.js`) handles:
- Background push notifications
- Offline fallback (optional)

Make sure it's registered in `index.html`:
```javascript
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/firebase-messaging-sw.js');
}
```

### 7. Monitoring & Logs

View deployment logs:
```bash
wrangler pages deployment list
wrangler pages deployment tail
```

### 8. Custom Domain

1. Go to Cloudflare Dashboard
2. Select your Pages project
3. Settings → Custom domain
4. Add your domain
5. Configure DNS records

### 9. Functions (Optional)

If you need backend functionality:

Create `functions/api.js`:
```javascript
export async function onRequest(context) {
  return new Response("Hello, DrivePro!");
}
```

Deploy with functions:
```bash
wrangler pages deploy public --project-name=drivepro
```

### 10. Rollback

View all deployments:
```bash
wrangler pages deployment list
```

Rollback to previous:
```bash
wrangler pages deployment rollback
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Firebase SDK not loading | Check CDN links in index.html, verify CORS settings |
| Service Worker fails | Ensure file is at root, check browser console |
| CORS errors | Add allowed origins in Firebase Console → Authentication |
| Routing issues | Verify `_redirects` file syntax |
| CSS/JS not updating | Clear browser cache, check Cache-Control headers |

## Security Best Practices

✅ Never commit `.env.production` to git
✅ Use Cloudflare environment secrets for sensitive data
✅ Enable DDoS protection (built-in with Cloudflare)
✅ Set Content-Security-Policy headers
✅ Use HTTPS everywhere
✅ Regularly update Firebase SDK
✅ Enable Firebase Authentication security rules
