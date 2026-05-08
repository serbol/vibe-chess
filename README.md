# vibe.chess

Real-time, two-player chess playable in the browser. NestJS + Socket.IO authoritative
backend, Vanilla JS + Pixi.js v8 frontend with WebGL board rendering, drag-and-drop,
and visual effects (move tweens, capture particles, screen shake, check glow,
checkmate sequence, promotion picker).

## Layout

```
chess-game/
├── server/        # NestJS backend (TypeScript strict)
├── client/        # Vite + Pixi.js v8 frontend (vanilla JS)
├── render.yaml    # one-click deploy spec for Render
└── README.md
```

## Local development

You will run two processes: one for the API/WS server and one for the Vite dev
server that hosts the frontend with HMR.

### 1. Server

```bash
cd server
npm install
cp .env.example .env       # edit if you want, defaults are fine
npm run start:dev
```

Server listens on `http://localhost:3000` by default and exposes:

- `GET /health` — JSON liveness probe
- WebSocket endpoint at `/socket.io`

### 2. Client

In a second terminal:

```bash
cd client
npm install
cp .env.example .env       # leave defaults for local dev
npm run dev
```

Vite serves at `http://localhost:5173`. Open it in two browser tabs (or two
devices on your LAN), enter different names, click **Find Game**, and play.

## How a turn flows

1. Client emits `move { gameId, from, to, promotion? }`.
2. Server's `ChessEngineService` re-validates against the authoritative FEN.
3. Server broadcasts `moveMade { from, to, fen, turn, ... }` to both players.
4. Client animates the slide, captures, particles, and updates UI.

The client never trusts itself — every move round-trips. We do use a local
`chess.js` instance to avoid sending obviously illegal drops (and to highlight
legal-move dots when picking up a piece).

## Visual effects implemented

- **Move tween** — 180ms ease-out slide, parabolic arc on knight moves,
  simultaneous king + rook animation on castling.
- **Last-move highlight** — origin and destination tinted by mover's color,
  fades over ~1s.
- **Legal-move indicators** — soft dots on empty squares, hollow rings on
  capture squares, drawn while a piece is held.
- **Hover state** — friendly piece on your turn lifts ~2px on hover.
- **Pickup pulse** — held piece scales up to ~1.12×.
- **Capture animation** — captured piece shrinks and fades; ~22 sparks burst
  outward at the capture square; brief ~5px screen shake.
- **Check glow** — pulsing red radial glow under the king in check.
- **Checkmate sequence** — three particle bursts at the losing king, white
  flash overlay, "Checkmate" text scaling in.
- **Pawn promotion** — Pixi-rendered vertical picker (Q/R/B/N), tap to choose.

## Piece rendering

Pieces are rendered from **Unicode chess glyphs** (`♔♕♖♗♘♙♚♛♜♝♞♟`), pre-rasterized
into RenderTextures at boot. This avoids a binary asset dependency and keeps the
project self-contained.

If you want a more refined look, drop SVG files (Wikimedia's Cburnett or Merida
sets are public-domain options) into `client/assets/pieces/` and replace the
texture-building logic in `client/js/pixi/assets.js` with a Pixi `Assets.load`
call against the SVGs. Sprite anchors and sizing already assume a 256×256 unit.

## Deployment (free hosting)

The recommended setup is to split the deployment: the NestJS WebSocket server
goes on **Render**, and the static Vite-built frontend goes on **Cloudflare
Pages**.

### Backend → Render

1. Push this repo to GitHub.
2. In Render, click **New → Blueprint** and point it at this repo. The
   `render.yaml` at the repo root will be picked up automatically. It declares:
   - root directory `server/`
   - build `npm ci && npm run build`
   - start `node dist/main.js`
   - health check `/health`
3. Set the `CLIENT_ORIGIN` environment variable in Render's UI to the URL where
   your frontend will be hosted (e.g. `https://vibe-chess.pages.dev`). This is
   marked `sync: false` in `render.yaml` because each deployment's value will
   differ.
4. Free instances spin down after ~15 minutes of inactivity. The first request
   after sleep takes 30–60s to wake the dyno. For a portfolio demo, optionally
   set up an UptimeRobot or cron-job.org ping every 10 minutes against `/health`.

### Frontend → Cloudflare Pages

1. In Cloudflare Pages, **Create a project** from the GitHub repo.
2. Build settings:
   - **Root directory:** `client`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
3. Environment variables:
   - `VITE_SERVER_URL` = the Render server URL, e.g.
     `https://vibe-chess-server.onrender.com`
4. Deploy. Open the resulting `.pages.dev` URL — you should be able to find a
   match against another tab.

### Updating origins post-deploy

Cloudflare Pages assigns the URL on first deploy. Once you have it, update
`CLIENT_ORIGIN` on Render so CORS and the Socket.IO handshake succeed. If you
change either origin later, redeploy the corresponding side.

### Single instance only

This implementation keeps games in process memory. Scaling horizontally would
require sticky sessions and a Redis adapter
(`@socket.io/redis-adapter`) plus moving the in-memory `Map`s into Redis. Out of
scope for the MVP.

## Non-goals (not implemented)

- No accounts, persistence, or database
- No clocks/timers
- No spectator mode
- No reconnect-within-30s grace period (the game ends cleanly on disconnect)
- No mobile-optimized touch tuning beyond what `eventMode: 'static'` gives us

## Scripts reference

Server (`server/package.json`):

| Script | Purpose |
| --- | --- |
| `npm run start:dev` | watch-mode local dev |
| `npm run build` | compile TS → `dist/` |
| `npm run start:prod` | run the compiled build |

Client (`client/package.json`):

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Production bundle into `client/dist/` |
| `npm run preview` | Serve the built bundle locally |

## License

The project itself is unlicensed (private). Unicode chess glyphs are part of the
Unicode standard; no attribution required.
