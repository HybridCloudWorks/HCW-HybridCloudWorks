import React, { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router';
import { ExternalLink, Lightbulb, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useFrameworkData } from '@/hooks/useFrameworkData';

const PROVIDER_META = {
  aws: { label: 'AWS' },
  azure: { label: 'Azure' },
  gcp: { label: 'GCP' },
  finops: { label: 'FinOps' },
};

function conceptRecommendation(concept) {
  if (!concept) return '';
  if (concept.recommendation) return concept.recommendation;
  if (concept.details) return concept.details;
  return concept.summary;
}

export default function FrameworksPage({ provider = 'aws' }) {
  const navigate = useNavigate();
  const providerKey = String(provider || '').toLowerCase();
  const providerLabel = PROVIDER_META[providerKey]?.label || providerKey.toUpperCase();
  const { frameworks, loading } = useFrameworkData(providerKey);

  const [activeFrameworkId, setActiveFrameworkId] = useState('');
  const [selectedConceptIds, setSelectedConceptIds] = useState([]);

  const resolvedActiveFrameworkId = useMemo(() => {
    if (!frameworks.length) return '';
    if (activeFrameworkId && frameworks.some((framework) => framework.id === activeFrameworkId)) {
      return activeFrameworkId;
    }
    return frameworks[0].id;
  }, [activeFrameworkId, frameworks]);

  const activeFramework = useMemo(
    () =>
      frameworks.find((framework) => framework.id === resolvedActiveFrameworkId) ||
      frameworks[0] ||
      null,
    [frameworks, resolvedActiveFrameworkId]
  );

  const resolvedSelectedConceptIds = useMemo(() => {
    if (!activeFramework) return [];

    const conceptIds = new Set(activeFramework.concepts.map((concept) => concept.id));
    const filtered = selectedConceptIds.filter((id) => conceptIds.has(id));
    if (filtered.length > 0) return filtered.slice(-2);
    return activeFramework.concepts[0] ? [activeFramework.concepts[0].id] : [];
  }, [activeFramework, selectedConceptIds]);

  const selectedConcepts = useMemo(() => {
    if (!activeFramework) return [];
    const selectedSet = new Set(resolvedSelectedConceptIds);
    return activeFramework.concepts.filter((concept) => selectedSet.has(concept.id));
  }, [activeFramework, resolvedSelectedConceptIds]);

  const toggleConcept = (conceptId) => {
    setSelectedConceptIds((current) => {
      if (current.includes(conceptId)) {
        return current.filter((id) => id !== conceptId);
      }
      return [...current, conceptId].slice(-2);
    });
  };

  const architectureRecommendation = useMemo(() => {
    if (!activeFramework) return '';
    if (selectedConcepts.length === 0) return activeFramework.architectureRecommendation;

    const recommendations = selectedConcepts
      .map((concept) => conceptRecommendation(concept))
      .filter(Boolean);

    if (recommendations.length > 0) {
      return recommendations.join(' ');
    }

    return activeFramework.architectureRecommendation;
  }, [activeFramework, selectedConcepts]);

  return (
    <>
      <Helmet>
        <title>{`${providerLabel} Frameworks | Hybrid Cloud Works`}</title>
        <meta
          name="description"
          content={`${providerLabel} framework explorer with dynamic concepts and architecture recommendations from ContentForge.`}
        />
      </Helmet>

      <main className="flex-grow pt-28 pb-20 px-4 md:px-8 max-w-[1600px] mx-auto w-full space-y-8">
        <section className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-3xl sm:text-5xl font-black text-slate-900 dark:text-white tracking-tight">
                {providerLabel} Frameworks
              </h1>
              <p className="text-slate-700 dark:text-slate-400 mt-2 max-w-3xl">
                Dynamic framework concepts sourced from ContentForge. Select one or two framework
                concepts to compare implementation guidance and architecture recommendations.
              </p>
            </div>
            {activeFramework?.slug && (
              <Button
                onClick={() => navigate(`/${providerKey}/frameworks/${activeFramework.slug}`)}
              >
                View Full Framework
              </Button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {frameworks.map((framework) => (
              <button
                key={framework.id}
                type="button"
                onClick={() => setActiveFrameworkId(framework.id)}
                className={`px-3 py-2 rounded-lg border text-sm transition-colors ${
                  framework.id === activeFramework?.id
                    ? 'bg-primary/20 border-primary/60 text-primary'
                    : 'bg-slate-800/40 border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                {framework.title}
              </button>
            ))}
          </div>
        </section>

        {loading && frameworks.length === 0 && (
          <Card className="bg-slate-900/40 border-slate-700">
            <CardContent className="py-8 text-slate-400">Loading frameworks...</CardContent>
          </Card>
        )}

        {!loading && frameworks.length === 0 && (
          <Card className="bg-slate-900/40 border-slate-700">
            <CardContent className="py-8 text-slate-400">
              No published frameworks found for {providerLabel}. Publish framework content from
              ContentForge to populate this page.
            </CardContent>
          </Card>
        )}

        {activeFramework && (
          <>
            <Card className="bg-slate-900/40 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  Framework Map
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-slate-300">{activeFramework.summary}</p>
                <div className="flex flex-wrap gap-2">
                  {(activeFramework.tags || []).map((tag) => (
                    <Badge key={tag} variant="outline" className="border-slate-600 text-slate-300">
                      {tag}
                    </Badge>
                  ))}
                </div>
                <Separator className="bg-slate-700" />
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {activeFramework.concepts.map((concept) => {
                    const selected = selectedConceptIds.includes(concept.id);
                    return (
                      <button
                        key={concept.id}
                        type="button"
                        onClick={() => toggleConcept(concept.id)}
                        className={`text-left rounded-xl border p-4 transition-all ${
                          selected
                            ? 'border-primary/70 bg-primary/10 shadow-[0_0_20px_rgba(var(--primary-rgb),0.18)]'
                            : 'border-slate-700 bg-slate-800/40 hover:border-slate-500'
                        }`}
                      >
                        <div className="text-sm font-semibold text-white">{concept.label}</div>
                        <div className="text-xs text-slate-400 mt-2 line-clamp-3">
                          {concept.summary || 'Click to inspect implementation guidance.'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <section className="space-y-4">
              <div className="text-sm text-slate-400">
                Selection mode:{' '}
                {selectedConcepts.length === 2 ? 'comparison (2-column)' : 'focus (1-column)'}
              </div>

              {selectedConcepts.length > 0 && (
                <div
                  className={`grid gap-4 ${
                    selectedConcepts.length === 2 ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'
                  }`}
                >
                  {selectedConcepts.map((concept) => (
                    <Card key={concept.id} className="bg-slate-900/40 border-slate-700">
                      <CardHeader>
                        <CardTitle className="text-white text-lg">{concept.label}</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <p className="text-slate-300">{concept.summary || 'No summary yet.'}</p>
                        <p className="text-slate-400 text-sm">
                          {concept.details ||
                            'Detailed implementation guidance can be added in Framework Studio.'}
                        </p>
                        {concept.sources.length > 0 && (
                          <div className="space-y-2">
                            <div className="text-xs uppercase tracking-wide text-slate-400">
                              Sources
                            </div>
                            {concept.sources.slice(0, 4).map((sourceUrl) => (
                              <a
                                key={sourceUrl}
                                href={sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs text-primary hover:underline flex items-center gap-1"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                <span className="truncate">{sourceUrl}</span>
                              </a>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              <Card className="bg-slate-900/40 border-primary/40">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Lightbulb className="h-5 w-5 text-primary" />
                    Architecture Recommendation
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-slate-300">
                    {architectureRecommendation ||
                      'Add architecture recommendations in Framework Studio to populate this pane.'}
                  </p>

                  {activeFramework.officialSources.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-wide text-slate-400">
                        Official Sources
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {activeFramework.officialSources.slice(0, 6).map((sourceUrl) => (
                          <a
                            key={sourceUrl}
                            href={sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-primary hover:underline flex items-center gap-1"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            <span className="truncate">{sourceUrl}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>
          </>
        )}
      </main>
    </>
  );
}
