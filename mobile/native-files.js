/* Runs only in the installed application bundle. */
(() => {
  const bridge = globalThis.Capacitor;
  if (!bridge?.isNativePlatform?.()) return;
  const filesystem = bridge.Plugins.Filesystem;
  const share = bridge.Plugins.Share;
  const directory = 'CACHE';
  const root = 'allnote-exports';
  const lifetime = 60 * 60 * 1000;
  const chunkSize = 192 * 1024;
  const maxBytes = 100 * 1024 * 1024;
  let sharing = false;

  function safeName(name) {
    return String(name).replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_')
      .replace(/^[. ]+|[. ]+$/g, '').slice(0, 160) || 'allnote-export';
  }

  async function remove(path) {
    await filesystem.rmdir({path, directory, recursive: true}).catch(() => {});
  }

  async function clearExpired() {
    if (!filesystem) return;
    try {
      const {files} = await filesystem.readdir({path: root, directory});
      await Promise.all(files.filter(file => /^\d{13}-[a-f\d-]+$/.test(file.name) &&
        Date.now() - Number(file.name.split('-')[0]) > lifetime)
        .map(file => remove(root + '/' + file.name)));
    } catch {
      // A fresh install has no export directory.
    }
  }

  function encode(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return btoa(binary);
  }

  async function stage(blob, path) {
    const first = new Uint8Array(await blob.slice(0, chunkSize).arrayBuffer());
    await filesystem.writeFile({path, directory, data: encode(first), recursive: true});
    for (let offset = chunkSize; offset < blob.size; offset += chunkSize) {
      const bytes = new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer());
      await filesystem.appendFile({path, directory, data: encode(bytes)});
    }
    return (await filesystem.getUri({path, directory})).uri;
  }

  async function shareFiles(items) {
    if (!filesystem || !share) throw Error('Native file sharing is unavailable.');
    if (sharing) throw Error('Finish the current share before starting another export.');
    const files = items.map(({data, name, type}) => ({blob: new Blob([data], {type}), name: safeName(name)}));
    if (!files.length || files.length > 20 || files.reduce((size, file) => size + file.blob.size, 0) > maxBytes) {
      throw Error('Share up to 20 files totaling 100 MiB or less.');
    }
    sharing = true;
    const folder = root + '/' + Date.now() + '-' + crypto.randomUUID();
    try {
      await clearExpired();
      const uris = [];
      for (const [index, file] of files.entries()) {
        const prefix = files.length > 1 ? String(index + 1) + '-' : '';
        uris.push(await stage(file.blob, folder + '/' + prefix + file.name));
      }
      await share.share({title: files.length === 1 ? files[0].name : 'AllNote exports', files: uris});
    } catch {
      await remove(folder);
      throw Error('The export was canceled or could not be shared.');
    } finally {
      sharing = false;
    }
  }

  globalThis.AllNoteNativeFiles = Object.freeze({shareFiles});
  // Share recipients may open files after the sheet dismisses.
  void clearExpired();
})();
