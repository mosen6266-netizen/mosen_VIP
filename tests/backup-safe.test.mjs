import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ENTITIES,CORE,FORMAT,canonical,digest,readTable,captureSnapshot,makeBackup,parseBackup,validateEntities,planRestore,executeRestore,replaceAssetUrls} from '../backup-safe.js';
const copy=x=>JSON.parse(JSON.stringify(x));
const fast={attempts:2,timeoutMs:20,wait:async()=>{}};
function source(){
 const e=Object.fromEntries(ENTITIES.map(n=>[n,[]]));
 e.VIPSalesRep=[{id:'r',username:'rep',display_name:'Rep'}];
 e.VIPFormField=[{id:'f',field_key:'name',field_type:'text',label:'Name'}];
 e.VIPProgressStage=[{id:'p',legacy_source_id:'progress-origin',label:'Contacted',order:1}];
 e.VIPCustomer=[{id:'c',legacy_source_id:'customer-origin',rep_username:'rep',data:{name:'Alice'},completed_progress_ids:['p'],archived:true,starred:true}];
 e.VIPActivityLog=[{id:'l',customer_id:'c',action_type:'progress_done',target_key:'p',message:'done'}];
 e.VIPWorkflowDefinition=[{id:'d',key:'main',bundle:{workflows:[{id:'flow',steps:[]}]}}];
 e.VIPWorkflowProgress=[{id:'wp',customer_id:'c',flows:{flow:{completed_step_ids:['step']}}}];
 e.VIPWorkflowFlowProgress=[{id:'fp',customer_id:'c',flow_id:'flow',unique_key:'c::flow',completed_step_ids:['step']}];
 return e;
}
export function memoryApi(initial={}){
 const db=Object.fromEntries(ENTITIES.map(n=>[n,copy(initial[n]||[])]));let serial=0;
 const writes=[];
 const entities=Object.fromEntries(ENTITIES.map(name=>[name,{
  list:async(sort,limit,skip)=>{assert.equal(sort,'id');return copy(db[name].slice(skip,skip+limit))},
  filter:async(q,sort,limit,skip)=>copy(db[name].filter(row=>Object.entries(q).every(([k,v])=>row[k]===v)).slice(skip,skip+limit)),
  get:async id=>copy(db[name].find(r=>r.id===id)),
  create:async payload=>{writes.push({name,payload:copy(payload)});const row={...copy(payload),id:'new-'+(++serial)};db[name].push(row);return copy(row)},
  update:async()=>assert.fail('Restore must never update existing data'),
  delete:async()=>assert.fail('Restore must never delete existing data')
 }]));return {entities,db,writes};
}
function opts(extra={}){return {journal:{operations:{},assets:{}},persist:async()=>{},retryOptions:fast,...extra}}

