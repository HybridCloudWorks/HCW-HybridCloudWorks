const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const TARGET_DIRS = [path.join(ROOT_DIR, 'src', 'pages'), path.join(ROOT_DIR, 'src', 'components')];

const PROVIDERS = ['aws', 'azure', 'gcp', 'github', 'terraform', 'finops', 'vmware', 'ansible'];
const PROVIDER_PATH_REGEX = new RegExp(
  `\\b(?:to|href)=["']\\/(${PROVIDERS.join('|')})\\/[^"']+`,
  'g'
);

const FILE_EXTENSIONS = new Set(['.jsx', '.tsx', '.js', '.ts']);

function walkDir(dirPath, files = []) {
  if (!fs.existsSync(dirPath)) {
    return files;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, files);
    } else if (FILE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const matches = content.match(PROVIDER_PATH_REGEX);
  if (!matches) return [];

  return matches.map((match) => ({
    filePath,
    match,
  }));
}

function formatPath(filePath) {
  return path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');
}

function run() {
  const files = TARGET_DIRS.flatMap((dir) => walkDir(dir));
  const findings = files.flatMap(scanFile);

  if (findings.length === 0) {
    console.log('OK: No hard-coded provider paths found.');
    process.exit(0);
  }

  console.error('ERROR: Hard-coded provider paths detected:');
  for (const finding of findings) {
    console.error(`- ${formatPath(finding.filePath)} -> ${finding.match}`);
  }

  console.error(`\nFound ${findings.length} hard-coded provider paths.`);
  console.error('Replace them with routeFactory helpers.');
  process.exit(1);
}

run();
