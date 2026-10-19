const HTML_TAG = /<\/?[a-z][\s\S]*?>/i;

/** Texto visible de HTML o de un requerimiento antiguo en texto plano. */
export function plainTextFromHtml(value: string | null | undefined): string {
  const raw = value ?? '';
  if (!raw.trim()) return '';
  if (typeof DOMParser === 'undefined' || !HTML_TAG.test(raw)) {
    return raw.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  const text = collectText(doc.body);
  return text.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** HTML listo para el editor. El texto plano se escapa para no perder signos como `<`. */
export function asEditorHtml(value: string | null | undefined): string {
  const raw = value ?? '';
  if (!raw.trim()) return '';
  if (HTML_TAG.test(raw)) return raw;
  const escaped = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function collectText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  if (el.tagName === 'BR') return '\n';
  let text = '';
  el.childNodes.forEach((child) => {
    text += collectText(child);
  });
  if (el.tagName === 'TD' || el.tagName === 'TH') return `${text.trim()} `;
  if (/^(P|DIV|LI|TR|H1|H2|H3|H4|BLOCKQUOTE)$/.test(el.tagName)) return `${text.trim()}\n`;
  return text;
}
