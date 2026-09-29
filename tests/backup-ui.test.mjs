import test from 'node:test';
import assert from 'node:assert/strict';
import {createBackupController} from '../backup-ui.js';
import {ENTITIES,makeBackup,canonical} from '../backup-safe.js';

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
