/**
 * A lab card opens its lab's page on the site (#751), under the provider
 * whose list shows it or the lab's home provider (ADR 0033), never the
 * workspace host: since #750 a top-level visit there is sent back to
 * /education/labs.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { DIFFICULTY_LABELS, labById, labs, primaryProvider } from '@/data/labs/catalogue';
import LabCard from './LabCard';

function renderCard(lab, provider) {
  return render(
    <MemoryRouter>
      <ul>
        <LabCard lab={lab} provider={provider} />
      </ul>
    </MemoryRouter>
  );
}

describe('LabCard', () => {
  it.each(labs.map((lab) => [lab.id, lab]))(
    '%s links to its own page under its home provider',
    (id, lab) => {
      const { container } = renderCard(lab);
      const link = screen.getByTestId('open-lab-workspace');
      expect(link).toHaveAttribute('href', `/${primaryProvider(lab)}/education/labs/${id}`);
      expect(link).toHaveAccessibleName(
        `Open lab ${lab.title}: steps, and the workspace; GitHub sign-in required for the workspace`
      );
      expect(link).not.toHaveAttribute('target');
      const external = [...container.querySelectorAll('a[href]')].filter((a) =>
        /^https?:/.test(a.getAttribute('href'))
      );
      expect(external).toEqual([]);
    }
  );

  it('links under the hub whose list shows it, when told one', () => {
    const lab = labById('landing-zone-builder-output');
    renderCard(lab, 'terraform');
    expect(screen.getByTestId('open-lab-workspace')).toHaveAttribute(
      'href',
      '/terraform/education/labs/landing-zone-builder-output'
    );
  });

  it('states difficulty, duration and every hub that lists it', () => {
    const lab = labById('landing-zone-builder-output');
    renderCard(lab);
    expect(screen.getByTestId('lab-difficulty')).toHaveTextContent(
      DIFFICULTY_LABELS[lab.difficulty]
    );
    expect(screen.getByTestId('lab-minutes')).toHaveTextContent('about 25 minutes');
    const hubs = screen.getByRole('list', { name: 'Listed under' });
    expect(within(hubs).getByRole('link', { name: 'Azure labs' })).toHaveAttribute(
      'href',
      '/azure/education/labs'
    );
    expect(within(hubs).getByRole('link', { name: 'Terraform labs' })).toHaveAttribute(
      'href',
      '/terraform/education/labs'
    );
  });

  it('names no tool behind the site on the button', () => {
    renderCard(labs[0]);
    expect(screen.getByTestId('open-lab-workspace').textContent).not.toMatch(/coder/i);
  });
});
