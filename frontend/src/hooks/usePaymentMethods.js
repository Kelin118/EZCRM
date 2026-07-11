import { useCallback, useEffect, useMemo, useState } from 'react';

import api from '../api/axios.js';

let cachedAll = null;
const listeners = new Set();

function publish(items) {
  cachedAll = items;
  listeners.forEach((listener) => listener(items));
}

export default function usePaymentMethods({ activeOnly = true } = {}) {
  const [allMethods, setAllMethods] = useState(cachedAll || []);
  const [loading, setLoading] = useState(!cachedAll);

  const refreshPaymentMethods = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('payment-methods/');
      publish(Array.isArray(data) ? data : data.results || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    listeners.add(setAllMethods);
    if (!cachedAll) refreshPaymentMethods();
    return () => listeners.delete(setAllMethods);
  }, [refreshPaymentMethods]);

  const paymentMethods = useMemo(
    () => (activeOnly ? allMethods.filter((item) => item.is_active) : allMethods),
    [activeOnly, allMethods],
  );
  const options = useMemo(() => paymentMethods.map((item) => ({ value: String(item.id), label: item.name })), [paymentMethods]);
  const getPaymentMethodById = useCallback(
    (id) => allMethods.find((item) => String(item.id) === String(id)) || null,
    [allMethods],
  );

  return { paymentMethods, options, loading, refreshPaymentMethods, getPaymentMethodById };
}
