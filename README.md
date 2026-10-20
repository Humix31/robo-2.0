# Smart Car Control Dashboard

A responsive React dashboard with an Express/Socket.IO control service, an ESP32-compatible WebSocket adapter, an explicit simulation mode, WebRTC camera signaling, and movement safety timeouts.

## Requirements

- Node.js 18.18 or newer and npm
- A modern browser

## Run locally in simulation

From the repository root in the VS Code terminal (PowerShell):

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Open **http://localhost:5173**. Local development pre-fills the sample simulation token. The Vite UI runs on port 5173 and proxies API and Socket.IO traffic to the Express service on port 3000. In simulation, status telemetry is explicitly marked as simulated. Camera video stays unavailable until a camera is configured or demo video mode is explicitly enabled.

To build and serve the production frontend locally:

```powershell
npm run build
npm start
```

Open **http://localhost:3000**. `npm start` serves the built app and the API from the same origin.

## Configuration

Copy `.env.example` to `.env` and set values before starting the server:

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP/WebSocket server port (defaults to `3000`). |
| `SIMULATION_MODE` | `true` (default) isolates controls from physical hardware. Set `false` only after bench testing. |
| `CONTROL_TOKEN` | Shared approved-user token required to open a dashboard Socket.IO session. Set a long, unique secret for any deployment. |
| `ROBOT_TOKEN` | Required in hardware mode; authenticate the vehicle's `/robot?token=...` WebSocket connection. |
| `CAMERA_STREAM_URL` | Optional camera/bridge identifier included in signaling. Configure a WebRTC-capable camera bridge; this value alone is not a video stream. |
| `VITE_DEMO_MODE` | Set to `true` at frontend build time to enable an explicitly labeled demo video. |
| `VITE_DEMO_VIDEO_URL` | Optional URL of the demo video; no demo video is shown when it is unset. |
| `VITE_ICE_SERVERS` | Optional JSON array of your own STUN/TURN server configurations, read during frontend build. |

Never commit `.env`, put a long-lived control token in `VITE_*` variables, or expose the hardware service publicly without TLS, network restrictions/VPN, and unique secrets. The sample control token is only for local simulation; replace it before deployment.

## Real vehicle controller

The server defaults to simulation. To enable hardware, configure `SIMULATION_MODE=false`, a strong `CONTROL_TOKEN`, and a separate strong `ROBOT_TOKEN`, then restart. The server refuses to start in hardware mode if either token is missing. Keep the server on a trusted network or behind a VPN and TLS-terminating reverse proxy.

The raw WebSocket controller adapter retains the repository's existing ESP32 wire format:

```json
{"type":"move","x":0,"y":100,"speed":128}
{"type":"stop"}
```

Axes are `-100..100`; speed is PWM `0..255`. The web dashboard uses a single held direction at a time and maps its 0–100% speed setting to PWM. Connect the ESP32 to:

```text
ws://<trusted-server-host>:3000/robot?token=<ROBOT_TOKEN>
```

Use `wss://` behind TLS for remote networks. On connect, a stop is sent before the controller is reported ready. Implement a firmware-side motor watchdog that stops the motors if commands stop arriving; the server also stops after a 900 ms movement-command dead-man timeout and when the dashboard control link is lost. Validate axis and PWM limits, motor direction, and watchdog behavior with wheels raised and power readily accessible before any driving test.

Controller telemetry may be sent in a `telemetry` or `robot_status` WebSocket message with numeric `batteryPercentage`, `batteryVoltage`, `currentSpeed`, and `wifiSignal` fields and/or a string `motorStatus`. Missing sensor readings are displayed as **N/A**. The existing controller protocol's `robot_status` connection message remains supported.

## Camera / WebRTC

The dashboard does not fabricate a camera feed. Without a connected camera peer it shows a disconnected placeholder. Configure `CAMERA_STREAM_URL` on the server and restart, then connect a camera bridge that uses an authenticated Socket.IO client to join the `camera` room with `camera:connect` and exchange:

- Dashboard to camera: `camera:offer` with `{ sdp, source }`
- Camera to dashboard: `camera:answer` with `{ sdp }`
- Both directions: `camera:ice-candidate` with `{ candidate }`
- Camera status: `camera:status` with `{ connected: true|false }`

The peer supplies the actual media tracks through WebRTC. Configure ICE servers suitable for your network with `VITE_ICE_SERVERS` (a JSON array); no third-party STUN server is contacted by default. Networks behind restrictive NAT may require your own TURN service. The `CAMERA_STREAM_URL` is a source identifier, not a URL that the app falsely treats as playable video.

For a clearly labeled demo clip, set `VITE_DEMO_MODE=true` and `VITE_DEMO_VIDEO_URL` before building. A remote demo file must be reachable by the browser and permit playback (including any required CORS policy).

## Controls and safety

- Hold W/A/S/D or the directional buttons to move; releasing stops. Space stops immediately.
- The browser also sends stop on focus loss. Reconnection never resumes movement.
- The server validates directions and speed, enforces a 900 ms command dead-man timeout, and latches emergency stop until explicitly confirmed reset.
- Reset the latch only after confirming the physical vehicle is safe and any hardware cutoff has been released.
- A software emergency stop cannot stop a vehicle when its network/controller is unavailable. It is **not a substitute for an independent, hardware-level emergency stop**. Keep the physical power cutoff accessible and implement motor-driver/firmware failsafes.
- Hardware use requires an approved control token and a separate robot token. Protect all hardware deployments with TLS and private network controls.

## API and diagnostics

- `GET /health` — process and operating mode health.
- `GET /api/status` — current vehicle state and available telemetry.
- `GET /api/camera/config` — whether a camera source is configured (does not reveal it).
- Socket.IO events include `vehicle:connect`, `vehicle:disconnect`, `vehicle:command`, `vehicle:stop`, `vehicle:emergency-stop`, `vehicle:status`, and `camera:status`.

Check the server terminal for structured JSON connection and stop events. If Vite loads but the session cannot connect, confirm the server is running on port 3000, the token matches, and no other service occupies that port. If the vehicle stays offline in hardware mode, check the ESP32 URL/token, network reachability, and server logs. If video does not appear, verify camera peer signaling, permissions, ICE/TURN reachability, and browser console errors.

## Project structure

```text
client/
  src/components/   Dashboard, camera, controls, telemetry, and settings UI
  src/App.jsx       Socket.IO session and dashboard behavior
  src/styles.css    Responsive dark dashboard styling
server.js           Express, Socket.IO, simulation, and ESP32 WebSocket adapter
.env.example        Local and hardware configuration template
render.yaml         Production build/start commands
```
