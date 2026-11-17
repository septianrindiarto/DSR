import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

// Per-user notification feed + "Perlu tindakan" counters (owner 2026-11-13).
// Polls quietly every 60 s while the tab is visible (no loading bar).
const POLL_MS = 60_000;

export function useInbox() {
  const [feed, setFeed] = useState({ data: [], unread: 0 });
  const [actions, setActions] = useState({ data: [], total: 0 });
  const load = useCallback(() => {
    api.inbox.feed({ limit: 30 }, { silent: true }).then((r) => r && setFeed(r)).catch(() => {});
    api.inbox.actions({ silent: true }).then((r) => r && setActions(r)).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);
  const markRead = useCallback(async (ids) => { await api.inbox.read(ids).catch(() => {}); load(); }, [load]);
  return { feed, actions, load, markRead };
}
