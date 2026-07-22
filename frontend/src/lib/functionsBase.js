import { getAzureFunctionsUrl, isAzureBackend } from './azureConfig';

const GCP_FUNCTIONS_BASE = (import.meta.env.VITE_GCP_FUNCTIONS_URL || '').trim();

export function getFunctionsBase() {
  if (isAzureBackend()) {
    return getAzureFunctionsUrl();
  }
  return GCP_FUNCTIONS_BASE;
}
