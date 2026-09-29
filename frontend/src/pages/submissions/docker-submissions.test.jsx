/**
 * A Docker article or code pattern can be submitted as Docker (#775). Only
 * the blog and Coder Corner forms offer it: Docker has no architecture or
 * frameworks pages (#778 added no blueprints), so a submission of either type
 * filed under Docker would have nowhere to appear.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-helmet-async', () => ({
  Helmet: ({ children }) => <>{children}</>,
}));

const submitPublicContent = vi.fn();
vi.mock('@/lib/publicApi', () => ({
  submitPublicContent: (...args) => submitPublicContent(...args),
}));

import ArchitectureSubmissionPage from './ArchitectureSubmissionPage';
import BlogSubmissionPage from './BlogSubmissionPage';
import CoderCornerSubmissionPage from './CoderCornerSubmissionPage';
import FrameworkSubmissionPage from './FrameworkSubmissionPage';

beforeEach(() => {
  submitPublicContent.mockReset();
  submitPublicContent.mockResolvedValue({ success: true });
});

describe('submitting as Docker', () => {
  it('offers Docker on the blog form', () => {
    render(<BlogSubmissionPage />);
    expect(screen.getByRole('option', { name: 'Docker' })).toBeInTheDocument();
  });

  it('files a Coder Corner entry under Docker when Docker is chosen', async () => {
    const { container } = render(<CoderCornerSubmissionPage />);
    fireEvent.change(screen.getByPlaceholderText('Terraform module validation pipeline'), {
      target: { value: 'A small stack with Docker Compose' },
    });
    const option = screen.getByRole('option', { name: 'Docker' });
    fireEvent.change(option.closest('select'), { target: { value: 'Docker' } });
    fireEvent.submit(container.querySelector('form'));

    await waitFor(() => expect(submitPublicContent).toHaveBeenCalledTimes(1));
    expect(submitPublicContent.mock.calls[0][0]).toMatchObject({
      type: 'coder_corner',
      title: 'A small stack with Docker Compose',
      cloudProvider: 'Docker',
    });
  });

  it('does not offer Docker for architectures or frameworks, which have no Docker page', () => {
    const { unmount } = render(
      <MemoryRouter>
        <ArchitectureSubmissionPage />
      </MemoryRouter>
    );
    expect(screen.queryByRole('option', { name: 'Docker' })).toBeNull();
    unmount();
    render(
      <MemoryRouter>
        <FrameworkSubmissionPage />
      </MemoryRouter>
    );
    expect(screen.queryByRole('option', { name: 'Docker' })).toBeNull();
  });
});
