import React from 'react';
import { Helmet } from 'react-helmet-async';
import { useFirestoreQuery } from '@/hooks/useFirestore';
import { where } from 'firebase/firestore';

function isPublicDocument(doc = {}) {
  const status = String(doc.contentStatus || '');
  return doc.Live === true || status.startsWith('published_') || doc.Status === 'Live';
}

function mapComplexityToLevel(complexity) {
  if (complexity === 'High') return '400';
  if (complexity === 'Medium') return '300';
  return '200';
}

export default function ArchitecturePage() {
  const { data: contentDocs, loading: contentLoading } = useFirestoreQuery('content', [
    where('type', '==', 'architecture'),
  ]);

  const contentBlueprints = (contentDocs || [])
    .filter(
      (doc) =>
        isPublicDocument(doc) &&
        (doc.cloudProvider || doc['Cloud Provider'] || 'azure').toLowerCase() === 'azure'
    )
    .map((doc) => ({
      icon: doc.icon || 'architecture',
      category: doc.category || 'General',
      categoryColor: doc.categoryColor || 'blue',
      title: doc.title || doc.Title || 'Untitled Blueprint',
      description: doc.summary || doc.Summary || doc.description || '',
      rpo: doc.rpo || doc.RPO || 'N/A',
      rto: doc.rto || doc.RTO || 'N/A',
      level: doc.level || mapComplexityToLevel(doc.complexity),
      cost: doc.costAnalysis?.estimatedMonthly || doc.cost || 'TBD',
      costColor: doc.costColor || 'green',
    }));

  const shouldLoadLegacy = !contentLoading && contentBlueprints.length === 0;
  const { data: dynamicDocs } = useFirestoreQuery(shouldLoadLegacy ? 'blogs' : '', [
    where('type', '==', 'architecture'),
  ]);

  const staticBlueprints = [
    {
      icon: 'hub',
      category: 'Networking',
      categoryColor: 'blue',
      title: 'Enterprise Hub-and-Spoke Landing Zone',
      description:
        'Reference architecture for centralized connectivity, policy-driven segmentation, and shared security services across enterprise subscriptions.',
      rpo: '< 15 min',
      rto: '< 1 hr',
      level: '400',
      cost: '$2.1k/mo',
    },
    {
      icon: 'cloud_sync',
      category: 'Migration',
      categoryColor: 'purple',
      title: 'Azure VMware Estate Migration',
      description:
        'Phased migration blueprint using Azure VMware Solution, Recovery Services, and dependency mapping for low-risk cutovers.',
      rpo: '24 hr',
      rto: '4 hr',
      level: '200',
      cost: '$1.4k/mo',
      costColor: 'green',
    },
    {
      icon: 'monitoring',
      category: 'FinOps',
      categoryColor: 'green',
      title: 'FinOps Guardrails for Azure Subscriptions',
      description:
        'Policy and budget-control pattern with Cost Management exports, Azure Policy enforcement, and automated anomaly alerts.',
      rpo: '1 hr',
      rto: '2 hr',
      level: '300',
      cost: '$950/mo',
      costColor: 'green',
    },
    {
      icon: 'database',
      category: 'Database',
      categoryColor: 'orange',
      title: 'Global Data Tier with Cosmos DB + SQL',
      description:
        'Multi-region data architecture combining Cosmos DB and Azure SQL with geo-replication and strict consistency controls.',
      rpo: '< 1s',
      rto: '< 1 min',
      level: '400',
      cost: '$3.2k/mo',
    },
    {
      icon: 'security',
      category: 'Security',
      categoryColor: 'red',
      title: 'Zero Trust Identity Control Plane',
      description:
        'Identity-first architecture using Entra ID, Conditional Access, PIM, and Defender for Cloud to enforce least privilege at scale.',
      rpo: 'N/A',
      rto: 'N/A',
      level: '300',
      cost: '$780/mo',
      costColor: 'green',
    },
    {
      icon: 'api',
      category: 'Serverless',
      categoryColor: 'blue',
      title: 'Event-Driven Serverless Integration Mesh',
      description:
        'Serverless integration pattern based on Event Grid, Functions, and Service Bus for near real-time distributed workflows.',
      rpo: '< 5 min',
      rto: 'Immediate',
      level: '200',
      cost: '$420/mo',
      costColor: 'green',
    },
  ];

  const dynamicBlueprints =
    contentBlueprints.length > 0
      ? contentBlueprints
      : (dynamicDocs || [])
          .filter(
            (doc) =>
              isPublicDocument(doc) &&
              (doc.cloudProvider || doc['Cloud Provider'] || 'azure').toLowerCase() === 'azure'
          )
          .map((doc) => ({
            icon: doc.icon || 'architecture',
            category: doc.category || 'General',
            categoryColor: doc.categoryColor || 'blue',
            title: doc.title || doc.Title || 'Untitled Blueprint',
            description: doc.summary || doc.Summary || doc.description || '',
            rpo: doc.rpo || doc.RPO || 'N/A',
            rto: doc.rto || doc.RTO || 'N/A',
            level: doc.level || mapComplexityToLevel(doc.complexity),
            cost: doc.costAnalysis?.estimatedMonthly || doc.cost || 'TBD',
            costColor: doc.costColor || 'green',
          }));

  const blueprints = [...dynamicBlueprints, ...staticBlueprints];

  return (
    <>
      <Helmet>
        <title>Architecture Designs | Hybrid Cloud Works</title>
        <meta
          name="description"
          content="Explore curated architectural patterns and reference designs."
        />
      </Helmet>

      <main className="flex-grow max-w-[1440px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-1 xl:grid-cols-12 gap-8">
        {/* Sidebar */}
        <aside className="xl:col-span-3 flex flex-col gap-6 order-2 xl:order-1">
          <div className="glass-panel rounded-xl p-5 sticky top-24">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[18px]">search</span>
              Find Blueprints
            </h3>
            <div className="relative mb-6">
              <input
                className="w-full bg-[hsl(var(--background))] border border-border-dark rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:ring-1 focus:ring-primary focus:border-primary transition-all"
                placeholder="E.g., Event-driven, Landing zone..."
                aria-label="E.g., Event-driven, Landing zone..."
                type="text"
              />
              <span className="absolute right-3 top-2.5 text-slate-500 material-symbols-outlined text-[18px]">
                manage_search
              </span>
            </div>
            <div className="h-px bg-border-dark mb-6"></div>
            <div className="space-y-6">
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">
                  Workload Type
                </h4>
                <div className="space-y-2">
                  {['Serverless', 'Containers', 'Compute', 'Database'].map((item) => (
                    <label key={item} className="flex items-center gap-3 cursor-pointer group">
                      <input
                        className="rounded border-slate-700 bg-[hsl(var(--background))] text-primary focus:ring-primary/50 focus:ring-offset-0"
                        type="checkbox"
                        aria-label={`Select ${item}`}
                      />
                      <span className="text-sm text-slate-300 group-hover:text-white transition-colors">
                        {item}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">
                  Use Case
                </h4>
                <div className="space-y-2">
                  {['Migration', 'FinOps & Cost', 'Disaster Recovery', 'Machine Learning'].map(
                    (item) => (
                      <label key={item} className="flex items-center gap-3 cursor-pointer group">
                        <input
                          className="rounded border-slate-700 bg-[hsl(var(--background))] text-primary focus:ring-primary/50 focus:ring-offset-0"
                          type="checkbox"
                          aria-label={`Select ${item}`}
                        />
                        <span className="text-sm text-slate-300 group-hover:text-white transition-colors">
                          {item}
                        </span>
                      </label>
                    )
                  )}
                </div>
              </div>
            </div>
            <div className="mt-8 pt-6 border-t border-border-dark">
              <button
                className="w-full h-11 bg-primary hover:bg-primary/90 text-foreground text-sm font-bold uppercase rounded border border-primary/80 transition-colors"
                aria-label="Reset all filters"
              >
                Reset Filters
              </button>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <div className="xl:col-span-9 flex flex-col gap-8 order-1 xl:order-2">
          {/* Header */}
          <div className="flex flex-col gap-2 relative">
            <div className="absolute -top-10 -left-10 w-64 h-64 bg-primary/5 rounded-full blur-3xl pointer-events-none"></div>
            <div className="flex flex-wrap items-baseline gap-4 relative z-10">
              <h1 className="text-2xl sm:text-4xl md:text-5xl font-black tracking-tight text-white">
                Architectural <span className="text-primary">Patterns</span> & Designs
              </h1>
            </div>
            <p className="text-slate-400 text-base sm:text-lg max-w-3xl relative z-10">
              Explore a curated library of battle-tested solutions. From serverless event-driven
              architectures to multi-region active-active deployments.
            </p>
          </div>

          {/* Featured Blueprint */}
          <div className="glass-panel orange-glow rounded-2xl overflow-hidden relative group">
            <div className="absolute top-0 right-0 p-4 z-20">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary text-black text-xs font-bold uppercase tracking-wide shadow-lg shadow-primary/20">
                <span className="material-symbols-outlined text-[16px]">star</span> Featured Design
              </span>
            </div>
            <div className="grid md:grid-cols-2 gap-0">
              <div className="p-8 md:p-10 flex flex-col justify-center relative z-10">
                <div className="flex items-center gap-2 mb-4 text-primary font-mono text-xs">
                  <span className="material-symbols-outlined text-[14px]">bolt</span>
                  MISSION-CRITICAL • LEVEL 400
                </div>
                <h2 className="text-3xl font-bold text-white mb-4 leading-tight">
                  Enterprise Hub-and-Spoke with Zero Trust Edge
                </h2>
                <p className="text-slate-300 text-sm leading-relaxed mb-6">
                  Centralize connectivity, security controls, and policy enforcement while enabling
                  autonomous landing zones for workload teams across multiple Azure subscriptions.
                </p>
                <div className="flex flex-wrap gap-4 mb-8">
                  <div className="flex items-center gap-2 text-xs text-slate-400 bg-black/20 px-3 py-1.5 rounded-lg border border-white/5">
                    <span className="material-symbols-outlined text-green-500 text-[16px]">
                      verified
                    </span>
                    Production Ready
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-400 bg-black/20 px-3 py-1.5 rounded-lg border border-white/5">
                    <span className="material-symbols-outlined text-blue-400 text-[16px]">
                      savings
                    </span>
                    Pay-per-use
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <button
                    className="bg-primary hover:bg-primary-light text-black font-bold px-6 h-11 rounded-lg transition-all shadow-lg shadow-primary/20 flex items-center gap-2 group-hover:scale-105 transform duration-200"
                    aria-label="Explore featured blueprint"
                  >
                    Explore Blueprint
                    <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                      arrow_forward
                    </span>
                  </button>
                  <button
                    className="text-slate-300 hover:text-white font-medium px-4 h-11 flex items-center gap-2 transition-colors"
                    aria-label="Watch blueprint demo"
                  >
                    <span className="material-symbols-outlined" aria-hidden="true">
                      play_circle
                    </span>
                    Watch Demo
                  </button>
                </div>
              </div>
              <div className="bg-gradient-to-br from-[hsl(var(--hcw-bg-secondary))] to-[hsl(var(--background))] relative overflow-hidden flex items-center justify-center p-8 border-l border-white/5">
                <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-5"></div>
                <div className="absolute -right-20 -bottom-20 w-64 h-64 bg-primary/10 rounded-full blur-3xl"></div>
                <div className="relative w-full aspect-video rounded-lg overflow-hidden border border-border-dark shadow-2xl transform rotate-1 transition-transform group-hover:rotate-0 duration-500">
                  <div className="w-full h-full flex items-center justify-center bg-[hsl(var(--background))]">
                    <span className="material-symbols-outlined text-slate-600 text-[64px]">
                      hub
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Blueprint Gallery */}
          <div>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <span className="w-1 h-6 bg-primary rounded-full"></span>
                Blueprint Gallery
              </h3>
              <div
                className="flex items-center gap-2 text-sm text-slate-400 bg-card-dark rounded-lg p-1 border border-border-dark"
                role="group"
                aria-label="View mode"
              >
                <button
                  className="px-3 py-1 bg-slate-700 text-white rounded shadow-sm transition-colors"
                  aria-pressed="true"
                >
                  Grid
                </button>
                <button
                  className="px-3 py-1 hover:text-white transition-colors"
                  aria-pressed="false"
                >
                  List
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {blueprints.map((blueprint, idx) => (
                <div
                  key={idx}
                  className="bg-card-dark rounded-xl border border-border-dark overflow-hidden hover:border-primary/50 transition-all hover:shadow-[0_0_20px_-10px_rgba(0,0,0,0.2)] group flex flex-col h-full"
                >
                  <div className="aspect-[16/9] bg-[hsl(var(--background))] relative border-b border-border-dark p-4 group-hover:bg-[hsl(var(--hcw-bg-secondary))] transition-colors flex items-center justify-center">
                    <span className="material-symbols-outlined text-slate-600 text-[48px] group-hover:text-primary transition-colors duration-300">
                      {blueprint.icon}
                    </span>
                    <div className="absolute bottom-2 right-2 bg-black/60 backdrop-blur px-2 py-0.5 rounded text-[10px] text-white border border-slate-700">
                      SVG View
                    </div>
                  </div>
                  <div className="p-5 flex flex-col flex-grow">
                    <div className="flex justify-between items-start mb-2">
                      <div
                        className={`px-2 py-0.5 rounded bg-${blueprint.categoryColor}-500/10 border border-${blueprint.categoryColor}-500/20 text-${blueprint.categoryColor}-400 text-[10px] font-bold uppercase tracking-wide`}
                      >
                        {blueprint.category}
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-slate-400">
                        <span
                          className={`material-symbols-outlined text-[12px] text-${blueprint.costColor || 'primary'}`}
                        >
                          attach_money
                        </span>
                        <span>{blueprint.cost}</span>
                      </div>
                    </div>
                    <h3 className="text-white font-bold text-lg mb-2 group-hover:text-primary transition-colors">
                      {blueprint.title}
                    </h3>
                    <p className="text-slate-400 text-sm mb-4">{blueprint.description}</p>
                    <div className="flex gap-4 mb-4 text-xs text-slate-400 font-mono border-y border-border-dark py-2 mt-auto">
                      <div className="flex flex-col">
                        <span className="text-slate-500 text-[10px]">RPO</span>
                        <span>{blueprint.rpo}</span>
                      </div>
                      <div className="w-px bg-border-dark"></div>
                      <div className="flex flex-col">
                        <span className="text-slate-500 text-[10px]">RTO</span>
                        <span>{blueprint.rto}</span>
                      </div>
                      <div className="w-px bg-border-dark"></div>
                      <div className="flex flex-col">
                        <span className="text-slate-500 text-[10px]">Level</span>
                        <span>{blueprint.level}</span>
                      </div>
                    </div>
                    <button
                      className="w-full mt-auto h-11 rounded-lg bg-primary text-foreground hover:bg-primary/90 hover:text-black font-medium text-sm transition-all flex items-center justify-center gap-2 group/btn"
                      aria-label={`Start deep dive for ${blueprint.title}`}
                    >
                      Start Deep Dive
                      <span
                        className="material-symbols-outlined text-[16px] group-hover/btn:translate-x-1 transition-transform"
                        aria-hidden="true"
                      >
                        arrow_forward
                      </span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
