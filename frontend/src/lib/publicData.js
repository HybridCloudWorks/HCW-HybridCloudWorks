export async function loadPublicDataSnapshot(path) {
  try {
    const response = await fetch(path, {
      headers: { Accept: 'application/json' },
      cache: 'default',
    });

    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.toLowerCase().includes('application/json')) {
      return [];
    }

    const payload = await response.json();
    return Array.isArray(payload?.items) ? payload.items : [];
  } catch {
    return [];
  }
}
