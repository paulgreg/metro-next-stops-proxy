# Metro Next Stops Proxy

Small Node.js proxy that calls the Ile-de-France Mobilites PRIM API and returns a simplified JSON payload for the ESP32 display.

The proxy handles:

- PRIM API token storage (server-side only)
- TLS 1.3 call to PRIM
- Aggregation of multiple platforms for one requested stop
- 30 second in-memory cache
- Dynamic stop list served to ESP32 at boot

## Why this proxy exists

`prim.iledefrance-mobilites.fr` currently requires TLS 1.3, while ESP32 Arduino HTTPS clients commonly negotiate TLS 1.2 only.

This proxy lets the ESP32 fetch from your own endpoint (for example behind nginx with TLS 1.2 support), while the server handles the TLS 1.3 call to PRIM.

## Requirements

- Node.js 26+
- A PRIM API key from <https://prim.iledefrance-mobilites.fr/>

## Setup

1. Copy `.env.dist` to `.env`
2. Fill environment values
3. Install dependencies and run

```bash
npm install
npm run dev
```

Build and run production:

```bash
npm run build
npm run start
```

## Endpoint

### `GET /stops`

Returns available stop keys and display names:

```json
{
  "default": "metro6",
  "stops": [
    { "key": "metro6", "name": "Raspail" },
    { "key": "rerb", "name": "Port Royal - RER B" }
  ]
}
```

### `GET /next-stops?stop=<key>`

Returns a simplified response for one stop key. If `stop` is omitted, the default key is used.

```json
{
  "name": "Raspail",
  "line": "6",
  "updatedAt": "2026-09-05T20:00:00.000Z",
  "directions": [
    { "name": "Nation", "line": "6", "minutes": [1, 4, 7] },
    { "name": "Charles de Gaulle - Etoile", "line": "6", "minutes": [3, 6, 9] }
  ]
}
```

### `GET /health`

Simple health endpoint.

## Environment variables

- `PORT`: local HTTP port (for nginx upstream), default `3000`
- `PRIM_API_TOKEN`: PRIM API token
- `DEFAULT_STOP_KEY`: default stop key used when `stop` query param is omitted
- `STOPS`: JSON object keyed by stop id

Example:

```env
DEFAULT_STOP_KEY=metro6
STOPS={"metro6":{"name":"Raspail","lineName":"6","lineRef":"STIF:Line::C01376:","platforms":[{"monitoringRef":"STIF:StopPoint:Q:22155:"},{"monitoringRef":"STIF:StopPoint:Q:463292:"}]},"rerb":{"name":"Port Royal - RER B","lineName":"B","lineRef":"STIF:Line::C01743:","platforms":[{"monitoringRef":"STIF:StopPoint:Q:412818:"}]}}
```

Legacy single-stop mode is still supported when `STOPS` is not set:

- `STOP_NAME`
- `LINE_NAME`
- `LINE_REF`
- `PLATFORMS`

Optional:

- `MAX_DEPARTURES` (default `6`)
- `MAX_DIRECTIONS` (default `4`)
- `CACHE_TTL_MS` (default `30000`)
- `REQUEST_TIMEOUT_MS` (default `15000`)

## How to configure `STOPS`

All references come from PRIM datasets and docs on <https://prim.iledefrance-mobilites.fr/>.

- API endpoint used by this proxy:
  - `GET https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring`
- Required query values:
  - `MonitoringRef` (platform id)
  - `LineRef` (line id)

Each stop in `STOPS` should contain:

- `name`: display label returned to ESP32
- `lineName`: fallback line label in payload
- `lineRef`: line ref used in PRIM request
- `platforms`: array of `{ monitoringRef, lineRef? }`

`MonitoringRef` format:

`STIF:StopPoint:Q:<arrid>:`

`LineRef` format:

`STIF:Line::<codifligne>:`

To identify `<arrid>` and `<codifligne>`, use PRIM static referential datasets (for example stop and line references), then map the desired station platforms.

## nginx reverse proxy (example)

```nginx
location /metro/ {
    proxy_pass http://127.0.0.1:3000/;
}
```

Then your ESP32 can call:

`https://your-domain/metro/stops`

and then:

`https://your-domain/metro/next-stops?stop=metro6`
