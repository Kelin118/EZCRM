import { useEffect, useState } from 'react';

import api from '../../api/axios.js';

export async function fetchAuthenticatedImageObjectUrl(src, apiClient = api) {
  if (!src) return '';
  const response = await apiClient.get(src, { responseType: 'blob' });
  return URL.createObjectURL(response.data);
}

export function revokeAuthenticatedImageObjectUrl(objectUrl) {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
}

export function useAuthenticatedImageObjectUrl(src) {
  const [objectUrl, setObjectUrl] = useState('');
  const [loading, setLoading] = useState(Boolean(src));
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!src) {
      setObjectUrl('');
      setLoading(false);
      setError(false);
      return undefined;
    }

    let disposed = false;
    let currentObjectUrl = '';

    const load = async () => {
      setLoading(true);
      setError(false);
      try {
        currentObjectUrl = await fetchAuthenticatedImageObjectUrl(src);
        if (!disposed) setObjectUrl(currentObjectUrl);
      } catch {
        revokeAuthenticatedImageObjectUrl(currentObjectUrl);
        currentObjectUrl = '';
        if (!disposed) {
          setObjectUrl('');
          setError(true);
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    };

    load();

    return () => {
      disposed = true;
      revokeAuthenticatedImageObjectUrl(currentObjectUrl);
    };
  }, [src]);

  return { objectUrl, loading, error };
}

function ImageFallback({ className = '', fileName = '', loading = false }) {
  return (
    <div className={`grid place-items-center overflow-hidden bg-slate-100 text-center ${className}`}>
      {loading ? (
        <div className="h-full w-full animate-pulse bg-slate-200" />
      ) : (
        <div className="px-3 text-xs font-semibold text-slate-500">
          <p>Не удалось загрузить изображение</p>
          {fileName && <p className="mt-1 truncate text-[11px] text-slate-400">{fileName}</p>}
        </div>
      )}
    </div>
  );
}

export default function AuthenticatedImage({
  src,
  alt = '',
  className = '',
  fileName = '',
  openInNewTab = false,
}) {
  const { objectUrl, loading, error } = useAuthenticatedImageObjectUrl(src);
  const content = loading || error || !objectUrl ? (
    <ImageFallback className={className} fileName={fileName || alt} loading={loading} />
  ) : (
    <img src={objectUrl} alt={alt} className={className} />
  );

  if (!openInNewTab) return content;

  return (
    <a
      href={objectUrl || undefined}
      target="_blank"
      rel="noreferrer"
      className="block"
      onClick={(event) => {
        if (!objectUrl) event.preventDefault();
      }}
    >
      {content}
    </a>
  );
}
