/**
 * Canonical certification issuer registry.
 *
 * Used by the admin Certifications page to:
 *   1. Populate the Issuer combobox with curated options (free text still allowed).
 *   2. Tie each cert to a vendor (aws | azure | gcp | microsoft | google | other) so
 *      vendor sub-pages (e.g. /aws/education) can later filter certs by vendor.
 *   3. Auto-suggest the official Learn / credential URL for a cert based on the
 *      issuer + cert code.
 */

export const ISSUERS = [
  {
    id: 'aws',
    name: 'Amazon Web Services',
    aliases: ['aws', 'amazon', 'amazon web services'],
    vendor: 'aws',
    learnBase: 'https://aws.amazon.com/certification/',
    learnSearch: (code) =>
      `https://aws.amazon.com/certification/?nc2=sb_ce_co#${code ? `search=${encodeURIComponent(code)}` : ''}`,
    color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  },
  {
    id: 'microsoft',
    name: 'Microsoft',
    aliases: ['microsoft', 'ms', 'microsoft corporation'],
    vendor: 'azure', // Microsoft certs surface on the Azure page
    learnBase: 'https://learn.microsoft.com/en-us/credentials/certifications/',
    learnSearch: (code) =>
      code
        ? `https://learn.microsoft.com/en-us/credentials/certifications/?terms=${encodeURIComponent(code)}`
        : 'https://learn.microsoft.com/en-us/credentials/certifications/',
    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  },
  {
    id: 'google-cloud',
    name: 'Google Cloud',
    aliases: ['google cloud', 'gcp', 'google'],
    vendor: 'gcp',
    learnBase: 'https://cloud.google.com/learn/certification',
    learnSearch: (code) =>
      code
        ? `https://www.google.com/search?q=${encodeURIComponent(`google cloud certification ${code}`)}`
        : 'https://cloud.google.com/learn/certification',
    color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  },
  {
    id: 'hashicorp',
    name: 'HashiCorp',
    aliases: ['hashicorp'],
    vendor: 'other',
    learnBase: 'https://www.hashicorp.com/certification',
    learnSearch: () => 'https://www.hashicorp.com/certification',
    color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  },
  {
    id: 'cncf',
    name: 'CNCF',
    aliases: ['cncf', 'linux foundation', 'kubernetes'],
    vendor: 'other',
    learnBase: 'https://www.cncf.io/training/certification/',
    learnSearch: (code) =>
      code
        ? `https://www.google.com/search?q=${encodeURIComponent(`CNCF certification ${code}`)}`
        : 'https://www.cncf.io/training/certification/',
    color: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  },
  {
    id: 'comptia',
    name: 'CompTIA',
    aliases: ['comptia'],
    vendor: 'other',
    learnBase: 'https://www.comptia.org/certifications',
    learnSearch: (code) =>
      code
        ? `https://www.comptia.org/search?q=${encodeURIComponent(code)}`
        : 'https://www.comptia.org/certifications',
    color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  },
  {
    id: 'cisco',
    name: 'Cisco',
    aliases: ['cisco'],
    vendor: 'other',
    learnBase: 'https://www.cisco.com/c/en/us/training-events/training-certifications.html',
    learnSearch: (code) =>
      code
        ? `https://www.google.com/search?q=${encodeURIComponent(`cisco certification ${code}`)}`
        : 'https://www.cisco.com/c/en/us/training-events/training-certifications.html',
    color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  },
  {
    id: 'isc2',
    name: '(ISC)²',
    aliases: ['isc2', '(isc)2', '(isc)²', 'isc squared'],
    vendor: 'other',
    learnBase: 'https://www.isc2.org/Certifications',
    learnSearch: (code) =>
      code
        ? `https://www.isc2.org/Search?q=${encodeURIComponent(code)}`
        : 'https://www.isc2.org/Certifications',
    color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  },
];

export const VENDOR_LABELS = {
  aws: { label: 'AWS', path: '/aws/education' },
  azure: { label: 'Azure', path: '/azure/education' },
  gcp: { label: 'GCP', path: '/gcp/education' },
  microsoft: { label: 'Microsoft', path: '/azure/education' },
  google: { label: 'Google', path: '/gcp/education' },
  other: { label: 'Other', path: null },
};

const normalize = (s) =>
  String(s || '')
    .trim()
    .toLowerCase();

export function detectIssuer(issuerName) {
  const n = normalize(issuerName);
  if (!n) return null;
  // Exact name or alias only. Substring matching used to map "Microsoft Azure"
  // back to "Microsoft" and silently overwrite admin edits, so we no longer
  // collapse longer/distinct labels into a curated entry.
  return (
    ISSUERS.find((i) => normalize(i.name) === n) ||
    ISSUERS.find((i) => i.aliases.some((a) => normalize(a) === n)) ||
    null
  );
}

export function getVendorForIssuer(issuerName) {
  const match = detectIssuer(issuerName);
  if (match) return match.vendor;
  // Soft inference for custom issuer values like "Microsoft Azure" — keeps the
  // typed label intact but still routes the cert to the right vendor page.
  const n = normalize(issuerName);
  if (!n) return 'other';
  const soft = ISSUERS.find((i) =>
    [i.name, ...i.aliases].some((a) => {
      const an = normalize(a);
      return an && (n.startsWith(`${an} `) || n.endsWith(` ${an}`) || n.split(/\s+/).includes(an));
    })
  );
  return soft?.vendor || 'other';
}

export function getLearnUrl(issuerName, code) {
  const match = detectIssuer(issuerName);
  if (!match) return '';
  return match.learnSearch(code || '');
}

export function getIssuerColor(issuerName) {
  return (
    detectIssuer(issuerName)?.color ||
    'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
  );
}

export function getIssuerOptions() {
  return ISSUERS.map((i) => i.name).sort();
}
