import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { RenderResourceBudget, RenderResourceScope } from './renderResourceCache';

// All living pages share one evictable budget, not a large budget per page.
const budget = new RenderResourceBudget();
export const RenderResourceContext = createContext<RenderResourceScope | null>(null);
export const useRenderResources = () => useContext(RenderResourceContext);

export function RenderResourceProvider({ children }: { children: React.ReactNode }) {
  const [scope] = useState(() => new RenderResourceScope(budget));
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true; scope.activate();
    return () => {
      mounted.current = false;
      // Passive effect replay is not page destruction; abandoned renders never
      // register globally. Covered pages keep their cache and reader references.
      queueMicrotask(() => { if (!mounted.current) scope.dispose(); });
    };
  }, [scope]);
  return <RenderResourceContext.Provider value={scope}>{children}</RenderResourceContext.Provider>;
}
