import React from 'react';

/**
 * Renders a cover image with WebP responsive variants when available.
 *
 * Backend (F9 — see Firebase-GCP-Cost-Inventory.md) emits Imagen-4 PNG
 * covers PLUS three WebP variants (640w / 1280w / 2048w) per image. This
 * component opts into `<img srcset>` when those variants exist and falls
 * back to a plain `<img src>` against the original PNG when they don't.
 *
 * Props:
 *   src         – Original PNG URL (always set; fallback for old data)
 *   variants    – Optional { 640, 1280, 2048 } map of WebP URLs. May contain
 *                 nulls for individual widths if their upload failed.
 *   alt         – Accessibility text
 *   sizes       – CSS `sizes` attribute. Default targets a hero/card layout
 *                 that maxes out at ~1280px on desktop and falls to viewport
 *                 width on mobile. Override when used in narrow contexts.
 *   className   – Passed through to <img>
 *   loading     – 'lazy' | 'eager'. Default 'lazy'.
 *   fetchPriority – passthrough
 *   width, height – passthrough (recommended for CLS prevention)
 */
function buildSrcset(variants) {
  if (!variants || typeof variants !== 'object') return null;
  const parts = [];
  // Use string keys because Firestore returns numeric keys as strings.
  const widths = ['640', '1280', '2048'];
  for (const w of widths) {
    const url = variants[w] || variants[Number(w)];
    if (typeof url === 'string' && url.length > 0) {
      parts.push(`${url} ${w}w`);
    }
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

export default function ResponsiveCoverImage({
  src,
  variants,
  alt = '',
  sizes = '(max-width: 768px) 100vw, (max-width: 1280px) 70vw, 1280px',
  className,
  loading = 'lazy',
  fetchPriority,
  width,
  height,
  ...rest
}) {
  if (!src) return null;

  const srcSet = buildSrcset(variants);

  const imgProps = {
    src,
    alt,
    className,
    loading,
    width,
    height,
    ...rest,
  };
  if (fetchPriority) imgProps.fetchPriority = fetchPriority;
  if (srcSet) {
    imgProps.srcSet = srcSet;
    imgProps.sizes = sizes;
  }

  return <img alt={alt} {...imgProps} />;
}
