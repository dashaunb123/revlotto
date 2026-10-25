// 'widebody' body: the "Hellkat" widebody (after the Challenger Hellcat Widebody). Shares the hand-built Avenger
// (brick.ts) with bolt-on riveted flares + swollen fenders, a deeper carbon splitter, the air-catcher inner lamp,
// the airgrabber hood with twin heat extractors, quad tips and a wider stance.
import type { BodyBuild, CarSpec } from '../../types';
import { buildAvenger } from './brick';

export default function build(spec: CarSpec): BodyBuild {
  return buildAvenger(spec, true);
}
