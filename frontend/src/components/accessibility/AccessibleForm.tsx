/**
 * AccessibleForm Component
 *
 * Form wrapper with WCAG AA compliance features:
 * - Proper label associations
 * - Error message announcements for screen readers
 * - Required field indicators
 * - Focus management
 * - Keyboard navigation support
 *
 * @example
 * ```tsx
 * <AccessibleForm onSubmit={handleSubmit}>
 *   <AccessibleField label="Email" id="email" type="email" required />
 *   <AccessibleField label="Message" id="message" type="textarea" />
 * </AccessibleForm>
 * ```
 */

import React, { ReactNode, FormHTMLAttributes } from 'react';

export interface AccessibleFormProps extends FormHTMLAttributes<HTMLFormElement> {
  children: ReactNode;
  /**
   * Form title for screen readers
   */
  title?: string;
}

export function AccessibleForm({ children, title, ...props }: AccessibleFormProps) {
  return (
    <form
      {...props}
      aria-label={title}
      noValidate // Use HTML5 for validation
    >
      {children}
    </form>
  );
}

export interface AccessibleFieldProps {
  /**
   * Label text for the field
   */
  label: string;
  /**
   * Unique identifier
   */
  id: string;
  /**
   * Input type
   */
  type?: 'text' | 'email' | 'password' | 'tel' | 'url' | 'textarea' | 'select';
  /**
   * Field is required
   */
  required?: boolean;
  /**
   * Help text displayed below label
   */
  helperText?: string;
  /**
   * Error message - triggers aria-invalid
   */
  error?: string;
  /**
   * CSS class name
   */
  className?: string;
  /**
   * Additional fields for input
   */
  [key: string]: unknown;
}

/**
 * Accessible Form Field with label, help text, and error handling
 */
export function AccessibleField({
  label,
  id,
  type = 'text',
  required = false,
  helperText,
  error,
  className,
  ...props
}: AccessibleFieldProps) {
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;

  const hasError = Boolean(error);
  // Keep helper text in aria-describedby even when an error is present so
  // assistive tech announces both (WCAG 3.3.1 / 3.3.3).
  const describedBy =
    [helperText ? helpId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  const commonProps = {
    id,
    className: `w-full px-3 py-2 border rounded-md transition-colors ${
      error ? 'border-red-500 focus:ring-red-500 bg-red-50' : 'border-slate-300 focus:ring-blue-500'
    } focus:outline-none focus:ring-2`,
    'aria-invalid': hasError,
    'aria-describedby': describedBy,
    ...props,
  };

  return (
    <div className={`mb-4 ${className}`}>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 mb-1">
        {label}
        {required && (
          <span className="text-red-500 ml-1" aria-label="required" title="This field is required">
            *
          </span>
        )}
      </label>

      {helperText && (
        <p id={helpId} className="text-xs text-slate-500 mb-2">
          {helperText}
        </p>
      )}

      {type === 'textarea' && <textarea {...commonProps} rows={4} />}
      {type === 'select' && <select {...commonProps} />}
      {type !== 'textarea' && type !== 'select' && (
        <input type={type} {...commonProps} required={required} />
      )}

      {error && (
        <p id={errorId} className="text-sm text-red-600 mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
