/* global NoteMask */
'use strict';
importScripts('pi-mask.js');

const extra = [
  ['ID', /\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/u],
  ['ID', /\b[A-Z][1-9]\d{6}\b/u],
  ['ID', /\b(?:\d[ -]?){12,18}\d\b/u],
  ['SECRET', /\b(?:\d{1,3}\.){3}\d{1,3}\b/u],
  ['SECRET', /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/u]
];

self.onmessage = event => {
  if (event.origin !== '' && event.origin !== self.location.origin) return;
  const {rows, options, custom, query} = event.data ?? {};
  if (!Array.isArray(rows) || rows.length > 40000 || typeof query !== 'string' ||
      !Array.isArray(custom) || custom.length > 12) return;
  try {
    const regex = custom.map(pattern => new RegExp(String(pattern).slice(0, 200), 'iu'));
    const indices = [];
    for (const [index, text] of rows.entries()) {
      if (typeof text !== 'string' || text.length > 4096) throw Error();
      const match = query ? text.toLowerCase().includes(query)
        : NoteMask.scan(text, options).total > 0 ||
          extra.some(([kind, pattern]) => !options.disabled.includes(kind) && pattern.test(text)) ||
          regex.some(pattern => pattern.test(text));
      if (match) indices.push(index);
    }
    self.postMessage({indices});
  } catch {
    self.postMessage({error: 'Detection failed. Check your custom regular expressions and document limits.'});
  }
};
