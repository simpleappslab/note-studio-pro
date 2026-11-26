export const properties = [
  ['Title', 'getTitle', 'setTitle'], ['Author', 'getAuthor', 'setAuthor'],
  ['Subject', 'getSubject', 'setSubject'], ['Keywords', 'getKeywords', 'setKeywords'],
  ['Creator', 'getCreator', 'setCreator'], ['Producer', 'getProducer', 'setProducer'],
  ['Creation date', 'getCreationDate', 'setCreationDate'],
  ['Modification date', 'getModificationDate', 'setModificationDate']
];

export function pdfForm(lib, doc) {
  const form = doc.catalog.lookupMaybe(lib.PDFName.of('AcroForm'), lib.PDFDict);
  if (form?.has(lib.PDFName.of('XFA'))) throw Error('This PDF contains XFA forms. They are unsupported.');
  return doc.getForm();
}

export function formFieldType(lib, field) {
  const types = [
    [lib.PDFTextField, 'text'], [lib.PDFCheckBox, 'checkbox'], [lib.PDFRadioGroup, 'radio'],
    [lib.PDFDropdown, 'dropdown'], [lib.PDFOptionList, 'list'], [lib.PDFSignature, 'signature']
  ];
  return types.find(([klass]) => field instanceof klass)?.[1] || 'unsupported';
}

export function readField(lib, field) {
  const kind = formFieldType(lib, field);
  if (kind === 'text') return field.getText() ?? '';
  if (kind === 'checkbox') return field.isChecked();
  if (kind === 'radio') return field.getSelected() ?? '';
  if (kind === 'dropdown' || kind === 'list') return field.getSelected();
  return null;
}

export function setField(lib, field, value) {
  const kind = formFieldType(lib, field);
  if (kind === 'text' && typeof value === 'string' && value.length <= 10000) {
    const max = field.getMaxLength();
    if (max !== undefined && value.length > max) throw Error('A text field exceeds its maximum length.');
    field.setText(value || undefined);
    return;
  }
  if (kind === 'checkbox' && typeof value === 'boolean') {
    if (value) field.check();
    else field.uncheck();
    return;
  }
  if (kind === 'radio' || kind === 'dropdown' || kind === 'list') {
    const values = typeof value === 'string' ? (value ? [value] : []) : value;
    if (!Array.isArray(values) || values.some(entry => !field.getOptions().includes(entry))) {
      throw Error('A selected value is outside the field options.');
    }
    if (values.length > 1 && (kind === 'radio' || !field.isMultiselect())) throw Error('Select one value for this field.');
    if (values.length === 0) field.clear();
    else field.select(kind === 'radio' ? values[0] : values);
    return;
  }
  if (value !== null || (kind !== 'signature' && kind !== 'unsupported')) {
    throw Error('Invalid or unsupported form data.');
  }
}

export async function treeFromOutline(pdf) {
  let count = 0;
  const convert = async (items, depth) => {
    if (depth > 12) throw Error('Outline nesting exceeds the editing limit.');
    const nodes = [];
    for (const item of items) {
      if (++count > 500) throw Error('Outline exceeds the 500 bookmark limit.');
      let dest = item.dest;
      if (typeof dest === 'string') dest = await pdf.getDestination(dest);
      const ref = Array.isArray(dest) ? dest[0] : null;
      const index = Number.isInteger(ref) ? ref + 1 : ref ? 1 + await pdf.getPageIndex(ref) : null;
      nodes.push({title: item.title, index, unsupported: !index || Boolean(item.url || item.action),
        children: item.items?.length ? await convert(item.items, depth + 1) : []});
    }
    return nodes;
  };
  return convert((await pdf.getOutline()) || [], 0);
}

export function writeOutline(lib, doc, nodes) {
  const key = lib.PDFName.of('Outlines');
  if (!nodes.length) {
    doc.catalog.delete(key);
    return;
  }
  const root = doc.context.obj({Type: 'Outlines'});
  const rootRef = doc.context.register(root);
  const pages = doc.getPages();
  const write = (items, parent, parentRef) => {
    const children = items.map(item => {
      if (!pages[item.index - 1] || item.unsupported) throw Error('The outline contains an unsupported destination.');
      const node = doc.context.obj({
        Title: lib.PDFHexString.fromText(item.title), Parent: parentRef,
        Dest: [pages[item.index - 1].ref, 'Fit']
      });
      return {node, ref: doc.context.register(node)};
    });
    let count = children.length;
    for (const [index, {node, ref}] of children.entries()) {
      if (index) node.set(lib.PDFName.of('Prev'), children[index - 1].ref);
      if (index + 1 < children.length) node.set(lib.PDFName.of('Next'), children[index + 1].ref);
      if (items[index].children.length) count += write(items[index].children, node, ref);
    }
    parent.set(lib.PDFName.of('First'), children[0].ref);
    parent.set(lib.PDFName.of('Last'), children.at(-1).ref);
    parent.set(lib.PDFName.of('Count'), lib.PDFNumber.of(count));
    return count;
  };
  write(nodes, root, rootRef);
  doc.catalog.set(key, rootRef);
}

