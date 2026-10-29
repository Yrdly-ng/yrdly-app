const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const QRCode = require('qrcode');
function fixture() {
  const sent=[];
  const load=(file)=>{
    const mod={exports:{}};
    const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    new Function('require','module','exports','process',code)(name=>{
      if(name==='resend') return {Resend:class{emails={send:async(...args)=>{sent.push(args);return {error:null};}}}};
      if(name==='./email-templates') return load('src/lib/email/email-templates.ts');
      throw Error('Unexpected '+name);
    },mod,mod.exports,{env:{RESEND_API_KEY:'fixture',NEXT_PUBLIC_APP_URL:'https://app.yrdly.ng'}});
    return mod.exports;
  };
  const service=load('src/lib/email/resend-service.ts').ResendEmailService;
  return {sent,send:(qr,id='ticket-1',key='ticket:ticket-1')=>service.sendTicketConfirmationEmail('Ada','ada@example.test','Garden party','General',id,qr,'1 Nov 2026','12:00','Lagos','YRD-TEST-CODE',key)};
}
test('ticket email embeds the actual QR PNG using a matching CID attachment',async()=>{
  const app=fixture();
  const qr=await QRCode.toDataURL(JSON.stringify({ticket_code:'YRD-TEST-CODE',event_id:'event-1'}));
  await app.send(qr);
  const [message,options]=app.sent[0];
  assert.equal(message.attachments?.length,1,'email must carry its QR image');
  const attachment=message.attachments[0];
  assert.equal(attachment.contentType,'image/png');
  assert.equal(attachment.filename,'yrdly-ticket-qr.png');
  assert.match(message.html,new RegExp('src="cid:'+attachment.contentId+'"'));
  assert.doesNotMatch(message.html,/src="data:image|qrserver/);
  assert.equal(Buffer.from(attachment.content,'base64').toString('base64'),qr.split(',')[1]);
  assert.match(message.text,/YRD-TEST-CODE/);
  assert.match(message.html,/https:\/\/app\.yrdly\.ng\/my-tickets/);
  assert.equal(options.idempotencyKey,'ticket:ticket-1');
});
test('each ticket email carries its own image without sharing another ticket code',async()=>{
  const app=fixture();const a=await QRCode.toDataURL('code-a'),b=await QRCode.toDataURL('code-b');
  await app.send(a,'ticket-a','ticket:a');await app.send(b,'ticket-b','ticket:b');
  assert.notEqual(app.sent[0][0].attachments?.[0]?.content,app.sent[1][0].attachments?.[0]?.content);
  assert.equal(app.sent[1][1].idempotencyKey,'ticket:b');
});
test('malformed or external QR sources fail before sending an email without a usable code',async()=>{
  const app=fixture();
  for(const qr of ['https://external.test/qr.png','data:image/png;base64,bm90LXBuZw==','data:image/svg+xml;base64,PHN2Zz4=']) await assert.rejects(app.send(qr),/Invalid ticket QR image/);
  assert.equal(app.sent.length,0);
});
