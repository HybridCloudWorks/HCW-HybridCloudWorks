/**
 * The top of the blog review board (ADR 0033, PR #841): the title row with
 * the provider picker, and the publish schedule card.
 */
import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Calendar, Loader2, Save } from 'lucide-react';
import { PROVIDER_OPTIONS } from '@/config/admin';
import StatusBadge from '@/components/admin/shared/StatusBadge';
import TaxonomyChips from '@/components/admin/shared/TaxonomyChips';
import { describeScheduleState } from './blogReviewModel';

function ProviderBadge({ hasProvider, selectedProvider, pickerOpen, onTogglePicker }) {
  if (!hasProvider) {
    return (
      <Badge className="animate-pulse bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200 border border-red-300 dark:border-red-700">
        Unknown Provider - Select One
      </Badge>
    );
  }
  return (
    <button
      type="button"
      onClick={onTogglePicker}
      className="rounded"
      aria-haspopup="listbox"
      aria-expanded={pickerOpen}
      aria-label={`Select cloud provider, current provider is ${selectedProvider}`}
    >
      <Badge variant="outline">{selectedProvider}</Badge>
    </button>
  );
}

/**
 * Every provider an article can be published under is offered here; a post
 * the classifier filed under no known provider cannot reach the publish
 * queue until one is chosen.
 */
export function ProviderHeader({ blog, view, state, onTogglePicker, onSelectProvider }) {
  const showProviderOptions = state.providerPickerOpen || !view.hasProvider;
  return (
    <div className="flex items-center gap-4">
      <div className="flex-1">
        <h1 className="text-xl font-bold truncate">{view.title}</h1>
        <div className="flex items-center gap-2 mt-1">
          <ProviderBadge
            hasProvider={view.hasProvider}
            selectedProvider={view.selectedProvider}
            pickerOpen={state.providerPickerOpen}
            onTogglePicker={onTogglePicker}
          />
          <StatusBadge content={blog} />
          <TaxonomyChips item={blog} />
        </div>
        {showProviderOptions && (
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {PROVIDER_OPTIONS.map((provider) => (
              <Button
                key={provider.value}
                type="button"
                size="sm"
                variant="outline"
                className="border-red-300 hover:border-red-500"
                disabled={state.providerSaving}
                onClick={() => onSelectProvider(provider.value)}
              >
                {provider.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const SCHEDULE_INPUTS = Object.freeze([
  { id: 'scheduledDate', label: 'Date', type: 'date' },
  { id: 'scheduledTime', label: 'Time', type: 'time' },
]);

function ScheduleInputs({ state, disabled, patch }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {SCHEDULE_INPUTS.map(({ id, label, type }) => (
        <div key={id} className="space-y-2">
          <Label htmlFor={id} className="text-xs text-muted-foreground">
            {label}
          </Label>
          <input
            id={id}
            type={type}
            value={state[id]}
            onChange={(e) => patch({ [id]: e.target.value })}
            disabled={disabled}
            className="w-full px-3 py-2 text-sm border rounded-md bg-background"
          />
        </div>
      ))}
    </div>
  );
}

function SaveScheduleLabel({ saving }) {
  if (saving) {
    return (
      <>
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        Saving...
      </>
    );
  }
  return (
    <>
      <Save className="h-4 w-4 mr-2" />
      Save Schedule
    </>
  );
}

export function ScheduleCard({ state, hasProvider, patch, onSave }) {
  const { instantPublish, scheduledDate, scheduledTime, savingSchedule, scheduleMessage } = state;
  const scheduleIncomplete = !instantPublish && (!scheduledDate || !scheduledTime);
  const saveDisabled = !hasProvider || savingSchedule || scheduleIncomplete;
  const messageClass = scheduleMessage?.type === 'success' ? 'text-green-600' : 'text-destructive';
  return (
    <Card className="border-blue-200 bg-blue-50/50 dark:bg-blue-950/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          Publish Queue Schedule
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center space-x-2">
          <input
            id="instantPublish"
            type="checkbox"
            checked={instantPublish}
            onChange={(e) => patch({ instantPublish: e.target.checked })}
            disabled={!hasProvider}
            className="h-4 w-4 rounded border border-input bg-background"
          />
          <Label
            htmlFor="instantPublish"
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            Ready for Immediate Publish (when executed from Publish pane)
          </Label>
        </div>

        {!instantPublish && <ScheduleInputs state={state} disabled={!hasProvider} patch={patch} />}

        <Button size="sm" onClick={onSave} disabled={saveDisabled} className="w-full">
          <SaveScheduleLabel saving={savingSchedule} />
        </Button>

        {scheduleMessage && <p className={`text-xs ${messageClass}`}>{scheduleMessage.text}</p>}

        <p className="text-xs text-muted-foreground">
          {describeScheduleState({ hasProvider, instantPublish, scheduledDate, scheduledTime })}
        </p>
      </CardContent>
    </Card>
  );
}
