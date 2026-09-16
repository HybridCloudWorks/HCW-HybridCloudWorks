/**
 * The tab resolver, which is the only thing standing between a `?tab=` value
 * and the page picking a panel out of an object.
 *
 * The assertions are the shared contract (../tabContract.js). What is specific
 * to Labs is the route and the two old ids: `setup` was the third tab before
 * #577 split it into Agents and Settings, and `history` was how the job table
 * was reached when it was the bottom of Dashboard.
 */
import * as tabs from './tabs';
import { describeTabResolver } from '../tabContract';

describeTabResolver(tabs, {
  route: '/admin/labs',
  redirects: { setup: 'settings', history: 'jobs' },
});
