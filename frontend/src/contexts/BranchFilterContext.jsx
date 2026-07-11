import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const STORAGE_KEY = 'currentBranchFilter';
const BranchFilterContext = createContext(null);

export function BranchFilterProvider({ children }) {
  const [selectedBranch, setSelectedBranchState] = useState(() => localStorage.getItem(STORAGE_KEY) || 'all');
  const setSelectedBranch = useCallback((value) => {
    const normalized = value || 'all';
    localStorage.setItem(STORAGE_KEY, normalized);
    setSelectedBranchState(normalized);
  }, []);
  const value = useMemo(() => ({ selectedBranch, setSelectedBranch }), [selectedBranch, setSelectedBranch]);
  return <BranchFilterContext.Provider value={value}>{children}</BranchFilterContext.Provider>;
}

export function useBranchFilter() {
  const value = useContext(BranchFilterContext);
  if (!value) throw new Error('useBranchFilter must be used inside BranchFilterProvider');
  return value;
}
