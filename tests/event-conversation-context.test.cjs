const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const moduleObject={exports:{}};
new Function('module','exports',ts.transpileModule(fs.readFileSync('src/lib/messages/conversation-context.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(moduleObject,moduleObject.exports);
const {getConversationType,getConversationContextHref}=moduleObject.exports;
test('event conversations stay separate from marketplace conversations',()=>{
 assert.equal(getConversationType({type:'event',item_id:'event-id'}),'event');
 assert.equal(getConversationContextHref({type:'event',item_id:'event-id'}),'/events/event-id');
});
test('existing business and marketplace context stays intact',()=>{
 assert.equal(getConversationType({type:'business',business_id:'business-id'}),'briefcase');
 assert.equal(getConversationContextHref({type:'business',business_id:'business-id'}),'/businesses/business-id');
 assert.equal(getConversationType({type:'marketplace',item_id:'item-id'}),'marketplace');
 assert.equal(getConversationContextHref({type:'marketplace',item_id:'item-id'}),'/marketplace/item-id');
 assert.equal(getConversationContextHref({type:'friend'}),null);
});
