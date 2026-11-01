const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const ts=require('typescript');const z=require('zod');
const filename='src/components/businesses/CreateBusinessDialog.tsx';const source=fs.readFileSync(filename,'utf8');const ast=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const schemaSource=ast.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText()==='getFormSchema')).getText();
const normalizeSource=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text==='normalizeBusinessEditLocation').getText();
const moduleObject={exports:{}};new Function('z','module',ts.transpileModule(normalizeSource+'\n'+schemaSource+'\nmodule.exports={getFormSchema,normalizeBusinessEditLocation};',{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(z,moduleObject);
const valid={name:'QA bakery',mode:'product',category:'Food',description:'Fresh bread',location:{address:'Lagos'},image:['https://example.test/cover.jpg']};
test('business edit validation returns a field error for legacy addresses instead of crashing',()=>{
 const schema=moduleObject.exports.getFormSchema(true,{image_urls:valid.image});
 for(const location of ['Lagos',null,{}, {address:null},{address:42}]){
  let result;assert.doesNotThrow(()=>{result=schema.safeParse({...valid,location})});assert.equal(result.success,false);
 }
 assert.equal(schema.safeParse(valid).success,true);
});

test('Proceed to Media validates the real edit defaults for mobile and web address formats',()=>{
 let effectSource;
 function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'&&node.arguments[0]?.getText(ast).includes('stableFormReset({'))effectSource=node.arguments[0].getText(ast);ts.forEachChild(node,visit);}
 visit(ast);assert.ok(effectSource);
 const parseSource=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text==='parseHours').getText();
 for(const location of ['12 Test Street, Lagos',{address:'12 Test Street, Lagos',geopoint:{latitude:6.5,longitude:3.4}}]){
  let defaults;const business={...valid,location,image_urls:valid.image};
  const code=ts.transpileModule(parseSource+'\nconst effect='+effectSource+'; effect();',{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  new Function('open','isEditMode','businessToEdit','stableFormReset','normalizeBusinessEditLocation','setTimeout','clearTimeout','setHoursDays','setOpenTime','setCloseTime','setActiveStep',code)(true,true,business,x=>defaults=x,moduleObject.exports.normalizeBusinessEditLocation,fn=>{fn();return 1},()=>{},()=>{},()=>{},()=>{},()=>{});
  assert.equal(defaults.location.address,'12 Test Street, Lagos');
  assert.equal(defaults.image,undefined,'Saved URL photos must not enter the local File preview field');
  assert.equal(moduleObject.exports.getFormSchema(true,business).safeParse(defaults).success,true);
  if(typeof location==='object')assert.deepEqual(defaults.location.geopoint,location.geopoint);
 }
});
test('Continue to Media cancels the click default before asynchronous validation',async()=>{
 let handlerSource;function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='goToNextStep')handlerSource=node.initializer.getText(ast);ts.forEachChild(node,visit);}visit(ast);
 let prevented=false,step=1;const code=ts.transpileModule('module.exports='+handlerSource,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 const loaded={exports:{}};new Function('module','form','setActiveStep',code)(loaded,{trigger:async()=>true},value=>step=value);
 const pending=loaded.exports({preventDefault:()=>prevented=true});
 assert.equal(prevented,true,'Continue must not become a submit click when the media step replaces its button');
 await pending;assert.equal(step,2);
});
