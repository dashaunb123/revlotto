// Player car cosmetics: chosen look + unlocks, persisted across runs (separate from the run save).
// Looks only: nothing here touches stats. Storage can be blocked (private mode): every access
// is wrapped and falls back to defaults, so the garage still works for the session.
import { DEFAULT_LOOK, type BodyType, type CarLook, type LiveryId } from '../render/car';

const KEY = 'revlotto_cosmetics';

export type CosmeticKind = 'body' | 'color' | 'accent' | 'rim' | 'livery';

export interface CosmeticItem {
  id: string;
  name: string;
  /** '#rrggbb' for colours, the BodyType / LiveryId otherwise. */
  value: string;
  /** How to unlock it. No hint = free from the start. */
  hint?: string;
}

const free = (id: string, name: string, value: string): CosmeticItem => ({ id, name, value });
const locked = (id: string, name: string, value: string, hint: string): CosmeticItem => ({ id, name, value, hint });

export const CATALOG: Record<CosmeticKind, CosmeticItem[]> = {
  body: [
    free('compact', 'Compact', 'compact'),
    locked('muscle', 'Muscle', 'muscle', 'Beat the Round 1 boss.'),
    locked('wedge', 'Wedge', 'wedge', 'Beat the Round 2 boss.'),
    locked('truck', 'Truck', 'truck', 'Beat the Round 3 boss.'),
    locked('super', 'Super', 'super', 'Beat the final boss and win a run.'),
  ],
  color: [
    free('red', 'Rally Red', '#e8413c'),
    free('blue', 'Cobalt', '#3c78e8'),
    free('yellow', 'Taxi', '#f7d23e'),
    free('green', 'Lime', '#5ad25a'),
    free('white', 'Bone', '#f4ecd8'),
    locked('orange', 'Sunset', '#f28c28', 'Win your first race.'),
    locked('black', 'Midnight', '#24203a', 'Finish 10 races (win or lose).'),
    locked('teal', 'Lagoon', '#38c6c0', 'Win 10 races in total.'),
    locked('pink', 'Bubblegum', '#f25c9a', 'Get 3 PERFECT grades in one race.'),
    locked('purple', 'Grape', '#9b4de0', 'Win 25 races in total.'),
    locked('silver', 'Chrome', '#b8b2c8', 'Reach Round 3.'),
    locked('gold', 'Gold Rush', '#e0a82e', 'Win a run.'),
  ],
  accent: [
    free('yellow', 'Yellow', '#f7d23e'),
    free('white', 'White', '#f4ecd8'),
    free('black', 'Black', '#0b0a14'),
    free('red', 'Red', '#e8413c'),
    free('blue', 'Blue', '#3c78e8'),
    locked('teal', 'Teal', '#38c6c0', 'Win 5 races in total.'),
    locked('pink', 'Pink', '#f25c9a', 'Get 3 PERFECT grades in one race.'),
    locked('gold', 'Gold', '#e0a82e', 'Beat the Round 2 boss.'),
  ],
  rim: [
    free('silver', 'Silver', '#d6d4e4'),
    free('black', 'Black', '#2a2833'),
    free('white', 'White', '#f4ecd8'),
    locked('red', 'Red', '#e8413c', 'Win 3 races in one run.'),
    locked('bronze', 'Bronze', '#b86a2e', 'Beat the Round 1 boss.'),
    locked('gold', 'Gold', '#f7d23e', 'Beat the Round 3 boss.'),
  ],
  livery: [
    free('none', 'Plain', 'none'),
    free('stripes', 'Stripes', 'stripes'),
    locked('split', 'Two-Tone', 'split', 'Win 5 races in one run.'),
    locked('flames', 'Flames', 'flames', 'Get 4 PERFECT grades in one race.'),
    locked('checker', 'Checker', 'checker', 'Win a race by less than 0.100 s.'),
  ],
};

export const KIND_LABEL: Record<CosmeticKind, string> = { body: 'BODY', color: 'PAINT', accent: 'ACCENT', rim: 'RIMS', livery: 'LIVERY' };

interface Lifetime {
  races: number;
  wins: number;
  bestRound: number;
}

interface Save {
  look: CarLook;
  unlocked: string[]; // 'kind:id'
  life: Lifetime;
  /** Last race key recorded by recordRaceOnce (guards scene re-entry). */
  lastKey: string;
}

const ukey = (kind: CosmeticKind, id: string) => `${kind}:${id}`;

function blank(): Save {
  return { look: { ...DEFAULT_LOOK }, unlocked: [], life: { races: 0, wins: 0, bestRound: 1 }, lastKey: '' };
}

let cache: Save | null = null;

function load(): Save {
  if (cache) return cache;
  const s = blank();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const o = JSON.parse(raw) as Partial<Save>;
      if (o.look) s.look = { ...s.look, ...o.look };
      if (Array.isArray(o.unlocked)) s.unlocked = o.unlocked.filter((u) => typeof u === 'string');
      if (o.life) s.life = { ...s.life, ...o.life };
      if (typeof o.lastKey === 'string') s.lastKey = o.lastKey;
    }
  } catch {
    /* storage blocked or corrupt: defaults */
  }
  cache = s;
  s.look = sanitize(s.look);
  return s;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(load()));
  } catch {
    /* storage blocked: keep it for this session only */
  }
}

/** Free items are always unlocked. */
export function isUnlocked(kind: CosmeticKind, id: string): boolean {
  const it = CATALOG[kind].find((i) => i.id === id);
  if (!it) return false;
  return !it.hint || load().unlocked.includes(ukey(kind, id));
}

