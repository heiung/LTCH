// Bộ phân tích file Word (.docx) theo mẫu dòng lệnh [...] của Lớp Toán Cô Hạnh (LTCH)
// Dùng chung trên cả Trình duyệt (Client) và Máy chủ (Node.js / Cloudflare Worker)

import { checkExamStructure, HSA_ALL_PART3_SUBJECTS } from '../worker/questions.mjs';

const MAX_DOCX_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_UNZIPPED_BYTES = 100 * 1024 * 1024; // 100 MB
const MAX_ZIP_ENTRIES = 2000;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB

export function stripDiacritics(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

export function normalizeCommandTag(rawTag) {
  return stripDiacritics(rawTag)
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const SUBJECT_MAP = {
  'VAT LI': 'physics',
  'VAT LY': 'physics',
  'LI': 'physics',
  'LY': 'physics',
  'PHYSICS': 'physics',
  'HOA HOC': 'chemistry',
  'HOA': 'chemistry',
  'CHEMISTRY': 'chemistry',
  'SINH HOC': 'biology',
  'SINH': 'biology',
  'BIOLOGY': 'biology',
  'LICH SU': 'history',
  'SU': 'history',
  'HISTORY': 'history',
  'DIA LI': 'geography',
  'DIA LY': 'geography',
  'DIA': 'geography',
  'GEOGRAPHY': 'geography',
  'TIENG ANH': 'english',
  'ANH': 'english',
  'ENGLISH': 'english'
};

async function inflateRawBytes(compressedUint8) {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(compressedUint8);
  writer.close();
  const reader = ds.readable.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_UNZIPPED_BYTES) throw new Error('Tệp giải nén vượt quá giới hạn an toàn (100 MB).');
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export async function unzipDocxEntries(bufferOrUint8) {
  const bytes = bufferOrUint8 instanceof Uint8Array
    ? bufferOrUint8
    : new Uint8Array(bufferOrUint8);
  if (bytes.byteLength > MAX_DOCX_BYTES) {
    throw new Error('Dung lượng file .docx vượt quá giới hạn 20 MB.');
  }
  if (bytes.byteLength < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error('File không đúng định dạng .docx (ZIP hợp lệ).');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocdOffset = -1;
  const minEocd = Math.max(0, bytes.byteLength - 65557);
  for (let i = bytes.byteLength - 22; i >= minEocd; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('Không đọc được cấu trúc nén của file .docx.');

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  if (totalEntries > MAX_ZIP_ENTRIES) {
    throw new Error('File .docx chứa quá nhiều tệp con (tối đa 2.000 tệp).');
  }
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  if (cdOffset + cdSize > bytes.byteLength) {
    throw new Error('Cấu trúc danh mục file .docx không hợp lệ.');
  }

  const decoder = new TextDecoder('utf-8');
  const entries = new Map();
  let ptr = cdOffset;
  let totalUncompressed = 0;

  for (let idx = 0; idx < totalEntries; idx++) {
    if (ptr + 46 > bytes.byteLength || view.getUint32(ptr, true) !== 0x02014b50) {
      throw new Error('Danh mục trung tâm của file .docx bị hỏng.');
    }
    const method = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const uncompSize = view.getUint32(ptr + 24, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localHeaderOffset = view.getUint32(ptr + 42, true);

    const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('vbaProject.bin') || name.endsWith('.bin')) {
      if (name.toLowerCase().includes('vbaproject')) {
        throw new Error('Không chấp nhận file Word có chứa Macro (.docm).');
      }
    }

    if (
      name === 'word/document.xml' ||
      name === 'word/_rels/document.xml.rels' ||
      name.startsWith('word/media/')
    ) {
      totalUncompressed += uncompSize;
      if (totalUncompressed > MAX_UNZIPPED_BYTES) {
        throw new Error('Tổng dung lượng giải nén vượt quá 100 MB.');
      }
      if (localHeaderOffset + 30 > bytes.byteLength || view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
        throw new Error('Header cục bộ trong file .docx bị lỗi.');
      }
      const lNameLen = view.getUint16(localHeaderOffset + 26, true);
      const lExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
      const compSlice = bytes.subarray(dataStart, dataStart + compSize);

      let contentBytes;
      if (method === 0) {
        contentBytes = compSlice;
      } else if (method === 8) {
        contentBytes = await inflateRawBytes(compSlice);
      } else {
        throw new Error(`Phương thức nén (${method}) không được hỗ trợ.`);
      }
      entries.set(name, contentBytes);
    }
  }

  if (!entries.has('word/document.xml')) {
    throw new Error('Không tìm thấy nội dung văn bản (word/document.xml) trong file .docx.');
  }

  return entries;
}

function decodeXmlEntities(str) {
  return String(str || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&amp;/g, '&');
}

function escapeAllowedHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parseRelationshipsXml(relsXml) {
  const map = new Map();
  if (!relsXml) return map;
  const tagRegex = /<Relationship\b([^>]*?)\/?>/gi;
  let m;
  while ((m = tagRegex.exec(relsXml)) !== null) {
    const attrs = m[1];
    const idMatch = /\bId="([^"]+)"/i.exec(attrs);
    const targetMatch = /\bTarget="([^"]+)"/i.exec(attrs);
    if (idMatch && targetMatch) {
      let target = targetMatch[1].replace(/^\/+/, '');
      if (!target.startsWith('word/')) target = `word/${target.replace(/^\.\//, '')}`;
      map.set(idMatch[1], target);
    }
  }
  return map;
}

function bytesToDataUrl(bytes, mime = 'image/png') {
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const sub = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode(...sub);
  }
  const b64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
  return `data:${mime};base64,${b64}`;
}

function detectImageMime(bytes, fileName = '') {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.wmf') || lower.endsWith('.emf')) return { supported: false, ext: lower.slice(-3) };
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { supported: true, mime: 'image/png', ext: 'png' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { supported: true, mime: 'image/jpeg', ext: 'jpg' };
  }
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return { supported: true, mime: 'image/gif', ext: 'gif' };
  }
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return { supported: true, mime: 'image/webp', ext: 'webp' };
  }
  return { supported: false, ext: lower.split('.').pop() || 'unknown' };
}

function extractParagraphContent(pXml, { relsMap, entries, mediaMap, errors, warnings }) {
  const hasAutoNum = /<w:numPr\b/i.test(pXml);
  const hasOmml = /<m:oMath\b|<m:oMathPara\b/i.test(pXml);
  const hasOleObject = /<w:object\b|<o:OLEObject\b/i.test(pXml);
  const hasFloatingDrawing = /<wp:anchor\b/i.test(pXml);

  // Tách từng run <w:r> hoặc <w:hyperlink>
  const runRegex = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/gi;
  let plainText = '';
  let richText = '';
  const paragraphMedia = [];
  const markedOptionLetters = new Set();

  let rMatch;
  while ((rMatch = runRegex.exec(pXml)) !== null) {
    const rBody = rMatch[1];
    const rPrMatch = /<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/i.exec(rBody);
    const rPr = rPrMatch ? rPrMatch[1] : '';

    const isUnderline = /<w:u\b(?![^>]*w:val="(?:none|0|false)")/i.test(rPr);
    const isBold = /<w:b\b(?![^>]*w:val="(?:off|0|false)")/i.test(rPr);
    const isItalic = /<w:i\b(?![^>]*w:val="(?:off|0|false)")/i.test(rPr);
    const isSup = /<w:vertAlign\b[^>]*w:val="superscript"/i.test(rPr);
    const isSub = /<w:vertAlign\b[^>]*w:val="subscript"/i.test(rPr);
    const colorMatch = /<w:color\b[^>]*w:val="([0-9a-fA-F]{6})"/i.exec(rPr);
    const runColor = colorMatch ? colorMatch[1].toUpperCase() : '';
    const hlMatch = /<w:highlight\b[^>]*w:val="([^"]+)"/i.exec(rPr);
    const runHighlight = hlMatch ? hlMatch[1].toLowerCase() : '';
    const isColoredOrHighlighted =
      (runColor && !['000000', 'AUTO'].includes(runColor)) ||
      (runHighlight && runHighlight !== 'none');

    // Kiểm tra ảnh trong run
    const embedRegex = /\br:(?:embed|id)="([^"]+)"/gi;
    let emb;
    while ((emb = embedRegex.exec(rBody)) !== null) {
      const rId = emb[1];
      const targetPath = relsMap.get(rId);
      if (targetPath && targetPath.startsWith('word/media/')) {
        const imgBytes = entries.get(targetPath);
        if (!imgBytes) continue;
        const info = detectImageMime(imgBytes, targetPath);
        if (!info.supported) {
          errors.push(`Ảnh định dạng .${info.ext} (${targetPath}) không được hỗ trợ. Vui lòng dùng ảnh PNG hoặc JPG.`);
          continue;
        }
        if (imgBytes.byteLength > MAX_IMAGE_BYTES) {
          errors.push(`Ảnh ${targetPath.replace('word/media/', '')} vượt quá giới hạn 2 MB.`);
          continue;
        }
        let mediaItem = mediaMap.get(targetPath);
        if (!mediaItem) {
          const mediaId = `img_${mediaMap.size + 1}`;
          const dataUrl = bytesToDataUrl(imgBytes, info.mime);
          mediaItem = {
            id: mediaId,
            name: targetPath.replace('word/media/', ''),
            mimeType: info.mime,
            contentType: info.mime,
            ext: info.ext,
            bytes: imgBytes,
            dataUrl
          };
          mediaMap.set(targetPath, mediaItem);
        }
        paragraphMedia.push({ id: mediaItem.id, path: targetPath, dataUrl: mediaItem.dataUrl });
        const token = ` [[img:${mediaItem.id}]] `;
        plainText += token;
        richText += token;
      }
    }

    // Trích văn bản trong run
    const tokenRegex = /<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>|<w:br\b[^>]*\/?>|<w:tab\b[^>]*\/?>/gi;
    let runText = '';
    let tMatch;
    while ((tMatch = tokenRegex.exec(rBody)) !== null) {
      if (tMatch[0].startsWith('<w:br')) runText += '\n';
      else if (tMatch[0].startsWith('<w:tab')) runText += ' ';
      else runText += decodeXmlEntities(tMatch[1]);
    }

    if (runText) {
      if (isUnderline || isColoredOrHighlighted) {
        for (const lm of runText.matchAll(/(?:^|[\s([*])([A-F])(?:\s*[.)\]:]|$)/g)) {
          markedOptionLetters.add(lm[1].toUpperCase());
        }
      }
      const previousLength = plainText.length;
      plainText += runText;
      const leadingTag = /^\s*\[[^\]]*\]/.exec(plainText);
      const prefixLength = leadingTag
        ? Math.max(0, leadingTag[0].length - previousLength)
        : /^\s*\[[^\]]*$/.test(plainText) ? runText.length : 0;
      const prefix = runText.slice(0, prefixLength);
      let formatted = runText.slice(prefixLength);
      if (formatted.trim() && !formatted.includes('$')) {
        if (isSup) formatted = `<sup>${formatted}</sup>`;
        else if (isSub) formatted = `<sub>${formatted}</sub>`;
        if (isUnderline) formatted = `<u>${formatted}</u>`;
        if (isBold) formatted = `<strong>${formatted}</strong>`;
        if (isItalic) formatted = `<em>${formatted}</em>`;
      }
      richText += prefix + formatted;
    }
  }

  return {
    plainText: plainText.replace(/\u00a0/g, ' ').trim(),
    richText: richText.replace(/\u00a0/g, ' ').trim(),
    media: paragraphMedia,
    markedOptions: [...markedOptionLetters],
    hasAutoNum,
    hasOmml,
    hasOleObject,
    hasFloatingDrawing
  };
}

