# How to Add a New Game Variant

All game logic lives in one file: `index.html`. A game is defined by four
things: a **pay-table row builder**, a **GAMES entry**, an **evaluator**
(hand → category index), and a **winning-cards helper** (category → which
of the 5 card positions to highlight). Everything else — bankroll, history,
graphs, trainer, analysis worker, non-optimal-plays viewer, classic theme —
picks the new game up automatically from those four pieces.

Work through the steps in order. Search strings are given so you can find
each location; line numbers drift.

## Step 0 — Research the pay tables

Get real casino pay tables (per-coin payouts + expected return %) from
Wizard of Odds (e.g. https://wizardofodds.com/games/video-poker/tables/...
or the cheat sheet PDF at /pdf/video-poker-cheat-sheet.pdf). Pick the
full-pay table plus 1–2 common short-pay variants. Convention used here:
payouts are PER COIN; the Royal/Natural Royal row is a literal 5-element
array `[250,500,750,1000,4000]` (jackpot bonus at max coins); every other
row uses `mult(n)` = `[n,2n,3n,4n,5n]`.

## Step 1 — Row builder  (search: `function jobRows`)

Add a `function xxxRows(...)` next to the other builders. Each row is
`{ name, short, col, pays }`:
- `name`  — display name; MUST be unique within the game and stable across
  its pay-table variants (the graph re-prices old hands by matching names).
- `short` — pay-table cell label, `\n` = line break.
- `col`   — short column header for the Analyze table.
- End the array with `NADA` (the Nothing row).
- Order rows best-hand-first; the evaluator returns the row's index.
Parameterize whatever varies between casino pay tables (e.g. `fh, fl`).

## Step 2 — Evaluator  (search: `function evalBonusStyle`)

Write `function evalXxx(cards)` returning the category INDEX into your row
array (Nothing = last index). Reuse the primitives:
- `evaluate(cards, highPairs?)` — standard 10-category JoB evaluator;
  `highPairs` overrides the paying-pair ranks (e.g. `['K','A']` for
  kings-or-better, `['10','J','Q','K','A']` for tens-or-better).
- Quad-split games: call `evaluate()`, then if base === 2 (four of a kind)
  split by quad rank / kicker, else shift the remaining categories by the
  number of extra rows you inserted. See `evalDDB`, `evalSuperDDB`.
- Wild games: see `evalDeuces` / `evalJoker` for wild-count logic, or wrap
  them like `evalBonusDeuces` / `evalJokerTP` do.
MUST be a top-level `function` declaration (its `.toString()` is shipped
into the Web Worker). No references to globals other than `RANKS` and the
other shipped functions listed in Step 5.

## Step 3 — Winning-cards helper  (search: `function winCardsStandard`)

`function winCardsXxx(cat, h = hand)` returns the indices (0–4) of the
cards that form the winning hand — used for the win flash and the
Non-Optimal Plays viewer. Usually you just map your category layout onto an
existing helper: `winCardsStandard(base, isBonus, h)` (non-wild),
`winCardsDeuces(cat, h)` (wild). Kicker categories should return
`[0,1,2,3,4]` (all five matter). ALWAYS accept and forward the `h`
parameter — the viewer passes stored hands.

## Step 4 — GAMES entry + key  (search: `const GAMES = {`)

Add an entry:
```js
  mykey: {
    name: 'My Game Name',
    titleHTML: '<span class="t-red">My</span> <span class="t-yellow">Game</span>',
    joker: true,            // ONLY for 53-card joker games (adds the joker)
    payTables: [
      { label:'9/6 Full Pay', rows: xxxRows(9,6) },
      { label:'8/5',          rows: xxxRows(8,5) },
    ],
    evaluate: cards => evalXxx(cards),
    winCards: (cat, h) => winCardsXxx(cat, h),
  },
```
Then add `'mykey'` to `GAME_KEYS` (search: `const GAME_KEYS`) — order is
the game-select menu order; keep non-wild games before wild games.
Per-game bankroll/history/persistence needs nothing else: `gameState`
is built from `GAME_KEYS` automatically.

## Step 5 — Register the evaluator in the Web Worker
(search: `function evWorkerSource`)

Two changes, or the background analysis silently breaks for the new game:
1. Add `evalXxx` to the `fns` array (it's serialized via `.toString()`).
   Also add any new helper it calls.
2. Add `mykey: evalXxx` to the `EVAL_FNS` map string just below.

## Step 6 — Optional touches

- Jackpot fanfare: search `const jackpot =` in the draw branch and add the
  game's top-line categories if it has jackpot-tier hands beyond index 0.
- Deuces-style WILD corner text on cards is keyed to
  `currentGame === 'deuces'` in `buildCardFace` — extend if the new game
  has wild ranks that should be labeled.

## Step 7 — Update the docs

Add the game, its hands/payouts, and its variations with return % to
`GAME-PAYTABLES.txt` (non-wild section first, then wild).

## Step 8 — Test checklist

1. Open the game via the Game button; pay table renders (row count = your
   paying rows; the classic theme shows the 5-column table).
2. Unit-test the evaluator in the console with crafted hands — especially
   kicker splits, wild-completed hands, and the minimum paying pair
   (one rank BELOW the floor must return Nothing).
3. Deal + draw a hand; confirm the history entry gets `res`, and after the
   worker resolves, `sub`/`opt`/`optRes` (background analysis works ⇒
   worker registration is correct).
4. Press Analyze during a hold — the EV table must show your game's
   columns (they come from the rows' `col` labels automatically).
5. Deliberately hold nothing, draw, then check Analyze → Non-Optimal
   Plays shows the replay with correct glows.
6. Check the pay-table selector in Settings switches variants and the
   graph's "Pay Tables" comparison lists them.
7. Reload the page — game, bankroll, and history must persist.
8. Check the browser console for errors throughout.

## Gotchas

- `evaluate()` sorts/dedups internally; never mutate the `cards` argument.
- Row `name` matching: the graph's alt-pay-table lines and the viewer look
  up categories by row NAME. Same hand ⇒ same name across that game's
  variants, and never rename rows once players have history.
- The service worker serves `index.html` network-first, so deploys just
  work — but when testing locally, hard-reload once after editing.
- `showAnalysis(customHand, customDeck)`: first param must stay optional —
  the main Analyze button calls it with no args via a wrapper. Don't wire
  event listeners to it directly (the event object would be mistaken for a
  hand).
