/**
 * How the About page orders certifications (#842).
 *
 * Pure: the issuer Microsoft's rows are filed under, the featured-first
 * order of the whole list, and the order inside each issuer's group. All of
 * it sat inline in AboutPage.jsx until 2026-10-04, where it was most of the
 * component's 70 return statements. The rules are unchanged; they are
 * written as tables so each function has one way out, and
 * certificationSorting.test.js pins the orders they produce.
 */

const lower = (name) => (name || '').toLowerCase();
const includesAny =
  (...words) =>
  (n) =>
    words.some((w) => n.includes(w));
const includesAll =
  (...words) =>
  (n) =>
    words.every((w) => n.includes(w));

/** The rank of the first rule the lowercased name satisfies, else `fallback`. */
function tierOf(name, rules, fallback = 99) {
  const n = lower(name);
  const hit = rules.find(([test]) => test(n));
  return hit ? hit[1] : fallback;
}

/**
 * Microsoft's rows are three issuers on the page, told apart by exam prefix
 * or role. The rest (MSCA*, MCP, community badges) stays as Microsoft.
 */
const MICROSOFT_SUBISSUERS = [
  ['Microsoft 365', /(MS-|AB-)/i, /(MS-|AB-)/i],
  ['Microsoft Azure', /(DP-|SC-|PL-|AZ-|AI-)/i, /(DP-|SC-|PL-|AZ-|AI-)/i],
  [
    'Microsoft Education',
    /(MIEE|innovative educator|MCE|certified educator|MCT|certified trainer)/i,
    /(MIEE|MCE|MCT)/i,
  ],
];

export function classifyMicrosoft(cert) {
  if (cert.issuer !== 'Microsoft') return cert;
  const name = cert.name || '';
  const code = cert.code || '';
  const hit = MICROSOFT_SUBISSUERS.find(
    ([, byName, byCode]) => byName.test(name) || byCode.test(code)
  );
  return hit ? { ...cert, issuer: hit[0] } : cert;
}

/** Featured first, then the global display order. */
export const featuredFirst = (a, b) =>
  Number(b.featured === true) - Number(a.featured === true) ||
  (a.display_order ?? 999) - (b.display_order ?? 999);

const newestFirst = (a, b) => {
  const dateA = a.issue_date ? new Date(a.issue_date).getTime() : 0;
  const dateB = b.issue_date ? new Date(b.issue_date).getTime() : 0;
  return dateB - dateA;
};

const AWS_TIERS = [
  [includesAny('professional'), 0],
  [includesAny('associate'), 1],
  [includesAny('specialty', 'speciality'), 2],
  [includesAny('practitioner'), 3],
];
// Double VCP last, Professional first, everything else in between.
const BROADCOM_TIERS = [
  [includesAny('double'), 2],
  [includesAny('professional'), 0],
];
const FINOPS_TIERS = [
  [includesAll('certified', 'professional'), 0],
  [includesAll('certified', 'engineer'), 1],
  [includesAll('certified', 'practitioner'), 2],
  [includesAny('certified'), 3],
  [includesAny('focus'), 4],
  [includesAny('for ai', 'ai trained'), 5],
  [includesAny('container'), 6],
];
const FINOPS_AI_TIER = 5;
const GOOGLE_CLOUD_TIERS = [
  [includesAny('professional'), 0],
  [includesAny('foundational', 'foundation'), 1],
];
const MS_TIERS = [
  [includesAny('expert'), 0],
  [includesAny('associate'), 1],
  [includesAny('fundamentals'), 2],
];
const MS_EDUCATION_TIERS = [
  [includesAny('miee', 'innovative educator'), 0],
  [includesAny('mce', 'certified educator'), 1],
  [includesAny('mct', 'certified trainer'), 2],
];

const awsTier = (name) => tierOf(name, AWS_TIERS);
const broadcomTier = (name) => tierOf(name, BROADCOM_TIERS, 1);
const finOpsTier = (name) => tierOf(name, FINOPS_TIERS);
const googleCloudTier = (name) => tierOf(name, GOOGLE_CLOUD_TIERS);
const msTier = (name) => tierOf(name, MS_TIERS);
const msEducationTier = (name) => tierOf(name, MS_EDUCATION_TIERS);

