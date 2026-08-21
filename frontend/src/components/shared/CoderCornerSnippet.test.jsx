import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import CoderCornerSnippet, { bodyHasCodeFence } from './CoderCornerSnippet';

/**
 * §2.5. The coder_corner publish contract *requires* `codeSnippet` and
 * `language` before a snippet can be published, and the public detail page
 * rendered neither — so an AI-filled snippet, which writes those fields without
 * fencing the code into the body, went live with its code invisible.
 */
describe('CoderCornerSnippet', () => {
  it('renders the snippet field the publish gate requires', () => {
    render(
      <CoderCornerSnippet
        codeSnippet={'resource "aws_s3_bucket" "b" {}'}
        language="HCL"
        body="Some prose with no fenced block."
      />
    );

    expect(screen.getByText(/aws_s3_bucket/)).toBeInTheDocument();
    expect(screen.getByText('HCL')).toBeInTheDocument();
  });

  it('does not render the field a second time when the body already fences it', () => {
    // The human submission path fences the snippet into the body markdown, so
    // rendering the field as well would show the same code twice.
    render(
      <CoderCornerSnippet
        codeSnippet={'resource "aws_s3_bucket" "b" {}'}
        language="HCL"
        body={'Intro\n\n```hcl\nresource "aws_s3_bucket" "b" {}\n```\n'}
      />
    );

    expect(screen.queryByText(/aws_s3_bucket/)).not.toBeInTheDocument();
  });

  it('renders repoUrl, which was collected and stored but shown nowhere', () => {
    render(<CoderCornerSnippet repoUrl="https://github.com/example/repo" />);

    const link = screen.getByRole('link', { name: /source repository/i });
    expect(link).toHaveAttribute('href', 'https://github.com/example/repo');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('renders nothing when the document carries neither field', () => {
    const { container } = render(<CoderCornerSnippet body="Just prose." />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('bodyHasCodeFence', () => {
  it('detects a fence at the start of a line, including indented ones', () => {
    expect(bodyHasCodeFence('```js\nx\n```')).toBe(true);
    expect(bodyHasCodeFence('Intro\n\n   ```\nx\n```')).toBe(true);
  });

  it('does not mistake inline code or prose backticks for a fence', () => {
    expect(bodyHasCodeFence('Use `npm run build` to check.')).toBe(false);
    expect(bodyHasCodeFence('No code here at all.')).toBe(false);
    expect(bodyHasCodeFence('')).toBe(false);
  });
});
