export const MATH_PRESET_GROUPS = [
  {
    id: 'basic',
    label: 'Cơ bản',
    items: [
      {label: 'Phân số', insert: '\\frac{#@}{#?}', preview: '\\frac{\\square}{\\square}'},
      {label: 'Căn bậc hai', insert: '\\sqrt{#@}', preview: '\\sqrt{\\square}'},
      {label: 'Căn bậc n', insert: '\\sqrt[#?]{#@}', preview: '\\sqrt[\\square]{\\square}'},
      {label: 'Bình phương', insert: '#@^{2}', preview: 'x^{2}'},
      {label: 'Lũy thừa', insert: '#@^{#?}', preview: 'x^{\\square}'},
      {label: 'Chỉ số dưới', insert: '#@_{#?}', preview: 'x_{\\square}'},
      {label: 'Trị tuyệt đối', insert: '\\left|#@\\right|', preview: '\\left|\\square\\right|'},
      {label: 'Ngoặc tròn', insert: '\\left(#@\\right)', preview: '\\left(\\square\\right)'},
      {label: 'Cộng trừ', insert: '\\pm ', preview: '\\pm'},
      {label: 'Nhân dấu chéo', insert: '\\times ', preview: '\\times'},
      {label: 'Nhân dấu chấm', insert: '\\cdot ', preview: 'a\\cdot b'},
      {label: 'Chia', insert: '\\div ', preview: '\\div'},
      {label: 'Nhỏ hơn hoặc bằng', insert: '\\le ', preview: '\\le'},
      {label: 'Lớn hơn hoặc bằng', insert: '\\ge ', preview: '\\ge'},
      {label: 'Khác', insert: '\\neq ', preview: '\\neq'},
      {label: 'Xấp xỉ', insert: '\\approx ', preview: '\\approx'}
    ]
  },
  {
    id: 'algebra',
    label: 'Đại số',
    items: [
      {label: 'Hệ 2 phương trình', insert: '\\begin{cases}#@\\\\#?\\end{cases}', preview: '\\begin{cases}\\square\\\\\\square\\end{cases}', wide: true},
      {label: 'Hệ 3 phương trình', insert: '\\begin{cases}#@\\\\#?\\\\#?\\end{cases}', preview: '\\begin{cases}\\square\\\\\\square\\\\\\square\\end{cases}', wide: true},
      {label: 'Tuyển hoặc', insert: '\\left[\\begin{array}{l}#@\\\\#?\\end{array}\\right.', preview: '\\left[\\begin{array}{l}\\square\\\\\\square\\end{array}\\right.', wide: true},
      {label: 'Suy ra', insert: '\\Rightarrow ', preview: '\\Rightarrow'},
      {label: 'Tương đương', insert: '\\Leftrightarrow ', preview: '\\Leftrightarrow'},
      {label: 'Logarit', insert: '\\log_{#?}\\left(#@\\right)', preview: '\\log_{\\square}\\left(\\square\\right)', wide: true},
      {label: 'Logarit tự nhiên', insert: '\\ln\\left(#@\\right)', preview: '\\ln\\left(\\square\\right)', wide: true},
      {label: 'Tổ hợp', insert: 'C_{#?}^{#@}', preview: 'C_{n}^{k}'},
      {label: 'Chỉnh hợp', insert: 'A_{#?}^{#@}', preview: 'A_{n}^{k}'},
      {label: 'Nhị thức', insert: '\\binom{#@}{#?}', preview: '\\binom{\\square}{\\square}'},
      {label: 'Tổng Sigma', insert: '\\sum_{#?}^{#?}#@', preview: '\\sum_{\\square}^{\\square}\\square', wide: true},
      {label: 'Tích Pi', insert: '\\prod_{#?}^{#?}#@', preview: '\\prod_{\\square}^{\\square}\\square', wide: true}
    ]
  },
  {
    id: 'calculus',
    label: 'Giải tích',
    items: [
      {label: 'Giới hạn', insert: '\\lim_{#?\\to #?}#@', preview: '\\lim_{\\square\\to\\square}\\square', wide: true},
      {label: 'Đạo hàm', insert: '\\left(#@\\right)^{\\prime}', preview: '\\left(\\square\\right)^{\\prime}', wide: true},
      {label: 'Vi phân', insert: '\\frac{\\mathrm{d}#@}{\\mathrm{d}x}', preview: '\\frac{\\mathrm{d}\\square}{\\mathrm{d}x}', wide: true},
      {label: 'Nguyên hàm', insert: '\\int #@\\,\\mathrm{d}x', preview: '\\int \\square\\,\\mathrm{d}x', wide: true},
      {label: 'Tích phân', insert: '\\int_{#?}^{#?}#@\\,\\mathrm{d}x', preview: '\\int_{\\square}^{\\square}\\square\\,\\mathrm{d}x', wide: true},
      {label: 'Tiến tới', insert: '\\to ', preview: '\\to'},
      {label: 'Vô cực', insert: '\\infty', preview: '\\infty'},
      {label: 'Pi', insert: '\\pi ', preview: '\\pi'},
      {label: 'Sin', insert: '\\sin\\left(#@\\right)', preview: '\\sin\\left(\\square\\right)', wide: true},
      {label: 'Cos', insert: '\\cos\\left(#@\\right)', preview: '\\cos\\left(\\square\\right)', wide: true},
      {label: 'Tan', insert: '\\tan\\left(#@\\right)', preview: '\\tan\\left(\\square\\right)', wide: true},
      {label: 'Cot', insert: '\\cot\\left(#@\\right)', preview: '\\cot\\left(\\square\\right)', wide: true}
    ]
  },
  {
    id: 'geometry',
    label: 'Hình học',
    items: [
      {label: 'Vectơ', insert: '\\overrightarrow{#@}', preview: '\\overrightarrow{AB}'},
      {label: 'Góc đỉnh', insert: '\\widehat{#@}', preview: '\\widehat{ABC}', wide: true},
      {label: 'Đoạn thẳng', insert: '\\overline{#@}', preview: '\\overline{AB}'},
      {label: 'Cung tròn', insert: '\\overset{\\frown}{#@}', preview: '\\overset{\\frown}{AB}'},
      {label: 'Ký hiệu góc', insert: '\\angle ', preview: '\\angle'},
      {label: 'Độ', insert: '#@^{\\circ}', preview: '\\square^{\\circ}'},
      {label: 'Tam giác', insert: '\\triangle ', preview: '\\triangle'},
      {label: 'Vuông góc', insert: '\\perp ', preview: '\\perp'},
      {label: 'Song song', insert: '\\parallel ', preview: '\\parallel'},
      {label: 'Đồng dạng', insert: '\\sim ', preview: '\\sim'},
      {label: 'Bằng nhau', insert: '\\cong ', preview: '\\cong'}
    ]
  },
  {
    id: 'symbols',
    label: 'Ký hiệu',
    items: [
      {label: 'Thuộc', insert: '\\in ', preview: '\\in'},
      {label: 'Không thuộc', insert: '\\notin ', preview: '\\notin'},
      {label: 'Tập con', insert: '\\subset ', preview: '\\subset'},
      {label: 'Tập con hoặc bằng', insert: '\\subseteq ', preview: '\\subseteq'},
      {label: 'Hợp', insert: '\\cup ', preview: '\\cup'},
      {label: 'Giao', insert: '\\cap ', preview: '\\cap'},
      {label: 'Hiệu tập hợp', insert: '\\setminus ', preview: '\\setminus'},
      {label: 'Tập rỗng', insert: '\\varnothing ', preview: '\\varnothing'},
      {label: 'Tập hợp', insert: '\\left\\{#@\\right\\}', preview: '\\left\\{\\square\\right\\}'},
      {label: 'Số thực R', insert: '\\mathbb{R}', preview: '\\mathbb{R}'},
      {label: 'Số nguyên Z', insert: '\\mathbb{Z}', preview: '\\mathbb{Z}'},
      {label: 'Số tự nhiên N', insert: '\\mathbb{N}', preview: '\\mathbb{N}'},
      {label: 'Số hữu tỉ Q', insert: '\\mathbb{Q}', preview: '\\mathbb{Q}'},
      {label: 'Với mọi', insert: '\\forall ', preview: '\\forall'},
      {label: 'Tồn tại', insert: '\\exists ', preview: '\\exists'},
      {label: 'Delta', insert: '\\Delta ', preview: '\\Delta'},
      {label: 'Alpha', insert: '\\alpha ', preview: '\\alpha'},
      {label: 'Beta', insert: '\\beta ', preview: '\\beta'},
      {label: 'Gamma', insert: '\\gamma ', preview: '\\gamma'},
      {label: 'Phi', insert: '\\varphi ', preview: '\\varphi'},
      {label: 'Theta', insert: '\\theta ', preview: '\\theta'},
      {label: 'Lambda', insert: '\\lambda ', preview: '\\lambda'},
      {label: 'Omega thường', insert: '\\omega ', preview: '\\omega'},
      {label: 'Omega hoa', insert: '\\Omega ', preview: '\\Omega'}
    ]
  }
];

export function applySourceTemplate(currentValue, start, end, insertTemplate) {
  const selected = currentValue.slice(start, end);
  let cursorOffset = null;
  let body = insertTemplate;
  if (body.includes('#@')) {
    if (selected) {
      body = body.replaceAll('#@', selected);
    } else {
      const idx = body.indexOf('#@');
      cursorOffset = idx;
      body = body.replace('#@', '').replaceAll('#@', '');
    }
  }
  if (body.includes('#?')) {
    const firstQ = body.indexOf('#?');
    if (cursorOffset === null) cursorOffset = firstQ;
    body = body.replaceAll('#?', '');
  }
  if (cursorOffset === null) cursorOffset = body.length;
  const nextValue = currentValue.slice(0, start) + body + currentValue.slice(end);
  return {value: nextValue, cursor: start + cursorOffset};
}

export function buildFormulaDelimiters(oldRaw, displayMode) {
  if (displayMode) {
    return oldRaw?.startsWith('\\[') ? ['\\[', '\\]'] : ['$$', '$$'];
  }
  return oldRaw?.startsWith('\\(') ? ['\\(', '\\)'] : ['$', '$'];
}
