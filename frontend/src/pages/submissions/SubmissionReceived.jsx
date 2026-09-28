/**
 * The card a submission page shows once the server has taken the entry: a
 * title, one sentence saying it will be reviewed before it is published, and
 * "Submit Another". Shared by the architecture and framework pages, which
 * showed the same card twice (and, until 2026-09-28, a "View Queue" link into
 * /admin that no visitor can open).
 */
import React from 'react';
import { CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * @param {object} props
 * @param {string} props.title  e.g. "Blueprint Submitted!"
 * @param {string} props.message  what happens next, in the visitor's words
 * @param {() => void} props.onAnother  back to an empty form
 */
export default function SubmissionReceived({ title, message, onAnother }) {
  return (
    <Card className="bg-card/40 border-green-500/30 max-w-lg">
      <CardContent className="pt-8 pb-8 text-center space-y-4">
        <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
        <h3 className="text-xl font-bold">{title}</h3>
        <p className="text-muted-foreground text-sm">{message}</p>
        <div className="flex gap-3 justify-center pt-2">
          <Button onClick={onAnother} variant="outline">
            Submit Another
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
