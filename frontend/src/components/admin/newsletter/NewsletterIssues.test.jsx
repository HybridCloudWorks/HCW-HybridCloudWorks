/**
 * The review and Drafts panels. What must hold: the email preview cannot run
 * anything, each tab shows only its own issues, a card's red X deletes at once,
 * keeping moves an issue to Drafts, approval lives only on Drafts, and it says
 * what a send will need before offering one.
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
const SAVED = '2026-09-14T15:00:00.000Z';

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
    etag: 'e1',
    ...issueOver,
  },
  preview: { subject: 'Landing zones', html: '<p>email body</p>', text: 'email body' },
  readyToSend: true,
  sendingEnabled: true,
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

/**
 * One issue whose stored state tests can move. `rows` lists extra issues. The
 * list and the detail both read `state`, so a change shows on the next load.
 */
function withIssue({ row = {}, rows = [], ...detailOver } = {}) {
  const state = { status: 'draft', savedAt: undefined, etag: 'e1', ...row };
  getJSON.mockImplementation(async (route) =>
    route === 'cms/newsletters'
      ? {
          ok: true,
          issues: [
            ...(state.status === 'deleted'
              ? []
              : [{ id: ID, status: state.status, savedAt: state.savedAt, etag: state.etag }]),
            ...rows,
          ],
        }
      : detail({
          ...detailOver,
          issue: {
            status: state.status,
            savedAt: state.savedAt,
            etag: state.etag,
            ...detailOver.issue,
          },
        })
  );
  return state;
}

const kept = (over = {}) => withIssue({ ...over, row: { savedAt: SAVED, ...over.row } });

