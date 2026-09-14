/**
 * Add a sending domain to Resend (#504). Publisher-only on the server.
 *
 *   POST cms/mailing-list/domains  { name, region }
 *
 * The hostname check here only catches typing mistakes before a round trip;
 * the server applies the same pattern and is the authority. The regions are
 * the server's DOMAIN_REGIONS list (functions/src/lib/newsletter/
 * insights-handlers.js), which no route returns, so it is repeated here.
 */
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Plus } from 'lucide-react';
import { sendJSON } from '@/lib/api';
import { describeResendError } from '../resendFormat';
import { Notice, RESEND_ROUTE } from './resendShared';

export const DOMAIN_REGIONS = ['us-east-1', 'eu-west-1', 'sa-east-1', 'ap-northeast-1'];
export const DEFAULT_REGION = 'us-east-1';
const MAX_HOSTNAME_LENGTH = 253;
const HOSTNAME_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** The name as the server will read it, or null when it cannot be a hostname. */
export function normaliseHostname(value) {
  const name = String(value || '')
    .trim()
    .toLowerCase();
  if (!name || name.length > MAX_HOSTNAME_LENGTH || !HOSTNAME_PATTERN.test(name)) return null;
  return name;
}

export default function DomainAddForm({ onAdded }) {
  const [name, setName] = useState('');
  const [region, setRegion] = useState(DEFAULT_REGION);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    const hostname = normaliseHostname(name);
    if (!hostname) {
      setError('Enter a domain name such as news.example.com.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await sendJSON(`${RESEND_ROUTE}/domains`, 'POST', { name: hostname, region });
      setName('');
      onAdded(res?.domain ?? null);
    } catch (err) {
      setError(describeResendError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border border-border p-3">
      <p className="text-sm font-medium">Add a domain</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[12rem] flex-1 space-y-1">
          <label htmlFor="resend-domain-name" className="text-xs font-medium">
            Domain name
          </label>
          <Input
            id="resend-domain-name"
            value={name}
            maxLength={MAX_HOSTNAME_LENGTH}
            placeholder="news.example.com"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="resend-domain-region" className="block text-xs font-medium">
            Region
          </label>
          <select
            id="resend-domain-region"
            value={region}
            onChange={(event) => setRegion(event.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            {DOMAIN_REGIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add domain
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Publisher only. Resend returns the DNS records to add once the domain is created.
      </p>
      {error && <Notice>{error}</Notice>}
    </form>
  );
}
