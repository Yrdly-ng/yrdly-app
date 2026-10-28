const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const z = require('zod');
const file = 'src/components/catalog/CreateCatalogItemDialog.tsx';
const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function bind(name, bindings) {
  let code;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) code = `const run = ${node.getText(source)};`;
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) code = `const run = ${node.initializer.getText(source)};`;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(code, name);
  const js = ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
  return Function(...Object.keys(bindings), `${js}; return run;`)(...Object.values(bindings));
}
const schema = bind('getFormSchema', { z, MAX_CATALOG_IMAGES: 4, isPaidPrice: n => n >= 1000, MINIMUM_PRICE_MESSAGE: 'Minimum price' });
const values = { title: 'Laptop', description: 'A laptop', price: 1500, category: 'Laptops', in_stock: true, quantity: 1 };
test('catalog validation counts retained and newly selected photos together', () => {
  const photo = new File(['image'], 'photo.jpg', { type: 'image/jpeg' });
  assert.equal(schema(0).safeParse({ ...values, image: [] }).success, false);
  assert.equal(schema(0).safeParse({ ...values, image: [photo, photo] }).success, true);
  assert.equal(schema(1).safeParse({ ...values, image: [] }).success, true);
  assert.equal(schema(4).safeParse({ ...values, image: [photo] }).success, false);
});

function fixture(retained = 0) {
  const state = { image: [] };
  const form = {
    control: {}, formState: { errors: {} },
    handleSubmit: fn => fn,
    watch: key => state[key], getValues: key => state[key],
    setValue: (key, next) => { state[key] = next; },
  };
  const names = ['Form','FormField','FormItem','FormLabel','FormControl','FormMessage','Input','Textarea','Switch','ImageIcon','X','Image','BlobImage','Loader2'];
  const bindings = Object.fromEntries(names.map(n => [n,n]));
  bindings.MAX_CATALOG_IMAGES = 4;
  bindings.MARKETPLACE_CONSTANTS = { MIN_PRICE: 1000 };
  bindings.React = { createElement: (type, props, ...children) => type === 'FormField'
    ? props.render({ field: { name: props.name, value: values[props.name], onChange() {} } })
    : { type, props: { ...props, children } } };
  const component = bind('FormBody', bindings);
  const render = () => component({ form, onSubmit() {}, loading: false, isEditMode: retained > 0,
    itemToEdit: retained ? { images: Array.from({ length: retained }, (_, i) => `saved-${i}.jpg`) } : undefined,
    removedImageIndexes: [], setRemovedImageIndexes() {}, remainingExistingImages: retained,
    onClose() {}, categories: ['Laptops', 'Mobile Phones', 'Repairs'], businessCategory: 'Tech & Repair' });
  return { state, render };
}
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
function choose(tree, files) {
  const input = nodes(tree).find(n => n.type === 'input' && n.props.type === 'file');
  assert.equal(input.props.multiple, true);
  input.props.onChange({ target: { files, value: 'selection' } });
}
test('web multi-select appends batches, respects existing photos, and supports removal without DataTransfer', () => {
  const h = fixture(1);
  const photos = ['one','two','three','four'].map(name => new File(['image'], `${name}.jpg`));
  choose(h.render(), photos.slice(0,2));
  assert.equal(h.state.image.length, 2);
  choose(h.render(), photos.slice(2));
  assert.deepEqual(h.state.image.map(f=>f.name), ['one.jpg','two.jpg','three.jpg']);
  let tree = h.render();
  assert.equal(nodes(tree).find(n=>n.type==='input' && n.props.type==='file').props.disabled, true);
  nodes(tree).find(n=>n.props?.['aria-label']==='Remove new photo 2').props.onClick();
  tree = h.render();
  assert.equal(nodes(tree).find(n=>n.type==='input' && n.props.type==='file').props.disabled, false);
  assert.deepEqual(h.state.image.map(f=>f.name), ['one.jpg','three.jpg']);
  assert.deepEqual(nodes(tree).filter(n=>n.type==='option').map(n=>n.props.value), ['Laptops','Mobile Phones','Repairs']);
});
