import test from 'node:test';
import assert from 'node:assert/strict';
import {createBackupController,captureAttachments,resolveAttachmentUrl} from '../backup-ui.js';
import {ENTITIES,makeBackup,canonical,parseBackup} from '../backup-safe.js';

const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
function setup(){
 const rows=Object.fromEntries(ENTITIES.map(n=>[n,[]])),vaultData=new Map(),events=[],downloads=[],messages=[],buttons={};let writes=0,locked=false;
 const entities=Object.fromEntries(ENTITIES.map(name=>[name,{list:async()=>clone(rows[name]),filter:async q=>clone(rows[name].filter(r=>Object.entries(q).every(([k,v])=>r[k]===v))),get:async id=>clone(rows[name].find(r=>r.id===id)),create:async p=>{writes++;const row={...clone(p),id:'created-'+writes};rows[name].push(row);return row},update:()=>assert.fail('update'),delete:()=>assert.fail('delete')}]));
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(name,options,fn)=>{if(locked)return fn(null);locked=true;try{return await fn({name})}finally{locked=false}}}}});
 globalThis.document={getElementById:id=>buttons[id]??=( {disabled:false} )};globalThis.window={addEventListener:(...x)=>events.push(x),removeEventListener:(...x)=>events.push(x)};
 const vault={put:async(k,v)=>vaultData.set(k,clone(v)),get:async k=>clone(vaultData.get(k))};
 let approved=true,confirmed=0;
 const options={api:{entities},show:(message,type)=>messages.push({message,type}),confirm:async()=>{confirmed++;return approved},download:(backup,name)=>downloads.push({backup,name}),refresh:async()=>{},setMaintenance:flag=>events.push(flag),services:{openVault:async()=>vault}};
 return {options,controller:createBackupController(options),rows,vault,vaultData,messages,downloads,buttons,events,get writes(){return writes},get confirmed(){return confirmed},set approved(x){approved=x}};
}
async function file(){
 const entities=Object.fromEntries(ENTITIES.map(n=>[n,[]]));entities.VIPSalesRep=[{id:'r',username:'rep'}];entities.VIPCustomer=[{id:'c',rep_username:'rep',data:{name:'Example'},archived:true,completed_progress_ids:[]}];
 const raw=await makeBackup({entities});return {name:'backup.json',size:100,text:async()=>JSON.stringify(raw)};
}
test('controller saves and reads back safety/source before confirmation or first write',async()=>{
 const h=setup();let checked=false;
 h.options.confirm=async()=>{checked=true;assert.equal(h.writes,0);assert.ok([...h.vaultData.keys()].some(k=>k.endsWith(':safety')));assert.ok([...h.vaultData.keys()].some(k=>k.endsWith(':source')));assert.equal(h.downloads.length,1);return true};
 await createBackupController(h.options).importBackup(await file());assert.ok(checked,JSON.stringify(h.messages));assert.equal(h.writes,2);assert.equal(h.rows.VIPCustomer[0].archived,true);assert.ok(h.messages.at(-1).message.includes('完成'));assert.ok(Object.values(h.buttons).every(b=>!b.disabled));
});
test('cancelled confirmation performs zero writes and releases controls',async()=>{
 const h=setup();h.approved=false;await h.controller.importBackup(await file());assert.equal(h.writes,0);assert.match(h.messages.at(-1).message,/已取消/);assert.equal(h.events.at(-1),false);
});
test('corrupt file is rejected before capturing or writing anything',async()=>{
 const h=setup();await h.controller.importBackup({name:'bad.json',size:10,text:async()=>'{}'});assert.equal(h.writes,0);assert.equal(h.confirmed,0);assert.equal(h.downloads.length,0);
});
test('durable storage failure blocks restore before any create',async()=>{
 const h=setup();h.vault.put=async()=>{throw Error('disk full')};await h.controller.importBackup(await file());assert.equal(h.writes,0);assert.equal(h.confirmed,0);assert.match(h.messages.at(-1).message,/disk full/);
});
test('safety remains the original pre-restore snapshot after retry and can be downloaded again',async()=>{
 const h=setup(),f=await file();await h.controller.importBackup(f);const key=[...h.vaultData.keys()].find(k=>k.endsWith(':safety')),original=canonical(h.vaultData.get(key));const count=h.writes;
 await h.controller.importBackup(f);assert.equal(h.writes,count);assert.equal(canonical(h.vaultData.get(key)),original);
 assert.equal(h.vaultData.get('latest-safety').payload.entities.VIPCustomer.length,1);
 await h.controller.downloadSafety();assert.equal(canonical(h.downloads.at(-1).backup),canonical(h.vaultData.get('latest-safety')));
});
test('conflicts preserve current data and produce a qualified result instead of false exact success',async()=>{
 const h=setup();h.rows.VIPSalesRep.push({id:'r',username:'rep'});h.rows.VIPCustomer.push({id:'c',rep_username:'rep',data:{name:'New edit'},archived:false,completed_progress_ids:[]});const before=canonical(h.rows);
 await h.controller.importBackup(await file());assert.equal(h.writes,0);assert.equal(canonical(h.rows),before);assert.equal(h.messages.at(-1).type,'warn');assert.match(h.messages.at(-1).message,/冲突保留/);
});
test('another tab cannot run restore while the first holds its lock',async()=>{
 const h=setup();let release,started;const ready=new Promise(r=>started=r);h.options.confirm=()=>{started();return new Promise(r=>release=r)};
 const first=createBackupController(h.options),second=createBackupController(h.options),f=await file();const pending=first.importBackup(f);await ready;await second.importBackup(f);assert.match(h.messages.at(-1).message,/另一个页面/);assert.equal(h.writes,0);release(false);await pending;
});
test('export is live, verified, preserves all tables and creates no cloud records',async()=>{
 const h=setup();await h.controller.exportBackup();assert.equal(h.writes,0);assert.equal(h.downloads.length,1);assert.equal(h.downloads[0].backup.version,2);assert.equal(Object.keys(h.downloads[0].backup.payload.entities).length,ENTITIES.length);assert.ok(h.messages.at(-1).message.includes('备份已生成'));
});

