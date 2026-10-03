/**
 * Forge Studio's tab resolver — the shared contract (tabContract.js) plus the
 * addresses that matter here: every word the old configuration form went by
 * lands on Voice & profile, not on an empty workspace.
 */
import * as tabs from './tabs';
import { describeTabResolver } from '../tabContract';

describeTabResolver(tabs, {
  route: '/admin/forge-studio',
  redirects: {
    config: 'voice',
    profile: 'voice',
    prompts: 'voice',
    calibration: 'voice',
    settings: 'voice',
    new: 'start',
    workspace: 'draft',
    review: 'finish',
  },
});
