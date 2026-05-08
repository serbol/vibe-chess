# Claude Code Prompt: Real-Time Multiplayer Chess Game

## Project Overview

Build a real-time, two-player chess game playable in the browser. Players connect via WebSockets, get matched into a game room, and play standard chess with full rule enforcement.

## Tech Stack

**Backend:**

- Node.js
- NestJS (latest stable)
- Socket.IO (server)
- TypeScript

**Frontend:**

- Vanilla JavaScript (no UI frameworks)
- Pixi.js v8 (WebGL rendering for the board, pieces, and visual effects)
- Socket.IO client
- HTML5 + CSS3 (only for surrounding UI: menus, panels, modals)

## Project Structure

Create a monorepo-style layout:

```
chess-game/
├── server/                 # NestJS backend
│   ├── src/
│   │   ├── main.ts
│   │   ├── app.module.ts
│   │   ├── game/
│   │   │   ├── game.module.ts
│   │   │   ├── game.gateway.ts        # Socket.IO gateway
│   │   │   ├── game.service.ts        # Game state + matchmaking
│   │   │   ├── chess-engine.service.ts # Move validation, check/checkmate
│   │   │   └── dto/
│   │   │       ├── move.dto.ts
│   │   │       └── join-game.dto.ts
│   │   └── types/
│   │       └── chess.types.ts
│   ├── package.json
│   └── tsconfig.json
├── client/                 # Vanilla JS + Pixi.js frontend
│   ├── index.html
│   ├── vite.config.js            # Vite for dev server + bundling Pixi
│   ├── package.json
│   ├── css/
│   │   └── style.css             # Surrounding UI only (menus, panels)
│   ├── js/
│   │   ├── main.js               # App entry, scene switching
│   │   ├── socket-client.js      # Socket.IO wrapper
│   │   ├── ui.js                 # DOM UI: status, player info, modals
│   │   └── pixi/
│   │       ├── app.js            # Pixi Application bootstrap
│   │       ├── board.js          # Board container, squares, coordinates
│   │       ├── pieces.js         # Piece sprites + drag/drop logic
│   │       ├── highlights.js     # Last move, legal moves, check glow
│   │       ├── effects.js        # Particles, shockwaves, screen shake
│   │       ├── animations.js     # Move tweens, capture animations
│   │       └── assets.js         # Asset loading + texture atlas
│   └── assets/
│       ├── pieces/               # SVG chess pieces (Wikimedia)
│       ├── particles/            # Spark, smoke, glow textures
│       └── sounds/               # Move, capture, check SFX (optional)
└── README.md
```

## Backend Requirements

### 1. NestJS Setup

- Initialize a NestJS app with `@nestjs/websockets` and `@nestjs/platform-socket.io`
- Enable CORS for the client origin (configurable via env)
- Serve the static client folder OR keep client served separately (document both options)

### 2. Game Gateway (`game.gateway.ts`)

Implement these Socket.IO events:

**Client → Server:**

- `joinQueue` — player wants to find a match (payload: `{ playerName: string }`)
- `move` — player makes a move (payload: `{ gameId, from: 'e2', to: 'e4', promotion?: 'q'|'r'|'b'|'n' }`)
- `resign` — player resigns (payload: `{ gameId }`)
- `offerDraw` / `acceptDraw` / `declineDraw`
- `chatMessage` — optional in-game chat (payload: `{ gameId, text }`)

**Server → Client:**

- `queued` — player added to queue
- `gameStart` — match found (payload: `{ gameId, color: 'white'|'black', opponentName, initialFen }`)
- `moveMade` — broadcast to both players (payload: `{ from, to, fen, turn, capturedPiece?, isCheck, lastMoveSan }`)
- `gameOver` — payload: `{ result: 'white'|'black'|'draw', reason: 'checkmate'|'resign'|'draw'|'stalemate'|'timeout' }`
- `invalidMove` — sent only to the offending player
- `opponentDisconnected`

### 3. Chess Engine Service

Use the `chess.js` library (well-tested, handles all rules). Wrap it in a service that:

- Validates moves
- Detects check, checkmate, stalemate, threefold repetition, 50-move rule, insufficient material
- Handles castling, en passant, and promotion
- Exposes FEN strings for state sync

Install: `npm install chess.js`

