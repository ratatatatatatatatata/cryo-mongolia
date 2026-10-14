// Compare common Mongolian Cyrillic / Latin spellings without changing stored names.
const letters = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'j',з:'z',и:'i',й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',ө:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ү:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sh',ъ:'',ы:'i',ь:'',э:'e',ю:'yu',я:'ya' };
export function nameKey(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase()
    .replace(/[а-яөү]/g, c => letters[c] ?? c)
    .replace(/kh/g, 'h').replace(/zh/g, 'j').replace(/w/g, 'v')
    .replace(/y(?=[bcdfghjklmnpqrstvz]|$)/g, 'i').replace(/[\s.'’_-]+/g, '');
}
export function matchesName(value, query) {
  return nameKey(value).includes(nameKey(query));
}
