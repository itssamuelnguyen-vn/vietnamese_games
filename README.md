# Vietnamese Games

A website for playing classic games online with friends: chess, xiangqi (Chinese chess),
Tiến lên miền Nam (Vietnamese card game) and cờ tỉ phú (a property-trading game set on the streets of Ho Chi Minh City),
with more board, card, word and party games on the way.
Create a room, share the 4-character code or invite link, and play.

The UI is available in Vietnamese and English; all code, comments and docs are in English.

| Game | Status |
|---|---|
| Chess | Playable: clocks, draw offers, takebacks, premoves, promotion picker, move review, opening names, PGN/FEN export, sounds, computer players (bots) at three levels (easy, medium, hard) |
| Xiangqi | Playable: own rules engine (perft-verified), Asian rules (no legal moves loses, perpetual check and perpetual chase lose, repetition and 60-move draws), Vietnamese and WXF notation, file numbers, opening names, captured pieces, FEN/PGN export, Chinese or letter piece labels, handicap (odds) games, same clocks/draws/takebacks as chess, computer players (bots) at three levels |
| Tiến lên miền Nam | Playable: 2-4 players, house rules shown in-app (Luật chơi), chops, instant wins, full ranking, per-turn timer, optional house rules and scoring (thối heo, thối hàng, cóng, chặt heo paid to the chopper, bigger instant wins), room scoreboard or play-money wallets (host sets the starting amount and the stake per point; broke players watch), hints, drag-to-arrange hand, computer players (bots) |
| Cờ tỉ phú (property-trading game) | Playable: original design on a 28-square loop through 16 Ho Chi Minh City streets, 2-6 players; win by holding three whole routes at the end of a month, or be the last player not bankrupt (3-year limit); auctions for declined slots, takeovers (landmarks are safe), luck and opportunity cards, monthly city events and yearly fee growth, business chains, dice or scarce move cards, credit limits and forced sales, player trades, paced animations, computer players (bots), in-app rules |
| Caro (gomoku) | Playable: 15×15 or 19×19 board, optional Vietnamese blocked-ends rule, chess-style clocks, draws, takebacks, move review, bots at three levels (hard searches for forced wins by fours and threes), in-app rules |
| Cờ cá ngựa (horse race) | Playable: 2-4 players, traditional Vietnamese rules (a 6 to come out and roll again, no jumping, kicking, exact home gate, numbered home steps), optional jumping, fast climb home and coming out on a 1, bots, in-app rules |
| Nối từ tiếng Việt (word chain) | Playable: 2-8 players, two-syllable words linked by syllable (either tone-mark placement, hoà or hòa, is accepted), turn timer, knock-outs, a word nothing can follow is refused, bots that know part of the dictionary and prefer everyday words. Word list: about 18,000 words from Wiktionary via kaikki.org, CC BY-SA 4.0 (server/data/noitu-words.txt), plus a supplement of about 700 everyday words (server/data/noitu-extra.txt) and an everyday list for bots and starting words (server/data/noitu-common.txt), both hand-written for this project |
| English word chain | Playable: 2-8 players, each word starts with the previous word's last letter, same knock-out rules as nối từ; ENABLE word list (public domain, server/data/wordchain-words.txt) with rude words removed, plus about 100 newer everyday words such as internet, email and website (server/data/wordchain-extra.txt, hand-written for this project); bots prefer everyday words |
| Bầu cua | Playable: 2-10 players, bets of play chips on six animals over 10 rounds against the house or a player (or bot) the host seats as banker, room play-money wallets, shaken bowl that lifts to show three dice, computer players (bots), in-app rules |
| Xì dách | Playable: 2-8 players over 10 rounds against the house or a player (or bot) the host seats as dealer, who plays last, can check hands early (xét bài) and pays from their own chips, room play-money wallets, dealer cards face down, busts kept hidden, play-chip stakes, Vietnamese hands (xì bàn, xì dách, ngũ linh, quắc), 16 to stand, dealer draws to 16, others' cards hidden until the reveal, computer players (bots), in-app rules |
| Lô tô (Vietnamese bingo) | Playable: up to 16 players buy 1-2 tickets (9 rows of 5 numbers), the house calls 1-90 at the host's chosen speed, mark by hand or auto-mark, optional Vietnamese read-aloud (browser voice), first to shout Kinh! on a full row takes the pot (ties share, a wrong kinh is out), points or room play money, computer players (bots), in-app rules |
| Ma sói (werewolf) | Planned, listed in the lobby as coming soon |

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
