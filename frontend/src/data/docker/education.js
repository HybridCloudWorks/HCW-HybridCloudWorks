/**
 * docker education data.
 *
 * DELIBERATELY EMPTY. Docker joined the provider list on 2026-09-28 with
 * placeholder pages only, and `/docker/education` says its learning tracks are
 * coming rather than listing any. This module exists because every provider
 * must have one (`provider-coverage.test.js`): a provider with no catalogue
 * file is a Learn page nothing checks against the calendar.
 *
 * No certification is listed, so nothing here is a claim about what Docker
 * offers. `DATA_AS_OF` is the day the empty list was written, not the day a
 * vendor catalogue was checked. When rows are added, check them against the
 * vendor, move `DATA_AS_OF` to that day, and point `DATA_SOURCE` at the page
 * the rows came from, as the other catalogues do.
 */
export const DATA_AS_OF = '2026-09-28';

export const DATA_SOURCE = {
  label: 'Docker documentation',
  url: 'https://docs.docker.com/',
};

export const certifications = [];
