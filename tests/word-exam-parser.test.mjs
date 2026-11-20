import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parseWordExamDocx } from '../shared/word-exam-parser.mjs';

const TEMPLATE_DIR = path.resolve(process.cwd(), 'public/mau-dang-tai');

test('parseWordExamDocx parses Mau_dang_tai_THPTQG.docx cleanly', async () => {
  const buf = fs.readFileSync(path.join(TEMPLATE_DIR, 'Mau_dang_tai_THPTQG.docx'));
  const res = await parseWordExamDocx(buf);

  assert.equal(res.errors.length, 0, `Unexpected errors: ${JSON.stringify(res.errors)}`);
  assert.equal(res.meta.examType, 'thptqg');
  assert.equal(res.meta.grade, 12);
  assert.equal(res.questions.length, 9);

  // Check Part I (single), Part II (true_false), Part III (short)
  const q1 = res.questions[0];
  assert.equal(q1.section, 'part_1');
  assert.equal(q1.type, 'single');
  assert.equal(q1.options.length, 4);
  assert.equal(q1.answer, 'B');
  assert.ok(q1.prompt.includes('<table'), 'Question 1 should extract grouped frequency table');

  const q2 = res.questions[1];
  assert.ok(q2.media.length >= 1, 'Question 2 should extract inline cubic graph image');
  assert.ok(res.mediaFiles.length >= 1, 'Media map should contain extracted image');

  const part2Questions = res.questions.filter((q) => q.section === 'part_2');
  assert.ok(part2Questions.length >= 2);
  assert.equal(part2Questions[0].type, 'true_false');
  assert.equal(part2Questions[0].statements.length, 4);

  const part3Questions = res.questions.filter((q) => q.section === 'part_3');
  assert.ok(part3Questions.length >= 3);
  assert.equal(part3Questions[0].type, 'short');
});

test('parseWordExamDocx parses Mau_dang_tai_HSA.docx cleanly', async () => {
  const buf = fs.readFileSync(path.join(TEMPLATE_DIR, 'Mau_dang_tai_HSA.docx'));
  const res = await parseWordExamDocx(buf);

  assert.equal(res.errors.length, 0, `Unexpected errors: ${JSON.stringify(res.errors)}`);
  assert.equal(res.meta.examType, 'hsa');
  assert.equal(res.questions.length, 16);
  const clustered = res.questions.filter((q) => q.passageId);
  assert.ok(clustered.length >= 3, 'Should link cluster questions to passages');

  // Verify subjects in Part 3
  const subjects = new Set(res.questions.filter((q) => q.section === 'part_3').map((q) => q.subject));
  assert.ok(subjects.has('physics'));
  assert.ok(subjects.has('chemistry'));
  assert.ok(subjects.has('biology'));
  assert.ok(subjects.has('history'));
  assert.ok(subjects.has('geography'));
  assert.ok(subjects.has('english'));
});

test('parseWordExamDocx parses Mau_dang_tai_TSA.docx with all 6 question types', async () => {
  const buf = fs.readFileSync(path.join(TEMPLATE_DIR, 'Mau_dang_tai_TSA.docx'));
  const res = await parseWordExamDocx(buf);

  assert.equal(res.errors.length, 0, `Unexpected errors: ${JSON.stringify(res.errors)}`);
  assert.equal(res.meta.examType, 'tsa');
  assert.equal(res.questions.length, 15);

  const types = new Set(res.questions.map((q) => q.type));
  assert.ok(types.has('single'));
  assert.ok(types.has('multiple'));
  assert.ok(types.has('true_false'));
  assert.ok(types.has('short'));
  assert.ok(types.has('fill_blank'));
  assert.ok(types.has('drag_drop'));

  const dragQ = res.questions.find((q) => q.type === 'drag_drop');
  assert.ok(dragQ);
  assert.equal(dragQ.cards.length, 6);
  assert.deepEqual(dragQ.answer, ['T4', 'T1', 'T2']);

  const fillQs = res.questions.filter((q) => q.type === 'fill_blank');
  assert.ok(fillQs.length >= 3);
  const nucleicFill = fillQs[fillQs.length - 1];
  assert.equal(nucleicFill.blanks.length, 2);
  assert.ok(nucleicFill.blanks[0].accepted.includes('thymine'));
  assert.ok(nucleicFill.blanks[1].accepted.includes('uracil'));
});

