// Isolated PostgreSQL regression; no network, credentials, or real-user messages.
// Set PGLITE_MODULE to a local @electric-sql/pglite install when needed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const ts = require('typescript');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');

function callback(path, name, bindings) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) found = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, `${name} must exist`);
  const compiled = ts.transpileModule(`const run=${found};`, { compilerOptions: {target: ts.ScriptTarget.ES2022} }).outputText;
  return new Function(...Object.keys(bindings), `${compiled}; return run;`)(...Object.values(bindings));
}

test('business profile first-contact route creates conversation and sends visible text', async () => {
  const db = new PGlite();
  try {
    // Contract taken from public.conversations/public.messages: text is the message body.
    await db.exec(`CREATE TABLE conversations(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, participant_ids uuid[], type text, business_id uuid, business_name text, business_logo text, created_at timestamptz, updated_at timestamptz);
      CREATE TABLE messages(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,conversation_id uuid REFERENCES conversations(id),sender_id uuid,text text,is_read boolean,read_by text[],created_at timestamptz);`);
    let conversationId;
    let rendered = [];
    const errors = [];
    const events = [];
    const user = { id: '00000000-0000-0000-0000-000000000001' };
    const business = { id: '00000000-0000-0000-0000-000000000002', owner_id: '00000000-0000-0000-0000-000000000003', name: 'Business fixture', logo: 'https://example.test/logo.jpg' };
    const supabase = { from(table) { return {
      select() {
        if(table === 'public_profiles') return { eq() { return { single: async () => ({data: {name: 'Fixture sender'}}) }; } };
        const query = { contains: () => query, eq: () => query, then: (resolve) => resolve({data:[],error:null}) };
        return query;
      },
      insert(payload) { return { select() { return { async single() {
        try { const keys = Object.keys(payload); const result = await db.query(`INSERT INTO ${table} (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map((_,i)=>`$${i+1}`).join(',')}) RETURNING *`,Object.values(payload)); return {data:result.rows[0],error:null}; }
        catch(error) { return {data:null,error}; }
      } }; } }; },
      update() { return { eq: async () => ({error:null}) }; }
    }; } };
    const consoleMock = { error: (...args) => errors.push(args), warn() {} };
    await callback('src/app/(app)/businesses/[businessId]/chat/page.tsx','createOrGetConversation',{
      supabase, business, user, businessId:business.id, setConversationId: value => { conversationId=value; },console:consoleMock,
    })();
    assert.ok(conversationId, 'first contact creates a conversation');
    await callback('src/components/messages/BusinessChatScreen.tsx','handleSend',{
      supabase, business, user, profile:{name:'Fixture sender'}, item:undefined, message:'Hello business',convId:conversationId,initialConvId:undefined,
      captureWebError(){},trackWebEvent: (...args) => events.push(args),
      setMessages: update => { rendered=update(rendered); },setMessage(){},console:consoleMock,
    })();
    assert.deepEqual(errors.map(args=>args[1]?.message),[], 'send should not reject the real client payload');
    assert.equal((await db.query('SELECT text FROM messages')).rows[0]?.text,'Hello business');
    assert.equal(rendered[0]?.content,'Hello business','acknowledged message stays visible');
    assert.deepEqual(events,[['message_sent']], 'successful send emits one event without message contents');
  } finally {await db.close();}
});


test('rejected business message reports a handled operation and does not count a successful send', async () => {
  const failure = {code:'PGRST204',message:'private database details'};
  const reports=[]; const events=[]; let rendered=[];
  await callback('src/components/messages/BusinessChatScreen.tsx','handleSend',{
    supabase:{from(){return {insert(){return {select(){return {single:async()=>({error:failure})};}};}};}},
    business:{id:'fixture-business'}, user:{id:'fixture-user'},profile:{}, item:undefined,
    message:'private message',convId:'fixture-conversation',initialConvId:undefined,
    setMessages:update=>{rendered=update(rendered);},setMessage(){},console:{error(){}},
    captureWebError:(...args)=>reports.push(args),trackWebEvent:(...args)=>events.push(args),
  })();
  assert.deepEqual(events,[]);
  assert.deepEqual(reports,[[failure,{operation:'chat.send'}]]);
  assert.deepEqual(rendered,[]);
});