### 4. Game Service

- In-memory `Map<gameId, GameState>` (no database needed for MVP)
- Matchmaking queue: pair the first two waiting players
- Track player socket IDs, colors, and current turn
- Clean up games on disconnect or completion

### 5. Validation

- Use `class-validator` + `class-transformer` for DTOs
- Reject moves from the wrong player or out of turn

## Frontend Requirements

### 1. Build Tooling

- Use **Vite** for the dev server and bundling — Pixi.js v8 is ESM and benefits from a real bundler
- `npm run dev` for local development with HMR, `npm run build` for production
- Install: `npm install pixi.js socket.io-client`
- Optional but recommended: `@pixi/particle-emitter` for particle effects

### 2. UI Layout (`index.html` + `css/style.css`)

DOM is used **only for menus and side panels**. The board and all in-game visuals are rendered inside a single `<canvas>` mounted by Pixi.

- Landing screen (DOM): name input + "Find Game" button
- Game screen:
  - Pixi canvas (centered, square, responsive — resizes via Pixi's `resizeTo`)
  - Captured pieces tray (DOM, left/right of canvas)
  - Turn indicator + player names (DOM, above canvas)
  - Resign / Offer Draw buttons (DOM)
  - Move history panel (DOM, algebraic notation)
  - Status messages (DOM toast/banner)

### 3. Pixi Application (`pixi/app.js`)

- Create a `PIXI.Application` with `antialias: true`, `resolution: devicePixelRatio`, `backgroundAlpha: 0`
- Use Pixi v8's async `app.init()` API
- Set up a stage with layered containers (back to front):
  1. `boardLayer` — square tiles
  2. `highlightLayer` — last-move highlight, legal-move dots, check glow
  3. `pieceLayer` — piece sprites
  4. `effectsLayer` — particles, shockwaves, capture explosions
  5. `dragLayer` — the piece being dragged (always on top)

### 4. Board & Pieces (`pixi/board.js`, `pixi/pieces.js`)

- Render the 8×8 board procedurally with `PIXI.Graphics` (two alternating tile colors, soft inner shadow)
- Draw rank/file coordinates as `PIXI.Text` along the edges
- Flip the board for the black player
- Load piece SVGs into a texture atlas at startup (`assets.js`)
- Each piece is a `PIXI.Sprite` with `anchor.set(0.5)` positioned at the square's center
- Drag-and-drop using Pixi's `eventMode: 'static'` and `pointerdown/move/up` events
- On drop: emit `move` to server; **do not** update the visual state until `moveMade` confirms (snap piece back if invalid)

### 5. Visual Effects (`pixi/effects.js`, `pixi/animations.js`)

This is where the game should feel _alive_. Implement at least the following:

**Move animations**

- Piece slides smoothly from origin to destination over ~180ms with an ease-out curve (use a small tween helper or write `requestAnimationFrame`-based interpolation)
- Knight moves use a slight arc (parabolic Y offset) so the L-shape reads visually
- Castling: king and rook animate simultaneously

**Piece pickup**

- On `pointerdown`: piece scales up to 1.15× with a soft drop shadow (use `PIXI.filters.DropShadowFilter` from `pixi-filters`)
- Subtle pulsing glow underneath the piece while held

**Legal move indicators**

- When a piece is picked up, dim non-legal squares slightly and draw soft circular dots on legal-move squares
- Capture squares get a hollow ring instead of a dot, in a warmer color

**Last-move highlight**

- Origin and destination squares get a translucent overlay (color matched to the moving side)
- Fades out gently over ~1 second after the next move

**Check indicator**

- The king in check gets a pulsing red radial glow under the sprite
- Loops until the check is resolved

**Captures**

- The captured piece scales down to 0 and fades out simultaneously
- Spawn a burst of particles at the capture square: ~20 small sparks radiating outward, color-matched to the captured piece's side
- Quick screen shake (4–6px amplitude, ~200ms decay) on captures

**Checkmate**

- Slow-motion zoom toward the losing king (Pixi camera = scaling/translating the stage)
- Larger particle burst, screen flash to white then fade
- Display a Pixi `PIXI.Text` "Checkmate" overlay with a scale-in animation

**Pawn promotion**

- When a pawn reaches the last rank, show a Pixi-rendered picker (4 piece sprites) at the promotion square
- Selection triggers a brief "transformation" effect: original pawn shrinks and dissolves into particles, new piece scales in with a glow

**Idle ambience (subtle, optional)**

- Very faint floating dust particles in the background layer
- A gentle breathing scale on the current player's king (1.0 → 1.02 → 1.0, ~3s loop)

**Hover state**

- Mouse-over a friendly piece on your turn: tile gets a subtle highlight, piece lifts ~2px

### 6. Animation Implementation Notes

- Keep a simple tween utility (don't pull in GSAP unless you want to — a 30-line easing helper is enough)
- All animations driven by `app.ticker` for consistent frame timing
- Particles: `@pixi/particle-emitter` with JSON configs is cleaner than rolling your own; document the configs in `effects.js`
- Effects must never block input — the game stays interactive during animations

### 7. Socket Client (`socket-client.js`)

- Thin wrapper around `socket.io-client`
- Expose `connect()`, `joinQueue()`, `sendMove()`, `on(event, handler)`
- Handle reconnection gracefully

### 8. Piece Assets

- Use Wikimedia Commons SVG chess pieces (public domain) — Cburnett or Merida sets are clean choices
- Pre-rasterize to a texture atlas at app boot for performance
- Document the source and license in the README

### 9. Particle Textures

- Simple white circle PNG (32×32) tinted at runtime via sprite `tint` — one texture, many colors
- Optional: a soft glow PNG for the check indicator and pickup glow

## Functional Requirements (MVP)

1. Two players can independently open the page, click "Find Game," and get matched.
2. Standard chess rules enforced on the server (the client is a thin renderer — never trust client moves).
3. Drag a piece, drop on a target square, see the move synced to both clients.
4. Pawn promotion: client shows a picker (Q/R/B/N), sends choice with the move.
5. Check, checkmate, stalemate, and draws are detected and announced.
6. Resign and draw offers work.
7. If a player disconnects, the other player is notified; reconnection within 30s resumes the game (stretch goal — at minimum, end the game cleanly).

## Non-Goals (for MVP — note in README)

- No persistent accounts or database
- No clocks/timers (mention as a future enhancement)
- No spectator mode
- No mobile-optimized touch handling beyond basic pointer events

## Code Quality Expectations

- TypeScript strict mode on the backend
- Clear separation of concerns (gateway = transport, service = logic, engine = rules)
- Comments on non-obvious logic, especially around socket lifecycle
- A `README.md` with setup steps for both server and client, and how to run locally (e.g., server on `:3000`, client served by `live-server` or similar on `:5500`)
- `npm scripts` for `start:dev`, `build`, `start:prod` on the server

## Deliverables Checklist

- [ ] Working NestJS server with the gateway and services above
- [ ] Working vanilla JS + Pixi.js client with drag-and-drop board and visual effects
- [ ] Two browser tabs can play a complete game end-to-end
- [ ] `Dockerfile` for the server, `render.yaml` for one-click Render deploy
- [ ] Env-var-driven CORS and server URL (no hardcoded localhost)
- [ ] `GET /health` endpoint
- [ ] README with local setup AND deploy instructions for Render + Cloudflare Pages
- [ ] `.gitignore` and `.env.example` files for both `server/` and `client/`

## Deployment (Free Hosting)

The app is split: a Node.js WebSocket server and a static frontend. They deploy to **different** providers — this is the cheapest and fastest setup in 2026.

### Recommended split

**Backend (NestJS + Socket.IO) → Render**

- Free Web Service tier, 512 MB RAM, no credit card required
- Native WebSocket support, auto-deploy from GitHub
- Catch: free instances spin down after ~15 minutes of inactivity and take ~30–60s to wake up on the first request. Acceptable for a portfolio/demo project; not for production traffic.
- 750 instance hours/month (enough for one always-eligible service)

**Frontend (Pixi.js + vanilla JS, built by Vite) → Cloudflare Pages**

- Genuinely unlimited bandwidth on the free tier
- 500 builds/month, global edge CDN, free SSL, custom domains
- Connect the GitHub repo, set build command `npm run build` and output dir `dist`, done

### Alternatives (in order of preference)

| Provider                        | What it's good for                              | Watch out for                                                                |
| ------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------- |
| **Render** (backend)            | Free WebSocket-capable Node host, no card       | 15-min idle spin-down                                                        |
| **Cloudflare Pages** (frontend) | Unlimited bandwidth, fastest CDN                | Static only                                                                  |
| **Vercel** (frontend)           | Polished DX, preview URLs per PR                | 100 GB/month cap; Hobby plan forbids commercial use                          |
| **Netlify** (frontend)          | Built-in forms, plugins                         | 100 GB/month, credit-based pricing in 2026                                   |
| **Koyeb** (backend)             | Free 1 vCPU / 512 MB web service, scale-to-zero | Smaller ecosystem                                                            |
| **Fly.io** (backend)            | Great WebSocket support, multi-region           | No free tier for new users since 2024 — credit card required, ~$5/mo minimum |
| **Railway** (backend)           | Best DX of the bunch                            | Free tier removed in 2023 — $5/mo Hobby is the entry point                   |

**Skip:** Heroku (no free tier since 2022), Vercel for the backend (serverless functions don't fit persistent WebSocket connections), Cloudflare Workers for the backend (10ms CPU limit and no Node.js runtime — incompatible with NestJS + Socket.IO).

### What the prompt must produce for deployment to work

1. **Backend `Dockerfile`** (optional but makes Render/Fly/Koyeb portable). Multi-stage: build TypeScript, then run `dist/main.js` on Node 22 alpine.
2. **`render.yaml`** at the repo root for one-click deploy on Render — declares the web service, build command (`cd server && npm ci && npm run build`), and start command (`cd server && node dist/main.js`).
3. **CORS configured via env var** on the server. The frontend on Cloudflare Pages will be at a different origin (e.g. `https://chess-game.pages.dev`), so the NestJS app must read `CLIENT_ORIGIN` from `process.env` and pass it to both `enableCors` and the Socket.IO gateway's `cors` option. Default to `*` only in development.
4. **`PORT` from env** — Render and most PaaS providers inject `PORT`. The server must use `process.env.PORT ?? 3000`.
5. **Frontend env handling** — the Socket.IO client URL must come from a Vite env var (`VITE_SERVER_URL`). Document it in `.env.example`. On Cloudflare Pages, set this in the project's environment variables UI.
6. **Health check endpoint** — a simple `GET /health` returning `{ status: 'ok' }` so Render's health checker doesn't kill the service.
7. **Keep-alive note in the README** — mention that the free Render instance sleeps; suggest UptimeRobot or a cron-job.org ping every 10 minutes if the demo needs to stay warm. (Don't overdo this — it's mildly against the spirit of free tiers but commonly done for portfolio demos.)
8. **README "Deploy" section** with step-by-step instructions for both Render (backend) and Cloudflare Pages (frontend), plus a note on how to change `CLIENT_ORIGIN` and `VITE_SERVER_URL` after the first deploy.

### Sticky-session caveat

Socket.IO with WebSocket transport on a single instance is fine. If the server is ever scaled to multiple instances, sticky sessions and a Redis adapter (`@socket.io/redis-adapter`) become required. Document this as a future concern, not an MVP one — single instance is plenty for a chess game with two players per room.

## Build Order Suggestion

1. Scaffold the NestJS server, get `chess.js` integrated, write a basic move-validation service with unit tests.
2. Add the WebSocket gateway with the `joinQueue` → `gameStart` → `move` → `moveMade` flow.
3. Scaffold the client with Vite + Pixi.js; render a static board with pieces from a hardcoded FEN (no networking yet).
4. Add drag-and-drop and the move animation tween.
5. Wire up Socket.IO: real moves between two browser tabs, server-authoritative.
6. Add resign / draw / game-over handling.
7. Layer in visual effects in this order: last-move highlight → legal-move dots → check glow → capture particles + screen shake → checkmate sequence → promotion picker.
8. Polish: captured pieces tray, move history panel, hover states, idle ambience.
9. Add `Dockerfile`, `render.yaml`, env-var handling, health check, and the deployment README section. Verify a deploy to Render + Cloudflare Pages works end-to-end before declaring done.

Start by scaffolding the project structure and the NestJS app, then confirm the plan before implementing the gateway. Ask clarifying questions if any requirement is ambiguous.
