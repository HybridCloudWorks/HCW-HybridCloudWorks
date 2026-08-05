import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PDFParse } from 'pdf-parse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const dataFile = path.join(repoRoot, 'src', 'data', 'azure', 'certifications.js');
const browseUrl = 'https://learn.microsoft.com/api/contentbrowser/search/credentials';
const learnBaseUrl = 'https://learn.microsoft.com/en-us';
const appliedSkillsPosterUrl =
  'https://arch-center.azureedge.net/Credentials/microsoft-applied-skills-poster.pdf';
const certificationsPosterUrl = 'https://aka.ms/CertificationsPoster';

const CERTIFICATION_POSTER_TITLE_OVERRIDES = {
  'AB-100': 'Agentic AI Business Solutions Architect',
  'AB-620': 'AI Agent Builder Associate (Beta)',
  'AB-900': 'Microsoft 365 Copilot and Agent Administration Fundamentals',
  'AZ-801': 'Windows Server Hybrid Administrator Associate',
  'AI-901': 'Azure AI Fundamentals',
};

const POSTER_ONLY_APPLIED_SKILLS = [
  {
    id: 'apl-openai-semantic-kernel',
    slug: 'develop-generative-ai-apps-azure-openai-semantic-kernel',
    code: 'APL-SK',
    officialCode: 'develop-generative-ai-apps-azure-openai-semantic-kernel',
    title: 'Develop generative AI apps with Azure OpenAI and Semantic Kernel',
    area: 'AI',
    level: 'Intermediate',
    status: 'active',
    description:
      'Build generative AI applications using Azure OpenAI Service and Semantic Kernel SDK, including plugins and orchestration patterns.',
    learnUrl:
      'https://learn.microsoft.com/en-us/credentials/applied-skills/develop-generative-ai-apps-azure-openai-semantic-kernel/',
  },
  {
    id: 'apl-m365-copilot-declarative',
    slug: 'extend-microsoft-365-copilot-with-declarative-agents',
    code: 'APL-M365D',
    officialCode: 'extend-microsoft-365-copilot-with-declarative-agents',
    title: 'Extend Microsoft 365 Copilot with declarative agents by using Visual Studio Code',
    area: 'AI',
    level: 'Intermediate',
    status: 'active',
    description:
      'Build declarative agents for Microsoft 365 Copilot using Visual Studio Code to extend AI capabilities.',
    learnUrl:
      'https://learn.microsoft.com/en-us/credentials/applied-skills/extend-microsoft-365-copilot-with-declarative-agents/',
  },
];

const browserHeaders = {
  accept: 'application/json,text/html',
  referer:
    'https://learn.microsoft.com/en-us/credentials/browse/?credential_types=applied%20skills',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
};

function stripMicrosoftPrefix(title) {
  return title.replace(/^Microsoft Applied Skills:\s*/i, '').trim();
}

function slugFromUrl(url) {
  return url.split('/').filter(Boolean).pop();
}

function normalizeUrl(url) {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  return `${learnBaseUrl}${url.startsWith('/') ? url : `/${url}`}`;
}

