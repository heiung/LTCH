function imageIds(texts) {
  return new Set(texts.flatMap(text => Array.from(
    String(text || '').matchAll(/\[\[(?:img|IMAGE):([^\]]+)\]\]/gi), match => match[1].trim()
  )));
}

export function practiceImageSource(item) {
  if (typeof item?.url === 'string' && /^(?:https?:\/\/|\/api\/practice-media\?)/i.test(item.url)) {
    return item.url;
  }
  const src = item?.dataUrl || item?.path || '';
  return /^word\/media\//i.test(src) ? '' : src;
}

export function hasPracticeImageSource(item) {
  return Boolean(
    practiceImageSource(item) ||
    (typeof item?.driveFileId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(item.driveFileId))
  );
}

function questionRefs(question) {
  const shown = imageIds([question.prompt, ...(question.options || []), ...(question.statements || []), ...(question.cards || [])]);
  const answers = imageIds([question.solution]);
  return [
    ['media', new Set([...shown, ...answers]), shown],
    ['passageMedia', imageIds([question.passageContent]), null]
  ];
}

export function missingPracticeImageIds(questions) {
  const missing = new Set();
  for (const question of questions) {
    for (const [field, ids] of questionRefs(question)) {
      const present = new Set((question[field] || []).filter(hasPracticeImageSource).map(item => item.id));
      for (const id of ids) if (!present.has(id)) missing.add(id);
    }
  }
  return missing;
}

export function restorePracticeImages(questions, replacements) {
  return questions.map(question => {
    let next = question;
    for (const [field, ids, shown] of questionRefs(question)) {
      const entries = question[field] || [];
      const present = new Set(entries.filter(hasPracticeImageSource).map(item => item.id));
      const restored = Array.from(ids).filter(id => !present.has(id) && replacements.has(id));
      if (!restored.length) continue;
      next = {
        ...next,
        [field]: [
          ...entries.filter(item => !restored.includes(item.id)),
          ...restored.map(id => {
            const val = replacements.get(id);
            const payload = typeof val === 'string' ? { dataUrl: val } : { ...val };
            return {
              id,
              ...payload,
              ...(shown && !shown.has(id) ? { inSolution: true } : {})
            };
          })
        ]
      };
    }
    return next;
  });
}
