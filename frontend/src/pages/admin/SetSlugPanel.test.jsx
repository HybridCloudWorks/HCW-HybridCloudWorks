import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SetSlugPanel, {
  SET_SLUG_ROUTE,
  currentSlugOf,
  describeSetSlugResult,
  sourceLinkHref,
  suggestedSlugFor,
} from './SetSlugPanel';

const postJSON = vi.fn();
const logAdminAction = vi.fn();

vi.mock('@/lib/api', () => ({
  postJSON: (...args) => postJSON(...args),
  getJSON: vi.fn(),
}));

vi.mock('@/lib/auditLog', () => ({
  logAdminAction: (...args) => logAdminAction(...args),
}));

/** One of the three articles from #400, as the publish snapshot carries it. */
const HELD = 'enable-ai-powered-discovery-of-azure-updates-with-microsoft-release-communicatio';
const WANTED = 'in-preview-public-preview-code-first-observability-for-foundry-agents-in-vs-code';
const collided = {
  id: '1k5ayjbEdYdo7NzvXIWW',
  Title:
    'Enable AI-Powered Discovery of Azure Updates with Microsoft Release Communications MCP Server',
  slug: HELD,
  Slug: WANTED,
};

beforeEach(() => {
  postJSON.mockReset();
  logAdminAction.mockReset();
});

describe('pure helpers', () => {
  it('suggests the Slug field FIRST, which is the #400 answer', () => {
    // On all three articles `slug` holds the contested URL and `Slug` still
    // holds the source publisher's — the only record of what each one is. The
    // other ordering would suggest the broken value back to the operator.
    expect(suggestedSlugFor(collided)).toBe(WANTED);
    expect(currentSlugOf(collided)).toBe(HELD);
  });

  it('falls back to slug, then to nothing to suggest', () => {
    expect(suggestedSlugFor({ slug: 'only-lower' })).toBe('only-lower');
    expect(suggestedSlugFor({ Title: 'A Title' })).toBe('');
    expect(currentSlugOf({ Slug: 'only-upper' })).toBe('only-upper');
    expect(currentSlugOf({})).toBe('');
  });

  it('describes a move, a no-op and a normalisation differently', () => {
    const moved = describeSetSlugResult({
      changed: true,
      moved: true,
      requested: WANTED,
      previousSlug: HELD,
      slug: WANTED,
      publicUrl: `https://hybridcloudworks.com/azure/blog/${WANTED}`,
    });
    expect(moved.tone).toBe('ok');
    expect(moved.message).toContain(HELD);
    expect(moved.message).toContain(WANTED);
    expect(moved.message).not.toContain('normalised');

    const normalised = describeSetSlugResult({
      changed: true,
      moved: true,
      requested: '  Agent Kit!  ',
      previousSlug: HELD,
      slug: 'agent-kit',
    });
    expect(normalised.message).toContain('normalised from "Agent Kit!"');

    const noop = describeSetSlugResult({ changed: false, reason: 'Already on that slug' });
    expect(noop.tone).toBe('muted');
    expect(noop.message).toContain('Already on that slug');
  });

  it('describes a URL-only repair as a repair, never as "Moved from x to x"', () => {
    // The write is real — Slug caught up and two URL fields were written — but
    // the slug did not move, and the move sentence would read as a bug in the
    // tool rather than as the repair it is.
    const repaired = describeSetSlugResult({
      changed: true,
      moved: false,
      requested: HELD,
      previousSlug: HELD,
      slug: HELD,
      fields: ['Slug', 'slugPageUrl', 'publicUrl'],
      publicUrl: `https://hybridcloudworks.com/azure/blog/${HELD}`,
    });
    expect(repaired.tone).toBe('ok');
    expect(repaired.message).not.toContain('Moved from');
    expect(repaired.message).toContain('Slug unchanged');
    expect(repaired.message).toContain('Slug, slugPageUrl, publicUrl');
    expect(repaired.publicUrl).toBe(`https://hybridcloudworks.com/azure/blog/${HELD}`);

    // With no field list it still says what happened rather than inventing one.
    const bare = describeSetSlugResult({ changed: true, moved: false, slug: HELD });
    expect(bare.message).toContain('Repaired its published URLs');
  });

  it('falls back to comparing the slugs when the API predates `moved`', () => {
    // The deploy window in which the page is newer than the Functions app.
    const older = describeSetSlugResult({ changed: true, previousSlug: HELD, slug: HELD });
    expect(older.message).not.toContain('Moved from');
    expect(older.message).toContain('Slug unchanged');
    const olderMoved = describeSetSlugResult({ changed: true, previousSlug: HELD, slug: WANTED });
    expect(olderMoved.message).toContain('Moved from');
  });
});

