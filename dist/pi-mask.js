'use strict';
const NoteMask = (() => {
  const categories = {
    EMAIL: 'Email addresses', PHONE: 'Phone numbers', PERSON: 'Name fields',
    ADDRESS: 'Postal address fields', ID: 'Personal and customer identifiers',
    SECRET: 'Credentials and tokens'
  };
  const aliases = {
    EMAIL: 'email emailaddress useremail customeremail',
    PHONE: 'phone mobile telephone phonenumber mobilenumber homephone',
    PERSON: 'name fullname firstname lastname surname username contactname customername',
    ADDRESS: 'address street mailingaddress billingaddress shippingaddress postalcode zipcode',
    ID: 'ssn aadhaar aadhar pan passport passportnumber dob dateofbirth customerid accountid contactid userid employeeid creditcard cardnumber',
    SECRET: 'password passwd secret clientsecret token accesstoken refreshtoken authorization proxyauthorization cookie setcookie apikey xapikey sessionid'
  };
  const fields = new Map(Object.entries(aliases).flatMap(([kind, words]) => words.split(' ').map(word => [word, kind])));
  const patterns = [
    ['EMAIL', /[\w.%+-]{1,64}@[\w.-]{1,253}\.[a-z]{2,63}\b/gi],
    ['ID', /\b(?:\d{3}-\d{2}-\d{4}|[A-Z]{5}\d{4}[A-Z])\b/g],
    ['PHONE', /(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)[ -]?\d{3}[ -]?\d{4}|\b\d{3}[- ]\d{3}[- ]\d{4}\b)|\+\d(?:[ -]?\d){9,14}\b/g],
    ['SECRET', /\b(?:Bearer|Basic)[ \t]+[A-Za-z0-9._~+/=-]+/gi]
  ];
  const validField = key => /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(key);
  const normalize = key => key.toLowerCase().replace(/__c$/, '').replace(/[_.-]/g, '');
  function scan(input, options = {}) {
    const disabled = new Set(options.disabled || []);
    const custom = new Set((options.fields || []).map(normalize));
    const suggestions = new Set(), tokens = new Map(), counts = new Map();
    let total = 0;
    function mask(kind, value) {
      const id = kind + '\0' + value;
      if (!tokens.has(id)) {
        const next = (counts.get(kind) || 0) + 1;
        counts.set(kind, next);
        tokens.set(id, '[' + kind + '_' + next + ']');
      }
      total++;
      return tokens.get(id);
    }
    function fieldKind(key) {
      const name = normalize(key);
      if (custom.has(name)) return 'CUSTOM';
      const kind = fields.get(name);
      return disabled.has(kind) ? undefined : kind;
    }
    function free(text, key) {
      for (const [kind, pattern] of patterns) {
        if (disabled.has(kind)) continue;
        text = text.replace(pattern, match => {
          if (options.learn && match === text && validField(key || '') && suggestions.size < 64) suggestions.add(key);
          return mask(kind, match);
        });
      }
      return text;
    }
    // Consume JSON tokens in source order so untouched numbers, duplicate keys and spacing survive.
    function nextColon(text, end) {
      while (end < text.length && /\s/.test(text[end])) end++;
      return text[end] === ':';
    }
    function json(text, depth) {
      JSON.parse(text);
      const token = /"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
      let pending = '', start = 0, out = '', item;
      while ((item = token.exec(text))) {
        const raw = item[0], valueStart = item.index;
        if (raw.startsWith('"') && nextColon(text, token.lastIndex)) {
          pending = JSON.parse(raw);
          continue;
        }
        if (raw === ':') continue;
        const key = pending, kind = fieldKind(key);
        pending = '';
        let replacement;
        if (kind && raw !== 'null') {
          if (raw === '{' || raw === '[') {
            let level = 1;
            while (level && (item = token.exec(text))) {
              if (item[0] === '{' || item[0] === '[') level++;
              if (item[0] === '}' || item[0] === ']') level--;
            }
          }
          replacement = JSON.stringify(mask(kind, raw.startsWith('"') ? JSON.parse(raw) : text.slice(valueStart, token.lastIndex)));
        } else if (raw.startsWith('"')) {
          const decoded = JSON.parse(raw);
          const masked = process(decoded, depth + 1, key);
          if (decoded !== masked) replacement = JSON.stringify(masked);
        }
        if (replacement !== undefined) {
          out += text.slice(start, valueStart) + replacement;
          start = token.lastIndex;
        }
      }
      return out + text.slice(start);
    }
    function process(text, depth, key) {
      if (depth > 12) throw Error('Nested payload exceeds the review limit.');
      if (/^\s*[[{]/.test(text)) {
        try { return json(text, depth); } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
      }
      // Scan complete JSON log entries independently, including structured fields.
      if (text.includes('\n')) return text.split('\n').map(line => process(line, depth + 1)).join('\n');
      // A common log format prefixes a JSON body with a timestamp and level.
      const body = text.search(/[[{]/);
      if (body > 0) {
        try {
          const maskedBody = json(text.slice(body), depth);
          return process(text.slice(0, body), depth + 1) + maskedBody;
        } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
      }
      if (!disabled.has('SECRET')) {
        text = text.replace(/^([ \t]*(?:set-cookie|cookie|authorization|proxy-authorization)[ \t]*:[ \t]*)([^\r\n]+)/gim,
          (_, header, value) => header + mask('SECRET', value));
      }
      // Quoted and unquoted log fields. Unquoted multiword values extend to the next field or delimiter.
      const pair = /(["']?)([A-Za-z_][\w.-]{0,63})\1([ \t]*[:=][ \t]*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\r\n,;&{}\[\]"']+?(?=[ \t][A-Za-z_][\w.-]{0,63}[ \t]*[:=]|[\r\n,;&{}\[\]"']|$))/g;
      text = text.replace(pair, (all, quote, name, separator, raw) => {
        const kind = fieldKind(name);
        if (!raw.trim()) return all;
        const quoted = /^["']/.test(raw);
        const value = quoted ? raw.slice(1,-1) : raw;
        const result = kind ? mask(kind, value) : free(value, name);
        return quote + name + quote + separator + (quoted ? raw[0] + result + raw[0] : result);
      });
      return free(text, key);
    }
    return {text: process(input, 0), total, suggestions: [...suggestions]};
  }
  return {categories, validField, scan};
})();
if (typeof module !== 'undefined') module.exports = NoteMask;
