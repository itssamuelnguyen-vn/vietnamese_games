# Vietnamese Games

A website for playing classic games online with friends: chess, xiangqi (Chinese chess),
Tiến lên miền Nam (Vietnamese card game) and a property-trading board game.
Create a room, share the 4-character code or invite link, and play.

The UI is in Vietnamese; all code, comments and docs are in English.

| Game | Status |
|---|---|
| Chess | Playable |
| Xiangqi | Planned |
| Tiến lên miền Nam | Planned |
| Property-trading game | Planned (original design, not a Monopoly clone) |

## Running locally

Requires [Node.js](https://nodejs.org) 22+ (24 LTS recommended).

```bash
npm install
npm run dev
```

Open http://localhost:5173. To try multiplayer, open a second private/incognito window
(each browser profile or private window is a separate player).

Other scripts:

- `npm test`: run the test suite (Vitest)
- `npm run typecheck`: type-check all three packages
- `npm run build && npm start`: run the production build on http://localhost:3000

## Tests and CI

Tests live next to the code as `*.test.ts`:

- `shared/src/games/*.test.ts`: game rules
- `server/src/rooms.test.ts`: room lifecycle (create, join, start, leave, sweep)
- `server/src/app.test.ts`: the real Socket.IO server on a random port, driven by socket.io-client

GitHub Actions (`.github/workflows/ci.yml`) runs typecheck, tests and build on every pull
request and on pushes to `main`.

## Layout

```
shared/   Game rules and shared types (plain TypeScript, no UI dependencies)
server/   Node + Express + Socket.IO: owns rooms and game state, validates every move
client/   React + Vite: lobby, waiting room, game boards
```

The server is the source of truth: clients send moves, the server validates them and
sends each player only what they are allowed to see (`playerView`). For card games such
as Tiến lên, this is how other players' hands stay hidden.

Errors cross the wire as codes (`ErrorCode` in `shared/src/protocol.ts`); the client maps
them to text.

Rooms live in server memory, so restarting the server drops all rooms.

## UI text

All user-facing strings live in `client/src/i18n/vi.ts`. Components read them through
`t` from `client/src/i18n`. Never hard-code display text in components. To add a locale,
copy `vi.ts` with the same shape (`Strings` type) and switch `t`.

## Adding a game

1. Write `shared/src/games/<game>.ts` exporting a `GameDefinition` (use `chess.ts` as a
   template): `setup`, `applyMove`, `forfeit`, `isOver`, `playerView`.
2. Export it from `shared/src/index.ts`.
3. Register it in `GAMES` in `server/src/rooms.ts`.
4. Build its board component in `client/src/games/` and render it from `RoomScreen.tsx`.
5. Add its strings to `client/src/i18n/vi.ts`.
6. Set `available: true` for it in `GAME_CATALOG` (`shared/src/types.ts`).

## Free deployment on Render

1. Push the code to GitHub.
2. Sign in at https://render.com with GitHub.
3. Choose **New → Blueprint** and select the repo. Render reads `render.yaml` and creates a
   free web service.
4. When the build finishes, Render gives you a URL like `https://vietnamese-games.onrender.com`.

Free tier caveat: the service sleeps after about 15 minutes without traffic. The first
visitor afterwards waits roughly 30–60 seconds for it to wake up, and existing rooms are lost.
