/**
 * State Manager
 * Manages tracking of seen NOTAMs to detect new ones
 */

const fs = require('fs').promises;
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'notam-state.json');

/**
 * Load the state of seen NOTAMs
 * @returns {Promise<Object>} - State object with seen NOTAM IDs
 */
async function loadState() {
  try {
    const data = await fs.readFile(STATE_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    // If file doesn't exist or is invalid, return empty state
    return { seenNotams: [] };
  }
}

/**
 * Save the state of seen NOTAMs
 * @param {Object} state - State object to save
 * @returns {Promise<void>}
 */
async function saveState(state) {
  try {
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving state:', error.message);
  }
}

/**
 * Check if a NOTAM has been seen before
 * @param {string} notamId - NOTAM identifier
 * @param {Object} state - Current state
 * @returns {boolean} - True if NOTAM has been seen
 */
function hasSeenNotam(notamId, state) {
  return state.seenNotams.includes(notamId);
}

/**
 * Mark a NOTAM as seen
 * @param {string} notamId - NOTAM identifier
 * @param {Object} state - Current state
 * @returns {Object} - Updated state
 */
function markNotamAsSeen(notamId, state) {
  if (!state.seenNotams.includes(notamId)) {
    state.seenNotams.push(notamId);
    
    // Keep only last 1000 NOTAMs to prevent unbounded growth
    if (state.seenNotams.length > 1000) {
      state.seenNotams = state.seenNotams.slice(-1000);
    }
  }
  return state;
}

/**
 * Get new NOTAMs that haven't been seen before
 * @param {Array} notams - Array of NOTAM objects with 'id' field
 * @param {Object} state - Current state
 * @returns {Array} - Array of new NOTAMs
 */
function getNewNotams(notams, state) {
  return notams.filter(notam => !hasSeenNotam(notam.id, state));
}

module.exports = {
  loadState,
  saveState,
  hasSeenNotam,
  markNotamAsSeen,
  getNewNotams
};