// Target known PDF structures; unknown private keys and visible pixels can carry data.
export async function scrubPdf(lib, engine, bytes, selections, signal) {
  const doc = await engine.open(bytes);
  const name = key => lib.PDFName.of(key);
  const seen = new Set();
  const pending = doc.context.enumerateIndirectObjects().map(([, value]) => value);
  const counts = Object.fromEntries([...selections].map(key => [key, 0]));
  const remove = (dict, key, kind) => {
    if (dict.delete(name(key))) counts[kind]++;
  };
  const actionTypes = new Set(['JavaScript','Launch','URI','GoToR','GoToE','SubmitForm','ImportData',
    'Rendition','RichMediaExecute','Movie','Sound','Named','ResetForm','GoTo','Hide','SetOCGState',
    'Thread','Trans','SetState','GoTo3DView']);
  const actionKind = value => value instanceof lib.PDFDict
    ? value.get(name('S'))?.asString?.()?.slice(1) : null;
  const hidden = dict => Boolean((dict.get(name('F'))?.asNumber?.() || 0) & (1 | 2 | 32));

  if (selections.has('metadata') && doc.context.trailerInfo.Info) {
    delete doc.context.trailerInfo.Info;
    counts.metadata++;
  }
  if (selections.has('fields')) {
    for (const field of pdfForm(lib, doc).getFields()) {
      if (field instanceof lib.PDFSignature) continue;
      const widgets = field.acroField.getWidgets();
      if (widgets.some(widget => !hidden(widget.dict))) continue;
      for (const key of ['V','DV','RV']) remove(field.acroField.dict, key, 'fields');
      for (const widget of widgets) remove(widget.dict, 'AP', 'fields');
    }
  }

  while (pending.length) {
    signal?.throwIfAborted();
    const value = pending.pop();
    if (seen.has(value)) continue;
    if (value instanceof lib.PDFRawStream || value instanceof lib.PDFContentStream) {
      pending.push(value.dict);
    } else if (value instanceof lib.PDFDict) {
      if (selections.has('metadata')) remove(value, 'Metadata', 'metadata');
      if (selections.has('attachments')) {
        for (const key of ['EmbeddedFiles','AF','EF']) remove(value, key, 'attachments');
      }
      if (selections.has('actions')) {
        for (const key of ['AA','OpenAction','JavaScript','JS']) remove(value, key, 'actions');
      }
      const automatic = actionKind(value);
      if (automatic && selections.has('actions') && actionTypes.has(automatic)) {
        for (const key of ['Next','F','Win','Mac','Unix']) remove(value, key, 'actions');
      }
      const action = value.lookup(name('A'));
      const kind = actionKind(action);
      if (selections.has('external') && ['URI','GoToR','GoToE','Launch'].includes(kind)) {
        remove(value, 'A', 'external');
      } else if (selections.has('actions') && actionTypes.has(kind)) {
        remove(value, 'A', 'actions');
      }
      if (selections.has('annotations') || selections.has('attachments')) {
        const annotations = value.lookupMaybe(name('Annots'), lib.PDFArray);
        if (annotations) {
          for (let i = annotations.size() - 1; i >= 0; i--) {
            const annotation = annotations.lookup(i);
            if (!(annotation instanceof lib.PDFDict)) continue;
            if (selections.has('attachments') && annotation.get(name('Subtype'))?.asString?.() === '/FileAttachment') {
              annotations.remove(i);
              counts.attachments++;
            } else if (selections.has('annotations') && hidden(annotation)) {
              annotations.remove(i);
              counts.annotations++;
            }
          }
        }
      }
      for (const nested of value.values()) pending.push(nested);
    } else if (value instanceof lib.PDFArray) {
      for (const nested of value.asArray()) pending.push(nested);
    } else {
      continue;
    }
    seen.add(value);
  }
  return {data: await doc.save({updateFieldAppearances: false}), counts};
}
