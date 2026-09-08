/**
 * The article page must not put a video into its hero `<img>` (issue #374).
 *
 * The audited document, verbatim from the content manifest of 2026-09-07:
 * `contentImageUrl` held
 * `…/2026/06/RUBRIC-EVALUATOR.mp4` (a real 5.3 MB `video/mp4`), the body that
 * renders was the RSS stub in `Content`, and no other cover field was set. The
 * deployed page carried exactly one broken image, and it was the hero — plus
 * an `og:image` and a `twitter:image` advertising the same video to every
 * crawler.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

// Passthrough so the head tags land in the DOM and can be asserted on.
vi.mock('react-helmet-async', () => ({
  Helmet: ({ children }) => <>{children}</>,
}));

import BlogDetailTemplate from '@/components/templates/BlogDetailTemplate';

const RUBRIC_EVALUATOR_MP4 =
  'https://devblogs.microsoft.com/foundry/wp-content/uploads/sites/89/2026/06/RUBRIC-EVALUATOR.mp4';

/** The audited article, reduced to the fields that decide the cover. */
const foundryArticle = {
  id: 'foundry-observability',
  slug: 'microsoft-foundry-end-to-end-observability-and-roi-for-production-ai-agents',
  Title: 'Build 2026: From observability to ROI for AI agents on any framework',
  Summary: 'End-to-end observability for production AI agents.',
  Content: '<p>9 min read · June 3, 2026 · Sebastian Kohlmeier</p>',
  contentImageUrl: RUBRIC_EVALUATOR_MP4,
};

function renderArticle(article) {
  return render(
    <MemoryRouter>
      <BlogDetailTemplate provider="azure" section="blog" previewItem={article} />
    </MemoryRouter>
  );
}

/**
 * React 19 hoists `<meta>` out of the component tree into `document.head`, so
 * the rendered container never holds them — read the head instead.
 */
function headMeta(selector) {
  return document.head.querySelector(selector)?.getAttribute('content') ?? null;
}

describe('BlogDetailTemplate cover image', () => {
  it('renders no image at all when the only cover candidate is a video', () => {
    const { container } = renderArticle(foundryArticle);

    // The page renders — this is a cover defect, not a page failure.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Build 2026: From observability to ROI for AI agents on any framework'
    );

    const images = [...container.querySelectorAll('img')];
    expect(images.map((img) => img.getAttribute('src'))).toEqual([]);
  });

  it('never emits the video URL as a src anywhere on the page', () => {
    const { container } = renderArticle(foundryArticle);

    expect(container.querySelector(`img[src="${RUBRIC_EVALUATOR_MP4}"]`)).toBeNull();
  });

  it('leaves og:image and twitter:image off rather than advertising a video', () => {
    renderArticle(foundryArticle);

    expect(headMeta('meta[property="og:image"]')).toBeNull();
    expect(headMeta('meta[name="twitter:image"]')).toBeNull();
    // Without an image the large-image card is a lie; it falls back to summary.
    expect(headMeta('meta[name="twitter:card"]')).toBe('summary');
  });

  it('falls through to the real cover when the feed video shadows one', () => {
    const { container } = renderArticle({
      ...foundryArticle,
      altCoverImage: 'https://cdn.example.com/covers/foundry-hero.png',
    });

    const images = [...container.querySelectorAll('img')];
    expect(images.map((img) => img.getAttribute('src'))).toEqual([
      'https://cdn.example.com/covers/foundry-hero.png',
    ]);
    expect(headMeta('meta[property="og:image"]')).toBe(
      'https://cdn.example.com/covers/foundry-hero.png'
    );
  });

  it('still renders an ordinary image cover', () => {
    const { container } = renderArticle({
      ...foundryArticle,
      contentImageUrl: 'https://cdn.example.com/covers/ordinary.webp',
    });

    const images = [...container.querySelectorAll('img')];
    expect(images.map((img) => img.getAttribute('src'))).toEqual([
      'https://cdn.example.com/covers/ordinary.webp',
    ]);
  });
});
