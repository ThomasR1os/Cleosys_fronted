/** Palabras vacías comunes (es); se omiten si quedan otros términos con significado. */
const ES_STOPWORDS = new Set([
  'a',
  'al',
  'con',
  'de',
  'del',
  'el',
  'en',
  'la',
  'las',
  'lo',
  'los',
  'para',
  'por',
  'un',
  'una',
  'unos',
  'unas',
  'y',
  'o',
]);

function collapseWhitespace(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

/**
 * Indica si `query` coincide con `haystack`: cada término (tras quitar stopwords si aplica)
 * debe aparecer como subcadena; el orden no importa.
 */
export function textMatchesLooseQuery(haystack: string, query: string): boolean {
  const q = collapseWhitespace(query).toLowerCase();
  if (!q) return true;
  const needle = collapseWhitespace(haystack).toLowerCase();
  const tokens = q.split(' ').filter(Boolean);
  const meaningful = tokens.filter((t) => !ES_STOPWORDS.has(t));
  const searchTokens = meaningful.length > 0 ? meaningful : tokens;
  return searchTokens.every((t) => needle.includes(t));
}