function escapeHtmlInsideTableCell(richText) {
  const tokens = [];
  const placeholderText = String(richText || '').replace(/<\/?(?:u|sup|sub|b|strong|i|em)>/gi, (tag) => {
    const idx = tokens.length;
    tokens.push(tag.toLowerCase());
    return `\u0000LTCH_TAG_${idx}\u0000`;
  });
  const escaped = placeholderText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(/\u0000LTCH_TAG_(\d+)\u0000/g, (_, i) => tokens[Number(i)] || '');
}

function extractTableHtml(tblXml, ctx) {
  const trRegex = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/gi;
  const parsedRows = [];
  const tableMedia = [];
  const activeVSpans = new Map();
  let trMatch;
  let rowIndex = 0;

  while ((trMatch = trRegex.exec(tblXml)) !== null) {
    const trBody = trMatch[1];
    const trPrMatch = /<w:trPr\b[^>]*>([\s\S]*?)<\/w:trPr>/i.exec(trBody);
    const isExplicitHeaderRow = Boolean(trPrMatch && /<w:tblHeader\b/i.test(trPrMatch[1]));
    const tcRegex = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/gi;
    const rowCells = [];
    let tcMatch;
    let colCursor = 0;

    while ((tcMatch = tcRegex.exec(trBody)) !== null) {
      const tcBody = tcMatch[1];
      const tcPrMatch = /^\s*<w:tcPr\b[^>]*>([\s\S]*?)<\/w:tcPr>/i.exec(tcBody);
      const tcPrXml = tcPrMatch ? tcPrMatch[1] : '';
      const gridSpanMatch = /<w:gridSpan\b[^>]*w:val="(\d+)"/i.exec(tcPrXml);
      const colSpan = Math.min(24, Math.max(1, gridSpanMatch ? Number.parseInt(gridSpanMatch[1], 10) : 1));
      const vMergeMatch = /<w:vMerge\b([^>]*)\/?>/i.exec(tcPrXml);
      let vMergeMode = null;
      if (vMergeMatch) {
        vMergeMode = /w:val="restart"/i.test(vMergeMatch[1] || '') ? 'restart' : 'continue';
      }

      const pRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gi;
      const cellParts = [];
      let pMatch;
      while ((pMatch = pRegex.exec(tcBody)) !== null) {
        const pRes = extractParagraphContent(pMatch[1], ctx);
        if (pRes.richText) cellParts.push(escapeHtmlInsideTableCell(pRes.richText));
        if (pRes.media?.length) tableMedia.push(...pRes.media);
      }

      if (vMergeMode === 'continue') {
        const owner = activeVSpans.get(colCursor);
        if (owner && owner.lastRow === rowIndex - 1) {
          owner.rowSpan += 1;
          owner.lastRow = rowIndex;
          for (let c = colCursor; c < colCursor + colSpan; c++) {
            activeVSpans.set(c, owner);
          }
          colCursor += colSpan;
          continue;
        }
      }

      for (let c = colCursor; c < colCursor + colSpan; c++) {
        activeVSpans.delete(c);
      }

      const cellObj = {
        tag: rowIndex === 0 || isExplicitHeaderRow ? 'th' : 'td',
        colSpan,
        rowSpan: 1,
        lastRow: rowIndex,
        html: cellParts.join('<br>')
      };
      if (vMergeMode === 'restart') {
        for (let c = colCursor; c < colCursor + colSpan; c++) {
          activeVSpans.set(c, cellObj);
        }
      }
      rowCells.push(cellObj);
      colCursor += colSpan;
    }

    if (rowCells.length) {
      parsedRows.push(rowCells);
      rowIndex++;
    }
  }

  const rowsHtml = parsedRows.map((cells) => {
    const rendered = cells.map((c) => {
      const attrs = [];
      if (c.colSpan > 1) attrs.push(`colspan="${c.colSpan}"`);
      if (c.rowSpan > 1) attrs.push(`rowspan="${c.rowSpan}"`);
      const attrStr = attrs.length ? ` ${attrs.join(' ')}` : '';
      return `<${c.tag}${attrStr}>${c.html}</${c.tag}>`;
    });
    return `<tr>${rendered.join('')}</tr>`;
  });

  return {
    html: rowsHtml.length ? `<table>${rowsHtml.join('')}</table>` : '',
    media: tableMedia
  };
}

function parseBodyBlocks(documentXml, ctx) {
  const bodyMatch = /<w:body\b[^>]*>([\s\S]*?)<\/w:body>/i.exec(documentXml);
  const bodyXml = bodyMatch ? bodyMatch[1] : documentXml;
  // Duyệt theo thứ tự <w:tbl> hoặc <w:p> ở cấp body
  const blockRegex = /<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/gi;
  const blocks = [];
  let m;
  while ((m = blockRegex.exec(bodyXml)) !== null) {
    const raw = m[0];
    if (raw.startsWith('<w:tbl')) {
      const tblRes = extractTableHtml(raw, ctx);
      if (tblRes.html) {
        blocks.push({
          kind: 'table',
          plainText: tblRes.html,
          richText: tblRes.html,
          media: tblRes.media
        });
      }
    } else {
      // Word's Shift+Enter creates a line break inside a run. Keep the run's
      // formatting on each side so a command on the next line can be read.
      const splitRuns = raw.replace(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/gi, (run, content) => {
        const lineBreak = /<w:(?:br|cr)\b[^>]*\/>/gi;
        if (!lineBreak.test(content)) return run;
        const props = /^\s*<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/i.exec(content)?.[0] || '';
        return run.replace(lineBreak, `</w:r></w:p><w:p><w:r>${props}`);
      });
      for (const [paragraph] of splitRuns.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/gi)) {
        const pRes = extractParagraphContent(paragraph, ctx);
        if (pRes.plainText || pRes.media.length || pRes.hasOmml || pRes.hasOleObject) {
          blocks.push({ kind: 'paragraph', ...pRes });
        }
      }
    }
  }
  return blocks;
}

