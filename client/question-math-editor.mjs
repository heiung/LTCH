import {parseForumMath, renderForumFormula} from './forum-math.mjs';
import {serializeQuestionContent} from './question-content.mjs';
import {createQuestionHistory} from './question-history.mjs';
import {MATH_PRESET_GROUPS, buildFormulaDelimiters} from './question-math-presets.mjs';
import {createVisualMathField} from './visual-math-field.mjs';

const ICONS = {
  sigma: '<path d="M18 4H6l6 8-6 8h12"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  redo: '<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/>',
  keyboard: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  arrowLeft: '<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  backspace: '<path d="M20 5H9l-7 7 7 7h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z"/><path d="m17 9-5 6"/><path d="m12 9 5 6"/>',
  enter: '<path d="M19 5v6a3 3 0 0 1-3 3H5"/><path d="m9 10-4 4 4 4"/>'
};

const VIRTUAL_KEYPAD_ROWS = [
  [
    {label: '7', type: 'char', val: '7'},
    {label: '8', type: 'char', val: '8'},
    {label: '9', type: 'char', val: '9'},
    {label: '+', type: 'char', val: '+', ariaLabel: 'Phép cộng'},
    {label: '−', type: 'char', val: '-', ariaLabel: 'Phép trừ'},
    {preview: '\\frac{\\square}{\\square}', type: 'tpl', val: '\\frac{#@}{#?}', ariaLabel: 'Phân số', accent: true},
    {preview: '\\sqrt{\\square}', type: 'tpl', val: '\\sqrt{#@}', ariaLabel: 'Căn bậc hai', accent: true},
    {icon: 'backspace', type: 'nav', val: 'backspace', ariaLabel: 'Xóa lùi', wide: true}
  ],
  [
    {label: '4', type: 'char', val: '4'},
    {label: '5', type: 'char', val: '5'},
    {label: '6', type: 'char', val: '6'},
    {label: '⋅', type: 'tpl', val: '\\cdot ', ariaLabel: 'Phép nhân'},
    {label: '÷', type: 'tpl', val: '\\div ', ariaLabel: 'Phép chia'},
    {preview: 'x^{\\square}', type: 'tpl', val: '#@^{#?}', ariaLabel: 'Lũy thừa', accent: true},
    {preview: 'x_{\\square}', type: 'tpl', val: '#@_{#?}', ariaLabel: 'Chỉ số dưới', accent: true},
    {icon: 'enter', type: 'nav', val: 'newline', ariaLabel: 'Xuống dòng', wide: true}
  ],
  [
    {label: '1', type: 'char', val: '1'},
    {label: '2', type: 'char', val: '2'},
    {label: '3', type: 'char', val: '3'},
    {label: '=', type: 'char', val: '=', ariaLabel: 'Dấu bằng'},
    {label: '(', type: 'char', val: '(', ariaLabel: 'Mở ngoặc'},
    {label: ')', type: 'char', val: ')', ariaLabel: 'Đóng ngoặc'},
    {preview: '\\left|\\square\\right|', type: 'tpl', val: '\\left|#@\\right|', ariaLabel: 'Giá trị tuyệt đối'},
    {label: '±', type: 'tpl', val: '\\pm ', ariaLabel: 'Cộng trừ'}
  ],
  [
    {label: '0', type: 'char', val: '0'},
    {label: 'x', type: 'char', val: 'x', italic: true},
    {label: 'y', type: 'char', val: 'y', italic: true},
    {label: '≤', type: 'tpl', val: '\\le ', ariaLabel: 'Nhỏ hơn hoặc bằng'},
    {label: '≥', type: 'tpl', val: '\\ge ', ariaLabel: 'Lớn hơn hoặc bằng'},
    {label: '≠', type: 'tpl', val: '\\neq ', ariaLabel: 'Khác'},
    {icon: 'arrowLeft', type: 'nav', val: 'left', ariaLabel: 'Qua trái'},
    {icon: 'arrowRight', type: 'nav', val: 'right', ariaLabel: 'Qua phải'}
  ]
];

