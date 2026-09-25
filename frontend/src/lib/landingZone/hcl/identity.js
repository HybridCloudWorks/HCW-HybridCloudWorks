/**
 * `identity.tf` (#667): the identity subscription's spoke, the top /24 of
 * the spoke range's low half, private like a corp spoke: when the firewall
 * is selected its default route goes through it. The placement under the
 * Identity management group is in alz.tf.
 */
import { spokeAddressSpace } from '../cidr';
import { isSelected } from '../state';
import { block, file } from './format';
import { carve } from './application';
import { spokeBlocks } from './spoke';

export function identityTf(state) {
  const { spokeCidr } = state.options;
  return file('identity.tf', [
    '# Identity: the subscription for domain controllers and directory services, placed',
    '# under the Identity management group in alz.tf. Its spoke is the top /24 of the',
    `# spoke range’s low half (${spokeAddressSpace(spokeCidr, 'identity')} for ${spokeCidr}), peered to the hub so`,
    '# every corp spoke can reach a domain controller, and private like a corp spoke.',
    ...block('locals', [['identity_address_space', carve(spokeCidr, 'identity', 1)]]),
    '',
    ...spokeBlocks({
      key: 'identity',
      name: 'identity',
      addressSpace: 'local.identity_address_space',
      routeToFirewall: isSelected(state, 'firewall'),
    }),
  ]);
}
