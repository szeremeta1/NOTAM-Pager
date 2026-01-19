/**
 * NOTAM-Pager - Airport NOTAM to Pager Service
 * Main application entry point
 */

require('dotenv').config();
const express = require('express');
const { fetchNotams, formatNotam } = require('./notamFetcher');
const { cleanMessage } = require('./messageClean');
const { sendToPagerApi } = require('./pagerApi');
const { loadState, saveState, getNewNotams, markNotamAsSeen } = require('./stateManager');

const app = express();
const PORT = process.env.PORT || 3000;
const AIRPORT_CODE = process.env.AIRPORT_CODE || 'KBLM'; // Monmouth Executive Airport
const PAGER_PHONE_NUMBER = process.env.PAGER_PHONE_NUMBER;
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL) || 300000; // 5 minutes default

// Validate required configuration
if (!PAGER_PHONE_NUMBER) {
  console.error('ERROR: PAGER_PHONE_NUMBER must be set in .env file');
  process.exit(1);
}

let state = { seenNotams: [] };
let pollingTimer = null;
let isPolling = false;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * Poll for new NOTAMs and send them to the pager
 */
async function pollNotams() {
  if (isPolling) {
    console.log('Polling already in progress, skipping...');
    return;
  }
  
  try {
    isPolling = true;
    console.log(`Polling NOTAMs for ${AIRPORT_CODE}...`);
    
    // Fetch NOTAMs
    const rawNotams = await fetchNotams(AIRPORT_CODE);
    console.log(`Fetched ${rawNotams.length} NOTAMs`);
    
    // Format NOTAMs
    const notams = rawNotams.map(formatNotam);
    
    // Get new NOTAMs
    const newNotams = getNewNotams(notams, state);
    console.log(`Found ${newNotams.length} new NOTAMs`);
    
    // Process each new NOTAM
    for (const notam of newNotams) {
      console.log(`Processing new NOTAM: ${notam.id}`);
      
      // Clean the message
      const cleanedMessage = cleanMessage(notam, AIRPORT_CODE);
      console.log('Cleaned message:', cleanedMessage);
      
      // Send to pager
      const result = await sendToPagerApi(PAGER_PHONE_NUMBER, cleanedMessage);
      
      if (result.success) {
        console.log(`✓ Sent NOTAM ${notam.id} to pager successfully`);
        
        // Mark as seen
        state = markNotamAsSeen(notam.id, state);
      } else {
        console.error(`✗ Failed to send NOTAM ${notam.id}:`, result.error || result.message);
      }
      
      // Small delay between messages to avoid overwhelming the pager service
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Save state
    await saveState(state);
    
  } catch (error) {
    console.error('Error during polling:', error);
  } finally {
    isPolling = false;
  }
}

/**
 * Start polling for NOTAMs
 */
async function startPolling() {
  console.log(`Starting NOTAM polling every ${POLL_INTERVAL / 1000} seconds`);
  
  // Load initial state
  state = await loadState();
  console.log(`Loaded state with ${state.seenNotams.length} seen NOTAMs`);
  
  // Do initial poll
  await pollNotams();
  
  // Set up polling interval
  pollingTimer = setInterval(pollNotams, POLL_INTERVAL);
}

/**
 * Stop polling for NOTAMs
 */
function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
    console.log('Stopped NOTAM polling');
  }
}

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'NOTAM-Pager - Airport NOTAM to Pager Service',
    status: 'running',
    config: {
      airportCode: AIRPORT_CODE,
      pollInterval: `${POLL_INTERVAL / 1000} seconds`,
      seenNotams: state.seenNotams.length
    },
    endpoints: {
      health: '/health',
      poll: '/poll',
      reset: '/reset'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    polling: isPolling,
    seenNotams: state.seenNotams.length
  });
});

// Manual poll endpoint
app.post('/poll', async (req, res) => {
  res.status(202).json({
    status: 'accepted',
    message: 'Manual poll initiated'
  });
  
  // Run poll asynchronously
  pollNotams();
});

// Reset state endpoint (for testing)
app.post('/reset', async (req, res) => {
  state = { seenNotams: [] };
  await saveState(state);
  res.json({
    status: 'ok',
    message: 'State reset successfully'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`NOTAM-Pager server is running on port ${PORT}`);
  console.log(`Airport: ${AIRPORT_CODE}`);
  console.log(`Pager number: ${PAGER_PHONE_NUMBER}`);
  console.log(`Poll interval: ${POLL_INTERVAL / 1000} seconds`);
  
  // Start polling
  startPolling();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  stopPolling();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  stopPolling();
  process.exit(0);
});
