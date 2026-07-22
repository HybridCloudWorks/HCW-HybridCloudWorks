#!/usr/bin/env node

/* eslint-disable no-console */
/**
 * Fetch API Keys from Notion and Set Firebase Secrets
 *
 * Retrieves the current AI pipeline secrets from Notion and configures them
 * and configures them as Firebase Cloud Function secrets.
 *
 * Usage:
 *   node setup-api-keys-from-notion.js
 *
 * Environment Variables Required:
 *   - NOTION_API_TOKEN: Notion integration token
 *   - NOTION_SECRETS_DB_ID: Optional override for Notion secrets database ID
 */

const { execSync } = require('child_process');

const DEFAULT_NOTION_SECRETS_DB_ID = '2cb0982b27b680c392e5d8fa4c797cda';

// Check environment variables
const { NOTION_API_TOKEN } = process.env;
const NOTION_SECRETS_DB_ID = process.env.NOTION_SECRETS_DB_ID || DEFAULT_NOTION_SECRETS_DB_ID;

if (!NOTION_API_TOKEN) {
  console.error('❌ ERROR: NOTION_API_TOKEN environment variable not set');
  console.error('   Export it or add to .env file');
  process.exit(1);
}

if (!process.env.NOTION_SECRETS_DB_ID) {
  console.warn('ℹ️  NOTION_SECRETS_DB_ID not set. Using default HCW secrets database ID.');
}

/**
 * Extract text from Notion rich text property
 */
function extractRichText(richTextArray) {
  if (!richTextArray || !Array.isArray(richTextArray)) return '';
  return richTextArray.map((block) => block.text?.content || '').join('');
}

/**
 * Extract title from Notion title property
 */
function extractTitle(titleArray) {
  if (!titleArray || !Array.isArray(titleArray)) return '';
  return titleArray.map((block) => block.text?.content || '').join('');
}

/**
 * Get property value from Notion page
 */
function getPropertyValue(properties, propertyName) {
  const key = Object.keys(properties).find((k) => k.toLowerCase() === propertyName.toLowerCase());

  if (!key) return null;

  const property = properties[key];

  switch (property.type) {
    case 'title':
      return extractTitle(property.title);
    case 'rich_text':
      return extractRichText(property.rich_text);
    case 'checkbox':
      return property.checkbox;
    case 'select':
      return property.select?.name;
    default:
      return null;
  }
}

/**
 * Query Notion database for specific secrets
 */
async function fetchSecretsFromNotion(secretNames) {
  console.log('🔍 Querying Notion secrets database...\n');

  const secrets = {};

  try {
    const res = await fetch(`https://api.notion.com/v1/databases/${NOTION_SECRETS_DB_ID}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${NOTION_API_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ page_size: 100 }),
    });

    if (!res.ok) {
      throw new Error(`Notion API returned HTTP ${res.status}: ${await res.text()}`);
    }

    const response = await res.json();

    console.log(`   Found ${response.results.length} total secrets in Notion\n`);

    for (const page of response.results) {
      const secretName = getPropertyValue(page.properties, 'Variable');
      const secretValue = getPropertyValue(page.properties, 'Value');

      if (secretNames.includes(secretName)) {
        secrets[secretName] = secretValue;
        console.log(`   ✅ Found: ${secretName}`);
      }
    }

    console.log();

    // Verify all required secrets were found
    const missing = secretNames.filter((name) => !secrets[name]);
    if (missing.length > 0) {
      console.error('❌ Missing secrets in Notion database:');
      missing.forEach((name) => console.error(`   - ${name}`));
      console.error('\nPlease add these secrets to your Notion database first.');
      process.exit(1);
    }

    return secrets;
  } catch (err) {
    console.error('❌ Failed to query Notion:', err.message);
    if (err.code === 'object_not_found') {
      console.error(
        '\n   Check that NOTION_SECRETS_DB_ID is correct and the integration has access.'
      );
    }
    process.exit(1);
  }
}

/**
 * Set Firebase secret using CLI
 */
function setFirebaseSecret(secretName, secretValue) {
  console.log(`\n🔐 Setting Firebase secret: ${secretName}`);

  try {
    // Avoid PowerShell piping which introduces UTF-16 BOM and CRLF
    const command = `firebase functions:secrets:set ${secretName} --project hybridcloudworks-61e8d --force`;

    execSync(command, {
      input: secretValue,
      stdio: ['pipe', 'inherit', 'inherit'],
    });

    console.log(`   ✅ ${secretName} configured successfully`);
  } catch (error) {
    console.error(`   ❌ Failed to set ${secretName}:`, error.message);
    throw error;
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📦 SETUP API KEYS FROM NOTION FOR CONTENT PIPELINE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Secrets we need from Notion for the current default pipeline
  const requiredSecrets = ['REPLICATE_API_KEY', 'FIRECRAWL_API_KEY', 'VPS_API_TOKEN'];

  console.log('📋 Required secrets for content pipeline:');
  requiredSecrets.forEach((name) => console.log(`   - ${name}`));
  console.log();

  // Fetch from Notion
  const secrets = await fetchSecretsFromNotion(requiredSecrets);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🚀 CONFIGURING FIREBASE SECRETS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  let successCount = 0;
  let failCount = 0;

  for (const [secretName, secretValue] of Object.entries(secrets)) {
    try {
      setFirebaseSecret(secretName, secretValue);
      successCount++;
    } catch {
      failCount++;
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log(`   ✅ Successfully configured: ${successCount}/${requiredSecrets.length}`);
  if (failCount > 0) {
    console.log(`   ❌ Failed: ${failCount}/${requiredSecrets.length}`);
  }

  if (successCount === requiredSecrets.length) {
    console.log('\n✨ All API keys configured! Ready to deploy functions.\n');
    console.log('Next steps:');
    console.log('   1. Ensure functions/.env contains the recommended non-secret AI config');
    console.log('   2. Deploy functions:');
    console.log('      cd functions');
    console.log('      firebase deploy --only functions');
    console.log('\n   3. Validate readiness:');
    console.log('      node --env-file=.env check-ai-stack-readiness.js');
  } else {
    console.log('\n⚠️  Some secrets failed to configure. Check errors above.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\n❌ Script failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
