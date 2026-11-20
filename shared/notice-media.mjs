export const noticeMediaTypes = Object.freeze([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', 'image/heic', 'image/heif',
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska', 'video/x-msvideo', 'video/x-m4v', 'video/mpeg'
]);

export const noticeMaxImageBytes = 100 * 1024 * 1024;
export const noticeMaxVideoBytes = 5 * 1024 * 1024 * 1024;

const typesByExtension = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', bmp: 'image/bmp', heic: 'image/heic', heif: 'image/heif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
  avi: 'video/x-msvideo', m4v: 'video/x-m4v', mpeg: 'video/mpeg', mpg: 'video/mpeg'
};

export const noticeMediaAccept = [...noticeMediaTypes, ...Object.keys(typesByExtension).map(extension => `.${extension}`)].join(',');

export function noticeMediaType(file) {
  const supplied = String(file?.type || '').trim().toLowerCase();
  if (supplied) return supplied;
  return typesByExtension[String(file?.name || '').split('.').pop().toLowerCase()] || '';
}
