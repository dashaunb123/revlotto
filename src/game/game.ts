// PLACEHOLDER: replaced by the run/economy agent. Must export `game: GameApi`.
import type { GameApi } from '../core/api';

export const game: GameApi = new Proxy({} as GameApi, {
  get(_t, prop) {
    throw new Error(`game.${String(prop)} not implemented yet`);
  },
});
