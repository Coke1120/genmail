import { useEffect, useRef, useState } from 'react';
import { api } from './api';

export function useMailPage(account, revision, options = {}) {
  const key = JSON.stringify([account, revision, options]);
  const [position, setPosition] = useState({ key, cursors: [''] });
  const cursors = position.key === key ? position.cursors : [''];
  const cursor = cursors.at(-1);
  const [page, setPage] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const current = useRef(key); current.current = key;
  useEffect(() => {
    if (!account) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    api('/mail/page', { account, method: 'POST', body: JSON.stringify({ locale: navigator.language, ...options, cursor }), signal: controller.signal })
      .then(result => { if (!controller.signal.aborted && current.current === key) setPage({ ...result, key, cursor }); })
      .catch(cause => { if (!controller.signal.aborted) { setError(cause.message); if (cause.status === 409 && cursor) setPosition({ key, cursors: [''] }); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [key, cursor]);
  return { messages: page?.key === key && page.cursor === cursor ? page.messages : [], total: page?.key === key ? page.total : 0,
    error, loading, page: cursors.length,
    previous: cursors.length > 1 ? () => setPosition({ key, cursors: cursors.slice(0, -1) }) : null,
    next: page?.key === key && page.cursor === cursor && page.nextCursor ? () => setPosition({ key, cursors: [...cursors, page.nextCursor] }) : null };
}
