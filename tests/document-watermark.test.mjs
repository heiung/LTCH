import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveUserWatermarkText,
  drawWatermarkBehindCanvas,
  assemblePdfFromJpegPages,
  watermarkDownloadedBlob
} from '../client/document-watermark.mjs';

test('resolveUserWatermarkText formats [Họ và tên] - [Mã số] accurately across roles', () => {
  assert.equal(
    resolveUserWatermarkText({
      me: {
        uid: 'u-1',
        displayName: 'Nguyễn Minh An',
        studentCode: 'HS202601'
      },
      viewRole: 'student'
    }),
    'Nguyễn Minh An - HS202601'
  );

  // Parent viewing linked student's workspace falls back to student's code in roster
  assert.equal(
    resolveUserWatermarkText({
      me: {
        uid: 'parent-9',
        displayName: 'Phụ huynh An'
      },
      workspace: {
        students: [
          { uid: 'stu-9', display_name: 'Nguyễn Minh An', student_code: 'HS0098' }
        ]
      },
      viewRole: 'parent'
    }),
    'Phụ huynh An - HS0098'
  );

  // Fallback to deterministic role-prefixed code when studentCode is absent
  const fallback = resolveUserWatermarkText({
    me: {
      uid: 'abcdef123456',
      displayName: 'Trần Văn Bình'
    },
    viewRole: 'student'
  });
  assert.match(fallback, /^Trần Văn Bình - HS\d{6}$/);
});

test('assemblePdfFromJpegPages produces valid PDF-1.4 binary with image XObjects and xref table', () => {
  const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
  const pdfBytes = assemblePdfFromJpegPages([
    {
      jpegBytes: fakeJpeg,
      pixelWidth: 1190,
      pixelHeight: 1684,
      ptWidth: 595.28,
      ptHeight: 841.89
    }
  ]);

  const text = new TextDecoder('latin1').decode(pdfBytes);
  assert.ok(text.startsWith('%PDF-1.4\n'));
  assert.ok(text.includes('/Subtype /Image'));
  assert.ok(text.includes('/Filter /DCTDecode'));
  assert.ok(text.includes('/MediaBox [ 0 0 595.28 841.89 ]'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
});

test('watermarkDownloadedBlob always returns a valid Blob instance for URL.createObjectURL', async () => {
  const inputBlob = new Blob(['%PDF-1.4\n%%EOF'], { type: 'application/pdf' });
  const out = await watermarkDownloadedBlob(inputBlob, {
    watermarkText: 'Nguyễn Minh An - HS202601',
    fileName: 'De-toan.pdf',
    contentType: 'application/pdf'
  });
  assert.ok(out instanceof Blob, 'watermarkDownloadedBlob must return a Blob instance');
  const url = URL.createObjectURL(out);
  assert.ok(typeof url === 'string' && url.startsWith('blob:'));
  URL.revokeObjectURL(url);
});

test('drawWatermarkBehindCanvas places 5 symmetrical in-bounds watermarks without edge clipping', () => {
  const calls = [];
  let tx = 0;
  let ty = 0;
  const stack = [];
  const ctx = {
    globalCompositeOperation: '',
    textAlign: '',
    textBaseline: '',
    font: '',
    fillStyle: '',
    save() { stack.push([tx, ty]); },
    restore() { const prev = stack.pop(); if (prev) [tx, ty] = prev; },
    translate(x, y) { tx += x; ty += y; },
    rotate() {},
    measureText(str) { return { width: str.length * 14 }; },
    fillText(str, x, y) { calls.push({ str, x: tx + x, y: ty + y }); }
  };

  drawWatermarkBehindCanvas(ctx, 1000, 1400, 'Nguyễn Minh An - HS202601');
  assert.equal(calls.length, 5, 'Should draw an orderly 5-point symmetric watermark layout');
  for (const c of calls) {
    assert.ok(c.x >= 200 && c.x <= 800, `X anchor out of tidy page margins: ${c.x}`);
    assert.ok(c.y >= 200 && c.y <= 1200, `Y anchor out of tidy page margins: ${c.y}`);
  }
});

test('createWatermarkLayer renders 6 orderly items matching the 3x2 / 2x3 exam CSS grid', async () => {
  const prevDoc = globalThis.document;
  const prevNode = globalThis.Node;
  class MockNode {}
  class MockText extends MockNode {
    constructor(v) { super(); this.nodeType = 3; this.textContent = String(v); }
  }
  class MockEl extends MockNode {
    constructor(tag) {
      super();
      this.tagName = tag.toUpperCase();
      this.attrs = {};
      this.childNodes = [];
    }
    set className(v) { this.attrs.class = v; }
    get className() { return this.attrs.class || ''; }
    set textContent(v) { this.childNodes = [new MockText(v)]; }
    get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    append(...nodes) { this.childNodes.push(...nodes); }
  }
  globalThis.Node = MockNode;
  globalThis.document = {
    createElement: (t) => new MockEl(t),
    createTextNode: (v) => new MockText(v)
  };
  try {
    const { createWatermarkLayer } = await import('../client/practice-rooms.mjs');
    const layer = createWatermarkLayer({ studentCode: 'HS202601', displayName: 'Nguyễn Minh An' });
    assert.equal(layer.className, 'ltch-exam-watermark');
    assert.equal(layer.childNodes.length, 6);
    for (const child of layer.childNodes) {
      assert.equal(child.className, 'ltch-exam-watermark-item');
      assert.equal(child.textContent, 'LTCH - HS202601 - Nguyễn Minh An');
    }
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
    if (prevNode === undefined) delete globalThis.Node;
    else globalThis.Node = prevNode;
  }
});
