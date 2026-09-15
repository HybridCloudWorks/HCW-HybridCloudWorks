/**
 * The certification editor: name is required, a new cert POSTs and an
 * existing one PATCHes the payload the old page sent, a double click saves
 * once, the image upload keeps its type and size rules, and the order helper
 * suggests the first free slot within the issuer.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import CertEditor, { buildPayload, initialForm } from './CertEditor';
import { nextFreeOrder, siblingsOf, issuerOptionsFrom } from './editorFields';

const postJSON = vi.fn();
const sendJSON = vi.fn();
const toast = vi.fn();
vi.mock('@/lib/api', () => ({
  postJSON: (...args) => postJSON(...args),
  sendJSON: (...args) => sendJSON(...args),
}));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast }) }));

beforeEach(() => {
  postJSON.mockReset();
  sendJSON.mockReset();
  toast.mockReset();
});

const EXISTING = {
  _docId: 'c1',
  name: 'Azure Administrator',
  code: 'AZ-104',
  issuer: 'Microsoft',
  expDate: '2027-03-01T00:00:00.000Z',
  display: true,
  certState: true,
  featured: false,
  display_order: 2,
};

describe('payload', () => {
  it('trims, nulls empties, canonicalises dates and defaults the order', () => {
    const payload = buildPayload({
      ...initialForm({}),
      name: '  Cloud Architect ',
      issuer: 'Custom Issuer',
      issueDate: '2026-01-02',
      display_order: '',
    });
    expect(payload).toMatchObject({
      name: 'Cloud Architect',
      code: null,
      issuer: 'Custom Issuer',
      issueDate: '2026-01-02T00:00:00.000Z',
      expDate: null,
      verifyUrl: null,
      display: true,
      certState: true,
      featured: false,
      display_order: 999,
    });
  });

  it('opens an existing cert with its dates as yyyy-mm-dd', () => {
    expect(initialForm(EXISTING)).toMatchObject({ expDate: '2027-03-01', issuer: 'Microsoft' });
    expect(initialForm({ issuer: '' }).issuer).toBe('');
  });
});

describe('saving', () => {
  it('refuses a save without a name', async () => {
    render(<CertEditor cert={{}} allCerts={[]} onClose={vi.fn()} onSaved={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    });
    expect(postJSON).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Name is required' }));
  });

  it('creates a new cert once, however many clicks, and hands back the row', async () => {
    let answer;
    postJSON.mockReturnValue(new Promise((res) => (answer = res)));
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<CertEditor cert={{}} allCerts={[]} onClose={onClose} onSaved={onSaved} />);
    fireEvent.change(screen.getByPlaceholderText('Google Cloud Professional Cloud Architect'), {
      target: { value: 'New cert' },
    });
    const add = screen.getByRole('button', { name: 'Add' });
    fireEvent.click(add);
    fireEvent.click(add);
    await act(async () => {
      answer({ id: 'new-id' });
    });
    expect(postJSON).toHaveBeenCalledTimes(1);
    expect(postJSON).toHaveBeenCalledWith(
      'cms/certifications',
      expect.objectContaining({ name: 'New cert' })
    );
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ _docId: 'new-id' }));
    expect(onClose).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({ title: 'Certification added' });
  });

  it('patches an existing cert and keeps the editor open when refused', async () => {
    sendJSON.mockRejectedValueOnce(new Error('403'));
    const onClose = vi.fn();
    render(
      <CertEditor cert={EXISTING} allCerts={[EXISTING]} onClose={onClose} onSaved={vi.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(sendJSON).toHaveBeenCalledWith(
      'cms/certifications/c1',
      'PATCH',
      expect.objectContaining({ name: 'Azure Administrator', code: 'AZ-104' })
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Save failed' }));
  });
});

describe('image upload rules', () => {
  const pick = (file) => {
    const input = document.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [file] } });
  };

  it('rejects a non-image and an image over 5 MB without uploading', () => {
    render(<CertEditor cert={EXISTING} allCerts={[]} onClose={vi.fn()} onSaved={vi.fn()} />);
    pick(new File(['x'], 'a.txt', { type: 'text/plain' }));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Not an image' }));
    const big = new File(['x'], 'a.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
    pick(big);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Image too large' }));
    expect(postJSON).not.toHaveBeenCalled();
  });
});

describe('order and issuer helpers', () => {
  const all = [
    { _docId: 'a', issuer: 'Microsoft', display_order: 1, name: 'A' },
    { _docId: 'b', issuer: 'microsoft', display_order: 2, name: 'B' },
    { _docId: 'c', issuer: 'AWS', display_order: 1, name: 'C' },
    { _docId: 'd', issuer: 'Unknown' },
  ];

  it('suggests the first order no sibling from the same issuer uses', () => {
    const siblings = siblingsOf(all, 'x', 'Microsoft');
    expect(siblings.map((s) => s._docId)).toEqual(['a', 'b']);
    expect(nextFreeOrder(siblings)).toBe(3);
    expect(siblingsOf(all, 'a', 'Microsoft').map((s) => s._docId)).toEqual(['b']);
    expect(siblingsOf(all, 'a', '')).toEqual([]);
  });

  it('builds the issuer list from the collection, deduped case-insensitively', () => {
    expect(issuerOptionsFrom(all)).toEqual(['AWS', 'Microsoft']);
  });
});
