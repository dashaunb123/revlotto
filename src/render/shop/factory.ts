// Builds Cards for shop items, pack cards and inventory.
import Phaser from 'phaser';
import type { PackCard, ShopItem } from '../../core/types';
import { game } from '../../game/game';
import { PAL, RARITY_COLOR, TIER_COLOR } from '../palette';
import { SLOT_SHORT, consumableIcon, passiveIcon, slotIcon } from '../icons';
import { Card } from './card';

const PASSIVE_ACCENT = { common: PAL.blue, uncommon: PAL.teal, rare: PAL.pink } as const;
const CONS_ACCENT = { common: PAL.green, uncommon: PAL.teal, rare: PAL.pink } as const;
const PART_ACCENT = { stock: 0x6b6680, street: TIER_COLOR.street, pro: TIER_COLOR.pro } as const;

type Kindish = { kind: 'part'; partId: string } | { kind: 'passive'; passiveId: string } | { kind: 'consumable'; consumableId: string } | { kind: 'tuning' };

export function cardFor(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  what: Kindish,
  price?: number | null,
  iconScale = 2,
): Card {
  switch (what.kind) {
    case 'part': {
      const d = game.part(what.partId);
      return new Card(scene, x, y, { w, h, accent: PART_ACCENT[d.tier], band: SLOT_SHORT[d.slot], icon: slotIcon(d.slot), iconScale, name: d.name, price });
    }
    case 'passive': {
      const d = game.passive(what.passiveId);
      return new Card(scene, x, y, {
        w, h, accent: PASSIVE_ACCENT[d.rarity] ?? RARITY_COLOR[d.rarity], band: 'PASSIVE',
        icon: passiveIcon(scene, d.id, d.name), iconScale, name: d.name, price,
      });
    }
    case 'consumable': {
      const d = game.consumable(what.consumableId);
      return new Card(scene, x, y, {
        w, h, accent: CONS_ACCENT[d.rarity] ?? RARITY_COLOR[d.rarity], band: '1 RACE',
        icon: consumableIcon(scene, d.id, d.name), iconScale, name: d.name, price,
      });
    }
    default:
      return new Card(scene, x, y, { w, h, accent: PAL.yellow, band: 'TUNING', icon: 'tuning', iconScale, name: 'Tuning Card', price });
  }
}

export const shopItemCard = (scene: Phaser.Scene, x: number, y: number, it: ShopItem) =>
  cardFor(scene, x, y, 64, 92, it as Kindish, it.price);

export const packCardCard = (scene: Phaser.Scene, x: number, y: number, c: PackCard) => cardFor(scene, x, y, 84, 112, c, null, 3);

/** Small inventory card: big icon, no name (tooltip has it). */
export function passiveSlotCard(scene: Phaser.Scene, x: number, y: number, id: string, order: number): Card {
  const d = game.passive(id);
  return new Card(scene, x, y, {
    w: 44, h: 60, accent: PASSIVE_ACCENT[d.rarity] ?? PAL.blue, icon: passiveIcon(scene, d.id, d.name), iconScale: 2,
    corner: String(order),
  });
}

export function consumableSlotCard(scene: Phaser.Scene, x: number, y: number, id: string): Card {
  const d = game.consumable(id);
  return new Card(scene, x, y, {
    w: 44, h: 60, accent: CONS_ACCENT[d.rarity] ?? PAL.green, icon: consumableIcon(scene, d.id, d.name), iconScale: 2,
  });
}

/** Where a picked/bought thing lands, for fly-to animations. */
export function iconKeyFor(scene: Phaser.Scene, what: Kindish): string {
  if (what.kind === 'part') return slotIcon(game.part(what.partId).slot);
  if (what.kind === 'passive') return passiveIcon(scene, what.passiveId, game.passive(what.passiveId).name);
  if (what.kind === 'consumable') return consumableIcon(scene, what.consumableId, game.consumable(what.consumableId).name);
  return 'tuning';
}
