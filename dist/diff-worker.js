/* Only same-origin bundled code runs here; document text never leaves this browser. */
'use strict';
importScripts('diff-core.js');
self.onmessage = ({data}) => {
  try {
    const result = data.action === 'pdf-patch'
      ? NotepadDiff.patch(data.left, data.right, 'Before', 'After')
      : NotepadDiff.compare(data.left, data.right, data.ignoreWhitespace);
    self.postMessage({id:data.id, action:data.action, result});
  } catch (error) { self.postMessage({id:data.id, error:error.message}); }
};
