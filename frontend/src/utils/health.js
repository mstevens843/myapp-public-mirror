import { authFetch } from '@/utils/authFetch';

/**
 * Fetch a snapshot of all bot health metrics from the backend.
 *
 * This utility wraps the `/api/health/bots` endpoint behind the
 * authenticated fetch helper.  It returns the parsed JSON response
 * which contains a timestamp and a mapping of botId → health entry.
 *
 * @returns {Promise<{ts: string, bots: Record<string, any>}>}
 */
export async function fetchHealthSnapshot() {
  const res = await authFetch('/api/health/bots');
  if (!res.ok) {
    throw new Error('Failed to fetch bot health');
  }
  return res.json();
}