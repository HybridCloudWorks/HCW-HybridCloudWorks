#!/usr/bin/env node
/**
 * Generate branded cover images for fallback news articles.
 * Uses the same SVG template as the Cloud Function.
 *
 * Usage: node scripts/generate-covers.js
 * Output: public/images/news/{article-id}.png
 */

const sharp = require('../functions/node_modules/sharp');
const fs = require('fs');
const path = require('path');

// --- Load provider logos as base64 ---
const LOGOS = {
  Azure: fs.readFileSync(path.join(__dirname, 'logo-azure.b64'), 'utf8').trim(),
  Aws: fs.readFileSync(path.join(__dirname, 'logo-aws.b64'), 'utf8').trim(),
  Gcp: fs.readFileSync(path.join(__dirname, 'logo-gcp.b64'), 'utf8').trim(),
  Github: fs.readFileSync(path.join(__dirname, 'logo-github.b64'), 'utf8').trim(),
  Terraform: fs.readFileSync(path.join(__dirname, 'logo-terraform.b64'), 'utf8').trim(),
  Finops: fs.readFileSync(path.join(__dirname, 'logo-finops.b64'), 'utf8').trim(),
};

// --- Same branding constants as functions/index.js ---

const PROVIDER_BRANDING = {
  Azure: { primary: '#00a4ef', dark: '#0f2942', accent: '#0078D4', label: 'AZURE' },
  Aws: { primary: '#ff9900', dark: '#232f3e', accent: '#FF9900', label: 'AWS' },
  Gcp: { primary: '#4285f4', dark: '#202124', accent: '#4285F4', label: 'GCP' },
  Github: { primary: '#6e7681', dark: '#1c2128', accent: '#3d444d', label: 'GITHUB' },
  Terraform: { primary: '#7B42BC', dark: '#2d1e3d', accent: '#4040b2', label: 'TERRAFORM' },
  Finops: { primary: '#1ea482', dark: '#064e3b', accent: '#1ea482', label: 'FINOPS' },
};

const CATEGORY_BADGE_COLORS = {
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
};

