/**
 * Featured — what the Spotlight leads with, in display order. Order is set
 * per cert in the editor (Display order, with its vendor ladder); unfeaturing
 * is the star on each card.
 */
import React, { useMemo } from 'react';
import { CertGrid } from './CertCard';
import { CertListNotice, TabIntro } from './shared';
import { featuredCerts } from './certView';

export default function FeaturedTab({ certs, nowMs, actions }) {
  const featured = useMemo(() => featuredCerts(certs.items), [certs.items]);
  return (
    <div className="space-y-4">
      <TabIntro>
        Certifications featured in Spotlight, in display order. Edit a card to change its order; the
        star removes it from this list.
      </TabIntro>
      {certs.loaded ? (
        <CertGrid
          certs={featured}
          nowMs={nowMs}
          busyIds={certs.busyIds}
          actions={actions}
          empty="Nothing is featured. Use the star on a Catalog card to feature one."
        />
      ) : (
        <CertListNotice certs={certs} />
      )}
    </div>
  );
}
