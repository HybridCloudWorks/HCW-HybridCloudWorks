/**
 * Every provider's logo, once for a light surface and once for a dark one.
 *
 * ONE TABLE, BECAUSE THERE WERE TWO. The home page's provider strip carried
 * `logo`/`logoDark` in `providerGuide.js`, and the home page's design cards had
 * a `getProviderLogoSrc` of their own. Only GitHub had a dark variant in
 * either, and the cards asked for `/icons/providers/terraform.png`, which has
 * never existed. `providerLogos.test.js` now checks every file here is on disk.
 *
 * WHY SOME PROVIDERS NEED TWO (2026-09-28):
 *   - aws.png is the AWS logo reversed, white lettering over an orange smile.
 *     On the light theme only the smile showed. aws-on-light.svg is the one-
 *     colour logo AWS draws in its own header on white. AWS's trademark
 *     guidelines forbid recolouring the logo, so this is AWS's rendering, not
 *     ours.
 *   - ansible.svg is a near-black disc with a white A, and on the dark theme
 *     the disc disappears into the page. ansible-on-dark.svg is the reversed
 *     mark: a white disc with the A cut out.
 *   - GitHub's Invertocat comes in black and white from GitHub's own kit.
 * Each SVG names its source in a comment at its top.
 *
 * THE THEME IS CHOSEN BY CSS, NOT BY REACT. See `ProviderLogo`: both variants
 * are in the markup and `.dark` on <html> hides one. Choosing in React put the
 * pre-renderer's theme into the static HTML, where hydration keeps it.
 */

const DIR = '/icons/providers/';

/** The same file on both surfaces. */
const either = (file) => Object.freeze({ light: `${DIR}${file}`, dark: `${DIR}${file}` });

export const PROVIDER_LOGOS = Object.freeze({
  azure: either('azure.png'),
  aws: Object.freeze({ light: `${DIR}aws-on-light.svg`, dark: `${DIR}aws.png` }),
  gcp: either('gcp.png'),
  vmware: either('vmware.svg'),
  github: Object.freeze({
    light: `${DIR}GitHub_Invertocat_Black_Clearspace.svg`,
    dark: `${DIR}GitHub_Invertocat_White_Clearspace.svg`,
  }),
  finops: either('FinOps.svg'),
  terraform: either('terraform.svg'),
  docker: either('docker.svg'),
  ansible: Object.freeze({ light: `${DIR}ansible.svg`, dark: `${DIR}ansible-on-dark.svg` }),
});
