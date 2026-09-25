/**
 * The subscriptions a build places (#667), in emission order, each with the
 * provider alias and module suffix it is known by (`key`), the kebab name
 * resources carry (`name`), the variable its id comes from, and the
 * management group avm-ptn-alz moves it under. A spoke placement also names
 * its `group` (`identity`, `corp`, `online`) and 1-based `index`, which is
 * what cidr.js carves its /24 from.
 */
import { isSelected } from '../state';

const platform = (key, mg = key) => ({
  key,
  name: key,
  variable: `var.${key}_subscription_id`,
  mg,
});

const landingZone = (group, index) => ({
  key: `${group}_${index}`,
  name: `${group}-${index}`,
  variable: `var.${group}_subscription_ids[${index - 1}]`,
  mg: group,
  group,
  index,
});

/** Every placed subscription. */
export function placements(state) {
  const out = [];
  if (isSelected(state, 'management')) out.push(platform('management'));
  if (isSelected(state, 'connectivity-hub')) out.push(platform('connectivity'));
  if (isSelected(state, 'identity'))
    out.push({ ...platform('identity'), group: 'identity', index: 1 });
  for (const [group, countId] of [
    ['corp', 'corpCount'],
    ['online', 'onlineCount'],
  ]) {
    for (let i = 1; i <= state.options[countId]; i += 1) out.push(landingZone(group, i));
  }
  return out;
}

/** The placements that get a spoke virtual network: identity, corp and online. */
export const spokes = (state) => placements(state).filter((p) => p.group);

/** The application landing zones only. */
export const applicationSpokes = (state) =>
  spokes(state).filter((p) => p.group === 'corp' || p.group === 'online');
