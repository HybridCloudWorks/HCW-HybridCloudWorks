/**
 * The review and Drafts panels. What must hold: the email preview cannot run
 * anything, each tab shows only its own issues, a card's red X deletes at once,
 * keeping moves an issue to Drafts, approval lives only on Drafts, and it says
 * what a send will need before offering one. Editing a draft stays local until
 * Save changes, sends sections as the stored items in their new order, never
 * removes the last item, and a test send hands back the etag the next save uses.
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

  it('warns above the preview when the chosen template is not used', async () => {
    withIssue({
      templateProblem: {
        code: 'TEMPLATE_NOT_PUBLISHED',
        message: 'The chosen template is not published in Resend.',
      },
    });
    render(<NewsletterIssues view="review" />);
    expect(
      await screen.findByText(/shows the built-in design: The chosen template is not published/)
    ).toBeInTheDocument();
  });

  it('shows no template warning when the preview is the chosen design', async () => {
    withIssue({ templateProblem: null });
    render(<NewsletterIssues view="review" />);
    await screen.findByTitle('Email preview');
    expect(screen.queryByText(/shows the built-in design/)).not.toBeInTheDocument();
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

  it('offers no approval when the chosen template cannot be used', async () => {
    kept({
      readyToSend: false,
      missingSettings: [],
      templateProblem: {
        code: 'TEMPLATE_MARKER_MISSING',
        message: 'The template does not contain the marker.',
      },
    });
    render(<NewsletterIssues view="drafts" />);
    expect(await screen.findByText(/The chosen template cannot be used yet/)).toBeInTheDocument();
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

describe('editing a draft', () => {
  const A = { title: 'Item A', url: 'https://example.com/a', summary: 'About A', label: 'Blog' };
  const B = { title: 'Item B', url: 'https://example.com/b', summary: 'About B', label: 'Blog' };
  const C = { title: 'Item C', url: 'https://example.com/c', summary: 'About C', label: 'Video' };
  const SECTIONS = [
    { id: 'blog', title: 'Blog', items: [A, B] },
    { id: 'video', title: 'Videos', items: [C] },
  ];
  const withSections = (over = {}) =>
    withIssue({ ...over, issue: { sections: SECTIONS, preheader: '', ...over.issue } });
  const button = (name) => screen.getByRole('button', { name });
  const patchBody = () => sendJSON.mock.calls.find(([, method]) => method === 'PATCH')?.[2];

  it('saves the preview text in the PATCH, with a character counter', async () => {
    withSections();
    sendJSON.mockResolvedValue(detail({ issue: { preheader: 'Read this first' } }));
    render(<NewsletterIssues view="review" />);

    fireEvent.change(await screen.findByLabelText(/Preview text/), {
      target: { value: 'Read this first' },
    });
    expect(screen.getByText('15/150')).toBeInTheDocument();
    expect(screen.getByLabelText(/Preview text/)).toHaveAttribute('maxlength', '150');
    fireEvent.click(button(/save changes/i));

    await waitFor(() =>
      expect(sendJSON).toHaveBeenCalledWith(`cms/newsletters/${ID}`, 'PATCH', {
        preheader: 'Read this first',
        etag: 'e1',
      })
    );
  });

  it('links each item to its page in a new tab', async () => {
    withSections();
    render(<NewsletterIssues view="review" />);
    const link = await screen.findByRole('link', { name: 'Item A' });
    expect(link).toHaveAttribute('href', A.url);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toMatch(/noopener/);
  });

  it('sends the sections in their new order with only the remaining stored items', async () => {
    withSections();
    sendJSON.mockResolvedValue(detail());
    render(<NewsletterIssues view="review" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Move section Videos up' }));
    fireEvent.click(button('Move item Item B up'));
    fireEvent.click(button('Remove item Item A'));
    fireEvent.click(button(/save changes/i));

    await waitFor(() => expect(patchBody()).toBeDefined());
    expect(patchBody()).toEqual({
      sections: [
        { id: 'video', items: [C] },
        { id: 'blog', items: [B] },
      ],
      etag: 'e1',
    });
  });

  it('sends a removed section as absent', async () => {
    withSections();
    sendJSON.mockResolvedValue(detail());
    render(<NewsletterIssues view="review" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove section Blog' }));
    fireEvent.click(button(/save changes/i));

    await waitFor(() => expect(patchBody()).toBeDefined());
    expect(patchBody().sections).toEqual([{ id: 'video', items: [C] }]);
  });

  it('Reset discards local edits', async () => {
    withSections();
    render(<NewsletterIssues view="review" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove item Item A' }));
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Changed' } });
    fireEvent.change(screen.getByLabelText(/Preview text/), { target: { value: 'Changed' } });
    expect(screen.queryByRole('link', { name: 'Item A' })).not.toBeInTheDocument();

    fireEvent.click(button(/reset/i));

    expect(screen.getByRole('link', { name: 'Item A' })).toBeInTheDocument();
    expect(screen.getByLabelText('Subject')).toHaveValue('Landing zones');
    expect(screen.getByLabelText(/Preview text/)).toHaveValue('');
    expect(button(/save changes/i)).toBeDisabled();
    expect(button(/keep in drafts/i)).not.toBeDisabled();
  });

  it('will not remove the last remaining item', async () => {
    withSections();
    render(<NewsletterIssues view="review" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove section Videos' }));
    fireEvent.click(button('Remove item Item A'));

    const last = button('Remove item Item B');
    expect(last).toBeDisabled();
    expect(last.getAttribute('title')).toMatch(/at least one item/);
    expect(button('Remove section Blog')).toBeDisabled();
  });

  it('counts section edits as unsaved, so Keep is disabled', async () => {
    withSections();
    render(<NewsletterIssues view="review" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Move item Item B up' }));
    expect(button(/keep in drafts/i)).toBeDisabled();
    expect(button(/save changes/i)).not.toBeDisabled();
  });

  it('counts section edits as unsaved, so Approve is disabled', async () => {
    kept({ issue: { sections: SECTIONS } });
    render(<NewsletterIssues view="drafts" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove item Item C' }));
    expect(button(/approve and schedule/i)).toBeDisabled();
    expect(screen.getByText('Save your changes before approving.')).toBeInTheDocument();
  });

  it('regenerates the intro with the etag and shows the new issue', async () => {
    withSections();
    postJSON.mockResolvedValue(
      detail({
        issue: { intro: 'A fresh intro.', updatedAt: 'later', etag: 'e2' },
        preview: { html: '<p>A fresh intro.</p>' },
      })
    );
    render(<NewsletterIssues view="review" />);

    fireEvent.click(await screen.findByRole('button', { name: /regenerate intro/i }));

    await waitFor(() =>
      expect(postJSON).toHaveBeenCalledWith(`cms/newsletters/${ID}/intro`, { etag: 'e1' })
    );
    expect(await screen.findByText('Intro regenerated.')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTitle('Email preview').getAttribute('srcdoc')).toBe(
        '<p>A fresh intro.</p>'
      )
    );
  });

  it("shows the server's reason when the intro cannot be regenerated", async () => {
    withSections();
    postJSON.mockRejectedValue(
      Object.assign(new Error('The AI could not write an intro. Try again.'), { status: 502 })
    );
    render(<NewsletterIssues view="review" />);

    fireEvent.click(await screen.findByRole('button', { name: /regenerate intro/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The AI could not write an intro');
    expect(button(/regenerate intro/i)).not.toBeDisabled();
  });

  it('will not regenerate the intro over unsaved edits', async () => {
    withSections();
    render(<NewsletterIssues view="review" />);
    fireEvent.change(await screen.findByLabelText('Subject'), { target: { value: 'Mine' } });
    expect(button(/regenerate intro/i)).toBeDisabled();
    expect(button(/send test to me/i)).toBeDisabled();
  });

  it('fills the subject from a suggestion, saved with Save changes', async () => {
    withSections();
    postJSON.mockResolvedValue({ ok: true, subjects: ['Zones', 'Landing well', 'Hub and spoke'] });
    sendJSON.mockResolvedValue(detail());
    render(<NewsletterIssues view="review" />);

    fireEvent.click(await screen.findByRole('button', { name: /suggest subjects/i }));
    await waitFor(() =>
      expect(postJSON).toHaveBeenCalledWith(`cms/newsletters/${ID}/subjects`, {})
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Landing well' }));

    expect(screen.getByLabelText('Subject')).toHaveValue('Landing well');
    expect(sendJSON).not.toHaveBeenCalled();
    fireEvent.click(button(/save changes/i));
    await waitFor(() =>
      expect(sendJSON).toHaveBeenCalledWith(`cms/newsletters/${ID}`, 'PATCH', {
        subject: 'Landing well',
        etag: 'e1',
      })
    );
  });

  it('sends a test, says where it went, counts down, and saves with the new etag', async () => {
    kept({ issue: { sections: SECTIONS } });
    postJSON.mockResolvedValue({ ok: true, sentTo: 'owner@example.com', etag: 'e2' });
    sendJSON.mockResolvedValue(detail());
    render(<NewsletterIssues view="drafts" />);

    fireEvent.click(await screen.findByRole('button', { name: /send test to me/i }));

    await waitFor(() =>
      expect(postJSON).toHaveBeenCalledWith(`cms/newsletters/${ID}/test`, { etag: 'e1' })
    );
    expect(await screen.findByText('Test sent to owner@example.com.')).toBeInTheDocument();
    const again = await screen.findByRole('button', { name: /send test again in \d+s/i });
    expect(again).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'After the test' } });
    fireEvent.click(button(/save changes/i));
    await waitFor(() =>
      expect(sendJSON).toHaveBeenCalledWith(`cms/newsletters/${ID}`, 'PATCH', {
        subject: 'After the test',
        etag: 'e2',
      })
    );
  });

  it('says when a test went out in the built-in design because the template could not be used', async () => {
    kept({ issue: { sections: SECTIONS } });
    postJSON.mockResolvedValue({
      ok: true,
      sentTo: 'owner@example.com',
      etag: 'e2',
      templateProblem: {
        code: 'TEMPLATE_MARKER_MISSING',
        message: 'The template does not contain the marker.',
      },
    });
    render(<NewsletterIssues view="drafts" />);
    fireEvent.click(await screen.findByRole('button', { name: /send test to me/i }));
    expect(
      await screen.findByText(/Test sent to owner@example.com. It used the built-in design/)
    ).toBeInTheDocument();
  });

  it("shows the server's message when a test is refused as too soon", async () => {
    withSections();
    postJSON.mockRejectedValue(
      Object.assign(new Error('A test was sent less than a minute ago. Try again shortly.'), {
        status: 429,
      })
    );
    render(<NewsletterIssues view="review" />);

    fireEvent.click(await screen.findByRole('button', { name: /send test to me/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('less than a minute ago');
    expect(button(/send test to me/i)).not.toBeDisabled();
  });

  it('shows the refusal when the signed-in user is not a publisher', async () => {
    withSections();
    postJSON.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
    render(<NewsletterIssues view="review" />);

    fireEvent.click(await screen.findByRole('button', { name: /send test to me/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden');
  });
});
