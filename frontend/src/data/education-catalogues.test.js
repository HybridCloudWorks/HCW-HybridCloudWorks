/**
 * Every Learn catalogue this repository hand-maintains is checked here against
 * the calendar (#461, owner rule: "Old info is a no-no for Learn sites").
 *
 * WHY THIS EXISTS. The 2026-09-09 audit found the Azure page showing ten
 * exams as "expiring" ten weeks after Microsoft retired them, AWS listing
 * SOA-C02 under the CloudOps name a year after SOA-C03 replaced it, GitHub
 * with three exam codes on the wrong titles, Terraform advertising an exam
 * HashiCorp retired in July, and GCP missing five of Google's fourteen
 * certifications. None of it failed anything: a hand-typed `status` is a
 * claim with no date attached, and nothing ever compared it to today.
 *
 * Now the pages derive what they render from the dates (`@/lib/certStatus`),
 * so a card cannot say "expiring" after the last test day. What this test
 * adds is the alarm: the moment an `expiring`, `beta` or `upcoming` row's date
 * is in the past, the suite goes red until someone re-verifies the row
 * against the vendor and updates it. The first row due is MLA-C01
 * (last test day 2026-09-28), so expect this to fire on 2026-09-29.
 *
 * Deliberately uses the real clock. A frozen date would make the assertion
 * vacuous — the point is that the repository notices when the world moves.
 *
 * Azure's catalogue has the same check in `azure/certifications.test.js`
 * (#464); both run through the one `findStaleStatuses` in `@/lib/certStatus`.
 */
import { describe, it, expect } from 'vitest';
import { findStaleStatuses, isIsoDate, todayIso } from '@/lib/certStatus';
import * as aws from '@/data/aws/certifications';
import * as gcp from '@/data/gcp/certifications';
import * as github from '@/data/github/certifications';
import * as terraform from '@/data/terraform/certifications';
import * as vmware from '@/data/vmware/education';

const CATALOGUES = { aws, gcp, github, terraform, vmware };

