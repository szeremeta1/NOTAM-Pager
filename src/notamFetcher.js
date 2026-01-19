/**
 * NOTAM Fetcher (FAA public NOTAM Search)
 * Uses the public endpoints seen in the HAR capture.
 */

const fetch = require('node-fetch');
const fetchCookie = require('fetch-cookie').default;
const { CookieJar } = require('tough-cookie');

const FAA_BASE_URL = process.env.FAA_BASE_URL || 'https://notams.aim.faa.gov/notamSearch';
const USER_AGENT = 'NOTAM-Pager/2.0 (+https://github.com/szeremeta1/NOTAM-Pager)';

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

async function bootstrapSession(client) {
  console.log('[notamFetcher] Bootstrapping FAA session...');
  const splash = await client.fetch(`${FAA_BASE_URL}/nsapp.html`, { headers: baseHeaders() });
  console.log(`[notamFetcher] nsapp.html status: ${splash.status}`);
  const hdr = await client.fetch(`${FAA_BASE_URL}/hdr`, { headers: baseHeaders() });
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

    const response = await client.fetch(`${FAA_BASE_URL}/search`, {
      method: 'POST',
      headers: {
        ...baseHeaders(),
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8'
      },
      body: searchBody
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
