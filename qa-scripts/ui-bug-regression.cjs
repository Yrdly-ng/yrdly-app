// Local UI fixtures only. All API and external image requests are intercepted.
const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.QA_UI_BASE_URL || 'http://localhost:9002';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Only a local test server is allowed');
const output = process.env.QA_UI_OUTPUT || '/private/tmp/yrdly-ui-checks';
const id = '00000000-0000-0000-0000-000000000001';
const now = Math.floor(Date.now()/1000);
const profile = {id,name:'Ada Neighbour',username:'ada',avatar_url:'https://images.unsplash.com/avatar.png',email:'ada@example.test',phone_verified:true,profile_completed:true,onboarding_status:'completed',tour_completed:true,onboarding_completed_at:new Date().toISOString(),home_state:'Lagos',home_lga:'Ikeja',friends:[],blocked_users:[],interests:[]};
const token = [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),Buffer.from(JSON.stringify({sub:id,exp:now+3600,iat:now,role:'authenticated',aud:'authenticated'})).toString('base64url'),'mock-signature'].join('.');
const session={access_token:token,refresh_token:'fixture-refresh-token',token_type:'bearer',expires_in:3600,expires_at:now+3600,user:{...profile,aud:'authenticated',role:'authenticated',user_metadata:{name:profile.name},app_metadata:{provider:'email'},email_confirmed_at:new Date().toISOString()}};
const businesses=[{id:'biz-1',name:'Neighbourhood Coffee',category:'Food & Drink',description:'Fresh coffee around the corner',is_active:true,rating:4.8,review_count:12,logo_url:profile.avatar_url,owner_id:'seller'},{id:'biz-2',name:'Garden Services',category:'Local Services',is_active:true,rating:4.5}];
const post={id:'item-1',title:'Oak desk in excellent condition',text:'Oak desk',price:45000,user_id:'seller',author_name:'Bola',author_image:profile.avatar_url,image_urls:['https://images.unsplash.com/product.png'],category:'For Sale',moderation_status:'approved',is_sold:false,state:'Lagos',lga:'Ikeja',timestamp:new Date().toISOString(),user:{id:'seller',name:'Bola',avatar_url:profile.avatar_url},liked_by:[]};
const event={id:'event-1',title:'A Saturday with your neighbourhood',category:'Community',description:'Meet your neighbours for a relaxed afternoon of food, conversation and games.',organizer_id:'seller',organizer:{name:'Bola',avatar_url:profile.avatar_url},start_time:new Date(Date.now()+86400000).toISOString(),end_time:new Date(Date.now()+90000000).toISOString(),location_address:'Community Gardens, Ikeja, Lagos',state:'Lagos',lga:'Ikeja',status:'PUBLISHED',attendee_count:12,attendees:[],cover_image_url:'https://images.unsplash.com/event.png',ticket_tiers:[{id:'tier-1',name:'Neighbourhood admission',description:'Entry and refreshments',price:1500,capacity:100,sold:12,is_visible:true}]};
let submissions=[{id:'submission-1',name:'Garden Circle',created_by:id,approval_status:'pending',type:'interest',privacy:'open',member_count:0}];
let dismissals=[];
let submittedRequests=0;
let releaseSubmission;
let signalSubmissionReceived;
const submissionReceived = new Promise(resolve => { signalSubmissionReceived = resolve; });
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#c5dbc5"/><circle cx="400" cy="280" r="140" fill="#54795b"/></svg>';
(async()=>{
 const executablePath = process.env.QA_CHROME_EXECUTABLE || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
 const b=await chromium.launch({headless:true,...(executablePath ? {executablePath} : {})});
 try {
 const context=await b.newContext();
 await context.addInitScript(() => { Object.defineProperty(Notification, 'permission', { get: () => 'denied' }); });
 await context.addCookies([{name:'sb-yoiyqxtpmxnrrbqqidcs-auth-token',value:'base64-'+Buffer.from(JSON.stringify(session)).toString('base64url'),url:base}]);
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin===base && url.pathname.startsWith('/api/')) return route.fulfill({json:{success:true}});
  if(url.origin===base && !url.pathname.startsWith('/_next/image')) return route.continue();
  if(url.pathname.startsWith('/_next/image')||url.hostname==='images.example.test'||url.hostname.includes('unsplash')) return route.fulfill({contentType:'image/svg+xml',body:svg});
  if(url.pathname.includes('/auth/v1/user')) return route.fulfill({json:session.user});
  if(url.pathname.includes('/rest/v1/')) {
    const table=url.pathname.split('/rest/v1/')[1].split('/')[0];
    if(table==='community_submission_dismissals' && route.request().method()==='POST') { dismissals.push(route.request().postDataJSON()); return route.fulfill({json:[]}); }
    if(table==='communities' && route.request().method()==='POST') { submittedRequests++; const data={...route.request().postDataJSON(),id:'submission-2'}; submissions.push(data); await new Promise(resolve=>{ releaseSubmission=resolve; signalSubmissionReceived(); }); return route.fulfill({json:data}); }
    let data=table==='community_submission_dismissals'?dismissals:table==='communities'?(url.searchParams.get('approval_status')==='eq.approved'?[]:submissions):table==='users'||table==='public_profiles'?[profile]:table==='businesses'?businesses:table==='posts'?[post]:table==='events'?[event]:[];
    const single=route.request().headers()['accept']?.includes('vnd.pgrst.object');
    return route.fulfill({json:single?(data[0]||null):data,headers:{'content-range':`0-${Math.max(0,data.length-1)}/${data.length}`}});
  }
  return route.fulfill({json:[]});
 });
 const p=await context.newPage();
 p.setDefaultTimeout(120000);
 p.setDefaultNavigationTimeout(180000);
 p.on('pageerror',e=>console.log('PAGE ERROR',e.message));
 fs.mkdirSync(output,{recursive:true});
 for(const width of [320,768,1280]) {
  await p.setViewportSize({width,height:900});
  for(const [path,heading] of [['/marketplace','Marketplace'],['/businesses','Business Hub'],['/events/event-1',event.title]]) {
    try { await p.goto(base+path,{waitUntil:'domcontentloaded',timeout:180000}); } catch(e) { if(!e.message.includes('ERR_ABORTED')) throw e; await p.goto(base+path,{waitUntil:'domcontentloaded',timeout:180000}); }
    await p.getByRole('heading',{name:heading,exact:true}).waitFor({timeout:120000});
    if(await p.getByText('Not now',{exact:true}).isVisible().catch(()=>false)) await p.getByText('Not now',{exact:true}).click();
    await p.waitForTimeout(500);
    await p.getByRole('heading',{name:heading,exact:true}).waitFor({timeout:10000});
    const overflow=await p.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}));
    if(overflow.scroll>overflow.viewport+1) throw new Error(`${path} overflows at ${width}: ${JSON.stringify(overflow)}`);
    await p.screenshot({path:`${output}/${path.split('/')[1]}-${width}.png`,fullPage:true});
    console.log(`PASS ${path} ${width}px, no horizontal overflow`);
  }
 }
 await p.goto(base+'/profile',{waitUntil:'domcontentloaded'});
 await p.getByRole('button',{name:"View Ada Neighbour's profile picture",exact:true}).click();
 await p.getByRole('dialog').waitFor();
 await p.keyboard.press('Escape');
 await p.getByRole('dialog').waitFor({state:'hidden'});
 console.log('PASS profile picture opens and closes with Escape');
 await p.goto(base+'/communities',{waitUntil:'domcontentloaded'});
 await p.getByText('Your submissions',{exact:true}).waitFor();
 await p.getByRole('button',{name:'Dismiss Garden Circle'}).click();
 await p.getByText('Your submissions',{exact:true}).waitFor({state:'hidden'});
 await p.reload({waitUntil:'domcontentloaded'});
 await p.getByRole('main').getByRole('button',{name:'Create',exact:true}).click();
 await p.getByLabel('Name',{exact:true}).fill('  GARDEN   circle  ');
 await p.getByRole('button',{name:'Awaiting approval',exact:true}).waitFor();
 assert.equal(await p.getByRole('button',{name:'Awaiting approval',exact:true}).isDisabled(),true);
 assert.equal(submissions[0].approval_status,'pending');
 console.log('PASS dismiss persists after refresh without cancelling request; pending name remains disabled');
 await p.getByLabel('Name',{exact:true}).fill('Neighbourhood Runners');
 await p.getByLabel('Description',{exact:true}).fill('A running club for neighbours.');
 const submitClick = p.getByRole('button',{name:'Send for review',exact:true}).click();
 await submissionReceived;
 await p.getByRole('button',{name:'Submitting…',exact:true}).waitFor();
 assert.equal(await p.getByRole('button',{name:'Submitting…',exact:true}).isDisabled(),true);
 assert.equal(submittedRequests,1);
 releaseSubmission();
 await submitClick;
 await p.getByText('Neighbourhood Runners',{exact:true}).waitFor();
 assert.equal(submittedRequests,1);
 console.log('PASS submission disables immediately and sends one request');
 } finally { await b.close(); }
})().catch(e=>{console.error(e.message);process.exitCode=1});
