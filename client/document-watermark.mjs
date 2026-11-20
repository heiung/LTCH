// Hệ thống đóng dấu bản quyền (Watermark mờ phía sau nội dung: "[Họ và tên] - [Mã số]")
// khi người dùng tải tài liệu (PDF / Hình ảnh) từ cổng học tập Lớp Toán cô Hạnh.

const ASCII_ENCODER = new TextEncoder();

export function deriveFallbackUserCode(uid = '', role = '') {
  const cleanUid = String(uid || '').trim();
  const rolePrefix =
    role === 'admin'
      ? 'QT'
      : role === 'teacher'
        ? 'GV'
        : role === 'assistant'
          ? 'TG'
          : role === 'parent'
            ? 'PH'
            : 'HS';
  if (!cleanUid) return `${rolePrefix}0001`;
  let hash = 2166136261;
  for (let i = 0; i < cleanUid.length; i++) {
    hash ^= cleanUid.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const numeric = String((hash >>> 0) % 1000000).padStart(6, '0');
  return `${rolePrefix}${numeric}`;
}

export function resolveUserWatermarkText({
  me = null,
  profile = null,
  workspace = null,
  viewRole = ''
} = {}) {
  const rawName =
    profile?.displayName ||
    profile?.display_name ||
    me?.displayName ||
    me?.name ||
    me?.display_name ||
    workspace?.people?.find?.(p => p.uid === me?.uid)?.display_name ||
    workspace?.students?.find?.(s => s.uid === me?.uid)?.display_name ||
    'Học viên LTCH';
  const fullName = String(rawName).trim() || 'Học viên LTCH';

  let rawCode =
    profile?.studentCode ||
    profile?.student_code ||
    me?.studentCode ||
    me?.student_code ||
    '';

  const rosterList = [
    ...(Array.isArray(workspace?.members) ? workspace.members : []),
    ...(Array.isArray(workspace?.students) ? workspace.students : [])
  ];

  if (!rawCode && rosterList.length && me?.uid) {
    const selfMember = rosterList.find(m => m.uid === me.uid && (m.studentCode || m.student_code));
    if (selfMember) rawCode = selfMember.studentCode || selfMember.student_code;
  }

  if (!rawCode && rosterList.length && Array.isArray(me?.childMemberships)) {
    for (const child of me.childMemberships) {
      const childMember = rosterList.find(m => m.uid === child.uid && (m.studentCode || m.student_code));
      if (childMember) {
        rawCode = childMember.studentCode || childMember.student_code;
        break;
      }
    }
  }

  if (!rawCode && rosterList.length && (viewRole === 'parent' || me?.roles?.includes?.('parent'))) {
    const firstWithCode = rosterList.find(m => m.studentCode || m.student_code);
    if (firstWithCode) rawCode = firstWithCode.studentCode || firstWithCode.student_code;
  }

  const code = String(rawCode || '').trim() || deriveFallbackUserCode(me?.uid, viewRole || me?.roles?.[0] || '');
  return `${fullName} - ${code}`;
}

export function drawWatermarkBehindCanvas(ctx, width, height, watermarkText) {
  if (!ctx || !width || !height) return;
  const text = String(watermarkText || '').trim();
  if (!text) return;

  ctx.save();
  // Chế độ hòa trộn 'multiply' giúp watermark chỉ hiển thị trên nền giấy sáng phía sau,
  // hoàn toàn không làm mờ hay che khuất nét chữ và công thức Toán màu tối ở phía trước.
  ctx.globalCompositeOperation = 'multiply';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const angleRad = (-24 * Math.PI) / 180;
  const baseFontSize = Math.max(14, Math.min(28, Math.round(Math.min(width, height) * 0.024)));
  const setFittedFont = size => {
    ctx.font = `700 ${size}px "Be Vietnam Pro", "Inter", system-ui, -apple-system, sans-serif`;
  };
  setFittedFont(baseFontSize);

  const maxStampWidth = Math.max(120, width * 0.38);
  const measured = typeof ctx.measureText === 'function' ? ctx.measureText(text)?.width || 0 : 0;
  if (measured > maxStampWidth && measured > 0) {
    const fittedSize = Math.max(11, Math.floor(baseFontSize * (maxStampWidth / measured)));
    setFittedFont(fittedSize);
  }

  ctx.fillStyle = 'rgba(30, 58, 138, 0.055)';

  // Sắp xếp ngay ngắn 5 dấu bản quyền đối xứng (hình chữ X cân đối trong vùng lề trang giấy)
  const anchors = [
    [0.27, 0.22],
    [0.73, 0.22],
    [0.5, 0.5],
    [0.27, 0.78],
    [0.73, 0.78]
  ];
  for (const [rx, ry] of anchors) {
    ctx.save();
    ctx.translate(width * rx, height * ry);
    ctx.rotate(angleRad);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  ctx.restore();
}

export function assemblePdfFromJpegPages(pages) {
  if (!Array.isArray(pages) || !pages.length) {
    throw Error('Không có trang PDF nào để đóng gói.');
  }

  // Cấu trúc đối tượng PDF 1.4:
  // 1: Catalog
  // 2: Pages
  // Với mỗi trang i (0..N-1):
  //   pageObjId  = 3 + i * 3
  //   contentId  = 4 + i * 3
  //   imageObjId = 5 + i * 3
  const totalObjects = 2 + pages.length * 3;
  const chunks = [];
  const offsets = new Array(totalObjects + 1).fill(0);
  let byteLength = 0;

  const pushBytes = uint8 => {
    chunks.push(uint8);
    byteLength += uint8.byteLength;
  };
  const pushAscii = str => {
    pushBytes(ASCII_ENCODER.encode(str));
  };

  pushAscii('%PDF-1.4\n');
  pushBytes(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // Binary comment

  // Object 1: Catalog
  offsets[1] = byteLength;
  pushAscii('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // Object 2: Pages
  const kidsRefs = pages.map((_, idx) => `${3 + idx * 3} 0 R`).join(' ');
  offsets[2] = byteLength;
  pushAscii(`2 0 obj\n<< /Type /Pages /Kids [ ${kidsRefs} ] /Count ${pages.length} >>\nendobj\n`);

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const pageObjId = 3 + i * 3;
    const contentId = 4 + i * 3;
    const imageObjId = 5 + i * 3;

    const ptW = Number(p.ptWidth > 0 ? p.ptWidth : 595.28).toFixed(2);
    const ptH = Number(p.ptHeight > 0 ? p.ptHeight : 841.89).toFixed(2);
    const pxW = Math.max(1, Math.round(Number(p.pixelWidth) || 595));
    const pxH = Math.max(1, Math.round(Number(p.pixelHeight) || 842));
    const jpegBytes = p.jpegBytes instanceof Uint8Array ? p.jpegBytes : new Uint8Array(p.jpegBytes);

    // Content stream vẽ ảnh phủ kín kích thước trang chuẩn
    const contentStreamStr = `q\n${ptW} 0 0 ${ptH} 0 0 cm\n/Im0 Do\nQ\n`;
    const contentBytes = ASCII_ENCODER.encode(contentStreamStr);

    // Page object
    offsets[pageObjId] = byteLength;
    pushAscii(
      `${pageObjId} 0 obj\n` +
        `<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 ${ptW} ${ptH} ] ` +
        `/Resources << /ProcSet [ /PDF /ImageC ] /XObject << /Im0 ${imageObjId} 0 R >> >> ` +
        `/Contents ${contentId} 0 R >>\n` +
        `endobj\n`
    );

    // Content stream object
    offsets[contentId] = byteLength;
    pushAscii(`${contentId} 0 obj\n<< /Length ${contentBytes.byteLength} >>\nstream\n`);
    pushBytes(contentBytes);
    pushAscii('\nendstream\nendobj\n');

    // Image XObject (DCTDecode = raw JPEG)
    offsets[imageObjId] = byteLength;
    pushAscii(
      `${imageObjId} 0 obj\n` +
        `<< /Type /XObject /Subtype /Image /Width ${pxW} /Height ${pxH} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.byteLength} >>\n` +
        `stream\n`
    );
    pushBytes(jpegBytes);
    pushAscii('\nendstream\nendobj\n');
  }

  const xrefOffset = byteLength;
  pushAscii(`xref\n0 ${totalObjects + 1}\n`);
  pushAscii('0000000000 65535 f \n');
  for (let objId = 1; objId <= totalObjects; objId++) {
    const offStr = String(offsets[objId]).padStart(10, '0');
    pushAscii(`${offStr} 00000 n \n`);
  }

  pushAscii(
    `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  );

  const output = new Uint8Array(byteLength);
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return output;
}

async function canvasToJpegUint8Array(canvas, quality = 0.91) {
  if (typeof canvas.toBlob === 'function') {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob) return new Uint8Array(await blob.arrayBuffer());
  }
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const base64 = dataUrl.split(',')[1] || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function isPdfBlob(blob, fileName = '', contentType = '') {
  if (!blob || blob.size < 5) return false;
  try {
    const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
    if (head.length === 5 && String.fromCharCode(...head) === '%PDF-') return true;
  } catch {}
  return contentType === 'application/pdf' || /\.pdf$/i.test(String(fileName || ''));
}

export async function isImageBlob(blob, fileName = '', contentType = '') {
  if (!blob || blob.size < 4) return false;
  const lowerType = String(contentType || blob.type || '').toLowerCase();
  if (/^image\/(jpeg|png|webp)$/.test(lowerType)) return true;
  if (/\.(jpe?g|png|webp)$/i.test(String(fileName || ''))) return true;
  try {
    const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    // JPEG magic: FF D8 FF
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return true;
    // PNG magic: 89 50 4E 47
    if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return true;
  } catch {}
  return false;
}

export async function watermarkPdfBlob(
  blob,
  { watermarkText, pdfjs, existingPdfDoc = null, onProgress = null } = {}
) {
  if ((!pdfjs && !existingPdfDoc) || typeof document === 'undefined') return blob;
  let loadingTask = null;
  let doc = existingPdfDoc;
  if (!doc) {
    const rawBytes = new Uint8Array(await blob.arrayBuffer());
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
    loadingTask = pdfjs.getDocument({
      data: rawBytes,
      isEvalSupported: false,
      disableFontFace: true,
      enableXfa: false,
      maxImageSize: 16000000,
      cMapUrl: '/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/pdfjs/standard_fonts/',
      wasmUrl: '/pdfjs/wasm/'
    });
    doc = await loadingTask.promise;
  }

  try {
    const numPages = doc.numPages || 1;
    const jpegPages = [];
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { alpha: false });

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      onProgress?.(pageNum, numPages);
      const page = await doc.getPage(pageNum);
      const baseVp = page.getViewport({ scale: 1 });
      const renderScale = Math.min(1.5, 1240 / Math.max(1, baseVp.width), 1754 / Math.max(1, baseVp.height));
      const vp = page.getViewport({ scale: renderScale });

      canvas.width = Math.max(1, Math.ceil(vp.width));
      canvas.height = Math.max(1, Math.ceil(vp.height));

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvas,
        canvasContext: ctx,
        viewport: vp
      }).promise;

      drawWatermarkBehindCanvas(ctx, canvas.width, canvas.height, watermarkText);

      const jpegBytes = await canvasToJpegUint8Array(canvas, 0.88);
      jpegPages.push({
        jpegBytes,
        pixelWidth: canvas.width,
        pixelHeight: canvas.height,
        ptWidth: baseVp.width,
        ptHeight: baseVp.height
      });

      if (pageNum < numPages && pageNum % 2 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    const pdfBytes = assemblePdfFromJpegPages(jpegPages);
    return new Blob([pdfBytes], { type: 'application/pdf' });
  } finally {
    if (loadingTask) {
      await loadingTask.destroy().catch(() => {});
    }
  }
}

export async function watermarkImageBlob(blob, { watermarkText }) {
  if (typeof document === 'undefined') return blob;
  const imgUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = imgUrl;
    });
    const width = Math.max(1, img.naturalWidth || img.width || 800);
    const height = Math.max(1, img.naturalHeight || img.height || 600);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    drawWatermarkBehindCanvas(ctx, width, height, watermarkText);
    const jpegBytes = await canvasToJpegUint8Array(canvas, 0.92);
    return new Blob([jpegBytes], { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(imgUrl);
  }
}

export async function watermarkDownloadedBlob(
  blob,
  {
    watermarkText,
    fileName = '',
    contentType = '',
    pdfjs = null,
    existingPdfDoc = null,
    onProgress = null
  } = {}
) {
  if (!blob || !watermarkText) return blob;
  try {
    if (existingPdfDoc || (await isPdfBlob(blob, fileName, contentType))) {
      return await watermarkPdfBlob(blob, {
        watermarkText,
        pdfjs,
        existingPdfDoc,
        onProgress
      });
    }
    if (await isImageBlob(blob, fileName, contentType)) {
      return await watermarkImageBlob(blob, { watermarkText });
    }
  } catch {
    // Nếu tệp đặc biệt không thể kết xuất canvas, vẫn cho phép tải tệp gốc an toàn
  }
  return blob;
}