function withAttachments(rows,urls){rows.VIPWorkflowDefinition=[{id:'d',key:'main',bundle:{workflows:[{id:'flow',steps:[{id:'step',attachments:urls.map(url=>({url,name:url.split('/').at(-1),type:'image/png'}))}]}]}}];return rows}
const page='https://example.test/mosen_VIP/admin.html';
async function mockFetch(fn,work){
 const original=globalThis.fetch,location=globalThis.location;globalThis.fetch=fn;globalThis.location={href:page};
 try{return await work()}finally{globalThis.fetch=original;if(location===undefined)delete globalThis.location;else globalThis.location=location}
}
test('historical workflow paths resolve inside project toolbox while absolute URLs stay intact',()=>{
 for(const path of ['../data/chat-flow-assets/中文.png','./data/chat-flow-assets/中文.png','data/chat-flow-assets/中文.png','./toolbox/data/chat-flow-assets/中文.png']){
  assert.equal(decodeURI(resolveAttachmentUrl(path,page).href),'https://example.test/mosen_VIP/toolbox/data/chat-flow-assets/中文.png');
 }
 assert.equal(resolveAttachmentUrl('https://files.test/x.png?token=abc',page).href,'https://files.test/x.png?token=abc');
 assert.equal(resolveAttachmentUrl('/uploads/x.png',page).href,'https://example.test/uploads/x.png');
 assert.throws(()=>resolveAttachmentUrl('javascript:alert(1)',page),/不受支持/);
});
test('404 is recorded once; other attachments still embed with original URLs for restoration',async()=>{
 const h=setup(),broken='../data/chat-flow-assets/missing.png',ok='../data/chat-flow-assets/ok.png';withAttachments(h.rows,[broken,ok,ok]);const seen=[];
 await mockFetch(async url=>{seen.push(url.href);return String(url).endsWith('missing.png')?new Response('',{status:404}):new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/png'}})},async()=>{
  const result=await captureAttachments(h.rows);assert.equal(seen.length,2);assert.ok(seen.every(u=>u.includes('/mosen_VIP/toolbox/data/')));assert.equal(result.assets[0].old_url,ok);assert.equal(result.assets[0].content,'AQID');assert.equal(result.missing_assets[0].old_url,broken);assert.equal(result.missing_assets[0].http_status,404);
  const backup=await makeBackup({entities:h.rows,...result});assert.equal(backup.payload.attachment_policy,'embedded-with-missing');assert.equal((await parseBackup(JSON.parse(JSON.stringify(backup)))).missing_assets.length,1);
 });
});
test('temporary attachment errors retry and recovered bytes produce no missing warning',async()=>{
 const h=setup();withAttachments(h.rows,['https://files.test/a.png']);let calls=0;
 await mockFetch(async()=>++calls<3?new Response('',{status:503}):new Response('ok'),async()=>{
  const result=await captureAttachments(h.rows,()=>{},{retryOptions:{attempts:3,wait:async()=>{}}});assert.equal(calls,3);assert.equal(result.assets.length,1);assert.equal(result.missing_assets.length,0);
 });
});
test('exhausted rate limits, network errors, HTML error pages and oversize files are explicit missing entries',async()=>{
 const h=setup();withAttachments(h.rows,['https://files.test/a.png']);
 for(const response of [()=>new Response('',{status:429}),()=>{throw TypeError('Failed to fetch')},()=>new Response('<html>Error</html>',{headers:{'content-type':'text/html'}}),()=>new Response('',{headers:{'content-length':String(101*1024*1024)}})]){
  await mockFetch(response,async()=>{const r=await captureAttachments(h.rows,()=>{},{retryOptions:{attempts:2,wait:async()=>{}}});assert.equal(r.assets.length,0);assert.equal(r.missing_assets.length,1);assert.ok(r.missing_assets[0].reason)});
 }
});
test('export with every attachment missing still preserves all rows and downloads a qualified backup and manifest',async()=>{
 const h=setup();withAttachments(h.rows,['../data/chat-flow-assets/missing.png']);const before=canonical(h.rows);
 await mockFetch(async()=>new Response('',{status:404}),()=>h.controller.exportBackup());
 assert.equal(h.writes,0);assert.equal(canonical(h.rows),before);assert.equal(h.downloads.length,2);assert.equal(canonical(h.downloads[0].backup.payload.entities),before);assert.match(h.downloads[0].name,/附件不完整/);assert.equal(h.downloads[1].backup.missing_assets.length,1);assert.equal(h.messages.at(-1).type,'warn');assert.match(h.messages.at(-1).message,/1 个附件未取得原文件/);await parseBackup(h.downloads[0].backup);
});
test('failed data table still blocks export instead of becoming a partial business backup',async()=>{
 const h=setup();h.options.api.entities.VIPActivityLog.list=async()=>{throw Object.assign(Error('forbidden'),{status:403})};await h.controller.exportBackup();assert.equal(h.downloads.length,0);assert.equal(h.writes,0);assert.equal(h.messages.at(-1).type,'err');
});
test('data changes while a missing attachment is read still abort export',async()=>{
 const h=setup();withAttachments(h.rows,['../data/chat-flow-assets/missing.png']);await mockFetch(async()=>{h.rows.VIPActivityLog.push({id:'changed'});return new Response('',{status:404})},()=>h.controller.exportBackup());assert.equal(h.downloads.length,0);assert.match(h.messages.at(-1).message,/数据发生变化/);
});
test('missing safety attachment is disclosed before restore, persisted, reported and warned on redownload',async()=>{
 const h=setup();withAttachments(h.rows,['../data/chat-flow-assets/missing.png']);let confirmed=false;
 h.options.confirm=async message=>{confirmed=true;assert.match(message,/安全备份有 1 个附件未取得原文件/);assert.equal(h.writes,0);return true};
 const input=await file();await mockFetch(async()=>new Response('',{status:404}),()=>createBackupController(h.options).importBackup(input));
 assert.ok(confirmed);assert.equal(h.writes,2);assert.equal(h.downloads.at(-1).backup.missing_safety_assets.length,1);assert.equal(h.messages.at(-1).type,'warn');assert.equal(h.vaultData.get('latest-safety').payload.missing_assets.length,1);
 await h.controller.downloadSafety();assert.equal(h.messages.at(-1).type,'warn');assert.match(h.messages.at(-1).message,/缺少原文件/);await parseBackup(h.downloads.at(-1).backup);
});
test('restore of a missing workflow preserves unavailable original links and reports them without uploading',async()=>{
 const h=setup(),source=Object.fromEntries(ENTITIES.map(n=>[n,[]]));withAttachments(source,['../data/chat-flow-assets/missing.png']);
 const raw=await makeBackup({entities:source,assets:[],missing_assets:[{old_url:'../data/chat-flow-assets/missing.png',name:'missing.png',reason:'HTTP 404'}]});
 h.options.confirm=async message=>{assert.match(message,/待恢复备份有 1 个附件没有原文件/);return true};
 await createBackupController(h.options).importBackup({name:'partial.json',size:100,text:async()=>JSON.stringify(raw)});
 assert.equal(h.writes,1);assert.equal(h.rows.VIPWorkflowDefinition[0].bundle.workflows[0].steps[0].attachments[0].url,'../data/chat-flow-assets/missing.png');assert.equal(h.messages.at(-1).type,'warn');assert.equal(h.downloads.at(-1).backup.missing_source_assets.length,1);
});