export function unlockHint(kind: CosmeticKind, id: string): string {
  return CATALOG[kind].find((i) => i.id === id)?.hint ?? '';
}

export function unlockedCount(): { have: number; total: number } {
  let have = 0;
  let total = 0;
  for (const kind of Object.keys(CATALOG) as CosmeticKind[])
    for (const it of CATALOG[kind]) {
      total++;
      if (isUnlocked(kind, it.id)) have++;
    }
  return { have, total };
}

/** Catalog item currently selected for a kind (matched by value). */
export function selectedId(look: CarLook, kind: CosmeticKind): string {
  const v = kind === 'color' ? look.color : kind === 'accent' ? look.accent : kind === 'rim' ? look.rim : kind === 'body' ? look.body : look.livery;
  return CATALOG[kind].find((i) => i.value.toLowerCase() === String(v).toLowerCase())?.id ?? '';
}

/** Copy of the look with one kind set to a catalog item. */
export function withItem(look: CarLook, kind: CosmeticKind, id: string): CarLook {
  const it = CATALOG[kind].find((i) => i.id === id);
  if (!it) return look;
  const l = { ...look };
  if (kind === 'body') l.body = it.value as BodyType;
  else if (kind === 'livery') l.livery = it.value as LiveryId;
  else l[kind] = it.value;
  return l;
}

/** Anything locked (e.g. a save edited by hand) falls back to the default for that kind. */
function sanitize(look: CarLook): CarLook {
  let l = { ...look };
  for (const kind of Object.keys(CATALOG) as CosmeticKind[]) {
    const id = selectedId(l, kind);
    if (!id || !isUnlocked(kind, id)) l = withItem(l, kind, selectedId(DEFAULT_LOOK, kind) || CATALOG[kind][0].id);
  }
  l.number = Math.max(0, Math.min(99, Math.round(Number(l.number) || 0)));
  return l;
}

export function loadLook(): CarLook {
  return { ...load().look };
}

export function saveLook(look: CarLook) {
  load().look = sanitize(look);
  persist();
}

// ---------------------------------------------------------------------------------------------
// Unlock rules

export interface RaceSummary {
  won: boolean;
  round: number;
  boss: boolean;
  perfects: number;
  /** targetEt - et (positive = won by). */
  margin?: number;
  /** Races won so far this run, including this one. */
  runWins?: number;
}

type Rule = [CosmeticKind, string, (r: RaceSummary, life: Lifetime) => boolean];

const RULES: Rule[] = [
  ['color', 'orange', (r) => r.won],
  ['color', 'black', (_r, l) => l.races >= 10],
  ['color', 'teal', (_r, l) => l.wins >= 10],
  ['color', 'pink', (r) => r.perfects >= 3],
  ['color', 'purple', (_r, l) => l.wins >= 25],
  ['color', 'silver', (_r, l) => l.bestRound >= 3],
  ['color', 'gold', (r) => r.won && r.boss && r.round >= 4],
  ['accent', 'teal', (_r, l) => l.wins >= 5],
  ['accent', 'pink', (r) => r.perfects >= 3],
  ['accent', 'gold', (r) => r.won && r.boss && r.round >= 2],
  ['rim', 'red', (r) => (r.runWins ?? 0) >= 3],
  ['rim', 'bronze', (r) => r.won && r.boss && r.round >= 1],
  ['rim', 'gold', (r) => r.won && r.boss && r.round >= 3],
  ['livery', 'split', (r) => (r.runWins ?? 0) >= 5],
  ['livery', 'flames', (r) => r.perfects >= 4],
  ['livery', 'checker', (r) => r.won && r.margin !== undefined && r.margin >= 0 && r.margin < 0.1],
  ['body', 'muscle', (r) => r.won && r.boss && r.round >= 1],
  ['body', 'wedge', (r) => r.won && r.boss && r.round >= 2],
  ['body', 'truck', (r) => r.won && r.boss && r.round >= 3],
  ['body', 'super', (r) => r.won && r.boss && r.round >= 4],
];

const KIND_SUFFIX: Record<CosmeticKind, string> = { body: 'BODY', color: 'PAINT', accent: 'ACCENT', rim: 'RIMS', livery: 'LIVERY' };

/** Call when a race ends. Returns names of anything newly unlocked (for a toast + sfx.unlock()). */
export function recordRace(r: RaceSummary): string[] {
  const s = load();
  s.life.races++;
  if (r.won) s.life.wins++;
  // winning a boss means the next round is reached
  s.life.bestRound = Math.max(s.life.bestRound, r.round + (r.won && r.boss ? 1 : 0));
  const out: string[] = [];
  for (const [kind, id, test] of RULES) {
    const k = ukey(kind, id);
    if (s.unlocked.includes(k)) continue;
    let ok = false;
    try {
      ok = test(r, s.life);
    } catch {
      ok = false;
    }
    if (!ok) continue;
    s.unlocked.push(k);
    const it = CATALOG[kind].find((i) => i.id === id);
    out.push(`${(it?.name ?? id).toUpperCase()} ${KIND_SUFFIX[kind]}`);
  }
  persist();
  return out;
}

/** recordRace, but at most once per key (e.g. seed + history length), so re-entering a scene can't double count. */
export function recordRaceOnce(key: string, r: RaceSummary): string[] {
  const s = load();
  if (s.lastKey === key) return [];
  s.lastKey = key;
  return recordRace(r);
}
