/**
 * cover-svg.js — the branded 1200×630 template cover for a blog that has no
 * image of its own. Ported from Site-Main `buildCoverSvg` and its helpers
 * (index.js, 088f458). Upstream rasterised the SVG to PNG with sharp; here
 * the SVG itself is stored (`image/svg+xml`, which the cover readers and the
 * media route already serve), so no native dependency.
 */

export const PROVIDER_BRANDING = Object.freeze({
  Azure: { primary: '#00a4ef', dark: '#0f2942', accent: '#0078D4', label: 'AZURE' },
  Aws: { primary: '#ff9900', dark: '#232f3e', accent: '#FF9900', label: 'AWS' },
  Gcp: { primary: '#4285f4', dark: '#202124', accent: '#4285F4', label: 'GCP' },
  Github: { primary: '#6e7681', dark: '#1c2128', accent: '#3d444d', label: 'GITHUB' },
  Terraform: { primary: '#7B42BC', dark: '#2d1e3d', accent: '#4040b2', label: 'TERRAFORM' },
  Ansible: { primary: '#EE0000', dark: '#151515', accent: '#EE0000', label: 'ANSIBLE' },
  VMware: { primary: '#607078', dark: '#14212a', accent: '#78be20', label: 'VMWARE' },
  Finops: { primary: '#1ea482', dark: '#064e3b', accent: '#1ea482', label: 'FINOPS' },
});

export const CATEGORY_BADGE_COLORS = Object.freeze({
  'AI/ML': '#a855f7',
  Security: '#f43f5e',
  Containers: '#f97316',
  Serverless: '#f59e0b',
  Database: '#06b6d4',
  Networking: '#14b8a6',
  Cost: '#10b981',
  DevOps: '#6366f1',
  GA: '#22c55e',
  Preview: '#f59e0b',
  Update: '#64748b',
});

/** Wrap a title into at most three lines of `maxCharsPerLine`, with an ellipsis when cut. */
export function wrapText(text, maxCharsPerLine = 35) {
  if (!text) return ['Untitled'];
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    if (lines.length >= 3) break;
    const test = current ? `${current} ${word}` : word;
    if (test.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current && lines.length < 3) {
    const used = current.split(/\s+/).length + lines.join(' ').split(/\s+/).filter(Boolean).length;
    lines.push(words.length > used ? `${current}...` : current);
  }
  return lines.length > 0 ? lines : ['Untitled'];
}

export function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Provider key as PROVIDER_BRANDING spells it ('aws' → 'Aws', 'VMware' stays). */
export function brandingFor(provider) {
  const raw = String(provider || '').trim();
  if (PROVIDER_BRANDING[raw]) return PROVIDER_BRANDING[raw];
  const titled = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  return PROVIDER_BRANDING[titled] || PROVIDER_BRANDING.Azure;
}

export function buildCoverSvg(provider, title, category) {
  const branding = brandingFor(provider);
  const badgeColor = CATEGORY_BADGE_COLORS[category] || '#64748b';
  const titleLines = wrapText(title, 32);
  const titleStartY = 280;
  const lineHeight = 52;
  const badgeWidth = Math.max(String(category).length * 12 + 28, 80);

  let dots = '';
  for (let x = 0; x < 1200; x += 40) {
    for (let y = 0; y < 630; y += 40)
      dots += `<circle cx="${x}" cy="${y}" r="1" fill="white" opacity="0.04"/>`;
  }
  const titleElements = titleLines
    .map(
      (line, i) =>
        `<text x="80" y="${titleStartY + i * lineHeight}" fill="white" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="40" font-weight="700" letter-spacing="-0.5">${escapeXml(line)}</text>`
    )
    .join('\n    ');

  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${branding.dark}"/>
      <stop offset="60%" stop-color="${branding.dark}"/>
      <stop offset="100%" stop-color="${branding.accent}"/>
    </linearGradient>
    <radialGradient id="glow" cx="85%" cy="80%" r="50%">
      <stop offset="0%" stop-color="${branding.primary}" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="${branding.primary}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="topline" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${branding.primary}"/>
      <stop offset="50%" stop-color="${branding.accent}"/>
      <stop offset="100%" stop-color="${branding.primary}" stop-opacity="0.3"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  ${dots}
  <rect x="0" y="0" width="1200" height="4" fill="url(#topline)"/>
  <text x="1120" y="580" fill="${branding.primary}" opacity="0.08" font-family="'Segoe UI', Arial, sans-serif" font-size="120" font-weight="900" text-anchor="end" letter-spacing="6">${branding.label}</text>
  <rect x="80" y="60" width="${badgeWidth}" height="32" rx="16" fill="${badgeColor}" opacity="0.9"/>
  <text x="${80 + badgeWidth / 2}" y="82" fill="white" font-family="'Segoe UI', Arial, sans-serif" font-size="13" font-weight="700" text-anchor="middle" letter-spacing="1.5">${escapeXml(String(category).toUpperCase())}</text>
  <rect x="80" y="130" width="48" height="48" rx="12" fill="${branding.primary}" opacity="0.15"/>
  <rect x="88" y="138" width="32" height="32" rx="8" fill="${branding.primary}" opacity="0.3"/>
  <text x="145" y="163" fill="${branding.primary}" font-family="'Segoe UI', Arial, sans-serif" font-size="16" font-weight="600" letter-spacing="2" opacity="0.7">${branding.label} PLATFORM</text>
  <line x1="80" y1="210" x2="400" y2="210" stroke="${branding.primary}" stroke-opacity="0.2" stroke-width="1"/>
  ${titleElements}
  <text x="80" y="570" fill="white" opacity="0.4" font-family="'Segoe UI', Arial, sans-serif" font-size="14" font-weight="600" letter-spacing="2">HYBRIDCLOUDWORKS</text>
  <text x="80" y="590" fill="white" opacity="0.25" font-family="'Segoe UI', Arial, sans-serif" font-size="11" letter-spacing="1">CLOUD ARCHITECTURE &amp; ENGINEERING</text>
  <rect x="1150" y="0" width="50" height="630" fill="${branding.primary}" opacity="0.05"/>
  <rect x="1170" y="0" width="30" height="630" fill="${branding.primary}" opacity="0.08"/>
</svg>`;
}
