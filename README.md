# Remote Bubble Craps

Initial browser-based, play-money Bubble Craps prototype. One shared table is hosted by the Node.js backend. React clients connect over WebSockets for live table state and chat.

This prototype does not implement deposits, withdrawals, purchases, prizes, cryptocurrency, rewards, or anything redeemable for value.

The default local mode uses the simulated dice device and display-name joins. The Azure mode can use Microsoft Entra External ID for sign-up/sign-in while keeping play-chip balances in the app's local SQLite database.

## Stack

- TypeScript
- React + Vite frontend
- Node.js WebSocket backend
- SQLite event log through `node:sqlite`
- Docker Compose for local startup
- Vitest for unit and integration tests

## Repository Structure

```text
apps/
  server/
    src/
      device/              DiceDevice interface, simulator, USB stub
      __tests__/           WebSocket integration test
      gameServer.ts        Authoritative game server
      eventStore.ts        Append-only SQLite event log
  web/
    src/
      App.tsx              Single-table UI
      styles.css           Responsive game layout
packages/
  shared/
    src/
      craps.ts             Craps state machine and bet settlement
      types.ts             Shared protocol and state types
      __tests__/           Rules and payout unit tests
```

## Local Setup

```bash
npm install
npm test
npm run dev:server
```

In another shell:

```bash
npm run dev:web
```

Open `http://localhost:5173`. The web client connects to `ws://localhost:8080/ws` by default.

## Docker Compose

```bash
docker compose up --build
```

- Frontend: `http://localhost:5173`
- Backend WebSocket: `ws://localhost:8080/ws`
- Health check: `http://localhost:8080/health`
- Recent event log: `http://localhost:8080/events`
- SQLite database: `./data/bubble-craps.sqlite`

## Azure VM Startup

For the simplest Azure deployment, use one Ubuntu VM with Docker Compose and Caddy:

```bash
sudo mkdir -p /opt/bubble-craps/data
cp .env.azure.example .env.azure
# edit .env.azure with your domain and Entra External ID values
docker compose --env-file .env.azure -f docker-compose.azure.yml up --build -d
```

Caddy terminates HTTPS and proxies:

- App: `https://your-domain.com`
- WebSocket: `wss://your-domain.com/ws`
- Health check: `https://your-domain.com/health`

Open ports 80 and 443 on the VM or Azure network security group. The SQLite database is persisted at `/opt/bubble-craps/data/bubble-craps.sqlite`.

### Entra External ID

Azure mode uses Entra only for identity. Chip balances, buy-ins, table state and the event log stay in SQLite.

Configure an Entra External ID sign-up/sign-in flow and app registration, then set:

```text
AUTH_MODE=entra
ENTRA_AUTHORITY=https://your-external-tenant.ciamlogin.com/your-external-tenant-id/v2.0
ENTRA_AUDIENCE=api://your-backend-app-id-uri-or-client-id
VITE_AUTH_MODE=entra
VITE_ALLOWED_HOSTS=your-domain.com
VITE_ENTRA_CLIENT_ID=your-spa-client-id
VITE_ENTRA_AUTHORITY=https://your-external-tenant.ciamlogin.com/your-external-tenant-id/v2.0
VITE_ENTRA_REDIRECT_URI=https://your-domain.com
VITE_ENTRA_POPUP_REDIRECT_URI=https://your-domain.com/auth-callback.html
VITE_ENTRA_API_SCOPE=api://your-backend-app-id-uri-or-client-id/access_as_user
VITE_WS_URL=wss://your-domain.com/ws
```

Register both `VITE_ENTRA_REDIRECT_URI` and `VITE_ENTRA_POPUP_REDIRECT_URI` as single-page application redirect URIs in Entra. If your Entra issuer differs from OIDC discovery, set `ENTRA_ISSUER` explicitly.

## Configuration

Copy `.env.example` to `.env` for local shell usage or edit `docker-compose.yml` for container defaults.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8080` | Backend HTTP/WebSocket port |
| `HOST` | `0.0.0.0` | Backend listen host |
| `DATABASE_PATH` | `./data/bubble-craps.sqlite` | SQLite event log path |
| `BETTING_COUNTDOWN_SECONDS` | `10` | Betting window before each roll |
| `STARTING_BALANCE` | `1000` | Virtual-chip balance for each joined player |
| `SIMULATED_ROLL_DELAY_MS` | `900` | Server-side simulated dice delay |
| `REBUY_CHIPS` | `2000` | Play chips added by the rebuy button |
| `ROLL_TIMEOUT_SECONDS` | `30` | Seconds a locked shooter has to press Roll before the dice pass |
| `AUTH_MODE` | `local` | `local` display-name join or `entra` token auth |
| `ENTRA_AUTHORITY` | empty | Entra OIDC authority used by the backend |
| `ENTRA_AUDIENCE` | empty | Expected backend access-token audience |
| `ENTRA_ISSUER` | empty | Optional explicit expected token issuer |
| `VITE_WS_URL` | `ws://localhost:8080/ws` | Frontend WebSocket URL |
| `VITE_AUTH_MODE` | `local` | Frontend auth mode |
| `VITE_ENTRA_CLIENT_ID` | empty | Entra SPA client ID |
| `VITE_ENTRA_AUTHORITY` | empty | Entra authority used by MSAL |
| `VITE_ENTRA_REDIRECT_URI` | current origin | Registered SPA redirect URI |
| `VITE_ENTRA_POPUP_REDIRECT_URI` | `/auth-callback.html` under `VITE_ENTRA_REDIRECT_URI` | Dedicated MSAL popup callback URI |
| `VITE_ENTRA_API_SCOPE` | empty | Backend API scope requested by the frontend |
| `VITE_REBUY_CHIPS` | `2000` | Rebuy button display amount |

