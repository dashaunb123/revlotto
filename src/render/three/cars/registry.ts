// Body builders by body type. Each file is owned by one modeler agent (see the 3D brief).
import type { BodyType } from '../../car';
import type { BodyBuilder } from '../types';
import compactBody from './bodies/compact';
import muscleBody from './bodies/muscle';
import wedgeBody from './bodies/wedge';
import truckBody from './bodies/truck';
import superBody from './bodies/super';
import sedanBody from './bodies/sedan';
import hatchBody from './bodies/hatch';
import tunerBody from './bodies/tuner';
import brickBody from './bodies/brick';
import widebodyBody from './bodies/widebody';
import hyperBody from './bodies/hyper';

export const BODY_BUILDERS: Record<BodyType, BodyBuilder> = {
  compact: compactBody,
  muscle: muscleBody,
  wedge: wedgeBody,
  truck: truckBody,
  super: superBody,
  sedan: sedanBody,
  hatch: hatchBody,
  tuner: tunerBody,
  brick: brickBody,
  widebody: widebodyBody,
  hyper: hyperBody,
};
