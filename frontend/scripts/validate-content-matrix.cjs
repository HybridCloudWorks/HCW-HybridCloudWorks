const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_FILE = path.join(ROOT, 'src', 'App.jsx');
const PAGES_DIR = path.join(ROOT, 'src', 'pages');

const PROVIDER_MATRIX = {
  aws: [
    'LandingPage.jsx',
    'BlogPage.jsx',
    'RssPage.jsx',
    'ArchitecturePage.jsx',
    'FrameworksPage.jsx',
  ],
  azure: [
    'LandingPage.jsx',
    'BlogPage.jsx',
    'RssPage.jsx',
    'ArchitecturePage.jsx',
    'FrameworksPage.jsx',
  ],
  gcp: [
    'LandingPage.jsx',
    'BlogPage.jsx',
    'RssPage.jsx',
    'ArchitecturePage.jsx',
    'FrameworksPage.jsx',
  ],
  finops: ['LandingPage.jsx', 'BlogPage.jsx', 'RssPage.jsx', 'ArchitecturePage.jsx'],
  github: ['LandingPage.jsx', 'BlogPage.jsx', 'RssPage.jsx', 'CodePage.jsx'],
  terraform: ['LandingPage.jsx', 'BlogPage.jsx', 'RssPage.jsx', 'CodePage.jsx'],
};

const APP_EXPECTATIONS = [
  { label: 'Provider blog route', pattern: /path="blog"/ },
  { label: 'Provider blog detail route', pattern: /path="blog\/:slug"/ },
  { label: 'Provider news detail route', pattern: /path="news\/:slug"/ },
  { label: 'Provider architecture route', pattern: /path="architecture-designs"/ },
  { label: 'Provider frameworks route', pattern: /path="frameworks"/ },
  { label: 'Provider code route', pattern: /path="code"/ },
  { label: 'Provider code detail route', pattern: /path="code\/:slug"/ },
  { label: 'Provider RSS route', pattern: /path="rss"/ },
  { label: 'GitHub code dispatcher', pattern: /provider="github"\s+section="code"/ },
  { label: 'Terraform code dispatcher', pattern: /provider="terraform"\s+section="code"/ },
];

function asRel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function checkProviderFiles() {
  const errors = [];

  for (const [provider, requiredFiles] of Object.entries(PROVIDER_MATRIX)) {
    const providerDir = path.join(PAGES_DIR, provider);

    if (!fs.existsSync(providerDir)) {
      errors.push(`Missing provider directory: src/pages/${provider}`);
      continue;
    }

    for (const fileName of requiredFiles) {
      const fullPath = path.join(providerDir, fileName);
      if (!fs.existsSync(fullPath)) {
        errors.push(`Missing required page for ${provider}: ${asRel(fullPath)}`);
      }
    }
  }

  return errors;
}

function checkAppRoutes() {
  const errors = [];

  if (!fs.existsSync(APP_FILE)) {
    return ['Missing src/App.jsx'];
  }

  const appContent = fs.readFileSync(APP_FILE, 'utf8');
  for (const rule of APP_EXPECTATIONS) {
    if (!rule.pattern.test(appContent)) {
      errors.push(`Missing App route/dispatch contract: ${rule.label}`);
    }
  }

  return errors;
}

function main() {
  const errors = [...checkProviderFiles(), ...checkAppRoutes()];

  if (errors.length > 0) {
    console.error('ERROR: Provider/content matrix validation failed.');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log('OK: Provider/content matrix validation passed.');
}

main();
