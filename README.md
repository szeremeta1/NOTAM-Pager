# NOTAM-Pager

Automatically fetches NOTAMs (Notices to Airmen) for a specified airport and sends new ones to a pager number. Similar to [uptime-kuma-pager](https://github.com/szeremeta1/uptime-kuma-pager), this service strips emojis and unsupported characters to ensure pager compatibility.

## What it does

- Polls the FAA NOTAM Search site (https://notams.aim.faa.gov/notamSearch/nsapp.html#/) for NOTAMs at a specified airport (default: KBLM - Monmouth Executive Airport)
- Tracks previously seen NOTAMs to detect new ones
- Cleans messages (removes emojis, formats text)
- Sends new NOTAMs to a pager via Spok/USA Mobility web form using direct HTTP POST

## Project layout

```
notam-pager/
├── src/
│   ├── index.js          # Main application with polling logic
│   ├── notamFetcher.js   # NOTAM API fetching
│   ├── messageClean.js   # Emoji removal + formatting
│   ├── pagerApi.js       # Direct HTTP POST sender
│   └── stateManager.js   # Tracks seen NOTAMs
├── package.json
├── .env.example
└── README.md
```

## Prerequisites

- Node.js 18+ recommended
- A pager number compatible with Spok/USA Mobility service
- Outbound HTTPS access to https://notams.aim.faa.gov/notamSearch

## Installation

1. Clone this repository
2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

4. Edit `.env` with your configuration:

```env
PORT=3000
AIRPORT_CODE=KBLM
POLL_INTERVAL=300000
PAGER_PHONE_NUMBER=7322063021
PAGER_URL=https://secure.spokwireless.net
```

### Configuration Options

- `PORT` - HTTP server port (default: 3000)
- `AIRPORT_CODE` - ICAO airport code to monitor (default: KBLM for Monmouth Executive Airport)
- `POLL_INTERVAL` - How often to check for new NOTAMs in milliseconds (default: 300000 = 5 minutes)
- `PAGER_PHONE_NUMBER` - **REQUIRED** Your pager number
- `PAGER_URL` - Pager service URL (default: https://secure.spokwireless.net)
- `MAX_STORED_NOTAMS` - Maximum number of NOTAM IDs to keep in state (default: 1000)
- `STARTUP_SEND_LATEST` - When `true` (default), send the most recent NOTAM once at startup even if already seen to verify delivery

### Common Airport Codes

- KBLM - Monmouth Executive Airport (default)
- KEWR - Newark Liberty International
- KJFK - John F. Kennedy International
- KLGA - LaGuardia Airport
- KTEB - Teterboro Airport

## Run locally

```bash
npm start
```

The service will:
1. Start an HTTP server on the configured port
2. Begin polling for NOTAMs at the specified interval
3. Send new NOTAMs to the configured pager number

## Endpoints

- `GET /` - Service information and status
- `GET /health` - Health check with polling status
- `POST /poll` - Manually trigger a NOTAM poll
- `POST /reset` - Reset seen NOTAMs (for testing)

## How it works

1. Application polls the FAA NOTAM Search site (public endpoints extracted from the HAR) at regular intervals
2. Compares fetched NOTAMs against previously seen ones (stored in `notam-state.json`)
3. For each new NOTAM:
   - Formats and cleans the message (removes emojis, truncates to 240 chars)
   - Sends to pager via direct HTTP POST to Spok service
   - Marks as seen in state file
4. Repeats at configured interval

## Testing

Quick manual poll test:

```bash
curl -X POST http://localhost:3000/poll
```

Reset seen NOTAMs (causes all current NOTAMs to be treated as new):

```bash
curl -X POST http://localhost:3000/reset
```

## Notes

- Messages are automatically truncated to 240 characters (pager service limit)
- State is persisted in `notam-state.json` to track seen NOTAMs across restarts
- Up to 1000 NOTAM IDs are kept in state to prevent unbounded growth
- A 2-second delay is added between sending multiple NOTAMs to avoid overwhelming the pager service

## Troubleshooting

- **Port in use**: Change `PORT` in `.env`
- **No NOTAMs found**: Verify `AIRPORT_CODE` is a valid ICAO code
- **Pager not receiving messages**: Check `PAGER_PHONE_NUMBER` and ensure it's compatible with Spok service
- **Messages not sending**: Check console logs for API errors

## License

MIT
