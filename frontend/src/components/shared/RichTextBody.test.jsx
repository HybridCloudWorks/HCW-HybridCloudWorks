import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import RichTextBody, { looksLikeHtml } from './RichTextBody';

/**
 * The architecture and framework overviews rendered only HTML, through
 * `dangerouslySetInnerHTML`. Both publish contracts also accept the blog body
 * fields, which hold markdown — so prose the gate measured could reach the page
 * as literal `## Heading` text, or (before the fallback existed) not at all.
 */
describe('RichTextBody', () => {
  it('renders admin-authored HTML as markup', () => {
    render(<RichTextBody value="<p>An <strong>HTML</strong> overview.</p>" />);

    expect(screen.getByText('HTML').tagName).toBe('STRONG');
  });

  it('renders markdown as markdown rather than as literal syntax', () => {
    render(<RichTextBody value={'## Overview\n\nSome **bold** prose.'} />);

    // The heading must be a heading, not the characters "## Overview".
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.queryByText(/^## /)).not.toBeInTheDocument();
  });

  it('strips scripts from the HTML path', () => {
    const { container } = render(
      <RichTextBody value={'<p>Safe</p><script>window.__x = 1;</script>'} />
    );

    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('Safe')).toBeInTheDocument();
  });

  it('renders nothing for an empty or whitespace body', () => {
    const { container } = render(<RichTextBody value="   " />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('looksLikeHtml', () => {
  it('treats block-level tags as HTML', () => {
    expect(looksLikeHtml('<p>x</p>')).toBe(true);
    expect(looksLikeHtml('<ul><li>x</li></ul>')).toBe(true);
    expect(looksLikeHtml('<h2>x</h2>')).toBe(true);
  });

  it('does not flip to HTML for inline emphasis inside markdown', () => {
    // A stray <em> in otherwise-markdown prose must stay on the markdown path,
    // or the surrounding headings and lists render as literal text.
    expect(looksLikeHtml('## Heading\n\nSome <em>inline</em> emphasis.')).toBe(false);
    expect(looksLikeHtml('Plain prose with `code`.')).toBe(false);
    expect(looksLikeHtml('')).toBe(false);
  });
});