test('fresh export scans every page twice and preserves isolated/archived/orphan records',async()=>{
 const e=source();e.VIPCustomer.push({...e.VIPCustomer[0],id:'hidden',legacy_source_id:'hidden',duplicate_record:true});
 e.VIPWorkflowFlowProgress.push({id:'orphan',customer_id:'deleted',flow_id:'__orphan__'});
 const snapshot=await captureSnapshot(memoryApi(e),{retryOptions:fast});const backup=await makeBackup(snapshot);
 assert.equal(backup.payload.entities.VIPCustomer.length,2);assert.equal(backup.counts.customers,1);assert.equal(backup.counts.archived,1);
 assert.equal(backup.payload.entities.VIPWorkflowFlowProgress.length,2);assert.equal((await parseBackup(backup)).version,2);
});
test('1,001 rows paginate completely, errors and malformed results never become empty tables',async()=>{
 const rows=Array.from({length:1001},(_,i)=>({id:String(i)}));const api=memoryApi({VIPActivityLog:rows});assert.equal((await readTable(api.entities.VIPActivityLog)).length,1001);
 api.entities.VIPActivityLog.list=async()=>({error:'rate limited'});await assert.rejects(readTable(api.entities.VIPActivityLog,{retryOptions:fast}),/格式/);
});
test('changes during backup abort rather than mixing old and new tables',async()=>{
 const api=memoryApi(source());let count=0;api.entities.VIPSalesRep.list=async()=>[{id:'r',username:'rep',version:++count}];
 await assert.rejects(captureSnapshot(api,{retryOptions:fast}),/发生变化/);assert.equal(api.writes.length,0);
});
test('one failed table aborts the whole export and does not substitute a static snapshot',async()=>{
 const api=memoryApi(source());api.entities.VIPActivityLog.list=async()=>{throw Error('429')};await assert.rejects(captureSnapshot(api,{retryOptions:fast}),/429/);
});
test('checksum failure, foreign app, unknown version, missing table and duplicate IDs are rejected',async()=>{
 const b=await makeBackup({entities:source()});const damaged=copy(b);damaged.payload.entities.VIPCustomer[0].archived=false;await assert.rejects(parseBackup(damaged),/校验/);
 const wrong=copy(b);wrong.payload.app_id='another';await assert.rejects(parseBackup(wrong),/不属于/);
 await assert.rejects(parseBackup({...b,version:99}),/版本/);
 const e=source();delete e.VIPSalesRep;assert.throws(()=>validateEntities(e),/缺少/);
 const duplicate=source();duplicate.VIPCustomer.push(copy(duplicate.VIPCustomer[0]));assert.throws(()=>validateEntities(duplicate),/重复/);
});
test('V1/V4 checksums remain compatible; unsigned legacy files cannot write',async()=>{
 const entities=source(),v1={format:FORMAT,version:1,entities,checksum_sha256:await digest(JSON.stringify(entities))};assert.equal((await parseBackup(v1)).entities.VIPCustomer.length,1);
 const repository={toolbox_files:[]},v4={format:'MOSEN_VIP_FULL_BACKUP',version:4,entities,repository,checksum_sha256:await digest(JSON.stringify({entities,repository}))};assert.equal((await parseBackup(v4)).version,4);
 await assert.rejects(parseBackup({format:'MOSEN717_FULL_BACKUP',version:1,entities}),/校验/);
});
test('missing rep or progress reference fails before any write',async()=>{
 for(const field of ['rep_username','completed_progress_ids']){
  const e=source();e.VIPCustomer[0][field]=field==='rep_username'?'unknown':['unknown'];const api=memoryApi();await assert.rejects(executeRestore(api,e,opts()));assert.equal(api.writes.length,0);
 }
});
test('restore into empty simulated database remaps IDs and verifies every inserted record',async()=>{
 const api=memoryApi(),e=source(),r=await executeRestore(api,e,opts());assert.equal(r.created,8);assert.equal(r.verified,8);
 const customer=api.db.VIPCustomer[0],stage=api.db.VIPProgressStage[0];assert.deepEqual(customer.completed_progress_ids,[stage.id]);assert.equal(customer.archived,true);assert.equal(customer.starred,true);
 assert.equal(api.db.VIPActivityLog[0].customer_id,customer.id);assert.equal(api.db.VIPActivityLog[0].target_key,stage.id);
 assert.equal(api.db.VIPWorkflowProgress[0].customer_id,customer.id);assert.equal(api.db.VIPWorkflowFlowProgress[0].unique_key,customer.id+'::flow');
});
test('restoring twice with a fresh journal is idempotent through durable stable identities',async()=>{
 const api=memoryApi(),e=source();await executeRestore(api,e,opts());const length=api.writes.length;const r=await executeRestore(api,e,opts());assert.equal(r.created,0);assert.equal(api.writes.length,length);
});
test('current edits and records absent from backup remain byte-for-byte unchanged',async()=>{
 const e=source(),live=source();live.VIPCustomer[0].data.name='newer edit';live.VIPCustomer.push({...copy(live.VIPCustomer[0]),id:'extra',legacy_source_id:'extra'});
 const api=memoryApi(live),before=canonical(api.db);const r=await executeRestore(api,e,opts());assert.ok(r.conflicts.length>0);assert.equal(canonical(api.db),before);assert.equal(api.writes.length,0);
});
test('renamed representative and field retain current identifiers when a missing customer is restored',async()=>{
 const e=source(),live=source();live.VIPSalesRep[0].username='renamed';live.VIPFormField[0].field_key='renamed_name';live.VIPCustomer=[];live.VIPActivityLog=[];live.VIPWorkflowProgress=[];live.VIPWorkflowFlowProgress=[];
 const api=memoryApi(live);await executeRestore(api,e,opts());assert.equal(api.db.VIPCustomer[0].rep_username,'renamed');assert.deepEqual(api.db.VIPCustomer[0].data,{renamed_name:'Alice'});assert.equal(api.db.VIPSalesRep[0].username,'renamed');
});
test('ambiguous customer/stage identity stops preflight; duplicate logs are preserved as conflicts',async()=>{
 const e=source(),live=source();live.VIPCustomer.push({...copy(live.VIPCustomer[0]),id:'another'});const api=memoryApi(live);await assert.rejects(executeRestore(api,e,opts()),/多个/);assert.equal(api.writes.length,0);
 const logs=source();logs.VIPActivityLog[0].legacy_source_id='log';logs.VIPActivityLog.push({...copy(logs.VIPActivityLog[0]),id:'l2'});const incoming=source();incoming.VIPActivityLog[0].legacy_source_id='log';const r=await executeRestore(memoryApi(logs),incoming,opts());assert.ok(r.conflicts.some(x=>x.name==='VIPActivityLog'));
});
test('orphan workflows are reported, not linked to an arbitrary customer',async()=>{
 const e=source();e.VIPWorkflowProgress[0].customer_id='deleted';const api=memoryApi();const r=await executeRestore(api,e,opts());assert.equal(r.unresolved.length,1);assert.equal(api.db.VIPWorkflowProgress.length,0);
});
test('journal storage failure aborts before create; existing records survive',async()=>{
 const api=memoryApi();await assert.rejects(executeRestore(api,source(),opts({persist:async()=>{throw Error('disk full')}})),/disk full/);assert.equal(api.writes.length,0);
});
test('lost POST response is not blindly retried; resume finds the already created record',async()=>{
 const api=memoryApi(),original=api.entities.VIPSalesRep.create;api.entities.VIPSalesRep.create=async p=>{await original(p);throw Error('response lost')};
 const options=opts();await assert.rejects(executeRestore(api,source(),options),/暂停/);assert.equal(api.db.VIPSalesRep.length,1);
 api.entities.VIPSalesRep.create=original;await executeRestore(api,source(),options);assert.equal(api.db.VIPSalesRep.length,1);
});
test('unconfirmed write without an observable result blocks repeated create after reload',async()=>{
 const api=memoryApi();let calls=0;api.entities.VIPSalesRep.create=async()=>{calls++;throw Error('timeout')};const options=opts();await assert.rejects(executeRestore(api,source(),options));
 await assert.rejects(executeRestore(api,source(),{...options,journal:copy(options.journal)}),/上次写入/);assert.equal(calls,1);
});
test('hung POST has a deadline and leaves durable uncertainty instead of retrying',async()=>{
 const api=memoryApi();let calls=0;api.entities.VIPSalesRep.create=()=>{calls++;return new Promise(()=>{})};const options=opts({writeTimeoutMs:5});await assert.rejects(executeRestore(api,source(),options),/超时/);assert.equal(calls,1);assert.equal(options.journal.operations['VIPSalesRep:r'].state,'uncertain');
});
test('readback failure pauses recovery without deleting existing or newly inserted records',async()=>{
 const api=memoryApi();api.entities.VIPFormField.get=async()=>{throw Error('offline')};const options=opts();await assert.rejects(executeRestore(api,source(),options),/回读|offline/);
 assert.equal(api.db.VIPSalesRep.length,1);assert.equal(api.db.VIPFormField.length,1);assert.equal(api.db.VIPCustomer.length,0);
});
test('embedded attachment checksum and URL replacement preserve attachment content relationships',async()=>{
 const content='aGVsbG8=',b=await makeBackup({entities:source(),assets:[{old_url:'https://old/file',content,checksum_sha256:await digest(content)}]});assert.equal((await parseBackup(b)).assets.length,1);
 b.payload.assets[0].content='broken';b.checksum_sha256=await digest(canonical(b.payload));await assert.rejects(parseBackup(b),/附件/);
 assert.deepEqual(replaceAssetUrls({steps:[{attachments:[{url:'old',name:'file'}]}]},{old:'new'}),{steps:[{attachments:[{url:'new',name:'file'}]}]});
});
test('statistics are captured for reference but never restored over current counters',async()=>{
 const e=source();e.VIPDashboardStats=[{id:'stat',key:'global',active_customers:999}];const api=memoryApi();await executeRestore(api,e,opts());assert.equal(api.db.VIPDashboardStats.length,0);
});
test('admin backup entrypoints have no destructive or stale-static backup paths',()=>{
 const code=fs.readFileSync(new URL('../admin-app.js',import.meta.url),'utf8');for(const text of ['wipeEntity','clearBusinessDataFromSafetySnapshot','restoreRepositoryFromZip','business-backup-snapshot.json','tryRefreshBusinessBackupFromCloud'])assert.ok(!code.includes(text),text);
 const engine=fs.readFileSync(new URL('../backup-safe.js',import.meta.url),'utf8');assert.ok(!/\.delete\(|\.update\(/.test(engine));
});
