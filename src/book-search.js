export function normalizeSearch(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

export function publicSearchCondition(query) {
  const tokens = normalizeSearch(query).split(' ').filter(Boolean);
  if (!tokens.length) return { sql: '0 = 1', args: [] };
  const expression = (column) => "REPLACE(LOWER(CONVERT(" + column + " USING utf8mb4)), 'đ', 'd') COLLATE utf8mb4_unicode_ci LIKE ?";
  return {
    sql: tokens.map(() => '(' + expression('b.title') + ' OR EXISTS (SELECT 1 FROM book_authors search_ba JOIN authors search_a ON search_a.id = search_ba.author_id WHERE search_ba.book_id = b.id AND ' + expression('search_a.name') + '))').join(' AND '),
    args: tokens.flatMap((token) => ['%' + token + '%', '%' + token + '%']),
  };
}

function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + Number(a[i - 1] !== b[j - 1]));
    row = next;
  }
  return row[b.length];
}

export function suggestBookTitles(query, books, limit = 3) {
  const tokens = normalizeSearch(query).split(' ').filter(Boolean);
  if (!tokens.length || tokens.join('').length < 3) return [];
  const ranked = [];
  const seen = new Set();
  for (const book of books) {
    const title = normalizeSearch(book.title);
    if (!title || seen.has(title)) continue;
    const words = title.split(' ');
    if (tokens.length > words.length) continue;
    let score = 0;
    let valid = true;
    const used = new Set();
    for (const token of tokens) {
      let best = Infinity, bestIndex = -1;
      for (let i = 0; i < words.length; i++) {
        if (used.has(i)) continue;
        const word = words[i];
        const cost = word.startsWith(token) ? 0 : Math.abs(token.length - word.length) > 2 ? Infinity : distance(token, word);
        if (cost < best) { best = cost; bestIndex = i; }
      }
      const threshold = token.length < 4 ? 0 : token.length < 7 ? 1 : 2;
      if (best > threshold) { valid = false; break; }
      score += best; used.add(bestIndex);
    }
    if (valid) { seen.add(title); ranked.push({ title: book.title, score: score + (words.length - tokens.length) * 0.1 }); }
  }
  return ranked.sort((a, b) => a.score - b.score || a.title.localeCompare(b.title, 'vi')).slice(0, limit).map(({ title }) => ({ title }));
}
