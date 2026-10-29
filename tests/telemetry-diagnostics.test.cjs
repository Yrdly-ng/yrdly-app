const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const mod={exports:{}};new Function('module','exports',ts.transpileModule(fs.readFileSync('src/lib/telemetry/diagnostics.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(mod,mod.exports);
const {diagnosticMessage}=mod.exports;
test('safe diagnostic categories preserve the cause without raw user or provider messages',()=>{
 assert.equal(diagnosticMessage(new Error('cannot add postgres_changes callbacks after subscribe()')),'Realtime channel listener registered after subscription');
 assert.equal(diagnosticMessage({message:'violates foreign key constraint private-customer-id'}),'Database relationship unavailable');
 assert.equal(diagnosticMessage(new Error('private email secret@example.test payment token')),'Application operation failed');
});
