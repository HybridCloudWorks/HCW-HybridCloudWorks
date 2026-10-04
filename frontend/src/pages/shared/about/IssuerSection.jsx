/**
 * One issuer's group on the registry: the toggle row and, when expanded, the
 * grid of cards (#842). Moved out of AboutPage.jsx on 2026-10-04 unchanged.
 */
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import CertificationCard from './CertificationCard';

export default function IssuerSection({ issuer, certs, isExpanded, onToggle, onImageClick }) {
  return (
    <div>
      <button
        className="w-full flex items-center gap-3 mb-4 pb-3 border-b border-slate-300/70 dark:border-secondary/40 cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors p-3 rounded-lg text-left group"
        onClick={() => onToggle(issuer)}
      >
        <span className="text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-(--popover-foreground) transition-colors">
          {isExpanded ? (
            <span className="material-symbols-outlined text-[20px]">expand_less</span>
          ) : (
            <span className="material-symbols-outlined text-[20px]">expand_more</span>
          )}
        </span>
        <span className="material-symbols-outlined text-[20px] text-(--subtitle-gray)">
          card_membership
        </span>
        <h3
          className="text-xl text-slate-900 dark:text-white grow select-none"
          style={{ fontFamily: 'Mona Sans, Inter, sans-serif' }}
        >
          {issuer}
        </h3>
        <span className="text-xs bg-slate-200/70 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 px-2.5 py-1 rounded-full font-mono">
          {certs.length}
        </span>
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-4 py-4">
              {certs.map((cert) => (
                <CertificationCard key={cert.id} cert={cert} onImageClick={onImageClick} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