const QUICK_TOOLBAR_ITEMS = [
  {kind: 'struct', preview: '\\frac{\\square}{\\square}', val: '\\frac{#@}{#?}', ariaLabel: 'Chèn phân số'},
  {kind: 'struct', preview: '\\sqrt{\\square}', val: '\\sqrt{#@}', ariaLabel: 'Chèn căn bậc hai'},
  {kind: 'struct', preview: 'x^{\\square}', val: '#@^{#?}', ariaLabel: 'Chèn lũy thừa'},
  {kind: 'struct', preview: '\\begin{cases}\\square\\\\\\square\\end{cases}', val: '\\begin{cases}#@\\\\#?\\end{cases}', ariaLabel: 'Chèn hệ phương trình'},
  {kind: 'symbol', preview: '\\le', latex: '\\le', ariaLabel: 'Chèn dấu nhỏ hơn hoặc bằng'},
  {kind: 'symbol', preview: '\\ge', latex: '\\ge', ariaLabel: 'Chèn dấu lớn hơn hoặc bằng'},
  {kind: 'symbol', preview: '\\Rightarrow', latex: '\\Rightarrow', ariaLabel: 'Chèn dấu suy ra'},
  {kind: 'symbol', preview: '\\Leftrightarrow', latex: '\\Leftrightarrow', ariaLabel: 'Chèn dấu tương đương'}
];

const STAGE_NAV_BUTTONS = [
  {icon: 'arrowLeft', val: 'left', ariaLabel: 'Di chuyển sang trái'},
  {icon: 'arrowRight', val: 'right', ariaLabel: 'Di chuyển sang phải'},
  {icon: 'backspace', val: 'backspace', ariaLabel: 'Xóa lùi'}
];

