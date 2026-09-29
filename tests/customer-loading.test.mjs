import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as loader from '../customer-loader.js';

const fast={wait:async()=>{},timeoutMs:50};
const fixture=()=>Array.from({length:79},(_,i)=>({id:String(i).padStart(3,'0'),rep_username:i<14?'rep-a':'rep-b',archived:i<9,duplicate_record:i===78,data:{f_customer_name:'Customer '+i},created_date:'2026-09-29T10:00:00Z',admin_sort_score:i%5}));
const storage=()=>{const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}};
const entityFor=rows=>({list:async(sort,limit,skip)=>{assert.equal(sort,'id');return rows.slice(skip,skip+limit)},filter:async(q,sort,limit,skip)=>{assert.equal(sort,'id');return rows.filter(r=>r.rep_username===q.rep_username).slice(skip,skip+limit)}});
const pause=ms=>new Promise(r=>setTimeout(r,ms));

test('79 raw rows produce exactly 69 active + 9 archived; isolated duplicate stays hidden',async()=>{
 const rows=await loader.readCustomerSnapshot(entityFor(fixture()));
 assert.equal(rows.length,78);assert.equal(loader.customerPage(rows).filtered.length,69);assert.equal(loader.customerPage(rows,{archived:true}).rows.length,9);
 assert.equal(loader.customerPage(rows,{page:1}).rows.length,50);assert.equal(loader.customerPage(rows,{page:2}).rows.length,19);
});
test('missing archived/duplicate flags remain visible, and ties have stable page order',()=>{
 const rows=[{id:'b'},{id:'a'},{id:'c',duplicate_record:true}];
 assert.deepEqual(loader.customerPage(rows).rows.map(r=>r.id),['a','b']);
});
test('sales scan is scoped on every page and cannot fall back to all customers',async()=>{
 const e=entityFor(fixture());e.list=()=>assert.fail('Unscoped sales query');
 const rows=await loader.readCustomerSnapshot(e,{repUsername:'rep-a',pageSize:3});
 assert.equal(rows.length,14);assert.equal(loader.customerPage(rows).filtered.length,5);
 await assert.rejects(loader.readCustomerSnapshot({filter:async()=>[{id:'wrong',rep_username:'rep-b'}]},{repUsername:'rep-a'}),/归属/);
});
test('pagination reads beyond 500 without duplicates or silent truncation',async()=>{
 const rows=Array.from({length:1001},(_,i)=>({id:String(i)}));
 assert.equal((await loader.readCustomerSnapshot(entityFor(rows))).length,1001);
 await assert.rejects(loader.readCustomerSnapshot({list:async()=>[{id:'same'},{id:'same'}]},{pageSize:2}),/分页/);
});
test('429 honors retry-after and eventually succeeds; 403 is not retried',async()=>{
 let calls=0,delays=[];
 assert.equal(await loader.retryRead(()=>{if(++calls<3)throw {status:429,response:{headers:{'retry-after':'2'}}};return 7},{...fast,wait:async ms=>delays.push(ms)}),7);
 assert.equal(calls,3);assert.ok(delays.every(ms=>ms>=2000));
 calls=0;await assert.rejects(loader.retryRead(()=>{calls++;throw Object.assign(new Error('denied'),{status:403})},fast));assert.equal(calls,1);
});
test('hanging query times out with bounded retries',async()=>{
 let calls=0;await assert.rejects(loader.retryRead(()=>{calls++;return new Promise(()=>{})},{...fast,timeoutMs:5}),/超时/);assert.equal(calls,3);
});
test('malformed response is an error, never an empty customer list',async()=>{
 await assert.rejects(loader.readCustomerSnapshot({list:async()=>({error:'down'})},{retryOptions:fast}),/数据格式/);
});
test('failed read retains last success across refresh and labels it stale',async()=>{
 const cache=storage(),e=entityFor(fixture());
 const store=loader.createCustomerStore(e,{cacheKey:'admin',storage:cache,retryOptions:fast});await store.read();
 e.list=async()=>{throw Error('offline')};
 const refreshed=loader.createCustomerStore(e,{cacheKey:'admin',storage:cache,retryOptions:fast});
 const result=await refreshed.read();assert.equal(result.rows.length,78);assert.equal(result.stale,true);assert.equal(result.error.message,'offline');
});
test('first-load failure stays unknown; failed second page cannot replace a complete snapshot',async()=>{
 const e={list:async()=>{throw Error('down')}};
 await assert.rejects(loader.createCustomerStore(e,{retryOptions:fast}).read());
 const rows=Array.from({length:501},(_,i)=>({id:String(i)})),good=entityFor(rows),store=loader.createCustomerStore(good,{retryOptions:fast});
 await store.read();good.list=async(_,limit,skip)=>{if(skip)throw Error('page 2 failed');return rows.slice(0,limit)};
 const result=await store.read();assert.equal(result.stale,true);assert.equal(result.rows.length,501);
});
test('concurrent callers share one request and confirmed empty results are accepted',async()=>{
 let release,calls=0;const e={list:()=>{calls++;return new Promise(r=>release=r)}};
 const store=loader.createCustomerStore(e,{retryOptions:fast});const one=store.read(),two=store.read();await pause(0);
 release([{id:'1'}]);assert.equal((await one).rows.length,1);assert.equal((await two).rows.length,1);assert.equal(calls,1);
 e.list=async()=>{calls++;return []};const result=await store.read();assert.equal(result.rows.length,0);assert.equal(calls,3);assert.equal(result.stale,false);
});
test('surprising empty then error preserves existing rows',async()=>{
 const e=entityFor([{id:'a'}]),store=loader.createCustomerStore(e,{retryOptions:fast});await store.read();let calls=0;
 e.list=async()=>{if(++calls===1)return [];throw Error('temporary')};
 assert.equal((await store.read()).rows.length,1);assert.equal(store.peek().rows.length,1);
});
test('refresh after an event starts a new scan after an already pending read',async()=>{
 let release,calls=0;const store=loader.createCustomerStore({list:()=>{calls++;return calls===1?new Promise(r=>release=r):[{id:'new'}]}},{retryOptions:fast});
 const before=store.read();await pause(0);const after=store.read({fresh:true});release([{id:'old'}]);
 assert.equal((await before).rows[0].id,'old');assert.equal((await after).rows[0].id,'new');assert.equal(calls,2);
});
test('cache is scoped, expires, tolerates unavailable storage, and clears on logout',async()=>{
 const cache=storage(),e=entityFor(fixture());const store=loader.createCustomerStore(e,{cacheKey:'x',storage:cache,now:()=>1});await store.read();
 assert.equal(loader.createCustomerStore(e,{cacheKey:'x',storage:cache,repUsername:'rep-a',now:()=>2}).peek(),null);
 assert.equal(loader.createCustomerStore(e,{cacheKey:'x',storage:cache,now:()=>1800002}).peek(),null);
 store.clear();assert.equal(cache.getItem('x'),null);
 assert.equal((await loader.createCustomerStore(e,{storage:{getItem(){throw Error()},setItem(){throw Error()}}}).read()).rows.length,78);
});
test('partial/create/delete event burst is coalesced; event during read triggers trailing refresh',async()=>{
 let callback,calls=0,release;const entity={subscribe:cb=>{callback=cb;return ()=>{}}};
 const stop=loader.subscribeCustomerRefresh(entity,async()=>{calls++;if(calls===1)await new Promise(r=>release=r)},{delay:5});
 for(const type of ['update','create','delete'])callback({type,id:'a',data:{archived:true}});
 await pause(15);assert.equal(calls,1);callback({type:'delete'});release();await pause(15);assert.equal(calls,2);stop();
});
test('maintenance defers subscription refresh then resumes without losing events',async()=>{
 let callback,calls=0,blocked=true;const stop=loader.subscribeCustomerRefresh({subscribe:cb=>{callback=cb;return()=>{}}},async()=>{calls++},{delay:5,blocked:()=>blocked});
 callback({});await pause(12);assert.equal(calls,0);blocked=false;await pause(12);assert.equal(calls,1);stop();
});