describe('which issues each tab shows', () => {
  const rows = [
    { id: 'issue-2026-09-01', status: 'rejected', etag: 'r' },
    { id: 'issue-2026-09-02', status: 'draft', savedAt: SAVED, etag: 's' },
    { id: 'issue-2026-09-03', status: 'sending', savedAt: SAVED, etag: 'x' },
    { id: 'issue-2026-09-04', status: 'scheduled', etag: 'y' },
    { id: 'issue-2026-09-05', status: 'sent', etag: 'z' },
  ];

  it('Newsletter shows unkept drafts and rejected issues', async () => {
    withIssue({ rows });
    render(<NewsletterIssues view="review" />);
    const list = await screen.findByRole('list', { name: 'Issues' });
    await waitFor(() => expect(list.querySelectorAll('li')).toHaveLength(2));
    expect(screen.getByRole('button', { name: '2026-09-14 Draft' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2026-09-01 Rejected' })).toBeInTheDocument();
  });

  it('Drafts shows kept drafts and stuck sends, never scheduled or sent', async () => {
    withIssue({ rows });
    render(<NewsletterIssues view="drafts" />);
    expect(await screen.findByRole('button', { name: '2026-09-02 Draft' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2026-09-03 Sending' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /2026-09-1[4]/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Scheduled|Sent/ })).not.toBeInTheDocument();
  });
});

describe('the Newsletter (review) tab', () => {
  it('renders the email preview in an iframe with an empty sandbox', async () => {
    withIssue();
    render(<NewsletterIssues view="review" />);
    const frame = await screen.findByTitle('Email preview');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toBe('<p>email body</p>');
  });

  it('offers no approval here, only Keep in Drafts', async () => {
    withIssue();
    render(<NewsletterIssues view="review" />);
    expect(await screen.findByRole('button', { name: /keep in drafts/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });

  it('keeps an issue with its etag, and it leaves this tab', async () => {
    const state = withIssue();
    postJSON.mockImplementation(async () => {
      state.savedAt = SAVED;
      return detail({ issue: { savedAt: SAVED } });
    });
    render(<NewsletterIssues view="review" />);

    fireEvent.click(await screen.findByRole('button', { name: /keep in drafts/i }));

    await waitFor(() =>
      expect(postJSON).toHaveBeenCalledWith(`cms/newsletters/${ID}/save`, { etag: 'e1' })
    );
    expect(await screen.findByText('Kept — it is on the Drafts tab.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTitle('Email preview')).not.toBeInTheDocument());
  });

  it('will not keep unsaved edits', async () => {
    withIssue();
    render(<NewsletterIssues view="review" />);
    fireEvent.change(await screen.findByLabelText('Subject'), { target: { value: 'Changed' } });
    expect(screen.getByRole('button', { name: /keep in drafts/i })).toBeDisabled();
  });

  it("deletes an issue from its card's red X at once, with the row's etag", async () => {
    const state = withIssue();
    sendJSON.mockImplementation(async () => {
      state.status = 'deleted';
      return { ok: true, id: ID };
    });
    render(<NewsletterIssues view="review" />);
    await screen.findByTitle('Email preview');

    fireEvent.click(screen.getByRole('button', { name: 'Delete 2026-09-14' }));

    await waitFor(() =>
      expect(sendJSON).toHaveBeenCalledWith(`cms/newsletters/${ID}`, 'DELETE', { etag: 'e1' })
    );
    expect(await screen.findByText('Deleted 2026-09-14.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTitle('Email preview')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /2026-09-14/ })).not.toBeInTheDocument();
  });

  it('saves the subject and note to the draft', async () => {
    withIssue();
    sendJSON.mockResolvedValue(detail({ issue: { subject: 'New subject', customNote: 'Hello' } }));
    render(<NewsletterIssues view="review" />);
    fireEvent.change(await screen.findByLabelText('Subject'), { target: { value: 'New subject' } });
    fireEvent.change(screen.getByLabelText(/Your note/), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() =>
      expect(sendJSON).toHaveBeenCalledWith(`cms/newsletters/${ID}`, 'PATCH', {
        subject: 'New subject',
        customNote: 'Hello',
        etag: 'e1',
      })
    );
  });

  it('reloads the issue when a save is refused because it changed elsewhere', async () => {
    withIssue();
    sendJSON.mockRejectedValue(
      Object.assign(new Error('This issue changed since you opened it. Reload it and try again.'), {
        status: 409,
      })
    );
    render(<NewsletterIssues view="review" />);
    fireEvent.change(await screen.findByLabelText('Subject'), { target: { value: 'Mine' } });
    const before = getJSON.mock.calls.filter(([route]) => route === `cms/newsletters/${ID}`).length;

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText(/changed since you opened it/)).toBeInTheDocument();
    await waitFor(() =>
      expect(
        getJSON.mock.calls.filter(([route]) => route === `cms/newsletters/${ID}`).length
      ).toBeGreaterThan(before)
    );
  });

  it('loads a freshly built issue once, not twice', async () => {
    const NEW = 'issue-2026-09-21';
    let built = false;
    getJSON.mockImplementation(async (route) =>
      route === 'cms/newsletters'
        ? {
            ok: true,
            issues: [
              { id: ID, status: 'draft', etag: 'e1' },
              ...(built ? [{ id: NEW, status: 'draft', etag: 'n1' }] : []),
            ],
          }
        : detail({ issue: { id: route.endsWith(NEW) ? NEW : ID } })
    );
    runJob.mockImplementation(async () => {
      built = true;
      return { status: 'succeeded', result: { success: true, issueId: NEW, message: 'Drafted.' } };
    });
    render(<NewsletterIssues view="review" />);
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
    render(<NewsletterIssues view="review" />);
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

  it('locks issue selection and deletion while an action is running', async () => {
    withIssue();
    let finish;
    postJSON.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(detail());
        })
    );
    render(<NewsletterIssues view="review" />);

    fireEvent.click(await screen.findByRole('button', { name: /keep in drafts/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '2026-09-14 Draft' })).toBeDisabled()
    );
    expect(screen.getByRole('button', { name: 'Delete 2026-09-14' })).toBeDisabled();
    finish();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '2026-09-14 Draft' })).not.toBeDisabled()
    );
  });
});

describe('the Drafts tab', () => {
  it('offers no approval while sending is switched off in Terraform', async () => {
    kept({ sendingEnabled: false });
    render(<NewsletterIssues view="drafts" />);
    expect(await screen.findByText(/Sending is switched off/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve and schedule/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete 2026-09-14' })).toBeInTheDocument();
  });

  it('offers no approval when no send time can be worked out', async () => {
    kept({ sendPlan: null });
    render(<NewsletterIssues view="drafts" />);
    expect(
      await screen.findByText(/send day, time or time zone in Newsletter settings is not valid/)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve and schedule/i })).not.toBeInTheDocument();
  });

  it('offers no approval until the postal address and reply-to exist', async () => {
    kept({ readyToSend: false, missingSettings: ['postal address', 'reply-to address'] });
    render(<NewsletterIssues view="drafts" />);
    expect(
      await screen.findByText(
        'Add the postal address and reply-to address in Newsletter settings before approving.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve and schedule/i })).not.toBeInTheDocument();
  });

  it('asks for confirmation, then approves the version on screen', async () => {
    const state = kept();
    postJSON.mockImplementation(async () => {
      state.status = 'scheduled';
      return detail({ issue: { status: 'scheduled', scheduledAt: '2026-09-15T14:00:00.000Z' } });
    });
    render(<NewsletterIssues view="drafts" />);

    fireEvent.click(await screen.findByRole('button', { name: /approve and schedule/i }));
    expect(postJSON).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /yes, send it/i }));
    await waitFor(() =>
      expect(postJSON).toHaveBeenCalledWith(`cms/newsletters/${ID}/approve`, { etag: 'e1' })
    );
    expect(
      await screen.findByText(
        /Approved — the newsletter is scheduled for .* It is on the Published tab/
      )
    ).toBeInTheDocument();
  });

  it('will not approve unsaved edits', async () => {
    kept();
    render(<NewsletterIssues view="drafts" />);
    fireEvent.change(await screen.findByLabelText('Subject'), {
      target: { value: 'Changed subject' },
    });
    expect(screen.getByRole('button', { name: /approve and schedule/i })).toBeDisabled();
    expect(screen.getByText('Save your changes before approving.')).toBeInTheDocument();
  });

  it('re-reads the issue after an unrecorded send, so Approve is not offered again', async () => {
    const state = kept();
    postJSON.mockImplementation(async () => {
      state.status = 'sending';
      return {
        ok: true,
        warning:
          'Resend accepted broadcast bc-1, but the site could not record it. Do not approve again.',
      };
    });
    render(<NewsletterIssues view="drafts" />);

    fireEvent.click(await screen.findByRole('button', { name: /approve and schedule/i }));
    fireEvent.click(screen.getByRole('button', { name: /yes, send it/i }));

    expect(await screen.findByText(/Do not approve again/)).toBeInTheDocument();
    expect(await screen.findByText(/Check Resend's Broadcasts list/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve and schedule/i })).not.toBeInTheDocument();
  });

  it("shows the server's reason when approval is refused, and re-reads the issue", async () => {
    const state = kept();
    postJSON.mockImplementation(async () => {
      state.status = 'rejected';
      throw Object.assign(
        new Error(
          'Resend accepted broadcast bc-1, but this issue was changed while it was being sent.'
        ),
        { status: 409 }
      );
    });
    render(<NewsletterIssues view="drafts" />);

    fireEvent.click(await screen.findByRole('button', { name: /approve and schedule/i }));
    fireEvent.click(screen.getByRole('button', { name: /yes, send it/i }));

    expect(await screen.findByText(/changed while it was being sent/)).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /approve and schedule/i })
      ).not.toBeInTheDocument()
    );
  });

  it('offers only clearing for an issue stuck mid-send, and no delete', async () => {
    kept({ row: { status: 'sending' } });
    postJSON.mockResolvedValue(detail({ issue: { status: 'rejected' } }));
    render(<NewsletterIssues view="drafts" />);
    expect(await screen.findByText(/Check Resend's Broadcasts list/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /clear stuck send/i }));
    await waitFor(() =>
      expect(postJSON).toHaveBeenCalledWith(`cms/newsletters/${ID}/reject`, { etag: 'e1' })
    );
  });

  it('has no build button', async () => {
    kept();
    render(<NewsletterIssues view="drafts" />);
    await screen.findByTitle('Email preview');
    expect(
      screen.queryByRole('button', { name: /build this week's issue/i })
    ).not.toBeInTheDocument();
  });
});
