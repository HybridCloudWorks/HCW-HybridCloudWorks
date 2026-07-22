import React from 'react';
import { Helmet } from 'react-helmet-async';
import { ScrollTrigger, StaggerList } from '@/components/animations';
import { AccessibleButton } from '@/components/accessibility';
import { useNavigate, useParams } from 'react-router-dom';
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
  const navigate = useNavigate();
  const { provider = 'aws' } = useParams();

  // Fetch dynamic blueprints from Content Forge
  const { data: contentDocs, loading: contentLoading } = useFirestoreQuery('content', [
    where('type', '==', 'architecture'),
  ]);

  const contentBlueprints = (contentDocs || [])
    .filter(
      (doc) =>
        isPublicDocument(doc) &&
        (doc.cloudProvider || doc['Cloud Provider'] || 'aws').toLowerCase() ===
          provider.toLowerCase()
    )
    .map((doc) => ({
      icon: 'architecture', // default icon
      category: doc.category || 'General',
      categoryColor: 'purple', // default color
      title: doc.title || doc.Title,
      slug: doc.slug,
      description: doc.summary || doc.Summary,
      rpo: 'N/A', // Dynamic fields might need extension or manual entry
      rto: 'N/A',
      level: mapComplexityToLevel(doc.complexity),
      cost: doc.costAnalysis?.estimatedMonthly || 'TBD',
      costColor: 'green',
    }));

  const shouldLoadLegacy = !contentLoading && contentBlueprints.length === 0;
  const { data: dynamicDocs } = useFirestoreQuery(shouldLoadLegacy ? 'blogs' : '', [
    where('type', '==', 'architecture'),
  ]);

  const dynamicBlueprints =
    contentBlueprints.length > 0
      ? contentBlueprints
      : (dynamicDocs || [])
          .filter(
            (doc) =>
              isPublicDocument(doc) &&
              (doc.cloudProvider || doc['Cloud Provider'] || 'aws').toLowerCase() ===
                provider.toLowerCase()
          )
          .map((doc) => ({
            icon: 'architecture', // default icon
            category: doc.category || 'General',
            categoryColor: 'purple', // default color
            title: doc.title || doc.Title,
            slug: doc.slug,
            description: doc.summary || doc.Summary,
            rpo: 'N/A', // Dynamic fields might need extension or manual entry
            rto: 'N/A',
            level: mapComplexityToLevel(doc.complexity),
            cost: doc.costAnalysis?.estimatedMonthly || 'TBD',
            costColor: 'green',
          }));

  const staticBlueprints = [
    {
      icon: 'public',
      category: 'Networking',
      categoryColor: 'blue',
      title: 'Global Load Balancing',
      slug: 'global-load-balancing',
      description:
        'High-availability routing using ELB and Route 53 with multi-region failover and health checks.',
      rpo: '< 1 min',
      rto: '< 5 min',
      level: '300',
      cost: '$1.2k/mo',
      costColor: 'blue',
    },
    {
      icon: 'rebase_edit',
      category: 'Disaster Recovery',
      categoryColor: 'red',
      title: 'Multi-Region DR',
      slug: 'multi-region-dr',
      description:
        'Active-Passive setup using RDS Aurora Global Database and S3 Cross-Region Replication for mission-critical apps.',
      rpo: '< 15 min',
      rto: '< 30 min',
      level: '400',
      cost: '$3.8k/mo',
      costColor: 'red',
    },
    {
      icon: 'hub',
      category: 'Containers',
      categoryColor: 'orange',
      title: 'Container Orchestration',
      slug: 'container-orchestration',
      description:
        'Modern microservices deployment on ECS Fargate with automated scaling and service discovery.',
      rpo: 'N/A',
      rto: '< 5 min',
      level: '300',
      cost: '$2.2k/mo',
    },
    {
      icon: 'api',
      category: 'Serverless',
      categoryColor: 'blue',
      title: 'Serverless API',
      slug: 'serverless-api',
      description:
        'Cost-optimized event-driven backend using Lambda, API Gateway, and DynamoDB for massive scale.',
      rpo: 'Real-time',
      rto: 'N/A',
      level: '200',
      cost: '$400/mo',
      costColor: 'green',
    },
    {
      icon: 'database',
      category: 'Analytics',
      categoryColor: 'purple',
      title: 'Data Lake Architecture',
      slug: 'data-lake',
      description:
        'Scalable data storage and analytics pipeline using S3, Glue, and Athena for serverless queries.',
      rpo: '24 hr',
      rto: '4 hr',
      level: '300',
      cost: '$800/mo',
      costColor: 'green',
    },
    {
      icon: 'settings_input_component',
      category: 'Connectivity',
      categoryColor: 'blue',
      title: 'Hybrid Connectivity',
      slug: 'hybrid-connectivity',
      description:
        'Secure enterprise connection via Direct Connect and Transit Gateway for hybrid cloud workloads.',
      rpo: 'N/A',
      rto: 'Immediate',
      level: '400',
      cost: '$2.4k/mo',
    },
  ];

  const blueprints = [...dynamicBlueprints, ...staticBlueprints];

  return (
    <>
      <Helmet>
        <title>AWS Architecture Designs | Hybrid Cloud Works</title>
        <meta
          name="description"
          content="Explore curated AWS architectural patterns and reference designs."
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
                placeholder="E.g., Global, DR, Serverless..."
                aria-label="E.g., Global, DR, Serverless..."
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
                  {['Serverless', 'Containers', 'Compute', 'Database', 'Networking'].map((item) => (
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
                  {[
                    'Migration',
                    'Disaster Recovery',
                    'Analytics',
                    'Connectivity',
                    'FinOps & Cost',
                  ].map((item) => (
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
            </div>
            <div className="mt-8 pt-6 border-t border-border-dark">
              <AccessibleButton variant="secondary" size="md" fullWidth>
                Reset Filters
              </AccessibleButton>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <div className="xl:col-span-9 flex flex-col gap-8 order-1 xl:order-2">
          {/* Header */}
          <div className="flex flex-col gap-2 relative">
            <div className="absolute -top-10 -left-10 w-64 h-64 bg-primary/5 rounded-full blur-3xl pointer-events-none"></div>
            <div className="flex flex-wrap items-baseline gap-4 relative z-10">
              <h1 className="text-2xl sm:text-4xl md:text-5xl font-black tracking-tight text-slate-900 dark:text-white">
                AWS Architectural <span className="text-aws-primary">Patterns</span> & Designs
              </h1>
            </div>
            <p className="text-slate-700 dark:text-slate-400 text-base sm:text-lg max-w-3xl relative z-10">
              Explore a curated library of battle-tested AWS solutions. From serverless event-driven
              architectures to multi-region active-active deployments.
            </p>
          </div>

          {/* Featured Blueprint */}
          <ScrollTrigger animation="slideUp" duration={0.7} className="w-full">
            <div className="glass-panel orange-glow rounded-2xl overflow-hidden relative group">
              <div className="absolute top-0 right-0 p-4 z-20">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary text-black text-xs font-bold uppercase tracking-wide shadow-lg shadow-primary/20">
                  <span className="material-symbols-outlined text-[16px]">star</span> Featured
                  Design
                </span>
              </div>
              <div className="grid md:grid-cols-2 gap-0">
                <div className="p-8 md:p-10 flex flex-col justify-center relative z-10">
                  <div className="flex items-center gap-2 mb-4 text-primary font-mono text-xs">
                    <span className="material-symbols-outlined text-[14px]">rebase_edit</span>
                    DISASTER RECOVERY • LEVEL 400
                  </div>
                  <h2 className="text-3xl font-bold text-white mb-4 leading-tight">
                    Multi-Region DR Blueprint
                  </h2>
                  <p className="text-slate-300 text-sm leading-relaxed mb-6">
                    Maintain business continuity with an Active-Passive disaster recovery approach.
                    Using RDS Aurora Global Database and S3 Cross-Region Replication to ensure data
                    persistence with RPO under 15 minutes.
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
                        public
                      </span>
                      Global Availability
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <AccessibleButton
                      variant="primary"
                      size="md"
                      className="flex items-center gap-2"
                      onClick={() => navigate(`/${provider}/architecture-designs/multi-region-dr`)}
                    >
                      Explore Blueprint
                      <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
                    </AccessibleButton>
                    <AccessibleButton variant="ghost" size="md" className="flex items-center gap-2">
                      <span className="material-symbols-outlined">play_circle</span>
                      Watch Demo
                    </AccessibleButton>
                  </div>
                </div>
                <div className="bg-gradient-to-br from-[hsl(var(--hcw-bg-secondary))] to-[hsl(var(--background))] relative overflow-hidden flex items-center justify-center p-8 border-l border-white/5">
                  <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-5"></div>
                  <div className="absolute -right-20 -bottom-20 w-64 h-64 bg-primary/10 rounded-full blur-3xl"></div>
                  <div className="relative w-full aspect-video rounded-lg overflow-hidden border border-border-dark shadow-2xl transform rotate-1 transition-transform group-hover:rotate-0 duration-500">
                    <div className="w-full h-full flex items-center justify-center bg-[hsl(var(--background))]">
                      <span className="material-symbols-outlined text-slate-600 text-[64px]">
                        rebase_edit
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </ScrollTrigger>

          {/* Blueprint Gallery */}
          <div>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <span className="w-1 h-6 bg-primary rounded-full"></span>
                Blueprint Gallery
              </h3>
              <div className="flex items-center gap-2 text-sm text-slate-400 bg-card-dark rounded-lg p-1 border border-border-dark">
                <AccessibleButton variant="primary" size="sm" className="px-3 py-1">
                  Grid
                </AccessibleButton>
                <AccessibleButton variant="ghost" size="sm" className="px-3 py-1">
                  List
                </AccessibleButton>
              </div>
            </div>
            <StaggerList
              staggerDelay={0.08}
              duration={0.6}
              animation="slideUp"
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
            >
              {blueprints.map((blueprint, idx) => (
                <div
                  key={idx}
                  className="bg-card-dark rounded-xl border border-border-dark overflow-hidden hover:border-primary/50 transition-all hover:shadow-[0_0_20px_-10px_rgba(var(--primary-rgb,255,153,0),0.3)] group flex flex-col h-full"
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
                    <AccessibleButton
                      variant="secondary"
                      size="md"
                      fullWidth
                      className="flex items-center justify-center gap-2"
                      onClick={() =>
                        navigate(`/${provider}/architecture-designs/${blueprint.slug}`)
                      }
                    >
                      Start Deep Dive
                      <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                    </AccessibleButton>
                  </div>
                </div>
              ))}
            </StaggerList>
          </div>
        </div>
      </main>
    </>
  );
}
