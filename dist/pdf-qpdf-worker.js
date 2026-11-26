/* global createQpdfCore */
'use strict';

importScripts('vendor/qpdf/qpdf-core.js');

self.onmessage = async event => {
  // Dedicated Worker messages use an empty origin. Reject any foreign origin
  // if a browser supplies an origin for this transport.
  if (event.origin !== '' && event.origin !== self.location.origin) return;
  const {input, operation, password} = event.data ?? {};
  if (!(input instanceof Uint8Array) || input.length > 50 * 1024 * 1024 || typeof password !== 'string') {
    self.postMessage({error: 'Invalid PDF operation input.'});
    return;
  }
  const source = '/input.pdf';
  const output = '/output.pdf';
  // Fixed paths and option forms keep password values out of CLI option parsing.
  let args;
  switch (operation) {
    case 'encrypt':
      args = [source, '--encrypt', '--user-password=' + password,
        '--owner-password=' + password, '--bits=256', '--', output];
      break;
    case 'is-owner':
      args = [source, '--password=' + password, '--show-encryption'];
      break;
    case 'decrypt':
      args = [source, '--password=' + password, '--decrypt', output];
      break;
    case 'compress':
      args = [source, '--object-streams=generate', '--recompress-flate',
        '--compression-level=9', output];
      break;
    default:
      self.postMessage({error: 'Unsupported PDF operation.'});
      return;
  }
  // Engine diagnostics may contain document details. Keep them out of logs and UI.
  try {
    let authorized = false;
    const qpdf = await createQpdfCore({
      locateFile: () => new URL('vendor/qpdf/qpdf-core.wasm', self.location.href).href,
      noInitialRun: true,
      print(line) {
        if (operation === 'is-owner' && line === 'Supplied password is owner password') authorized = true;
      },
      printErr() {}
    });
    qpdf.FS.writeFile(source, input);
    const exit = qpdf.callMain(args);
    if (operation === 'is-owner') {
      self.postMessage({result: exit === 0 && authorized});
      return;
    }
    if (exit !== 0) throw Error();
    const result = qpdf.FS.readFile(output);
    if (result.length > 50 * 1024 * 1024) throw Error();
    self.postMessage({result}, [result.buffer]);
  } catch {
    self.postMessage({error: operation === 'decrypt'
      ? 'QPDF could not unlock this PDF. Check the password and the file.'
      : 'QPDF could not finish. The PDF may be damaged or exceed the output limit.'});
  }
};