// The existing textarea remains the serialized source used by the form and API.
export function createQuestionMathEditor(input, options = {}) {
  const isReply = options.variant === 'reply';
  const fieldLabel = options.label || (isReply ? 'Nội dung trả lời' : 'Nội dung câu hỏi');
  const placeholderText = options.placeholder || input.placeholder || (isReply
    ? 'Viết lời giải hoặc hướng dẫn…'
    : 'Mô tả bài toán và điều bạn muốn hỏi…');
  const insertConfirmLabel = options.confirmLabel || 'Chèn công thức';

  const make = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  };
  const svgIcon = (name, size = 16, strokeWidth = 2) => {
    const wrap = make('span', 'qm-icon');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
    return wrap;
  };
  const button = (label, action, cls = '', iconName = '') => {
    const node = make('button', cls);
    node.type = 'button';
    if (iconName) node.append(svgIcon(iconName));
    if (label) node.append(make('span', 'qm-btn-label', label));
    node.addEventListener('click', action);
    return node;
  };
  const renderGlyph = (previewExpr, fallback = '') => {
    try {
      return renderForumFormula(previewExpr, false);
    } catch {
      return fallback;
    }
  };

  const root = make('div', `question-math-editor${isReply ? ' is-reply-editor' : ''}`);
  const composerShell = make('div', 'qm-composer-shell');

  // Toolbar integrated cleanly at top of rich editor
  const editorToolbar = make('div', 'qm-editor-toolbar');
  const openButton = button('Công thức', () => open(), 'question-math-open qm-open-btn', 'sigma');
  openButton.setAttribute('aria-expanded', 'false');
  openButton.setAttribute('aria-label', 'Mở bộ gõ công thức toán');

  const historyGroup = make('div', 'qm-history-group');
  const undoButton = button('', undo, 'question-history-button qm-icon-btn', 'undo');
  undoButton.setAttribute('aria-label', 'Hoàn tác nội dung');
  const redoButton = button('', redo, 'question-history-button qm-icon-btn', 'redo');
  redoButton.setAttribute('aria-label', 'Làm lại nội dung');
  historyGroup.append(undoButton, redoButton);

  const quickBar = make('div', 'qm-quick-bar');
  quickBar.setAttribute('role', 'group');
  quickBar.setAttribute('aria-label', 'Chèn nhanh công thức toán');
  for (const item of QUICK_TOOLBAR_ITEMS) {
    const qBtn = make('button', `qm-quick-btn${item.kind === 'symbol' ? ' is-symbol' : ''}`);
    qBtn.type = 'button';
    qBtn.setAttribute('aria-label', item.ariaLabel);
    const glyph = make('span', 'qm-quick-glyph');
    glyph.setAttribute('aria-hidden', 'true');
    const html = renderGlyph(item.preview);
    if (html) glyph.innerHTML = html;
    else glyph.textContent = item.latex || '';
    qBtn.append(glyph);
    qBtn.addEventListener('pointerdown', e => e.preventDefault());
    qBtn.addEventListener('click', () => handleQuickToolbarAction(item));
    quickBar.append(qBtn);
  }

  editorToolbar.append(openButton, quickBar, historyGroup);

  const editor = make('div', 'question-rich-input');
  editor.contentEditable = 'true';
  editor.setAttribute('role', 'textbox');
  editor.setAttribute('aria-label', fieldLabel);
  editor.setAttribute('aria-multiline', 'true');
  editor.setAttribute('aria-required', 'true');
  editor.dataset.placeholder = placeholderText;

  // Clicking associated <label> focuses the contentEditable box
  const parentLabel = input.closest('label');
  if (parentLabel) {
    parentLabel.addEventListener('click', event => {
      if (event.target === editor || editor.contains(event.target) || panel.contains(event.target)) return;
      event.preventDefault();
      editor.focus();
    });
  }

  input.hidden = true;
  input.required = false;

  const editorFooter = make('div', 'qm-editor-footer');
  const hint = make('p', 'question-editor-hint');
  hint.setAttribute('aria-live', 'polite');
  hint.hidden = true;
  const counter = make('span', 'qm-char-counter');
  editorFooter.append(hint, counter);

  composerShell.append(editorToolbar, editor, editorFooter);

  // Visual-only Math Studio Panel (Formula-first, zero captions)
  const panel = make('section', 'question-math-panel');
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Bộ gõ công thức toán học');

  let savedRange = null;
  let activeFormula = null;

  // Compact single-row panel header (Newline button + utility controls)
  const panelHeader = make('div', 'qm-panel-header');
  const leftControls = make('div', 'qm-header-left');
  const newlineBtn = button('Xuống dòng', () => {
    visualField.insertNewline();
    onVisualInput();
  }, 'qm-newline-btn', 'enter');
  newlineBtn.setAttribute('aria-label', 'Xuống dòng mới trong công thức');
  newlineBtn.addEventListener('pointerdown', e => e.preventDefault());
  leftControls.append(newlineBtn);

  const headerControls = make('div', 'qm-header-controls');
  const mathUndoBtn = button('', () => {
    visualField.undo();
    onVisualInput();
  }, 'qm-icon-btn qm-sm-btn', 'undo');
  mathUndoBtn.setAttribute('aria-label', 'Hoàn tác công thức');

  const mathRedoBtn = button('', () => {
    visualField.redo();
    onVisualInput();
  }, 'qm-icon-btn qm-sm-btn', 'redo');
  mathRedoBtn.setAttribute('aria-label', 'Làm lại công thức');

  const vkbBtn = button('', () => toggleVirtualKeypad(), 'qm-icon-btn qm-sm-btn qm-vkb-toggle', 'keyboard');
  vkbBtn.setAttribute('aria-label', 'Bật hoặc tắt bàn phím số toán học');
  vkbBtn.setAttribute('aria-pressed', 'false');

  const closePanelBtn = button('', () => close(), 'qm-icon-btn qm-close-btn', 'close');
  closePanelBtn.setAttribute('aria-label', 'Đóng bộ gõ công thức');

  headerControls.append(mathUndoBtn, mathRedoBtn, vkbBtn, closePanelBtn);
  panelHeader.append(leftControls, headerControls);

  // Input Stage: Visual Field + 3 Crisp SVG Nav Keys + Virtual Keypad
  const inputStage = make('div', 'qm-input-stage');
  const fieldRow = make('div', 'qm-field-row');
  const visualField = createVisualMathField({
    ariaLabel: 'Ô nhập công thức trực quan',
    placeholder: 'Nhập công thức…'
  });

  const stageNav = make('div', 'qm-stage-nav');
  stageNav.setAttribute('role', 'group');
  stageNav.setAttribute('aria-label', 'Điều hướng ô công thức');
  for (const navSpec of STAGE_NAV_BUTTONS) {
    const nBtn = make('button', 'qm-nav-key');
    nBtn.type = 'button';
    nBtn.setAttribute('aria-label', navSpec.ariaLabel);
    nBtn.append(svgIcon(navSpec.icon, 20, 2.25));
    nBtn.addEventListener('pointerdown', e => e.preventDefault());
    nBtn.addEventListener('click', () => handleVirtualKey({type: 'nav', val: navSpec.val}));
    stageNav.append(nBtn);
  }
  fieldRow.append(visualField.element, stageNav);

  // Built-in Virtual Math Keypad (formula glyphs + crisp SVG operators)
  const keypadBox = make('div', 'qm-virtual-keypad');
  keypadBox.hidden = true;
  keypadBox.setAttribute('role', 'group');
  keypadBox.setAttribute('aria-label', 'Bàn phím toán học ảo');

  for (const rowSpecs of VIRTUAL_KEYPAD_ROWS) {
    const rowEl = make('div', 'qm-vkb-row');
    for (const keySpec of rowSpecs) {
      const cls = [
        'qm-vkb-key',
        keySpec.accent ? 'is-accent' : '',
        keySpec.wide ? 'is-wide' : '',
        keySpec.italic ? 'is-italic' : ''
      ].filter(Boolean).join(' ');
      const keyBtn = make('button', cls);
      keyBtn.type = 'button';
      if (keySpec.ariaLabel) {
        keyBtn.setAttribute('aria-label', keySpec.ariaLabel);
      }
      if (keySpec.icon) {
        keyBtn.append(svgIcon(keySpec.icon, 19, 2.2));
      } else if (keySpec.preview) {
        const glyph = make('span', 'qm-vkb-glyph');
        glyph.setAttribute('aria-hidden', 'true');
        const html = renderGlyph(keySpec.preview);
        if (html) glyph.innerHTML = html;
        else glyph.textContent = keySpec.label || '';
        keyBtn.append(glyph);
      } else {
        keyBtn.textContent = keySpec.label;
      }
      keyBtn.addEventListener('pointerdown', e => e.preventDefault());
      keyBtn.addEventListener('click', () => handleVirtualKey(keySpec));
      rowEl.append(keyBtn);
    }
    keypadBox.append(rowEl);
  }

  inputStage.append(fieldRow, keypadBox);

  // Preset Category Tabs & Visual Formula Grid (pure glyphs, zero captions)
  const libraryBox = make('div', 'qm-library-box');
  const tabs = make('div', 'question-math-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Nhóm mẫu công thức');
  const tools = make('div', 'question-math-buttons');
  tools.setAttribute('role', 'group');
  tools.setAttribute('aria-label', 'Mẫu công thức toán');
  libraryBox.append(tabs, tools);

  // Error-only status message
  const status = make('p', 'question-math-feedback');
  status.setAttribute('role', 'status');
  status.hidden = true;

  const footer = make('div', 'question-math-footer');
  const removeButton = button('Xóa', () => {
    if (!activeFormula?.isConnected) return;
    saveBeforeEdit();
    const range = document.createRange();
    range.setStartBefore(activeFormula);
    range.collapse(true);
    activeFormula.remove();
    sync();
    close(range);
    recordEdit();
  }, 'question-math-delete danger', 'trash');
  removeButton.setAttribute('aria-label', 'Xóa công thức đang chọn');

  const cancelBtn = button('Hủy', () => close(), 'qm-cancel-btn');
  const confirmButton = button(insertConfirmLabel, () => commitFormula(), 'primary qm-confirm-btn', 'check');
  footer.append(removeButton, cancelBtn, confirmButton);

  panel.append(panelHeader, inputStage, libraryBox, status, footer);
  root.append(composerShell, panel);

  const cleanFormulaOutput = () => visualField.value.replace(/\\placeholder\{\}/g, '').replace(/\\placeholder\b/g, '');

  function clearFeedback() {
    status.textContent = '';
    status.hidden = true;
    delete status.dataset.tone;
  }

  function setFeedback(text, tone = 'error') {
    if (!text) {
      clearFeedback();
      return;
    }
    status.textContent = text;
    status.dataset.tone = tone;
    status.hidden = false;
  }

  function clearEditorHint() {
    hint.textContent = '';
    hint.hidden = true;
    delete hint.dataset.tone;
  }

  function showEditorError(text) {
    hint.textContent = text;
    hint.dataset.tone = 'error';
    hint.hidden = false;
  }

  function updateCounter() {
    const len = input.value.length;
    const max = input.maxLength || 20000;
    counter.textContent = `${len.toLocaleString('vi-VN')} / ${max.toLocaleString('vi-VN')}`;
    counter.classList.toggle('is-near-limit', len > max * 0.9);
  }

  function toggleVirtualKeypad(forceState) {
    const show = typeof forceState === 'boolean' ? forceState : keypadBox.hidden;
    keypadBox.hidden = !show;
    vkbBtn.classList.toggle('is-active', show);
    vkbBtn.setAttribute('aria-pressed', String(show));
    visualField.setVirtualKeyboardMode(show);
    visualField.focus();
  }

  function handleVirtualKey(keySpec) {
    if (keySpec.type === 'char') {
      visualField.typeKey(keySpec.val);
    } else if (keySpec.type === 'tpl') {
      visualField.insertTemplate(keySpec.val);
    } else if (keySpec.type === 'nav') {
      if (keySpec.val === 'left') visualField.moveLeft();
      else if (keySpec.val === 'right') visualField.moveRight();
      else if (keySpec.val === 'backspace') visualField.backspace();
      else if (keySpec.val === 'newline') visualField.insertNewline();
      else if (keySpec.val === 'tab') visualField.jumpNextSlot();
    }
    onVisualInput();
  }

  function onVisualInput() {
    if (status.dataset.tone === 'error') clearFeedback();
  }

  function sync() {
    input.value = serializeQuestionContent(editor);
    updateCounter();
    clearEditorHint();
    input.dispatchEvent(new Event('input', {bubbles: true}));
  }

  function rememberSelection() {
    const selection = window.getSelection();
    if (selection?.rangeCount && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode)) {
      savedRange = selection.getRangeAt(0).cloneRange();
    }
  }

  function caretAtEnd() {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    return range;
  }

  function restore(range) {
    editor.focus();
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
    savedRange = range.cloneRange();
  }

  function makeFormula(raw, expr) {
    const isBlock = raw.startsWith('$$') || raw.startsWith('\\[');
    const token = make('span', `question-formula${isBlock ? ' is-display-formula' : ''}`);
    token.contentEditable = 'false';
    token.tabIndex = 0;
    token.setAttribute('role', 'button');
    token.setAttribute('aria-label', `Sửa công thức ${expr}`);
    token.dataset.formula = raw;
    token.dataset.latex = expr;
    token.dataset.display = isBlock ? '1' : '0';
    token.innerHTML = renderForumFormula(expr, isBlock);
    return token;
  }

  function appendMixedText(target, text) {
    for (const part of parseForumMath(text)) {
      if (part.type === 'math') {
        try {
          target.append(makeFormula(part.raw, part.latex));
          continue;
        } catch {
          // Keep invalid expressions as ordinary text.
        }
      }
      target.append(document.createTextNode(part.type === 'text' ? part.value : part.raw));
    }
  }

  function hydrateFromInput() {
    if (!input.value) {
      updateCounter();
      return;
    }
    const fragment = document.createDocumentFragment();
    appendMixedText(fragment, input.value);
    editor.replaceChildren(fragment);
    updateCounter();
  }

  // Unified history for typed text and formula token operations
  let history;
  function pathTo(node) {
    const path = [];
    while (node && node !== editor) {
      const parent = node.parentNode;
      if (!parent) return null;
      path.unshift(Array.prototype.indexOf.call(parent.childNodes, node));
      node = parent;
    }
    return node === editor ? path : null;
  }

  function snapshot() {
    const selection = window.getSelection();
    let range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !editor.contains(range.commonAncestorContainer)) range = savedRange;
    const start = range && pathTo(range.startContainer);
    const end = range && pathTo(range.endContainer);
    return {
      nodes: Array.from(editor.childNodes, child => child.cloneNode(true)),
      markup: editor.innerHTML,
      selection: start && end ? {start, end, startOffset: range.startOffset, endOffset: range.endOffset} : null
    };
  }

  function updateHistoryButtons() {
    const locked = !panel.hidden;
    undoButton.disabled = locked || !history.canUndo;
    redoButton.disabled = locked || !history.canRedo;
  }

  function saveBeforeEdit() {
    history.replaceCurrent(snapshot());
  }

  function recordEdit() {
    history.commit(snapshot());
    updateHistoryButtons();
  }

  function restoreHistory(state) {
    editor.replaceChildren(...state.nodes.map(node => node.cloneNode(true)));
    const resolve = path => path.reduce((node, i) => node?.childNodes[i], editor);
    let range = document.createRange();
    const start = state.selection && resolve(state.selection.start);
    const end = state.selection && resolve(state.selection.end);
    if (start && end) {
      const length = node => (node.nodeType === Node.TEXT_NODE ? node.data.length : node.childNodes.length);
      try {
        range.setStart(start, Math.min(state.selection.startOffset, length(start)));
        range.setEnd(end, Math.min(state.selection.endOffset, length(end)));
      } catch {
        range = caretAtEnd();
      }
    } else {
      range = caretAtEnd();
    }
    restore(range);
    sync();
    updateHistoryButtons();
  }

  function undo() {
    if (panel.hidden && history.canUndo) restoreHistory(history.undo());
  }

  function redo() {
    if (panel.hidden && history.canRedo) restoreHistory(history.redo());
  }

  function insertTemplateIntoStage(tpl) {
    visualField.insertTemplate(tpl);
    visualField.focus();
    onVisualInput();
  }

  function handleQuickToolbarAction(item) {
    if (item.kind === 'symbol' && panel.hidden) {
      const sel = window.getSelection();
      const range = sel?.rangeCount && editor.contains(sel.anchorNode) && editor.contains(sel.focusNode)
        ? sel.getRangeAt(0).cloneRange()
        : (savedRange && editor.contains(savedRange.commonAncestorContainer) ? savedRange.cloneRange() : caretAtEnd());
      const raw = `$${item.latex}$`;
      const maxLen = input.maxLength || 20000;
      const replaced = serializeQuestionContent(range.cloneContents());
      if (serializeQuestionContent(editor).length - replaced.length + raw.length > maxLen) {
        showEditorError(`Nội dung vượt quá giới hạn ${maxLen.toLocaleString('vi-VN')} ký tự.`);
        return;
      }
      if (editor.querySelectorAll('.question-formula').length >= 60) {
        showEditorError('Mỗi bài viết chứa tối đa 60 công thức toán.');
        return;
      }
      clearEditorHint();
      saveBeforeEdit();
      const token = makeFormula(raw, item.latex);
      range.deleteContents();
      range.insertNode(token);
      range.setStartAfter(token);
      range.collapse(true);
      restore(range);
      sync();
      recordEdit();
      return;
    }

    if (panel.hidden) {
      open();
      requestAnimationFrame(() => insertTemplateIntoStage(item.val));
    } else {
      insertTemplateIntoStage(item.val);
    }
  }

  // Build pure formula glyph buttons per group (no captions, no tooltips)
  const renderedButtonsCache = new Map();
  function buildGroupButtons(group) {
    if (renderedButtonsCache.has(group.id)) return renderedButtonsCache.get(group.id);
    const list = group.items.map(spec => {
      const btn = make('button', `qm-preset-btn${spec.wide ? ' is-wide' : ''}`);
      btn.type = 'button';
      btn.setAttribute('aria-label', `Chèn ${spec.label}`);
      btn.addEventListener('pointerdown', e => e.preventDefault());
      const glyph = make('span', 'qm-preset-glyph');
      glyph.setAttribute('aria-hidden', 'true');
      const html = renderGlyph(spec.preview);
      if (html) glyph.innerHTML = html;
      else glyph.textContent = spec.preview;
      btn.append(glyph);
      btn.addEventListener('click', () => {
        insertTemplateIntoStage(spec.insert);
      });
      return btn;
    });
    renderedButtonsCache.set(group.id, list);
    return list;
  }

  function showGroup(groupId) {
    const group = MATH_PRESET_GROUPS.find(g => g.id === groupId) || MATH_PRESET_GROUPS[0];
    tabs.querySelectorAll('button').forEach(tab => {
      const active = tab.dataset.group === group.id;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    tools.replaceChildren(...buildGroupButtons(group));
  }

  for (const group of MATH_PRESET_GROUPS) {
    const tab = button(group.label, () => showGroup(group.id), 'qm-tab-btn');
    tab.dataset.group = group.id;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'false');
    tab.addEventListener('pointerdown', e => e.preventDefault());
    tabs.append(tab);
  }
  showGroup(MATH_PRESET_GROUPS[0].id);

  function commitFormula() {
    visualField.trimEmptyLines();
    const rawExpr = visualField.value.trim();
    if (!rawExpr) {
      setFeedback('Hãy nhập hoặc chọn một công thức trước khi chèn.', 'error');
      visualField.focus();
      return;
    }
    if (visualField.hasIncompleteSlots || rawExpr.includes('\\placeholder')) {
      setFeedback('Hãy điền đầy đủ các ô trống trong công thức trước khi chèn.', 'error');
      visualField.jumpNextSlot();
      return;
    }
    const oldRaw = activeFormula?.dataset.formula || '';
    const keepDisplay = Boolean(oldRaw.startsWith('$$') || oldRaw.startsWith('\\['));
    try {
      renderForumFormula(rawExpr, keepDisplay);
    } catch {
      setFeedback('Công thức chưa hợp lệ, hãy kiểm tra lại.', 'error');
      visualField.focus();
      return;
    }
    if (rawExpr.length > 2000) {
      setFeedback('Một công thức tối đa 2.000 ký tự.', 'error');
      return;
    }
    if (activeFormula && !activeFormula.isConnected) {
      setFeedback('Công thức cần sửa đã bị xóa. Hãy nhấn Hủy và thử lại.', 'error');
      return;
    }
    if (!activeFormula && editor.querySelectorAll('.question-formula').length >= 60) {
      setFeedback('Mỗi bài viết chứa tối đa 60 công thức toán.', 'error');
      return;
    }
    const ends = buildFormulaDelimiters(oldRaw, keepDisplay);
    const raw = `${ends[0]}${rawExpr}${ends[1]}`;
    const parsed = parseForumMath(raw);
    if (parsed.length !== 1 || parsed[0].type !== 'math' || parsed[0].latex !== rawExpr) {
      setFeedback('Công thức chứa ký tự phân cách $ không hợp lệ bên trong.', 'error');
      return;
    }
    const range = activeFormula?.isConnected
      ? document.createRange()
      : (savedRange && editor.contains(savedRange.commonAncestorContainer) ? savedRange.cloneRange() : caretAtEnd());
    if (activeFormula?.isConnected) range.selectNode(activeFormula);

    const replaced = serializeQuestionContent(range.cloneContents());
    const maxLen = input.maxLength || 20000;
    if (serializeQuestionContent(editor).length - replaced.length + raw.length > maxLen) {
      setFeedback(`Nội dung vượt quá giới hạn ${maxLen.toLocaleString('vi-VN')} ký tự.`, 'error');
      return;
    }

    saveBeforeEdit();
    const token = makeFormula(raw, rawExpr);
    if (activeFormula?.isConnected) {
      activeFormula.classList.remove('is-editing');
    }
    range.deleteContents();
    range.insertNode(token);
    range.setStartAfter(token);
    range.collapse(true);
    sync();
    close(range);
    recordEdit();
  }

  function open(token = null) {
    if (!panel.hidden && activeFormula === token) {
      visualField.focus();
      return;
    }
    if (activeFormula) activeFormula.classList.remove('is-editing');
    if (panel.hidden && !token) rememberSelection();
    activeFormula = token;
    if (activeFormula) activeFormula.classList.add('is-editing');

    if (!savedRange || !editor.contains(savedRange.commonAncestorContainer)) {
      savedRange = caretAtEnd();
    }

    let initialExpr = token?.dataset.latex || '';
    if (!token && savedRange && !savedRange.collapsed && editor.contains(savedRange.commonAncestorContainer)) {
      const selectedFrag = savedRange.cloneContents();
      if (!selectedFrag.querySelector?.('.question-formula')) {
        const selectedText = (selectedFrag.textContent || '').trim();
        if (selectedText && selectedText.length <= 200 && !/[\r\n$]/.test(selectedText)) {
          try {
            renderForumFormula(selectedText, false);
            initialExpr = selectedText;
          } catch {
            // Keep empty if selected prose isn't valid math
          }
        }
      }
    }

    const parsedVisual = visualField.setValue(initialExpr);
    if (!parsedVisual && initialExpr) {
      visualField.setValue('');
      setFeedback('Công thức này chưa hỗ trợ chỉnh sửa trực tiếp bằng bộ gõ trực quan.', 'muted');
    } else {
      clearFeedback();
    }
    removeButton.hidden = !token;
    confirmButton.querySelector('.qm-btn-label').textContent = token ? 'Cập nhật' : insertConfirmLabel;

    panel.hidden = false;
    openButton.setAttribute('aria-expanded', 'true');
    openButton.classList.add('is-open');
    updateHistoryButtons();

    requestAnimationFrame(() => {
      panel.scrollIntoView({block: 'nearest', behavior: 'smooth'});
      visualField.focus();
    });
  }

  function close(range = savedRange) {
    if (activeFormula) activeFormula.classList.remove('is-editing');
    panel.hidden = true;
    keypadBox.hidden = true;
    vkbBtn.classList.remove('is-active');
    vkbBtn.setAttribute('aria-pressed', 'false');
    visualField.setVirtualKeyboardMode(false);
    openButton.setAttribute('aria-expanded', 'false');
    openButton.classList.remove('is-open');
    activeFormula = null;
    clearFeedback();
    if (range && editor.contains(range.commonAncestorContainer)) restore(range);
    else restore(caretAtEnd());
    updateHistoryButtons();
  }

  visualField.addEventListener('input', onVisualInput);

  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!keypadBox.hidden) {
        toggleVirtualKeypad(false);
        return;
      }
      close();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      commitFormula();
    }
  });

  hydrateFromInput();
  history = createQuestionHistory(snapshot());
  updateHistoryButtons();

  editor.addEventListener('beforeinput', event => {
    if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
      event.preventDefault();
      if (event.inputType === 'historyUndo') undo();
      else redo();
    } else {
      saveBeforeEdit();
    }
  });

  editor.addEventListener('input', () => {
    sync();
    recordEdit();
  });

  editor.addEventListener('click', event => {
    const token = event.target.closest?.('.question-formula');
    if (token && editor.contains(token)) open(token);
  });

  editor.addEventListener('keyup', rememberSelection);
  editor.addEventListener('mouseup', rememberSelection);
  editor.addEventListener('focusout', rememberSelection);

  editor.addEventListener('keydown', event => {
    const token = event.target.closest?.('.question-formula');
    if (token && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      open(token);
      return;
    }
    if (event.key === '$' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const sel = window.getSelection();
      if (sel?.rangeCount && !sel.isCollapsed) {
        event.preventDefault();
        open();
        return;
      }
    }
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'm') {
      event.preventDefault();
      open();
    } else if (key === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (key === 'y') {
      event.preventDefault();
      redo();
    }
  });

  editor.addEventListener('paste', event => {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') || '';
    if (!text) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;

    const parts = parseForumMath(text);
    let available = 60 - editor.querySelectorAll('.question-formula').length;
    const maxLen = input.maxLength || 20000;
    if (serializeQuestionContent(editor).length - serializeQuestionContent(range.cloneContents()).length + text.length > maxLen) {
      showEditorError(`Không thể dán: nội dung vượt quá ${maxLen.toLocaleString('vi-VN')} ký tự.`);
      return;
    }
    clearEditorHint();

    const fragment = document.createDocumentFragment();
    for (const part of parts) {
      if (part.type === 'math' && available > 0) {
        try {
          fragment.append(makeFormula(part.raw, part.latex));
          available--;
          continue;
        } catch {
          // Keep invalid expressions as ordinary text.
        }
      }
      fragment.append(document.createTextNode(part.type === 'text' ? part.value : part.raw));
    }
    saveBeforeEdit();
    const tail = fragment.lastChild;
    range.deleteContents();
    range.insertNode(fragment);
    if (tail) {
      range.setStartAfter(tail);
      range.collapse(true);
      restore(range);
    }
    sync();
    rememberSelection();
    recordEdit();
  });

  for (const type of ['copy', 'cut']) {
    editor.addEventListener(type, event => {
      const selection = window.getSelection();
      if (!selection?.rangeCount || !editor.contains(selection.anchorNode) || !editor.contains(selection.focusNode)) return;
      event.preventDefault();
      event.clipboardData?.setData('text/plain', serializeQuestionContent(selection.getRangeAt(0).cloneContents()));
      if (type === 'cut') {
        saveBeforeEdit();
        selection.deleteFromDocument();
        sync();
        rememberSelection();
        recordEdit();
      }
    });
  }

  editor.addEventListener('drop', event => event.preventDefault());

  root.reset = () => {
    if (!panel.hidden) close();
    editor.replaceChildren();
    clearEditorHint();
    sync();
    history = createQuestionHistory(snapshot());
    updateHistoryButtons();
  };

  root.validate = () => {
    sync();
    if (!panel.hidden) {
      if (cleanFormulaOutput().trim()) {
        setFeedback('Bạn đang soạn dở công thức. Hãy nhấn "Chèn công thức" hoặc "Hủy" trước khi gửi.', 'error');
        visualField.focus();
        return false;
      }
      close();
    }
    if (!input.value.trim()) {
      editor.focus();
      return false;
    }
    if (input.value.length > (input.maxLength || 20000)) {
      editor.focus();
      return false;
    }
    return true;
  };

  return root;
}
