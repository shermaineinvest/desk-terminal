# DESK — Institutional Terminal v6
## Netlify Deployment with Live CME OI Auto-Fetch

This version adds a Netlify serverless function that fetches CME Open Interest
data server-side, bypassing CORS restrictions. OI data now feeds automatically
into your morning scan analysis.

---

## WHAT'S NEW IN THIS VERSION

- **Auto OI fetch** — CME Open Interest fetched every 15 minutes, no manual input
- **OI flag auto-activation** — Liquidity Trap and OI Expanding flags set automatically
- **OI in Claude prompt** — Live OI data passes directly into the 8-section analysis
- **Generic CORS proxy** — Serverless proxy for any blocked financial API

---

## DEPLOYMENT — STEP BY STEP (iPad friendly)

### Step 1 — Download this folder
Download the entire `desk-netlify` folder as a ZIP.

### Step 2 — Go to app.netlify.com
Open Safari on your iPad and go to: **app.netlify.com**
Sign up for a free account if you don't have one (takes 60 seconds).

### Step 3 — Create a new site from Git OR drag and drop
**Option A (recommended) — GitHub:**
1. Push this folder to a GitHub repo
2. In Netlify: Add new site → Import from Git → Select your repo
3. Build settings: Build command = blank, Publish directory = `public`
4. Deploy site

**Option B — Netlify CLI (on a computer):**
```bash
npm install -g netlify-cli
cd desk-netlify
netlify deploy --prod
```

### Step 4 — Verify functions deployed
Go to your Netlify site → Functions tab.
You should see two functions:
- `cme-oi` — CME Open Interest fetcher
- `proxy` — Generic CORS proxy

### Step 5 — Open your site
Your DESK terminal is now live at `https://your-site-name.netlify.app`
The OI status indicator in the header will show **OI LIVE** when working.

---

## HOW THE OI AUTO-FETCH WORKS

```
iPad Browser (DESK)
       |
       | fetch('/api/cme-oi')   ← same domain, no CORS
       v
Netlify Function (server-side)
       |
       | fetch Barchart API     ← no CORS from server
       | fetch CME direct       ← fallback
       v
Returns OI data as JSON
       |
       v
DESK auto-sets OI flags
DESK passes OI into Claude prompt
```

The key insight: browser → Netlify function is same-domain (no CORS).
Netlify function → CME/Barchart is server-to-server (no CORS).

---

## OI SIGNAL INTERPRETATION

| Signal | Meaning | DESK Action |
|--------|---------|-------------|
| ABOVE_AVERAGE | OI higher than typical | OI Expanding flag auto-set |
| AVERAGE | OI in normal range | No flag change |
| BELOW_AVERAGE + high volume | Classic Liquidity Trap | Liquidity Trap flag auto-set |
| FETCH_FAILED | Data source unavailable | Manual flag still available |

---

## DATA SOURCES (in priority order)

1. **Barchart free API** — futures quotes + OI, most reliable
2. **CME Group direct** — fallback if Barchart fails
3. **Manual flag** — always available as override

---

## FILE STRUCTURE

```
desk-netlify/
├── netlify.toml              # Netlify config — routes /api/* to functions
├── package.json              # node-fetch dependency
├── netlify/
│   └── functions/
│       ├── cme-oi.js         # CME OI fetcher (main)
│       └── proxy.js          # Generic CORS proxy
└── public/
    └── index.html            # DESK terminal (all CSS + JS)
```

---

## TROUBLESHOOTING

**OI status shows "OI MANUAL" not "OI LIVE"**
→ Functions not deployed. Check Netlify Functions tab.
→ Try opening: `https://your-site.netlify.app/api/cme-oi` directly.
→ If you see JSON, functions are working. If 404, redeploy.

**Functions tab shows no functions**
→ Make sure `netlify.toml` is in the root of your repo.
→ Check that `netlify/functions/` folder exists with the .js files.

**OI data shows N/A for some symbols**
→ Barchart contract month codes may need updating (ESM25 → ESZ25 etc).
→ The system still works — Claude gets whatever OI data is available.

---

## API KEY

Your Anthropic API key is saved in your browser's localStorage.
It is never sent to Netlify's servers — only to api.anthropic.com directly.

---

## COST

- Netlify free tier: 125,000 function invocations/month
- DESK calls the OI function every 15 minutes = ~2,880/month
- Well within free tier limits.
