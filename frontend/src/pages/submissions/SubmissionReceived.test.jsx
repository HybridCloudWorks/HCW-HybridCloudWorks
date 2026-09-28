/**
 * The "submitted" card the architecture and framework pages share. What must
 * hold: it says the entry will be reviewed, offers "Submit Another", and
 * links nowhere a visitor cannot go — the "View Queue" link into /admin it
 * used to carry is gone (owner direction 2026-09-28).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import SubmissionReceived from './SubmissionReceived';

describe('SubmissionReceived', () => {
  it('says what happens next, offers another submission, and links nowhere', () => {
    const onAnother = vi.fn();
    const { container } = render(
      <SubmissionReceived
        title="Blueprint Submitted!"
        message="Your architecture blueprint has been submitted for review."
        onAnother={onAnother}
      />
    );
    expect(screen.getByRole('heading', { name: 'Blueprint Submitted!' })).toBeInTheDocument();
    expect(
      screen.getByText('Your architecture blueprint has been submitted for review.')
    ).toBeInTheDocument();
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).not.toMatch(/queue|admin/i);

    fireEvent.click(screen.getByRole('button', { name: 'Submit Another' }));
    expect(onAnother).toHaveBeenCalledTimes(1);
  });
});
