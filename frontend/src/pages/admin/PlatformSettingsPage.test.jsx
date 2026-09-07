/**
 * The page's side of the "shape cannot drift" promise: what each card sends
 * on Save is exactly the body the server's normalizer expects, the bundled
 * defaults are the eight lowercase paths under /images/default-heroes/, and
 * a hand-seeded document that failed validation is shown as such rather
 * than as a working setting.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

import PlatformSettingsPage, {
  DefaultCoversCard,
  HERO_PROVIDERS,
  PODCAST_PROVIDERS,
  PodcastFeedsCard,
  SocialAutopostCard,
  bundledDefaultHeroes,
  isAcceptableHeroUrl,
  settingRoute,
} from './PlatformSettingsPage';

// The Radix Switch measures its thumb with ResizeObserver, which jsdom lacks.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const getJSON = vi.fn();
const sendJSON = vi.fn();
const postJSON = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/api', () => ({
  getJSON: (...args) => getJSON(...args),
  sendJSON: (...args) => sendJSON(...args),
  postJSON: (...args) => postJSON(...args),
}));
vi.mock('@/hooks/useAuthReady', () => ({ useAuthReady: () => ({ authReady: true }) }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast }) }));

const empty = {
  'default-heroes': { heroes: {} },
  'social-autopost': { enabled: false, accountIds: [], scheduleDelayMinutes: 60 },
  'podcast-feeds': { feeds: [] },
};

const settingFor = (route) => route.replace('cms/platform-settings/', '');

const meta = { exists: false, stored: null, updatedAt: null, problem: null };

beforeEach(() => {
  getJSON.mockReset().mockImplementation(async (route) => ({
    success: true,
    setting: settingFor(route),
    value: empty[settingFor(route)],
    exists: false,
    stored: null,
    updatedAt: null,
  }));
  sendJSON.mockReset().mockImplementation(async (route, _method, body) => ({
    success: true,
    setting: settingFor(route),
    value: body,
    exists: true,
    stored: 'valid',
    updatedAt: '2026-09-07T12:00:00.000Z',
  }));
  // The proxy envelope for an unseeded key (rest-proxy.js), not a bare array.
  postJSON.mockReset().mockResolvedValue({ ok: false, code: 'INTEGRATION_NOT_CONFIGURED' });
  toast.mockReset();
});

describe('bundled defaults', () => {
  it('are the eight lowercase files under /images/default-heroes/', () => {
    expect(bundledDefaultHeroes()).toEqual({
      Azure: '/images/default-heroes/azure.png',
      AWS: '/images/default-heroes/aws.png',
      GCP: '/images/default-heroes/gcp.png',
      GitHub: '/images/default-heroes/github.png',
      Terraform: '/images/default-heroes/terraform.png',
      Ansible: '/images/default-heroes/ansible.png',
      VMware: '/images/default-heroes/vmware.png',
      Multi: '/images/default-heroes/multi.png',
    });
    expect(HERO_PROVIDERS).toHaveLength(8);
    expect(PODCAST_PROVIDERS).toEqual([
      'azure',
      'aws',
      'gcp',
      'github',
      'terraform',
      'finops',
      'vmware',
      'ansible',
    ]);
  });
});

describe('DefaultCoversCard', () => {
  it('renders one field per provider and fills them all from the bundled button', () => {
    const onChange = vi.fn();
    render(
      <DefaultCoversCard
        value={{ heroes: {} }}
        meta={meta}
        saving={false}
        onChange={onChange}
        onSave={vi.fn()}
      />
    );
    for (const provider of HERO_PROVIDERS) expect(screen.getByLabelText(provider)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Use bundled defaults/ }));
    expect(onChange).toHaveBeenCalledWith({ heroes: bundledDefaultHeroes() });
  });

  it('edits one provider without touching the others and saves once per submit', () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    render(
      <DefaultCoversCard
        value={{ heroes: { AWS: '/aws.png' } }}
        meta={meta}
        saving={false}
        onChange={onChange}
        onSave={onSave}
      />
    );
    fireEvent.change(screen.getByLabelText('Azure'), {
      target: { value: '/api/public/media/covers/azure.png' },
    });
    expect(onChange).toHaveBeenCalledWith({
      heroes: { AWS: '/aws.png', Azure: '/api/public/media/covers/azure.png' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('previews only what the server would store, and shows again once corrected', () => {
    // The page-side rule mirrors the server's: no scheme other than https, no
    // protocol-relative host, no query string or fragment (a SAS token there
    // would be published with the post).
    expect(isAcceptableHeroUrl('/images/default-heroes/azure.png')).toBe(true);
    expect(isAcceptableHeroUrl('https://cdn.example.com/a.png')).toBe(true);
    expect(isAcceptableHeroUrl('javascript:alert(1)')).toBe(false);
    expect(isAcceptableHeroUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isAcceptableHeroUrl('//evil.example.com/a.png')).toBe(false);
    expect(isAcceptableHeroUrl('/a.png?sig=token')).toBe(false);
    expect(isAcceptableHeroUrl('https://cdn.example.com/a.png#x')).toBe(false);

    const props = { meta, saving: false, onChange: vi.fn(), onSave: vi.fn() };
    const { container, rerender } = render(
      <DefaultCoversCard
        value={{
          heroes: {
            Azure: 'javascript:alert(1)',
            AWS: 'data:image/png;base64,AAAA',
            GCP: '/api/public/media/covers/gcp.png?sv=2024&sig=abc',
          },
        }}
        {...props}
      />
    );
    expect(container.querySelectorAll('img')).toHaveLength(0);

    rerender(
      <DefaultCoversCard
        value={{ heroes: { Azure: '/images/default-heroes/azure.png' } }}
        {...props}
      />
    );
    const img = screen.getByRole('img', { name: 'Azure cover preview' });
    expect(img.getAttribute('src')).toBe('/images/default-heroes/azure.png');
    expect(container.querySelectorAll('img')).toHaveLength(1);
  });

  it('hides a preview that failed to load only until the value changes', () => {
    const props = { meta, saving: false, onChange: vi.fn(), onSave: vi.fn() };
    const { rerender } = render(
      <DefaultCoversCard value={{ heroes: { Azure: '/images/missing.png' } }} {...props} />
    );
    fireEvent.error(screen.getByRole('img', { name: 'Azure cover preview' }));
    expect(screen.queryByRole('img', { name: 'Azure cover preview' })).toBeNull();

    // Same broken value: stays hidden rather than retrying on every render.
    rerender(<DefaultCoversCard value={{ heroes: { Azure: '/images/missing.png' } }} {...props} />);
    expect(screen.queryByRole('img', { name: 'Azure cover preview' })).toBeNull();

    rerender(
      <DefaultCoversCard
        value={{ heroes: { Azure: '/images/default-heroes/azure.png' } }}
        {...props}
      />
    );
    expect(screen.getByRole('img', { name: 'Azure cover preview' })).toBeTruthy();
  });

  it('says when the stored document failed validation and shows the reason', () => {
    render(
      <DefaultCoversCard
        value={{ heroes: {} }}
        meta={{
          exists: true,
          stored: 'invalid',
          updatedAt: null,
          problem: 'heroes must be an object',
        }}
        saving={false}
        onChange={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByText(/does not match the shape/)).toBeTruthy();
    expect(screen.getByText(/heroes must be an object/)).toBeTruthy();
  });
});

describe('SocialAutopostCard', () => {
  const value = {
    enabled: false,
    accountIds: [{ id: 'acc-1', provider: 'linkedin' }],
    scheduleDelayMinutes: 60,
  };

  it('toggles enabled, edits the delay, and edits an account row in place', () => {
    const onChange = vi.fn();
    render(
      <SocialAutopostCard
        value={value}
        meta={meta}
        saving={false}
        onChange={onChange}
        onSave={vi.fn()}
        publerAccounts={[]}
      />
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenLastCalledWith({ ...value, enabled: true });

    fireEvent.change(screen.getByLabelText('Delay (minutes)'), { target: { value: '90' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...value, scheduleDelayMinutes: '90' });

    fireEvent.change(screen.getByLabelText('Provider 1'), { target: { value: 'twitter' } });
    expect(onChange).toHaveBeenLastCalledWith({
      ...value,
      accountIds: [{ id: 'acc-1', provider: 'twitter' }],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove account 1' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...value, accountIds: [] });
  });

  it('offers only the free-text row when Publer lists nothing', () => {
    render(
      <SocialAutopostCard
        value={value}
        meta={meta}
        saving={false}
        onChange={vi.fn()}
        onSave={vi.fn()}
        publerAccounts={[]}
      />
    );
    expect(screen.queryByLabelText('Publer account to add')).toBeNull();
    expect(screen.getByRole('button', { name: /Add account by id/ })).toBeTruthy();
  });

  it('adds a Publer account with its own provider, hiding chosen and unsupported ones', () => {
    const onChange = vi.fn();
    render(
      <SocialAutopostCard
        value={value}
        meta={meta}
        saving={false}
        onChange={onChange}
        onSave={vi.fn()}
        publerAccounts={[
          { id: 'acc-1', name: 'Already chosen', provider: 'linkedin' },
          { id: 'acc-2', name: 'HCW on X', provider: 'Twitter' },
          { id: 'acc-3', name: 'Odd network', provider: 'mastodon' },
        ]}
      />
    );
    const picker = screen.getByLabelText('Publer account to add');
    const options = within(picker)
      .getAllByRole('option')
      .map((option) => option.textContent);
    // acc-1 is already chosen; mastodon is a network the trigger cannot post
    // to, and it must not be offered and then silently rewritten to another.
    expect(options).toEqual(['Pick a Publer account…', 'HCW on X · Twitter']);
    expect(screen.getByText(/1 Publer account hidden/)).toBeTruthy();

    fireEvent.change(picker, { target: { value: 'acc-2' } });
    fireEvent.click(screen.getByRole('button', { name: /Add from Publer/ }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...value,
      accountIds: [
        { id: 'acc-1', provider: 'linkedin' },
        { id: 'acc-2', provider: 'twitter' },
      ],
    });
  });
});

describe('PodcastFeedsCard', () => {
  it('renders the fixed rows plus any extra provider the document carries', () => {
    render(
      <PodcastFeedsCard
        value={{ feeds: [{ provider: 'kubernetes', url: 'https://x.example/k8s.rss' }] }}
        meta={meta}
        saving={false}
        onChange={vi.fn()}
        onSave={vi.fn()}
      />
    );
    for (const provider of PODCAST_PROVIDERS) expect(screen.getByLabelText(provider)).toBeTruthy();
    expect(screen.getByLabelText('kubernetes').value).toBe('https://x.example/k8s.rss');
  });

  it('keeps one row per provider when a URL is edited', () => {
    const onChange = vi.fn();
    render(
      <PodcastFeedsCard
        value={{ feeds: [{ provider: 'azure', url: 'https://x.example/old' }] }}
        meta={meta}
        saving={false}
        onChange={onChange}
        onSave={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText('azure'), {
      target: { value: 'https://x.example/new' },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      feeds: [{ provider: 'azure', url: 'https://x.example/new' }],
    });
    fireEvent.change(screen.getByLabelText('finops'), { target: { value: 'https://x.example/f' } });
    expect(onChange).toHaveBeenLastCalledWith({
      feeds: [
        { provider: 'azure', url: 'https://x.example/old' },
        { provider: 'finops', url: 'https://x.example/f' },
      ],
    });
  });
});

// unwrapPublerAccounts moved to src/lib/publerAccounts.js with #397; its unit
// tests moved with it to src/lib/publerAccounts.test.js. What stays here is
// what this page does with the result.

describe('the page', () => {
  it('offers the accounts a configured Publer returns inside the proxy envelope', async () => {
    // The regression: the envelope is { ok, status, data }, and treating it as
    // a bare array left the picker permanently empty on a configured estate.
    postJSON.mockResolvedValue({
      ok: true,
      status: 200,
      data: [{ id: 'acc-9', name: 'HCW on LinkedIn', provider: 'linkedin' }],
    });
    render(<PlatformSettingsPage />);
    const picker = await screen.findByLabelText('Publer account to add');
    expect(
      within(picker)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['Pick a Publer account…', 'HCW on LinkedIn · linkedin']);
    expect(screen.queryByText(/Publer not configured/)).toBeNull();
  });

  it('says Publer is not configured and falls back to adding by id', async () => {
    render(<PlatformSettingsPage />);
    await waitFor(() => expect(screen.getByText(/Publer not configured/)).toBeTruthy());
    expect(screen.queryByLabelText('Publer account to add')).toBeNull();
    expect(screen.getByRole('button', { name: /Add account by id/ })).toBeTruthy();
  });

  it('reports a resolved not-ok envelope as a failure carrying the upstream status', async () => {
    // Publer refused the key. The proxy answers HTTP 200 with ok:false, so this
    // resolves — a page that only catches rejections would call it "ready" and
    // show an empty picker, which is the #397 conflation one layer down.
    postJSON.mockResolvedValue({ ok: false, status: 401, data: { error: 'Invalid API key' } });
    render(<PlatformSettingsPage />);
    await waitFor(() =>
      expect(screen.getByText(/Publer accounts could not be loaded/)).toBeTruthy()
    );
    expect(screen.getByText(/Publer answered 401/)).toBeTruthy();
    // Not the unconfigured message: the key is present, it is being rejected.
    expect(screen.queryByText(/Publer not configured/)).toBeNull();
    expect(screen.getByRole('button', { name: /Add account by id/ })).toBeTruthy();
  });

  it('loads all three settings once auth is ready and asks Publer for accounts', async () => {
    render(<PlatformSettingsPage />);
    await waitFor(() => expect(screen.getByText('Podcast feeds')).toBeTruthy());
    expect(getJSON).toHaveBeenCalledWith(settingRoute('default-heroes'));
    expect(getJSON).toHaveBeenCalledWith(settingRoute('social-autopost'));
    expect(getJSON).toHaveBeenCalledWith(settingRoute('podcast-feeds'));
    expect(postJSON).toHaveBeenCalledWith('publerProxy', { path: '/accounts', method: 'GET' });
    expect(screen.getByText('Default covers')).toBeTruthy();
    expect(screen.getByText('Social autoposting')).toBeTruthy();
  });

  it('PUTs the bundled defaults to the default-heroes route', async () => {
    render(<PlatformSettingsPage />);
    await waitFor(() => expect(screen.getByText('Default covers')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Use bundled defaults/ }));
    const form = screen.getByLabelText('Azure').closest('form');
    fireEvent.submit(form);
    await waitFor(() =>
      expect(sendJSON).toHaveBeenCalledWith(settingRoute('default-heroes'), 'PUT', {
        heroes: bundledDefaultHeroes(),
      })
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Saved' }))
    );
    expect(screen.getByLabelText('Multi').value).toBe('/images/default-heroes/multi.png');
  });

  it('PUTs the autopost body the trigger reads, with the delay as typed', async () => {
    render(<PlatformSettingsPage />);
    await waitFor(() => expect(screen.getByText('Social autoposting')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Add account by id/ }));
    fireEvent.change(screen.getByLabelText('Account id 1'), { target: { value: 'pub-123' } });
    fireEvent.change(screen.getByLabelText('Delay (minutes)'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.submit(screen.getByLabelText('Delay (minutes)').closest('form'));
    await waitFor(() =>
      expect(sendJSON).toHaveBeenCalledWith(settingRoute('social-autopost'), 'PUT', {
        enabled: true,
        accountIds: [{ id: 'pub-123', provider: 'linkedin' }],
        scheduleDelayMinutes: '30',
      })
    );
  });

  it('surfaces a refused write as the server said it and keeps the edit', async () => {
    sendJSON.mockRejectedValue(new Error('feeds[0].url must be an https URL'));
    render(<PlatformSettingsPage />);
    await waitFor(() => expect(screen.getByText('Podcast feeds')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('azure'), { target: { value: 'http://x.example/f' } });
    fireEvent.submit(screen.getByLabelText('azure').closest('form'));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
          description: 'feeds[0].url must be an https URL',
        })
      )
    );
    expect(screen.getByLabelText('azure').value).toBe('http://x.example/f');
  });

  it('shows a failed load for one card without hiding the others', async () => {
    getJSON.mockImplementation(async (route) => {
      if (settingFor(route) === 'social-autopost') throw new Error('HTTP 500');
      return { success: true, value: empty[settingFor(route)], exists: false };
    });
    render(<PlatformSettingsPage />);
    await waitFor(() => expect(screen.getByText('HTTP 500')).toBeTruthy());
    expect(screen.getByText('Default covers')).toBeTruthy();
    expect(screen.getByText('Podcast feeds')).toBeTruthy();
  });
});
