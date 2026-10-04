/**
 * One certification on the About page's registry (#842). Moved out of
 * AboutPage.jsx on 2026-10-04 unchanged.
 */
import React from 'react';
import { motion } from 'framer-motion';
import { resolveMediaUrl } from '@/lib/functionsBase';

const RETIRED_FLAGS = ['certState', 'is_valid', 'isValid', 'cert_state'];
/** A row any of its validity spellings marks false. */
const isRetiredCert = (cert) =>
  RETIRED_FLAGS.some(
    (key) => Object.prototype.hasOwnProperty.call(cert, key) && cert[key] === false
  );

const formatDate = (date) =>
  date
    ? date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : 'N/A';

/** The date line: the expiry when there is one, past or future, else the issue date. */
function certDates(cert) {
  const expDate = cert.exp_date ? new Date(cert.exp_date) : null;
  const issueDate = cert.issue_date ? new Date(cert.issue_date) : null;
  const isExpired = expDate && expDate < new Date();
  if (!expDate) return { isExpired, dateLabel: 'Valid since', dateValue: formatDate(issueDate) };
  return {
    isExpired,
    dateLabel: isExpired ? 'Expired on' : 'Valid until',
    dateValue: formatDate(expDate),
  };
}

const CertificationCard = ({ cert, onImageClick }) => {
  const isRetired = isRetiredCert(cert);
  const { isExpired, dateLabel, dateValue } = certDates(cert);

  let statusClass = '';
  if (isRetired) statusClass = 'cert-retired';
  else if (isExpired) statusClass = 'cert-expired';

  return (
    <motion.div
      whileHover={{ y: -5, scale: 1.02 }}
      className={`certification-technical-card p-4 rounded-2xl flex flex-col group relative overflow-hidden h-full ${statusClass}`}
    >
      {(isRetired || isExpired) && (
        <div className="cert-watermark text-slate-500 dark:text-slate-400">
          {isRetired ? 'Retired' : 'Expired'}
        </div>
      )}

      {!isRetired && !isExpired && (
        <div className="absolute -right-4 -top-4 opacity-[0.03] dark:opacity-[0.05] group-hover:opacity-[0.08] transition-opacity pointer-events-none">
          <span className="material-symbols-outlined text-[100px] rotate-12">verified</span>
        </div>
      )}

      <div className="flex items-start justify-between gap-4 mb-4 relative z-10">
        {cert.image_url ? (
          <div className="relative">
            <div className="absolute inset-0 bg-white/20 dark:bg-white/5 blur-md rounded-full"></div>
            <button
              type="button"
              onClick={() => onImageClick(cert.image_url)}
              className="cert-badge-container relative shrink-0 w-20 h-20 flex items-center justify-center p-2 rounded-xl border border-white/40 dark:border-white/10 hover:scale-110 transition-transform cursor-pointer overflow-hidden"
              aria-label={`View badge for ${cert.name}`}
            >
              <img
                src={resolveMediaUrl(cert.image_url)}
                alt={`${cert.issuer} badge`}
                loading="lazy"
                decoding="async"
                className={`w-full h-full object-contain drop-shadow-sm ${isRetired || isExpired ? 'grayscale opacity-60' : ''}`}
                onError={(e) => {
                  console.error('Image load failed for:', cert.name, cert.image_url);
                  e.target.style.opacity = '0.5';
                  e.target.setAttribute('alt', 'Image Failed');
                }}
              />
            </button>
          </div>
        ) : (
          <div className="w-20 h-20 bg-slate-100 dark:bg-slate-800 rounded-xl flex items-center justify-center border border-slate-200 dark:border-slate-700">
            <span className="material-symbols-outlined text-slate-400">image_not_supported</span>
          </div>
        )}
        <div className="flex flex-col items-end gap-1.5" />
      </div>

      <div className="space-y-2 relative z-10 grow">
        <h4 className="text-slate-900 dark:text-white font-bold text-xs tracking-tight leading-snug group-hover:text-accent-blue transition-colors line-clamp-2 min-h-[2.5em]">
          {cert.name}
        </h4>
        <div className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500 dark:text-slate-400">
          <span className="material-symbols-outlined text-[12px]">calendar_today</span>
          <span className="font-mono">
            {dateLabel}: {dateValue}
          </span>
        </div>
      </div>

      <div className="mt-3 pt-2.5 flex items-center justify-between border-t border-slate-300/70 dark:border-slate-700/50 relative z-10">
        {cert.verify_url ? (
          <a
            href={cert.verify_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors"
            aria-label={`Verify ${cert.name}`}
          >
            <span className="material-symbols-outlined text-[16px]">check_box</span>
          </a>
        ) : (
          <span
            className="flex items-center gap-1 text-[10px] font-bold text-slate-400 dark:text-slate-400"
            aria-label={`Verification unavailable for ${cert.name}`}
          >
            <span className="material-symbols-outlined text-[16px]">check_box</span>
          </span>
        )}

        {cert.code && (
          <div className="text-[10px] font-mono font-bold text-slate-400 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/50 px-1.5 py-0.5 rounded">
            {cert.code}
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default CertificationCard;
