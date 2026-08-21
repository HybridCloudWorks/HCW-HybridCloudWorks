import React from 'react';
import { ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import FrameworkRadar from '@/components/widgets/FrameworkRadar';
import { getFramework, isPillarOfProvider } from '@/config/wellArchitectedPillars';

/**
 * Well-Architected assessment for one architecture design.
 *
 * Renders only what is stored on the document (`doc.waf`, scored at authoring
 * time and human-reviewable there) against the provider's official pillar set
 * from config. Pillars the vendor does not define are dropped, not drawn: a
 * radar axis is a claim about the framework, and this component refuses to
 * invent one even if a stored document carries a stray id.
 *
 * Lazy-load this component — FrameworkRadar pulls chart.js into vendor-charts.
 */
// A published score must always say who stands behind it.
function attributionText(waf) {
  if (waf.generatedBy === 'human') {
    return 'Authored and scored by hand against the vendor framework.';
  }
  if (waf.overriddenBy) {
    return 'AI-assessed, reviewed and adjusted by a human before publish.';
  }
  return 'AI-assessed at authoring time and human-reviewed before publish.';
}

export default function WafAssessment({ waf }) {
  const framework = getFramework(waf?.provider);
  if (!framework || !Array.isArray(waf?.pillars) || waf.pillars.length === 0) return null;

  const scored = new Map(
    waf.pillars
      .filter((pillar) => isPillarOfProvider(waf.provider, pillar?.id))
      .map((pillar) => [pillar.id, pillar])
  );
  if (scored.size === 0) return null;

  // Vendor order, not stored order — the axes should read like the framework.
  const pillars = framework.pillars.filter((pillar) => scored.has(pillar.id));
  const radarData = {
    labels: pillars.map((pillar) => pillar.label),
    datasets: [
      {
        label: 'Pillar score',
        data: pillars.map((pillar) => scored.get(pillar.id).score),
        backgroundColor: 'rgba(59, 130, 246, 0.2)',
        borderColor: 'rgba(59, 130, 246, 1)',
        borderWidth: 2,
        pointBackgroundColor: 'rgba(59, 130, 246, 1)',
      },
    ],
  };

  return (
    <section aria-label="Well-Architected assessment" className="space-y-6">
      <div className="grid md:grid-cols-[1fr_auto] gap-6 items-start">
        <FrameworkRadar data={radarData} title={framework.frameworkName} max={100} />

        <Card className="bg-card/40 md:w-56">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Overall</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-bold text-primary">
              {waf.overall}
              <span className="text-base font-normal text-muted-foreground"> / 100</span>
            </p>
            <p className="text-xs text-muted-foreground mt-3">{attributionText(waf)}</p>
            <a
              href={framework.frameworkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary inline-flex items-center gap-1 mt-3 hover:underline"
            >
              {framework.frameworkName}
              <ExternalLink className="h-3 w-3" />
            </a>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {pillars.map((pillar) => {
          const assessment = scored.get(pillar.id);
          return (
            <Card key={pillar.id} className="bg-card/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center justify-between gap-2">
                  <a
                    href={pillar.docUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {pillar.label}
                  </a>
                  <Badge variant="secondary">{assessment.score}</Badge>
                </CardTitle>
              </CardHeader>
              {assessment.commentary && (
                <CardContent className="pt-0">
                  <p className="text-sm text-muted-foreground">{assessment.commentary}</p>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </section>
  );
}