describe.each(Object.entries(CATALOGUES))('%s certification catalogue', (provider, mod) => {
  const { certifications, DATA_AS_OF, DATA_SOURCE } = mod;

  it('states the day it was last checked against the vendor, and that day is not in the future', () => {
    expect(isIsoDate(DATA_AS_OF), `${provider} DATA_AS_OF must be YYYY-MM-DD`).toBe(true);
    expect(DATA_AS_OF <= todayIso(), `${provider} DATA_AS_OF is in the future`).toBe(true);
    expect(DATA_SOURCE?.label, `${provider} DATA_SOURCE.label`).toBeTruthy();
    expect(DATA_SOURCE?.url, `${provider} DATA_SOURCE.url`).toMatch(/^https:\/\//);
  });

  it('has no row whose stored status its dates have already overtaken', () => {
    const stale = findStaleStatuses(certifications, todayIso());
    expect(
      stale,
      `${provider}: re-verify these rows against ${DATA_SOURCE?.url} and update the catalogue`
    ).toEqual([]);
  });

  it('has unique codes and slugs, and a learn URL on every row', () => {
    const codes = certifications.map((c) => c.code);
    const slugs = certifications.map((c) => c.slug);
    expect(new Set(codes).size, `${provider} duplicate codes`).toBe(codes.length);
    expect(new Set(slugs).size, `${provider} duplicate slugs`).toBe(slugs.length);
    for (const cert of certifications) {
      expect(cert.learnUrl, `${provider} ${cert.code} learnUrl`).toMatch(/^https:\/\//);
      expect(cert.title, `${provider} ${cert.code} title`).toBeTruthy();
      expect(cert.level, `${provider} ${cert.code} level`).toBeTruthy();
    }
  });

  it('names a replacement that exists in the same catalogue', () => {
    const slugs = new Set(certifications.map((c) => c.slug));
    for (const cert of certifications) {
      if (!cert.replacement) continue;
      expect(cert.replacement.code, `${provider} ${cert.code} replacement.code`).toBeTruthy();
      if (cert.replacement.slug) {
        expect(
          slugs.has(cert.replacement.slug),
          `${provider} ${cert.code} names replacement ${cert.replacement.slug}, which is not in the catalogue`
        ).toBe(true);
      }
    }
  });
});

describe('the AWS catalogue feeds the detail page too', () => {
  it('resolves every current slug, every previous slug, and every nextCerts link', () => {
    const slugs = new Set(aws.certifications.map((c) => c.slug));
    for (const cert of aws.certifications) {
      expect(aws.findCertificationBySlug(cert.slug)?.code).toBe(cert.code);
      for (const old of cert.previousSlugs ?? []) {
        expect(
          slugs.has(old),
          `${old} is both a previousSlug of ${cert.code} and a live slug`
        ).toBe(false);
        expect(aws.findCertificationBySlug(old)?.code, `old link /${old}`).toBe(cert.code);
      }
      for (const next of cert.nextCerts ?? []) {
        expect(slugs.has(next), `${cert.code} nextCerts -> ${next}`).toBe(true);
      }
    }
    expect(aws.findCertificationBySlug('soa-c02')?.code).toBe('SOA-C03');
    expect(aws.findCertificationBySlug('no-such-exam')).toBeUndefined();
  });

  it('carries the detail-page fields on every row', () => {
    for (const cert of aws.certifications) {
      expect(typeof cert.longDescription, `${cert.code} longDescription`).toBe('string');
      expect(Array.isArray(cert.modules), `${cert.code} modules`).toBe(true);
      expect(typeof cert.prerequisites, `${cert.code} prerequisites`).toBe('string');
    }
  });
});

describe('the facts the 2026-09-09 audit asked for (#461 items 5–9)', () => {
  const byCode = (mod) => Object.fromEntries(mod.certifications.map((c) => [c.code, c]));

  it('GitHub: each code sits on the title Microsoft Learn schedules it under', () => {
    const gh = byCode(github);
    expect(gh['GH-900']?.title).toBe('GitHub Foundations');
    expect(gh['GH-100']?.title).toBe('GitHub Administration');
    expect(gh['GH-200']?.title).toBe('GitHub Actions');
    expect(gh['GH-300']?.title).toBe('GitHub Copilot');
    expect(gh['GH-500']?.title).toBe('GitHub Advanced Security');
  });

  it('AWS: CloudOps is SOA-C03, the three version bumps and ANS-C01 carry their dates', () => {
    const a = byCode(aws);
    expect(a['SOA-C02']).toBeUndefined();
    expect(a['SOA-C03']?.title).toContain('CloudOps');
    expect(a['MLA-C01']).toMatchObject({ status: 'expiring', expiryDate: '2026-09-28' });
    expect(a['MLA-C02']).toMatchObject({ status: 'beta', gaDate: '2027-01-14' });
    expect(a['SAP-C02']).toMatchObject({ status: 'expiring', expiryDate: '2026-11-16' });
    expect(a['SAP-C03']).toMatchObject({ status: 'upcoming', availableDate: '2026-11-17' });
    expect(a['DVA-C02']).toMatchObject({ status: 'expiring', expiryDate: '2026-11-30' });
    expect(a['DVA-C03']).toMatchObject({ status: 'upcoming', availableDate: '2026-12-01' });
    expect(a['ANS-C01']).toMatchObject({ status: 'expiring', expiryDate: '2026-12-31' });
    expect(a['AIB-C01']).toMatchObject({ status: 'beta', level: 'Business' });
  });

  it('Terraform: 004 not 003, Consul retired, both Advanced credentials present', () => {
    const codes = terraform.certifications.map((c) => c.code);
    expect(codes).not.toContain('TA-003');
    expect(codes).toContain('TA-004');
    expect(terraform.certifications.find((c) => /Consul/.test(c.title))).toMatchObject({
      status: 'retired',
      retiredDate: '2026-07-15',
    });
    const titles = terraform.certifications.map((c) => c.title);
    expect(titles).toContain('HashiCorp Certified: Terraform Authoring and Operations Advanced');
    expect(titles).toContain('HashiCorp Certified: Vault Operations Advanced');
  });

  it('GCP: the five missing credentials are present and Workspace is the Associate one', () => {
    const titles = gcp.certifications.map((c) => c.title);
    for (const title of [
      'Generative AI Leader',
      'Associate Data Practitioner',
      'Associate Google Workspace Administrator',
      'Professional Cloud Database Engineer',
      'Professional Cloud DevOps Engineer',
    ]) {
      expect(titles).toContain(title);
    }
    expect(titles).not.toContain('Professional Google Workspace Administrator');
  });

  it('VMware: the role-based VCAP-VCF trio replaces VCAP-DCV Deploy and VCP-VVF is listed', () => {
    const codes = vmware.certifications.map((c) => c.code);
    expect(codes).not.toContain('VCAP-DCV');
    expect(codes).toEqual(
      expect.arrayContaining(['VCAP-VCF-ADMIN', 'VCAP-VCF-ARCH', 'VCAP-VCF-SUPPORT', 'VCP-VVF'])
    );
    const examCodes = vmware.certifications.map((c) => c.examCode).filter(Boolean);
    expect(examCodes).toEqual(
      expect.arrayContaining(['3V0-11.26', '3V0-12.26', '3V0-13.26', '2V0-16.25'])
    );
    // Learning paths must point at a code that is still in the catalogue.
    for (const path of vmware.learningPaths) {
      expect(codes, `learning path "${path.title}" -> ${path.certCode}`).toContain(path.certCode);
    }
  });
});