function wrapText(text, maxCharsPerLine = 32) {
  if (!text) return ['Untitled'];
  const words = text.split(/\s+/);
  const lines = [];
  let currentLine = '';
  for (const word of words) {
    if (lines.length >= 3) break;
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (testLine.length > maxCharsPerLine && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine && lines.length < 3) {
    const usedWords = lines.join(' ').split(/\s+/).length + currentLine.split(/\s+/).length;
    if (words.length > usedWords) {
      lines.push(currentLine + '...');
    } else {
      lines.push(currentLine);
    }
  }
  return lines.length > 0 ? lines : ['Untitled'];
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildCoverSvg(provider, title, category) {
  const branding = PROVIDER_BRANDING[provider] || PROVIDER_BRANDING.Azure;
  const badgeColor = CATEGORY_BADGE_COLORS[category] || '#64748b';
  const titleLines = wrapText(title, 32);
  const titleStartY = 320;
  const lineHeight = 52;
  const logoData = LOGOS[provider] || LOGOS.Azure;

  // Isometric building blocks (Lego theme) - right side
  const blocks = `
    <g transform="translate(750, 180)">
      <!-- Back block (darker) -->
      <g opacity="0.3">
        <polygon points="0,60 120,0 240,60 120,120" fill="${branding.dark}" />
        <polygon points="120,120 240,60 240,200 120,260" fill="${branding.accent}" stroke="${branding.primary}" stroke-width="2" />
        <polygon points="0,60 120,120 120,260 0,200" fill="${branding.primary}" opacity="0.7" />
      </g>

      <!-- Middle block -->
      <g transform="translate(-60, 100)" opacity="0.6">
        <polygon points="0,40 90,0 180,40 90,80" fill="${branding.dark}" />
        <polygon points="90,80 180,40 180,160 90,200" fill="${branding.accent}" stroke="${branding.primary}" stroke-width="2" />
        <polygon points="0,40 90,80 90,200 0,160" fill="${branding.primary}" opacity="0.8" />
        <!-- Lego stud on top -->
        <circle cx="90" cy="40" r="12" fill="${branding.primary}" />
      </g>

      <!-- Front block (brightest) -->
      <g transform="translate(-120, 200)">
        <polygon points="0,30 75,0 150,30 75,60" fill="${branding.dark}" />
        <polygon points="75,60 150,30 150,135 75,165" fill="${branding.accent}" stroke="${branding.primary}" stroke-width="2" />
        <polygon points="0,30 75,60 75,165 0,135" fill="${branding.primary}" />
        <!-- Lego studs on top -->
        <circle cx="50" cy="30" r="10" fill="${branding.primary}" opacity="0.9" />
        <circle cx="100" cy="30" r="10" fill="${branding.primary}" opacity="0.9" />
      </g>
    </g>
  `;

  // Dot pattern background
  let dots = '';
  for (let x = 0; x < 1200; x += 40) {
    for (let y = 0; y < 630; y += 40) {
      dots += `<circle cx="${x}" cy="${y}" r="1" fill="white" opacity="0.04"/>`;
    }
  }

  const titleElements = titleLines
    .map(
      (line, i) =>
        `<text x="80" y="${titleStartY + i * lineHeight}" fill="white" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="42" font-weight="700" letter-spacing="-0.5">${escapeXml(line)}</text>`
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
    <filter id="drop-shadow">
      <feGaussianBlur in="SourceAlpha" stdDeviation="3"/>
      <feOffset dx="0" dy="2" result="offsetblur"/>
      <feComponentTransfer>
        <feFuncA type="linear" slope="0.3"/>
      </feComponentTransfer>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  ${dots}
  <rect x="0" y="0" width="1200" height="4" fill="url(#topline)"/>

  <!-- Isometric blocks (Lego builder theme) -->
  ${blocks}

  <!-- Provider logo (embedded) -->
  <g transform="translate(950, 80)" filter="url(#drop-shadow)">
    <circle cx="60" cy="60" r="70" fill="${branding.primary}" opacity="0.15"/>
    <circle cx="60" cy="60" r="60" fill="${branding.dark}" opacity="0.5"/>
    <image href="data:image/png;base64,${logoData}" x="15" y="15" width="90" height="90" />
  </g>

  <!-- Category badge -->
  <rect x="80" y="60" width="${Math.max(category.length * 12 + 28, 80)}" height="32" rx="16" fill="${badgeColor}" opacity="0.95"/>
  <text x="${80 + Math.max(category.length * 12 + 28, 80) / 2}" y="82" fill="white" font-family="'Segoe UI', Arial, sans-serif" font-size="13" font-weight="700" text-anchor="middle" letter-spacing="1.5">${escapeXml(category.toUpperCase())}</text>

  <!-- Provider label -->
  <rect x="80" y="130" width="48" height="48" rx="12" fill="${branding.primary}" opacity="0.15"/>
  <rect x="88" y="138" width="32" height="32" rx="8" fill="${branding.primary}" opacity="0.3"/>
  <text x="145" y="163" fill="${branding.primary}" font-family="'Segoe UI', Arial, sans-serif" font-size="16" font-weight="600" letter-spacing="2" opacity="0.7">${branding.label} PLATFORM</text>

  <!-- Divider -->
  <line x1="80" y1="230" x2="420" y2="230" stroke="${branding.primary}" stroke-opacity="0.25" stroke-width="2"/>

  <!-- Title -->
  <g opacity="0.95">
    ${titleElements}
  </g>

  <!-- Footer branding -->
  <text x="80" y="560" fill="white" opacity="0.5" font-family="'Segoe UI', Arial, sans-serif" font-size="15" font-weight="700" letter-spacing="2">HYBRIDCLOUDWORKS</text>
  <text x="80" y="585" fill="white" opacity="0.3" font-family="'Segoe UI', Arial, sans-serif" font-size="12" letter-spacing="1">CLOUD ARCHITECTURE &amp; ENGINEERING</text>

  <!-- Accent bars -->
  <rect x="1150" y="0" width="50" height="630" fill="${branding.primary}" opacity="0.06"/>
  <rect x="1170" y="0" width="30" height="630" fill="${branding.primary}" opacity="0.10"/>

  <!-- Watermark -->
  <text x="1120" y="585" fill="${branding.primary}" opacity="0.05" font-family="'Segoe UI', Arial, sans-serif" font-size="90" font-weight="900" text-anchor="end" letter-spacing="4">${branding.label}</text>
</svg>`;
}

// --- Fallback articles (same IDs as useNewsData.js) ---

const ARTICLES = [
  {
    id: 'fb-az-1',
    provider: 'Azure',
    title: 'AI Landing Zone: Platform Architecture and Shared Services',
    category: 'AI/ML',
  },
  {
    id: 'fb-az-2',
    provider: 'Azure',
    title: 'Zero Trust Security Configuration with Microsoft Intune',
    category: 'Security',
  },
  {
    id: 'fb-az-3',
    provider: 'Azure',
    title: 'Designing AI Workloads with Azure Well-Architected Framework',
    category: 'Architecture',
  },
  {
    id: 'fb-az-4',
    provider: 'Azure',
    title: 'Microsoft Agent Framework: Open-Source Engine for Agentic AI',
    category: 'AI/ML',
  },
  {
    id: 'fb-aws-1',
    provider: 'Aws',
    title: 'Event-Driven Architecture at Scale with EventBridge',
    category: 'Serverless',
  },
  {
    id: 'fb-aws-2',
    provider: 'Aws',
    title: 'Amazon Bedrock: Foundation Models for Enterprise AI',
    category: 'AI/ML',
  },
  {
    id: 'fb-aws-3',
    provider: 'Aws',
    title: 'EKS Best Practices for Production Workloads',
    category: 'Containers',
  },
  {
    id: 'fb-gcp-1',
    provider: 'Gcp',
    title: 'Vertex AI: Building Production ML Pipelines',
    category: 'AI/ML',
  },
  {
    id: 'fb-gcp-2',
    provider: 'Gcp',
    title: 'GKE Autopilot: Managed Kubernetes for Modern Applications',
    category: 'Containers',
  },
  {
    id: 'fb-gh-1',
    provider: 'Github',
    title: 'GitHub Copilot 2025: Smarter AI, Seamless Workflows',
    category: 'AI/ML',
  },
  {
    id: 'fb-gh-2',
    provider: 'Github',
    title: 'Mastering AI Tooling with GitHub MCP Registry',
    category: 'DevOps',
  },
  {
    id: 'fb-tf-1',
    provider: 'Terraform',
    title: 'Terraform Cloud: Infrastructure Automation at Scale',
    category: 'DevOps',
  },
  {
    id: 'fb-tf-2',
    provider: 'Terraform',
    title: 'Writing Reusable Terraform Modules: Best Practices',
    category: 'DevOps',
  },
  {
    id: 'fb-fo-1',
    provider: 'Finops',
    title: 'FinOps Framework 2.0: Cloud Financial Management Evolution',
    category: 'Cost',
  },
  {
    id: 'fb-fo-2',
    provider: 'Finops',
    title: 'MCP Servers Enabling AI-Driven Cloud Cost Management',
    category: 'AI/ML',
  },
];

async function main() {
  const outDir = path.join(__dirname, '..', 'public', 'images', 'news');
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Generating ${ARTICLES.length} cover images...`);

  for (const article of ARTICLES) {
    const svg = buildCoverSvg(article.provider, article.title, article.category);
    const outFile = path.join(outDir, `${article.id}.png`);

    await sharp(Buffer.from(svg)).png({ quality: 90 }).toFile(outFile);
    const stats = fs.statSync(outFile);
    console.log(
      `  ✓ ${article.id}.png (${(stats.size / 1024).toFixed(1)} KB) — ${article.title.substring(0, 50)}`
    );
  }

  console.log(`\nDone! ${ARTICLES.length} images saved to public/images/news/`);
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
