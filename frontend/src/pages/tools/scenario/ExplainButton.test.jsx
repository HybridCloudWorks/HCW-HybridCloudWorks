/**
 * "Explain this comparison" (#613, Phase 3). What must hold: nothing is
 * requested until the click, the body is the trimmed comparison, a success
 * shows the paragraphs under the AI-generated label and nothing about the
 * model or the time (owner direction 2026-09-28), 429 and 503 read in the
 * page's own words and neither offers a retry, any other failure says
 * something went wrong and does, the button is disabled while a provider is
 * unavailable, and an answer goes away when the numbers it explained change.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ExplainButton, explanationRequest } from './ExplainButton';
import { FAILURE_LINES } from '../explain/ExplainControl';
import { computeScenario } from '@/lib/pricingScenarios';

vi.mock('@/lib/functionsBase', () => ({
  requireFunctionsBase: () => 'https://api.test/api',
}));

const row = (provider, pricePerUnit) => ({ provider, pricePerUnit, source: 'live' });
const PRICING = {
  region: 'us-east-1',
  services: [
    { serviceId: 'compute-vm', rows: [row('aws', 0.2), row('azure', 0.25), row('gcp', 0.15)] },
    { serviceId: 'compute-serverless', rows: [row('aws', 3), row('azure', 3), row('gcp', 2)] },
    { serviceId: 'storage-object', rows: [row('aws', 0.02), row('azure', 0.02), row('gcp', 0.01)] },
    {
      serviceId: 'database-relational',
      rows: [row('aws', 0.5), row('azure', 0.4), row('gcp', 0.6)],
    },
    { serviceId: 'database-nosql', rows: [row('aws', 1), row('azure', 1)] },
    { serviceId: 'edge-cdn', rows: [row('aws', 0.1), row('azure', 0.08), row('gcp', 0.05)] },
  ],
};

const result = (over = {}) =>
  computeScenario({ pricing: PRICING, scenarioId: 'three-tier-web', extras: ['backup'], ...over });

const fetchMock = vi.fn();
const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const EXPLANATION = {
  success: true,
  explanation: {
    text: 'Google Cloud is cheapest because its VM rate is lowest.\n\nBackup adds little on every cloud.',
    generatedAt: '2026-09-15T10:30:00.000Z',
    cached: false,
  },
};

const button = () => screen.getByTestId('explain-button');

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(jsonResponse(EXPLANATION));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('explanationRequest', () => {
  it('carries the comparison without its lines, under the size cap', () => {
    const body = explanationRequest({ region: 'us-east-1', result: result() });
    expect(body).toMatchObject({
      region: 'us-east-1',
      scenarioId: 'three-tier-web',
      scenarioLabel: 'Three-tier web app',
      extras: ['backup'],
      egressGb: 500,
    });
    expect(body.results.map((r) => r.provider)).toEqual(['aws', 'azure', 'gcp']);
    expect(body.results[0]).toEqual({
      provider: 'aws',
      total: 713.64,
      base: 711,
      segments: [{ extraId: 'backup', label: 'Backup', cost: 2.64 }],
      unavailable: [],
    });
    expect(JSON.stringify(body).length).toBeLessThan(8 * 1024);
    expect(JSON.stringify(body)).not.toContain('"lines"');
  });
});

describe('ExplainButton', () => {
  it('requests nothing until clicked, then shows the labelled paragraphs and nothing else', async () => {
    render(<ExplainButton region="us-east-1" result={result()} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(button().disabled).toBe(false);

    fireEvent.click(button());
    expect(button().textContent).toContain('Explaining…');
    const panel = await screen.findByTestId('explanation');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [[url, init]] = fetchMock.mock.calls;
    expect(String(url)).toBe('https://api.test/api/public/cloud-tools/explain');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).scenarioId).toBe('three-tier-web');

    const paragraphs = Array.from(panel.querySelectorAll('p')).map((p) => p.textContent);
    expect(paragraphs).toEqual([
      'AI-generated summary. Check the sources before relying on it.',
      'Google Cloud is cheapest because its VM rate is lowest.',
      'Backup adds little on every cloud.',
    ]);
    expect(panel.dataset.cached).toBeUndefined();
    expect(button().textContent).toContain('Explain this comparison');
  });

  it('names no model and no time, even when the server still sends them, and marks a cached answer only in an attribute', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ...EXPLANATION,
        explanation: {
          ...EXPLANATION.explanation,
          model: 'gemini-3.5-flash-lite',
          cached: true,
        },
      })
    );
    render(<ExplainButton region="us-east-1" result={result()} />);
    fireEvent.click(button());
    const panel = await screen.findByTestId('explanation');
    expect(panel.dataset.cached).toBe('true');
    expect(panel.textContent).not.toMatch(/gemini|cached|2026/i);
  });

  it('says the hourly limit is reached on 429, with no retry button', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code: 'EXPLAIN_RATE_LIMITED', error: 'Too many requests' }, 429)
    );
    render(<ExplainButton region="us-east-1" result={result()} />);
    fireEvent.click(button());
    const alert = await screen.findByRole('alert');
    expect(alert.dataset.status).toBe('429');
    expect(alert.textContent).toBe(FAILURE_LINES.rateLimited);
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();
    expect(button().disabled).toBe(false);
  });

  it.each([
    ['EXPLAIN_UNAVAILABLE', FAILURE_LINES.unavailable],
    ['EXPLAIN_PAUSED_FOR_TODAY', FAILURE_LINES.paused],
    [undefined, FAILURE_LINES.unavailable],
  ])('words a 503 (%s) itself, never in the server’s words', async (code, expected) => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code, error: 'Paused: the Gemini key is not configured.' }, 503)
    );
    render(<ExplainButton region="us-east-1" result={result()} />);
    fireEvent.click(button());
    const alert = await screen.findByRole('alert');
    expect(alert.dataset.status).toBe('503');
    expect(alert.textContent).toBe(expected);
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();
  });

  it('says something went wrong on any other failure, offers Retry, and Retry asks again', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(jsonResponse(EXPLANATION));
    render(<ExplainButton region="us-east-1" result={result()} />);
    fireEvent.click(button());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(FAILURE_LINES.failed);
    expect(alert.textContent).not.toContain('network down');
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    await screen.findByTestId('explanation');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('is disabled while any provider has no total', () => {
    // static-site-api needs NoSQL, which GCP lacks in the fixture.
    render(<ExplainButton region="us-east-1" result={result({ scenarioId: 'static-site-api' })} />);
    expect(button().disabled).toBe(true);
    expect(button().getAttribute('title')).toMatch(/needs a total/);
    fireEvent.click(button());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops an answer once the numbers it explained change, and never re-asks on its own', async () => {
    const { rerender } = render(<ExplainButton region="us-east-1" result={result()} />);
    fireEvent.click(button());
    await screen.findByTestId('explanation');
    rerender(<ExplainButton region="us-east-1" result={result({ extras: ['commit-1y'] })} />);
    await waitFor(() => expect(screen.queryByTestId('explanation')).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Back to the same numbers: the answer for them is still held.
    rerender(<ExplainButton region="us-east-1" result={result()} />);
    expect(screen.getByTestId('explanation')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
