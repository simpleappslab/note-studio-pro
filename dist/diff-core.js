/* Browser-local, bounded patience/LCS line comparison. Shared by the worker and checks. */
(function (root) {
  'use strict';
  const lines = text => text ? text.match(/[^\n]*\n|[^\n]+$/g) || [] : [];

  function compare(original, modified, ignoreWhitespace = false) {
    const a = lines(original.replace(/\r\n?/g, '\n'));
    const b = lines(modified.replace(/\r\n?/g, '\n'));
    const key = line => ignoreWhitespace ? line.replace(/[^\S\n]/g, '') : line;
    const ak = a.map(key), bk = b.map(key), ops = [];
    let budget = 2000000, simplified = false;
    const emit = (type, leftStart, leftEnd, rightStart, rightEnd) => {
      if (leftStart === leftEnd && rightStart === rightEnd) return;
      const last = ops[ops.length - 1];
      if (last && last.type === type && last.leftEnd === leftStart && last.rightEnd === rightStart) {
        last.leftEnd = leftEnd; last.rightEnd = rightEnd;
      } else ops.push({type, leftStart, leftEnd, rightStart, rightEnd});
    };
    function solve(a0, a1, b0, b1, depth = 0) {
      const startA = a0, startB = b0;
      while (a0 < a1 && b0 < b1 && ak[a0] === bk[b0]) { a0++; b0++; }
      emit('equal', startA, a0, startB, b0);
      let tail = 0;
      while (a0 < a1 - tail && b0 < b1 - tail && ak[a1 - tail - 1] === bk[b1 - tail - 1]) tail++;
      const endA = a1 - tail, endB = b1 - tail;
      if (a0 === endA) emit('insert', a0, a0, b0, endB);
      else if (b0 === endB) emit('delete', a0, endA, b0, b0);
      else {
        // Unique matching lines provide stable anchors without a quadratic document matrix.
        const am = new Map(), bm = new Map();
        for (let i = a0; i < endA; i++) am.set(ak[i], am.has(ak[i]) ? -1 : i);
        for (let i = b0; i < endB; i++) bm.set(bk[i], bm.has(bk[i]) ? -1 : i);
        const pairs = [];
        for (let i = a0; i < endA; i++) {
          const j = bm.get(ak[i]);
          if (am.get(ak[i]) === i && j !== undefined && j >= 0) pairs.push([i, j]);
        }
        const tails = [], previous = new Int32Array(pairs.length).fill(-1);
        for (let i = 0; i < pairs.length; i++) {
          let lo = 0, hi = tails.length;
          while (lo < hi) { const mid = (lo + hi) >>> 1; if (pairs[tails[mid]][1] < pairs[i][1]) lo = mid + 1; else hi = mid; }
          if (lo) previous[i] = tails[lo - 1];
          tails[lo] = i;
        }
        if (tails.length && depth < 64) {
          const anchors = [];
          for (let i = tails[tails.length - 1]; i >= 0; i = previous[i]) anchors.push(pairs[i]);
          anchors.reverse();
          let x = a0, y = b0;
          for (const [i, j] of anchors) { solve(x, i, y, j, depth + 1); emit('equal', i, i + 1, j, j + 1); x = i + 1; y = j + 1; }
          solve(x, endA, y, endB, depth + 1);
        } else {
          const n = endA - a0, m = endB - b0, cells = (n + 1) * (m + 1);
          if (cells <= 250000 && cells <= budget) {
            budget -= cells;
            const width = m + 1, table = new Uint32Array(cells);
            for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
              table[i * width + j] = ak[a0 + i] === bk[b0 + j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
            let i = 0, j = 0;
            while (i < n || j < m) {
              if (i < n && j < m && ak[a0 + i] === bk[b0 + j]) { emit('equal', a0 + i, a0 + i + 1, b0 + j, b0 + j + 1); i++; j++; }
              else if (i < n && (j === m || table[(i + 1) * width + j] >= table[i * width + j + 1])) { emit('delete', a0 + i, a0 + i + 1, b0 + j, b0 + j); i++; }
              else { emit('insert', a0 + i, a0 + i, b0 + j, b0 + j + 1); j++; }
            }
          } else {
            simplified = true;
            emit('delete', a0, endA, b0, b0); emit('insert', endA, endA, b0, endB);
          }
        }
      }
      emit('equal', endA, a1, endB, b1);
    }
    solve(0, a.length, 0, b.length);
    const chunks = []; let chunk = null, added = 0, removed = 0;
    for (const op of ops) {
      if (op.type === 'equal') { chunk = null; continue; }
      if (!chunk) { chunk = {leftStart:op.leftStart, leftEnd:op.leftEnd, rightStart:op.rightStart, rightEnd:op.rightEnd}; chunks.push(chunk); }
      else { chunk.leftEnd = op.leftEnd; chunk.rightEnd = op.rightEnd; }
      if (op.type === 'insert') added += op.rightEnd - op.rightStart;
      else removed += op.leftEnd - op.leftStart;
    }
    return {ops, chunks, added, removed, simplified};
  }

  function patch(original, modified, originalName = 'original.txt', modifiedName = 'modified.txt') {
    const a = lines(original.replace(/\r\n?/g, '\n')), b = lines(modified.replace(/\r\n?/g, '\n'));
    const result = compare(original, modified), entries = [];
    if (!result.chunks.length) return '';
    for (const op of result.ops) {
      if (op.type === 'equal') for (let i = op.leftStart; i < op.leftEnd; i++) entries.push([' ', a[i]]);
      else if (op.type === 'delete') for (let i = op.leftStart; i < op.leftEnd; i++) entries.push(['-', a[i]]);
      else for (let i = op.rightStart; i < op.rightEnd; i++) entries.push(['+', b[i]]);
    }
    const clean = name => String(name).replace(/[\r\n\t]/g, '_');
    let out = `--- a/${clean(originalName)}\n+++ b/${clean(modifiedName)}\n`;
    const oldAt = [0], newAt = [0];
    for (const [type] of entries) { oldAt.push(oldAt.at(-1) + (type !== '+')); newAt.push(newAt.at(-1) + (type !== '-')); }
    let index = 0;
    while (index < entries.length) {
      while (index < entries.length && entries[index][0] === ' ') index++;
      if (index === entries.length) break;
      const start = Math.max(0, index - 3); let last = index;
      for (index++; index < entries.length && index <= last + 7; index++) if (entries[index][0] !== ' ') last = index;
      const end = Math.min(entries.length, last + 4);
      const oldCount = oldAt[end] - oldAt[start], newCount = newAt[end] - newAt[start];
      out += `@@ -${oldAt[start] + (oldCount ? 1 : 0)},${oldCount} +${newAt[start] + (newCount ? 1 : 0)},${newCount} @@\n`;
      for (let i = start; i < end; i++) { const [type, text] = entries[i]; out += type + text; if (!text.endsWith('\n')) out += '\n\\ No newline at end of file\n'; }
      index = end;
    }
    return out;
  }
  const api = {compare, patch};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NotepadDiff = api;
})(typeof self === 'object' ? self : globalThis);
