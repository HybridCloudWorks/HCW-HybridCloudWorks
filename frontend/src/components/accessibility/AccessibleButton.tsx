/**
 * AccessibleButton Component
 *
 * WCAG AA compliant button with:
 * - Proper focus indicators (visible keyboard focus)
 * - Color contrast ratios meeting WCAG AA
 * - Proper ARIA labels for icon buttons
 * - Keyboard navigation support (Enter, Space)
 *
 * @example
 * ```tsx
 * <AccessibleButton aria-label="Close dialog" onClick={onClose}>
 *   <X size={24} />
 * </AccessibleButton>
 *
 * <AccessibleButton variant="primary">
 *   Submit Form
 * </AccessibleButton>
 * ```
 */

import React, { ButtonHTMLAttributes, ReactNode } from 'react';

export interface AccessibleButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Button text or icon
   */
  children: ReactNode;
  /**
   * Button style variant
   */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /**
   * Button size
   */
  size?: 'sm' | 'md' | 'lg';
  /**
   * Full width button
   */
  fullWidth?: boolean;
  /**
   * Icon-only button (requires aria-label)
   */
  isIconOnly?: boolean;
}

const variantStyles = {
  primary: 'bg-primary text-white hover:bg-primary/90 active:bg-primary/80 disabled:bg-slate-300',
  secondary:
    'bg-slate-200 text-slate-900 hover:bg-slate-300 active:bg-slate-400 disabled:bg-slate-100',
  ghost:
    'bg-transparent text-slate-700 hover:bg-slate-100 active:bg-slate-200 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 disabled:bg-slate-300',
};

const sizeStyles = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-base',
  lg: 'px-6 py-3 text-lg',
};

export function AccessibleButton({
  children,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  isIconOnly = false,
  className,
  ...props
}: AccessibleButtonProps) {
  // Ensure icon-only buttons have aria-label
  if (isIconOnly && !props['aria-label']) {
    console.warn('Icon-only buttons must have an aria-label for accessibility');
  }

  return (
    <button
      className={`
        inline-flex items-center justify-center
        font-medium rounded-md
        transition-colors duration-200
        focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary/50
        disabled:cursor-not-allowed disabled:opacity-50
        ${variantStyles[variant]}
        ${sizeStyles[size]}
        ${fullWidth ? 'w-full' : ''}
        ${isIconOnly ? 'p-2' : ''}
        ${className || ''}
      `}
      {...props}
    >
      {children}
    </button>
  );
}
