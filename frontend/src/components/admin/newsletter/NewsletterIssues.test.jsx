/**
 * The review panel. What must hold: the email preview cannot run anything, a
 * draft's edits save, nothing on the panel sends, and it says what a send will
 * need before approval exists.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import NewsletterIssues from './NewsletterIssues';

const getJSON = vi.fn();
const postJSON = vi.fn();
const sendJSON = vi.fn();

vi.mock('@/lib/api', () => ({
  getJSON: (...args) => getJSON(...args),
  postJSON: (...args) => postJSON(...args),
  sendJSON: (...args) => sendJSON(...args),
}));
const runJob = vi.fn();
vi.mock('@/lib/jobs', () => ({ runJob: (...args) => runJob(...args) }));

const ID = 'issue-2026-09-14';

const detail = ({ issue: issueOver = {}, ...over } = {}) => ({
  ok: true,
  // The issue override MERGES. Spreading `over` whole after this used to
  // replace the issue with just the overridden fields, leaving no subject.
  issue: {
    id: ID,
    status: 'draft',
    subject: 'Landing zones',
    customNote: '',
    itemCount: 3,
    intro: 'We covered a lot.',
    introError: null,
    sections: [],
    ...issueOver,
  },
  preview: { subject: 'Landing zones', html: '<p>email body</p>', text: 'email body' },
  readyToSend: true,
  missingSettings: [],
  sendPlan: { sendNow: false, scheduledAt: '2026-09-15T14:00:00.000Z' },
  ...over,
});

beforeEach(() => {
  runJob.mockReset();
  getJSON.mockReset();
  postJSON.mockReset();
  sendJSON.mockReset();
});

function withIssue(over) {
  getJSON.mockImplementation(async (route) =>
    route === 'cms/newsletters'
      ? { ok: true, issues: [{ id: ID, status: over?.issue?.status ?? 'draft' }] }
      : detail(over)
  );
}

describe('NewsletterIssues', () => {
  it('renders the email preview in an iframe with an empty sandbox', async () => {
    withIssue();
    render(<NewsletterIssues />);
    const frame = await screen.findByTitle('Email preview');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toBe('<p>email body</p>');
  });

  it('says what a send will need, and offers no send of any kind', async () => {
    withIssue({ readyToSend: false, missingSettings: ['postal address', 'reply-to address'] });
    render(<NewsletterIssues />);
    expect(
      await screen.findByText(/add the postal address and reply-to address in Newsletter settings/)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve|send/i })).not.toBeInTheDocument();
  });

  it('saves the subject and note to the draft', async () => {
    withIssue();
    sendJSON.mockResolvedValue(detail({ issue: { subject: 'New subject', customNote: 'Hello' } }));
    render(<NewsletterIssues />);
    fireEvent.change(await screen.findByLabelText('Subject'), { target: { value: 'New subject' } });
    fireEvent.change(screen.getByLabelText(/Your note/), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: /save draft/i }));
    await waitFor(() =>
      expect(sendJSON).toHaveBeenCalledWith(`cms/newsletters/${ID}`, 'PATCH', {
        subject: 'New subject',
        customNote: 'Hello',
      })
    );
  });

  it('rejects a draft', async () => {
    withIssue();
    postJSON.mockResolvedValue(detail({ issue: { status: 'rejected' } }));
    render(<NewsletterIssues />);
    fireEvent.click(await screen.findByRole('button', { name: /reject/i }));
    await waitFor(() => expect(postJSON).toHaveBeenCalledWith(`cms/newsletters/${ID}/reject`, {}));
    expect(await screen.findByText('Issue rejected.')).toBeInTheDocument();
  });

  it('loads a freshly built issue once, not twice', async () => {
    const NEW = 'issue-2026-09-21';
    getJSON.mockImplementation(async (route) =>
      route === 'cms/newsletters'
        ? { ok: true, issues: [{ id: ID, status: 'sent' }] }
        : detail({ issue: { id: route.endsWith(NEW) ? NEW : ID } })
    );
    runJob.mockResolvedValue({
      status: 'succeeded',
      result: { success: true, issueId: NEW, message: 'Drafted.' },
    });
    render(<NewsletterIssues />);
    await screen.findByTitle('Email preview');

    fireEvent.click(screen.getByRole('button', { name: /build this week's issue/i }));
    await screen.findByText('Drafted.');
    await waitFor(() =>
      expect(
        getJSON.mock.calls.filter(([route]) => route === `cms/newsletters/${NEW}`)
      ).toHaveLength(1)
    );
  });

  it('reloads the open issue after a same-day rebuild', async () => {
    withIssue();
    runJob.mockResolvedValue({
      status: 'succeeded',
      result: { success: true, issueId: ID, message: 'Drafted.' },
    });
    render(<NewsletterIssues />);
    await screen.findByTitle('Email preview');
    const before = getJSON.mock.calls.filter(([route]) => route === `cms/newsletters/${ID}`).length;

    fireEvent.click(screen.getByRole('button', { name: /build this week's issue/i }));
    await screen.findByText('Drafted.');
    await waitFor(() =>
      expect(
        getJSON.mock.calls.filter(([route]) => route === `cms/newsletters/${ID}`)
      ).toHaveLength(before + 1)
    );
  });

  it('locks issue selection while an action is running', async () => {
    withIssue();
    let finish;
    postJSON.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(detail({ issue: { status: 'rejected' } }));
        })
    );
    render(<NewsletterIssues />);

    fireEvent.click(await screen.findByRole('button', { name: /reject/i }));

    const issueButton = screen.getByRole('button', { name: /2026-09-14/ });
    await waitFor(() => expect(issueButton).toBeDisabled());
    finish();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /2026-09-14/ })).not.toBeDisabled()
    );
  });
});
