// GHN staging includes synthetic places alongside geographic master data.
// Filter display lists without changing the carrier IDs of real places.
export function filterGhnAddressList(records, nameFields) {
  if (!Array.isArray(records)) return records;
  return records.filter((record) => {
    const name = nameFields.map((key) => record?.[key]).find((value) => value != null && String(value).trim());
    return name != null && !/\btest\b/i.test(String(name));
  });
}

export function filterGhnProvinceList(records) {
  const provinces = filterGhnAddressList(records, ['ProvinceName', 'province_name', 'name']);
  if (!Array.isArray(provinces)) return provinces;
  const nameOf = (record) => String(record.ProvinceName ?? record.province_name ?? record.name ?? '').trim();
  const normalize = (name) => name.toLocaleLowerCase('vi');
  return provinces.filter((record) => {
    // Staging has a numbered copy of Hanoi with the same geographic Code.
    // Remove the copy only when its unnumbered counterpart actually exists.
    const match = nameOf(record).match(/^(.+?)\s+\d+$/);
    if (!match || !String(record.Code ?? '').trim()) return true;
    return !provinces.some((other) => other !== record
      && String(other.Code) === String(record.Code)
      && normalize(nameOf(other)) === normalize(match[1]));
  });
}
