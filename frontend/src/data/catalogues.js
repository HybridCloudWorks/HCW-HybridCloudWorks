/**
 * Every Learn catalogue this repository hand-maintains, by provider — the one
 * list (#818).
 *
 * `education-catalogues.test.js` checks each of these against the calendar,
 * and `scripts/catalogue-due-soon.mjs` warns weeks before that check will go
 * red. Both read this map, so a catalogue added here is covered by the alarm
 * and the warning together, and neither can cover a catalogue the other
 * misses.
 *
 * Relative imports, not `@/`, so the warning script can load this file with
 * plain Node and no bundler.
 */
import * as ansible from './ansible/education.js';
import * as aws from './aws/certifications.js';
import * as azure from './azure/certifications.js';
import * as docker from './docker/education.js';
import * as finops from './finops/education.js';
import * as gcp from './gcp/certifications.js';
import * as github from './github/certifications.js';
import * as terraform from './terraform/certifications.js';
import * as vmware from './vmware/education.js';

// Docker's catalogue has rows since #778: two credentials other organizations
// issue, because Docker runs no exam of its own (see its module).
export const CATALOGUES = Object.freeze({
  ansible,
  aws,
  azure,
  docker,
  finops,
  gcp,
  github,
  terraform,
  vmware,
});
