/**
 * Social automation — what happens on social media when a post goes live.
 *
 *   Social autoposting   admin_config/social_autopost   read by social-caption-trigger.js
 *
 * Pickers are native `<select>` elements: they are keyboard-accessible, they
 * work in the test runner without pointer-event shims, and nothing here
 * needs a search box.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useAuthReady } from '@/hooks/useAuthReady';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Plus, Share2, Trash2 } from 'lucide-react';
import { postJSON } from '@/lib/api';
import {
  describePublerFailure,
  publerAccountsStatus,
  unwrapPublerAccounts,
} from '@/lib/publerAccounts';
import {
  SELECT_CLASS,
  SETTING_LABELS,
  SOCIAL_PROVIDERS,
  SaveRow,
  SettingSection,
  StoredState,
  useSetting,
} from './settingShared';

/** Publer reports a network name in its own casing; the trigger keys on lowercase. */
const providerOf = (account) => String(account?.provider || '').toLowerCase();

function PublerNotes({ publerStatus, publerError, unsupported }) {
  return (
    <>
      {publerStatus === 'not_configured' ? (
        <p className="text-xs text-muted-foreground">
          Publer not configured — connect it in the Social Hub&apos;s Connection Settings tab to
          pick accounts here; until then, add them by id.
        </p>
      ) : null}
      {publerStatus === 'error' ? (
        <p className="text-xs text-destructive">
          Publer accounts could not be loaded — {publerError || 'the call failed'}. The picker is
          empty because the call did not succeed, not because the workspace is; add accounts by id,
          or fix the connection in the Social Hub.
        </p>
      ) : null}
      {unsupported.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {unsupported.length} Publer account{unsupported.length === 1 ? '' : 's'} hidden:
          autoposting supports {SOCIAL_PROVIDERS.join(', ')} only.
        </p>
      ) : null}
    </>
  );
}

