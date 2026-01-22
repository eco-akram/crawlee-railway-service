const express = require('express');
const cors = require('cors');
const { PlaywrightCrawler, Dataset } = require('crawlee');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'trends-scraper' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Main scraping endpoint
app.post('/scrape', async (req, res) => {
  const { keyword, geo = 'US' } = req.body;

  if (!keyword) {
    return res.status(400).json({ error: 'Missing required parameter: keyword' });
  }

  console.log(`Starting scrape for keyword: "${keyword}", geo: "${geo}"`);

  try {
    const result = await scrapeTrends(keyword, geo);
    res.json(result);
  } catch (error) {
    console.error('Scrape error:', error);
    res.status(500).json({
      error: error.message || 'Failed to scrape trends data',
      keyword,
      geo
    });
  }
});

// GET endpoint for simpler testing
app.get('/scrape', async (req, res) => {
  const keyword = req.query.keyword || req.query.q;
  const geo = req.query.geo || 'US';

  if (!keyword) {
    return res.status(400).json({ error: 'Missing required parameter: keyword or q' });
  }

  console.log(`Starting scrape for keyword: "${keyword}", geo: "${geo}"`);

  try {
    const result = await scrapeTrends(keyword, geo);
    res.json(result);
  } catch (error) {
    console.error('Scrape error:', error);
    res.status(500).json({
      error: error.message || 'Failed to scrape trends data',
      keyword,
      geo
    });
  }
});

async function scrapeTrends(keyword, geo) {
  const encodedKeyword = encodeURIComponent(keyword);
  const geoParam = geo === 'Worldwide' || geo === '' ? '' : `&geo=${geo}`;
  const url = `https://trends.google.com/trends/explore?q=${encodedKeyword}&date=today%2012-m${geoParam}`;

  let scrapedData = {
    keyword,
    geo,
    relatedQueries: { rising: [], top: [] },
    relatedTopics: { rising: [], top: [] },
    scrapedAt: new Date().toISOString()
  };

  const crawler = new PlaywrightCrawler({
    headless: true,
    maxRequestsPerCrawl: 1,
    requestHandlerTimeoutSecs: 120,
    navigationTimeoutSecs: 60,

    launchContext: {
      launchOptions: {
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-infobars',
          '--disable-extensions',
          '--disable-gpu',
          '--disable-dev-shm-usage',
        ],
      },
    },

    async requestHandler({ page, request, log }) {
      log.info(`Processing ${request.url}`);

      // Set stealth properties
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', {
          get: () => [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
            { name: 'Native Client', filename: 'internal-nacl-plugin' },
          ],
        });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        window.chrome = { runtime: {} };
      });

      // Navigate to page
      await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 60000 });

      // Wait for network to settle
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {
        log.warning('Network idle timeout, continuing...');
      });

      // Check for rate limiting
      const pageContent = await page.content();
      if (pageContent.includes('429') && pageContent.includes('Too many requests')) {
        throw new Error('Rate limited (429). Google is blocking requests.');
      }

      // Random delay to appear more human
      await page.waitForTimeout(Math.random() * 3000 + 2000);

      // Handle cookie consent
      const consentSelectors = [
        'button[aria-label="Accept all"]',
        'button[aria-label="Accept"]',
        '[aria-label="Accept all"]',
        'button:has-text("Accept all")',
        'button:has-text("I agree")',
      ];

      for (const selector of consentSelectors) {
        try {
          const button = await page.$(selector);
          if (button) {
            await button.click();
            await page.waitForTimeout(1500);
            break;
          }
        } catch (e) {
          // Ignore consent errors
        }
      }

      // Wait for content
      await page.waitForTimeout(3000);

      try {
        await page.waitForSelector('div[class*="related"], table, [data-token]', { timeout: 15000 });
      } catch {
        log.warning('Content selectors not found, extracting anyway...');
      }

      // Extract data
      const data = await page.evaluate((kw) => {
        const result = {
          relatedQueries: { rising: [], top: [] },
          relatedTopics: { rising: [], top: [] },
        };

        const getText = (el) => el?.textContent?.trim() || '';
        const seenQueries = new Set();

        // Find links to other trends pages
        const allLinks = document.querySelectorAll('a[href*="/trends/explore"]');
        allLinks.forEach((link) => {
          const text = getText(link);
          if (text && text.length > 0 && text.length < 100 && text !== kw && !seenQueries.has(text)) {
            seenQueries.add(text);
            const parent = link.closest('tr, div[class*="item"], li');
            const allText = parent?.textContent || '';
            const valueMatch = allText.match(/(\+?\d{1,3},?\d*%|Breakout|\d{1,3})/);
            const value = valueMatch ? valueMatch[1] : '';
            const isRising = value.includes('+') || value === 'Breakout' || allText.toLowerCase().includes('rising');

            if (isRising) {
              result.relatedQueries.rising.push({ query: text, value });
            } else {
              result.relatedQueries.top.push({ query: text, value });
            }
          }
        });

        // Table rows
        const tables = document.querySelectorAll('table');
        tables.forEach((table) => {
          const sectionHeader = table.closest('div[class*="widget"]')?.querySelector('h2, h3, [class*="title"]');
          const sectionText = getText(sectionHeader).toLowerCase();
          const isRisingSection = sectionText.includes('rising');

          const rows = table.querySelectorAll('tbody tr');
          rows.forEach((row) => {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 1) {
              const link = cells[0].querySelector('a');
              const query = getText(link) || getText(cells[0]);

              if (query && query.length > 0 && query.length < 100 && query !== kw && !seenQueries.has(query)) {
                seenQueries.add(query);
                let value = '';
                if (cells.length >= 2) {
                  value = getText(cells[1]);
                }
                const isRising = isRisingSection || value.includes('+') || value === 'Breakout';

                if (isRising) {
                  result.relatedQueries.rising.push({ query, value });
                } else {
                  result.relatedQueries.top.push({ query, value });
                }
              }
            }
          });
        });

        return result;
      }, keyword);

      scrapedData.relatedQueries = data.relatedQueries;
      scrapedData.relatedTopics = data.relatedTopics;

      log.info(`Scraped ${data.relatedQueries.rising.length} rising and ${data.relatedQueries.top.length} top queries`);
    },

    failedRequestHandler({ request, log }) {
      log.error(`Request ${request.url} failed`);
    },
  });

  await crawler.run([url]);

  return scrapedData;
}

app.listen(PORT, () => {
  console.log(`Trends scraper service running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Scrape endpoint: POST http://localhost:${PORT}/scrape`);
});