function stripLeadingCommandTag(richText, rawTag) {
  const escaped = rawTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^(?:<[^>]+>)*\\s*\\[\\s*${escaped}\\s*\\](?:<\\/[^>]+>)*\\s*`, 'i');
  if (re.test(richText)) return richText.replace(re, '').trim();
  const idx = richText.indexOf(']');
  return idx >= 0 ? richText.slice(idx + 1).trim() : richText.trim();
}

function finalizeQuestion(rawQ, index, examType, errors, warnings) {
  const qNum = index + 1;
  const prompt = (rawQ.promptLines || []).join('\n').trim();
  const solution = (rawQ.solutionLines || []).join('\n').trim();
  const answerRaw = String(rawQ.answerRaw || '').trim();
  const explicitType = normalizeCommandTag(rawQ.explicitType || '');
  const optionEntries = Object.entries(rawQ.options || {}).filter(([, v]) => String(v || '').trim() !== '');
  const statementEntries = (rawQ.statements || []).map(s => String(s || '').trim()).filter(Boolean);
  const cards = (rawQ.cards || []).map(c => String(c || '').trim()).filter(Boolean);
  const blankMatches = [...prompt.matchAll(/\{\{(\d{1,2})\}\}/g)];

  if (!prompt) {
    errors.push(`Câu ${qNum}: Nội dung câu hỏi đang trống.`);
  }
  if (!answerRaw) {
    errors.push(`Câu ${qNum}: Thiếu dòng lệnh [ĐÁP ÁN].`);
  }
  if (!solution) {
    warnings.push(`Câu ${qNum}: Chưa có [LỜI GIẢI].`);
  }

  let type = 'short';
  if (cards.length > 0 && blankMatches.length > 0) {
    type = 'drag_drop';
  } else if (blankMatches.length > 0) {
    type = 'fill_blank';
  } else if (explicitType === 'NHIEU DAP AN') {
    type = 'multiple';
  } else if (explicitType === 'DUNG SAI' || statementEntries.length > 0) {
    type = 'true_false';
  } else if (optionEntries.length > 0) {
    type = 'single';
  }

  const defaultPoints = examType === 'thptqg'
    ? (type === 'single' ? 0.25 : type === 'true_false' ? 1.0 : 0.5)
    : 1.0;

  const question = {
    id: `q_${qNum}`,
    order: qNum,
    type,
    prompt,
    points: defaultPoints,
    solution,
    section: rawQ.section || 'part_1',
    subject: rawQ.subject || '',
    clusterId: rawQ.clusterId || null,
    passageId: rawQ.passageId || null,
    passageContent: rawQ.passageContent || '',
    passageMedia: rawQ.passageMedia || [],
    media: rawQ.media || [],
    sourceRef: { rawAnswer: answerRaw, note: rawQ.note || '' }
  };

  if (type === 'single') {
    const letters = ['A', 'B', 'C', 'D'];
    question.options = letters.map(k => String(rawQ.options?.[k] || '').trim());
    if (question.options.some(o => !o)) {
      errors.push(`Câu ${qNum}: Câu trắc nghiệm 1 đáp án cần đủ 4 phương án [A], [B], [C], [D].`);
    }
    const ans = answerRaw.toUpperCase().replace(/[^A-D]/g, '');
    question.answer = ans.length === 1 ? ans : answerRaw.toUpperCase();
    if (!letters.includes(question.answer)) {
      errors.push(`Câu ${qNum}: [ĐÁP ÁN] "${answerRaw}" không hợp lệ (cần A, B, C hoặc D).`);
    }
  } else if (type === 'multiple') {
    const orderedKeys = ['A', 'B', 'C', 'D', 'E', 'F'].filter(k => rawQ.options?.[k] !== undefined);
    question.options = orderedKeys.map(k => String(rawQ.options[k] || '').trim());
    if (question.options.length < 2) {
      errors.push(`Câu ${qNum}: Câu [DẠNG] NHIỀU ĐÁP ÁN cần ít nhất 2 phương án.`);
    }
    const ansTokens = answerRaw
      .toUpperCase()
      .split(/[,;\s]+/)
      .map(s => s.trim())
      .filter(Boolean);
    question.answers = ansTokens;
    const validLetters = 'ABCDEF'.slice(0, question.options.length);
    if (!ansTokens.length || ansTokens.some(a => a.length !== 1 || !validLetters.includes(a))) {
      errors.push(`Câu ${qNum}: [ĐÁP ÁN] "${answerRaw}" không khớp với các phương án hiện có.`);
    }
  } else if (type === 'true_false') {
    question.statements = statementEntries.length ? statementEntries : [prompt];
    const m = question.statements.length;
    const tokens = answerRaw
      .trim()
      .split(/[\s,;-]+/)
      .map(t => stripDiacritics(t).toUpperCase())
      .filter(Boolean);
    question.answers = tokens.map(t => (t === 'D' || t === 'TRUE' ? true : t === 'S' || t === 'FALSE' ? false : null));
    if (question.answers.length !== m || question.answers.some(x => typeof x !== 'boolean')) {
      errors.push(`Câu ${qNum}: [ĐÁP ÁN] "${answerRaw}" cần đúng ${m} giá trị Đ hoặc S.`);
      question.answers = Array.from({ length: m }, (_, i) => Boolean(question.answers[i]));
    }
    question.weights = examType === 'thptqg' && m === 4
      ? [0, 0.1, 0.25, 0.5, 1]
      : [...Array(m).fill(0), 1];
  } else if (type === 'short') {
    const accepted = answerRaw
      .split(/\s*\|\s*|\s*;\s*/)
      .map(s => s.trim())
      .filter(Boolean);
    question.accepted = accepted.length ? accepted : (answerRaw ? [answerRaw] : []);
    if (!question.accepted.length) {
      errors.push(`Câu ${qNum}: Thiếu đáp án trả lời ngắn.`);
    }
  } else if (type === 'fill_blank') {
    const slotCount = blankMatches.length;
    const groupMatches = [...answerRaw.matchAll(/\((\d{1,2})\)\s*([^()]+?)(?=\s*;\s*\(\d{1,2}\)|\s+\(\d{1,2}\)|$)/g)];
    const blanks = [];
    if (groupMatches.length > 0) {
      const byIndex = new Map();
      for (const gm of groupMatches) {
        const idx = Number(gm[1]);
        const rawVals = gm[2].replace(/[;\s]+$/, '').split(/\s*\|\s*/).map(s => s.trim()).filter(Boolean);
        byIndex.set(idx, rawVals);
      }
      for (let i = 1; i <= slotCount; i++) {
        const list = byIndex.get(i) || [];
        if (!list.length) errors.push(`Câu ${qNum}: Thiếu đáp án cho ô trống {{${i}}}.`);
        const isNum = list.every(v => /^-?\d+(?:[.,/]\d+)?$/.test(v));
        blanks.push({ accepted: list.length ? list : [''], kind: isNum ? 'number' : 'text' });
      }
    } else if (slotCount === 1 && answerRaw) {
      const list = answerRaw.split(/\s*\|\s*/).map(s => s.trim()).filter(Boolean);
      const isNum = list.every(v => /^-?\d+(?:[.,/]\d+)?$/.test(v));
      blanks.push({ accepted: list, kind: isNum ? 'number' : 'text' });
    } else {
      errors.push(`Câu ${qNum}: Cách ghi [ĐÁP ÁN] điền khuyết cần theo mẫu (1) ...; (2) ... khớp với ${slotCount} ô trống.`);
      for (let i = 1; i <= slotCount; i++) blanks.push({ accepted: [''], kind: 'text' });
    }
    question.blanks = blanks;
  } else if (type === 'drag_drop') {
    question.cards = cards;
    const slotCount = blankMatches.length;
    const groupMatches = [...answerRaw.matchAll(/\((\d{1,2})\)\s*(T\d{1,2})/gi)];
    let tokens = [];
    if (groupMatches.length === slotCount) {
      const byIdx = new Map(groupMatches.map(gm => [Number(gm[1]), gm[2].toUpperCase()]));
      tokens = Array.from({ length: slotCount }, (_, i) => byIdx.get(i + 1) || '');
    } else {
      tokens = (answerRaw.match(/T\d{1,2}/gi) || []).map(t => t.toUpperCase());
    }
    if (tokens.length !== slotCount || tokens.some(t => !t || Number(t.slice(1)) < 1 || Number(t.slice(1)) > cards.length)) {
      errors.push(`Câu ${qNum}: [ĐÁP ÁN] kéo thả "${answerRaw}" không khớp với ${slotCount} ô trống hoặc vượt quá số thẻ [THẺ] (${cards.length} thẻ).`);
    }
    question.answer = tokens;
  }

  return question;
}

function parseNormalExamBlocks(blocks, { meta, options, errors, warnings }) {
  const rawQuestions = [];
  const answerKeyByNum = new Map();
  let hasExamTypeCommand = false;
  let currentSection = 'part_1';
  let currentSubject = '';
  let currentPassage = null;
  let passageCounter = 0;
  let currentQuestion = null;
  let activeField = null; // 'passage' | 'prompt' | 'option:A' | 'statement:0' | 'cards' | 'solution' | 'answer_table'

  const stripHtmlTags = (s) => String(s || '').replace(/<\/?(?:strong|em|u|sup|sub|b|i)\b[^>]*>/gi, '').trim();

  const detectSubjectFromHeader = (asciiUpper) => {
    const patterns = [
      { re: /\b(?:MON|CHU\s*DE|LINH\s*VUC)\s*[:.-]?\s*(VAT\s*LI|VAT\s*LY|PHYSICS)\b|^VAT\s*L[IY]$/i, subj: 'physics' },
      { re: /\b(?:MON|CHU\s*DE|LINH\s*VUC)\s*[:.-]?\s*(HOA\s*HOC|CHEMISTRY)\b|^HOA\s*HOC$/i, subj: 'chemistry' },
      { re: /\b(?:MON|CHU\s*DE|LINH\s*VUC)\s*[:.-]?\s*(SINH\s*HOC|BIOLOGY)\b|^SINH\s*HOC$/i, subj: 'biology' },
      { re: /\b(?:MON|CHU\s*DE|LINH\s*VUC)\s*[:.-]?\s*(LICH\s*SU|HISTORY)\b|^LICH\s*SU$/i, subj: 'history' },
      { re: /\b(?:MON|CHU\s*DE|LINH\s*VUC)\s*[:.-]?\s*(DIA\s*LI|DIA\s*LY|GEOGRAPHY)\b|^DIA\s*L[IY]$/i, subj: 'geography' },
      { re: /\b(?:MON|CHU\s*DE|LINH\s*VUC)\s*[:.-]?\s*(TIENG\s*ANH|ENGLISH)\b|^TIENG\s*ANH$/i, subj: 'english' }
    ];
    for (const p of patterns) {
      if (p.re.test(asciiUpper)) return p.subj;
    }
    return '';
  };

  const inferHsaSubjectByQNum = (qNum) => {
    if (!Number.isFinite(qNum)) return '';
    if (qNum >= 101 && qNum <= 150) return 'physics';
    if (qNum >= 201 && qNum <= 250) return 'chemistry';
    if (qNum >= 301 && qNum <= 350) return 'biology';
    if (qNum >= 401 && qNum <= 450) return 'history';
    if (qNum >= 501 && qNum <= 550) return 'geography';
    if (qNum >= 601 && qNum <= 660) return 'english';
    return '';
  };

  const extractAnswerPairsFromLine = (text) => {
    const clean = stripHtmlTags(text);
    if (!clean || /<table\b/i.test(clean)) return 0;
    const pairRe = /\b(\d{1,3})\s*[.:)-]\s*([A-F](?:\s*,\s*[A-F])*|[ĐDS](?:[\s,;-]+[ĐDS]){1,4}|-?\d+(?:[.,/]\d+)?)\b/gi;
    const matches = [...clean.matchAll(pairRe)];
    if (matches.length >= 2) {
      for (const m of matches) {
        const num = Number(m[1]);
        const val = m[2].trim();
        if (num >= 1 && num <= 999 && !answerKeyByNum.has(num)) {
          answerKeyByNum.set(num, val);
        }
      }
      return matches.length;
    }
    return 0;
  };

  const extractAnswerPairsFromTable = (tableHtml) => {
    const cellTexts = [...String(tableHtml || '').matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)]
      .map((m) => stripHtmlTags(m[1]).replace(/<br\s*\/?>/gi, ' ').trim())
      .filter(Boolean);
    let count = 0;
    for (const cell of cellTexts) {
      const m = /^(\d{1,3})\s*[.:)-]\s*([A-F](?:\s*,\s*[A-F])*|[ĐDS](?:[\s,;-]+[ĐDS]){1,4}|-?\d+(?:[.,/]\d+)?)$/i.exec(cell);
      if (m) {
        const num = Number(m[1]);
        if (!answerKeyByNum.has(num)) answerKeyByNum.set(num, m[2].trim());
        count++;
      }
    }
    if (count >= 2) return count;
    // Kiểm tra bảng 2 hàng: Hàng trên là Câu 1, 2, 3... Hàng dưới là Đáp án A, B, C...
    const rows = [...String(tableHtml || '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((rm) =>
      [...rm[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cm) =>
        stripHtmlTags(cm[1]).replace(/<br\s*\/?>/gi, ' ').trim()
      )
    );
    for (let r = 0; r + 1 < rows.length; r++) {
      const rTop = rows[r];
      const rBot = rows[r + 1];
      if (rTop.length >= 3 && rTop.length === rBot.length) {
        let rowMatches = 0;
        const pairs = [];
        for (let c = 0; c < rTop.length; c++) {
          const numMatch = /^(?:C[aâ]u\s*)?(\d{1,3})$/i.exec(stripDiacritics(rTop[c]));
          const ansMatch = /^([A-F](?:\s*,\s*[A-F])*|[ĐDS](?:[\s,;-]+[ĐDS]){1,4}|-?\d+(?:[.,/]\d+)?)$/i.exec(rBot[c]);
          if (numMatch && ansMatch) {
            rowMatches++;
            pairs.push([Number(numMatch[1]), ansMatch[1].trim()]);
          }
        }
        if (rowMatches >= 2) {
          for (const [k, v] of pairs) {
            if (!answerKeyByNum.has(k)) answerKeyByNum.set(k, v);
          }
          count += rowMatches;
          r++;
        }
      }
    }
    return count;
  };

  const normalizeInlineBlanksInLine = (line) => {
    let slotCounter = 0;
    return line;
  };

  const pushCurrentQuestion = () => {
    if (!currentQuestion) return;
    // Chuẩn hóa các ô trống ____ hoặc [...] hoặc (...) trong thân câu thành {{1}}, {{2}}...
    let joinedPrompt = (currentQuestion.promptLines || []).join('\n').trim();
    const existingSlots = [...joinedPrompt.matchAll(/\{\{(\d{1,2})\}\}/g)];
    let nextSlot = existingSlots.length
      ? Math.max(...existingSlots.map((m) => Number(m[1]))) + 1
      : 1;

    if (
      /_{3,}|\.\.\.\.\.+|…{2,}|\(\s*_{2,}\s*\)|\[\s*_{2,}\s*\]/.test(joinedPrompt) ||
      currentQuestion.hasDragHint ||
      currentQuestion.hasFillHint
    ) {
      joinedPrompt = joinedPrompt.replace(
        /\(\s*(\d{1,2})\s*\)\s*_{2,}|\[\s*(\d{1,2})\s*\]\s*_{2,}|\(\s*_{2,}\s*\)|\[\s*_{2,}\s*\]|_{3,}/g,
        (_, g1, g2) => {
          const idx = g1 ? Number(g1) : g2 ? Number(g2) : nextSlot++;
          if (idx >= nextSlot) nextSlot = idx + 1;
          return `{{${idx}}}`;
        }
      );
      currentQuestion.promptLines = [joinedPrompt];
    }

    // Nếu chưa có answerRaw nhưng có đánh dấu gạch chân / tô màu phương án A, B, C, D
    if (!currentQuestion.answerRaw && currentQuestion.markedOptions?.size > 0) {
      const marked = [...currentQuestion.markedOptions].filter((k) => currentQuestion.options[k] !== undefined);
      if (marked.length === 1 && !currentQuestion.explicitType) {
        currentQuestion.answerRaw = marked[0];
      } else if (marked.length > 1) {
        if (!currentQuestion.explicitType) currentQuestion.explicitType = 'NHIEU DAP AN';
        currentQuestion.answerRaw = marked.join(', ');
      }
    }

    // Nếu câu hỏi là kéo thả có thẻ cards và đáp án đang viết bằng chữ của thẻ (vd: "dòng điện ; từ trường ; ủng hộ" hoặc "-12 ; 54 ; 136")
    const finalPrompt = (currentQuestion.promptLines || []).join('\n').trim();
    const blankCount = [...finalPrompt.matchAll(/\{\{(\d{1,2})\}\}/g)].length;
    if (blankCount > 0 && currentQuestion.cards.length > 0 && currentQuestion.answerRaw) {
      const hasTCode = /\bT\d{1,2}\b/i.test(currentQuestion.answerRaw);
      if (!hasTCode) {
        const rawParts = currentQuestion.answerRaw
          .split(/\s*;\s*|\s*,\s*(?![0-9])/)
          .map((s) => s.replace(/^\(\d{1,2}\)\s*/, '').trim())
          .filter(Boolean);
        if (rawParts.length === blankCount) {
          const mappedTokens = rawParts.map((part) => {
            const normPart = stripDiacritics(stripHtmlTags(part)).replace(/\$/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
            const cardIdx = currentQuestion.cards.findIndex((c) => {
              const normCard = stripDiacritics(stripHtmlTags(c)).replace(/\$/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
              return normCard === normPart;
            });
            return cardIdx >= 0 ? `T${cardIdx + 1}` : '';
          });
          if (mappedTokens.every(Boolean)) {
            currentQuestion.answerRaw = mappedTokens.map((t, i) => `(${i + 1}) ${t}`).join('; ');
          }
        }
      }
    } else if (blankCount > 1 && currentQuestion.cards.length === 0 && currentQuestion.answerRaw) {
      // Câu điền khuyết nhiều ô trống mà đáp án ghi dạng "-12 ; 54 ; 136" chưa có (1) ...; (2) ...
      if (!/\(\d{1,2}\)/.test(currentQuestion.answerRaw)) {
        const rawParts = currentQuestion.answerRaw
          .split(/\s*;\s*/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (rawParts.length === blankCount) {
          currentQuestion.answerRaw = rawParts.map((p, i) => `(${i + 1}) ${p}`).join('; ');
        }
      }
    }

    rawQuestions.push(currentQuestion);
    currentQuestion = null;
    activeField = null;
  };

  const splitInlineOptions = (plainLine, richLine) => {
    // Tách dòng có chứa nhiều phương án A. ... B. ... C. ... D. ...
    const optStartRe = /(?:^|\s{2,}|\t+)(\*|_)?([A-F])\s*[.)]\s+/g;
    const matches = [...plainLine.matchAll(optStartRe)];
    if (matches.length < 2 || matches[0].index > 4) return null;
    const letters = matches.map((m) => m[2].toUpperCase());
    if (letters[0] !== 'A' && letters[0] !== 'B' && letters[0] !== 'C') return null;

    // Dùng richLine nếu tách được tương ứng, nếu không dùng plainLine
    const richOptRe = /(?:^|\s+)(?:<(?:strong|b|u|em|i)>)*\s*(\*|_)?([A-F])\s*[.)](?:<\/(?:strong|b|u|em|i)>)*\s+/g;
    const richMatches = [...richLine.matchAll(richOptRe)];
    const out = [];
    if (richMatches.length === matches.length) {
      for (let i = 0; i < richMatches.length; i++) {
        const marked = Boolean(richMatches[i][1] || matches[i][1]);
        const key = richMatches[i][2].toUpperCase();
        const start = richMatches[i].index + richMatches[i][0].length;
        const end = i + 1 < richMatches.length ? richMatches[i + 1].index : richLine.length;
        out.push({ key, val: richLine.slice(start, end).trim(), marked });
      }
    } else {
      for (let i = 0; i < matches.length; i++) {
        const marked = Boolean(matches[i][1]);
        const key = matches[i][2].toUpperCase();
        const start = matches[i].index + matches[i][0].length;
        const end = i + 1 < matches.length ? matches[i + 1].index : plainLine.length;
        out.push({ key, val: plainLine.slice(start, end).trim(), marked });
      }
    }
    return out;
  };

  for (const block of blocks) {
    const plain = String(block.plainText || '').trim();
    const rich = String(block.richText || '').trim();
    const ascii = stripDiacritics(plain);
    const asciiUpper = ascii.toUpperCase().replace(/\s+/g, ' ').trim();

    if (block.hasOmml || block.hasOleObject) {
      errors.push('Phát hiện công thức Equation của Word hoặc MathType chưa chuyển sang LaTeX ($...$).');
    }
    if (block.hasFloatingDrawing) {
      warnings.push('Phát hiện hình ảnh để chế độ trôi nổi (Floating). Nên đổi sang chế độ In Line with Text để đúng vị trí.');
    }

    if (block.kind === 'table') {
      const pairsCount = extractAnswerPairsFromTable(plain);
      if (pairsCount >= 2 && (!currentQuestion || activeField === 'answer_table')) {
        continue;
      }
      if (activeField === 'passage' && currentPassage) {
        currentPassage.lines.push(rich);
        if (block.media?.length) currentPassage.media.push(...block.media);
      } else if (currentQuestion) {
        if (block.media?.length) {
          const taggedMedia = activeField === 'solution'
            ? block.media.map((m) => ({ ...m, inSolution: true }))
            : block.media;
          currentQuestion.media.push(...taggedMedia);
        }
        if (activeField === 'solution') {
          currentQuestion.solutionLines.push(rich);
        } else {
          currentQuestion.promptLines.push(rich);
        }
      }
      continue;
    }

    if (!plain && !block.media?.length) continue;

    // 0. Nhận diện thông tin đầu đề (Kỳ thi, Mã đề, Khối, Tiêu đề) nếu chưa vào câu hỏi nào
    if (rawQuestions.length === 0 && !currentQuestion) {
      const codeMatch = /\bMA\s*DE(?:\s*THI)?\s*[:.-]?\s*([A-Za-z0-9_-]{1,12})\b/i.exec(ascii);
      if (codeMatch && !meta.examCode) {
        meta.examCode = codeMatch[1];
      }
      const gradeMatch = /\b(?:KHOI|LOP|TOAN)\s*(10|11|12)\b/i.exec(ascii);
      if (gradeMatch && !meta.grade) {
        meta.grade = Number(gradeMatch[1]);
      }
      if (!meta.examType) {
        if (/\b(?:HSA|DANH\s*GIA\s*NANG\s*LUC|DHQGHN)\b/i.test(ascii)) {
          meta.examType = 'hsa';
        } else if (/\b(?:TSA|DANH\s*GIA\s*TU\s*DUY|BACH\s*KHOA)\b/i.test(ascii)) {
          meta.examType = 'tsa';
        } else if (/\b(?:THPT\s*QG|TOT\s*NGHIEP\s*THPT|THPT\s*QUOC\s*GIA)\b/i.test(ascii)) {
          meta.examType = 'thptqg';
        }
      }
      if (!meta.title && /^(?:DE\s+(?:THI|LUYEN|THAM\s*KHAO|MINH\s*HOA|ON\s*TAP)|KY\s*THI)\b/i.test(ascii) && plain.length <= 140) {
        meta.title = stripHtmlTags(plain);
      }
    }

    // 1. Nhận diện tiêu đề Bảng đáp án ở đầu hoặc cuối đề
    if (/^(?:BANG\s+DAP\s+AN|DAP\s+AN\s+THAM\s+KHAO|DAP\s+AN\s+CHINH\s+THUC|DAP\s+AN\s+DE\s+THI)\b/i.test(asciiUpper)) {
      pushCurrentQuestion();
      currentPassage = null;
      activeField = 'answer_table';
      continue;
    }
    if (extractAnswerPairsFromLine(plain) >= 3) {
      if (activeField === 'answer_table' || (!currentQuestion && rawQuestions.length === 0)) {
        continue;
      }
    }

    // 2. Nhận diện Phần thi (PHẦN I / PHẦN 1 / Phần thi thứ nhất...)
    const secRomanOrNumMatch = /^(?:PHAN(?:\s+THI)?)\s*(?:THU\s*)?(I{1,3}|[123]|MOT|NHAT|HAI|BA)\b/i.exec(asciiUpper);
    if (secRomanOrNumMatch) {
      pushCurrentQuestion();
      const tok = secRomanOrNumMatch[1].toUpperCase();
      if (tok === 'I' || tok === '1' || tok === 'MOT' || tok === 'NHAT') currentSection = 'part_1';
      else if (tok === 'II' || tok === '2' || tok === 'HAI') currentSection = 'part_2';
      else if (tok === 'III' || tok === '3' || tok === 'BA') currentSection = 'part_3';
      currentSubject = detectSubjectFromHeader(asciiUpper) || '';
      currentPassage = null;
      activeField = null;
      continue;
    }

    // Nhận diện tiêu đề Phần bằng tên đặc trưng của HSA / TSA
    if (/^(?:TU\s*DUY\s*DINH\s*LUONG|TOAN\s*HOC\s*VA\s*XU\s*L[IY]\s*SO\s*LIEU|TU\s*DUY\s*TOAN\s*HOC)\b/i.test(asciiUpper) && plain.length <= 120) {
      pushCurrentQuestion();
      currentSection = 'part_1';
      currentSubject = '';
      currentPassage = null;
      activeField = null;
      continue;
    }
    if (/^(?:TU\s*DUY\s*DINH\s*TINH|NGON\s*NGU\s*[-–]\s*VAN\s*HOC|TU\s*DUY\s*DOC\s*HIEU)\b/i.test(asciiUpper) && plain.length <= 120) {
      pushCurrentQuestion();
      currentSection = 'part_2';
      currentSubject = '';
      currentPassage = null;
      activeField = null;
      continue;
    }
    if (/^(?:TU\s*DUY\s*KHOA\s*HOC|KHOA\s*HOC\s*\/?\s*GIAI\s*QUYET\s*VAN\s*DE)\b/i.test(asciiUpper) && plain.length <= 120) {
      pushCurrentQuestion();
      currentSection = 'part_3';
      currentSubject = detectSubjectFromHeader(asciiUpper) || '';
      currentPassage = null;
      activeField = null;
      continue;
    }

    // 3. Nhận diện Môn thi Phần 3 HSA (Chủ đề Vật lí có 17 câu hỏi..., Môn Hóa học, VẬT LÝ...)
    const detectedSubj = detectSubjectFromHeader(asciiUpper);
    if (detectedSubj && plain.length <= 120 && !/^CAU\s+\d+/i.test(asciiUpper)) {
      pushCurrentQuestion();
      currentSection = 'part_3';
      currentSubject = detectedSubj;
      currentPassage = null;
      activeField = null;
      continue;
    }

    // 4. Nhận diện mở đầu Ngữ liệu đọc hiểu / chùm câu hỏi (Đọc đoạn trích..., Dựa vào thông tin... trả lời các câu từ X đến Y)
    const rangeMatch = /(?:tra\s*loi|answer|fill\s*in)[^.\n]{0,60}?(?:tu\s*(?:cau\s*(?:hoi\s*)?(?:so\s*)?)?|from\s*(?:question\s*)?)(\d{1,3})\s*(?:den|to|[-–])\s*(?:cau\s*(?:hoi\s*)?(?:so\s*)?)?(\d{1,3})\b/i.exec(ascii);
    const listRangeMatch = !rangeMatch
      ? /tra\s*loi\s*(?:cho\s*)?cac\s*cau\s*(\d{1,3}(?:\s*,\s*\d{1,3})+)/i.exec(ascii)
      : null;
    const isPassageIntro =
      Boolean(rangeMatch || listRangeMatch) ||
      (/^(?:DOC\s+(?:DOAN\s+TRICH|VAN\s+BAN|NGU\s+CANH|TU\s+LIEU|THONG\s+TIN)|DUA\s+VAO\s+(?:THONG\s+TIN|BANG\s+SO\s+LIEU|BAN\s+DO|QUY\s+TRINH)|SU\s+DUNG\s+(?:CAC\s+)?THONG\s+TIN|CLOZE\s+TEXT|READING\s+COMPREHENSION)\b/i.test(asciiUpper) &&
        /(?:TRA\s*LOI|CAU\s*HOI|PASSAGE|BLANK|QUESTION)/i.test(asciiUpper));

    if (isPassageIntro && (!currentQuestion || activeField !== 'solution')) {
      let targetStart = null;
      let targetEnd = null;
      let targetCount = null;
      if (rangeMatch) {
        targetStart = Number(rangeMatch[1]);
        targetEnd = Number(rangeMatch[2]);
        if (targetEnd >= targetStart && targetEnd - targetStart <= 25) {
          targetCount = targetEnd - targetStart + 1;
        }
      } else if (listRangeMatch) {
        const nums = listRangeMatch[1].split(',').map((n) => Number(n.trim())).filter(Number.isFinite);
        if (nums.length >= 2) {
          targetStart = Math.min(...nums);
          targetEnd = Math.max(...nums);
          targetCount = nums.length;
        }
      }

      if (activeField === 'passage' && currentPassage && currentPassage.questionCount === 0) {
        // Dòng kiểu "Trả lời cho các câu 41, 42... dưới đây:" nằm ở cuối đoạn văn ngữ liệu
        currentPassage.lines.push(rich);
        if (block.media?.length) currentPassage.media.push(...block.media);
        if (targetEnd) currentPassage.targetEnd = targetEnd;
        if (targetCount) currentPassage.expectedCount = targetCount;
        continue;
      }

      pushCurrentQuestion();
      passageCounter++;
      currentPassage = {
        id: `passage_${passageCounter}`,
        clusterId: `cluster_${passageCounter}`,
        lines: [rich],
        media: [...(block.media || [])],
        questionCount: 0,
        targetStart,
        targetEnd,
        expectedCount: targetCount
      };
      activeField = 'passage';
      continue;
    }

    if (/^(?:HET\s+NGU\s+LIEU|KET\s+THUC\s+NGU\s+LIEU)\b/i.test(asciiUpper)) {
      pushCurrentQuestion();
      currentPassage = null;
      activeField = null;
      continue;
    }

    // 5. Nhận diện bắt đầu Câu hỏi mới: "Câu 1:", "Câu 1.", "Câu 1 (TH):", "Question 1:", "Bài 1."
    const qStartMatch = /^(?:CAU(?:\s+HOI)?|QUESTION|BAI)\s*(\d{1,3})\s*(?:\([^)]{1,20}\))?\s*[:.)-]?\s*(.*)$/is.exec(ascii);
    if (qStartMatch) {
      pushCurrentQuestion();
      const origQNum = Number(qStartMatch[1]);

      // Tự động suy luận phần/môn theo mã số câu chuẩn HSA (1-50, 51-100, 101-117, 201-217...)
      const inferredHsaSubj = inferHsaSubjectByQNum(origQNum);
      if (inferredHsaSubj) {
        currentSection = 'part_3';
        currentSubject = inferredHsaSubj;
      } else if ((meta.examType === 'hsa' || options.expectedExamType === 'hsa') && origQNum >= 51 && origQNum <= 100 && currentSection === 'part_1') {
        currentSection = 'part_2';
      }

      // Kiểm tra xem câu hỏi này có còn nằm trong phạm vi của chùm ngữ liệu đang mở không
      if (currentPassage) {
        const exceededEnd = currentPassage.targetEnd && origQNum > currentPassage.targetEnd;
        const exceededCount =
          !currentPassage.targetEnd &&
          currentPassage.expectedCount &&
          currentPassage.questionCount >= currentPassage.expectedCount;
        if (exceededEnd || exceededCount) {
          currentPassage = null;
        }
      }
      if (currentPassage) currentPassage.questionCount++;

      // Bóc tiền tố "Câu X (TH):" khỏi richText để không lặp nhãn
      const richPromptRem = rich
        .replace(
          /^(?:<(?:strong|b|em|i|u)>)*\s*(?:C[aâ]u(?:\s+h[oỏ]i)?|Question|B[aà]i)\s*\d{1,3}\s*(?:\([^)]{1,20}\))?\s*[:.)-]?\s*(?:<\/(?:strong|b|em|i|u)>)*\s*/i,
          ''
        )
        .replace(/^\[[A-Z0-9\s_-]{2,25}\]\s*/i, '') // Bỏ tag nguồn kiểu [EMPIRE TEAM] ở đầu câu nếu có
        .trim();

      const normRemAscii = stripDiacritics(richPromptRem).toUpperCase();
      const hasMultipleHint = /\b(?:CHON\s+(?:CAC|NHUNG|HAI|BA|2|3)\s+(?:DAP\s+AN|PHUONG\s+AN|NHAN\s+DINH|PHAT\s+BIEU)|NHUNG\s+(?:PHAT\s+BIEU|KHANG\s+DINH|NHAN\s+DINH)\s+NAO\s+SAU\s+DAY\s+(?:LA\s+)?DUNG)/i.test(normRemAscii);
      const hasDragHint = /\b(?:KEO\s+(?:O|THA|CAC\s+O|BIEU\s+THUC)|THA\s+VAO\s+VI\s+TRI)\b/i.test(normRemAscii);
      const hasFillHint = /\b(?:DIEN\s+(?:TU|CUM\s+TU|SO|DAP\s+AN|VAO\s+CHO\s+TRONG))\b/i.test(normRemAscii);

      currentQuestion = {
        origQNum,
        section: currentSection,
        subject: currentSubject,
        clusterId: currentPassage ? currentPassage.clusterId : null,
        passageId: currentPassage ? currentPassage.id : null,
        passageContent: currentPassage ? currentPassage.lines.join('\n').trim() : '',
        passageMedia: currentPassage ? [...currentPassage.media] : [],
        promptLines: richPromptRem ? [richPromptRem] : [],
        options: {},
        markedOptions: new Set(),
        statements: [],
        cards: [],
        explicitType: hasMultipleHint ? 'NHIEU DAP AN' : '',
        hasDragHint,
        hasFillHint,
        answerRaw: '',
        solutionLines: [],
        note: '',
        media: [...(block.media || [])]
      };
      activeField = 'prompt';
      continue;
    }

    if (!currentQuestion) {
      if (activeField === 'passage' && currentPassage) {
        currentPassage.lines.push(rich);
        if (block.media?.length) currentPassage.media.push(...block.media);
      }
      continue;
    }

    // 6. Đang bên trong một câu hỏi: kiểm tra các dòng chỉ dẫn dạng câu đặc thù (Kéo thả, Chọn nhiều đáp án, Đúng/Sai)
    if (activeField === 'prompt') {
      if (/\b(?:KEO\s+(?:O|THA|CAC\s+O|BIEU\s+THUC)|THA\s+VAO\s+VI\s+TRI)\b/i.test(asciiUpper)) {
        currentQuestion.hasDragHint = true;
      }
      if (/\b(?:DIEN\s+(?:TU|CUM\s+TU|SO|DAP\s+AN|VAO\s+CHO\s+TRONG))\b/i.test(asciiUpper)) {
        currentQuestion.hasFillHint = true;
      }
      if (/\b(?:CHON\s+(?:CAC|NHUNG|HAI|BA|2|3)\s+(?:DAP\s+AN|PHUONG\s+AN|NHAN\s+DINH))\b/i.test(asciiUpper)) {
        currentQuestion.explicitType = 'NHIEU DAP AN';
      }
    }

    // Bỏ qua dòng tiêu đề cột "ĐÚNG SAI" của bảng mệnh đề trong đề TSA
    if (/^DUNG\s+SAI$/i.test(asciiUpper)) {
      if (!currentQuestion.explicitType) currentQuestion.explicitType = 'DUNG SAI';
      continue;
    }

    // Nhận diện dòng "Đáp án: ..." hoặc "Đáp án đúng là: ..." hoặc "Đáp án cần chọn là: ..." hoặc "Đáp số: ..."
    const ansLineMatch = /^(?:DAP\s*AN(?:\s*(?:DUNG|CAN\s*CHON|CAN\s*DIEN|CHINH\s*THUC))?(?:\s*LA)?|DAP\s*SO|KEY)\s*[:.-]?\s*(.*)$/i.exec(ascii);
    if (ansLineMatch) {
      const rawVal = stripHtmlTags(plain)
        .replace(/^[^:.-]+[:.-]\s*/, '')
        .replace(/^[_\s-]+$/, '')
        .trim();

      if (rawVal) {
        // Kiểm tra định dạng "a - Đúng, b - Đúng, c - Đúng, d - Sai" hoặc "a) Đ, b) S, c) Đ, d) Đ"
        const tfPairs = [...stripDiacritics(rawVal).matchAll(/\b[a-e]\s*(?:[).-]|-+)\s*(DUNG|SAI|TRUE|FALSE|D|S)\b/gi)];
        if (tfPairs.length >= 2) {
          currentQuestion.answerRaw = tfPairs
            .map((m) => (m[1].toUpperCase().startsWith('D') || m[1].toUpperCase().startsWith('T') ? 'Đ' : 'S'))
            .join(' ');
        } else if (/^(?:[ĐDS]\s*[;,-]\s*)+[ĐDS]$/i.test(stripDiacritics(rawVal))) {
          currentQuestion.answerRaw = stripDiacritics(rawVal)
            .toUpperCase()
            .split(/[\s,;-]+/)
            .filter(Boolean)
            .map((t) => (t === 'D' ? 'Đ' : t))
            .join(' ');
        } else if (!currentQuestion.answerRaw) {
          currentQuestion.answerRaw = rawVal.replace(/\.$/, '').trim();
        }
      }
      continue;
    }

    // Nhận diện dòng "Lời giải", "Giải chi tiết", "Phương pháp giải", "Hướng dẫn giải"
    const solLineMatch = /^(?:LOI\s*GIAI(?:\s*CHI\s*TIET)?|GIAI\s*CHI\s*TIET|HUONG\s*DAN\s*GIAI|PHUONG\s*PHAP\s*GIAI)\s*[:.-]?\s*(.*)$/i.exec(ascii);
    if (solLineMatch) {
      const remRich = rich
        .replace(
          /^(?:<(?:strong|b|em|i|u)>)*\s*(?:L[ơờ]i\s*gi[aả]i(?:\s*chi\s*ti[eế]t)?|Gi[aả]i\s*chi\s*ti[eế]t|H[ưươ]ng\s*d[aẫ]n\s*gi[aả]i|Ph[ưươ]ng\s*ph[aá]p\s*gi[aả]i)\s*[:.-]?\s*(?:<\/(?:strong|b|em|i|u)>)*\s*/i,
          ''
        )
        .trim();
      if (remRich) currentQuestion.solutionLines.push(remRich);
      if (block.media?.length) {
        currentQuestion.media.push(...block.media.map((m) => ({ ...m, inSolution: true })));
      }
      activeField = 'solution';
      continue;
    }

    // Nhận diện dòng thẻ kéo thả: "[THẺ] ..." hoặc "Các thẻ/ô đáp án: A ; B ; C ; D"
    const cardsLineMatch = /^(?:CAC\s*(?:THE|O)(?:\s*DAP\s*AN|\s*KEO\s*THA)?|DANH\s*SACH\s*(?:THE|O)|THE\s*KEO\s*THA)\s*[:.-]\s*(.+)$/i.exec(ascii);
    if (cardsLineMatch) {
      const rawCardsText = stripHtmlTags(plain).replace(/^[^:.-]+[:.-]\s*/, '').trim();
      const parts = rawCardsText.split(/\s*[;|]\s*/).map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 2) {
        currentQuestion.cards.push(...parts);
      }
      continue;
    }

    // Nhận diện nhiều phương án trên cùng 1 dòng (A. ... B. ... C. ... D. ...)
    if (activeField !== 'solution') {
      const inlineOpts = splitInlineOptions(plain, rich);
      if (inlineOpts && inlineOpts.length >= 2) {
        for (const { key, val, marked } of inlineOpts) {
          currentQuestion.options[key] = val;
          if (marked) currentQuestion.markedOptions.add(key);
        }
        if (block.markedOptions?.length) {
          for (const mk of block.markedOptions) currentQuestion.markedOptions.add(mk);
        }
        if (block.media?.length) currentQuestion.media.push(...block.media);
        activeField = `option:${inlineOpts[inlineOpts.length - 1].key}`;
        continue;
      }

      // Nhận diện 1 phương án đứng đầu dòng: "A. ...", "B) ...", "*C. ..."
      const singleOptMatch = /^(\*|_)?([A-F])\s*[.)]\s+([\s\S]+)$/.exec(plain);
      if (singleOptMatch) {
        const hasAsterisk = Boolean(singleOptMatch[1]);
        const key = singleOptMatch[2].toUpperCase();
        const cleanedOptRich = rich
          .replace(/^(?:<(?:strong|b|u|em|i)>)*\s*[*_]?[A-F]\s*[.)]\s*(?:<\/(?:strong|b|u|em|i)>)*\s*/i, '')
          .trim();
        currentQuestion.options[key] = cleanedOptRich || singleOptMatch[3].trim();
        if (hasAsterisk || block.markedOptions?.includes(key)) {
          currentQuestion.markedOptions.add(key);
        }
        if (block.media?.length) currentQuestion.media.push(...block.media);
        activeField = `option:${key}`;
        continue;
      }

      // Nhận diện mệnh đề Đúng/Sai: "a) ...", "b) ...", "c. ...", "d) ..."
      const stmtMatch = /^([a-e])\s*[.)]\s+([\s\S]+)$/.exec(plain);
      if (stmtMatch) {
        const stmtLetterIdx = stmtMatch[1].toLowerCase().charCodeAt(0) - 97;
        // Trong đề TSA có thể lặp lại khối a) ... b) ... dưới chữ "Đáp án" kèm ký hiệu radio  
        const hasFilledRadioLeft = /\s*/.test(plain);
        const hasFilledRadioRight = /\s*/.test(plain);
        const cleanedStmtRich = rich
          .replace(/^(?:<(?:strong|b|u|em|i)>)*\s*[a-e]\s*[.)]\s*(?:<\/(?:strong|b|u|em|i)>)*\s*/i, '')
          .replace(/[\uF0A1\uF0A4]+/g, '')
          .trim();

        if (currentQuestion.statements[stmtLetterIdx] !== undefined) {
          // Đây là dòng lặp lại ở khối Đáp án của đề TSA
          if (hasFilledRadioLeft || hasFilledRadioRight) {
            currentQuestion._radioAnswers = currentQuestion._radioAnswers || [];
            currentQuestion._radioAnswers[stmtLetterIdx] = hasFilledRadioLeft ? 'Đ' : 'S';
            if (currentQuestion._radioAnswers.filter(Boolean).length === currentQuestion.statements.length) {
              currentQuestion.answerRaw = currentQuestion._radioAnswers.join(' ');
            }
          }
          continue;
        }

        currentQuestion.statements.push(cleanedStmtRich);
        if (hasFilledRadioLeft || hasFilledRadioRight) {
          currentQuestion._radioAnswers = currentQuestion._radioAnswers || [];
          currentQuestion._radioAnswers[currentQuestion.statements.length - 1] = hasFilledRadioLeft ? 'Đ' : 'S';
        }
        if (block.media?.length) currentQuestion.media.push(...block.media);
        activeField = `statement:${currentQuestion.statements.length - 1}`;
        continue;
      }
    }

    // Dòng nối tiếp
    if (block.media?.length) {
      const taggedMedia = activeField === 'solution'
        ? block.media.map((m) => ({ ...m, inSolution: true }))
        : block.media;
      currentQuestion.media.push(...taggedMedia);
    }

    if (activeField === 'prompt' && rich) {
      currentQuestion.promptLines.push(rich);
    } else if (activeField && activeField.startsWith('option:') && rich) {
      const key = activeField.split(':')[1];
      currentQuestion.options[key] = `${currentQuestion.options[key] || ''}\n${rich}`.trim();
    } else if (activeField && activeField.startsWith('statement:') && rich) {
      const idx = Number(activeField.split(':')[1]);
      currentQuestion.statements[idx] = `${currentQuestion.statements[idx] || ''}\n${rich}`.trim();
    } else if (activeField === 'solution' && rich) {
      // Kiểm tra nếu ở dòng cuối cùng của lời giải câu kéo thả TSA xuất hiện dãy thẻ cách nhau bằng khoảng trắng (vd: "81 136 -12 54")
      if (currentQuestion.hasDragHint && currentQuestion.cards.length === 0 && currentQuestion.answerRaw) {
        const expectedParts = currentQuestion.answerRaw.split(/\s*;\s*/).map((s) => s.trim()).filter(Boolean);
        if (expectedParts.length >= 2 && expectedParts.every((ep) => plain.includes(ep))) {
          const tokens = plain.split(/\s{2,}|\t+|\s*\|\s*/).map((s) => s.trim()).filter(Boolean);
          if (tokens.length >= expectedParts.length) {
            currentQuestion.cards.push(...tokens);
            continue;
          }
        }
      }
      currentQuestion.solutionLines.push(rich);
    }
  }

  pushCurrentQuestion();

  // Đối chiếu bảng đáp án tổng hợp (nếu các câu hỏi chưa có đáp án riêng)
  rawQuestions.forEach((rq, idx) => {
    if (!rq.answerRaw) {
      const byOrig = rq.origQNum ? answerKeyByNum.get(rq.origQNum) : null;
      const bySeq = answerKeyByNum.get(idx + 1);
      if (byOrig || bySeq) {
        rq.answerRaw = byOrig || bySeq;
      }
    }
    // Nếu có từ 2 đáp án chữ cái trở lên (vd: "A, C") và có phương án A..D -> tự động chuyển thành multiple
    if (
      !rq.explicitType &&
      Object.keys(rq.options || {}).length >= 2 &&
      /^[A-F](?:\s*[,;]\s*[A-F])+$/i.test(String(rq.answerRaw || '').trim())
    ) {
      rq.explicitType = 'NHIEU DAP AN';
    }
    // Nếu đáp án là "Đ" hoặc "S" hoặc "Đúng" hoặc "Sai" và không có phương án A..D -> nhận diện Đúng/Sai 1 mệnh đề TSA
    if (
      !rq.explicitType &&
      Object.keys(rq.options || {}).length === 0 &&
      rq.statements.length === 0 &&
      /^(?:[ĐDS]|DUNG|SAI|TRUE|FALSE)$/i.test(stripDiacritics(String(rq.answerRaw || '').trim()))
    ) {
      const normAns = stripDiacritics(String(rq.answerRaw || '').trim()).toUpperCase();
      if (normAns !== 'D' || Object.keys(rq.options || {}).length === 0) {
        rq.explicitType = 'DUNG SAI';
        rq.answerRaw = normAns.startsWith('D') || normAns.startsWith('T') ? 'Đ' : 'S';
      }
    }
  });

  if (rawQuestions.length === 0) {
    errors.push('Không tìm thấy câu hỏi nào trong tệp Word. Hãy kiểm tra lại định dạng câu hỏi (Câu 1:, A., B., C., D. hoặc mẫu lệnh [CÂU]).');
  } else {
    warnings.push(
      `Hệ thống đã tự động nhận diện ${rawQuestions.length} câu hỏi từ đề Word bình thường. Vui lòng rà soát lại công thức, hình ảnh và đáp án trước khi phát hành (Khuyên dùng Trợ lý soạn đề bằng AI để đạt độ chính xác 100%).`
    );
  }

  return { rawQuestions, hasExamTypeCommand };
}

export async function parseWordExamDocx(bufferOrUint8, options = {}) {
  const entries = await unzipDocxEntries(bufferOrUint8);
  const decoder = new TextDecoder('utf-8');
  const documentXml = decoder.decode(entries.get('word/document.xml'));
  const relsXml = entries.has('word/_rels/document.xml.rels')
    ? decoder.decode(entries.get('word/_rels/document.xml.rels'))
    : '';

  const relsMap = parseRelationshipsXml(relsXml);
  const mediaMap = new Map();
  const errors = [];
  const warnings = [];

  const blocks = parseBodyBlocks(documentXml, { relsMap, entries, mediaMap, errors, warnings });

  const hasBeginTag = blocks.some((b) => {
    if (b.kind !== 'paragraph') return false;
    const cm = /^\[\s*([^\]]+?)\s*\]/s.exec(b.plainText);
    return cm && normalizeCommandTag(cm[1]) === 'BAT DAU DE';
  });
  const parseMode = hasBeginTag ? 'template' : 'auto';

  let inExam = false;
  let sawBegin = false;
  let sawEnd = false;
  let hasExamTypeCommand = false;

  const meta = {
    examType: (options.expectedExamType || '').toLowerCase(),
    grade: options.expectedGrade || null,
    schoolYear: options.expectedSchoolYear || '',
    examCode: '',
    title: ''
  };

  let rawQuestions = [];

  if (parseMode === 'auto') {
    const autoRes = parseNormalExamBlocks(blocks, { meta, options, errors, warnings });
    rawQuestions = autoRes.rawQuestions;
    hasExamTypeCommand = autoRes.hasExamTypeCommand;
  } else {
    let currentSection = 'part_1';
    let currentSubject = '';
    let currentPassage = null;
    let passageCounter = 0;
    let currentQuestion = null;
    let activeField = null; // 'passage' | 'prompt' | 'option:A' | 'statement:0' | 'solution'

    const pushCurrentQuestion = () => {
      if (currentQuestion) {
        rawQuestions.push(currentQuestion);
        currentQuestion = null;
        activeField = null;
      }
    };

    for (const block of blocks) {
      const plain = block.plainText;
      const cmdMatch = block.kind === 'paragraph' ? /^\[\s*([^\]]+?)\s*\](?:\s*(.*))?$/s.exec(plain) : null;
      const normTag = cmdMatch ? normalizeCommandTag(cmdMatch[1]) : '';

      if (normTag === 'BAT DAU DE') {
        inExam = true;
        sawBegin = true;
        continue;
      }
      if (normTag === 'KET THUC DE') {
        pushCurrentQuestion();
        inExam = false;
        sawEnd = true;
        break;
      }
      if (!inExam) continue;

      if (block.hasOmml || block.hasOleObject) {
        errors.push('Phát hiện công thức Equation của Word hoặc MathType chưa chuyển sang LaTeX ($...$).');
      }
      if (block.hasAutoNum) {
        warnings.push('Phát hiện đoạn văn dùng đánh số tự động (Auto Numbering) của Word trong phần đề.');
      }
      if (block.hasFloatingDrawing) {
        warnings.push('Phát hiện hình ảnh để chế độ trôi nổi (Floating). Nên đổi sang chế độ In Line with Text để đúng vị trí.');
      }

      if (cmdMatch) {
        const rawTag = cmdMatch[1];
        const remainderPlain = (cmdMatch[2] || '').trim();
        const remainderRich = stripLeadingCommandTag(block.richText, rawTag);

        if (normTag === 'KY THI') {
          const val = normalizeCommandTag(remainderPlain).toLowerCase();
          if (['thptqg', 'hsa', 'tsa'].includes(val)) {
            meta.examType = val;
            hasExamTypeCommand = true;
          }
          continue;
        }
        if (normTag === 'KHOI') {
          const g = Number(remainderPlain);
          if ([10, 11, 12].includes(g)) meta.grade = g;
          continue;
        }
        if (normTag === 'NAM HOC') {
          meta.schoolYear = remainderPlain;
          continue;
        }
        if (normTag === 'MA DE') {
          meta.examCode = remainderPlain;
          continue;
        }
        if (normTag === 'TEN DE') {
          meta.title = remainderPlain;
          continue;
        }

        if (/^PHAN\s+(I|1)$/i.test(normTag)) {
          pushCurrentQuestion();
          currentSection = 'part_1';
          currentSubject = '';
          currentPassage = null;
          continue;
        }
        if (/^PHAN\s+(II|2)$/i.test(normTag)) {
          pushCurrentQuestion();
          currentSection = 'part_2';
          currentSubject = '';
          currentPassage = null;
          continue;
        }
        if (/^PHAN\s+(III|3)$/i.test(normTag)) {
          pushCurrentQuestion();
          currentSection = 'part_3';
          currentSubject = '';
          currentPassage = null;
          continue;
        }

        if (normTag === 'MON' || normTag.startsWith('MON:')) {
          pushCurrentQuestion();
          const subRaw = normTag.startsWith('MON:') ? normTag.slice(4).trim() : normalizeCommandTag(remainderPlain);
          const mapped = SUBJECT_MAP[subRaw] || subRaw.toLowerCase();
          currentSubject = mapped;
          currentPassage = null;
          continue;
        }

        if (normTag === 'NGU LIEU') {
          pushCurrentQuestion();
          passageCounter++;
          currentPassage = {
            id: `passage_${passageCounter}`,
            clusterId: `cluster_${passageCounter}`,
            lines: remainderRich ? [remainderRich] : [],
            media: [...(block.media || [])],
            questionCount: 0
          };
          activeField = 'passage';
          continue;
        }

        if (normTag === 'HET NGU LIEU') {
          pushCurrentQuestion();
          if (!currentPassage) {
            errors.push('Gặp lệnh [HẾT NGỮ LIỆU] nhưng không có [NGỮ LIỆU] mở trước đó.');
          } else if (currentPassage.questionCount === 0) {
            errors.push(`Khối [NGỮ LIỆU] #${passageCounter} không có câu hỏi nào bên trong.`);
          }
          currentPassage = null;
          activeField = null;
          continue;
        }

        if (normTag === 'CAU') {
          pushCurrentQuestion();
          if (currentPassage) currentPassage.questionCount++;
          currentQuestion = {
            section: currentSection,
            subject: currentSubject,
            clusterId: currentPassage ? currentPassage.clusterId : null,
            passageId: currentPassage ? currentPassage.id : null,
            passageContent: currentPassage ? currentPassage.lines.join('\n').trim() : '',
            passageMedia: currentPassage ? [...currentPassage.media] : [],
            promptLines: remainderRich ? [remainderRich] : [],
            options: {},
            statements: [],
            cards: [],
            explicitType: '',
            answerRaw: '',
            solutionLines: [],
            note: '',
            media: [...(block.media || [])]
          };
          activeField = 'prompt';
          continue;
        }

        if (normTag === 'DANG') {
          if (!currentQuestion) {
            errors.push('Lệnh [DẠNG] phải nằm bên trong một [CÂU].');
          } else {
            currentQuestion.explicitType = remainderPlain;
          }
          continue;
        }

        if (/^[A-F]$/.test(normTag)) {
          if (!currentQuestion) {
            errors.push(`Phương án [${normTag}] nằm ngoài [CÂU].`);
          } else {
            if (currentQuestion.options[normTag] !== undefined) {
              errors.push(`Phương án [${normTag}] bị lặp lại trong cùng một câu hỏi.`);
            }
            currentQuestion.options[normTag] = remainderRich;
            if (block.media?.length) currentQuestion.media.push(...block.media);
            activeField = `option:${normTag}`;
          }
          continue;
        }

        const stmtMatch = /^Y\s+([A-E])$/.exec(normTag);
        if (stmtMatch) {
          if (!currentQuestion) {
            errors.push(`Mệnh đề [Ý ${stmtMatch[1].toLowerCase()}] nằm ngoài [CÂU].`);
          } else {
            currentQuestion.statements.push(remainderRich);
            if (block.media?.length) currentQuestion.media.push(...block.media);
            activeField = `statement:${currentQuestion.statements.length - 1}`;
          }
          continue;
        }

        if (normTag === 'THE') {
          if (!currentQuestion) {
            errors.push('Lệnh [THẺ] nằm ngoài [CÂU].');
          } else {
            currentQuestion.cards.push(remainderRich);
            activeField = null;
          }
          continue;
        }

        if (normTag === 'DAP AN') {
          if (!currentQuestion) {
            errors.push('Lệnh [ĐÁP ÁN] nằm ngoài [CÂU].');
          } else {
            currentQuestion.answerRaw = remainderPlain;
            activeField = null;
          }
          continue;
        }

        if (normTag === 'LOI GIAI') {
          if (!currentQuestion) {
            errors.push('Lệnh [LỜI GIẢI] nằm ngoài [CÂU].');
          } else {
            if (remainderRich) currentQuestion.solutionLines.push(remainderRich);
            if (block.media?.length) {
              currentQuestion.media.push(...block.media.map(m => ({ ...m, inSolution: true })));
            }
            activeField = 'solution';
          }
          continue;
        }

        if (normTag === 'GHI CHU') {
          if (currentQuestion) currentQuestion.note = remainderPlain;
          activeField = null;
          continue;
        }
      }

      // Dòng nối tiếp (multi-line hoặc bảng hoặc ảnh)
      if (activeField === 'passage' && currentPassage) {
        if (block.richText) currentPassage.lines.push(block.richText);
        if (block.media?.length) currentPassage.media.push(...block.media);
      } else if (currentQuestion) {
        if (block.media?.length) {
          const taggedMedia = activeField === 'solution'
            ? block.media.map(m => ({ ...m, inSolution: true }))
            : block.media;
          currentQuestion.media.push(...taggedMedia);
        }
        if (activeField === 'prompt' && block.richText) {
          currentQuestion.promptLines.push(block.richText);
        } else if (activeField && activeField.startsWith('option:') && block.richText) {
          const key = activeField.split(':')[1];
          currentQuestion.options[key] = `${currentQuestion.options[key] || ''}\n${block.richText}`.trim();
        } else if (activeField && activeField.startsWith('statement:') && block.richText) {
          const idx = Number(activeField.split(':')[1]);
          currentQuestion.statements[idx] = `${currentQuestion.statements[idx] || ''}\n${block.richText}`.trim();
        } else if (activeField === 'solution' && block.richText) {
          currentQuestion.solutionLines.push(block.richText);
        }
      }
    }

    pushCurrentQuestion();

    if (!sawBegin || !sawEnd) {
      errors.push('File thiếu cặp lệnh đánh dấu vùng đề [BẮT ĐẦU ĐỀ] ... [KẾT THÚC ĐỀ].');
    }
    if (currentPassage) {
      errors.push('Có khối [NGỮ LIỆU] chưa được đóng bằng lệnh [HẾT NGỮ LIỆU].');
    }
  }

  const resolvedExamType = meta.examType || options.expectedExamType || 'thptqg';
  if (options.expectedExamType && meta.examType && meta.examType !== options.expectedExamType) {
    warnings.push(`Kỳ thi trong file ([KỲ THI] ${meta.examType.toUpperCase()}) khác với kỳ thi đã chọn trên form (${options.expectedExamType.toUpperCase()}).`);
  }

  const questions = rawQuestions.map((rq, idx) => finalizeQuestion(rq, idx, resolvedExamType, errors, warnings));
  const structure = checkExamStructure(resolvedExamType, questions, { requireFull: false });
  const publishStructure = checkExamStructure(resolvedExamType, questions, { requireFull: true });

  return {
    meta: { ...meta, examType: resolvedExamType },
    parseMode,
    hasExamTypeCommand,
    questions,
    mediaFiles: [...mediaMap.values()],
    errors,
    warnings,
    structure,
    publishReady: errors.length === 0 && publishStructure.valid,
    publishErrors: publishStructure.errors
  };
}

