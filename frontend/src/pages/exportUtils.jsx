import { getApiErrorMessage } from './pageUtils.jsx';

export function downloadBlobFile(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export function formatExportFilename(prefix) {
  return `${prefix}_${new Date().toISOString().slice(0, 10)}.xlsx`;
}

export async function handleExportError(error) {
  if (error.response?.status === 403) return 'Нет доступа к этому экспорту';
  const data = error.response?.data;
  if (data instanceof Blob) {
    try {
      const text = await data.text();
      const parsed = JSON.parse(text);
      return parsed.detail || parsed.error || 'Не удалось выполнить экспорт';
    } catch {
      return 'Не удалось выполнить экспорт';
    }
  }
  return getApiErrorMessage(error);
}
