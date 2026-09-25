/**
 * `application.tf` (#667): one spoke per corp and online landing zone, each
 * a /24 carved from the spoke range with `cidrsubnet`, the same carve
 * cidr.js makes for the diagram. Corp spokes route through the firewall
 * when it is selected; online spokes egress directly.
 */
import { spokeAddressSpace, spokeSlot } from '../cidr';
import { isSelected } from '../state';
import { block, file, joinBlocks, obj } from './format';
import { spokeBlocks } from './spoke';
import { applicationSpokes } from './subscriptions';

/** `cidrsubnet(var.spoke_address_space, newbits, netnum)` for one landing zone. */
export function carve(spokeCidr, group, index) {
  const { newbits, netnum } = spokeSlot(spokeCidr, group, index);
  return `cidrsubnet(var.spoke_address_space, ${newbits}, ${netnum})`;
}

function header(state, spokes) {
  const carved = spokes
    .map((s) => `${s.key} = ${spokeAddressSpace(state.options.spokeCidr, s.group, s.index)}`)
    .join(', ');
  return [
    '# Application landing zones: one spoke per subscription, through the provider alias',
    '# for that subscription. The subscription is placed under its management group in',
    '# alz.tf; this file creates the network inside it and peers it to the hub. Each spoke',
    '# is one /24 from the spoke range: corp from the low half, online from the high half.',
    `# For ${state.options.spokeCidr} that is ${carved}.`,
  ];
}

export function applicationTf(state) {
  const spokes = applicationSpokes(state);
  const firewall = isSelected(state, 'firewall');
  const locals = block('locals', [
    [
      'spoke_address_spaces',
      obj(spokes.map((s) => [s.key, carve(state.options.spokeCidr, s.group, s.index)])),
    ],
  ]);
  const blocks = spokes.map((s) =>
    spokeBlocks({
      key: s.key,
      name: s.name,
      addressSpace: `local.spoke_address_spaces.${s.key}`,
      routeToFirewall: firewall && s.group === 'corp',
    })
  );
  return file('application.tf', [...header(state, spokes), ...joinBlocks([locals, ...blocks])]);
}
