// Which kit parts a car wears: from its part tiers (same rules as the 2D renderer), overridden per PARAGON so each
// brand's transformed car is instantly that car (paint/decals come from Look's livery; the 3D parts come from here).
import type { BodyType } from '../../../car';
import type { CarSpec } from '../../types';

export type WingStyle = 'none' | 'lip' | 'pedestal' | 'big' | 'swan' | 'hoop' | 'acr' | 'svj';
export type HoodStyle = 'none' | 'bulge' | 'cowl' | 'scoop' | 'shaker' | 'itb' | 'vents' | 'turbo' | 'blower';
export type ExhaustStyle = 'stock' | 'single' | 'dual' | 'quad' | 'side' | 'triple' | 'center2';

export interface KitStyle {
  wing: WingStyle;
  /** 'paint' | 'accent' | 'black' | 'carbon' */
  wingFinish: 'paint' | 'accent' | 'black' | 'carbon';
  endplate: 'accent' | 'black' | 'carbon' | 'paint';
  hood: HoodStyle;
  intercooler: boolean;
  /** Forced induction on mid-engine cars: side intake ducts with an intercooler core inside (no FMIC). */
  sideIntakes: boolean;
  exhaust: ExhaustStyle;
  splitter: 0 | 1 | 2;
  canards: boolean;
  skirts: boolean;
  diffuser: boolean;
  carbonHood: boolean;
  nitrous: boolean;
  wheelieBar: boolean;
  chute: boolean;
  grille?: 'black' | 'honeycomb';
}

const MID: BodyType[] = ['wedge', 'hyper'];
const TRACKY: BodyType[] = ['tuner', 'hatch', 'compact', 'sedan', 'super', 'hyper', 'wedge'];

export function kitStyle(spec: CarSpec): KitStyle {
  const p = spec.parts;
  const s: KitStyle = {
    wing: p.aero === 'street' ? 'lip' : p.aero === 'sport' ? 'pedestal' : p.aero === 'pro' ? (TRACKY.includes(spec.body) ? 'swan' : 'big') : 'none',
    wingFinish: p.carbon && p.aero !== 'street' ? 'carbon' : p.aero === 'pro' ? 'black' : p.aero === 'street' ? 'paint' : 'accent',
    endplate: p.aero === 'pro' ? 'accent' : 'black',
    hood:
      p.forcedInduction === 'pro' ? 'blower'
      : p.forcedInduction === 'sport' ? 'turbo'
      : p.intake === 'pro' ? 'itb'
      : p.intake === 'sport' ? 'shaker'
      : p.intake === 'street' ? 'scoop'
      : p.engine === 'sport' || p.engine === 'pro' ? 'cowl'
      : p.engine === 'street' ? 'bulge'
      : 'none',
    intercooler: p.forcedInduction === 'street' || p.forcedInduction === 'sport',
    sideIntakes: false,
    exhaust: p.exhaust === 'street' ? 'single' : p.exhaust === 'sport' ? 'dual' : p.exhaust === 'pro' ? 'quad' : 'stock',
    splitter: p.aero === 'pro' ? 2 : p.aero === 'sport' ? 1 : 0,
    canards: p.aero === 'pro',
    skirts: p.aero === 'pro',
    diffuser: p.aero === 'pro',
    carbonHood: p.carbon,
    nitrous: p.nitrous,
    wheelieBar: p.suspension === 'pro',
    chute: p.suspension === 'pro' && p.tires === 'pro',
  };
  if (spec.body === 'super' && (p.exhaust === 'sport' || p.exhaust === 'pro')) s.exhaust = 'side';
  // no front-mount intercooler where there is no engine up front (wedge/hyper) or no room in the nose (super):
  // mid-engine cars breathe through side ducts; the super gets hood louvres
  if (MID.includes(spec.body) && s.intercooler) Object.assign(s, { intercooler: false, sideIntakes: true });
  if (spec.body === 'super' && s.intercooler) {
    s.intercooler = false;
    if (s.hood === 'none' || s.hood === 'bulge' || s.hood === 'cowl' || s.hood === 'scoop') s.hood = 'vents';
  }
  switch (spec.paragon) {
    case 'malibru': // sleeper: no wing, blacked-out grille, cowl hood, dual pipes
      Object.assign(s, { wing: 'none', grille: 'black', hood: 'cowl', exhaust: 'dual', splitter: 0 });
      break;
    case 'civique': // big black swan-neck wing, red-edged lip, triple centre exhaust, honeycomb grille, skirts
      Object.assign(s, { wing: 'swan', wingFinish: 'black', endplate: 'accent', exhaust: 'triple', grille: 'honeycomb', splitter: 1, skirts: true, canards: false });
      break;
    case 'stallion': // ducktail, hood scoop, quad pipes, chin splitter
      Object.assign(s, { wing: 'lip', hood: 'scoop', exhaust: 'quad', splitter: 1 });
      break;
    case 'avenger': // shaker hood, ducktail
      Object.assign(s, { wing: 'lip', hood: 'shaker', exhaust: 'dual' });
      break;
    case 'kaiju': // body-colour hoop wing, intercooler, turbo hood
      Object.assign(s, { wing: 'hoop', wingFinish: 'paint', endplate: 'paint', intercooler: true, hood: 'turbo', exhaust: 'single' });
      break;
    case 'viperion': // huge black ACR wing, deep splitter + dive planes, side pipes, hood louvres
      Object.assign(s, { wing: 'acr', wingFinish: 'black', endplate: 'black', splitter: 2, canards: true, skirts: true, exhaust: 'side', hood: 'vents', diffuser: true });
      break;
    case 'hellkat': // blower, slicks, wheelie bar, NOS, chute
      Object.assign(s, { wing: 'lip', hood: 'blower', wheelieBar: true, nitrous: true, chute: true, exhaust: 'quad' });
      break;
    case 'lamberghoul': // black wing, carbon, splitter, skirts, diffuser, high centre pipes
      Object.assign(s, { wing: 'svj', wingFinish: 'carbon', endplate: 'carbon', carbonHood: true, splitter: 2, skirts: true, diffuser: true, canards: false, exhaust: 'center2', hood: 'none' });
      break;
  }
  return s;
}
