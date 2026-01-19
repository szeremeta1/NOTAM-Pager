/**
 * NOTAM Fetcher
 * Fetches NOTAMs from the DTN Aviation NOTAM API
 */

const fetch = require('node-fetch');

const DTN_TOKEN_URL = process.env.DTN_TOKEN_URL || 'https://api.auth.dtn.com/v1/tokens/authorize';
const DTN_CLIENT_ID = process.env.DTN_CLIENT_ID;
const DTN_CLIENT_SECRET = process.env.DTN_CLIENT_SECRET;
const DTN_AUDIENCE = process.env.DTN_AUDIENCE || 'https://aviation.api.dtn.com';
const DTN_API_BASE = process.env.DTN_API_BASE || 'https://aviation.api.dtn.com';
const DTN_LIMIT = parseInt(process.env.DTN_LIMIT, 10) || 1000; // API default 1000

// Cache the access token to avoid requesting on every poll
let tokenCache = {
  accessToken: null,
  expiresAt: 0
};

// Request a DTN access token using client credentials
async function getAccessToken() {
  if (!DTN_CLIENT_ID || !DTN_CLIENT_SECRET) {
    throw new Error('DTN_CLIENT_ID and DTN_CLIENT_SECRET must be set in the environment');
  }

  const now = Date.now();
  if (tokenCache.accessToken && now < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  const res = await fetch(DTN_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: DTN_CLIENT_ID,
      client_secret: DTN_CLIENT_SECRET,
      audience: DTN_AUDIENCE
    })
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`DTN auth failed (${res.status}): ${errorBody.slice(0, 300)}`);
  }

  const json = await res.json();
  const accessToken = json.data?.access_token;
  const expiresIn = json.data?.expires_in || 60;

  if (!accessToken) {
    throw new Error('DTN auth response missing access_token');
  }

  // Refresh slightly early to be safe
  tokenCache = {
    accessToken,
    expiresAt: now + (expiresIn - 10) * 1000
  };

  return accessToken;
}

/**
 * Fetch NOTAMs for a specific airport from DTN
 * @param {string} airportCode - Airport ICAO code (e.g., KBLM)
 * @returns {Promise<Array>} - Array of NOTAM objects
 */
async function fetchNotams(airportCode) {
  try {
    const token = await getAccessToken();
    const url = `${DTN_API_BASE}/v1/notams/?stationId=${encodeURIComponent(airportCode)}&limit=${DTN_LIMIT}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'NOTAM-Pager/1.0'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`DTN NOTAM API returned ${response.status}: ${errorText.slice(0, 300)}`);
      return [];
    }

    const data = await response.json();
    const notams = data.notams || data.data || [];
    return Array.isArray(notams) ? notams : [];
  } catch (error) {
    console.error('Error fetching NOTAMs:', error.message);
    return [];
  }
}

/**
 * Extract a unique identifier from a NOTAM
 * @param {Object} notam - NOTAM object
 * @returns {string} - Unique identifier
 */
function getNotamId(notam) {
  const id = notam.notamId ||
             notam.id ||
             notam.notamNumber ||
             notam.number ||
             notam.notamID ||
             notam.icaoId;

  if (id) return String(id);

  const fallbackId = `${notam.raw_text || notam.message || notam.text || ''}_${notam.issueDateTime || ''}_${notam.stationId || ''}`;
  return fallbackId || `notam_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Format NOTAM data for consistent handling
 * @param {Object} rawNotam - Raw NOTAM from API
 * @returns {Object} - Formatted NOTAM object
 */
function formatNotam(rawNotam) {
  return {
    id: getNotamId(rawNotam),
    text: rawNotam.raw_text ||
          rawNotam.traditionalMessage ||
          rawNotam.message ||
          rawNotam.text ||
          rawNotam.icaoMessage ||
          'No message text available',
    number: rawNotam.notamId || rawNotam.notamNumber || rawNotam.number || rawNotam.id,
    raw: rawNotam
  };
}

module.exports = {
  fetchNotams,
  getNotamId,
  formatNotam
};
