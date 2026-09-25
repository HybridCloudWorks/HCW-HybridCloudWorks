/**
 * `providers.tf` (#667): the default azurerm and azapi providers, the alz
 * provider with its library reference, and an azurerm and an azapi alias
 * per placed subscription, which is how each module is pointed at the
 * subscription it deploys into.
 */
import {
  ALZ_LIBRARY_REFERENCE,
  PROVIDER_NAMES,
  SUBSCRIPTION_SCOPED_PROVIDERS,
} from '../avmVersions';
import { isSelected } from '../state';
import { block, body, file, q } from './format';
import { placements } from './subscriptions';

const HEADER = [
  '# The default providers take the tenant, subscription and credentials from the',
  '# ARM_TENANT_ID, ARM_SUBSCRIPTION_ID, ARM_CLIENT_ID and ARM_CLIENT_SECRET variables',
  '# of the HCP Terraform workspace. The aliases below point each module at the',
  '# subscription it deploys into, which is how a landing zone keeps management,',
  '# connectivity, identity and every application apart. random, modtm and time have',
  '# no subscription; the modules that require them are given these defaults.',
];

/** Providers with no subscription: one default block each, so the module maps have a target. */
const DEFAULT_ONLY = PROVIDER_NAMES.filter(
  (p) => p !== 'alz' && !SUBSCRIPTION_SCOPED_PROVIDERS.includes(p)
);

function alzProvider() {
  return [
    '',
    '# The alz provider reads the "alz" architecture (the management group tree and',
    '# the policy baseline) from this release of the Azure Landing Zones library.',
    ...block('provider "alz"', [
      [
        'library_references',
        [
          '[{',
          ...body([
            ['path', q(ALZ_LIBRARY_REFERENCE.path)],
            ['ref', q(ALZ_LIBRARY_REFERENCE.ref)],
          ]),
          '}]',
        ],
      ],
    ]),
  ];
}

function aliases({ key, variable }) {
  return [
    '',
    ...block('provider "azurerm"', [
      ['alias', q(key)],
      ['subscription_id', variable],
      'features {}',
    ]),
    '',
    ...block('provider "azapi"', [
      ['alias', q(key)],
      ['subscription_id', variable],
    ]),
  ];
}

export function providersTf(state) {
  const lines = [
    ...HEADER,
    ...block('provider "azurerm"', ['features {}']),
    '',
    'provider "azapi" {}',
    ...DEFAULT_ONLY.flatMap((p) => ['', `provider "${p}" {}`]),
  ];
  if (isSelected(state, 'management-groups')) lines.push(...alzProvider());
  for (const placement of placements(state)) lines.push(...aliases(placement));
  return file('providers.tf', lines);
}
