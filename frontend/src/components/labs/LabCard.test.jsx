/**
 * A lab card opens its lab's pane on the site (#751), never the workspace
 * host: since #750 a top-level visit there is sent back to /education/labs.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { labs } from '@/data/labs/catalogue';
import LabCard from './LabCard';

function renderCard(lab) {
  return render(
    <MemoryRouter>
      <ul>
        <LabCard lab={lab} />
      </ul>
    </MemoryRouter>
  );
}

describe('LabCard', () => {
  it.each(labs.map((lab) => [lab.id, lab]))('%s links to its own pane page', (id, lab) => {
    const { container } = renderCard(lab);
    const link = screen.getByRole('link', { name: /open lab workspace/i });
    expect(link).toHaveAttribute('href', `/education/labs/${id}`);
    expect(link).toHaveAccessibleName(
      `Open lab workspace for ${lab.title}; GitHub sign-in required`
    );
    expect(link).not.toHaveAttribute('target');
    const external = [...container.querySelectorAll('a[href]')].filter((a) =>
      /^https?:/.test(a.getAttribute('href'))
    );
    expect(external).toEqual([]);
  });

  it('names no tool behind the site on the button', () => {
    renderCard(labs[0]);
    expect(screen.getByTestId('open-lab-workspace').textContent).not.toMatch(/coder/i);
  });
});
