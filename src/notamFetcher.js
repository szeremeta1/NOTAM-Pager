/**
 * NOTAM Fetcher (FAA public NOTAM Search)
 * Uses the public endpoints seen in the HAR capture.
 */

const fetch = require('node-fetch');
const fetchCookie = require('fetch-cookie').default;
const { CookieJar } = require('tough-cookie');

const FAA_BASE_URL = process.env.FAA_BASE_URL || 'https://notams.aim.faa.gov/notamSearch';
const USER_AGENT = 'NOTAM-Pager/2.0 (+https://github.com/szeremeta1/NOTAM-Pager)';
const FAA_FETCH_TIMEOUT = parseInt(process.env.FAA_FETCH_TIMEOUT || '15000', 10);
const FAA_RETRIES = parseInt(process.env.FAA_RETRIES || '3', 10);
const FAA_RETRY_DELAY_MS = parseInt(process.env.FAA_RETRY_DELAY_MS || '2000', 10);

function createClient() {
  const jar = new CookieJar();
  const wrappedFetch = fetchCookie(fetch, jar);
  return { fetch: wrappedFetch, jar };
}

function baseHeaders() {
  return {
    'User-Agent': USER_AGENT,
    Accept: 'application/json,text/plain,*/*'
  };
}

async function fetchWithRetry(fetchFn, label) {
  let attempt = 0;
  let lastError;
  while (attempt < FAA_RETRIES) {
    try {
      attempt += 1;
      const res = await fetchFn();
      return res;
    } catch (err) {
      lastError = err;
      console.warn(`[notamFetcher] ${label} attempt ${attempt}/${FAA_RETRIES} failed: ${err.message}`);
      if (attempt >= FAA_RETRIES) break;
      await new Promise(r => setTimeout(r, FAA_RETRY_DELAY_MS));
    }
  }
  throw lastError;
}

async function bootstrapSession(client) {
  console.log('[notamFetcher] Bootstrapping FAA session...');
  const splash = await fetchWithRetry(
    () => client.fetch(`${FAA_BASE_URL}/nsapp.html`, { headers: baseHeaders(), timeout: FAA_FETCH_TIMEOUT }),
    'nsapp.html'
  );
  console.log(`[notamFetcher] nsapp.html status: ${splash.status}`);
  const hdr = await fetchWithRetry(
    () => client.fetch(`${FAA_BASE_URL}/hdr`, { headers: baseHeaders(), timeout: FAA_FETCH_TIMEOUT }),
    'hdr'
  );
  console.log(`[notamFetcher] hdr status: ${hdr.status}`);
}

function buildSearchBody(airportCode) {
  return new URLSearchParams({
    searchType: 0,
    designatorsForLocation: airportCode,
    designatorForAccountable: '',
    latDegrees: '',
    latMinutes: '',
    latSeconds: '',
    longDegrees: '',
    longMinutes: '',
    longSeconds: '',
    radius: '',
    sortColumns: '',
    sortDirection: 'true',
    designatorForNotamNumberSearch: '',
    notamNumber: '',
    radiusSearchOnDesignator: '',
    radiusSearchDesignator: '',
    latitudeDirection: 'N',
    longitudeDirection: 'W',
    freeFormText: '',
    flightPathText: '',
    flightPathDivertAirfields: '',
    flightPathBuffer: '',
    flightPathIncludeNavaids: '',
    flightPathIncludeArtcc: '',
    flightPathIncludeTfr: '',
    flightPathIncludeRegulatory: '',
    flightPathResultsType: '',
    archiveDate: '',
    archiveDesignator: '',
    offset: 0,
    notamsOnly: true,
    filters: '',
    minRunwayLength: '',
    minRunwayWidth: '',
    runwaySurfaceTypes: '',
    predefinedAbraka: '',
    predefinedDabra: '',
    flightPathAddlBuffer: '',
    recaptchaToken: ''
  });
}

function extractNotams(data) {
  if (!data) return [];

  const buckets = [
    data.notams,
    data.data,
    data.notamList,
    data.results,
    data.rows,
    Array.isArray(data) ? data : null
  ];

  for (const bucket of buckets) {
    if (Array.isArray(bucket)) {
      return bucket;
    }
  }

  return [];
}

function getNotamId(notam) {
  const id = notam?.transactionId ||
             notam?.notamId ||
             notam?.id ||
             notam?.notamNumber ||
             notam?.number ||
             notam?.notamID ||
             notam?.icaoId ||
             notam?.icao;

  if (id) return String(id);

  const fallbackId = `${notam?.raw_text || notam?.message || notam?.text || ''}_${notam?.issueDateTime || notam?.issueDate || ''}_${notam?.stationId || ''}`;
  return fallbackId || `notam_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatNotam(rawNotam) {
  return {
    id: getNotamId(rawNotam),
    text: rawNotam.raw_text ||
          rawNotam.traditionalMessage ||
          rawNotam.message ||
          rawNotam.text ||
          rawNotam.icaoMessage ||
          rawNotam.notam ||
          'No message text available',
    number: rawNotam.notamId || rawNotam.notamNumber || rawNotam.number || rawNotam.id,
    raw: rawNotam
  };
}

async function fetchNotams(airportCode) {
  const client = createClient();

  try {
    await bootstrapSession(client);

    const searchBody = buildSearchBody(airportCode);
    console.log(`[notamFetcher] Posting search for ${airportCode}...`);
    console.log(`[notamFetcher] Search body preview: ${searchBody.toString().slice(0, 200)}...`);

    const response = await client.fetch(`${FAA_BASE_URL}/search`, {
      method: 'POST',
      headers: {
        ...baseHeaders(),
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8'
      },
      body: searchBody,
      timeout: FAA_FETCH_TIMEOUT
    });

    console.log(`[notamFetcher] search status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`FAA NOTAM search failed ${response.status}: ${errorText.slice(0, 200)}`);
    }

    const payload = await response.json().catch(async () => {
      const text = await response.text();
      throw new Error(`FAA NOTAM search returned non-JSON: ${text.slice(0, 200)}`);
    });

    const list = extractNotams(payload);
    console.log(`[notamFetcher] parsed NOTAM count: ${list.length}`);

    return list.map(formatNotam);
  } catch (error) {
    console.error('Error fetching NOTAMs from FAA:', error.message);
    return [];
  }
}

module.exports = {
  fetchNotams,
  getNotamId,
  formatNotam
};
