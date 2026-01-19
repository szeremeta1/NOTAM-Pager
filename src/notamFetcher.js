/**
 * NOTAM Fetcher using the FAA NMS (API) instead of headless browsers.
 */
const fetch = require('node-fetch');

const FAA_NMS_API_URL = process.env.FAA_NMS_API_URL || 'https://example.nms.faa.gov/notams';
const FAA_NMS_API_KEY = process.env.FAA_NMS_API_KEY;
const FAA_NMS_API_KEY_HEADER = process.env.FAA_NMS_API_KEY_HEADER || 'x-api-key';
const FAA_NMS_TIMEOUT = parseInt(process.env.FAA_NMS_TIMEOUT || '15000', 10);
const FAA_NMS_MAX_RESULTS = parseInt(process.env.FAA_NMS_MAX_RESULTS || '200', 10);

function getNotamId(notam) {
  const id = notam?.id || notam?.notamId || notam?.notamNumber || notam?.key || notam?.transactionId;
  if (id) return String(id);
  const fallback = `${notam?.location || notam?.icao || notam?.icaoId || ''}_${notam?.startTime || ''}`;
  if (fallback.trim()) return fallback.slice(0, 80);
  return `notam_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatNotam(raw) {
  const location = raw.location || raw.icao || raw.icaoId || raw.designator || 'UNKNOWN';
  const number = raw.notamNumber || raw.id || raw.key || raw.notamId;
  const text = raw.text || raw.message || raw.body || raw.traditionalMessage || raw.notam;
  const start = raw.startTime || raw.start || raw.effectiveFrom;
  const end = raw.endTime || raw.end || raw.effectiveTo;

  const parts = [];
  parts.push(`${location}${number ? ' ' + number : ''}`.trim());
  if (text) parts.push(text);
  if (start) parts.push(`Start: ${start}`);
  if (end) parts.push(`End: ${end}`);

  return {
    id: getNotamId(raw),
    text: parts.filter(Boolean).join(' | '),
    number: number || undefined,
    raw
  };
}

function pickNotamList(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  return data.notams || data.items || data.results || data.data || [];
}

async function fetchNotams(airportCode) {
  const url = new URL(FAA_NMS_API_URL);
  if (!url.searchParams.has('location')) {
    url.searchParams.set('location', airportCode);
  }
  if (!url.searchParams.has('maxResults')) {
    url.searchParams.set('maxResults', FAA_NMS_MAX_RESULTS);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FAA_NMS_TIMEOUT);

  try {
    const headers = {
      Accept: 'application/json'
    };
    if (FAA_NMS_API_KEY) {
      headers[FAA_NMS_API_KEY_HEADER] = FAA_NMS_API_KEY;
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers,
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`FAA NMS API responded with ${response.status}`);
    }

    const data = await response.json();
    const list = pickNotamList(data);

    if (!Array.isArray(list)) {
      console.warn('[notamFetcher] Unexpected NOTAM payload shape');
      return [];
    }

    return list.map(formatNotam).filter(n => n && n.id && n.text);
  } catch (error) {
    clearTimeout(timeout);
    console.error('Error fetching NOTAMs from FAA NMS API:', error.message);
    return [];
  }
}

module.exports = {
  fetchNotams,
  getNotamId,
  formatNotam
};
