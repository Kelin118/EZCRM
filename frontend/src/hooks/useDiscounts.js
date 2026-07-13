import { useCallback, useEffect, useMemo, useState } from 'react';

import api from '../api/axios.js';
import { formatDiscountLabel } from '../utils/discounts.js';

function toList(data) {
  return Array.isArray(data) ? data : data?.results || [];
}

export default function useDiscounts({ branch = '' } = {}) {
  const [discounts, setDiscounts] = useState([]);
  const [loading, setLoading] = useState(false);

  const refreshDiscounts = useCallback(async () => {
    setLoading(true);
    try {
      const params = { available: 'true', is_active: 'true' };
      if (branch && branch !== 'all' && branch !== 'unassigned') params.branch = branch;
      const { data } = await api.get('discounts/', { params });
      setDiscounts(toList(data));
    } finally {
      setLoading(false);
    }
  }, [branch]);

  useEffect(() => {
    refreshDiscounts();
  }, [refreshDiscounts]);

  const options = useMemo(
    () => discounts.map((discount) => ({ value: String(discount.id), label: formatDiscountLabel(discount) })),
    [discounts],
  );
  const getDiscountById = useCallback(
    (id) => discounts.find((discount) => String(discount.id) === String(id)) || null,
    [discounts],
  );

  return { discounts, options, loading, refreshDiscounts, getDiscountById };
}
