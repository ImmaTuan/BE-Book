import { readFileSync } from "node:fs";

// Only declared equivalents match automatically. Suggestions require confirmation.
export const categoryAliases = JSON.parse(
  readFileSync(new URL("./category-aliases.json", import.meta.url), "utf8"),
);
export function normalizeCategoryName(name) {
  return name.normalize("NFKD").replace(/\p{M}/gu, "")
    .toLowerCase().replace(/đ/g, "d")
    .replace(/['’‘]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim()
    .replace(/\s+/g, " ");
}
export function resolveCategoryNames(names, categories) {
  const groups = categoryAliases.map(group =>
    new Set([group.name, ...group.aliases].map(normalizeCategoryName)));
  const records = categories.map(category => {
    const key = normalizeCategoryName(category.name);
    const equivalents = new Set([key]);
    for (const group of groups) if (group.has(key)) {
      for (const alias of group) equivalents.add(alias);
    }
    return { category: { id: category.id, name: category.name }, key, equivalents };
  });
  return names.map(input => {
    const key = normalizeCategoryName(input);
    const matches = key ? records.filter(record => record.equivalents.has(key)) : [];
    if (matches.length) {
      const matched = matches.length === 1;
      return {
        input, status: matched ? "matched" : "ambiguous",
        category: matched ? matches[0].category : null,
        matched_by: matched ? (matches[0].key === key ? "name" : "alias") : null,
        candidates: matched ? [] : matches.map(record => record.category),
      };
    }
    const tokens = new Set(key.split(" ").filter(Boolean));
    const candidates = key ? records.map(record => {
      const score = Math.max(...[...record.equivalents].map(alias => {
        const other = new Set(alias.split(" "));
        const common = [...tokens].filter(token => other.has(token)).length;
        return common / Math.max(tokens.size, other.size);
      }));
      return { category: record.category, score };
    }).filter(record => record.score >= 0.5)
      .sort((a,b) => b.score-a.score || String(a.category.name).localeCompare(String(b.category.name)))
      .slice(0,5).map(record => record.category) : [];
    return { input, status: "unmatched", category: null, matched_by: null, candidates };
  });
}
