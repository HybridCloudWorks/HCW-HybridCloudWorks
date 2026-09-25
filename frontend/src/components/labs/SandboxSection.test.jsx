/**
 * "Run an agent against your landing zone" (#676): three numbered steps, the
 * create command under PowerShell then bash, the first prompt as one quoted
 * sentence, the cost sentence, and the link to the recipe directory. The
 * command text is pinned because it is what a learner pastes, and the `sbx`
 * surface is a live-check item: a change here must come with a re-read of
 * the docs the component's header cites.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import SandboxSection, {
  COST_SENTENCE,
  FIRST_PROMPT,
  RECIPE_URL,
  SANDBOX_COMMANDS,
} from './SandboxSection';

function renderSection() {
  return render(
    <MemoryRouter initialEntries={['/education/labs']}>
      <SandboxSection />
    </MemoryRouter>
  );
}

describe('SandboxSection', () => {
  it('prints three numbered steps, the first linking to the Landing Zone Builder', () => {
    renderSection();
    const steps = screen.getAllByTestId('sandbox-step');
    expect(steps).toHaveLength(3);
    expect(steps[0].closest('ol')).not.toBeNull();
    expect(within(steps[0]).getByRole('link', { name: 'Landing Zone Builder' })).toHaveAttribute(
      'href',
      '/tools/landing-zone'
    );
    expect(steps[1]).toHaveTextContent(/unzip/i);
    expect(steps[2]).toHaveTextContent(/create the sandbox/i);
  });

  it('prints the create command under PowerShell then bash, exactly', () => {
    const { container } = renderSection();
    const lines = [...container.querySelectorAll('pre code')];
    expect(lines.map((line) => line.dataset.shell)).toEqual(['PowerShell', 'bash']);
    expect(lines.map((line) => line.textContent)).toEqual(
      SANDBOX_COMMANDS.map((entry) => entry.command)
    );
    for (const line of lines) {
      expect(line.textContent).toBe('sbx run --name hcw-lz --template hcw-lz-sandbox:v1 claude .');
    }
  });

  it('quotes the first prompt as one sentence', () => {
    renderSection();
    const prompt = screen.getByTestId('sandbox-first-prompt');
    expect(prompt.tagName).toBe('Q');
    expect(prompt).toHaveTextContent(FIRST_PROMPT);
    expect(FIRST_PROMPT).toMatch(/terraform init -backend=false/);
    expect(FIRST_PROMPT).toMatch(/terraform validate/);
    expect(FIRST_PROMPT).not.toMatch(/apply|plan/);
  });

  it('says local is free and cloud is the learner’s own subscription for an hour', () => {
    renderSection();
    const cost = screen.getByTestId('sandbox-cost');
    expect(cost).toHaveTextContent(COST_SENTENCE);
    expect(cost).toHaveTextContent(/local sandboxes are free/i);
    expect(cost).toHaveTextContent(/one hour/i);
    expect(cost).toHaveTextContent(/your own docker subscription/i);
  });

  it('links to the recipe directory on GitHub in a new tab', () => {
    renderSection();
    const link = screen.getByTestId('sandbox-recipe-link');
    expect(link).toHaveAttribute('href', RECIPE_URL);
    expect(RECIPE_URL).toBe(
      'https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/tree/main/lab-image/sandbox-template'
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toMatch(/noopener/);
  });
});
