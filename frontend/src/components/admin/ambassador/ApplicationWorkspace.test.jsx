/**
 * The application packet (ADR 0033 §4). What must hold: for a program with
 * official questions the packet prints every section and question, answered
 * or not, and keeps the answers written before the program had its question
 * list under "Other responses" rather than dropping them; a program without
 * questions prints the free list as it is.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { PacketResponses } from './ApplicationWorkspace';

const program = {
  id: 'p1',
  applicationQuestions: [
    { id: 'why', section: 'Questions', prompt: 'Why?', kind: 'text' },
    { id: 'acts', section: 'Expertise', prompt: 'Activities', kind: 'activities' },
  ],
};

const application = {
  id: 'a1',
  responses: [
    { questionId: 'why', text: 'Because' },
    { questionId: 'Essay from 2025', text: 'What I wrote before the form had a question list.' },
    { questionId: 'acts', text: '["e1"]' },
  ],
};

describe('PacketResponses', () => {
  it('prints the sections and keeps the legacy answers after them', () => {
    render(
      <PacketResponses
        application={application}
        program={program}
        attached={[{ id: 'e1', title: 'KCDC talk', date: '2026-08-14' }]}
      />
    );
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Questions', 'Expertise', 'Other responses']);
    expect(screen.getByText('Because')).toBeInTheDocument();
    expect(screen.getByText('KCDC talk — 2026-08-14')).toBeInTheDocument();
    const other = screen.getByRole('heading', { name: 'Other responses' }).closest('section');
    expect(within(other).getByText('Essay from 2025')).toBeInTheDocument();
    expect(
      within(other).getByText('What I wrote before the form had a question list.')
    ).toBeInTheDocument();
  });

  it('omits "Other responses" when every answer belongs to a question, and prints the free list without a program', () => {
    render(
      <PacketResponses
        application={{ id: 'a2', responses: [{ questionId: 'why', text: 'Because' }] }}
        program={program}
        attached={[]}
      />
    );
    expect(screen.queryByRole('heading', { name: 'Other responses' })).toBeNull();
    expect(screen.getByText('(not answered)')).toBeInTheDocument();
  });

  it('prints the free list as it is for a program without questions', () => {
    render(
      <PacketResponses
        application={{ id: 'a3', responses: [{ questionId: 'Essay', text: 'Words' }] }}
        program={{ id: 'p2' }}
        attached={[]}
      />
    );
    expect(screen.getByRole('heading', { name: 'Responses' })).toBeInTheDocument();
    expect(screen.getByText('Essay')).toBeInTheDocument();
    expect(screen.getByText('Words')).toBeInTheDocument();
  });
});
