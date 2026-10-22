// Shared pixel-art palette. Numbers for Phaser graphics, strings for Text.
export const PAL = {
  bg: 0x0b0a14,
  bgDeep: 0x07060d,
  panel: 0x1c1830,
  panelLight: 0x2b2547,
  panelEdge: 0x4a3f78,
  ink: 0xf4ecd8,
  inkDim: 0x9a8fb8,
  red: 0xe8413c,
  orange: 0xf28c28,
  yellow: 0xf7d23e,
  green: 0x5ad25a,
  teal: 0x38c6c0,
  blue: 0x3c78e8,
  purple: 0x9b4de0,
  pink: 0xf25c9a,
  cash: 0xf7d23e,
  asphalt: 0x2a2833,
  asphaltLight: 0x3a3745,
  stripe: 0xf4ecd8,
} as const;

export const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

export const TIER_COLOR = { stock: PAL.inkDim, street: PAL.teal, pro: PAL.orange } as const;
export const RARITY_COLOR = { common: PAL.inkDim, uncommon: PAL.teal, rare: PAL.pink } as const;
export const GRADE_COLOR = { perfect: PAL.green, good: PAL.yellow, miss: PAL.red } as const;

export const FONT = '"Press Start 2P", monospace';
export const GAME_W = 640;
export const GAME_H = 360;
