/**
 * IPv4 CIDR arithmetic for the builder (#667): the validators for the hub and
 * spoke address spaces, and the rule that carves one /24 per landing zone out
 * of the spoke range. Pure integer arithmetic on 32-bit addresses; no
 * library, no network.
 *
 * THE CARVING RULE. The spoke range is split in two halves: corp spokes take
 * consecutive /24s from the bottom of the low half, online spokes take them
 * from the bottom of the high half, and the identity spoke takes the top /24
 * of the low half, so it sits with the private spokes and never collides
 * with a corp count of up to MAX_LANDING_ZONES. With the default
 * `10.1.0.0/16`: corp 1 is `10.1.0.0/24`, online 1 is `10.1.128.0/24`,
 * identity is `10.1.127.0/24`. `spokeSlot` gives the same carve as the
 * `cidrsubnet(range, newbits, netnum)` call the emitted Terraform makes, so
 * the diagram label and the HCL agree by construction.
 */

/**
 * Canonical form only: each octet and the prefix are `0` or a number with no
 * leading zero, so `010.0.0.0/8`, `10.0.0.0/08`, `10.0.0.0/+8`, `10.0.0.0/8 `
 * and `10.0.0.0/8.0` are all refused rather than read as what `Number` would
 * make of them. Anchored, no whitespace, no sign.
 */
const OCTET = '(0|[1-9][0-9]{0,2})';
const PREFIX = '(0|[1-9][0-9]?)';
const CIDR = new RegExp(`^${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}/${PREFIX}$`);

/** `{ address, prefix }` with the address as an unsigned 32-bit integer, or null. */
function parseCidr(value) {
  if (typeof value !== 'string') return null;
  const match = CIDR.exec(value);
  if (!match) return null;
  const octets = match.slice(1, 5).map(Number);
  if (octets.some((octet) => octet > 255)) return null;
  const prefix = Number(match[5]);
  if (prefix > 32) return null;
  const address = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  return { address, prefix };
}

const toDotted = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');

/** The network address of a parsed CIDR, host bits cleared. */
const networkOf = ({ address, prefix }) =>
  prefix === 0 ? 0 : (address & (~0 << (32 - prefix))) >>> 0;

/**
 * The prefix lengths a hub may have, inclusive. /8 to /24: the module places
 * a firewall subnet, a Bastion subnet and a gateway subnet inside it, and
 * /26 is the smallest of those, so a /24 is the tightest hub that still
 * fits. The emitted `variables.tf` enforces the same bounds, from these
 * numbers, so the two cannot drift apart.
 */
export const HUB_PREFIX_RANGE = Object.freeze([8, 24]);

/** The longest spoke prefix that still holds five corp, five online and identity as /24s. */
export const SPOKE_MAX_PREFIX = 20;

/**
 * The prefix lengths a spoke range may have, inclusive. /8 to /20: a /20 is
 * sixteen /24s, eight a half, which is what five corp spokes plus identity
 * on one side and five online spokes on the other need.
 */
export const SPOKE_PREFIX_RANGE = Object.freeze([8, SPOKE_MAX_PREFIX]);

const withinRange = (value, [min, max]) => {
  const parsed = parseCidr(value);
  return parsed !== null && parsed.prefix >= min && parsed.prefix <= max;
};

/** An IPv4 CIDR the hub can carve subnets from; see HUB_PREFIX_RANGE. */
export function isCidr(value) {
  return withinRange(value, HUB_PREFIX_RANGE);
}

/** The range every spoke is carved from; see SPOKE_PREFIX_RANGE. */
export function isSpokeCidr(value) {
  return withinRange(value, SPOKE_PREFIX_RANGE);
}

/** The 0-based /24 slot for a landing zone within a range of `blocks` /24s. */
function slotFor(group, index, blocks) {
  const half = blocks / 2;
  if (group === 'corp') return index - 1;
  if (group === 'online') return half + index - 1;
  if (group === 'identity') return half - 1;
  return -1;
}

/**
 * The `cidrsubnet` arguments for one landing zone: `{ newbits, netnum }`
 * such that `cidrsubnet(spokeCidr, newbits, netnum)` is its /24. `group` is
 * `corp`, `online` or `identity`; `index` is 1-based and ignored for
 * identity. Null when the range or the slot does not validate.
 */
export function spokeSlot(spokeCidr, group, index = 1) {
  if (!isSpokeCidr(spokeCidr)) return null;
  const { prefix } = parseCidr(spokeCidr);
  const newbits = 24 - prefix;
  const netnum = slotFor(group, index, 2 ** newbits);
  if (!Number.isInteger(netnum) || netnum < 0 || netnum >= 2 ** newbits) return null;
  return { newbits, netnum };
}

/** The /24 for one landing zone as a string, or null; see `spokeSlot`. */
export function spokeAddressSpace(spokeCidr, group, index = 1) {
  const slot = spokeSlot(spokeCidr, group, index);
  if (!slot) return null;
  const network = networkOf(parseCidr(spokeCidr));
  return `${toDotted((network + slot.netnum * 256) >>> 0)}/24`;
}

/** Whether two CIDRs share any address. Either failing to parse counts as no overlap. */
export function cidrsOverlap(a, b) {
  const pa = parseCidr(a);
  const pb = parseCidr(b);
  if (!pa || !pb) return false;
  const prefix = Math.min(pa.prefix, pb.prefix);
  return networkOf({ address: pa.address, prefix }) === networkOf({ address: pb.address, prefix });
}
