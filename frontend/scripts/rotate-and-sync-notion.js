const crypto = require('crypto');
const { exec } = require('child_process');
const { promisify } = require('util');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { Client } = require('@notionhq/client');

const execAsync = promisify(exec);

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('');
  log(`${'='.repeat(60)}`, 'cyan');
  log(`  ${title}`, 'bold');
  log(`${'='.repeat(60)}`, 'cyan');
  console.log('');
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

// Parse arguments
const argv = yargs(hideBin(process.argv))
  .option('db-id', {
    describe: 'Notion database ID',
    type: 'string',
    demandOption: true,
  })
  .option('force', {
    describe: 'Force rotation of all eligible secrets',
    type: 'boolean',
    default: false,
  })
  .option('include-manual', {
    describe: 'Include secrets requiring manual rotation',
    type: 'boolean',
    default: false,
  })
  .option('dry-run', {
    describe: 'Show what would happen without making changes',
    type: 'boolean',
    default: false,
  })
  .parse();

const { NOTION_API_TOKEN } = process.env;
const GH_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

if (!NOTION_API_TOKEN) {
  // Try to load from local file for dev if checking manually?
  // But strictly, we error out.
  // Unless we want `dotenv`.
  // I won't add dotenv dependency to avoid package.json churn unless necessary.
  if (!argv.dryRun) {
    // allow dry run? No, dry run needs to query notion.
    logError('NOTION_API_TOKEN environment variable not set');
    process.exit(1);
  }
}

const notion = new Client({ auth: NOTION_API_TOKEN });
const databaseId = argv.dbId;

/**
 * Extract property value from Notion page
 */
function getPropertyValue(properties, propertyName) {
  if (!properties || !properties[propertyName]) return null;

  const prop = properties[propertyName];

  switch (prop.type) {
    case 'title':
      return prop.title?.[0]?.text?.content || null;
    case 'rich_text':
      return prop.rich_text?.[0]?.text?.content || null;
    case 'checkbox':
      return prop.checkbox;
    case 'select':
      return prop.select?.name || null;
    case 'date':
      return prop.date ? new Date(prop.date.start) : null;
    case 'multi_select':
      return prop.multi_select?.map((s) => s.name) || [];
    default:
      return null;
  }
}

/**
 * Calculate next rotation date based on policy
 */
function calculateNextRotationDate(policy, baseDate = new Date()) {
  const date = new Date(baseDate);

  switch (policy) {
    case 'Monthly':
      date.setMonth(date.getMonth() + 1);
      break;
    case 'Quarterly':
      date.setMonth(date.getMonth() + 3);
      break;
    case 'Annually':
      date.setFullYear(date.getFullYear() + 1);
      break;
    case 'Never':
    default:
      return null;
  }

  return date.toISOString().split('T')[0];
}

/**
 * Check if a secret needs rotation
 */
function needsRotation(secret, force = false) {
  if (force) return true;

  const nextRotation = getPropertyValue(secret.properties, 'NextRotation');
  const canAutoRotate = getPropertyValue(secret.properties, 'CanAutoRotate');

  if (!canAutoRotate) {
    return false;
  }

  if (!nextRotation) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const nextRotationDate = new Date(nextRotation);
  nextRotationDate.setHours(0, 0, 0, 0);

  return nextRotationDate <= today;
}

/**
 * Determine if a secret can be auto-rotated based on name pattern
 */
function isAutoRotatable(name) {
  // Patterns that require MANUAL rotation
  const manualRotationPatterns = [
    /CLOUDFLARE_/,
    /KEYCLOAK_.*_CLIENT_ID$/,
    /KEYCLOAK_.*_CLIENT_SECRET$/,
    /AWS_ACCESS_KEY_ID$/,
    /R2_ACCOUNT_ID$/,
    /R2_BUCKET_NAME$/,
    /.*_URL$/,
    /KEYCLOAK_BASE_URL$/,
    /KEYCLOAK_REALM$/,
    /MCP_.*_URL$/,
    /ALERT_EMAIL_/,
    /ALERT_SMTP_/,
    /VITE_/,
    /RESTIC_NOTIFICATION_URL$/,
    /HEALTHCHECK_/,
    /RENDER_SERVICE_ID$/,
  ];

  for (const pattern of manualRotationPatterns) {
    if (pattern.test(name)) {
      return false;
    }
  }

  return true;
}

/**
 * Generate random secret
 */
