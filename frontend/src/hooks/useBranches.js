import { useCallback, useEffect, useMemo, useState } from 'react';

import api from '../api/axios.js';

export function getBranchFilterOptions(branches) {
  return [
    { value: 'all', label: 'Все филиалы' },
    ...branches.map((branch) => ({ value: String(branch.id), label: branch.name })),
    { value: 'unassigned', label: 'Не распределено' },
  ];
}

export default function useBranches() {
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);

  const refreshBranches = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('branches/', { params: { is_active: 'true' } });
      setBranches(Array.isArray(data) ? data : data?.results || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshBranches();
  }, [refreshBranches]);

  const branchOptions = useMemo(
    () => branches.map((branch) => ({ value: String(branch.id), label: branch.name })),
    [branches],
  );
  const branchFilterOptions = useMemo(() => getBranchFilterOptions(branches), [branches]);
  const getBranchById = useCallback(
    (id) => branches.find((branch) => String(branch.id) === String(id)) || null,
    [branches],
  );

  return { branches, branchOptions, branchFilterOptions, loading, refreshBranches, getBranchById };
}
