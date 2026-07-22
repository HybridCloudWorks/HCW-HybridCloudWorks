// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addDoc, collection, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectId = 'demo-hybridcloudworks-admin-rules';
const rules = fs.readFileSync(
  path.resolve(__dirname, '..', 'platform', 'firebase', 'firestore.rules'),
  'utf8'
);

let testEnv;

function authenticatedUserContext(uid, email = `${uid}@example.com`, extraToken = {}) {
  return testEnv.authenticatedContext(uid, {
    email,
    ...extraToken,
    firebase: {
      sign_in_provider: 'google.com',
      identities: {
        email: [email],
      },
    },
  });
}

describe('Firestore admin rules', () => {
  beforeAll(async () => {
    const hostConfig = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
    const [host, portString] = hostConfig.split(':');
    testEnv = await initializeTestEnvironment({
      projectId,
      firestore: {
        host,
        port: Number(portString),
        rules,
      },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'admins', 'approved'), { uids: ['admin-user'] });
      await setDoc(doc(adminDb, 'content', 'content-1'), {
        Title: 'Rules smoke content',
        contentStatus: 'inspected',
        Live: false,
      });
      await setDoc(doc(adminDb, 'admin_audit_logs', 'existing-audit'), {
        action: 'seeded',
        timestamp: new Date().toISOString(),
      });
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('allows approved admins to update content', async () => {
    const adminDb = authenticatedUserContext('admin-user', 'admin@example.com').firestore();
    await assertSucceeds(
      updateDoc(doc(adminDb, 'content', 'content-1'), {
        contentStatus: 'editing',
      })
    );
  });

  it('blocks non-admin authenticated users from mutating content', async () => {
    const userDb = authenticatedUserContext('regular-user', 'regular@example.com').firestore();
    await assertFails(
      updateDoc(doc(userDb, 'content', 'content-1'), {
        contentStatus: 'editing',
      })
    );
  });

  it('blocks claims-only admins when they are not in admins/approved', async () => {
    const claimsOnlyDb = authenticatedUserContext('claims-only-admin', 'claims-only@example.com', {
      adminRole: 'super_admin',
      permissions: ['read:content', 'write:content', 'publish:content'],
    }).firestore();
    await assertFails(
      updateDoc(doc(claimsOnlyDb, 'content', 'content-1'), {
        contentStatus: 'editing',
      })
    );
  });

  it('blocks direct client creation of admin audit logs even for admins', async () => {
    const adminDb = authenticatedUserContext('admin-user', 'admin@example.com').firestore();
    await assertFails(
      addDoc(collection(adminDb, 'admin_audit_logs'), {
        action: 'forged_audit',
        timestamp: new Date().toISOString(),
      })
    );
  });

  it('allows approved admins to read admin audit logs', async () => {
    const adminDb = authenticatedUserContext('admin-user', 'admin@example.com').firestore();
    const snapshot = await assertSucceeds(
      getDoc(doc(adminDb, 'admin_audit_logs', 'existing-audit'))
    );
    expect(snapshot.exists()).toBe(true);
  });

  it('blocks non-admin users from reading admin audit logs', async () => {
    const userDb = authenticatedUserContext('regular-user', 'regular@example.com').firestore();
    await assertFails(getDoc(doc(userDb, 'admin_audit_logs', 'existing-audit')));
  });

  it('allows service-account style clients to bypass rules for operational tooling', async () => {
    const serviceContext = testEnv.authenticatedContext('svc-admin-tool', {
      firebase: {
        sign_in_provider: 'custom',
        identities: {},
      },
    });
    const serviceDb = serviceContext.firestore();
    await assertSucceeds(
      updateDoc(doc(serviceDb, 'content', 'content-1'), {
        contentStatus: 'service-updated',
      })
    );
  });
});
