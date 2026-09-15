/**
 * "How this is calculated" (#613, Phase 2): the rule behind every extra, in a
 * sentence, and the ASSUMPTIONS table — every multiplier the rules use, per
 * provider, with the provider page it was read from. Rendered from the same
 * constants the arithmetic uses, so the page cannot say one thing and compute
 * another.
 */
import React from 'react';
import { PRICING_PROVIDERS } from '@/lib/cloudPricing';
import { ASSUMPTIONS, EXTRAS, formatAssumption } from '@/lib/pricingScenarios';

export function ScenarioAssumptions({ extras }) {
  const chosen = new Set(extras);
  return (
    <details className="text-sm" data-testid="assumptions">
      <summary className="cursor-pointer font-medium underline decoration-dotted underline-offset-2">
        How this is calculated
      </summary>
      <div className="mt-3 flex flex-col gap-4">
        <p className="text-slate-600 dark:text-slate-400">
          Every line is quantity × factor × the unit price in the table below this card, live from
          the provider&rsquo;s price list or the site&rsquo;s catalogue figure where the list could
          not be read. Extras are priced off the same eight meters; the factors are these:
        </p>
        <ul className="flex flex-col gap-2">
          {EXTRAS.map((extra) => (
            <li
              key={extra.id}
              data-rule={extra.id}
              data-selected={chosen.has(extra.id) ? 'true' : undefined}
            >
              <span className={chosen.has(extra.id) ? 'font-semibold' : 'font-medium'}>
                {extra.label}
                {chosen.has(extra.id) ? ' (selected)' : ''}
              </span>
              <span className="text-slate-600 dark:text-slate-400"> — {extra.ruleText}</span>
            </li>
          ))}
        </ul>
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full min-w-[40rem] border-collapse text-left">
            <caption className="sr-only">
              Assumptions: one row per factor, its value on each provider, and the pages the values
              were read from.
            </caption>
            <thead>
              <tr className="text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400">
                <th scope="col" className="p-2">
                  Assumption
                </th>
                {PRICING_PROVIDERS.map((provider) => (
                  <th key={provider.id} scope="col" className="p-2 text-right">
                    {provider.label}
                  </th>
                ))}
                <th scope="col" className="p-2">
                  Sources
                </th>
              </tr>
            </thead>
            <tbody>
              {ASSUMPTIONS.map((assumption) => (
                <tr
                  key={assumption.id}
                  className="border-t border-slate-200 dark:border-slate-700"
                  data-assumption={assumption.id}
                >
                  <th scope="row" className="p-2 font-medium">
                    {assumption.label}
                  </th>
                  {PRICING_PROVIDERS.map((provider) => (
                    <td key={provider.id} className="p-2 text-right tabular-nums">
                      {formatAssumption(assumption.values[provider.id], assumption.format)}
                    </td>
                  ))}
                  <td className="p-2">
                    <ul className="flex flex-col gap-0.5">
                      {assumption.sources.map((source) => (
                        <li key={source.url}>
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline decoration-dotted underline-offset-2 hover:text-slate-950 dark:hover:text-white"
                          >
                            {source.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}
