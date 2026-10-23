// Tiny observable store + localStorage persistence for the run.
import type { RunState } from '../core/types';

export const SAVE_KEY = 'revlotto.run.v3';
/** Older save keys: incompatible (v1: no car/heat/bosses; v2: pre-brand part ids), dropped on first read. */
const OLD_KEYS = ['revlotto.run.v1', 'revlotto.run.v2'];

type Listener = (s: RunState) => void;

export class Store {
  private listeners = new Set<Listener>();
  constructor(public state: RunState) {}

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  replace(s: RunState): void {
    this.state = s;
    this.commit();
  }

  /** Persist and notify. Call after every mutation. */
  commit(): void {
    saveRun(this.state);
    for (const cb of [...this.listeners]) {
      try {
        cb(this.state);
      } catch (e) {
        console.error('[game] subscriber threw', e);
      }
    }
  }
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function saveRun(s: RunState): void {
  try {
    storage()?.setItem(SAVE_KEY, JSON.stringify(s));
  } catch {
    /* quota / private mode: ignore */
  }
}

export function readSavedRun(): unknown {
  try {
    for (const k of OLD_KEYS) storage()?.removeItem(k);
    const raw = storage()?.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSavedRun(): void {
  try {
    storage()?.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}