function AccountRow({ row, index, saving, onEdit, onRemove }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        aria-label={`Account id ${index + 1}`}
        value={row.id}
        disabled={saving}
        spellCheck={false}
        placeholder="Publer account id"
        onChange={(event) => onEdit(index, { id: event.target.value })}
        className="w-full font-mono text-xs sm:w-72"
      />
      <select
        aria-label={`Provider ${index + 1}`}
        className={`${SELECT_CLASS} w-40`}
        value={row.provider}
        disabled={saving}
        onChange={(event) => onEdit(index, { provider: event.target.value })}
      >
        {SOCIAL_PROVIDERS.map((provider) => (
          <option key={provider} value={provider}>
            {provider}
          </option>
        ))}
      </select>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={saving}
        aria-label={`Remove account ${index + 1}`}
        onClick={() => onRemove(index)}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function SocialAutopostCard({
  value,
  onChange,
  onSave,
  saving,
  meta,
  publerAccounts,
  publerStatus = 'ready',
  publerError = '',
}) {
  const enabled = Boolean(value?.enabled);
  const accountIds = useMemo(() => value?.accountIds ?? [], [value]);
  const delay = value?.scheduleDelayMinutes ?? 60;
  const [pick, setPick] = useState('');

  const update = (patch) =>
    onChange({ enabled, accountIds, scheduleDelayMinutes: delay, ...patch });
  const setAccount = (index, patch) =>
    update({
      accountIds: accountIds.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    });
  const removeAccount = (index) =>
    update({ accountIds: accountIds.filter((_row, i) => i !== index) });
  const addAccount = (row) => update({ accountIds: [...accountIds, row] });

  // Accounts the Social Hub already lists, minus the ones already chosen, and
  // minus any on a network the trigger cannot post to. Those are counted, not
  // offered: quietly rewriting an unsupported provider to another network
  // would schedule the post somewhere the owner did not choose.
  const { pickable, unsupported } = useMemo(() => {
    const listed = (publerAccounts ?? []).filter(
      (account) => account?.id && !accountIds.some((row) => row.id === String(account.id))
    );
    const supported = (account) => SOCIAL_PROVIDERS.includes(providerOf(account));
    return {
      pickable: listed.filter(supported),
      unsupported: listed.filter((account) => !supported(account)),
    };
  }, [publerAccounts, accountIds]);

  const addPicked = () => {
    const account = pickable.find((candidate) => String(candidate.id) === pick);
    if (!account) return;
    addAccount({ id: String(account.id), provider: providerOf(account) });
    setPick('');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Share2 className="h-5 w-5" /> Social autoposting
        </CardTitle>
        <CardDescription>
          On a live publish, a caption is generated and one post per account is scheduled in Publer
          after the delay — the undo window, during which the post can be cancelled from Publer or
          the Social Hub. Account ids are the ones the Social Hub shows; they are identifiers, not
          secrets.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <StoredState meta={meta} />
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-3">
              <Switch
                id="autopost-enabled"
                checked={enabled}
                disabled={saving}
                onCheckedChange={(checked) => update({ enabled: checked })}
              />
              <Label htmlFor="autopost-enabled">Autoposting {enabled ? 'on' : 'off'}</Label>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="autopost-delay">Delay (minutes)</Label>
              <Input
                id="autopost-delay"
                type="number"
                min={1}
                max={10080}
                step={1}
                value={delay}
                disabled={saving}
                onChange={(event) => update({ scheduleDelayMinutes: event.target.value })}
                className="w-24"
              />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Accounts</p>
            {accountIds.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No accounts yet. Autoposting cannot be turned on until one is added.
              </p>
            ) : null}
            {accountIds.map((row, index) => (
              <AccountRow
                key={`${row.id}-${index}`}
                row={row}
                index={index}
                saving={saving}
                onEdit={setAccount}
                onRemove={removeAccount}
              />
            ))}

            <div className="flex flex-wrap items-center gap-2">
              {pickable.length > 0 ? (
                <>
                  <select
                    aria-label="Publer account to add"
                    className={`${SELECT_CLASS} w-full sm:w-80`}
                    value={pick}
                    disabled={saving}
                    onChange={(event) => setPick(event.target.value)}
                  >
                    <option value="">Pick a Publer account…</option>
                    {pickable.map((account) => (
                      <option key={account.id} value={String(account.id)}>
                        {account.name || account.id} · {account.provider || 'unknown'}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={saving || !pick}
                    onClick={addPicked}
                  >
                    <Plus className="mr-2 h-3.5 w-3.5" /> Add from Publer
                  </Button>
                </>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => addAccount({ id: '', provider: 'linkedin' })}
              >
                <Plus className="mr-2 h-3.5 w-3.5" /> Add account by id
              </Button>
            </div>
            <PublerNotes
              publerStatus={publerStatus}
              publerError={publerError}
              unsupported={unsupported}
            />
          </div>

          <SaveRow saving={saving} />
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Best effort: the same proxied call the Social Hub makes, unwrapped from the
 * proxy envelope. Not configured, or any failure, means the free-text id field
 * is the whole picker.
 *
 * The proxy answers HTTP 200 whatever happens, so Publer refusing the key
 * resolves rather than rejects; without `failed` it would land in the `ready`
 * branch and read as a workspace with no accounts.
 */
export function usePublerAccounts(authReady) {
  const [accounts, setAccounts] = useState([]);
  // 'loading' | 'ready' | 'not_configured' | 'error' — the card says which.
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!authReady) return undefined;
    let cancelled = false;
    postJSON('publerProxy', { path: '/accounts', method: 'GET' })
      .then((response) => {
        if (cancelled) return;
        const unwrapped = unwrapPublerAccounts(response);
        setAccounts(unwrapped.accounts);
        setStatus(publerAccountsStatus(unwrapped));
        setError(unwrapped.failed ? describePublerFailure(unwrapped) : '');
      })
      .catch((err) => {
        if (cancelled) return;
        setAccounts([]);
        setStatus('error');
        setError(err?.message || 'the request failed');
      });
    return () => {
      cancelled = true;
    };
  }, [authReady]);

  return { accounts, status, error };
}

export default function SocialAutomationTab() {
  const { authReady } = useAuthReady();
  const autopost = useSetting('social-autopost', authReady);
  const publer = usePublerAccounts(authReady);

  return (
    <div className="space-y-6">
      <SettingSection
        setting={autopost}
        label={SETTING_LABELS['social-autopost']}
        render={(s) => (
          <SocialAutopostCard
            value={s.value}
            meta={s.meta}
            saving={s.saving}
            publerAccounts={publer.accounts}
            publerStatus={publer.status}
            publerError={publer.error}
            onChange={s.setValue}
            onSave={() => s.save(s.value)}
          />
        )}
      />
    </div>
  );
}
