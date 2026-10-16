import { ApiError } from './api';

/**
 * PUTs a file straight to object storage with a pre-signed URL, reporting progress (0-1).
 * XMLHttpRequest, because fetch cannot report upload progress. The bytes never pass
 * through the API (CLAUDE.md).
 */
export function putWithProgress(
  url: string,
  file: Blob,
  headers: Record<string, string>,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
      } else {
        reject(
          new ApiError(xhr.status, 'UPLOAD_FAILED', 'The file could not be uploaded. Try again.'),
        );
      }
    };
    xhr.onerror = () =>
      reject(
        new ApiError(
          0,
          'NETWORK_ERROR',
          'The upload stopped. Check your connection and try again.',
        ),
      );
    xhr.onabort = () => reject(new ApiError(0, 'ABORTED', 'The upload was cancelled.'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}
