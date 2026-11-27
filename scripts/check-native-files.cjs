'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {getRandomValues} = require('node:crypto');
const source = fs.readFileSync('mobile/native-files.js', 'utf8');

function setup(fail = false) {
  const chunks = new Map();
  const removed = [];
  const shares = [];
  const filesystem = {
    readdir: async () => ({files: []}),
    writeFile: async ({path, data, directory}) => {
      assert.equal(directory, 'CACHE');
      assert.match(path, /^allnote-exports\/\d+-[0-9a-f-]+\//);
      chunks.set(path, [Buffer.from(data, 'base64')]);
    },
    appendFile: async ({path, data}) => chunks.get(path).push(Buffer.from(data, 'base64')),
    getUri: async ({path}) => ({uri: 'file:///fake/' + path}),
    rmdir: async ({path}) => removed.push(path),
  };
  const share = {
    share: async ({files}) => {
      shares.push(files);
      if (fail) throw Error();
    }
  };
  const sandbox = {Capacitor: {isNativePlatform: () => true, Plugins: {Filesystem: filesystem, Share: share}},
    crypto: {getRandomValues}, Blob, btoa, Uint8Array};
  vm.runInNewContext(source, sandbox);
  return {api: sandbox.AllNoteNativeFiles, chunks, removed, shares};
}

test('installed app stages bounded chunks and shares exact PDF bytes under a safe cache name', async () => {
  const {api, chunks, shares, removed} = setup();
  const pdf = Buffer.alloc(425000, 0xe2);
  pdf.write('%PDF-1.7');
  await api.shareFiles([{data: pdf, name: '../client.pdf', type: 'application/pdf'}]);
  const [[file, content]] = chunks;
  assert.match(file, /\/_client\.pdf$/);
  assert.equal(content.length, 3);
  assert.deepEqual(Buffer.concat(content), pdf);
  assert.equal(shares[0][0], 'file:///fake/' + file);
  assert.equal(removed.length, 0);
});

test('canceled or failed shares delete the outbound cache and report a neutral error', async () => {
  const {api, removed} = setup(true);
  await assert.rejects(api.shareFiles([{data: 'private', name: 'report.txt'}]), /canceled or could not be shared/);
  assert.equal(removed.length, 1);
});

test('native bridge stays absent in a browser', () => {
  const sandbox = {Capacitor: {isNativePlatform: () => false}};
  vm.runInNewContext(source, sandbox);
  assert.equal(sandbox.AllNoteNativeFiles, undefined);
});

test('native start path resolves against the bundled localhost origin', () => {
  const {server} = JSON.parse(fs.readFileSync('capacitor.config.json', 'utf8'));
  assert.equal(server.url, undefined);
  assert.equal(server.androidScheme + '://' + server.hostname + server.appStartPath,
    'https://localhost/pdf-studio.html');
});
