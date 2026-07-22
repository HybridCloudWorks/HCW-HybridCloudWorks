#!/usr/bin/env node
/**
 * Fetch OpenAI API key from Notion and generate AI cover images.
 *
 * This script:
 * 1. Fetches OPENAI_API_KEY from Notion secrets database
 * 2. Runs generate-ai-covers.js with the API key
 *
 * Note: Firebase credentials are resolved via Application Default Credentials (ADC).
 * Run `gcloud auth application-default login` locally, or use a service account
 * key mounted via the environment — never commit serviceAccountKey.json to the repo.
 *
 * Prerequisites:
 * - NOTION_API_TOKEN environment variable
 * - NOTION_SECRETS_DB_ID environment variable
 *
 * Usage: node scripts/fetch-credentials-and-generate.js
 */

const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Check environment variables
const { NOTION_API_TOKEN, NOTION_SECRETS_DB_ID } = process.env;
if (!NOTION_API_TOKEN || !NOTION_SECRETS_DB_ID) {
  console.error('❌ Missing required environment variables:');
  console.error(`   NOTION_API_TOKEN: ${NOTION_API_TOKEN ? '✓' : '✗'}`);
  console.error(`   NOTION_SECRETS_DB_ID: ${NOTION_SECRETS_DB_ID ? '✓' : '✗'}`);
  console.error('\nPlease set these environment variables and try again.\n');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_API_TOKEN });

/**
 * Extract rich text from Notion property
 */
function extractRichText(richTextArray) {
  if (!richTextArray || !Array.isArray(richTextArray)) return '';
  return richTextArray.map((block) => block.text?.content || '').join('');
}

/**
 * Extract title from Notion property
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

  const prop = properties[key];
  switch (prop.type) {
    case 'title':
      return extractTitle(prop.title);
    case 'rich_text':
      return extractRichText(prop.rich_text);
    case 'checkbox':
      return prop.checkbox;
    default:
      return null;
  }
}

/**
 * Fetch all secrets from Notion database
 */
async function fetchSecrets() {
  console.log('📖 Fetching secrets from Notion database...\n');

  const secrets = {};
  let hasMore = true;
  let startCursor = undefined;

  while (hasMore) {
    const response = await notion.databases.query({
      database_id: NOTION_SECRETS_DB_ID,
      start_cursor: startCursor,
    });

    for (const page of response.results) {
      const name = getPropertyValue(page.properties, 'Variable');
      const value = getPropertyValue(page.properties, 'Value');

      if (name && value) {
        secrets[name] = value;
      }
    }

    hasMore = response.has_more;
    startCursor = response.next_cursor;
  }

  console.log(`✓ Fetched ${Object.keys(secrets).length} secrets from Notion\n`);
  return secrets;
}

/**
 * Main execution
 */
async function main() {
  console.log('🔐 Fetching OpenAI API key from Notion...\n');

  try {
    // FINDING-01 (CRITICAL): Removed serviceAccountKey.json filesystem check.
    // The check validated that a service account key file exists in the repo tree,
    // which encouraged committing credentials to source control.
    // Firebase Admin SDK resolves credentials via Application Default Credentials (ADC):
    //   - Locally: `gcloud auth application-default login`
    //   - CI/CD: Workload Identity Federation or GOOGLE_APPLICATION_CREDENTIALS env var
    //            pointing to a key file outside the repo
    // No credential file paths should ever appear in source code.
    console.log(
      '✓ Firebase credentials will be resolved via Application Default Credentials (ADC)'
    );

    // Fetch all secrets from Notion
    const secrets = await fetchSecrets();

    // Extract OpenAI API key
    const openaiKey = secrets['OPENAI_API_KEY'];

    if (!openaiKey) {
      console.error('\n❌ OPENAI_API_KEY not found in Notion database');
      console.error('   Please add a secret named "OPENAI_API_KEY" with your OpenAI key');
      console.error('   Get your key from: https://platform.openai.com/api-keys\n');
      process.exit(1);
    }

    console.log('✓ Found OPENAI_API_KEY in Notion\n');

    // Run the AI cover generation script
    console.log('🎨 Starting AI cover image generation...\n');
    console.log(`${'─'.repeat(80)}\n`);

    const child = spawn('node', [path.join(__dirname, 'generate-ai-covers.js')], {
      env: { ...process.env, OPENAI_API_KEY: openaiKey },
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      console.log(`\n${'─'.repeat(80)}`);
      if (code === 0) {
        console.log('\n✅ AI cover generation completed successfully!');
        console.log('\nImages uploaded to Firebase Storage and Firestore updated.');
        console.log('Frontend will now use these AI-generated covers.\n');
      } else {
        console.error(`\n❌ AI cover generation failed with exit code ${code}`);
        process.exit(code);
      }
    });

    child.on('error', (err) => {
      console.error('\n❌ Failed to start AI cover generation:', err);
      process.exit(1);
    });
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
      console.error('\nNetwork error. Please check your internet connection and try again.\n');
    }
    process.exit(1);
  }
}

main();
