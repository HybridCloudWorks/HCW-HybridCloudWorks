/** The Spotlight hub's probes (ADR 0033 §1 Platform, §8): the speaker feed behind Speaking. */
import { fromService } from '../probeKit';

export const SPOTLIGHT_PROBES = [
  fromService('sessionize', {
    hub: 'spotlight',
    covers: 'The public speaker feed behind Speaking.',
    impact: 'Speaking events stop updating.',
    action: 'Check the speaker id on the Sessionize card.',
  }),
];