export async function parseWordExamFiles(files, options = {}) {
  const questions = [];
  const errors = [];
  const warnings = [];
  const counts = [];
  let meta;
  let hasExamTypeCommand = false;
  let parseMode = 'template';

  for (const [index, file] of files.entries()) {
    if (!/\.docx$/i.test(file.name)) throw new Error(`${file.name}: chỉ hỗ trợ tệp .docx.`);
    let parsed;
    try {
      parsed = await parseWordExamDocx(await file.arrayBuffer(), meta ? {} : options);
    } catch (error) {
      throw new Error(`${file.name}: ${error.message}`);
    }
    if (parsed.hasExamTypeCommand) hasExamTypeCommand = true;
    if (parsed.parseMode === 'auto') parseMode = 'auto';
    if (files.length > 1) {
      if (!parsed.hasExamTypeCommand || !parsed.meta.examCode) {
        throw new Error(`${file.name}: cần ghi [KỲ THI] và [MÃ ĐỀ] trong từng tệp.`);
      }
      for (const key of ['examType', 'examCode', 'grade', 'schoolYear']) {
        if (meta?.[key] && parsed.meta[key] && meta[key] !== parsed.meta[key]) {
          throw new Error(`${file.name}: kỳ thi, mã đề, khối và năm học phải khớp giữa các tệp của cùng một đề.`);
        }
      }
    }
    meta ??= { ...parsed.meta };
    for (const key of ['grade', 'schoolYear', 'title']) meta[key] ||= parsed.meta[key];
    errors.push(...parsed.errors.map(message => `${file.name}: ${message}`));
    warnings.push(...parsed.warnings.map(message => `${file.name}: ${message}`));
    counts.push({ name: file.name, count: parsed.questions.length });

    for (const question of parsed.questions) {
      if (files.length > 1) {
        // Identifiers in the Word parser are local to each file.
        const prefix = `word${index + 1}_`;
        const rewrite = text => typeof text === 'string'
          ? text.replace(/\[\[(img|IMAGE):([^\]]+)\]\]/gi, (_, kind, imageId) => `[[${kind}:${prefix}${imageId}]]`)
          : text;
        for (const key of ['prompt', 'solution', 'passageContent']) question[key] = rewrite(question[key]);
        for (const key of ['options', 'statements', 'cards']) {
          if (Array.isArray(question[key])) question[key] = question[key].map(rewrite);
        }
        for (const key of ['media', 'passageMedia']) {
          question[key] = question[key].map(item => ({ ...item, id: prefix + item.id }));
        }
        if (question.clusterId) question.clusterId = prefix + question.clusterId;
        if (question.passageId) question.passageId = prefix + question.passageId;
      }
      questions.push(question);
    }
  }

  if (questions.length > 300) throw new Error('Một đề chỉ được chứa tối đa 300 câu. Hãy kiểm tra các tệp bị trùng.');
  if (files.length > 1) {
    const subjectOrder = q => meta.examType === 'hsa' ? HSA_ALL_PART3_SUBJECTS.indexOf(q.subject) : 0;
    questions.sort((a, b) => a.section.localeCompare(b.section) || subjectOrder(a) - subjectOrder(b));
  }
  questions.forEach((q, index) => {
    q.id = `q_${index + 1}`;
    q.order = index + 1;
  });
  return { meta, parseMode, hasExamTypeCommand, questions, errors, warnings, counts };
}

