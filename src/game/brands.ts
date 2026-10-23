// Brand sets and paragons: who owns how many parts of which brand, and whether the car has transformed.
// Pure functions over the installed parts so UI, stats and sim all agree. Owned by the Core agent.
import type { InstalledPart, SlotId } from '../core/types';
import { brandById, brandParts, partById } from '../data/content';

export { brandById, brandParts };

export const SET_STEPS = [4, 8, 12] as const;

/** Installed part count per brand id. */
export function brandCounts(parts: Record<SlotId, InstalledPart>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const ip of Object.values(parts)) {
    const b = partById(ip.partId)?.brand;
    if (b) out[b] = (out[b] ?? 0) + 1;
  }
  return out;
}

/** Highest set step reached for a brand: 0, 4, 8 or 12. */
export function setLevel(parts: Record<SlotId, InstalledPart>, brand: string): 0 | 4 | 8 | 12 {
  const n = brandCounts(parts)[brand] ?? 0;
  return n >= 12 ? 12 : n >= 8 ? 8 : n >= 4 ? 4 : 0;
}

/** The brand whose paragon is active (all 12 slots), if any. */
export function activeParagon(parts: Record<SlotId, InstalledPart>): string | null {
  for (const [b, n] of Object.entries(brandCounts(parts))) if (n >= 12) return b;
  return null;
}