## Game Flow

1. A user joins with a display name in local mode or signs in with Entra in Azure mode.
2. The server opens betting for a configurable countdown.
3. Bets lock automatically when the countdown expires.
4. The current shooter can request a roll.
5. The backend authorizes the request, sends it to the dice device abstraction, settles all bets, updates balances, logs events, and broadcasts the next betting window.

The server owns all authoritative game state. Browsers never communicate with the dice device.

If betting locks and the shooter does not roll before `ROLL_TIMEOUT_SECONDS`, no roll is created and no bets settle. The dice pass to the next connected player, the table point and active bets stay unchanged, betting reopens, and a table notice alerts everyone, including the new shooter.

Users can click `Buy 2,000 Play Chips` to add configured play chips to their bankroll. The same amount is added to their cumulative play buy-ins for scorekeeping. This is only a play-money ledger action and has no payment or redemption behavior.

SQLite stores registered users, chip balances, cumulative play buy-ins, the latest table snapshot and the append-only event log.

Players can edit their table display name after joining. In Entra mode, the first name is taken from token claims in this order: `displayName`, `display_name`, `name`, `preferred_username`, then `email`. The in-app table name is stored in SQLite and used for chat, chip stacks and the player roster. Entra mode also shows a sign-out button in the account panel.

The browser UI presents a craps-table layout. Players bet by dragging virtual chips from the rack onto board spots; the backend still validates every bet. Chip stacks on the table are grouped by short player names so all connected players can see each other's active bets.

Players can remove eligible bets while betting is open. The server refunds the stake and logs the removal. Established Pass Line and Don't Pass flat bets and moved Come contract bets cannot be removed.

Adding chips to an existing bet spot combines into that player's existing bet instead of creating duplicate bets. Come and Don't Come bets that have already moved to a number remain separate from new Come/Don't Come bets.

The client also plays local sound cues for new bets, chat messages, roll start and dice results. These sounds are presentation-only and are not part of the authoritative game state.

## Supported Bets

- Pass Line
- Don't Pass, with barred 12 push
- Pass Odds and Don't Pass Odds after a point is established
- Come
- Don't Come, with barred 12 push
- Field, with double 2 and triple 12
- Place 4, 5, 6, 8, 9, 10
- Lay 4, 5, 6, 8, 9, 10
- Proposition bets: Any Seven, Any Craps, Aces, Ace-Deuce, Yo and Boxcars
- Hardways: Hard 4, Hard 6, Hard 8 and Hard 10

Place bets accept any positive whole-chip amount. If the payout does not divide evenly, the profit is rounded down:

- 4 and 10: pays 9:5
- 5 and 9: pays 7:5
- 6 and 8: pays 7:6

Lay bets round down uneven gross profit, then subtract a 5% vig from the gross profit only when the bet wins. The vig is not charged when placing or removing the bet:

- 4 and 10: wins 1:2
- 5 and 9: wins 2:3
- 6 and 8: wins 5:6

Pass Odds require an established Pass Line bet and pay true odds:

- 4 and 10: pays 2:1
- 5 and 9: pays 3:2
- 6 and 8: pays 6:5

Don't Pass Odds require an established Don't Pass bet and pay no-vig lay-side true odds:

- 4 and 10: wins 1:2
- 5 and 9: wins 2:3
- 6 and 8: wins 5:6

Place, lay and odds bets are working while the table point is on and are off during come-out rolls.

One-roll proposition bets settle on the next roll. Hardways stay working after a hardway win, lose on seven, and lose when their number rolls the easy way.

The table broadcasts a recent bet feed after rolls showing which bets won, lost, pushed, moved or collected.

## Dice Device Boundary

The backend uses this interface:

```ts
interface DiceDevice {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): DiceDeviceStatus;
  requestRoll(rollId: string): Promise<void>;
  onResult(callback: (result: DiceResult) => void): () => void;
}
```

`SimulatedDiceDevice` is active now and rolls two fair six-sided dice on the server.

`UsbSerialDiceDevice` is a documented stub for a future USB-connected ESP32-C3. Intended line-oriented protocol:

```text
PC sends:
ROLL <rollId>

ESP32 responds:
ACK <rollId>
ROLLING <rollId>
RESULT <rollId> <die1> <die2>
ERROR <rollId> <message>
```

Only the backend or a trusted local device gateway should ever send `ROLL`.

## Tests

```bash
npm test
```

Coverage includes:

- come-out and point-state transitions
- Pass Line and Don't Pass outcomes
- Come and Don't Come movement and resolution
- Field, Place, Lay and Proposition bet settlement
- eligible bet removal and contract-bet removal rejection
- play-chip rebuy ledger updates
- player table-name updates
- shooter roll timeout without settling active bets
- shooter rotation on seven-out
- WebSocket integration path: join -> bet -> lock -> roll -> settlement
- mocked Entra authentication -> rebuy -> reconnect with persisted chips
