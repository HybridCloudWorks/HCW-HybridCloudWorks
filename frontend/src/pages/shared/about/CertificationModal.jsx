/**
 * The enlarged badge, over the page, closed by its button, a click outside
 * or Escape (#842). Moved out of AboutPage.jsx on 2026-10-04 unchanged.
 */
import React, { useEffect } from 'react';
import { motion } from 'framer-motion';

export default function CertificationModal({ imageUrl, onClose }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    if (imageUrl) {
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [imageUrl, onClose]);

  if (!imageUrl) return null;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 cursor-pointer"
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.85, opacity: 0 }}
        transition={{ type: 'spring', damping: 20, stiffness: 300 }}
        className="relative cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={imageUrl}
          alt="Enlarged certification badge"
          className="block w-auto h-auto max-w-[min(640px,90vw)] max-h-[80vh] object-contain rounded-lg shadow-2xl"
          onError={(_e) => {
            console.error('Modal image failed to load:', imageUrl);
          }}
        />
        <button
          onClick={onClose}
          className="absolute -top-4 -right-4 text-white bg-black/70 hover:bg-black/90 rounded-full p-2 transition-colors"
          aria-label="Close modal"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </motion.div>
    </motion.div>
  );
}