async function generateRandomSecret(name) {
  let bytes = 32;
  if (name.includes('TOKEN') || name.includes('API_KEY')) {
    bytes = 48;
  } else if (name.includes('PASSWORD') || name.includes('KEY') || name.includes('SECRET')) {
    bytes = 32;
  }

  // Try openssl for best entropy, fall back to node crypto
  try {
    const { stdout } = await execAsync(`openssl rand -base64 ${bytes}`);
    return stdout.trim();
  } catch (error) {
    // logWarning('Using crypto fallback (openssl not available)');
    return crypto.randomBytes(bytes).toString('base64');
  }
}

/**
 * Fetch rotation candidates from Notion
 */
async function fetchRotationCandidates(force = false, includeManual = false) {
  logSection('Phase 1: Querying Notion for Rotation Candidates');
  logInfo(`Database ID: ${databaseId}`);
  if (force) logWarning('Force rotation mode enabled');
  if (includeManual) logWarning('Including manual rotation candidates');
  console.log('');

  const candidates = [];
  let hasMore = true;
  let startCursor = undefined;

  try {
    while (hasMore) {
      const response = await notion.databases.query({
        database_id: databaseId,
        start_cursor: startCursor,
        page_size: 100,
      });

      for (const page of response.results) {
        const name = getPropertyValue(page.properties, 'Variable');

        if (!name) continue;

        const canAutoRotateProp = getPropertyValue(page.properties, 'CanAutoRotate');

        // Safety check: Is it structurally allowed to be auto-rotated?
        const allowedToAutoRotate = isAutoRotatable(name);

        // Effective Auto Rotate means: Checkbox is Checked AND Name pattern allows it
        const effectiveAutoRotate = canAutoRotateProp && allowedToAutoRotate;

        // If not including manual and secret doesn't effectively auto-rotate, skip
        // Unless forcing? Force usually implies forcing checking dates, but we shouldn't rotate manual secrets even with force.
        // The legacy script logic: if (!includeManual && !canAutoRotate && !force) continue;
        // Wait, if force is true, it includes things even if canAutoRotate is false?
        // That seems dangerous for manual secrets.
        // But let's stick to legacy logic or improve it.
        // Improved: Don't rotate manual secrets even if force is true, unless includeManual is true?
        // Actually, the loop continues below..

        if (!includeManual && !effectiveAutoRotate && !force) {
          continue;
        }

        if (needsRotation({ properties: page.properties }, force)) {
          candidates.push({
            name,
            pageId: page.id,
            category: getPropertyValue(page.properties, 'Category'),
            criticality: getPropertyValue(page.properties, 'Criticality'),
            rotationPolicy: getPropertyValue(page.properties, 'RotationPolicy'),
            lastRotated: getPropertyValue(page.properties, 'LastRotated'),
            nextRotation: getPropertyValue(page.properties, 'NextRotation'),
            requiresMfa: getPropertyValue(page.properties, 'RequiresMFA'),
            canAutoRotate: effectiveAutoRotate, // Use effective value
            // rotationMethod: getPropertyValue(page.properties, 'RotationMethod'), // Might not exist in all DBs
          });
        }
      }

      hasMore = response.has_more;
      startCursor = response.next_cursor;
    }

    if (candidates.length === 0) {
      logInfo('No secrets need rotation at this time.');
      return candidates;
    }

    // Sort by criticality
    const criticalityOrder = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    candidates.sort((a, b) => {
      const aOrder = criticalityOrder[a.criticality] ?? 99;
      const bOrder = criticalityOrder[b.criticality] ?? 99;
      return aOrder - bOrder;
    });

    log(`\n📋 Found ${candidates.length} rotation candidates:\n`, 'yellow');

    for (const candidate of candidates) {
      console.log(`  ${candidate.criticality || 'Unknown'} | ${candidate.name}`);
      console.log(
        `    Last Rotated: ${candidate.lastRotated ? new Date(candidate.lastRotated).toISOString().split('T')[0] : 'Never'}`
      );
      console.log(
        `    Next Rotation: ${candidate.nextRotation ? new Date(candidate.nextRotation).toISOString().split('T')[0] : 'N/A'}`
      );
      console.log(`    Auto-rotate: ${candidate.canAutoRotate ? 'Yes' : 'Manual only'}`);
      console.log('');
    }

    return candidates;
  } catch (error) {
    logError(`Failed to query Notion: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Generate rotated values for candidates
 */
async function generateRotations(candidates) {
  logSection('Phase 2: Generating New Secret Values');

  if (candidates.length === 0) {
    return [];
  }

  const rotations = [];
  let autoRotatableCount = 0;
  let manualRotationCount = 0;

  for (const candidate of candidates) {
    // We already calculated effective canAutoRotate in fetch
    if (candidate.canAutoRotate) {
      const newValue = await generateRandomSecret(candidate.name);
      rotations.push({
        ...candidate,
        autoRotate: true,
        newValue,
        rotatedAt: new Date().toISOString(),
      });
      autoRotatableCount++;
      log(`  ✓ Generated rotation for ${candidate.name}`, 'green');
    } else {
      rotations.push({
        ...candidate,
        autoRotate: false,
        newValue: '[MANUAL ROTATION REQUIRED]',
        rotatedAt: new Date().toISOString(),
      });
      manualRotationCount++;
      logWarning(`Manual rotation required for ${candidate.name}`);
    }
  }

  console.log('');
  logSuccess(`Rotation generation complete:`);
  console.log(`   Auto-rotatable: ${autoRotatableCount}`);
  console.log(`   Manual rotation: ${manualRotationCount}\n`);

  return rotations;
}

/**
 * Update secret in Notion
 */
async function updateSecretInNotion(rotation) {
  const nextRotationDate = calculateNextRotationDate(rotation.rotationPolicy);

  try {
    await notion.pages.update({
      page_id: rotation.pageId,
      properties: {
        Value: {
          rich_text: [{ text: { content: rotation.newValue } }],
        },
        LastRotated: {
          date: { start: rotation.rotatedAt.split('T')[0] },
        },
        ...(nextRotationDate && {
          NextRotation: {
            date: { start: nextRotationDate },
          },
        }),
      },
    });

    return true;
  } catch (error) {
    logError(`Failed to update ${rotation.name}: ${error.message}`);
    return false;
  }
}

/**
 * Update Notion with rotated values
 */
async function updateNotionWithRotations(rotations, dryRun = false) {
  logSection('Phase 3: Updating Notion with Rotated Values');

  if (rotations.length === 0) {
    logInfo('No rotations to update.');
    return { updated: 0, skipped: 0, failed: 0 };
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const rotation of rotations) {
    if (!rotation.autoRotate) {
      logInfo(`Skipping ${rotation.name} (requires manual rotation)`);
      skipped++;
      continue;
    }

    if (dryRun) {
      log(`  [DRY-RUN] Would update ${rotation.name}:`, 'cyan');
      console.log(`     Value length: ${rotation.newValue.length}`);
      const nextDate = calculateNextRotationDate(rotation.rotationPolicy);
      console.log(`     NextRotation: ${nextDate}`);
      console.log('');
      updated++;
    } else {
      const success = await updateSecretInNotion(rotation);
      if (success) {
        logSuccess(`Updated ${rotation.name}`);
        updated++;
      } else {
        failed++;
      }
    }
  }

  return { updated, skipped, failed };
}

/**
 * Trigger notion-to-sops workflow
 */
async function triggerSyncWorkflow() {
  logSection('Phase 4: Triggering Notion→SOPS Sync');

  if (!GH_TOKEN) {
    logError('GH_TOKEN not set - cannot trigger workflow');
    return false;
  }

  try {
    logInfo('Dispatching notion-to-sops workflow...');
    const commitMessage = `chore(secrets): automated monthly rotation - ${new Date().toISOString().split('T')[0]}`;

    // Use execSync for simplicity in CommonJS or await execAsync
    const cmd = `gh workflow run secret-encrypt.yml --ref main -f commit_message="${commitMessage}"`;

    const { stdout } = await execAsync(cmd, {
      env: { ...process.env, GH_TOKEN },
    });

    logSuccess('Workflow dispatched successfully');
    console.log(stdout);
    return true;
  } catch (error) {
    logError(`Failed to trigger workflow: ${error.message}`);
    return false;
  }
}

/**
 * Main execution
 */
async function main() {
  log('\n╔═══════════════════════════════════════════════════════╗', 'cyan');
  log('║   Rotate and Sync Secrets to Notion                  ║', 'cyan');
  log('╚═══════════════════════════════════════════════════════╝\n', 'cyan');

  if (argv.dryRun) {
    logWarning('DRY-RUN MODE: No changes will be made\n');
  }

  try {
    // Phase 1
    const candidates = await fetchRotationCandidates(argv.force, argv.includeManual);

    if (candidates.length === 0) {
      logSection('Complete');
      logInfo('No secrets need rotation.');
      return;
    }

    // Phase 2
    const rotations = await generateRotations(candidates);

    // Phase 3
    const { updated, failed } = await updateNotionWithRotations(rotations, argv.dryRun);

    // Phase 4
    if (!argv.dryRun && updated > 0) {
      await triggerSyncWorkflow();
    }

    logSection('Summary');
    if (argv.dryRun) {
      logInfo(`Dry run complete. ${updated} secrets would be rotated.`);
    } else {
      logSuccess(`Complete. ${updated} secrets rotated.`);
      if (failed > 0) logError(`${failed} updates failed.`);
    }
  } catch (error) {
    logError(`Fatal: ${error.message}`);
    process.exit(1);
  }
}

main();
