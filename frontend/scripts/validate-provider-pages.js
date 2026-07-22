const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

const GUARDED_MARKER_IMPORT =
  "import ComingSoonPage from '@/pages/ComingSoonPage'; // TODO: remove to re-enable";
const GUARDED_MARKER_RETURN = 'return <ComingSoonPage />; // TODO: remove to re-enable';

const GUARDED_FILES = [
  'src/pages/gcp/ArchitecturePage.jsx',
  'src/pages/gcp/BlogPage.jsx',
  'src/pages/gcp/EducationPage.jsx',
  'src/pages/gcp/FrameworksPage.jsx',
  'src/pages/gcp/PodcastPage.jsx',
  'src/pages/gcp/RssPage.jsx',
  'src/pages/terraform/BlogPage.jsx',
  'src/pages/terraform/CodePage.jsx',
  'src/pages/terraform/EducationPage.jsx',
  'src/pages/terraform/ModulesPage.jsx',
  'src/pages/terraform/RssPage.jsx',
  'src/pages/terraform/ToolsPage.jsx',
  'src/pages/github/BlogPage.jsx',
  'src/pages/github/CodePage.jsx',
  'src/pages/github/EducationPage.jsx',
  'src/pages/github/RssPage.jsx',
  'src/pages/github/ToolsPage.jsx',
  'src/pages/github/WorkflowsPage.jsx',
  'src/pages/finops/BlogPage.jsx',
  'src/pages/finops/EducationPage.jsx',
  'src/pages/finops/FocusPage.jsx',
  'src/pages/finops/FrameworksPage.jsx',
  'src/pages/finops/RssPage.jsx',
  'src/pages/finops/ToolsPage.jsx',
];

const LIVE_FILES = [
  'src/pages/aws/ArchitecturePage.jsx',
  'src/pages/aws/BlogPage.jsx',
  'src/pages/aws/EducationPage.jsx',
  'src/pages/aws/FrameworksPage.jsx',
  'src/pages/aws/LandingPage.jsx',
  'src/pages/aws/PodcastPage.jsx',
  'src/pages/aws/RssPage.jsx',
  'src/pages/azure/ArchitecturePage.jsx',
  'src/pages/azure/BlogPage.jsx',
  'src/pages/azure/EducationPage.jsx',
  'src/pages/azure/FrameworksPage.jsx',
  'src/pages/azure/LandingPage.jsx',
  'src/pages/azure/PodcastPage.jsx',
  'src/pages/azure/RssPage.jsx',
  // Landing pages relaunched in the shared Hyoga template (P1/P2b)
  'src/pages/gcp/LandingPage.jsx',
  'src/pages/finops/LandingPage.jsx',
  'src/pages/terraform/LandingPage.jsx',
  'src/pages/github/LandingPage.jsx',
  // FinOps architecture hub re-enabled (P1)
  'src/pages/finops/ArchitecturePage.jsx',
  // VMware (cloud-provider pattern)
  'src/pages/vmware/LandingPage.jsx',
  'src/pages/vmware/ArchitecturePage.jsx',
  'src/pages/vmware/FrameworksPage.jsx',
  'src/pages/vmware/BlogPage.jsx',
  'src/pages/vmware/EducationPage.jsx',
  'src/pages/vmware/PodcastPage.jsx',
  'src/pages/vmware/RssPage.jsx',
  // Ansible (service-provider pattern)
  'src/pages/ansible/LandingPage.jsx',
  'src/pages/ansible/CodePage.jsx',
  'src/pages/ansible/BlogPage.jsx',
  'src/pages/ansible/EducationPage.jsx',
  'src/pages/ansible/RssPage.jsx',
];

function read(relativePath) {
  const absolutePath = path.join(ROOT_DIR, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Missing file: ${relativePath}`);
  }

  return fs.readFileSync(absolutePath, 'utf8');
}

function countOccurrences(content, marker) {
  return content.split(marker).length - 1;
}

function validateGuardedFile(relativePath) {
  const content = read(relativePath);
  const importCount = countOccurrences(content, GUARDED_MARKER_IMPORT);
  const returnCount = countOccurrences(content, GUARDED_MARKER_RETURN);
  const exportCount = countOccurrences(content, 'export default function');
  const errors = [];

  if (importCount !== 1) {
    errors.push(`expected 1 ComingSoon import guard, found ${importCount}`);
  }

  if (returnCount !== 1) {
    errors.push(`expected 1 ComingSoon return guard, found ${returnCount}`);
  }

  if (exportCount < 1) {
    errors.push('missing original export default function');
  }

  return errors;
}

function validateLiveFile(relativePath) {
  const content = read(relativePath);
  const errors = [];

  if (content.includes(GUARDED_MARKER_IMPORT) || content.includes(GUARDED_MARKER_RETURN)) {
    errors.push('contains ComingSoon guard marker but should be live');
  }

  return errors;
}

function printErrors(relativePath, errors) {
  for (const error of errors) {
    console.error(`- ${relativePath}: ${error}`);
  }
}

function main() {
  const failures = [];

  try {
    read('src/pages/ComingSoonPage.jsx');
  } catch (error) {
    failures.push({ file: 'src/pages/ComingSoonPage.jsx', errors: [error.message] });
  }

  for (const relativePath of GUARDED_FILES) {
    const errors = validateGuardedFile(relativePath);
    if (errors.length > 0) {
      failures.push({ file: relativePath, errors });
    }
  }

  for (const relativePath of LIVE_FILES) {
    const errors = validateLiveFile(relativePath);
    if (errors.length > 0) {
      failures.push({ file: relativePath, errors });
    }
  }

  if (failures.length > 0) {
    console.error('ERROR: Provider page contract validation failed.');
    for (const failure of failures) {
      printErrors(failure.file, failure.errors);
    }
    process.exit(1);
  }

  console.log(
    `OK: Provider page contract validated (${LIVE_FILES.length} live files, ${GUARDED_FILES.length} guarded files).`
  );
}

main();
