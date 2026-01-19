/**
 * NOTAM Fetcher using Playwright to download the Excel export and parse it.
 */

const { chromium, firefox, webkit } = require('playwright');
const XLSX = require('xlsx');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const FAA_BASE_URL = process.env.FAA_BASE_URL || 'https://notams.aim.faa.gov/notamSearch';
const USER_AGENT = 'NOTAM-Pager/2.0 (+https://github.com/szeremeta1/NOTAM-Pager)';
const FAA_FETCH_TIMEOUT = parseInt(process.env.FAA_FETCH_TIMEOUT || '30000', 10);
const FAA_RETRIES = parseInt(process.env.FAA_RETRIES || '3', 10);
const FAA_RETRY_DELAY_MS = parseInt(process.env.FAA_RETRY_DELAY_MS || '2000', 10);
const FAA_HEADLESS = process.env.FAA_HEADLESS !== 'false';
const FAA_BROWSER = (process.env.FAA_BROWSER || 'chromium').toLowerCase();

async function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function withRetry(fn, label) {
  let attempt = 0;
  let lastErr;
  while (attempt < FAA_RETRIES) {
    try {
      attempt += 1;
      return await fn();
    } catch (err) {
      lastErr = err;
      console.warn(`[notamFetcher] ${label} attempt ${attempt}/${FAA_RETRIES} failed: ${err.message}`);
      if (attempt >= FAA_RETRIES) break;
      await sleep(FAA_RETRY_DELAY_MS);
    }
  }
  throw lastErr;
}

function getNotamId(notam) {
  const id = notam?.Number || notam?.number || notam?.NOTAM || notam?.transactionId;
  if (id) return String(id);
  const fallback = `${notam?.Condition || ''}_${notam?.Location || ''}_${notam?.Start || ''}`;
  if (fallback.trim()) return fallback.slice(0, 80);
  return `notam_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatNotam(raw) {
  const condition = raw.Condition || raw.Cond || raw.Text || raw.Remarks || 'No message text available';
  const location = raw.Location || raw.Loc || 'UNKNOWN';
  const number = raw.Number || raw.NOTAM || raw.Id;
  const start = raw['Start Date UTC'] || raw.Start || raw.EffectiveFrom;
  const end = raw['End Date UTC'] || raw.End || raw.EffectiveTo;

  const parts = [];
  parts.push(`${location}${number ? ' ' + number : ''}`.trim());
  parts.push(condition);
  if (start) parts.push(`Start: ${start}`);
  if (end) parts.push(`End: ${end}`);

  return {
    id: getNotamId(raw),
    text: parts.join(' | '),
    number: number || undefined,
    raw
  };
}

function parseExcel(filePath) {
  const workbook = XLSX.readFile(filePath);
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) return [];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { defval: '' });
  return rows.map(formatNotam);
}

async function downloadExcel(airportCode) {
  async function attempt(engineName) {
    const browserType = { chromium, firefox, webkit }[engineName] || chromium;
    const browser = await browserType.launch({
      headless: FAA_HEADLESS,
      args: ['--disable-http2', '--disable-features=NetworkService']
    });
    const context = await browser.newContext({
      acceptDownloads: true,
      userAgent: USER_AGENT,
      viewport: { width: 1600, height: 900 },
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    const page = await context.newPage();

    try {
      await page.goto(`${FAA_BASE_URL}/nsapp.html#/`, { waitUntil: 'domcontentloaded', timeout: FAA_FETCH_TIMEOUT });

    // Accept disclaimer if present
    const disclaimerButton = page.locator('text="I\'ve read and understood above statements"');
    if (await disclaimerButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('[notamFetcher] Accepting disclaimer...');
      await disclaimerButton.click({ timeout: 5000 });
    }

    // Wait for search form
    await page.waitForSelector('input[ng-model="globalScope.designatorsForLocation"], input[placeholder="Location(s)"]', { timeout: FAA_FETCH_TIMEOUT });

    const locationInput = page.locator('input[ng-model="globalScope.designatorsForLocation"], input[placeholder="Location(s)"]');
    await locationInput.fill('');
    await locationInput.type(airportCode, { delay: 50 });

    // Click search
    const searchButton = page.locator('button:has-text("Search"), input[type="button"][value="Search"], #searchBtn');
    await searchButton.first().click({ timeout: FAA_FETCH_TIMEOUT });

    // Wait for results count or table
    await page.waitForSelector('text=/NOTAM\(s\) found/i, table', { timeout: FAA_FETCH_TIMEOUT });

    // Click Excel download (desktop toolbar)
    const excelButton = page.locator('button[title="Download to Excel"], a[title="Download to Excel"], .icon-excel').first();
    if (!(await excelButton.isVisible({ timeout: 5000 }).catch(() => false))) {
      throw new Error('Excel download button not found');
    }

      const [ download ] = await Promise.all([
        page.waitForEvent('download', { timeout: FAA_FETCH_TIMEOUT }),
        excelButton.click({ timeout: FAA_FETCH_TIMEOUT })
      ]);

      const tmpPath = path.join(os.tmpdir(), `notam-${airportCode}-${Date.now()}.xlsx`);
      await download.saveAs(tmpPath);
      console.log(`[notamFetcher] Downloaded Excel to ${tmpPath} using ${engineName}`);
      return { tmpPath, engineName };
    } finally {
      await context.close();
      await browser.close();
    }
  }

  try {
    try {
      return await attempt(FAA_BROWSER);
    } catch (err) {
      if (err.message && err.message.includes('ERR_HTTP2_PROTOCOL_ERROR') && FAA_BROWSER !== 'firefox') {
        console.warn('[notamFetcher] HTTP/2 error detected; retrying with firefox...');
        return await attempt('firefox');
      }
      throw err;
    }
  } catch (e) {
    throw e;
  }
}

async function fetchNotams(airportCode) {
  try {
    const result = await withRetry(() => downloadExcel(airportCode), 'downloadExcel');
    const filePath = result.tmpPath;
    const notams = parseExcel(filePath);
    await fs.unlink(filePath).catch(() => {});
    console.log(`[notamFetcher] Parsed ${notams.length} NOTAMs from Excel (engine=${result.engineName})`);
    return notams;
  } catch (error) {
    console.error('Error fetching NOTAMs from FAA via Playwright:', error.message);
    return [];
  }
}

module.exports = {
  fetchNotams,
  getNotamId,
  formatNotam
};
