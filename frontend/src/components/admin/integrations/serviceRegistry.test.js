/**
 * The service registry every tab reads (moved from IntegrationsPage.test.jsx,
 * #570): which services exist, where each lives, and that each browser-side
 * test reads the proxy envelope's `ok` rather than reporting Connected for a
 * refusal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SERVICES, SERVICE_GROUPS } from './serviceRegistry';

const postJSON = vi.fn();
vi.mock('@/lib/api', () => ({
  getJSON: vi.fn(),
  sendJSON: vi.fn(),
  postJSON: (...args) => postJSON(...args),
}));

describe('the service registry', () => {
  it('still names every service the old Connections page did', () => {
    // The original seven, less Klaviyo, which was removed on purpose when
    // Resend replaced it (ADR 0030). The order changed when the cards were
    // sorted into groups and three education profiles were added, so this
    // asserts PRESENCE rather than sequence - dropping one is the failure it
    // guards.
    const names = SERVICES.map((service) => service.name);
    for (const name of ['Publer', 'Plaud', 'Sessionize', 'Credly', 'Linkie', 'YouTube']) {
      expect(names, `${name} disappeared from the registry`).toContain(name);
    }
  });

  it('lists exactly the services it means to, in group order', () => {
    expect(SERVICES.map((service) => service.name)).toEqual([
      'Publer',
      'Resend',
      'Linkie',
      'Telegram',
      'RSS.com',
      'YouTube',
      'Plaud',
      'Sessionize',
      'Credly',
      'Microsoft Learn',
      'AWS Skill Builder',
      'Google Developer',
    ]);
  });

  it('gives every service a URL, since that is the one thing they all have', () => {
    // A card with no globe is a dead end: no key to rotate, no test to run and
    // nowhere to go. Education profiles have only the globe, which is the
    // whole reason they are on the page.
    for (const service of SERVICES) {
      expect(service.url, `${service.name} has no url`).toMatch(/^https:\/\//);
    }
  });

  it('sends a credential with no test straight to the page that manages it', () => {
    // No beaker means the globe is the only thing this page can do about a red
    // light, so it has to land where the credential is minted - not on the
    // vendor's front door. A bare host would be a shrug.
    //
    // This used to assert the set was non-empty, because a vacuous rule is its
    // own kind of broken. #483 emptied it legitimately - Telegram, RSS.com and
    // YouTube were the last three and they all have server-side tests now - so
    // that guard would fail for the right reason, which makes it the wrong
    // guard. It is replaced by the test below, which pins the set to empty
    // rather than to non-empty. The rule here still stands and starts holding
    // again the moment anything joins the set.
    const untestable = SERVICES.filter(
      (service) => !service.test && (service.secrets ?? []).length > 0
    );
    for (const service of untestable) {
      const { pathname } = new URL(service.url);
      expect(
        pathname.replace(/\/+$/, '').length,
        `${service.name} points at a bare host (${service.url}) with no test beside it`
      ).toBeGreaterThan(0);
    }
  });

  it('leaves no credentialed service untestable, which is what #483 closed', () => {
    // The replacement for the vacuousness guard above. Every service that
    // holds a credential can now be asked whether it works, including the
    // three whose keys never reach the browser - those run server-side through
    // `connectionProbe`. Adding a credentialed service with no test is allowed,
    // but it has to be a decision made HERE, in the open, at which point the
    // globe rule above starts applying to it.
    const untestable = SERVICES.filter(
      (service) => !service.test && (service.secrets ?? []).length > 0
    ).map((service) => service.name);
    expect(untestable).toEqual([]);
  });

  describe('the three server-side probes (#483)', () => {
    // Exercised through SERVICES rather than by importing the runners, because
    // the field IS the contract: the card calls whatever sits in `test`.
    const runnerFor = (id) => SERVICES.find((service) => service.id === id).test;

    beforeEach(() => postJSON.mockReset());

    it('posts a probe NAME, never a path or a method', async () => {
      // The whole security argument for this route is that the caller supplies
      // no part of the outbound request. A runner that started sending a path
      // would silently undo it, so the shape is pinned here.
      for (const [id, probe] of [
        ['telegram', 'telegram'],
        ['rsscom', 'rsscom'],
        ['youtube', 'youtube'],
      ]) {
        postJSON.mockResolvedValueOnce({ ok: true, status: 200, data: {} });
        await runnerFor(id)();
        expect(postJSON).toHaveBeenLastCalledWith('connectionProbe', { probe });
      }
    });

    it('throws on a refusal instead of reporting Connected', async () => {
      // #463 item 1 and #479: the proxies answer HTTP 200 for every outcome,
      // so a runner that does not read `ok` says Connected for a 401. That
      // defect has now been written three times in this file's history, which
      // is why every new runner gets this test.
      for (const id of ['telegram', 'rsscom', 'youtube']) {
        postJSON.mockResolvedValueOnce({
          ok: false,
          status: 401,
          error: 'Unauthorized',
          data: { description: 'Unauthorized' },
        });
        await expect(runnerFor(id)(), id).rejects.toThrow(/Unauthorized/);
      }
    });

    it('names the bot a Telegram token belongs to, which is the useful half', async () => {
      postJSON.mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { ok: true, result: { username: 'hcw_bot' } },
      });
      await expect(runnerFor('telegram')()).resolves.toContain('@hcw_bot');
    });

    it('counts the shows an RSS.com key can see', async () => {
      postJSON.mockResolvedValueOnce({ ok: true, status: 200, data: [{ id: 1 }, { id: 2 }] });
      await expect(runnerFor('rsscom')()).resolves.toContain('2 show(s)');
    });

    it('says what a YouTube press costs, because pressing it spends quota', async () => {
      postJSON.mockResolvedValueOnce({ ok: true, status: 200, data: { items: [] } });
      await expect(runnerFor('youtube')()).resolves.toMatch(/quota/i);
    });
  });

  it('puts every service in a group that exists', () => {
    const ids = new Set(SERVICE_GROUPS.map((group) => group.id));
    for (const service of SERVICES) {
      expect(ids, `${service.name} is in group '${service.group}'`).toContain(service.group);
    }
  });

  it('leaves only YouTube out of Test all, and says why in words', () => {
    // Test all presses every beaker at once; YouTube's spends daily quota.
    const skipped = SERVICES.filter((service) => service.skipInTestAll);
    expect(skipped.map((service) => service.id)).toEqual(['youtube']);
    expect(skipped[0].skipInTestAll).toMatch(/quota/i);
  });
});
