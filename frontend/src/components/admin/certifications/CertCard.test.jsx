/**
 * The card's outbound links. What must hold: a Verify or Learn URL stored in
 * the CMS is opened only when it is http(s) (or relative); a `javascript:` or
 * `data:` value is treated as no link at all rather than handed to window.open.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { CertActionButtons } from './CertCard';

const actions = {
  onEdit: vi.fn(),
  onToggleDisplay: vi.fn(),
  onToggleFeatured: vi.fn(),
  onDelete: vi.fn(),
};

const renderButtons = (cert) =>
  render(<CertActionButtons cert={cert} issuer="other" busy={false} actions={actions} />);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CertActionButtons links', () => {
  it('opens a safe verify URL in a new tab', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderButtons({ id: 'c1', verifyUrl: 'https://www.credly.com/badges/abc' });
    fireEvent.click(screen.getByTitle('Verify'));
    expect(open).toHaveBeenCalledWith('https://www.credly.com/badges/abc', '_blank', 'noopener');
  });

  it('refuses a javascript: verify URL and shows verification as unavailable', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderButtons({ id: 'c2', verifyUrl: 'javascript:alert(1)' });
    expect(screen.queryByTitle('Verify')).toBeNull();
    expect(screen.getByLabelText('Verification unavailable')).toBeTruthy();
    expect(open).not.toHaveBeenCalled();
  });

  it('renders no Learn button for a data: learn URL', () => {
    renderButtons({ id: 'c3', learnUrl: 'data:text/html,<script>alert(1)</script>' });
    expect(screen.queryByTitle('Open provider Learn page')).toBeNull();
  });
});
