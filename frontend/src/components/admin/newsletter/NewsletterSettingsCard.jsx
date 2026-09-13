/**
 * NewsletterSettingsCard — the settings a newsletter send needs (ADR 0030 §2a).
 *
 * Reads and writes `cms/platform-settings/newsletter-settings`. A partial save
 * is allowed; approval is what refuses to send without the postal address and
 * the reply-to, and the issue view says so beside the Approve button.
 */
import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Save } from 'lucide-react';
import { getJSON, sendJSON } from '@/lib/api';

export const NEWSLETTER_SETTINGS_ROUTE = 'cms/platform-settings/newsletter-settings';

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const EMPTY = {
  postalAddress: '',
  replyTo: '',
  sendDay: 'tuesday',
  sendTime: '09:00',
  timeZone: 'America/Chicago',
};

export default function NewsletterSettingsCard({ onSaved }) {
  const [value, setValue] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getJSON(NEWSLETTER_SETTINGS_ROUTE)
      .then((res) => {
        if (!cancelled && res?.value) setValue({ ...EMPTY, ...res.value });
      })
      .catch((err) => !cancelled && setNotice({ ok: false, message: err.message }))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const set = (key) => (event) =>
    setValue((current) => ({ ...current, [key]: event.target.value }));

  const handleSave = async (event) => {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const res = await sendJSON(NEWSLETTER_SETTINGS_ROUTE, 'PUT', value);
      setValue({ ...EMPTY, ...res.value });
      setNotice({ ok: true, message: 'Newsletter settings saved.' });
      onSaved?.();
    } catch (err) {
      setNotice({ ok: false, message: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Newsletter settings</CardTitle>
        <CardDescription>
          Every issue carries your postal address (required by law for commercial email) and sends
          replies to the inbox below. Nothing can be approved until both are filled in.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Loader2
            className="h-5 w-5 animate-spin text-muted-foreground"
            aria-label="Loading settings"
          />
        ) : (
          <form onSubmit={handleSave} className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2 space-y-1.5">
              <Label htmlFor="nl-postal">Postal address</Label>
              <Textarea
                id="nl-postal"
                rows={3}
                maxLength={300}
                value={value.postalAddress}
                onChange={set('postalAddress')}
                placeholder="PO Box or business address"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nl-reply">Reply-to address</Label>
              <Input
                id="nl-reply"
                type="email"
                value={value.replyTo}
                onChange={set('replyTo')}
                placeholder="an inbox you read"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nl-zone">Time zone</Label>
              <Input id="nl-zone" value={value.timeZone} onChange={set('timeZone')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nl-day">Send day</Label>
              <select
                id="nl-day"
                value={value.sendDay}
                onChange={set('sendDay')}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm capitalize"
              >
                {DAYS.map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nl-time">Send time</Label>
              <Input id="nl-time" type="time" value={value.sendTime} onChange={set('sendTime')} />
            </div>
            <div className="md:col-span-2 flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={saving} className="gap-2">
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save settings
              </Button>
              {notice && (
                <p
                  role={notice.ok ? 'status' : 'alert'}
                  className={`text-sm ${notice.ok ? 'text-emerald-600' : 'text-destructive'}`}
                >
                  {notice.message}
                </p>
              )}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
