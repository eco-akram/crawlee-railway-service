# Google Trends Scraper Service

A Crawlee-based microservice for scraping Google Trends data.

## Deploy to Railway

### Option 1: Deploy via GitHub

1. Create a new GitHub repository
2. Push this folder's contents to the repository
3. In Railway dashboard, click "New Project" → "Deploy from GitHub repo"
4. Select your repository
5. Railway will automatically detect the Dockerfile and deploy

### Option 2: Deploy via Railway CLI

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Deploy
railway up
```

## Environment Variables

Set these in Railway dashboard under "Variables":

- `PORT` - Railway sets this automatically
- `PROXY_URL` (optional) - Bright Data proxy URL

## API Endpoints

### Health Check
```
GET /health
```

### Scrape Google Trends
```
POST /scrape
Content-Type: application/json

{
  "keyword": "artificial intelligence",
  "geo": "US"
}
```

Or via GET:
```
GET /scrape?keyword=artificial+intelligence&geo=US
```

### Response Format
```json
{
  "keyword": "artificial intelligence",
  "geo": "US",
  "relatedQueries": {
    "rising": [
      { "query": "chatgpt", "value": "+5000%" }
    ],
    "top": [
      { "query": "ai", "value": "100" }
    ]
  },
  "relatedTopics": {
    "rising": [],
    "top": []
  },
  "scrapedAt": "2024-01-15T10:30:00.000Z"
}
```

## Integration with Next.js App

After deploying, get your Railway service URL (e.g., `https://your-service.railway.app`).

Add to your Next.js app's `.env.local`:
```
SCRAPER_SERVICE_URL=https://your-service.railway.app
```

Then call from your Next.js API route:
```javascript
const response = await fetch(`${process.env.SCRAPER_SERVICE_URL}/scrape`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ keyword, geo })
});
```
