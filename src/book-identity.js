export { validateAuthorNames } from "./validation.js";

export const normalizeBookText = (value) =>
  String(value ?? "")
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase("vi-VN");

export function sameBookIdentity(first, second) {
  const authorKey = (names = []) =>
    [...new Set(names.map(normalizeBookText))].sort().join("\u0000");
  return (
    normalizeBookText(first.title) === normalizeBookText(second.title) &&
    authorKey(
      first.publisher_names ??
        (normalizeBookText(first.publisher) ? [first.publisher] : []),
    ) ===
      authorKey(
        second.publisher_names ??
          (normalizeBookText(second.publisher) ? [second.publisher] : []),
      ) &&
    authorKey(first.author_names) === authorKey(second.author_names)
  );
}