/** FinOps AI tier: Level 1 → 2 → 3. */
const aiLevel = (name) => {
  const m = (name || '').match(/level\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : 99;
};
/** Microsoft's remaining rows (MSCA, MCP, …) carry a year in the name. */
const yearInName = (name) => {
  const m = (name || '').match(/\b(20\d{2}|\d{4})\b/);
  return m ? parseInt(m[1], 10) : 0;
};

/** The index of the first prefix found in the name or code, else `fallback`. */
function prefixRank(cert, prefixes, fallback) {
  const name = cert.name || '';
  const code = cert.code || '';
  const idx = prefixes.findIndex((p) => name.includes(p) || code.includes(p));
  return idx === -1 ? fallback : idx;
}
// AB certs first, then MS certs.
const M365_PREFIXES = ['AB-'];
const AZURE_PREFIXES = ['AZ-', 'AI-', 'SC-', 'DP-', 'PL-'];

const byTierThenNewest = (tier) => (a, b) => tier(a.name) - tier(b.name) || newestFirst(a, b);

const compareFinOps = (a, b) => {
  const tierA = finOpsTier(a.name);
  const diff = tierA - finOpsTier(b.name);
  if (diff !== 0) return diff;
  return tierA === FINOPS_AI_TIER ? aiLevel(a.name) - aiLevel(b.name) : newestFirst(a, b);
};
// Within each prefix group: Expert → Associate → Fundamentals, newest first.
const compareMicrosoft365 = (a, b) =>
  prefixRank(a, M365_PREFIXES, 1) - prefixRank(b, M365_PREFIXES, 1) ||
  msTier(a.name) - msTier(b.name) ||
  newestFirst(a, b);
const compareMicrosoftAzure = (a, b) =>
  prefixRank(a, AZURE_PREFIXES, 99) - prefixRank(b, AZURE_PREFIXES, 99) ||
  msTier(a.name) - msTier(b.name) ||
  newestFirst(a, b);
const compareMicrosoft = (a, b) => yearInName(b.name) - yearInName(a.name) || newestFirst(a, b);
const orderOf = (cert) => cert.display_order ?? 999;
const compareDefault = (a, b) => {
  if (orderOf(a) !== orderOf(b)) return orderOf(a) - orderOf(b);
  return (a.name || '').localeCompare(b.name || '');
};

/** Issuer → comparator, first match wins; the order of this table is the order the page always used. */
const ISSUER_ORDERS = [
  [(issuer) => /aws|amazon web services/i.test(issuer), byTierThenNewest(awsTier)],
  [(issuer) => /broadcom|vmware/i.test(issuer), byTierThenNewest(broadcomTier)],
  [(issuer) => /google cloud.*partner|google.*partner/i.test(issuer), newestFirst],
  [
    (issuer) => /google cloud/i.test(issuer) && !/partner/i.test(issuer),
    byTierThenNewest(googleCloudTier),
  ],
  [(issuer) => /finops/i.test(issuer), compareFinOps],
  [(issuer) => issuer === 'Microsoft 365', compareMicrosoft365],
  [(issuer) => issuer === 'Microsoft Azure', compareMicrosoftAzure],
  [(issuer) => issuer === 'Microsoft Education', byTierThenNewest(msEducationTier)],
  [(issuer) => issuer === 'MMCC Program', newestFirst],
  [(issuer) => issuer === 'Microsoft', compareMicrosoft],
];

export function issuerComparator(issuer) {
  const hit = ISSUER_ORDERS.find(([test]) => test(issuer));
  return hit ? hit[1] : compareDefault;
}

/** Certifications by issuer ('Other' when a row names none), each group in its issuer's order. */
export function groupByIssuer(certifications) {
  const grouped = {};
  for (const cert of certifications || []) {
    const issuer = cert.issuer || 'Other';
    (grouped[issuer] ||= []).push(cert);
  }
  for (const issuer of Object.keys(grouped)) grouped[issuer].sort(issuerComparator(issuer));
  return grouped;
}
