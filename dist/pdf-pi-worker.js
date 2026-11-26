/* global NoteMask */
'use strict';
importScripts('pi-mask.js');

const extra = [
  ['ID', 'Possible Aadhaar number', /\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/u],
  ['ID', 'Possible PAN', /\b[A-Z]{5}\d{4}[A-Z]\b/u],
  ['ID', 'Possible Indian passport', /\b[A-Z][1-9]\d{6}\b/u],
  ['ID', 'Possible bank account', /\b(?:bank[ -]?account|account[ -]?number|account[ -]?no\.?)[ \t]*[:=]?[ \t]+[\d -]{9,25}\b/iu],
  ['SECRET', 'IP address', /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/u],
  ['SECRET', 'Possible authentication token', /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/u],
  ['SECRET', 'Possible API key', /\b(?:AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/u]
];

function hasCard(text) {
  for (const candidate of text.matchAll(/\b(?:\d[ -]?){12,18}\d\b/gu)) {
    const digits = candidate[0].replace(/\D/g, '');
    if (/^(\d)\1+$/.test(digits)) continue;
    let sum = 0;
    for (const [index, digit] of [...digits].reverse().entries()) {
      const value = Number(digit) * (index % 2 + 1);
      sum += value > 9 ? value - 9 : value;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}

self.onmessage = event => {
  if (event.origin !== '' && event.origin !== self.location.origin) return;
  const {rows, options, custom, query} = event.data ?? {};
  if (!Array.isArray(rows) || rows.length > 40000 || typeof query !== 'string' ||
      !Array.isArray(custom) || custom.length > 12) return;
  try {
    const regex = custom.map(pattern => new RegExp(String(pattern).slice(0, 200), 'iu'));
    const matches = [];
    for (const [index, text] of rows.entries()) {
      if (typeof text !== 'string' || text.length > 4096) throw Error();
      const labels = new Set();
      if (query) {
        if (text.toLowerCase().includes(query)) labels.add('Text match');
      } else {
        const scan = NoteMask.scan(text, options);
        if (scan.total) {
          for (const match of scan.text.matchAll(/\[([A-Z_]+)_\d+\]/g)) {
            labels.add(NoteMask.categories[match[1]] || 'Custom field');
          }
        }
        for (const [kind, label, pattern] of extra) {
          if (!options.disabled.includes(kind) && pattern.test(text)) labels.add(label);
        }
        if (!options.disabled.includes('ID') && hasCard(text)) labels.add('Possible card number');
        if (regex.some(pattern => pattern.test(text))) labels.add('Custom expression');
      }
      if (labels.size) matches.push({index, label: [...labels].join(', ')});
    }
    self.postMessage({matches});
  } catch {
    self.postMessage({error: 'Detection failed. Check your custom regular expressions and document limits.'});
  }
};
