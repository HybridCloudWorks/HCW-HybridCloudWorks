/**
 * PreviewPage — /preview/:id?t={token} (T-606).
 *
 * The staging view behind the signed link the Telegram approval loop sends:
 * fetches GET public/preview/{id}?t= (the HMAC token is the whole
 * authorization) and renders the article through BlogDetailTemplate in
 * preview mode — noindex, no canonical/OG, no back link, and a status
 * banner in place of the public chrome. The server answers an identical 404
 * for every invalid case, so "not found" here covers bad and expired links
 * alike, on purpose.
 *
 * Deliberately outside ProviderLayout: a preview link must stand alone.
 * Excluded from prerender by construction (scripts/prerender-entry.jsx
 * enumerates routes; nothing enumerates /preview) and disallowed in
 * robots.txt.
 */
import React from 'react';
import { Helmet } from 'react-helmet-async';
import { useParams, useSearchParams } from 'react-router';
import BlogDetailTemplate from '@/components/templates/BlogDetailTemplate';
import { fetchPreviewContentItem } from '@/lib/publicApi';
import { usePublicData } from '@/hooks/usePublicData';
import { Skeleton } from '@/components/performance/Skeleton';

const PROVIDER_KEYS = ['aws', 'azure', 'gcp', 'finops', 'github', 'terraform', 'vmware', 'ansible'];

function providerKeyOf(item) {
  const raw = String(item?.['Cloud Provider'] || item?.cloudProvider || '').toLowerCase();
  if (PROVIDER_KEYS.includes(raw)) return raw;
  if (raw.includes('google')) return 'gcp';
  return 'aws';
}

export default function PreviewPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('t') || '';

  const { data: item, loading } = usePublicData(
    () => fetchPreviewContentItem(id, token),
    id && token ? `preview:${id}:${token}` : ''
  );

  if (loading) {
    return (
      <div className="pt-28 pb-20 px-4 md:px-8 max-w-[1200px] mx-auto w-full">
        <Helmet>
          <meta name="robots" content="noindex, nofollow" />
        </Helmet>
        <Skeleton variant="rect" className="mb-8 h-64 rounded-2xl" />
        <Skeleton variant="heading" className="mb-4 w-3/4" />
        <div className="space-y-3">
          <Skeleton variant="text" />
          <Skeleton variant="text" />
          <Skeleton variant="text" className="w-5/6" />
        </div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <Helmet>
          <title>Preview unavailable | HCW</title>
          <meta name="robots" content="noindex, nofollow" />
        </Helmet>
        <h1 className="text-3xl font-bold mb-4 text-slate-900 dark:text-white">
          Preview unavailable
        </h1>
        <p className="text-slate-700 dark:text-slate-400">
          This preview link is invalid, has expired, or the draft is no longer at a previewable
          stage. Ask for a fresh link.
        </p>
      </div>
    );
  }

  return <BlogDetailTemplate provider={providerKeyOf(item)} previewItem={item} previewMode />;
}
