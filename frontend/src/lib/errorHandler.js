import { toast } from '@/components/ui/use-toast';

export function handleFirestoreError(error, context = '') {
  console.error(`Firestore error ${context}:`, error);

  const userMessage =
    {
      'permission-denied': 'You do not have permission to perform this action.',
      'not-found': 'The requested data was not found.',
      unavailable: 'Service temporarily unavailable. Please try again.',
      unauthenticated: 'Please sign in to continue.',
      cancelled: 'Operation was cancelled.',
      'deadline-exceeded': 'Request timed out. Please try again.',
    }[error.code] || 'An unexpected error occurred. Please try again.';

  toast({
    variant: 'destructive',
    title: 'Error',
    description: userMessage,
  });
}

export function handleNetworkError(error, context = '') {
  console.error(`Network error ${context}:`, error);

  toast({
    variant: 'destructive',
    title: 'Connection Error',
    description: 'Unable to connect. Please check your internet connection.',
  });
}
