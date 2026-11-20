const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// x and y describe the crop position from 0 (start) to 100 (end).
export function cropRegion(width, height, zoom = 1, x = 50, y = 50) {
  if (![width, height, zoom, x, y].every(Number.isFinite) || width <= 0 || height <= 0) throw new TypeError('Kích thước ảnh không hợp lệ.');
  const size = Math.min(width, height) / clamp(zoom, 1, 3);
  return {x: (width - size) * clamp(x, 0, 100) / 100, y: (height - size) * clamp(y, 0, 100) / 100, size};
}

export function drawAvatar(canvas, image, zoom, x, y) {
  const region = cropRegion(image.naturalWidth, image.naturalHeight, zoom, x, y);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Trình duyệt không hỗ trợ chỉnh ảnh.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, region.x, region.y, region.size, region.size, 0, 0, canvas.width, canvas.height);
}
