/* The mobile build inserts the pinned, compressed language models here. */
(() => {
  const models = "__OCR_MODELS__";
  self.addEventListener('message', event => {
    if (event.data?.action !== 'loadLanguage') return;
    const {langs} = event.data.payload;
    if (!langs.every(code => Object.hasOwn(models, code))) {
      event.stopImmediatePropagation();
      self.postMessage({jobId: event.data.jobId, status: 'reject'});
      return;
    }
    event.data.payload.langs = langs.map(code => ({
      code,
      data: Uint8Array.from(atob(models[code]), character => character.charCodeAt(0)),
    }));
  });
})();
