/**
 * Settings — what is set once rather than worked through: the badge image
 * rules, the verification source each cert gives the re-verify timer, and the
 * certifications hidden from the About page (with Show on each).
 */
import React, { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CertGrid } from './CertCard';
import { CertListNotice, TabIntro } from './shared';
import { IMAGE_RULES } from './editorFields';
import { hiddenCerts, verificationCounts } from './certView';

function ImageRulesCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Image rules</CardTitle>
        <CardDescription>What the editor&apos;s badge upload accepts.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>
            {IMAGE_RULES.formats} (any image type), at most {IMAGE_RULES.maxLabel}.
          </li>
          <li>
            Uploaded through the Azure API to Blob Storage, under the certification&apos;s id.
          </li>
          <li>
            The Image URL is tried first and the uploaded copies after it, so a broken Credly image
            falls back to the stored one.
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}

function VerificationCard({ items }) {
  const counts = useMemo(() => verificationCounts(items), [items]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Verification source</CardTitle>
        <CardDescription>
          What the Sunday re-verify timer can check for each active certification.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Credly badge ({counts.credly})</dt>
          <dd>The badge page is read; &quot;Unable to verify badge&quot; marks it inactive.</dd>
          <dt className="text-muted-foreground">Other verify link ({counts.link})</dt>
          <dd>Linked from the card; only the expiry date is checked.</dd>
          <dt className="text-muted-foreground">No verify URL ({counts.none})</dt>
          <dd>Only the expiry date is checked.</dd>
        </dl>
      </CardContent>
    </Card>
  );
}

export default function SettingsTab({ certs, nowMs, actions }) {
  const hidden = useMemo(() => hiddenCerts(certs.items), [certs.items]);
  return (
    <div className="space-y-4">
      <TabIntro>Rules and lists that are set once rather than worked through.</TabIntro>
      <ImageRulesCard />
      {certs.loaded ? (
        <>
          <VerificationCard items={certs.items} />
          <section aria-labelledby="cert-hidden-heading" className="space-y-3">
            <h2 id="cert-hidden-heading" className="text-lg font-semibold">
              Hidden from the About page ({hidden.length})
            </h2>
            <CertGrid
              certs={hidden}
              nowMs={nowMs}
              busyIds={certs.busyIds}
              actions={actions}
              empty="Every certification is shown on the About page."
            />
          </section>
        </>
      ) : (
        <CertListNotice certs={certs} />
      )}
    </div>
  );
}
