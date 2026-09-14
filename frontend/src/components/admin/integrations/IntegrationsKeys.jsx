/**
 * Keys tab — every Key Vault credential in the catalogue, in one place (#570).
 *
 * Each row is its light (live, going live, rejected, not set), its name, the
 * services that use it, and somewhere to paste a new value or generate one.
 * The paste and generate behaviour is SecretRow's, unchanged: a PUT to
 * `cms/secrets` with `{ secret, value }` or `{ secret, generate: true }`.
 * Keys are grouped by the catalogue's sections; a section this page does not
 * know yet goes under "Other credentials" rather than off the page.
 *
 * ## What this tab will not show you
 *
 * A credential value. `cms/secrets` returns state only and the app's vault
 * role cannot read a secret, so there is nothing to render. A row renders the
 * fields it names and nothing else, so even a value that somehow arrived in
 * the response would not reach the screen.
 *
 * ## Race-safety
 *
 * The status read is generation-guarded (useSecretStatus) and a failed refresh
 * clears the rows rather than leaving lights that are no longer true. One write
 * at a time: an in-flight ref refuses a second submit while the first is still
 * going, so a double press cannot send two PUTs, and the refresh after a write
 * goes through the same guarded load.
 */

import React, { useRef, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import { sendJSON } from '@/lib/api';
import { buildKeyGroups } from './integrationView';
import { SecretRow } from './SecretRow';
import { StateCounts } from './StateDot';
import useSecretStatus, { SECRETS_ROUTE } from './useSecretStatus';
import { TabError, TabLoading } from './TabNotice';

function KeyGroup({ title, blurb, items, onSubmit, busySecret }) {
  return (
    <section className="space-y-2" aria-label={title}>
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{blurb}</p>
      </div>
      <Card className="px-4">
        {items.map((item) => (
          <SecretRow
            key={item.secret}
            item={item}
            onSubmit={onSubmit}
            busy={busySecret === item.secret}
          />
        ))}
      </Card>
    </section>
  );
}

function OtherCredentials({ sections, onSubmit, busySecret }) {
  if (!sections.length) return null;
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Other credentials</h2>
        <p className="text-sm text-muted-foreground">
          Keys whose group this page does not know about yet.
        </p>
      </div>
      {sections.map((section) => (
        <Card key={section.id}>
          <CardHeader>
            <CardTitle className="text-lg">{section.title}</CardTitle>
            <CardDescription>{section.blurb}</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {section.items.map((item) => (
              <SecretRow
                key={item.secret}
                item={item}
                onSubmit={onSubmit}
                busy={busySecret === item.secret}
              />
            ))}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

function KeysFooter() {
  return (
    <>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Terraform declares which credentials exist and how the app finds them; Key Vault holds the
          values. This page only writes values, so nothing you paste here reaches Terraform state or
          a plan. Names come from the Function App settings in <code>infra/functionapp.tf</code> —
          to add a new one, add its reference there in the same change that teaches the code to read
          it.
        </span>
      </p>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          A credential showing <strong>Not set</strong> is either one nobody has seeded or one whose
          Key Vault reference is not resolving — the two are indistinguishable from inside the
          worker, which is why they share a light.
        </span>
      </p>
    </>
  );
}

/** The one write this tab makes, guarded so only one runs at a time. */
function useSecretWrite(reload) {
  const { toast } = useToast();
  const [busySecret, setBusySecret] = useState(null);
  const writing = useRef(false);

  const submitSecret = async (secret, payload) => {
    if (writing.current) return false;
    writing.current = true;
    setBusySecret(secret);
    try {
      const response = await sendJSON(SECRETS_ROUTE, 'PUT', { secret, ...payload });
      toast({ title: `${secret} stored`, description: response?.message });
      await reload();
      return true;
    } catch (err) {
      toast({
        title: `${secret} was not stored`,
        description: err?.message ?? 'The write was refused.',
        variant: 'destructive',
      });
      return false;
    } finally {
      writing.current = false;
      setBusySecret(null);
    }
  };

  return { busySecret, submitSecret };
}

export default function IntegrationsKeys() {
  const { data, loading, error, reload } = useSecretStatus();
  const { busySecret, submitSecret } = useSecretWrite(reload);

  const { groups, otherSections } = buildKeyGroups({
    sections: data?.sections ?? [],
    secrets: data?.secrets ?? [],
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Paste a key and save — it goes straight to Key Vault, is never stored in this site, never
          written to Terraform, and cannot be read back out here or anywhere else.
        </p>
        <Button variant="outline" size="sm" onClick={reload}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {loading && !data ? <TabLoading>Reading key status…</TabLoading> : null}
      <TabError message={error} onRetry={reload} />

      {data ? <StateCounts secrets={data.secrets} /> : null}

      {groups.map((group) => (
        <KeyGroup
          key={group.id}
          title={group.title}
          blurb={group.blurb}
          items={group.items}
          onSubmit={submitSecret}
          busySecret={busySecret}
        />
      ))}

      <OtherCredentials sections={otherSections} onSubmit={submitSecret} busySecret={busySecret} />

      <KeysFooter />
    </div>
  );
}
