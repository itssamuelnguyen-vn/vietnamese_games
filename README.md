# Vietnamese Games

A website for playing classic games online with friends: chess, xiangqi (Chinese chess),
Tiến lên miền Nam (Vietnamese card game) and a property-trading board game.
Create a room, share the 4-character code or invite link, and play.

The UI is available in Vietnamese and English; all code, comments and docs are in English.

| Game | Status |
|---|---|
| Chess | Playable: clocks, draw offers, takebacks, premoves, promotion picker, move review, opening names, PGN/FEN export, sounds |
| Xiangqi | Playable: own rules engine (perft-verified), Asian rules (no legal moves loses, perpetual check loses, repetition and 60-move draws), Vietnamese and WXF notation, file numbers, opening names, captured pieces, FEN/PGN export, Chinese or letter piece labels, handicap (odds) games, same clocks/draws/takebacks as chess |
| Tiến lên miền Nam | Playable: 2-4 players, house rules shown in-app (Luật chơi), chops, instant wins, full ranking, per-turn timer |
| Property-trading game | Planned (original design, not a Monopoly clone) |

## Running locally

Requires [Node.js](https://nodejs.org) 22+ (24 LTS recommended).

```bash
npm install
npm run dev
```

On WSL with the project on a Windows drive (`/mnt/c`, `/mnt/d`, ...), file change events don't
reach Linux, so hot reload and server restarts silently stop working. Run
`CHOKIDAR_USEPOLLING=true npm run dev` there instead.

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

Players are identified by a secret per-browser token sent only in the Socket.IO handshake; the
server derives the public player id from it (SHA-256), so ids visible to others can't be used to
log in as someone else. Every connection is rate-limited (60 events per 10 seconds).

If every opponent has been offline for 60 seconds, the remaining player can claim the win. Timed
games are aborted if a side doesn't make its first move within 30 seconds.

Rooms also hold a chat (last 50 messages, flood-limited) and up to 20 spectators, who get the
same game view as players but cannot move.

Rooms live in server memory, so restarting the server drops all rooms.

## UI text, languages and themes

The UI ships in Vietnamese (default) and English; players switch with the VI/EN toggle in the
header, and the choice is remembered in `localStorage`.

- All user-facing strings live in `client/src/i18n/vi.ts` and `client/src/i18n/en.ts`.
  `en.ts` is typed as `Strings` (the shape of `vi.ts`), so a missing key is a type error.
- Components read strings with `const { t } = useI18n()`. Never hard-code display text.
- To add a locale, add a file with the same shape and register it in `LOCALES`
  (`client/src/i18n/index.tsx`).

Light and dark themes follow the OS setting until the player picks one with the sun/moon
button. Colours are CSS custom properties on `:root`, overridden under
`:root[data-theme='dark']` in `client/src/index.css`. A small inline script in
`client/index.html` applies the saved theme before first paint to avoid a flash.

## Adding a game

1. Write `shared/src/games/<game>.ts` exporting a `GameDefinition` (use `chess.ts` as a
   template): `setup`, `applyMove`, `forfeit`, `isOver`, `playerView`, plus optional
   `deadline`/`timeout` for clocks. Rules are pure functions; the server passes the current
   time in a `GameContext` so tests can use a fake clock.
2. Export it from `shared/src/index.ts`.
3. Register it in `GAMES` in `server/src/rooms.ts`.
4. Build its board component in `client/src/games/` and render it from `RoomScreen.tsx`.
   Two-player board games can reuse `games/duel/DuelScreen.tsx` (clocks, status card, move
   review, draw/takeback/resign/rematch, chat, sounds) and only supply the board and notation;
   see `ChessGame.tsx` and `xiangqi/XiangqiGame.tsx`. Shared rule helpers (clocks, side choice,
   first-move deadline) live in `shared/src/games/match.ts`.
5. Add its strings to `client/src/i18n/vi.ts` and `client/src/i18n/en.ts`.
6. Set `available: true` for it in `GAME_CATALOG` (`shared/src/types.ts`).

## Free deployment on Render

1. Push the code to GitHub.
2. Sign in at https://render.com with GitHub.
3. Choose **New → Blueprint** and select the repo. Render reads `render.yaml` and creates a
   free web service.
4. When the build finishes, Render gives you a URL like `https://vietnamese-games.onrender.com`.

Free tier caveat: the service sleeps after about 15 minutes without traffic. The first
visitor afterwards waits roughly 30–60 seconds for it to wake up, and existing rooms are lost.
