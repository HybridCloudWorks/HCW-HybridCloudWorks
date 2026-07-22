#!/usr/bin/env node

/**
 * Admin Setup Script - Automated, Secure Admin Provisioning
 *
 * USAGE:
 *   node functions/scripts/setup-admins.js
 *
 * This script:
 * 1. Authenticates with Firebase using default credentials
 * 2. Prompts for admin user emails to provision
 * 3. Sets their Firebase Custom Claims automatically
 * 4. Creates audit log entries
 * 5. NO hardcoded values, NO environment variables to manage
 *
 * Run this once to set up your admins. After that, use the
 * manageAdmins() Cloud Function to add/remove admins dynamically.
 */

const admin = require('firebase-admin');
const readline = require('readline');
const { spawnSync } = require('child_process');

// Initialize Firebase Admin SDK
// Uses GOOGLE_APPLICATION_CREDENTIALS or default service account
const projectId = process.env.FIREBASE_PROJECT_ID || 'hybridcloudworks-61e8d';
console.log(`🔐 Initializing Firebase Admin SDK for project: ${projectId}`);

if (!admin.apps.length) {
  admin.initializeApp({
    projectId,
  });
}

// ============================================================================
// ADMIN ROLES & PERMISSIONS
// ============================================================================

const ADMIN_ROLES = {
  VIEWER: { level: 1, description: 'View-only access' },
  EDITOR: { level: 2, description: 'Can edit and review content' },
  PUBLISHER: { level: 3, description: 'Can publish content to live' },
  SUPER_ADMIN: { level: 4, description: 'Full access including admin management' },
};

const PERMISSIONS = {
  viewer: ['read:content', 'read:dashboard'],
  editor: ['read:content', 'read:dashboard', 'write:content', 'review:content'],
  publisher: [
    'read:content',
    'read:dashboard',
    'write:content',
    'review:content',
    'publish:content',
  ],
  super_admin: [
    'read:content',
    'read:dashboard',
    'write:content',
    'review:content',
    'publish:content',
    'manage:admins',
  ],
};

// ============================================================================
// INTERACTIVE SETUP
// ============================================================================

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

function formatRoleList() {
  return Object.entries(ADMIN_ROLES)
    .map(([key, val]) => `  ${key.toLowerCase().padEnd(12)} - ${val.description}`)
    .join('\n');
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║  Firebase Admin Setup - Modern Secure Authentication   ║');
  console.log('║  No more hardcoded lists! Uses Firebase Custom Claims  ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  try {
    const db = admin.firestore();
    const auth = admin.auth();

    // Check existing admins
    const existingAdmins = await db.collection('admins').where('active', '==', true).get();

    if (existingAdmins.size > 0) {
      console.log(`\n📋 Existing admins (${existingAdmins.size}):`);
      existingAdmins.docs.forEach((doc) => {
        const data = doc.data();
        console.log(`   • ${data.email || data.uid} (${data.role.toUpperCase()})`);
      });
      console.log('');
    }

    // Prompt for new admin
    const email = (await question('\n📧 Enter admin email to add: ')).toLowerCase().trim();
    if (!email) {
      console.log('Cancelled.');
      rl.close();
      process.exit(0);
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      console.error('❌ Invalid email format');
      rl.close();
      process.exit(1);
    }

    // Prompt for role
    console.log('\nSelect role:');
    console.log(formatRoleList());
    const roleInput = (await question('Enter role (viewer/editor/publisher/super_admin): '))
      .toLowerCase()
      .trim();

    const normalizedRole = roleInput === 'super_admin' ? 'super_admin' : roleInput;
    if (!PERMISSIONS[normalizedRole]) {
      console.error(`❌ Invalid role. Must be one of: ${Object.keys(PERMISSIONS).join(', ')}`);
      rl.close();
      process.exit(1);
    }

    // Confirm
    console.log(`\n✓ Adding ${email} as ${normalizedRole}`);
    const confirm = await question('Continue? (yes/no): ');
    if (confirm.toLowerCase() !== 'yes') {
      console.log('Cancelled.');
      rl.close();
      process.exit(0);
    }

    // Get or create user
    console.log('\n⏳ Processing...');
    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(email);
      console.log(`   Found existing user: ${userRecord.uid}`);
    } catch (_err) {
      console.error(`❌ User with email ${email} not found in Firebase Auth`);
      console.error('   Please have the user sign in first, then run this script again.');
      rl.close();
      process.exit(1);
    }

    // Set custom claims
    const permissions = PERMISSIONS[normalizedRole];
    await auth.setCustomUserClaims(userRecord.uid, {
      adminRole: normalizedRole,
      permissions,
    });
    console.log(`   ✓ Set Firebase Custom Claims`);

    // Create admin registry entry
    await db
      .collection('admins')
      .doc(userRecord.uid)
      .set({
        uid: userRecord.uid,
        email: userRecord.email,
        role: normalizedRole,
        permissions,
        active: true,
        createdAt: new Date(),
        createdBy: 'setup-script',
        customClaims: {
          adminRole: normalizedRole,
          permissions,
          syncedAt: new Date(),
        },
      });
    console.log(`   ✓ Created admin registry entry`);

    // Log audit entry
    await db.collection('admin_audit_log').add({
      action: 'ROLE_ASSIGNED',
      targetUid: userRecord.uid,
      targetEmail: email,
      role: normalizedRole,
      actorUid: 'setup-script',
      timestamp: new Date(),
      reason: 'Initial setup via setup-admins.js',
    });
    console.log(`   ✓ Logged audit entry`);

    console.log(`\n✅ Success! Admin provisioned.`);
    console.log(`   Email: ${email}`);
    console.log(`   Role:  ${normalizedRole}`);
    console.log(`   UID:   ${userRecord.uid}\n`);

    // Offer to add more
    const addMore = await question('Add another admin? (yes/no): ');
    if (addMore.toLowerCase() === 'yes') {
      rl.close();
      // Restart the script interactively.
      spawnSync(process.execPath, [__filename], { stdio: 'inherit' });
    } else {
      console.log('\n👋 Setup complete! Your admins are now provisioned.\n');
      rl.close();
      process.exit(0);
    }
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    rl.close();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  rl.close();
  process.exit(1);
});