function normalizeTitle(title) {
  return stripMicrosoftPrefix(title)
    .replace(/^Microsoft Certified:\s*/i, '')
    .replace(/^Microsoft 365 Certified:\s*/i, '')
    .replace(/^GitHub Certified:\s*/i, 'GitHub ')
    .replace(/\s+Certification\b/gi, '')
    .replace(/\s+\(beta\)/gi, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeCertificationTitle(title) {
  return title
    .replace(/^Microsoft Certified:\s*/i, '')
    .replace(/^Microsoft 365 Certified:\s*/i, '')
    .replace(/^GitHub Certified:\s*/i, 'GitHub ')
    .replace(/\s+Certification\b/gi, '')
    .replace(/\s+\(beta\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferCertificationLevel(result, posterTitle) {
  const credentialTypes = result?.credential_types || [];
  const title = posterTitle || result?.title || '';
  if (credentialTypes.includes('fundamentals') || /\bFundamentals\b/i.test(title)) {
    return 'Fundamentals';
  }
  if (credentialTypes.includes('specialty') || /\bSpecialty\b/i.test(title)) return 'Specialty';
  if (credentialTypes.includes('business')) return 'Associate';
  if (/\bExpert\b/i.test(title)) return 'Expert';
  return 'Associate';
}

function inferCertificationStatus(result, posterTitle, existing = {}) {
  if (existing.status === 'expiring' || existing.status === 'retired') return existing.status;
  if (/\(beta\)/i.test(posterTitle || result?.title || '')) return 'beta';
  return existing.status || 'active';
}

function extractCodeFromExam(exam) {
  const raw = exam?.display_name || exam?.uid || exam?.localized_uid || '';
  return raw.toUpperCase().match(/\b[A-Z]{2,4}-\d{3,4}\b/)?.[0] || null;
}

function inferArea(skill) {
  const subjects = (skill.display_subjects || []).join(' ').toLowerCase();
  const products = (skill.display_products || []).join(' ').toLowerCase();
  const title = skill.title.toLowerCase();
  const combined = `${subjects} ${products} ${title}`;

  if (
    combined.includes('security') ||
    combined.includes('compliance') ||
    combined.includes('identity') ||
    combined.includes('active directory')
  ) {
    return 'Security';
  }
  if (
    combined.includes('power platform') ||
    combined.includes('power apps') ||
    combined.includes('power automate') ||
    combined.includes('microsoft 365 copilot') ||
    combined.includes('copilot studio')
  ) {
    return 'AI Business';
  }
  if (combined.includes('monitor') || combined.includes('management task')) return 'Operations';
  if (combined.includes('container') || combined.includes('kubernetes')) return 'Containers';
  if (
    combined.includes('data ') ||
    combined.includes('database') ||
    combined.includes('sql') ||
    combined.includes('postgresql') ||
    combined.includes('fabric')
  ) {
    return 'Data';
  }
  if (
    combined.includes('github') ||
    combined.includes('devops') ||
    combined.includes('c#') ||
    combined.includes('app development')
  ) {
    return 'DevTools';
  }
  if (combined.includes('business applications')) return 'AI Business';
  if (combined.includes('storage')) return 'Storage';
  if (combined.includes('network')) return 'Networking';
  return 'AI';
}

function makeCode(slug, usedCodes) {
  const words = slug
    .replace(/microsoft|azure|using|with|and|for|the|by|in|to|of/g, '')
    .split('-')
    .filter(Boolean);
  const acronym = words
    .slice(0, 5)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
  let code = `APL-${acronym || 'SKILL'}`;
  let suffix = 2;
  while (usedCodes.has(code)) {
    code = `APL-${acronym || 'SKILL'}${suffix}`;
    suffix += 1;
  }
  usedCodes.add(code);
  return code;
}

function extractOverview(html) {
  const overviewStart = html.search(/<h2[^>]*>\s*Overview\s*<\/h2>/i);
  if (overviewStart === -1) return null;

  const overviewEnd = html.indexOf('</section>', overviewStart);
  const overviewHtml = html.slice(overviewStart, overviewEnd === -1 ? undefined : overviewEnd);
  const text = overviewHtml
    .replace(/<div class="WARNING">[\s\S]*?<\/div>/i, '')
    .replace(/<h2[^>]*>[\s\S]*?<\/h2>/i, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return text || null;
}

function extractRetirementDate(html) {
  const match = html.match(/This credential will retire on ([A-Z][a-z]+ \d{1,2}, \d{4})/);
  if (!match) return null;
  const date = new Date(match[1]);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

async function fetchAppliedSkillBrowseResults() {
  return fetchCredentialBrowseResults("(credential_types/any(c: c eq 'applied skills'))");
}

async function fetchCredentialBrowseResults(filter) {
  const results = [];
  let count = 0;
  for (let skip = 0; skip <= count; skip += 100) {
    const params = new URLSearchParams();
    params.append('locale', 'en-us');
    for (const facet of ['roles', 'products', 'levels', 'subjects', 'credential_types']) {
      params.append('facet', facet);
    }
    params.append('$filter', filter);
    params.append('$orderBy', 'title');
    params.append('$top', '100');
    params.append('$skip', String(skip));
    params.append('fuzzySearch', 'false');

    const response = await fetch(`${browseUrl}?${params}`, { headers: browserHeaders });
    if (!response.ok) {
      throw new Error(`Microsoft Learn browse API returned ${response.status}`);
    }

    const payload = await response.json();
    count = payload.count || 0;
    results.push(...(payload.results || []));
    if (results.length >= count) break;
  }

  return results;
}

async function fetchPdfText(url) {
  const response = await fetch(url, { headers: browserHeaders, redirect: 'follow' });
  if (!response.ok) throw new Error(`PDF fetch failed for ${url}: ${response.status}`);
  const parser = new PDFParse({ data: new Uint8Array(await response.arrayBuffer()) });
  try {
    // pageJoiner: '' suppresses the default '-- page_number of total_number --'
    // marker pdf-parse v2 appends to every page. extractCertificationPosterEntries
    // walks backwards from a certification code to build its title, so a marker
    // left in the text would be absorbed into that title.
    const parsed = await parser.getText({ pageJoiner: '' });
    return parsed.text || '';
  } finally {
    await parser.destroy();
  }
}

function extractAppliedPosterTitles(text) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const titles = [
    ...POSTER_ONLY_APPLIED_SKILLS.map((skill) => skill.title),
    'Accelerate app development by using GitHub Copilot',
    'Build a generative AI chat app',
    'Create an AI agent',
    'Secure AI solutions in the cloud',
    'Streamline business workflows with AI chat',
  ];
  return titles.filter((title) =>
    normalized.toLowerCase().includes(title.toLowerCase().replace('AI-assisted', 'app'))
  );
}

function extractCertificationPosterEntries(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const codeRegex = /\b[A-Z]{2,4}-\d{3,4}\b/;
  const stopLines = new Set([
    'Role-based',
    'Specialty',
    'Business',
    'Fundamentals',
    'Expand your technical skill set',
    'Deepen your technical skills and',
    'manage industry solutions',
    'Expand your AI skills',
    'for business roles',
    'Master the basics',
    'AI Business SolutionsSecurityCloud & AI Platforms',
  ]);
  const entries = new Map();

  for (let index = 0; index < lines.length; index += 1) {
    const code = lines[index].match(codeRegex)?.[0];
    if (!code) continue;
    const parts = [];
    for (let cursor = index - 1; cursor >= Math.max(0, index - 8); cursor -= 1) {
      if (codeRegex.test(lines[cursor]) || stopLines.has(lines[cursor])) break;
      parts.unshift(lines[cursor]);
    }
    const title = CERTIFICATION_POSTER_TITLE_OVERRIDES[code] || parts.join(' ').trim();
    if (title) entries.set(code, { code, title });
  }

  for (const [code, title] of Object.entries(CERTIFICATION_POSTER_TITLE_OVERRIDES)) {
    entries.set(code, { code, title });
  }

  return [...entries.values()].sort((a, b) => a.code.localeCompare(b.code));
}

function buildApiCertificationIndexes(apiResults) {
  const byCode = new Map();
  const byTitle = new Map();
  for (const result of apiResults) {
    const title = normalizeTitle(result.title);
    byTitle.set(title, result);
    for (const exam of result.exams || []) {
      const code = extractCodeFromExam(exam);
      if (code && !byCode.has(code)) byCode.set(code, result);
    }
  }
  return { byCode, byTitle };
}

function buildCertificationIndexes(certifications) {
  const byCode = new Map();
  const byTitle = new Map();
  for (const cert of certifications) {
    byCode.set(cert.code, cert);
    byTitle.set(normalizeTitle(cert.title), cert);
  }
  return { byCode, byTitle };
}

function buildCertificationFromSources(posterEntry, apiIndexes, existingIndexes) {
  const api =
    apiIndexes.byCode.get(posterEntry.code) ||
    apiIndexes.byTitle.get(normalizeTitle(posterEntry.title)) ||
    null;
  const existing =
    existingIndexes.byCode.get(posterEntry.code) ||
    existingIndexes.byTitle.get(normalizeTitle(posterEntry.title)) ||
    {};
  const title = existing.title || `Microsoft Certified: ${posterEntry.title}`;
  const slug = existing.slug || slugFromUrl(api?.url || '') || slugify(posterEntry.title);
  const learnUrl =
    existing.learnUrl || normalizeUrl(api?.url || `/credentials/certifications/${slug}/`);
  const level = existing.level || inferCertificationLevel(api, posterEntry.title);
  const status = inferCertificationStatus(api, posterEntry.title, existing);

  return {
    id: existing.id || posterEntry.code.toLowerCase(),
    slug,
    code: posterEntry.code,
    officialCode: posterEntry.code,
    title,
    level,
    status,
    ...(existing.featured ? { featured: existing.featured } : {}),
    ...(existing.expiryDate ? { expiryDate: existing.expiryDate } : {}),
    ...(existing.replacedBy ? { replacedBy: existing.replacedBy } : {}),
    ...(existing.betaEndDate ? { betaEndDate: existing.betaEndDate } : {}),
    ...(existing.betaDiscount ? { betaDiscount: existing.betaDiscount } : {}),
    ...(existing.gaDate ? { gaDate: existing.gaDate } : {}),
    description:
      existing.description ||
      `${normalizeCertificationTitle(title)} validates role-based Microsoft cloud skills.`,
    longDescription:
      existing.longDescription ||
      `${normalizeCertificationTitle(title)} validates skills for Microsoft cloud and AI workloads using official Microsoft certification requirements.`,
    topics: existing.topics ||
      api?.display_subjects?.slice(0, 4) ||
      api?.display_products?.slice(0, 4) || [normalizeCertificationTitle(title)],
    hours: existing.hours || (level === 'Fundamentals' ? 10 : level === 'Expert' ? 60 : 35),
    prepTime:
      existing.prepTime ||
      (level === 'Fundamentals' ? '~4 weeks' : level === 'Expert' ? '~10 weeks' : '~6 weeks'),
    successRate: existing.successRate || null,
    learnUrl,
    studyGuideUrl:
      existing.studyGuideUrl ||
      `https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/${posterEntry.code.toLowerCase()}`,
    practiceUrl:
      existing.practiceUrl ||
      `https://learn.microsoft.com/en-us/credentials/certifications/practice-assessments-for-microsoft-certifications#examid=${posterEntry.code.toLowerCase()}`,
    modules: existing.modules || [],
    appliedSkills: existing.appliedSkills || [],
    prerequisites:
      existing.prerequisites ||
      'Review the official Microsoft Learn certification page for prerequisites.',
    nextCerts: existing.nextCerts || [],
  };
}

function formatObject(obj, indent = 2) {
  return JSON.stringify(obj, null, 2)
    .split('\n')
    .map((line) => `${' '.repeat(indent)}${line}`)
    .join('\n');
}

function formatCertification(cert) {
  return formatObject(cert, 2);
}

function assertUniqueCodes(items, label) {
  const seen = new Set();
  const seenOfficial = new Set();
  const duplicates = [];
  const officialDuplicates = [];
  for (const item of items) {
    if (!item.code) throw new Error(`${label} item is missing code: ${item.title}`);
    if (seen.has(item.code)) duplicates.push(item.code);
    seen.add(item.code);
    if (item.officialCode) {
      if (seenOfficial.has(item.officialCode)) officialDuplicates.push(item.officialCode);
      seenOfficial.add(item.officialCode);
    }
  }
  if (duplicates.length) {
    throw new Error(`${label} duplicate codes: ${duplicates.join(', ')}`);
  }
  if (officialDuplicates.length) {
    throw new Error(`${label} duplicate official codes: ${officialDuplicates.join(', ')}`);
  }
}

async function fetchDetail(skill) {
  const url = normalizeUrl(skill.url);
  const response = await fetch(url, { headers: browserHeaders });
  if (!response.ok) {
    return {
      description: null,
      retirementDate: null,
    };
  }

  const html = await response.text();
  return {
    description: extractOverview(html),
    retirementDate: extractRetirementDate(html),
  };
}

function buildExistingIndexes(existingSkills) {
  const bySlug = new Map();
  const byTitle = new Map();

  for (const skill of existingSkills) {
    if (skill.slug) bySlug.set(skill.slug, skill);
    byTitle.set(normalizeTitle(skill.title), skill);
    if (skill.learnUrl) bySlug.set(slugFromUrl(skill.learnUrl), skill);
  }

  return { bySlug, byTitle };
}

function formatSkill(skill) {
  const ordered = {
    id: skill.id,
    slug: skill.slug,
    code: skill.code,
    ...(skill.officialCode ? { officialCode: skill.officialCode } : {}),
    title: skill.title,
    area: skill.area,
    level: skill.level,
    status: skill.status,
    ...(skill.expiryDate ? { expiryDate: skill.expiryDate } : {}),
    description: skill.description,
    learnUrl: skill.learnUrl,
  };

  return JSON.stringify(ordered, null, 2)
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

function renderCertificationBlock(certifications) {
  return `// status: 'active' | 'beta' | 'expiring' | 'retired'
// Updated by scripts/update-applied-skills.mjs from Microsoft Learn API and the Certifications poster.
export const certifications = [
${certifications.map(formatCertification).join(',\n')},
];

`;
}

function renderAppliedSkillsBlock(skills) {
  return `// Applied Skills — sourced from official Applied Skills Poster
// Updated by scripts/update-applied-skills.mjs from Microsoft Learn API, detail pages, and the Applied Skills poster.
// status: 'active' | 'expiring' | 'retired'
export const appliedSkills = [
${skills.map(formatSkill).join(',\n')},
];

`;
}

function replaceBetween(source, startMarker, endMarker, replacement) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Could not locate block between ${startMarker} and ${endMarker}`);
  }
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

async function main() {
  const moduleUrl = pathToFileURL(dataFile).href;
  const { appliedSkills: existingSkills, certifications: existingCertifications } = await import(
    `${moduleUrl}?t=${Date.now()}`
  );
  const { bySlug, byTitle } = buildExistingIndexes(existingSkills);
  const usedCodes = new Set();
  const [browseResults, certificationApiResults, appliedPosterText, certificationPosterText] =
    await Promise.all([
      fetchAppliedSkillBrowseResults(),
      fetchCredentialBrowseResults("(credential_types/any(c: c eq 'certification'))"),
      fetchPdfText(appliedSkillsPosterUrl),
      fetchPdfText(certificationsPosterUrl),
    ]);

  const nextSkills = [];
  for (const result of browseResults) {
    const slug = slugFromUrl(result.url);
    const existing = bySlug.get(slug) || byTitle.get(normalizeTitle(result.title)) || {};
    const detail = await fetchDetail(result);
    const code =
      existing.code && !usedCodes.has(existing.code) ? existing.code : makeCode(slug, usedCodes);
    usedCodes.add(code);

    nextSkills.push({
      id: existing.id || slug,
      slug,
      code,
      officialCode: result.uid || slug,
      title: stripMicrosoftPrefix(result.title),
      area: inferArea(result),
      level: result.display_levels?.[0] || existing.level || 'Intermediate',
      status: detail.retirementDate ? 'expiring' : 'active',
      expiryDate: detail.retirementDate,
      description:
        detail.description ||
        existing.description ||
        `Validate hands-on skills for ${stripMicrosoftPrefix(result.title)}.`,
      learnUrl: normalizeUrl(result.url),
    });
  }

  const appliedPosterTitles = extractAppliedPosterTitles(appliedPosterText);
  const nextSlugs = new Set(nextSkills.map((skill) => skill.slug));
  for (const posterOnlySkill of POSTER_ONLY_APPLIED_SKILLS) {
    const posterHasSkill = appliedPosterTitles.some(
      (title) => normalizeTitle(title) === normalizeTitle(posterOnlySkill.title)
    );
    if (posterHasSkill && !nextSlugs.has(posterOnlySkill.slug)) {
      nextSkills.push(posterOnlySkill);
    }
  }

  nextSkills.sort((a, b) => a.title.localeCompare(b.title));
  assertUniqueCodes(nextSkills, 'Applied Skills');

  const posterCertificationEntries = extractCertificationPosterEntries(certificationPosterText);
  const apiCertificationIndexes = buildApiCertificationIndexes(certificationApiResults);
  const existingCertificationIndexes = buildCertificationIndexes(existingCertifications);
  const nextCertifications = posterCertificationEntries.map((entry) =>
    buildCertificationFromSources(entry, apiCertificationIndexes, existingCertificationIndexes)
  );
  assertUniqueCodes(nextCertifications, 'Certifications');

  const source = await fs.readFile(dataFile, 'utf8');
  const certificationStartMarker = "// status: 'active' | 'beta' | 'expiring' | 'retired'";
  const startMarker = '// Applied Skills — sourced from official Applied Skills Poster';
  const endMarker = '// Timeline events — sourced from RSS feed scraper';

  let nextSource = replaceBetween(
    source,
    certificationStartMarker,
    startMarker,
    renderCertificationBlock(nextCertifications)
  );
  nextSource = replaceBetween(
    nextSource,
    startMarker,
    endMarker,
    renderAppliedSkillsBlock(nextSkills)
  );

  await fs.writeFile(dataFile, nextSource);
  console.log(
    `Updated ${nextCertifications.length} Certifications and ${nextSkills.length} Applied Skills in ${path.relative(
      repoRoot,
      dataFile
    )}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
