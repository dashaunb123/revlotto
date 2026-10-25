// Player settings that live outside a run (persisted). Render mode switches the race and car showcases
// between the original pixel-art 2D look and the semi-realistic 3D mode (src/render/three).
export type RenderMode = '2d' | '3d';
export type Quality = 'low' | 'medium' | 'high';

interface Settings {
  renderMode: RenderMode;
  quality: Quality;
}

const KEY = 'revlotto_settings';
const DEFAULTS: Settings = { renderMode: '2d', quality: 'high' };
let cur: Settings = load();
const subs = new Set<(s: Settings) => void>();

function load(): Settings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cur));
  } catch {
    /* storage blocked: settings last for this session only */
  }
  subs.forEach((cb) => cb(cur));
}

export const settings = {
  get: (): Readonly<Settings> => cur,
  renderMode: (): RenderMode => cur.renderMode,
  setRenderMode(m: RenderMode) {
    cur = { ...cur, renderMode: m };
    save();
  },
  setQuality(q: Quality) {
    cur = { ...cur, quality: q };
    save();
  },
  subscribe(cb: (s: Settings) => void): () => void {
    subs.add(cb);
    return () => subs.delete(cb);
  },
};
