/**
 * NOTAM Fetcher
 * Fetches NOTAMs from the FAA NOTAM Search API
 */

const fetch = require('node-fetch');

/**
 * Fetch NOTAMs for a specific airport
 * @param {string} airportCode - Airport ICAO code (e.g., KBLM)
 * @returns {Promise<Array>} - Array of NOTAM objects
 */
async function fetchNotams(airportCode) {
  try {
    // Use the FAA NOTAM Search API
    // The API endpoint accepts ICAO codes
    const url = `https://notams.aim.faa.gov/notamSearch/search`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'NOTAM-Pager/1.0'
      },
      body: JSON.stringify({
        locationIdentifiers: [airportCode],
        retrieveLocationsForAllIdentifiers: true
      })
    });

    if (!response.ok) {
      console.error(`NOTAM API returned status ${response.status}`);
      return [];
    }

    const data = await response.json();
    
    // Extract NOTAMs from the response
    // The API structure may vary, check multiple possible paths
    const possiblePaths = [
      () => Array.isArray(data) ? data : null,
      () => data.notamList,
      () => data.items,
      () => data.results,
      () => data.data
    ];
    
    for (const pathFn of possiblePaths) {
      const result = pathFn();
      if (result && Array.isArray(result)) {
        return result;
      }
    }
    
    return [];
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
  // Try various possible ID fields
  const id = notam.id || 
             notam.notamNumber || 
             notam.number || 
             notam.notamID ||
             notam.icaoId;
  
  if (id) return String(id);
  
  // Fallback: create a hash-like identifier from key fields
  const fallbackId = `${notam.message || notam.text || ''}_${notam.startDate || ''}_${notam.location || ''}`;
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
    text: rawNotam.traditionalMessage || 
          rawNotam.message || 
          rawNotam.text || 
          rawNotam.icaoMessage ||
          'No message text available',
    number: rawNotam.notamNumber || rawNotam.number || rawNotam.id,
    raw: rawNotam
  };
}

module.exports = {
  fetchNotams,
  getNotamId,
  formatNotam
};
