import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSearch, publicSearchCondition, suggestBookTitles } from '../src/book-search.js';
import { pool } from '../src/config/db.js';
import { listPublicBooks } from '../src/models/book.model.js';

test('normalizes Vietnamese, decomposed accents and punctuation', () => {
  assert.equal(normalizeSearch('  ĐẮC   nhân-tâm! '), 'dac nhan tam');
  assert.equal(normalizeSearch('Đắc'.normalize('NFD')), 'dac');
});

test('partial matching uses independent literal tokens for titles and authors', () => {
  const result = publicSearchCondition('dac nh');
  assert.deepEqual(result.args, ['%dac%', '%dac%', '%nh%', '%nh%']);
  assert(result.sql.includes('search_a.name')); assert(result.sql.includes(' AND '));
  assert.equal(publicSearchCondition('%%% _').sql, '0 = 1');
  assert(!publicSearchCondition("' OR 1=1 --").sql.includes('1=1'));
});

test('suggests close spellings, deduplicates titles and rejects unrelated/short queries', () => {
  const books = [{ title: 'Đắc nhân tâm' }, { title: 'ĐẮC NHÂN TÂM' }, { title: 'Nhà giả kim' }];
  assert.deepEqual(suggestBookTitles('đắc nhâm tâm', books), [{ title: 'Đắc nhân tâm' }]);
  assert.deepEqual(suggestBookTitles('nhà gia', books), [{ title: 'Nhà giả kim' }]);
  assert.deepEqual(suggestBookTitles('xyz unknown', books), []);
  assert.deepEqual(suggestBookTitles('a', books), []);
  assert.deepEqual(suggestBookTitles('tâm tâm tâm', books), []);
});

test('empty public search distinguishes restrictive filters from misspellings and never scans hidden titles', async (t) => {
  const original = pool.execute;
  t.after(() => { pool.execute = original; });
  let outside = 2, titlesRead = false;
  pool.execute = async (sql, args) => {
    assert(sql.includes('b.is_active = 1'));
    if (sql.startsWith('SELECT COUNT(*)') && sql.includes('b.category_id = ?')) { assert.equal(args.at(-1), 99); return [[{ total: 0 }]]; }
    if (sql.startsWith('SELECT COUNT(*)')) return [[{ total: outside }]];
    if (sql.startsWith('SELECT b.title')) { titlesRead = true; return [[{ title: 'Đắc nhân tâm' }]]; }
    if (sql.startsWith('SELECT b.*')) return [[]];
    throw Error(sql);
  };
  const filters = { page: 1, limit: 12, offset: 0, search: 'dac nham tam', category_id: 99 };
  const filtered = await listPublicBooks(filters);
  assert.deepEqual(filtered.search_help, { unfiltered_total: 2, suggestions: [] }); assert.equal(titlesRead, false);
  outside = 0;
  const typo = await listPublicBooks(filters);
  assert.deepEqual(typo.search_help, { unfiltered_total: 0, suggestions: [{ title: 'Đắc nhân tâm' }] });
  assert.equal(titlesRead, true);
});
