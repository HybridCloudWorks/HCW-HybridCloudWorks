/**
 * Accessibility Components Library
 *
 * WCAG AA compliant components for ensuring accessible UI
 *
 * Re-exports:
 * import { AccessibleForm, AccessibleField, AccessibleButton, SkipToMainContent } from '@/components/accessibility';
 */

export {
  AccessibleForm,
  AccessibleField,
  type AccessibleFormProps,
  type AccessibleFieldProps,
} from './AccessibleForm';
export { AccessibleButton, type AccessibleButtonProps } from './AccessibleButton';
export { SkipToMainContent, type SkipToMainContentProps } from './SkipToMainContent';
