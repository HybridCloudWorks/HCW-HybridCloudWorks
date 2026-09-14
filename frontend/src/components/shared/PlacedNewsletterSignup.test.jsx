/**
 * The public signup box, placed where the owner chose (#557): the footer and
 * the end of a blog post each show it only when the placement includes them,
 * both share one request, and until that request answers — or when it
 * fails — the page is the page it was before the setting existed.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const fetchNewsletterSignupConfig = vi.fn();

vi.mock('@/lib/publicApi', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchNewsletterSignupConfig: (...args) => fetchNewsletterSignupConfig(...args),
}));

vi.mock('react-helmet-async', () => ({
  Helmet: ({ children }) => <>{children}</>,
}));

import Footer from '@/components/shared/Footer';
import BlogDetailTemplate from '@/components/templates/BlogDetailTemplate';
import { resetNewsletterSignupConfig } from '@/hooks/useNewsletterSignupConfig';
import { DEFAULT_SIGNUP_CONFIG } from '@/lib/newsletterSignup';

const article = {
  id: 'a1',
  slug: 'a1',
  Title: 'An article',
  Summary: 'Summary.',
  Content: '<p>Body.</p>',
};

function renderPage() {
  return render(
    <MemoryRouter>
      <BlogDetailTemplate provider="azure" section="blog" previewItem={article} />
      <Footer />
    </MemoryRouter>
  );
}

/** Each mounted box, by the wrapper it sits in. */
const boxes = () => screen.queryAllByRole('region', { name: 'Newsletter signup' });
const inFooter = () => boxes().filter((box) => box.closest('footer')).length;
const inArticle = () => boxes().filter((box) => box.closest('article')).length;

/** Resolve every pending promise and the state updates they cause. */
const settle = () => act(async () => {});

let warn;

beforeEach(() => {
  resetNewsletterSignupConfig();
  fetchNewsletterSignupConfig.mockReset();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe('PlacedNewsletterSignup', () => {
  it('shows the default box in both places while the setting is loading', async () => {
    fetchNewsletterSignupConfig.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(inFooter()).toBe(1);
    expect(inArticle()).toBe(1);
    for (const box of boxes()) {
      expect(box).toHaveTextContent(DEFAULT_SIGNUP_CONFIG.heading);
      expect(box).toHaveTextContent(DEFAULT_SIGNUP_CONFIG.blurb);
    }
  });

  it('makes one request for the footer and the article together', async () => {
    fetchNewsletterSignupConfig.mockResolvedValue({ placement: 'both', heading: 'Hi', blurb: 'B' });
    renderPage();
    await settle();
    expect(fetchNewsletterSignupConfig).toHaveBeenCalledTimes(1);
    expect(boxes()).toHaveLength(2);
  });

  it('keeps the default box in both places when the request fails', async () => {
    fetchNewsletterSignupConfig.mockRejectedValue(new Error('offline'));
    renderPage();
    await settle();
    expect(inFooter()).toBe(1);
    expect(inArticle()).toBe(1);
    expect(boxes()[0]).toHaveTextContent(DEFAULT_SIGNUP_CONFIG.heading);
    expect(warn).toHaveBeenCalled();
  });

  it.each([
    ['footer', 1, 0],
    ['blogEnd', 0, 1],
    ['both', 1, 1],
    ['none', 0, 0],
  ])(
    'placement %s shows the box %i time(s) in the footer and %i at the end of the post',
    async (placement, footer, post) => {
      fetchNewsletterSignupConfig.mockResolvedValue({
        placement,
        heading: 'Owner heading',
        blurb: 'Owner blurb',
      });
      renderPage();
      // The defaults show both boxes, so wait until no default wording is left:
      // only then has the answer itself been applied.
      await waitFor(() => {
        expect(screen.queryAllByText(DEFAULT_SIGNUP_CONFIG.heading)).toHaveLength(0);
        expect(inFooter()).toBe(footer);
        expect(inArticle()).toBe(post);
      });
      for (const box of boxes()) {
        expect(box).toHaveTextContent('Owner heading');
        expect(box).toHaveTextContent('Owner blurb');
      }
    }
  );

  it('renders the owner heading and blurb as text, so markup shows literally', async () => {
    fetchNewsletterSignupConfig.mockResolvedValue({
      placement: 'footer',
      heading: '<b>Bold</b> news',
      blurb: '<img src=x onerror=alert(1)>',
    });
    renderPage();
    const heading = await screen.findByRole('heading', { name: '<b>Bold</b> news' });
    expect(heading.querySelector('b')).toBeNull();
    const footer = heading.closest('footer');
    expect(footer.querySelector('img')).toBeNull();
    expect(footer).toHaveTextContent('<img src=x onerror=alert(1)>');
  });

  it('uses the defaults for anything in the answer it cannot use', async () => {
    fetchNewsletterSignupConfig.mockResolvedValue({
      placement: 'sidebar',
      heading: '  ',
      blurb: 7,
    });
    renderPage();
    await settle();
    expect(inFooter()).toBe(1);
    expect(inArticle()).toBe(1);
    expect(boxes()[0]).toHaveTextContent(DEFAULT_SIGNUP_CONFIG.heading);
    expect(boxes()[0]).toHaveTextContent(DEFAULT_SIGNUP_CONFIG.blurb);
  });

  it('mounts a later page with the answer already in hand, without asking again', async () => {
    fetchNewsletterSignupConfig.mockResolvedValue({
      placement: 'blogEnd',
      heading: 'H',
      blurb: 'B',
    });
    const first = renderPage();
    await settle();
    first.unmount();
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>
    );
    // No default box flashes in the footer on the second page.
    expect(inFooter()).toBe(0);
    expect(fetchNewsletterSignupConfig).toHaveBeenCalledTimes(1);
  });
});
