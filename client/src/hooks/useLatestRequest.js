import { useCallback, useEffect, useRef } from 'react';

// Guard responses as well as cancelling fetches: a response may already be resolved.
export function useLatestRequest(scope) {
  const current = useRef(null);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; current.current?.abort(); };
  }, []);
  const begin = useCallback(() => {
    const controller = new AbortController();
    // A completed mutation may call a refresh captured before navigation.
    if (!mounted.current || activeScope.current !== scope) {
      controller.abort();
      return controller;
    }
    current.current?.abort();
    current.current = controller;
    return controller;
  }, [scope]);
  const isCurrent = useCallback(controller => mounted.current && activeScope.current === scope && current.current === controller && !controller.signal.aborted, [scope]);
  return { begin, isCurrent };
}
