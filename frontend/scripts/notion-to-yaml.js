#!/usr/bin/env node

/**
 * Notion to YAML Generator
 *
 * Fetches all secrets from Notion database and generates a YAML file
 * that can be encrypted with SOPS.
 *
 * Usage:
 *   node notion-to-yaml.js --db-id NOTION_DB_ID --output secrets.yaml --filter all
 *
 * Environment Variables:
 *   - NOTION_API_TOKEN: Required. Notion integration token
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('@notionhq/client');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

// Parse arguments
const argv = yargs(hideBin(process.argv))
  .option('db-id', {
    describe: 'Notion database ID',
    type: 'string',
    demandOption: true,
  })
  .option('output', {
    describe: 'Output YAML file path',
    type: 'string',
    default: 'secrets.yaml',
  })
  .option('filter', {
    describe: 'Filter by specific target: vps, github, firebase, all',
    type: 'string',
    default: 'all',
  })
  .parse();

const { NOTION_API_TOKEN } = process.env;
if (!NOTION_API_TOKEN) {
  console.error('❌ ERROR: NOTION_API_TOKEN environment variable not set');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_API_TOKEN });
const databaseId = argv.dbId;

// Map Notion targets to property keys if needed
// Assuming the Notion database has columns like "TargetVPS", "TargetGitHub", etc.
// If not, we fall back to Category/Environment logic if needed.
const TARGET_MAPPING = {
  vps: 'TargetVPS',
  github: 'TargetGitHub',
  firebase: 'TargetFirebase',
};

/**
 * Extract text value from Notion rich text
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
  // Try case-insensitive lookup
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
    case 'select':
      return prop.select?.name || null;
    case 'multi_select':
      return prop.multi_select?.map((s) => s.name) || [];
    case 'files':
      // Return first file URL if present
      const file = prop.files?.[0];
      return file?.file?.url || file?.external?.url || null;
    default:
      return null;
  }
}

/**
 * Fetch all secrets from Notion database
 */
async function fetchSecretsFromNotion() {
  console.log(`📖 Fetching secrets from Notion database: ${databaseId}`);

  const secrets = [];
  let hasMore = true;
  let startCursor = undefined;

  try {
    while (hasMore) {
      const response = await notion.databases.query({
        database_id: databaseId,
        start_cursor: startCursor,
        page_size: 100,
        // Optional: Filter for Production environment if column exists
        // filter: {
        //   property: 'Environment',
        //   multi_select: { contains: 'Production' }
        // }
      });

      for (const page of response.results) {
        const name = getPropertyValue(page.properties, 'Variable');
        let value = getPropertyValue(page.properties, 'Value');

        if (!name) {
          console.warn(`⚠️ Skipping page ${page.id}: Missing Variable property`);
          continue;
        }

        // Handle [IN FILES] logic
        if (value === '[IN FILES]') {
          const fileUrl = getPropertyValue(page.properties, 'Files');

          if (!fileUrl) {
            console.warn(`⚠️ Secret "${name}" marked [IN FILES] but no file URL found`);
            continue;
          }

          try {
            console.log(`   📥 Downloading "${name}" content...`);
            const fileRes = await fetch(fileUrl);
            if (!fileRes.ok) throw new Error(`HTTP ${fileRes.status}`);
            value = await fileRes.text();
            console.log(`   ✅ Downloaded ${value.length} bytes`);
          } catch (err) {
            console.warn(`⚠️ Failed to download file for "${name}": ${err.message}`);
            continue;
          }
        }

        if (!value) {
          console.warn(`⚠️ Skipping "${name}": Missing Value`);
          continue;
        }

        secrets.push({
          name,
          value,
          properties: page.properties,
        });
      }

      hasMore = response.has_more;
      startCursor = response.next_cursor;
    }

    console.log(`✅ Fetched ${secrets.length} secrets from Notion`);

    // Automation Logic: Fallback Mappings
    const mappings = {
      DB_PASSWORD: 'CORE_DB_PASSWORD',
      RABBITMQ_ADMIN_PASSWORD: 'CORE_RABBITMQ_ADMIN_PASSWORD',
    };

    for (const [source, target] of Object.entries(mappings)) {
      if (!secrets.some((s) => s.name === target)) {
        const sourceSecret = secrets.find((s) => s.name === source);
        if (sourceSecret) {
          console.log(`🔄 Automapping: Missing "${target}", using "${source}"`);
          secrets.push({
            name: target,
            value: sourceSecret.value,
            properties: sourceSecret.properties,
          });
        }
      }
    }

    return secrets;
  } catch (error) {
    console.error('❌ Error fetching from Notion:', error.message);
    if (error.body?.message) console.error(`   Details: ${error.body.message}`);
    process.exit(1);
  }
}

