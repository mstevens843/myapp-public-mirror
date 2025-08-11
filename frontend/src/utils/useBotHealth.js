import { useEffect, useState } from 'react';
import { authFetch } from '@/utils/authFetch';

/**
 * React hook to subscribe to bot health metrics.
 *
 * It periodically polls the `/api/health/bots` endpoint and extracts
 * the metrics for the given botId. Consumers receive the most recent
 * entry as well as the overall health level. Optionally, a custom
 * polling interval can be specified (default 15s).
 *
 * @param {string} botId Unique identifier of the bot to monitor
 * @param {number} intervalMs Polling interval in milliseconds
 */
export default function useBotHealth(botId, intervalMs = 15000) {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchHealth() {
      try {
        const res = await authFetch('/api/health/bots');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setHealth(data.bots ? data.bots[botId] : null);
        }
      } catch {
        // ignore errors; will retry on next interval
      }
    }
    // Immediately fetch once
    if (botId) fetchHealth();
    const timer = setInterval(() => {
      if (botId) fetchHealth();
    }, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [botId, intervalMs]);

  return health;
}