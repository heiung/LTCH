export function serializeQuestionContent(node) {
  if (node.nodeType === 3) return node.data.replace(/\u00a0/g, ' ');
  if (node.nodeType !== 1 && node.nodeType !== 11) return '';
  if (node.nodeType === 1 && node.dataset.formula) return node.dataset.formula;
  if (node.nodeName === 'BR') return '\n';
  let result = '';
  for (const child of node.childNodes) {
    const block = child.nodeType === 1 && /^(DIV|P)$/.test(child.nodeName);
    if (block && result && !result.endsWith('\n')) result += '\n';
    result += serializeQuestionContent(child);
  }
  return result;
}


