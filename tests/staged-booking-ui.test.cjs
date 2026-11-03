const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const ts=require('typescript');const {JSDOM}=require('jsdom');
const dom=new JSDOM('<!doctype html><body></body>',{url:'https://qa.invalid'});global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
const moduleMock={exports:{}};
const code=ts.transpileModule(fs.readFileSync('src/components/bookings/BookingMilestones.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
new Function('require','module','exports',code)(n=>n==='@/lib/supabase/supabase'?{supabase:{auth:{getSession:async()=>({data:{session:{access_token:'qa'}}})}}}:require(n),moduleMock,moduleMock.exports);
async function mount(progress){const calls=[];let changes=0,pay=0;const original=global.fetch;
 global.fetch=async(url,input)=>{calls.push({url,...input});return Response.json(input.method==='POST'?{status:'released'}:progress);};
 const el=document.createElement('div');document.body.appendChild(el);const root=createRoot(el);
 await act(async()=>root.render(React.createElement(moduleMock.exports.BookingMilestones,{bookingId:'booking',onChanged:()=>changes++,onPay:()=>pay++})));
 return{el,calls,counts:()=>({changes,pay}),click:async(text)=>{const button=[...el.querySelectorAll('button')].find(b=>b.textContent===text);assert.ok(button,text);await act(async()=>button.click());},close:async()=>{await act(()=>root.unmount());el.remove();global.fetch=original;}};
}
test('buyer may inspect quote but cancelling first-half consent cannot release money',async()=>{
 const h=await mount({enabled:true,canPay:true,milestones:[{position:1,amount_kobo:150000,status:'pending',canApprove:true}]});
 try{await h.click('Review full booking payment');assert.equal(h.counts().pay,1);
 window.confirm=()=>false;await h.click('Approve first half');assert.equal(h.calls.filter(c=>c.method==='POST').length,0);
 window.confirm=()=>true;await h.click('Approve first half');const post=h.calls.find(c=>c.method==='POST');assert.deepEqual(JSON.parse(post.body),{position:1,confirm:true});assert.equal(h.counts().changes,1);
 }finally{await h.close();}
});
test('release awaiting reconciliation has a check action and finalized release has none',async()=>{
 const h=await mount({enabled:true,canPay:false,milestones:[{position:1,amount_kobo:150000,status:'released',canApprove:false},{position:2,amount_kobo:150000,status:'approving',canApprove:true}]});
 try{assert.ok(h.el.textContent.includes('Released'));assert.ok(h.el.textContent.includes('Checking release'));
 assert.ok(!h.el.textContent.includes('Approve first half'));assert.ok(!h.el.textContent.includes('Approve final half'));
 assert.ok(h.el.textContent.includes('Check release'));}finally{await h.close();}
});
test('disabled rollout exposes no checkout or release action',async()=>{
 const h=await mount({enabled:false,canPay:false,milestones:[]});try{assert.ok(h.el.textContent.includes('not available yet'));
 assert.equal(h.el.querySelectorAll('button').length,1);assert.equal(h.calls.filter(c=>c.method==='POST').length,0);}finally{await h.close();}
});
