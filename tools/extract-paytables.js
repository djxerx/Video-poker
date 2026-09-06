#!/usr/bin/env node
// Pull every game, pay table and payout straight out of the app, so the
// comparison sheets can never drift from what the game actually deals.
//
//   node tools/extract-paytables.js          → tools/paytables.json
//
// Reads index.html (the GAMES block + its row-builder functions) and
// strategy-data/*.json (for each table's exact optimal return). Nothing is
// hand-transcribed: the row builders are executed, not parsed.
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const grab = n => {
  const m = src.match(new RegExp('function ' + n + '\\s*\\([\\s\\S]*?\\n\\}', 'm'));
  if (!m) throw new Error('missing function ' + n);
  return m[0];
};

// Execute the app's own row builders in a sandboxed function scope
const BUILDERS = ['jobRows', 'tensRows', 'aaRows', 'bonusRows', 'bpdRows', 'ddbRows',
                  'tbRows', 'tdbRows', 'sdbRows', 'sddbRows', 'jokerRows', 'jtpRows',
                  'deucesRows', 'bdRows'];
const consts = ['mult', 'ROYAL', 'NADA']
  .map(c => src.match(new RegExp('const ' + c + '\\b[^\\n]*\\n'))[0]).join('');
const R = new Function(consts + BUILDERS.map(grab).join('\n') +
                       `;return {${BUILDERS.join(',')}};`)();

// Game order and wild classification come from the app's own GAME_KEYS list
const GAME_KEYS = JSON.parse(src.match(/const GAME_KEYS\s*=\s*\[([\s\S]*?)\];/)[1]
  .replace(/\/\/[^\n]*/g, '').replace(/'/g, '"').replace(/,\s*$/, '').trim()
  .replace(/^/, '[').replace(/$/, ']'));

const WILD = { joker: 'Joker Wild', joker2: 'Joker Wild', deuces: 'Deuces Wild', bdeuces: 'Deuces Wild' };

const games = [];
for (const key of GAME_KEYS) {
  const i = src.indexOf('\n  ' + key + ': {');
  if (i < 0) throw new Error('game not found: ' + key);
  const blk = src.slice(i, src.indexOf('winCards', i));
  // the two Joker games are double-quoted because the name has an apostrophe
  const nm = /name: *'((?:[^'\\]|\\.)*)'|name: *"((?:[^"\\]|\\.)*)"/.exec(blk);
  if (!nm) throw new Error('could not read name for game ' + key);
  const name = (nm[1] ?? nm[2]).replace(/\\(['"])/g, '$1');
  const tables = [...blk.matchAll(/\{ label:'([^']+)',\s*rows: (\w+)\(([^)]*)\)(?:,\s*strat:'(\w+)')?/g)]
    .map(m => {
      const args = m[3].trim() ? m[3].split(',').map(s => Number(s.trim())) : [];
      const rows = R[m[2]](...args);
      let ret = null;
      if (m[4]) {
        const f = path.join(ROOT, 'strategy-data', m[4] + '.json');
        if (fs.existsSync(f)) ret = JSON.parse(fs.readFileSync(f, 'utf8')).optimalReturn * 100;
      }
      return {
        label: m[1], strat: m[4] || null, return: ret,
        // max-bet column (5 coins) — what the machine pays for a full wager
        pays: Object.fromEntries(rows.filter(r => r.name !== 'Nothing').map(r => [r.name, r.pays[4]])),
      };
    });
  games.push({ key, name, type: WILD[key] || 'Standard', deck: /joker: true/.test(blk) ? 53 : 52, tables });
}

// Union of hand names, ordered roughly by descending payout. Ties fall back to
// a canonical poker order so Flush lands above Straight when both pay the same.
const RANK = ['Natural Royal', 'Royal Flush', '4 Aces + 2-4', '4 Aces + J-K', '4 2s–4s + A-4',
  '4 Js–Ks + A-K', 'Four Deuces + Ace', 'Four Deuces', 'Five of a Kind', 'Five Aces',
  'Five 3s–5s', 'Five 6s–Ks', 'Wild Royal', 'Straight Flush', 'Four Aces', 'Four Js–Ks',
  'Four 2s–4s', 'Four 5s–Ks', 'Four 5s–10s', 'Four of a Kind', 'Full House', 'Flush',
  'Straight', 'Three of a Kind', 'Two Pair', 'Jacks or Better', 'Kings or Better', 'Tens or Better'];
const best = new Map();
for (const g of games) for (const t of g.tables) for (const [h, v] of Object.entries(t.pays))
  best.set(h, Math.max(best.get(h) || 0, v));
const unknown = [...best.keys()].filter(h => !RANK.includes(h));
if (unknown.length) console.error('WARNING: hands missing from the RANK order (appended): ' + unknown.join(', '));
const hands = [...best.keys()].sort((a, b) =>
  best.get(b) - best.get(a) ||
  ((RANK.indexOf(a) + 1 || 99) - (RANK.indexOf(b) + 1 || 99)));

// Heat-map baseline: every hand mapped to its Jacks or Better equivalent.
// Quad tiers all compare against JoB's single "Four of a Kind" line, which is
// the whole point of a bonus game. Five-of-a-kind hands have no equivalent.
const BASELINE = {
  'Natural Royal': 'Royal Flush', 'Royal Flush': 'Royal Flush', 'Wild Royal': 'Royal Flush',
  'Straight Flush': 'Straight Flush',
  '4 Aces + 2-4': 'Four of a Kind', '4 Aces + J-K': 'Four of a Kind',
  '4 2s–4s + A-4': 'Four of a Kind', '4 Js–Ks + A-K': 'Four of a Kind',
  'Four Aces': 'Four of a Kind', 'Four Js–Ks': 'Four of a Kind', 'Four 2s–4s': 'Four of a Kind',
  'Four 5s–Ks': 'Four of a Kind', 'Four 5s–10s': 'Four of a Kind', 'Four of a Kind': 'Four of a Kind',
  'Four Deuces': 'Four of a Kind', 'Four Deuces + Ace': 'Four of a Kind',
  'Full House': 'Full House', 'Flush': 'Flush', 'Straight': 'Straight',
  'Three of a Kind': 'Three of a Kind', 'Two Pair': 'Two Pair',
  'Jacks or Better': 'Jacks or Better', 'Tens or Better': 'Jacks or Better',
  'Kings or Better': 'Jacks or Better',
  'Five of a Kind': null, 'Five Aces': null, 'Five 3s–5s': null, 'Five 6s–Ks': null,
};
for (const h of hands) if (!(h in BASELINE)) BASELINE[h] = null;

const out = {
  generated: new Date().toISOString().slice(0, 10),
  note: 'Payouts are the max-bet (5-coin) column. Generated by tools/extract-paytables.js — do not edit by hand.',
  baselineGame: 'jacks', baselineTable: 0,
  hands, baseline: BASELINE, games,
};
const dest = path.join(__dirname, 'paytables.json');
fs.writeFileSync(dest, JSON.stringify(out, null, 1));
const nT = games.reduce((s, g) => s + g.tables.length, 0);
console.log(`wrote ${path.relative(ROOT, dest)} — ${games.length} games, ${nT} pay tables, ${hands.length} distinct hands`);
