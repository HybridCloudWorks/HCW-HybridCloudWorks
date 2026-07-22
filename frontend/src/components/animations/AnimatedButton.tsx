/**
 * AnimatedButton Component
 *
 * CTA button with micro-interactions:
 * - Hover scale effect
 * - Click feedback animation
 * - Loading state animation
 *
 * @example
 * ```tsx
 * <AnimatedButton onClick={handleClick}>
 *   Click Me
 * </AnimatedButton>
 * ```
 */

import React, { ReactNode } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';

export interface AnimatedButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  children: ReactNode;
  /**
   * Hover scale effect (0.98 = 2% shrink, 1.05 = 5% grow)
   * @default 1.05
   */
  hoverScale?: number;
  /**
   * Click animation scale
   * @default 0.95
   */
  tapScale?: number;
  /**
   * Show loading spinner
   * @default false
   */
  isLoading?: boolean;
  /**
   * Loading text to show
   */
  loadingText?: string;
}

export function AnimatedButton({
  children,
  hoverScale = 1.05,
  tapScale = 0.95,
  isLoading = false,
  loadingText = 'Loading...',
  className,
  disabled,
  ...props
}: AnimatedButtonProps) {
  const isDisabled = disabled || isLoading;

  return (
    <motion.button
      whileHover={!isDisabled ? { scale: hoverScale } : undefined}
      whileTap={!isDisabled ? { scale: tapScale } : undefined}
      disabled={isDisabled}
      className={className}
      {...props}
    >
      {isLoading ? (
        <span className="flex items-center gap-2">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            className="w-4 h-4 border-2 border-current border-t-transparent rounded-full"
          />
          {loadingText}
        </span>
      ) : (
        children
      )}
    </motion.button>
  );
}