test('Bộ đề TEST (THPTQG 22 câu, HSA 235 câu, TSA 100 câu) upload, validate, render LaTeX & publish end-to-end without errors', async () => {
  const TEST_SUITE_DIR = process.env.LTCH_EXAM_SUITE_DIR || '';
  if (!TEST_SUITE_DIR || !fs.existsSync(TEST_SUITE_DIR)) return;

  const { parseForumMath, renderForumFormula } = await import('../client/forum-math.mjs');
  const { validateQuestions, checkExamStructure, projectVisibleQuestion } = await import('../worker/questions.mjs');
  const { practiceRooms } = await import('../worker/practice-rooms.mjs');

  function verifyAllLatexInText(text, contextLabel) {
    if (!text) return;
    const raw = String(text).replace(/<table\b[\s\S]*?<\/table>/gi, (tbl) =>
      tbl
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?(?:table|tr|th|td|b|strong|i|em|u|sup|sub|p|div)\b[^>]*>/gi, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
    );
    const parts = parseForumMath(raw);
    for (const part of parts) {
      if (part.type === 'math') {
        const html = renderForumFormula(part.latex, part.display);
        assert.ok(html && html.includes('katex'), `LaTeX failed to render in ${contextLabel}: ${part.raw}`);
      }
    }
  }

  function toDataUrl(bytes, mime = 'image/png') {
    return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
  }

  const filesToTest = [
    {
      examType: 'thptqg',
      filePath: path.join(TEST_SUITE_DIR, 'THPTQG', 'De_thi_THPTQG_2026_Upload_LTCH.docx'),
      expectedCount: 22,
      expectedMaxScore: 10
    },
    {
      examType: 'hsa',
      filePath: path.join(TEST_SUITE_DIR, 'HSA', 'De_tham_khao_HSA_2025_Upload_LTCH.docx'),
      expectedCount: 235,
      expectedMaxScore: 150
    },
    {
      examType: 'tsa',
      filePath: path.join(TEST_SUITE_DIR, 'TSA', 'De_01_TSA_2026_Full_3_Phan_Upload_LTCH.docx'),
      expectedCount: 100,
      expectedMaxScore: 100
    }
  ];

  // Mock DB for full upload -> publish -> start -> submit verification
  const tables = {
    ltch_classes: [{ id: 'cls_12a', name: 'Toán 12A', grade: 12, school_year_id: 'year-2026-2027', archived: false }],
    ltch_school_years: [{ id: 'year-2026-2027', name: '2026 - 2027', starts_on: '2026-08-01', ends_on: '2027-06-30' }],
    ltch_accounts: [],
    ltch_student_grade_history: [],
    ltch_exams: [],
    ltch_exam_year_shares: [],
    ltch_practice_attempts: [],
    ltch_question_bank: [],
    ltch_question_versions: [],
    ltch_question_reports: []
  };
  let seq = 5000;
  const db = {
    from(tableName) {
      const state = { op: 'select', filters: [], payload: null, single: false };
      const b = {
        select: () => b,
        eq: (c, v) => { state.filters.push((r) => r[c] === v); return b; },
        in: (c, vs) => { const s = new Set(vs); state.filters.push((r) => s.has(r[c])); return b; },
        order: () => b,
        limit: () => b,
        maybeSingle: () => { state.single = true; return b; },
        single: () => { state.single = true; return b; },
        insert: (p) => { state.op = 'insert'; state.payload = p; return b; },
        upsert: (p, o = {}) => { state.op = 'upsert'; state.payload = p; state.onConflict = o.onConflict || 'id'; return b; },
        update: (p) => { state.op = 'update'; state.payload = p; return b; },
        delete: () => { state.op = 'delete'; return b; },
        then(res, rej) {
          const rows = tables[tableName] || (tables[tableName] = []);
          const match = (r) => state.filters.every((fn) => fn(r));
          if (state.op === 'select') {
            const m = rows.filter(match);
            return Promise.resolve({ data: state.single ? m[0] || null : m, error: null }).then(res, rej);
          }
          if (state.op === 'insert') {
            const list = Array.isArray(state.payload) ? state.payload : [state.payload];
            rows.push(...list);
            return Promise.resolve({ data: list, error: null }).then(res, rej);
          }
          if (state.op === 'upsert') {
            const list = Array.isArray(state.payload) ? state.payload : [state.payload];
            const keys = String(state.onConflict || 'id').split(',').map((k) => k.trim());
            for (const item of list) {
              const i = rows.findIndex((r) => keys.every((k) => r[k] === item[k]));
              if (i >= 0) rows[i] = { ...rows[i], ...item };
              else rows.push(item);
            }
            return Promise.resolve({ data: list, error: null }).then(res, rej);
          }
          if (state.op === 'update') {
            for (let i = 0; i < rows.length; i++) {
              if (match(rows[i])) rows[i] = { ...rows[i], ...state.payload };
            }
            return Promise.resolve({ data: [], error: null }).then(res, rej);
          }
          return Promise.resolve({ data: [], error: null }).then(res, rej);
        }
      };
      return b;
    },
    async rpc(name,args) {
      if(name==='ltch_reserve_question_codes')return {data:Array.from({length:args.p_count},()=>`LTCH-${++seq}`),error:null};
      if(name==='ltch_save_room_exam'){
        tables.ltch_exams.push(args.p_exam);
        tables.ltch_question_bank.push(...args.p_bank);
        tables.ltch_question_versions.push(...args.p_versions);
        return {data:null,error:null};
      }
      return {data:null,error:null};
    }
  };
  const teacherActor = { uid: 'teacher_1', status: 'active', roles: ['teacher'], memberships: [] };

  for (const item of filesToTest) {
    const buf = fs.readFileSync(item.filePath);
    const parsed = await parseWordExamDocx(buf, { expectedExamType: item.examType });

    assert.equal(parsed.errors.length, 0, `${item.examType} parse errors: ${JSON.stringify(parsed.errors)}`);
    assert.equal(parsed.warnings.length, 0, `${item.examType} parse warnings: ${JSON.stringify(parsed.warnings)}`);
    assert.equal(parsed.questions.length, item.expectedCount, `${item.examType} question count mismatch`);
    assert.equal(parsed.publishReady, true, `${item.examType} should be publishReady`);

    const mediaDataMap = new Map(
      (parsed.mediaFiles || []).map((mf) => [mf.id, toDataUrl(mf.bytes, mf.mimeType || mf.contentType || 'image/png')])
    );
    const hydratedQuestions = parsed.questions.map((q) => ({
      ...q,
      passageMedia: (q.passageMedia || []).map((m) => ({ ...m, dataUrl: mediaDataMap.get(m.id) })),
      media: (q.media || []).map((m) => ({ ...m, dataUrl: mediaDataMap.get(m.id) }))
    }));

    // Verify all LaTeX formulas & visible projection
    const validated = validateQuestions(hydratedQuestions, { examType: item.examType });
    const fullCheck = checkExamStructure(item.examType, validated, { requireFull: true });
    assert.equal(fullCheck.valid, true, `${item.examType} structure check failed: ${JSON.stringify(fullCheck.errors)}`);

    for (const q of validated) {
      verifyAllLatexInText(q.prompt, `${item.examType} Q${q.order} prompt`);
      verifyAllLatexInText(q.passageContent, `${item.examType} Q${q.order} passage`);
      verifyAllLatexInText(q.solution, `${item.examType} Q${q.order} solution`);
      for (const opt of q.options || []) verifyAllLatexInText(opt, `${item.examType} Q${q.order} option`);
      for (const st of q.statements || []) verifyAllLatexInText(st, `${item.examType} Q${q.order} statement`);
      for (const card of q.cards || []) verifyAllLatexInText(card, `${item.examType} Q${q.order} card`);
      const vis = projectVisibleQuestion(q);
      assert.ok(vis.id && vis.prompt);
    }

    // Upload & Publish through practiceRooms API
    const pubReq = new Request('https://ltch.test/api/admin/practice/exams', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'publish',
        examType: item.examType,
        examMode: 'full',
        targetGrade: 12,
        examCode: parsed.meta.examCode || '01',
        title: parsed.meta.title,
        questions: hydratedQuestions
      })
    });
    const pubRes = await practiceRooms(pubReq, '/api/admin/practice/exams', { db, actor: teacherActor, env: {} });
    assert.equal(pubRes.status, 201, `${item.examType} publish failed`);
    const pubJson = await pubRes.json();
    assert.equal(pubJson.ok, true);
    assert.equal(pubJson.status, 'published');
    assert.equal(pubJson.questionCount, item.expectedCount);
  }

  // Verify specific visual elements, media, tables, underlines, bold markers & part_3 structure
  const thptBuf = fs.readFileSync(path.join(TEST_SUITE_DIR, 'THPTQG', 'De_thi_THPTQG_2026_Upload_LTCH.docx'));
  const thptRes = await parseWordExamDocx(thptBuf, { expectedExamType: 'thptqg' });
  assert.equal(thptRes.meta.schoolYear, '2025-2026');
  assert.equal(thptRes.meta.examCode, '0101');
  assert.equal(thptRes.mediaFiles.length, 5);
  assert.equal(thptRes.questions.filter((q) => /<table\b/i.test(q.prompt || '')).length, 2);

  const hsaBuf = fs.readFileSync(path.join(TEST_SUITE_DIR, 'HSA', 'De_tham_khao_HSA_2025_Upload_LTCH.docx'));
  const hsaRes = await parseWordExamDocx(hsaBuf, { expectedExamType: 'hsa' });
  assert.equal(hsaRes.mediaFiles.length, 31);
  assert.ok(/<table\b/i.test(hsaRes.questions[10].prompt), 'HSA Q11 should contain sign table');
  assert.ok(/<table\b/i.test(hsaRes.questions[39].prompt), 'HSA Q40 should contain frequency table');
  assert.ok(/<table\b/i.test(hsaRes.questions[42].prompt), 'HSA Q43 should contain table');
  assert.ok(/<u>[\s\S]*?<\/u>/i.test(hsaRes.questions[60].prompt), 'HSA Q61 should preserve underline');
  assert.ok(
    /\*\*"mùa đông hạt nhân"\*\*/i.test(hsaRes.questions[70].passageContent),
    'HSA Q71 passage should preserve bold marker around "mùa đông hạt nhân"'
  );
  assert.ok(/<table\b/i.test(hsaRes.questions[100].prompt), 'HSA Q101 (index 100) should contain table');
  const hsa415 = hsaRes.questions.find((q) => /<table\b/i.test(q.passageContent || '') && q.subject === 'history');
  assert.ok(hsa415, 'HSA History Q415-417 passage should contain table');
  const hsaGeoTables = hsaRes.questions.filter((q) => q.subject === 'geography' && /<table\b/i.test(q.prompt || ''));
  assert.ok(hsaGeoTables.length >= 3, 'HSA Geography Q506-508 should contain tables');
  const hsaStruct = checkExamStructure('hsa', hsaRes.questions, { requireFull: true });
  assert.equal(hsaStruct.valid, true);
  assert.equal(hsaStruct.counts.part_1, 50);
  assert.equal(hsaStruct.counts.part_2, 50);
  const hsaP3Sum = Object.values(hsaStruct.counts.part_3).reduce((acc, n) => acc + n, 0);
  assert.equal(hsaP3Sum, 135);
  assert.equal(hsaStruct.counts.part_1 + hsaStruct.counts.part_2 + hsaP3Sum, 235);

  const tsaBuf = fs.readFileSync(path.join(TEST_SUITE_DIR, 'TSA', 'De_01_TSA_2026_Full_3_Phan_Upload_LTCH.docx'));
  const tsaRes = await parseWordExamDocx(tsaBuf, { expectedExamType: 'tsa' });
  assert.equal(tsaRes.mediaFiles.length, 27);
  assert.ok(
    tsaRes.questions.some((q) => /colspan="|rowspan="/i.test(`${q.prompt || ''}${q.passageContent || ''}`)),
    'TSA should preserve table colspan/rowspan attributes'
  );
});