describe('identifying which article the panel is editing', () => {
  // The case this exists for: three articles that share a title, a provider
  // and a date, so the list rows are identical and the suggestion is the same
  // contested slug three times. Measured on production 2026-09-08. Without an
  // identity line the operator guesses, and guessing wrong puts an article on
  // another article's URL.
  const indistinguishable = {
    id: '7MCkl1cSf7GGCgJxlCwZ',
    Title:
      'Enable AI-Powered Discovery of Azure Updates with Microsoft Release Communications MCP Server',
    slug: HELD,
    Slug: HELD,
    sourceUrl: 'https://azure.microsoft.com/updates?id=562894',
  };

  it('names the content id even when the title and both slug fields collide', () => {
    render(<SetSlugPanel item={indistinguishable} onApplied={() => {}} />);
    // Exact, not substring: a shorter id must not pass by being a prefix.
    const id = screen.getByText('7MCkl1cSf7GGCgJxlCwZ');
    expect(id.textContent).toBe('7MCkl1cSf7GGCgJxlCwZ');
  });

  it('links the source URL, which says what the article is when the title does not', () => {
    render(<SetSlugPanel item={indistinguishable} onApplied={() => {}} />);
    const link = screen.getByRole('link', { name: 'source' });
    expect(link).toHaveAttribute('href', 'https://azure.microsoft.com/updates?id=562894');
  });

  it('refuses a sourceUrl that is not an absolute http(s) URL', () => {
    // sourceUrl arrives from an upstream feed this site does not control, so
    // it is an href sink. Caught in review on #421.
    for (const hostile of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'java\tscript:alert(1)', // the parser strips the tab, the prefix check would not
      'data:text/html;base64,PHNjcmlwdD4=',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      '//evil.example/post', // a relative reference by the grammar, but off-site
      '/relative/path',
      'mailto:someone@example.com',
      '',
      '   ',
      null,
      undefined,
      42,
      // These two are why `safeUrl` is called and not just the http(s) prefix
      // test: both START with a clean `https://`, so the prefix check admits
      // them, and both carry an embedded control or space character that the
      // URL parser strips before navigating. What is stored and what is
      // fetched then differ, which is the whole class safeUrl exists to refuse.
      'https://ex\tample.com/a',
      'https://example.com/a b',
    ]) {
      expect(sourceLinkHref(hostile), `expected ${String(hostile)} to be refused`).toBe('');
    }
  });

  it('keeps a legitimate absolute source URL exactly as given', () => {
    const url = 'https://azure.microsoft.com/updates?id=562894';
    expect(sourceLinkHref(url)).toBe(url);
    expect(sourceLinkHref('http://example.com/a')).toBe('http://example.com/a');
  });

  it('renders no link when the sourceUrl is hostile, and still shows the id', () => {
    render(
      <SetSlugPanel
        item={{ ...indistinguishable, sourceUrl: 'javascript:alert(1)' }}
        onApplied={() => {}}
      />
    );
    expect(screen.queryByRole('link', { name: 'source' })).toBeNull();
    expect(screen.getByText(indistinguishable.id).textContent).toBe(indistinguishable.id);
  });

  it('opens the source in a new tab without handing it a window reference', () => {
    render(<SetSlugPanel item={indistinguishable} onApplied={() => {}} />);
    const link = screen.getByRole('link', { name: 'source' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders no source link for an authored article that has none', () => {
    render(<SetSlugPanel item={collided} onApplied={() => {}} />);
    expect(screen.queryByRole('link', { name: 'source' })).toBeNull();
    // The id still shows: it is the half that always exists.
    expect(screen.getByText(collided.id).textContent).toBe(collided.id);
  });
});

describe('SetSlugPanel', () => {
  it('prefills the suggestion and sends the raw input to the route', async () => {
    postJSON.mockResolvedValue({
      contentId: collided.id,
      requested: WANTED,
      changed: true,
      moved: true,
      fields: ['slug', 'curatedSubpagePath'],
      previousSlug: HELD,
      slug: WANTED,
      publicUrl: `https://hybridcloudworks.com/azure/blog/${WANTED}`,
    });
    const onApplied = vi.fn();
    render(<SetSlugPanel item={collided} onApplied={onApplied} />);

    expect(screen.getByRole('textbox')).toHaveValue(WANTED);
    fireEvent.click(screen.getByRole('button', { name: /Set slug/ }));

    await waitFor(() => expect(postJSON).toHaveBeenCalled());
    expect(postJSON).toHaveBeenCalledWith(SET_SLUG_ROUTE, {
      contentId: collided.id,
      slug: WANTED,
    });
    expect(await screen.findByText(new RegExp(`Moved from "${HELD}"`))).toBeInTheDocument();
    expect(onApplied).toHaveBeenCalledWith(collided.id, expect.objectContaining({ slug: WANTED }));
    expect(logAdminAction).toHaveBeenCalledWith(
      'content_slug_set',
      expect.objectContaining({ contentId: collided.id, changed: true })
    );
  });

  it('shows the refusal reason and does not report a change', async () => {
    // authedFetch turns a non-2xx into a throw carrying the API's own `error`,
    // which for a clash names the document holding the URL.
    postJSON.mockRejectedValue(
      new Error("Slug 'wanted' is already held by 7MCkl1cSf7GGCgJxlCwZ. Nothing was changed.")
    );
    const onApplied = vi.fn();
    render(<SetSlugPanel item={collided} onApplied={onApplied} />);

    fireEvent.click(screen.getByRole('button', { name: /Set slug/ }));

    expect(await screen.findByText(/7MCkl1cSf7GGCgJxlCwZ/)).toBeInTheDocument();
    expect(screen.getByText(/Slug not set/)).toBeInTheDocument();
    expect(screen.queryByText(/Moved from/)).not.toBeInTheDocument();
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('reports a server-side no-op instead of claiming success', async () => {
    postJSON.mockResolvedValue({
      contentId: collided.id,
      changed: false,
      reason: 'Already on that slug, and its URLs already match',
      slug: WANTED,
    });
    const onApplied = vi.fn();
    render(<SetSlugPanel item={collided} onApplied={onApplied} />);

    fireEvent.click(screen.getByRole('button', { name: /Set slug/ }));

    expect(await screen.findByText(/No change/)).toBeInTheDocument();
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('offers the suggestion back once the operator has typed over it', async () => {
    render(<SetSlugPanel item={collided} onApplied={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Use it' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'something-else' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use it' }));
    expect(screen.getByRole('textbox')).toHaveValue(WANTED);
  });

  it('will not submit an empty slug', () => {
    render(<SetSlugPanel item={{ id: 'c1' }} onApplied={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Set slug/ })).toBeDisabled();
    expect(postJSON).not.toHaveBeenCalled();
  });
});
