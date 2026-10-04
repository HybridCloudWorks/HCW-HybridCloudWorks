/**
 * The AI Engine's tab resolver — the shared contract (tabContract.js) plus
 * the one address that matters here: the retired Site Services placeholder
 * lands on Routing, which answers the question it only pretended to.
 */
import * as tabs from './tabs';
import { describeTabResolver } from '../tabContract';

describeTabResolver(tabs, {
  route: '/admin/ai-engine',
  redirects: {
    siteservices: 'routing',
    'site-services': 'routing',
    features: 'services',
    cost: 'usage',
    servers: 'mcp',
  },
});