/**
 * Filter secrets by target
 */
function filterSecrets(secrets, target) {
  if (target === 'all') return secrets;

  // Logic: Check if target property exists and is checked (boolean)
  // Or fallback to category logic if property doesn't exist

  const targetKey = TARGET_MAPPING[target];

  return secrets.filter((secret) => {
    // 1. Try explicit target checkbox (e.g., TargetGitHub check)
    if (targetKey) {
      const isTarget = getPropertyValue(secret.properties, targetKey);
      if (isTarget === true) return true;
    }

    // 2. Fallback to Category/Environment logic
    const category = getPropertyValue(secret.properties, 'Category');
    const env = getPropertyValue(secret.properties, 'Environment');

    if (category) {
      const cat = category.toLowerCase();
      if (target === 'vps' && ['backend', 'infrastructure'].includes(cat)) return true;
      if (target === 'github' && ['frontend', 'infrastructure'].includes(cat)) return true;
      if (target === 'firebase' && ['frontend', 'ai', 'integration'].includes(cat)) return true;
    }

    return false;
  });
}

/**
 * Generate YAML content
 */
function generateYaml(secrets) {
  const sorted = secrets.sort((a, b) => a.name.localeCompare(b.name));
  const seen = new Map(); // Track duplicate keys
  let yaml = '';

  for (const secret of sorted) {
    const key = secret.name.trim();
    let value = String(secret.value || '');

    // Check for duplicates
    if (seen.has(key)) {
      console.warn(
        `⚠️ Duplicate key detected: "${key}" - keeping first occurrence, skipping duplicate`
      );
      continue;
    }
    seen.set(key, true);

    // Sanitize: remove carriage returns
    value = value.replace(/\r/g, '');

    // Trim sensitive keys that shouldn't have whitespace
    if (key.includes('KUBE_CONFIG') || key.includes('KEY') || key.includes('CERT')) {
      value = value.trim();
    }

    // Use JSON.stringify to safely escape values
    yaml += `${key}: ${JSON.stringify(value)}\n`;
  }

  return yaml;
}

/**
 * Main
 */
async function main() {
  console.log('🚀 Notion to YAML Generator');
  console.log(`   Database: ${databaseId}`);
  console.log(`   Output: ${argv.output}`);
  console.log(`   Filter: ${argv.filter}`);
  console.log('');

  const allSecrets = await fetchSecretsFromNotion();

  if (allSecrets.length === 0) {
    console.error('❌ No secrets found in Notion');
    process.exit(1);
  }

  const filtered = filterSecrets(allSecrets, argv.filter);
  console.log(`📊 Filtered to ${filtered.length} secrets for target "${argv.filter}"`);

  if (filtered.length === 0) {
    console.warn(`⚠️ Warning: No secrets matched filter "${argv.filter}"`);
  }

  const yaml = generateYaml(filtered);

  const outputPath = path.resolve(argv.output);
  const outputDir = path.dirname(outputPath);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, yaml);
  console.log(`✅ Generated ${outputPath} (${yaml.length} bytes)`);
}

main().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
