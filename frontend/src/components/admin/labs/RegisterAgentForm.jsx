/**
 * Register agent — the Labs Hub's write path for the agent registry (#740).
 *
 * The API admits a lab agent only when `lab_agents/{agentId}` binds it to its
 * service principal, and until #740 nothing could write that document: no
 * route, this page read-only, and a Cosmos firewall that admits only the
 * Function App. So `scripts/lab/Register-LabAgent.ps1` did everything else of
 * the go-live and then printed JSON nobody could put anywhere. It now prints
 * the two values this form asks for, with this page's address, and waits.
 *
 * The same form re-registers: posting an agent id that exists updates its
 * object id and job types (`POST cms/labs/agents` is an idempotent upsert),
 * and never reactivates one that was deactivated — that is the card's
 * Activate button, so undoing a revocation is always its own act.
 *
 * Every job type starts ticked, which is what the go-live wants. The list is
 * the server's allowlist from the snapshot, so a type the snapshot has not
 * delivered yet is not offered; unticked types are remembered by name, so a
 * list that arrives after the first render still arrives ticked.
 */
import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, UserPlus } from 'lucide-react';
import { postJSON } from '@/lib/api';
import { REGISTER_SCRIPT, registrationToast, validateAgentRegistration } from './labsView';

function JobTypeChecks({ jobTypes, unticked, onToggle }) {
  return (
    <fieldset>
      <legend className="text-xs font-medium">Job types it may claim</legend>
      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {jobTypes.map(({ type }) => {
          const boxId = `labs-register-type-${type}`;
          return (
            <div key={type} className="flex items-center gap-2">
              <input
                id={boxId}
                type="checkbox"
                className="h-4 w-4"
                checked={!unticked.has(type)}
                onChange={(event) => onToggle(type, event.target.checked)}
              />
              <label htmlFor={boxId} className="text-xs font-mono">
                {type}
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function TextField({ id, label, value, placeholder, onChange }) {
  return (
    <div>
      <Label className="text-xs" htmlFor={id}>
        {label}
      </Label>
      {/* aria-label, because Input otherwise names itself by its placeholder. */}
      <Input
        id={id}
        aria-label={label}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 font-mono text-xs"
      />
    </div>
  );
}

/**
 * @param {{jobTypes: {type: string}[], onRegistered?: (agent: object) => void}} props
 */
export default function RegisterAgentForm({ jobTypes, onRegistered }) {
  const { toast } = useToast();
  const [agentId, setAgentId] = useState('');
  const [oid, setOid] = useState('');
  const [unticked, setUnticked] = useState(() => new Set());
  const [problem, setProblem] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const toggle = (type, checked) =>
    setUnticked((prev) => {
      const next = new Set(prev);
      if (checked) next.delete(type);
      else next.add(type);
      return next;
    });

  const handleSubmit = async (event) => {
    event.preventDefault();
    const registration = {
      agentId: agentId.trim(),
      oid: oid.trim(),
      jobTypes: jobTypes.map((jt) => jt.type).filter((type) => !unticked.has(type)),
    };
    const invalid = validateAgentRegistration(registration);
    setProblem(invalid);
    if (invalid) return;

    setSubmitting(true);
    try {
      const res = await postJSON('cms/labs/agents', registration);
      toast(registrationToast(res));
      setAgentId('');
      setOid('');
      onRegistered?.(res.agent);
    } catch (err) {
      toast({ title: 'Registration failed', description: err.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Register agent</CardTitle>
        <CardDescription>
          <code>{REGISTER_SCRIPT}</code> prints both values: the agent id is its certificate CN, the
          object id is its service principal&apos;s.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit} noValidate aria-label="Register agent">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TextField
              id="labs-register-agent-id"
              label="Agent id"
              value={agentId}
              placeholder="vps-hostinger-01"
              onChange={setAgentId}
            />
            <TextField
              id="labs-register-object-id"
              label="Object id"
              value={oid}
              placeholder="00000000-0000-0000-0000-000000000000"
              onChange={setOid}
            />
          </div>
          <JobTypeChecks jobTypes={jobTypes} unticked={unticked} onToggle={toggle} />
          {problem && (
            <p className="text-xs text-rose-600 dark:text-rose-400" role="alert">
              {problem}
            </p>
          )}
          <Button type="submit" disabled={submitting} className="gap-1.5">
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            Register agent
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
