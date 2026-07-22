#!/bin/bash
# migrate-storage-to-blob.sh
# 
# Uses AzCopy to copy files from Google Cloud Storage to Azure Blob Storage.
# 
# Prerequisites:
# 1. Install AzCopy: https://docs.microsoft.com/en-us/azure/storage/common/storage-use-azcopy-v10
# 2. Authenticate AzCopy with Azure: `azcopy login`
# 3. Create a short-lived HMAC key for the GCS bucket or use `gsutil rsync` if local.
#
# Usage:
#   ./migrate-storage-to-blob.sh <GCS_BUCKET_URL> <AZURE_BLOB_SAS_URL>
#
# Example:
#   ./migrate-storage-to-blob.sh "https://storage.googleapis.com/hybridcloudworks-61e8d.appspot.com" "https://hcwstorageprod.blob.core.windows.net/?<SAS_TOKEN>"

GCS_SOURCE=$1
AZURE_DEST=$2

if [ -z "$GCS_SOURCE" ] || [ -z "$AZURE_DEST" ]; then
  echo "Usage: ./migrate-storage-to-blob.sh <GCS_SOURCE_URL> <AZURE_DEST_SAS_URL>"
  exit 1
fi

echo "Migrating from $GCS_SOURCE to $AZURE_DEST"
echo "Starting AzCopy..."

azcopy copy "$GCS_SOURCE/*" "$AZURE_DEST" --recursive=true

echo "Migration complete!"
