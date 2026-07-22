import React, { useEffect, useState } from 'react';

const PREFERS_REDUCED_MOTION =
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function HeroImageCarousel({
  images,
  intervalMs = 3000,
  fadeMs = 800,
  alt = '',
  className = '',
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (PREFERS_REDUCED_MOTION || images.length <= 1) return undefined;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % images.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [images.length, intervalMs]);

  if (!images || images.length === 0) return null;

  return (
    <div className={`absolute inset-0 ${className}`} aria-label={alt} role="img">
      {images.map((src, i) => (
        <img
          key={src}
          src={src}
          alt=""
          aria-hidden="true"
          loading={i === 0 ? 'eager' : 'lazy'}
          className="absolute inset-0 w-full h-full object-cover transition-opacity ease-in-out"
          style={{
            opacity: i === index ? 1 : 0,
            transitionDuration: `${fadeMs}ms`,
          }}
        />
      ))}
    </div>
  );
}
