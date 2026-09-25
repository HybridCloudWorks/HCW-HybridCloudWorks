/**
 * The Azure Verified Modules the Landing Zone Builder emits (#667), pinned.
 *
 * EXACTLY THESE FOUR, and the versions are looked up, not remembered. Each
 * `version` is the latest the Terraform Registry listed on `verifiedOn`, read
 * from `https://registry.terraform.io/v1/modules/Azure/<name>/azurerm` and
 * cross-checked against the repository's GitHub release. A module with no
 * registry listing carries `version: null` and says why, rather than a
 * number nobody published. `avm-ptn-hubnetworking` is archived and is not
 * here on purpose; hcl.test.js asserts it never reaches the output.
 *
 * The provider constraints and the ALZ library ref come from the same
 * lookup: each module's `terraform.tf` on its default branch, and the
 * `platform/alz` tag on Azure/Azure-Landing-Zones-Library, so the
 * `terraform.tf` this module writes satisfies every module it calls.
 */
export const AVM_VERIFIED_ON = '2026-09-25';

const registryUrl = (name) => `https://registry.terraform.io/modules/Azure/${name}/azurerm`;
const repositoryUrl = (name) => `https://github.com/Azure/terraform-azurerm-${name}`;

const avm = (name, version, note = null) =>
  Object.freeze({
    name,
    source: `Azure/${name}/azurerm`,
    version,
    verifiedOn: AVM_VERIFIED_ON,
    registry: registryUrl(name),
    repository: repositoryUrl(name),
    note,
  });

/**
 * Keyed by module name. `version` is a string when the registry lists the
 * module, null when it does not; the emitter writes a `version` line only for
 * the former and a dated comment for the latter.
 */
export const AVM_MODULES = Object.freeze({
  'avm-ptn-alz': avm('avm-ptn-alz', '0.21.0'),
  'avm-ptn-alz-management': avm('avm-ptn-alz-management', '0.9.0'),
  'avm-ptn-alz-connectivity-hub-and-spoke-vnet': avm(
    'avm-ptn-alz-connectivity-hub-and-spoke-vnet',
    '0.17.5'
  ),
  'avm-ptn-alz-application-landing-zone-identity-and-access': avm(
    'avm-ptn-alz-application-landing-zone-identity-and-access',
    null,
    'Not on the Terraform Registry on 2026-09-25: the GitHub repository exists but holds the unfilled AVM template, with no tag and no release. Its declared inputs are the template trio name, location and resource_group_name.'
  ),
});

export const AVM_MODULE_NAMES = Object.freeze(Object.keys(AVM_MODULES));

export const AVM_SOURCES = Object.freeze(Object.values(AVM_MODULES).map((module) => module.source));

const AVM_BY_SOURCE = new Map(Object.values(AVM_MODULES).map((module) => [module.source, module]));

/** The pinned module by name; null for a name this builder does not emit. */
export function avmModule(name) {
  return AVM_MODULES[name] ?? null;
}

/** Whether a `source` string is one of the four pinned modules. */
export function isAvmSource(source) {
  return AVM_BY_SOURCE.has(source);
}

/**
 * What `terraform.tf` requires, chosen so every module above is satisfied:
 * avm-ptn-alz wants terraform >= 1.12 and alz ~> 0.21; the connectivity
 * module wants terraform ~> 1.12 and azapi ~> 2.12; management wants
 * azurerm ~> 4.35 and random ~> 3.6.
 */
export const TERRAFORM_REQUIRED_VERSION = '>= 1.12, < 2.0';

export const PROVIDER_PINS = Object.freeze([
  Object.freeze({ name: 'alz', source: 'azure/alz', version: '~> 0.21' }),
  Object.freeze({ name: 'azapi', source: 'Azure/azapi', version: '~> 2.12' }),
  Object.freeze({ name: 'azurerm', source: 'hashicorp/azurerm', version: '~> 4.35' }),
  Object.freeze({ name: 'random', source: 'hashicorp/random', version: '~> 3.6' }),
]);

/**
 * The ALZ library release the alz provider reads the `alz` architecture from:
 * the latest `platform/alz` tag on Azure/Azure-Landing-Zones-Library on the
 * verification date.
 */
export const ALZ_LIBRARY_REFERENCE = Object.freeze({ path: 'platform/alz', ref: '2026.08.1' });
