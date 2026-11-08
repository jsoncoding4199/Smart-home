# Aqara Smart Home

A self-hosted smart home dashboard + REST API for **Aqara** devices, built on the
[Aqara Open API v3](https://developer.aqara.com). Zero dependencies (Node 20+).

- Rooms, lights (on/off + brightness), plugs/switches, curtains (position)
- Sensors: temperature/humidity/pressure, motion, door/window, water leak, battery
- Run scenes and enable/disable automations created in the Aqara Home app
- Installable PWA, light/dark theme, auto-refresh every 10 s
- Tablet-friendly: fits one landscape screen, sensors in a compact strip, automations collapsed
- **Demo mode** with simulated devices when no Aqara credentials are set

## Quick start

```bash
npm start            # demo mode → http://localhost:3000
npm test             # unit + API tests
```

## Connect real Aqara devices

1. Create a project on the Aqara Developer Platform and note **App ID, App Key, Key ID**.
2. `cp .env.example .env` and fill in `AQARA_APP_ID`, `AQARA_APP_KEY`, `AQARA_KEY_ID`,
   `AQARA_REGION` (`cn|usa|eu|kr|ru|sg`) and `AQARA_ACCOUNT`.
3. `npm start`, open the dashboard, click **Send code**, enter the code Aqara sends you.
   Tokens are stored in `data/tokens.json` and refreshed automatically.

Exposing it beyond your LAN? Set `DASHBOARD_TOKEN` (sent as `Authorization: Bearer …`).

## REST API

| Method | Path | Body |
|---|---|---|
| GET | `/api/status` | |
| GET | `/api/overview` | rooms, devices, scenes, automations |
| GET | `/api/rooms`, `/api/devices`, `/api/devices/:id` | |
| POST | `/api/devices/:id` | `{ "on": true, "brightness": 60 }` or `{ "position": 50 }` |
| GET | `/api/scenes` · POST `/api/scenes/:id/run` | |
| GET | `/api/automations` · POST `/api/automations/:id` | `{ "enabled": false }` |
| POST | `/api/auth/code`, `/api/auth/token`, `/api/auth/logout` | `{ account, code }` |

## Layout

```
src/aqara/client.js     signed Aqara Open API client (MD5 sign, token refresh)
src/aqara/devices.js    model → type mapping and resource IDs (edit to add devices)
src/aqara/mock.js       simulated Aqara cloud for demo mode/tests
src/service.js          home model: rooms, devices, scenes, automations
src/server.js           HTTP server + static dashboard
public/                 dashboard (vanilla JS PWA)
```

Device resource IDs (`4.1.85` power, `0.1.85` temperature, …) differ on some models.
If a device shows no state, look up its resources in the Aqara developer console and
adjust `src/aqara/devices.js`.