function appHarness(role,{realRender=false}={}){
 const nodes=new Map(),local=storage(),session=storage();if(role==='sales')local.setItem('mVIP_rep_username','rep-a');
 function node(id){if(!nodes.has(id))nodes.set(id,{id,value:'',textContent:'',innerHTML:'',hidden:true,dataset:{},style:{},classList:{add(){},remove(){},toggle(){}},addEventListener(){},querySelectorAll:()=>[],querySelector:()=>null,append(){},prepend(){},setAttribute(){},before(){},replaceChildren(){},contains:()=>false});return nodes.get(id)}
 const document={getElementById:node,querySelector:s=>node(s),querySelectorAll:()=>[],addEventListener(){},createElement:()=>node(Math.random()),createTextNode:s=>s,body:node('body'),head:node('head')};
 const entity=entityFor(fixture());let customerCalls=0;const list=entity.list,filter=entity.filter;
 entity.list=(...args)=>{customerCalls++;return list(...args)};entity.filter=(...args)=>{customerCalls++;return filter(...args)};entity.subscribe=()=>()=>{};
 const metadata={list:async()=>[],filter:async()=>[{id:'rep',username:'rep-a'}],subscribe:()=>()=>{}};
 const base44={entities:new Proxy({VIPCustomer:entity},{get:(o,k)=>o[k]||metadata})};
 const context=vm.createContext({console,document,base44,localStorage:local,sessionStorage:session,location:{href:''},window:{addEventListener(){}},setTimeout,clearTimeout,TextEncoder,structuredClone,Date,
  ...loader,selectCustomerPage:loader.customerPage,
  createCustomerStore:(e,opts)=>loader.createCustomerStore(e,{...opts,retryOptions:fast}),
  retryRead:fn=>loader.retryRead(fn,fast),esc:s=>String(s??''),formatDate:s=>s||'',localDateKey:s=>String(s||'2026-09-29').slice(0,10),initGlobalSearch(){},buildGroupedFieldControls:()=>'',initDateTimeControls(){},uiConfirm:async()=>true,
  customerNotice:(_,message)=>{context.lastNotice=message},lastNotice:'',renders:[]});
 let source=fs.readFileSync(new URL('../'+role+'-app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/\nboot\(\);/,'\n').replace(/if\(localStorage.getItem\('mVIP_admin'\)==='1'\)enter\(\);/,'');
 vm.runInContext(source,context);
 // Keep the real page selection/counting/loading logic; capture render outputs without a browser.
 if(!realRender)vm.runInContext("renderCustomers=()=>{renders.push(customers.map(r=>r.id))};",context);
 return {context,entity,node,eval:code=>vm.runInContext(code,context),calls:()=>customerCalls};
}
for(const role of ['admin','sales']){
 test(role+' integration: real renderer keeps table HTML on a failed refresh',async()=>{
  const h=appHarness(role,{realRender:true});await h.eval('loadCustomers()');const html=h.node('customerList').innerHTML;
  assert.match(html,/<table>/);assert.equal(h.context.lastNotice,'');
  h.entity.list=h.entity.filter=async()=>{throw Error('offline')};await h.eval('loadCustomers()');
  assert.equal(h.node('customerList').innerHTML,html);assert.match(h.context.lastNotice,/保留/);
 });
 test(role+' integration: boot reads customers without repair/stats/maintenance dependencies',async()=>{
  const h=appHarness(role);await h.eval(role==='admin'?'enter()':'boot()');
  assert.equal(h.context.renders.at(-1).length,role==='admin'?50:5);assert.equal(h.calls(),1);
  assert.equal(Number(h.node(role==='admin'?'allCustomerCount':'myCount').textContent),role==='admin'?69:5);
 });
 test(role+' integration: network failure retains rendered rows and offers retry',async()=>{
  const h=appHarness(role);await h.eval('loadCustomers()');const ids=h.context.renders.at(-1);
  h.entity.list=h.entity.filter=async()=>{throw Error('offline')};await h.eval('loadCustomers()');
  assert.deepEqual(h.context.renders.at(-1),ids);assert.match(h.context.lastNotice,/保留/);
 });
 test(role+' integration: initial failure never renders empty, recovery works',async()=>{
  const h=appHarness(role),old=h.entity[role==='admin'?'list':'filter'];h.entity.list=h.entity.filter=async()=>{throw Error('offline')};
  await h.eval('loadCustomers()');assert.equal(h.context.renders.length,0);assert.match(h.context.lastNotice,/不能判断为零/);
  h.entity[role==='admin'?'list':'filter']=old;await h.eval('loadCustomers()');assert.ok(h.context.renders.at(-1).length);
 });
 test(role+' integration: fast view changes cannot be overwritten by an earlier request',async()=>{
  const h=appHarness(role);let release;h.entity[role==='admin'?'list':'filter']=()=>new Promise(r=>release=r);
  const old=h.eval('loadCustomers()');await pause(0);
  h.eval(role==='admin'?"currentView='archive'":"customerMode='archive'");const newer=h.eval('loadCustomers({resetPage:true})');
  release(role==='admin'?fixture():fixture().filter(r=>r.rep_username==='rep-a'));await Promise.all([old,newer]);
  assert.equal(h.context.renders.length,1);assert.equal(h.context.renders[0].length,9);
 });
 test(role+' integration: confirmed empty filters have exact count, maintenance never clears rows',async()=>{
  const h=appHarness(role);await h.eval('loadCustomers()');h.node(role==='admin'?'customerSearch':'search').value='not-found';await h.eval('loadCustomers()');
  assert.equal(h.context.renders.at(-1).length,0);assert.equal(h.eval('globalCustomerRows.length'),0);
  const n=h.context.renders.length;h.context.window.MVIP_MAINTENANCE=true;await h.eval('loadCustomers()');assert.equal(h.context.renders.length,n);
 });
}