export function extractBulkExamNumber(fileName) {
  const ascii = stripDiacritics(String(fileName || '').normalize('NFC'));
  const m = /(?:^|[^A-Za-z0-9])(?:de|ma\s*de)[\s._-]*(?:thi[\s._-]*)?(?:tham[\s._-]*khao[\s._-]*)?(?:hsa|tsa|thptqg)?[\s._-]*0*(\d{1,3})(?!\d)/i.exec(ascii);
  return m ? Number(m[1]) : null;
}

export function groupBulkExamSourceFiles(files) {
  const rawFiles = Array.from(files || []).filter((file) => {
    const name = String(file?.name || '').normalize('NFC');
    return Boolean(name && !name.startsWith('~$'));
  });
  const validDocx = rawFiles.filter((file) => /\.docx$/i.test(String(file?.name || '').normalize('NFC')));
  const ignoredCount = rawFiles.length - validDocx.length;

  const parentFolderOf = (file) => {
    const rel = String(file?.webkitRelativePath || '');
    const segments = rel.split(/[\\/]+/).filter(Boolean);
    return segments.length >= 2 ? segments[segments.length - 2].normalize('NFC') : null;
  };

  const groups = validDocx.map((docx, idx) => {
    const normName = String(docx.name || '').normalize('NFC');
    const folder = parentFolderOf(docx);
    const num = extractBulkExamNumber(normName) ?? extractBulkExamNumber(folder);
    return {
      groupKey: normName,
      folderHint: folder || '',
      orderNum: num ?? (10_000 + idx),
      docxFiles: [docx],
      pdfFiles: []
    };
  });

  groups.sort((a, b) => {
    const numA = a.orderNum ?? Number.MAX_SAFE_INTEGER;
    const numB = b.orderNum ?? Number.MAX_SAFE_INTEGER;
    if (numA !== numB) return numA - numB;
    return String(a.groupKey || '').localeCompare(String(b.groupKey || ''), 'vi');
  });

  return { groups, unmatchedPdfs: [], ignoredCount };
}