test('appendFormattedInlineMath and renderSafeTableElement render bold/underline math without literal marker leaks', async () => {
  function makeMockNodeList() {
    return [];
  }
  class MockNode {}
  class MockText extends MockNode {
    constructor(data) {
      super();
      this.nodeType = 3;
      this.textContent = String(data ?? '');
    }
    toHtml() {
      return this.textContent
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
  }
  class MockElement extends MockNode {
    constructor(tagName) {
      super();
      this.nodeType = 1;
      this.tagName = tagName.toUpperCase();
      this.attrs = {};
      this.childNodes = makeMockNodeList();
      this._innerHTML = null;
      this.classList = { add: (c) => { this.className = `${this.className} ${c}`.trim(); } };
    }
    set className(val) { this.attrs.class = val; }
    get className() { return this.attrs.class || ''; }
    set innerHTML(val) { this._innerHTML = String(val); this.childNodes = []; }
    get innerHTML() {
      if (this._innerHTML !== null) return this._innerHTML;
      return this.childNodes.map((c) => c.toHtml()).join('');
    }
    set textContent(val) {
      this._innerHTML = null;
      this.childNodes = [new MockText(val)];
    }
    get textContent() {
      if (this._innerHTML !== null) return this._innerHTML.replace(/<[^>]*>/g, '');
      return this.childNodes.map((c) => c.textContent).join('');
    }
    get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
    addEventListener() {}
    setAttribute(k, v) { this.attrs[k.toLowerCase()] = String(v); }
    getAttribute(k) { return this.attrs[k.toLowerCase()] ?? null; }
    append(...nodes) {
      for (const n of nodes) {
        this.childNodes.push(typeof n === 'string' ? new MockText(n) : n);
      }
    }
    replaceChildren(...nodes) {
      this.childNodes = nodes;
      this._innerHTML = null;
    }
    querySelector(sel) {
      const targetTag = sel.toUpperCase();
      if (this.tagName === targetTag) return this;
      for (const c of this.childNodes) {
        if (c.nodeType === 1) {
          const hit = c.querySelector(sel);
          if (hit) return hit;
        }
      }
      return null;
    }
    querySelectorAll(sel) {
      const allowed = new Set(sel.split(',').map((s) => s.trim().toUpperCase()));
      const out = [];
      const walk = (node) => {
        for (const c of node.childNodes) {
          if (c.nodeType !== 1) continue;
          if (allowed.has(c.tagName)) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    }
    toHtml() {
      const t = this.tagName.toLowerCase();
      const attrStr = Object.entries(this.attrs)
        .filter(([, v]) => v !== '' && v != null)
        .map(([k, v]) => ` ${k}="${v}"`)
        .join('');
      if (t === 'br') return '<br>';
      return `<${t}${attrStr}>${this.innerHTML}</${t}>`;
    }
  }
  function parseMiniHtml(html) {
    const root = new MockElement('body');
    const stack = [root];
    const tokRe = /<\/?([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g;
    let m;
    while ((m = tokRe.exec(String(html || ''))) !== null) {
      if (m[3] !== undefined) {
        const decoded = m[3]
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"');
        stack[stack.length - 1].childNodes.push(new MockText(decoded));
      } else if (m[0].startsWith('</')) {
        const closeTag = m[1].toUpperCase();
        while (stack.length > 1 && stack[stack.length - 1].tagName !== closeTag) stack.pop();
        if (stack.length > 1) stack.pop();
      } else {
        const tagName = m[1].toUpperCase();
        const el = new MockElement(tagName);
        const attrRe = /([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
        let am;
        while ((am = attrRe.exec(m[2] || '')) !== null) {
          el.setAttribute(am[1], am[2] ?? am[3] ?? am[4] ?? '');
        }
        stack[stack.length - 1].childNodes.push(el);
        if (!['BR', 'IMG', 'HR', 'INPUT'].includes(tagName) && !m[0].endsWith('/>')) {
          stack.push(el);
        }
      }
    }
    return root;
  }

  const prevDoc = globalThis.document;
  const prevDOMParser = globalThis.DOMParser;
  const prevNode = globalThis.Node;
  globalThis.Node = MockNode;
  globalThis.document = {
    createElement: (tag) => new MockElement(tag),
    createElementNS: (_ns, tag) => new MockElement(tag),
    createTextNode: (text) => new MockText(text)
  };
  globalThis.DOMParser = class {
    parseFromString(str) {
      return parseMiniHtml(str);
    }
  };

  try {
    const { appendFormattedInlineMath, renderSafeTableElement, renderRichMathBlock, renderInteractivePromptWithBlanks } = await import('../client/practice-rooms.mjs');

    const box1 = new MockElement('div');
    appendFormattedInlineMath(box1, '**Chú ý $x > 0$** và **"mùa đông hạt nhân"** cùng <u>$a_1$</u>');
    const html1 = box1.innerHTML;
    assert.ok(!html1.includes('**'), `Literal ** leaked in: ${html1}`);
    assert.ok(html1.includes('<strong>Chú ý <span class="forum-math-inline">'), `Expected KaTeX inside <strong>: ${html1}`);
    assert.ok(html1.includes('<math'), `Expected MathML inside inline math: ${html1}`);
    assert.ok(html1.includes('<u><span class="forum-math-inline">'), `Expected KaTeX inside <u>: ${html1}`);
    assert.ok(html1.includes('<strong>"mùa đông hạt nhân"</strong>'), `Expected bold quote: ${html1}`);

    const urlBox = new MockElement('div');
    appendFormattedInlineMath(urlBox, 'Xem https://example.com và https://test.vn cùng //in nghiêng $y$//');
    const urlHtml = urlBox.innerHTML;
    assert.ok(urlHtml.includes('https://example.com và https://test.vn'), `URLs should stay intact: ${urlHtml}`);
    assert.ok(urlHtml.includes('<em>in nghiêng <span class="forum-math-inline">'), `Italic with math should render: ${urlHtml}`);

    const tableWrap = renderSafeTableElement(
      '<table><tr><th><b>$x$</b></th><th><b>2*a</b></th></tr><tr><td><b>$-\\infty$</b><br><i>$f\'(x)$</i></td><td><u>$a_1$</u></td><td>$&gt; C_{70}$</td></tr></table>'
    );
    const tblHtml = tableWrap.innerHTML;
    assert.ok(!tblHtml.includes('**'), `Table cell leaked literal **: ${tblHtml}`);
    assert.ok(!/(?<!:)\/\//.test(tblHtml), `Table cell leaked literal //: ${tblHtml}`);
    assert.ok(tblHtml.includes('<strong><span class="forum-math-inline">'), `Table bold math failed: ${tblHtml}`);
    assert.ok(tblHtml.includes('<strong>2*a</strong>'), `Single asterisk inside bold table cell broke: ${tblHtml}`);
    assert.ok(tblHtml.includes('<em><span class="forum-math-inline">'), `Table italic math failed: ${tblHtml}`);
    assert.ok(tblHtml.includes('<u><span class="forum-math-inline">'), `Table underline math failed: ${tblHtml}`);
    assert.ok(!tblHtml.includes('forum-math-invalid'), `HTML-encoded comparator in table failed KaTeX: ${tblHtml}`);

    const richBox = new MockElement('div');
    const matrix = [String.raw`\[\begin{pmatrix}1 & 2 \\`, String.raw`3 & 4\end{pmatrix}\]`].join('\n');
    renderRichMathBlock(richBox, ['Cho ma trận', matrix, 'Tính $\u0394$.'].join('\n'));
    assert.equal(richBox.childNodes.length, 3);
    assert.match(richBox.innerHTML, /<math[^>]+display="block"/);
    assert.equal((richBox.innerHTML.match(/<mtr>/g) || []).length, 2);
    assert.doesNotMatch(richBox.innerHTML, /forum-math-invalid/);

    const dragPrompt = new MockElement('div');
    renderInteractivePromptWithBlanks(dragPrompt, {
      type: 'drag_drop', slotCount: 2, cards: ['1', '2'],
      prompt: String.raw`$\lim_{x \to +\infty} x^k = {{1}}$ và $({{2}};0)$`
    }, [], () => {});
    assert.match(dragPrompt.innerHTML, /<mi>lim<\/mi>/);
    assert.match(dragPrompt.innerHTML, /data-slot-index="0"/);
    assert.match(dragPrompt.innerHTML, /data-slot-index="1"/);
    assert.doesNotMatch(dragPrompt.innerHTML, /forum-math-invalid|\{\{/);

    const reviewPrompt = new MockElement('div');
    renderInteractivePromptWithBlanks(reviewPrompt, { type: 'fill_blank', blankCount: 1, prompt: '$x = {{1}}$' }, [], null, { readOnly: true });
    assert.match(reviewPrompt.innerHTML, /<strong>\[Ô 1\]<\/strong>/);
    assert.doesNotMatch(reviewPrompt.innerHTML, /<input|\{\{/);

    // Bảng biến thiên & Bảng xét dấu SVG renderer (#LTCH-10003, HSA Q11, cực trị, miền bị loại, bảng thống kê)
    const { evaluateMathScalar } = await import('../client/math-variation-table.mjs');
    assert.equal(evaluateMathScalar('-\\dfrac{1}{4}').value, -0.25);
    assert.equal(evaluateMathScalar('2{,}5').value, 2.5);
    assert.equal(evaluateMathScalar('-\\infty').kind, 'neg_inf');
    assert.equal(evaluateMathScalar('+\\infty').kind, 'pos_inf');
    assert.equal(evaluateMathScalar('m + 1').kind, 'sym');

    function collectBbtForeignObjects(html) {
      const items = [];
      const re = /<foreignobject\b([^>]*)>([\s\S]*?)<\/foreignobject>/gi;
      let match;
      while ((match = re.exec(html)) !== null) {
        const attrs = match[1];
        const roleMatch = /\bdata-bbt-role="([^"]+)"/i.exec(attrs);
        const cyMatch = /\bdata-bbt-cy="([^"]+)"/i.exec(attrs);
        items.push({
          role: roleMatch ? roleMatch[1] : '',
          cy: cyMatch ? Number(cyMatch[1]) : NaN,
          html: match[2]
        });
      }
      return items;
    }

    // 1. Chính xác bảng #LTCH-10003 (6 cột nén với 4 ↗ | +∞ | || | -∞ | ↗ 4)
    const ltch10003Html = [
      '<table>',
      '<tr><td>$x$</td><td>$-\\infty$</td><td></td><td>$2$</td><td></td><td>$+\\infty$</td></tr>',
      '<tr><td>$y\'$</td><td></td><td>$+$</td><td>$||$</td><td>$+$</td><td></td></tr>',
      '<tr><td>$y$</td><td>$4 \\nearrow$</td><td>$+\\infty$</td><td>$||$</td><td>$-\\infty$</td><td>$\\nearrow 4$</td></tr>',
      '</table>'
    ].join('');
    const ltch10003Wrap = renderSafeTableElement(ltch10003Html);
    const ltch10003Out = ltch10003Wrap.innerHTML;
    assert.ok(ltch10003Out.includes('ltch-bbt-svg'), 'Should render #LTCH-10003 as mathematical SVG BBT');
    assert.ok(!ltch10003Out.includes('ltch-content-table'), 'Should not render raw HTML grid table for BBT');
    assert.ok(!/\bstyle\s*=/i.test(ltch10003Out), 'Must emit zero inline style attributes for strict CSP');
    assert.equal((ltch10003Out.match(/ltch-bbt-dbar/g) || []).length, 2, 'Should render full-height double bar ||');
    assert.equal((ltch10003Out.match(/ltch-bbt-arrow-head/g) || []).length, 2, 'Should render 2 diagonal vector arrows');
    const fos10003 = collectBbtForeignObjects(ltch10003Out);
    const yVals10003 = fos10003.filter((f) => f.role === 'y-val');
    const yLeftInf = fos10003.find((f) => f.role === 'y-limit-left');
    const yRightInf = fos10003.find((f) => f.role === 'y-limit-right');
    assert.equal(yVals10003.length, 2);
    assert.ok(yLeftInf && yRightInf, 'Asymptotic +inf and -inf limits beside || must both be positioned');
    assert.equal(yVals10003[0].cy, yVals10003[1].cy, 'Equal horizontal asymptotes y=4 must share identical height');
    assert.ok(yLeftInf.cy < yVals10003[0].cy, '+∞ must sit strictly higher than y=4 (smaller SVG y)');
    assert.ok(yVals10003[0].cy < yRightInf.cy, 'y=4 must sit strictly higher than -∞ (smaller SVG y)');

    // 2. Bảng xét dấu 2 hàng kiểu HSA Câu 11
    const hsaQ11Html = [
      '<table>',
      '<tr><th><b>$x$</b></th><th><b>$-\\infty$</b></th><th></th><th><b>$0$</b></th><th></th><th><b>$1$</b></th><th></th><th><b>$+\\infty$</b></th></tr>',
      '<tr><td>$f\'(x)$</td><td></td><td>$+$</td><td>$0$</td><td>$-$</td><td>$0$</td><td>$+$</td><td></td></tr>',
      '</table>'
    ].join('');
    const hsaQ11Out = renderSafeTableElement(hsaQ11Html).innerHTML;
    assert.ok(hsaQ11Out.includes('ltch-bbt-svg'), '2-row sign table should render as SVG BXD');
    assert.ok(!hsaQ11Out.includes('ltch-content-table'));
    assert.ok(!/\bstyle\s*=/i.test(hsaQ11Out));
    assert.equal((hsaQ11Out.match(/data-bbt-role="sign-interval"/g) || []).length, 3);
    assert.equal((hsaQ11Out.match(/data-bbt-role="sign-zero"/g) || []).length, 2);

    // 3. BBT nhiều cực trị [-inf, 3, -3, 4, -2, +inf] -> kiểm tra đúng thứ tự cao độ toán học
    const multiExtHtml = [
      '<table>',
      '<tr><td>$x$</td><td>$-\\infty$</td><td></td><td>$-2$</td><td></td><td>$0$</td><td></td><td>$1$</td><td></td><td>$3$</td><td></td><td>$+\\infty$</td></tr>',
      '<tr><td>$y\'$</td><td></td><td>$+$</td><td>$0$</td><td>$-$</td><td>$0$</td><td>$+$</td><td>$0$</td><td>$-$</td><td>$0$</td><td>$+$</td><td></td></tr>',
      '<tr><td>$y$</td><td>$-\\infty$</td><td></td><td>$3$</td><td></td><td>$-3$</td><td></td><td>$4$</td><td></td><td>$-2$</td><td></td><td>$+\\infty$</td></tr>',
      '</table>'
    ].join('');
    const multiOut = renderSafeTableElement(multiExtHtml).innerHTML;
    const multiY = collectBbtForeignObjects(multiOut).filter((f) => f.role === 'y-val').map((f) => f.cy);
    assert.equal(multiY.length, 6);
    const [cyNegInf, cy3, cyNeg3, cy4, cyNeg2, cyPosInf] = multiY;
    assert.ok(cyPosInf < cy4 && cy4 < cy3 && cy3 < cyNeg2 && cyNeg2 < cyNeg3 && cyNeg3 < cyNegInf,
      `Extrema heights out of mathematical order: ${JSON.stringify(multiY)}`);

    // 4. BBT có miền không xác định gạch chéo //// và vạch kép ||
    const hatchHtml = [
      '<table>',
      '<tr><td>$x$</td><td>$-\\infty$</td><td></td><td>$-1$</td><td></td><td>$1$</td><td></td><td>$+\\infty$</td></tr>',
      '<tr><td>$y\'$</td><td></td><td>$-$</td><td>$||$</td><td>////</td><td>$||$</td><td>$+$</td><td></td></tr>',
      '<tr><td>$y$</td><td>$+\\infty$</td><td></td><td>$0$</td><td>////</td><td>$0$</td><td></td><td>$+\\infty$</td></tr>',
      '</table>'
    ].join('');
    const hatchOut = renderSafeTableElement(hatchHtml).innerHTML;
    assert.ok(hatchOut.includes('ltch-bbt-hatch'), 'Undefined interval must render diagonal hatching');
    assert.ok(hatchOut.includes('ltch-bbt-dbar'), 'Open endpoints must render double vertical bars');
    assert.equal((hatchOut.match(/ltch-bbt-arrow-head/g) || []).length, 2, 'Only defined intervals get arrows');

    // 5. Bảng thống kê / bảng số liệu thường KHÔNG bị nhận nhầm thành BBT
    const freqTableHtml = [
      '<table>',
      '<tr><td>Thời gian chờ (phút)</td><td>$[0;10)$</td><td>$[10;20)$</td><td>$[20;30)$</td><td>$[30;40)$</td></tr>',
      '<tr><td>Số khách hàng</td><td>9</td><td>14</td><td>21</td><td>12</td></tr>',
      '</table>'
    ].join('');
    assert.ok(renderSafeTableElement(freqTableHtml).innerHTML.includes('ltch-content-table'));

    const revTableHtml = '<table><tr><th>Quý</th><th>I</th><th>II</th><th>III</th><th>IV</th></tr><tr><td>Doanh thu</td><td>120</td><td>150</td><td>180</td><td>150</td></tr></table>';
    assert.ok(renderSafeTableElement(revTableHtml).innerHTML.includes('ltch-content-table'));
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
    if (prevDOMParser === undefined) delete globalThis.DOMParser;
    else globalThis.DOMParser = prevDOMParser;
    if (prevNode === undefined) delete globalThis.Node;
    else globalThis.Node = prevNode;
  }
});

function buildMinimalDocxFromBodyXml(bodyXml) {
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}</w:body></w:document>`;
  const data = Buffer.from(docXml, 'utf8');
  const name = Buffer.from('word/document.xml', 'utf8');
  const localHeader = Buffer.alloc(30 + name.length);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt32LE(data.length, 18);
  localHeader.writeUInt32LE(data.length, 22);
  localHeader.writeUInt16LE(name.length, 26);
  name.copy(localHeader, 30);

  const cdHeader = Buffer.alloc(46 + name.length);
  cdHeader.writeUInt32LE(0x02014b50, 0);
  cdHeader.writeUInt16LE(20, 4);
  cdHeader.writeUInt16LE(20, 6);
  cdHeader.writeUInt16LE(0, 10);
  cdHeader.writeUInt32LE(data.length, 20);
  cdHeader.writeUInt32LE(data.length, 24);
  cdHeader.writeUInt16LE(name.length, 28);
  cdHeader.writeUInt32LE(0, 42);
  name.copy(cdHeader, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdHeader.length, 12);
  eocd.writeUInt32LE(localHeader.length + data.length, 16);

  return Buffer.concat([localHeader, data, cdHeader, eocd]);
}

function xmlEscape(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function makeParagraphXml(text, { underlinePrefix = false, highlightPrefix = false } = {}) {
  if ((underlinePrefix || highlightPrefix) && /^[A-F][.)]\s+/i.test(text)) {
    const prefix = text.slice(0, 2);
    const rest = text.slice(2);
    const rPr = underlinePrefix
      ? '<w:rPr><w:u w:val="single"/></w:rPr>'
      : '<w:rPr><w:color w:val="FF0000"/></w:rPr>';
    return `<w:p><w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(prefix)}</w:t></w:r><w:r><w:t xml:space="preserve">${xmlEscape(rest)}</w:t></w:r></w:p>`;
  }
  return `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

test('Auto-detect normal Word (.docx) exam (THPTQG 22 questions without [...] tags, inline options, underlined/table answers)', async () => {
  const p = (t, opts) => makeParagraphXml(t, opts);
  const lines = [
    p('KỲ THI TỐT NGHIỆP THPT NĂM 2026'),
    p('ĐỀ THI THỬ MÔN TOÁN 12 - Mã đề: 0101'),
    p('PHẦN I. Câu trắc nghiệm nhiều phương án lựa chọn')
  ];

  // 12 câu Phần I: 6 câu đầu đánh dấu gạch chân/màu đỏ ở chữ cái đáp án, 6 câu sau tra từ BẢNG ĐÁP ÁN cuối đề, một số câu để 2-4 phương án trên cùng 1 dòng
  for (let i = 1; i <= 12; i++) {
    lines.push(p(`Câu ${i}: Cho cấp số cộng $(u_n)$ có $u_1 = ${i}$ và $d = 2$. Giá trị của $u_2$ bằng`));
    if (i <= 3) {
      lines.push(p('A. $1$.', { underlinePrefix: i === 1 }));
      lines.push(p('B. $3$.', { underlinePrefix: i === 2 }));
      lines.push(p('C. $5$.', { highlightPrefix: i === 3 }));
      lines.push(p('D. $7$.'));
    } else if (i <= 6) {
      // Đánh dấu bằng dấu sao *A.
      lines.push(p(`A. $${i + 1}$   *B. $${i + 2}$   C. $${i + 3}$   D. $${i + 4}$`));
    } else {
      // Phương án nhiều cột trên 2 dòng, đáp án nằm ở bảng đáp án cuối đề
      lines.push(p(`A. $${i + 1}$.   B. $${i + 2}$.`));
      lines.push(p(`C. $${i + 3}$.   D. $${i + 4}$.`));
    }
    lines.push(p(`Lời giải: Áp dụng công thức $u_2 = u_1 + d = ${i + 2}$.`));
  }

  lines.push(p('PHẦN II. Câu trắc nghiệm đúng sai'));
  for (let i = 13; i <= 16; i++) {
    lines.push(p(`Câu ${i}: Cho hàm số $f(x) = x^3 - 3x + ${i}$. Xét tính đúng sai của các mệnh đề sau:`));
    lines.push(p('a) Đạo hàm của hàm số là $f\'(x) = 3x^2 - 3$.'));
    lines.push(p('b) Hàm số đồng biến trên khoảng $(-1; 1)$.'));
    lines.push(p('c) Hàm số đạt cực đại tại $x = -1$.'));
    lines.push(p('d) Giá trị cực tiểu của hàm số bằng $0$.'));
    if (i % 2 === 1) {
      lines.push(p('Đáp án: a - Đúng, b - Sai, c - Đúng, d - Sai'));
    } else {
      lines.push(p('Đáp án cần chọn là: Đ; S; Đ; Đ'));
    }
    lines.push(p('Giải chi tiết: Tính đạo hàm và lập bảng biến thiên của hàm số bậc ba.'));
  }

  lines.push(p('PHẦN III. Câu trắc nghiệm trả lời ngắn'));
  for (let i = 17; i <= 22; i++) {
    lines.push(p(`Câu ${i}: Tính tích phân $I = \\int_0^3 (2x + ${i})\\,dx$.`));
    lines.push(p(`Đáp số: ${9 + 3 * i}`));
    lines.push(p('Hướng dẫn giải: Tính nguyên hàm trực tiếp trên đoạn $[0; 3]$.'));
  }

  // Bảng đáp án tổng hợp cuối đề cho các câu 7..12
  lines.push(p('BẢNG ĐÁP ÁN'));
  lines.push(p('7.B   8.C   9.D   10.A   11.B   12.C'));

  const docxBuf = buildMinimalDocxFromBodyXml(lines.join(''));
  const parsed = await parseWordExamDocx(docxBuf, { expectedExamType: 'thptqg' });

  assert.equal(parsed.parseMode, 'auto');
  assert.equal(parsed.errors.length, 0, `Unexpected auto-parse errors: ${JSON.stringify(parsed.errors)}`);
  assert.equal(parsed.meta.examType, 'thptqg');
  assert.equal(parsed.meta.grade, 12);
  assert.equal(parsed.meta.examCode, '0101');
  assert.equal(parsed.questions.length, 22);
  assert.equal(parsed.publishReady, true, `Expected publishReady, got publishErrors: ${JSON.stringify(parsed.publishErrors)}`);

  assert.equal(parsed.questions[0].answer, 'A');
  assert.equal(parsed.questions[1].answer, 'B');
  assert.equal(parsed.questions[2].answer, 'C');
  assert.equal(parsed.questions[3].answer, 'B');
  assert.equal(parsed.questions[6].answer, 'B');
  assert.equal(parsed.questions[7].answer, 'C');
  assert.equal(parsed.questions[8].answer, 'D');
  assert.equal(parsed.questions[11].answer, 'C');

  assert.equal(parsed.questions[12].type, 'true_false');
  assert.deepEqual(parsed.questions[12].answers, [true, false, true, false]);
  assert.deepEqual(parsed.questions[13].answers, [true, false, true, true]);

  assert.equal(parsed.questions[16].type, 'short');
  assert.deepEqual(parsed.questions[16].accepted, ['60']);
});

test('Auto-detect normal Word (.docx) exam for HSA & TSA (passages, subjects by Q-number, drag_drop, fill_blank, multiple)', async () => {
  const p = (t) => makeParagraphXml(t);
  const tsaLines = [
    p('ĐỀ LUYỆN THI TSA ĐÁNH GIÁ TƯ DUY 2026 - Mã đề 05'),
    p('PHẦN 1: TƯ DUY TOÁN HỌC'),
    p('Câu 1 (TH): Kéo ô thích hợp và thả vào vị trí tương ứng'),
    p('Khai triển $(x - 3)^4$. Khi đó:'),
    p('1. Hệ số của $x^3$ trong khai triển là _______'),
    p('2. Hệ số của $x^2$ trong khai triển là _______'),
    p('3. Tổng các hệ số của các hạng tử bậc chẵn bằng _______'),
    p('Các thẻ đáp án: 81 ; 136 ; -12 ; 54'),
    p('Đáp án đúng là: -12 ; 54 ; 136'),
    p('Giải chi tiết: Ta có $(x-3)^4 = x^4 - 12x^3 + 54x^2 - 108x + 81$.'),
    p('Câu 2 (TH): Điền số thích hợp vào chỗ trống'),
    p('Số tự nhiên $a$ chia cho 7 dư 5, chia cho 13 dư 4. Số dư khi chia $a$ cho 91 là: _______'),
    p('Đáp án cần điền là: 82'),
    p('Giải chi tiết: $a + 9$ chia hết cho cả 7 và 13 nên chia hết cho 91.'),
    p('PHẦN 2: TƯ DUY ĐỌC HIỂU'),
    p('Đọc văn bản sau và trả lời các câu hỏi từ câu 3 đến câu 4:'),
    p('Sóng siêu âm là sóng cơ học có tần số lớn hơn 20000 Hz, được ứng dụng rộng rãi trong y học để chẩn đoán hình ảnh không xâm lấn.'),
    p('Câu 3 (NB): Thông tin nào dưới đây đúng về sóng siêu âm? (Chọn hai đáp án đúng)'),
    p('A. Có tần số trên 20000 Hz.'),
    p('B. Là sóng điện từ giống tia X.'),
    p('C. Được dùng trong chẩn đoán hình ảnh y khoa.'),
    p('D. Không truyền được trong chất rắn.'),
    p('Đáp án: A, C'),
    p('Giải chi tiết: Theo đoạn văn, sóng siêu âm là sóng cơ tần số trên 20000 Hz dùng trong y học.'),
    p('Câu 4 (TH): Sóng siêu âm có bản chất là sóng điện từ.'),
    p('Đáp án: Sai'),
    p('Giải chi tiết: Sóng siêu âm là sóng cơ, không phải sóng điện từ.'),
    p('Câu 5 (VD): Câu hỏi đơn nằm ngoài ngữ liệu (sau câu 4). Tính $2 + 2$:'),
    p('A. 3.   B. 4.   C. 5.   D. 6.'),
    p('Đáp án: B'),
    p('Giải chi tiết: $2 + 2 = 4$.')
  ];

  const tsaDocx = buildMinimalDocxFromBodyXml(tsaLines.join(''));
  const tsaParsed = await parseWordExamDocx(tsaDocx, { expectedExamType: 'tsa' });

  assert.equal(tsaParsed.parseMode, 'auto');
  assert.equal(tsaParsed.errors.length, 0, `TSA auto errors: ${JSON.stringify(tsaParsed.errors)}`);
  assert.equal(tsaParsed.questions.length, 5);

  const q1 = tsaParsed.questions[0];
  assert.equal(q1.type, 'drag_drop');
  assert.deepEqual(q1.cards, ['81', '136', '-12', '54']);
  assert.deepEqual(q1.answer, ['T3', 'T4', 'T2']);

  const q2 = tsaParsed.questions[1];
  assert.equal(q2.type, 'fill_blank');
  assert.equal(q2.blanks.length, 1);
  assert.deepEqual(q2.blanks[0].accepted, ['82']);

  const q3 = tsaParsed.questions[2];
  assert.equal(q3.section, 'part_2');
  assert.equal(q3.type, 'multiple');
  assert.deepEqual(q3.answers, ['A', 'C']);
  assert.ok(q3.passageId, 'Q3 must belong to reading passage');
  assert.ok(q3.passageContent.includes('Sóng siêu âm'));

  const q4 = tsaParsed.questions[3];
  assert.equal(q4.type, 'true_false');
  assert.equal(q4.statements.length, 1);
  assert.deepEqual(q4.answers, [false]);
  assert.equal(q4.passageId, q3.passageId, 'Q4 must share passage with Q3');

  const q5 = tsaParsed.questions[4];
  assert.equal(q5.passageId, null, 'Q5 after range 3..4 must automatically exit passage');

  // Kiểm tra tự nhận diện môn HSA theo số câu 401..417 (Lịch sử) kèm bảng đáp án ở trang đầu như đề HSA gốc
  const hsaLines = [
    p('ĐỀ THI THAM KHẢO KỲ THI ĐÁNH GIÁ NĂNG LỰC HSA'),
    p('401. B   402. A'),
    p('PHẦN III: KHOA HỌC'),
    p('Chủ đề Lịch sử có 17 câu hỏi từ 401 đến 417'),
    p('Câu 401: [EMPIRE TEAM] Việt Nam rút ra kinh nghiệm gì từ cuộc cách mạng KH-CN?'),
    p('A. Tập trung công nghiệp nặng.   B. Ứng dụng thành tựu KH-KT hiện đại.   C. Đóng cửa thị trường.   D. Cắt giảm giáo dục.'),
    p('Câu 402: [EMPIRE TEAM] Người Việt đã tiếp thu có chọn lọc tinh hoa văn minh Trung Hoa trên lĩnh vực nào?'),
    p('A. Thể chế chính trị, luật pháp, chữ viết.   B. Du mục thảo nguyên.   C. Hàng hải đại dương.   D. Băng tuyết cực bắc.')
  ];
  const hsaDocx = buildMinimalDocxFromBodyXml(hsaLines.join(''));
  const hsaParsed = await parseWordExamDocx(hsaDocx, { expectedExamType: 'hsa' });
  assert.equal(hsaParsed.parseMode, 'auto');
  assert.equal(hsaParsed.errors.length, 0, `HSA auto errors: ${JSON.stringify(hsaParsed.errors)}`);
  assert.equal(hsaParsed.questions.length, 2);
  assert.equal(hsaParsed.questions[0].section, 'part_3');
  assert.equal(hsaParsed.questions[0].subject, 'history');
  assert.equal(hsaParsed.questions[0].answer, 'B');
  assert.ok(!hsaParsed.questions[0].prompt.includes('[EMPIRE TEAM]'), 'Should strip source team bracket tag');
  assert.equal(hsaParsed.questions[1].subject, 'history');
  assert.equal(hsaParsed.questions[1].answer, 'A');
});
