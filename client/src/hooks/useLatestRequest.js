import { useCallback, useEffect, useRef } from 'react';

// Guard responses as well as cancelling fetches: a response may already be resolved.
export function useLatestRequest() {
  const current = useRef(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; current.current?.abort(); };
  }, []);
  const begin = useCallback(() => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    if (!mounted.current) controller.abort();
    return controller;
  }, []);
  const isCurrent = useCallback(controller => mounted.current && current.current === controller && !controller.signal.aborted, []);
  return { begin, isCurrent };
}
