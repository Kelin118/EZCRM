import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import api from '../../api/axios.js';

export async function fetchAuthenticatedImageObjectUrl(src, apiClient = api) {
  if (!src) return '';
  const response = await apiClient.get(src, { responseType: 'blob' });
  return URL.createObjectURL(response.data);
}

export function revokeAuthenticatedImageObjectUrl(objectUrl) {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
}

export function canUseHoverPreview(win = globalThis.window) {
  return Boolean(win?.matchMedia?.('(hover: hover) and (pointer: fine)').matches);
}

export function getHoverPreviewPosition(rect, viewportWidth, viewportHeight, previewSize = 360, margin = 16) {
  const width = Math.min(previewSize, Math.max(160, viewportWidth - margin * 2));
  const height = Math.min(previewSize, Math.max(160, viewportHeight - margin * 2));
  const rightLeft = rect.right + margin;
  const leftLeft = rect.left - width - margin;
  const left = rightLeft + width <= viewportWidth - margin ? rightLeft : Math.max(margin, leftLeft);
  const preferredTop = rect.top;
  const top = Math.min(Math.max(margin, preferredTop), Math.max(margin, viewportHeight - height - margin));
  return { left, top, width, height };
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

function ImageLightbox({ objectUrl, alt, previewTitle, onClose }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={previewTitle || alt || 'Просмотр изображения'}
      onClick={onClose}
    >
      <button
        type="button"
        aria-label="Закрыть просмотр изображения"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        className="absolute right-4 top-4 z-[91] grid h-11 w-11 place-items-center rounded-full bg-white/90 text-slate-900 shadow-lg transition-[background-color,box-shadow,transform] duration-150 hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/50"
      >
        <X size={22} aria-hidden="true" />
      </button>
      <div className="max-h-[88vh] max-w-[92vw]" onClick={(event) => event.stopPropagation()}>
        <img
          src={objectUrl}
          alt={alt}
          className="h-auto max-h-[88vh] w-auto max-w-[92vw] rounded-2xl object-contain shadow-2xl"
        />
      </div>
    </div>,
    document.body,
  );
}

function HoverPreview({ objectUrl, alt, position }) {
  if (!position) return null;
  return createPortal(
    <div
      className="pointer-events-none fixed z-[80] rounded-2xl border border-white bg-white p-2 shadow-2xl"
      style={{
        left: position.left,
        top: position.top,
        width: position.width,
        height: position.height,
      }}
    >
      <img src={objectUrl} alt={alt} className="h-full w-full rounded-xl object-contain" />
    </div>,
    document.body,
  );
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
  previewable = false,
  hoverPreview = false,
  previewTitle = '',
}) {
  const { objectUrl, loading, error } = useAuthenticatedImageObjectUrl(src);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [hoverPosition, setHoverPosition] = useState(null);
  const canPreview = Boolean(previewable && objectUrl && !loading && !error);
  const content = loading || error || !objectUrl ? (
    <ImageFallback className={className} fileName={fileName || alt} loading={loading} />
  ) : (
    <img
      src={objectUrl}
      alt={alt}
      loading="lazy"
      className={`${className} ${canPreview ? 'transition-[filter,transform,opacity] duration-150 group-hover:scale-[1.02] group-hover:brightness-95' : ''}`}
    />
  );

  if (canPreview) {
    return (
      <>
        <button
          type="button"
          aria-label={`Открыть изображение ${previewTitle || alt || fileName || ''}`.trim()}
          className="group block max-w-full cursor-zoom-in overflow-hidden rounded-xl touch-manipulation focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/20"
          onClick={() => setLightboxOpen(true)}
          onMouseEnter={(event) => {
            if (!hoverPreview || !canUseHoverPreview()) return;
            const rect = event.currentTarget.getBoundingClientRect();
            setHoverPosition(getHoverPreviewPosition(rect, window.innerWidth, window.innerHeight));
          }}
          onMouseLeave={() => setHoverPosition(null)}
        >
          {content}
        </button>
        {hoverPreview && hoverPosition && <HoverPreview objectUrl={objectUrl} alt={alt} position={hoverPosition} />}
        {lightboxOpen && <ImageLightbox objectUrl={objectUrl} alt={alt} previewTitle={previewTitle} onClose={() => setLightboxOpen(false)} />}
      </>
    );
  }

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
