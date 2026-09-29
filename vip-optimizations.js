import { buildCustomerSearchText, createEntityBatch } from './base44.js';

const DAY = 86400000;
const norm = v => String(v ?? '').normalize('NFKC').trim().toLowerCase();
const digits = v => String(v ?? '').replace(/[^0-9+]/g,'');
function pick(data, keys, rx){
  for(const k of keys){ if(data && data[k] != null && String(data[k]).trim()) return data[k]; }
  for(const [k,v] of Object.entries(data||{})){ if(rx.test(k) && v != null && String(v).trim()) return v; }
  return '';
}
export function customerSearchFields(repUsername='', data={}){
  const name=pick(data,['f_customer_name','customer_name','name'],/(customer.*name|name|姓名)/i);
  const phone=pick(data,['f_phone','phone','mobile'],/(phone|mobile|tel|电话|手机)/i);
  const email=pick(data,['f_email','email'],/(email|邮箱)/i);
  const wallet=pick(data,['f_wallet','f_wallet_address','wallet','wallet_address'],/(wallet|address|钱包)/i);
  const country=pick(data,['f_country','country','country_region'],/(country|region|国家|地区)/i);
  return {
    search_text: buildCustomerSearchText(repUsername,data),
    customer_name_normalized:norm(name),
    phone_normalized:digits(phone),
    email_normalized:norm(email),
    wallet_normalized:norm(wallet),
    country_normalized:norm(country)
  };
}
export async function ensureCustomerIndex(base44, query={}, maxRows=800){
  let skip=0,seen=0,updated=0;
  while(seen<maxRows){
    const batch=await base44.entities.VIPCustomer.filter(query,'-updated_date',Math.min(200,maxRows-seen),skip);
    const rows=Array.isArray(batch)?batch:(batch?.items||[]);
    if(!rows.length)break;
    for(const r of rows){
      const patch=customerSearchFields(r.rep_username,r.data||{});
      const stale=Object.keys(patch).some(k=>String(r[k]??'')!==String(patch[k]??''));
      if(stale){ try{await base44.entities.VIPCustomer.update(r.id,patch);updated++;}catch(_){} }
    }
    seen+=rows.length;if(rows.length<200)break;skip+=rows.length;
  }
  return {seen,updated};
}
async function upsertStat(base44,key,payload){
  const rows=await base44.entities.VIPDashboardStats.filter({key},'-updated_date',1,0);
  const row=(Array.isArray(rows)?rows:(rows?.items||[]))[0];
  const next={key,...payload,updated_at:new Date().toISOString(),version:Number(row?.version||0)+1};
  if(row) await base44.entities.VIPDashboardStats.update(row.id,next);
  else await base44.entities.VIPDashboardStats.create(next);
}
export async function reconcileDashboardStats(base44){
  const counts=new Map();let active=0,archived=0,today=0,skip=0;
  const d=new Date(),todayKey=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
  while(true){
    const batch=await base44.entities.VIPCustomer.list({sort:'-created_date',limit:500,skip});
    const rows=Array.isArray(batch)?batch:(batch?.items||[]);
    for(const r of rows){
      const rep=String(r.rep_username||''), x=counts.get(rep)||{active:0,archived:0,today:0};
      if(r.archived===true){archived++;x.archived++}
      else{active++;x.active++;const cd=String(r.created_date||'').slice(0,10);if(cd===todayKey){today++;x.today++}}
      counts.set(rep,x);
    }
    if(rows.length<500)break;skip+=rows.length;if(skip>100000)break;
  }
  await upsertStat(base44,'global',{scope:'global',rep_username:'',active_customers:active,archived_customers:archived,today_active_customers:today});
  for(const [rep,x] of counts) await upsertStat(base44,'rep:'+rep,{scope:'rep',rep_username:rep,active_customers:x.active,archived_customers:x.archived,today_active_customers:x.today});
  return {active,archived,today,reps:counts.size};
}
export async function archiveOldLogs(base44,{days=90,limit=1000}={}){
  const cutoff=new Date(Date.now()-days*DAY).toISOString().slice(0,10);
  let archived=0;
  while(archived<limit){
    const take=Math.min(200,limit-archived);
    const found=await base44.entities.VIPActivityLog.filter({event_day:{$lt:cutoff}},'event_time',take,0);
    const rows=Array.isArray(found)?found:(found?.items||[]);
    if(!rows.length)break;
    const now=new Date().toISOString();
    const records=rows.map(r=>({
      original_id:String(r.id||''),actor_username:r.actor_username||'',actor_display_name:r.actor_display_name||'',actor_type:r.actor_type||'',
      action_type:r.action_type||'update',customer_id:r.customer_id||'',customer_name:r.customer_name||'',target_key:r.target_key||'',
      target_label:r.target_label||'',old_value:r.old_value||'',new_value:r.new_value||'',message:r.message||'',
      event_time:r.event_time||r.created_date||'',event_day:r.event_day||String(r.event_time||r.created_date||'').slice(0,10),
      metadata:r.metadata||{},archived_at:now,archive_month:String(r.event_day||r.event_time||'').slice(0,7)
    }));
    await createEntityBatch(base44.entities.VIPActivityLogArchive,records,5);
    for(const r of rows){ await base44.entities.VIPActivityLog.delete(r.id) }
    archived+=rows.length;
    if(rows.length<take)break;
  }
  return {archived,cutoff};
}
export async function runDailyMaintenance(base44){
  const key='mVIP_maintenance_'+new Date().toISOString().slice(0,10);
  if(localStorage.getItem(key))return {skipped:true};
  const result={};
  try{result.stats=await reconcileDashboardStats(base44)}catch(e){result.stats_error=String(e?.message||e)}
  try{result.index=await ensureCustomerIndex(base44,{},1000)}catch(e){result.index_error=String(e?.message||e)}
  try{result.logs=await archiveOldLogs(base44,{days:90,limit:1000})}catch(e){result.logs_error=String(e?.message||e)}
  localStorage.setItem(key,JSON.stringify({at:new Date().toISOString(),result}));
  return result;
}
function injectSearchStyle(){
  if(document.getElementById('mVIPGlobalSearchStyle'))return;
  const s=document.createElement('style');s.id='mVIPGlobalSearchStyle';s.textContent=`
  .mgs-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.42);backdrop-filter:blur(3px);z-index:99990;display:flex;align-items:flex-start;justify-content:center;padding:10vh 16px}
  .mgs-card{width:min(760px,96vw);max-height:76vh;background:#fff;border-radius:18px;box-shadow:0 24px 80px rgba(15,23,42,.24);overflow:hidden;border:1px solid #e5e7eb}
  .mgs-head{display:flex;gap:10px;padding:14px;border-bottom:1px solid #edf0f4}.mgs-input{flex:1;border:0;outline:0;font-size:17px;padding:10px;background:transparent}
  .mgs-kbd{font-size:12px;color:#667085;border:1px solid #d0d5dd;border-radius:7px;padding:5px 7px;align-self:center}.mgs-results{overflow:auto;max-height:62vh;padding:8px}
  .mgs-item{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:0;background:#fff;padding:11px 12px;border-radius:11px;cursor:pointer}
  .mgs-item:hover{background:#f2f4f7}.mgs-type{min-width:52px;font-size:11px;font-weight:800;color:#475467;background:#f2f4f7;border-radius:999px;padding:4px 7px;text-align:center}
  .mgs-main{min-width:0;flex:1}.mgs-title{font-weight:800;color:#101828;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mgs-sub{font-size:12px;color:#667085;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mgs-empty{padding:24px;text-align:center;color:#667085}
  .mgs-trigger{height:38px;padding:0 11px;border:1px solid #d0d5dd;background:#fff;border-radius:10px;color:#475467;font-weight:700;cursor:pointer}
  `;document.head.appendChild(s);
}
async function loadCatalog(){
  for(const u of ['./toolbox/tool-catalog.json','./vip-tool-catalog.json']){
    try{const r=await fetch(u+'?v='+Date.now(),{cache:'no-store'});if(r.ok)return await r.json()}catch(_){}
  }
  return {items:[]};
}
export function initGlobalSearch({base44,role='admin',repUsername='',onCustomer,onWorkflow}={}){
  injectSearchStyle();
  const top=document.querySelector('.topbar .row')||document.querySelector('.topbar');
  if(top&&!document.getElementById('mgsTrigger')){const b=document.createElement('button');b.id='mgsTrigger';b.className='mgs-trigger';b.type='button';b.textContent='搜索  Ctrl K';top.prepend(b);b.onclick=()=>open()}
  let overlay=null,timer=0,seq=0,catalog=null,workflowCache=null;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function close(){if(overlay){overlay.remove();overlay=null}}
  function open(){
    if(overlay)return;overlay=document.createElement('div');overlay.className='mgs-backdrop';overlay.innerHTML='<div class="mgs-card"><div class="mgs-head"><input class="mgs-input" placeholder="搜索客户 / 客户ID / 业务员 / 工具 / 话术 / 模板"><span class="mgs-kbd">ESC</span></div><div class="mgs-results"><div class="mgs-empty">输入关键词开始搜索</div></div></div>';document.body.appendChild(overlay);
    overlay.addEventListener('mousedown',e=>{if(e.target===overlay)close()});const input=overlay.querySelector('.mgs-input');input.focus();input.oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>search(input.value),220)};
  }
  async function search(raw){
    const q=norm(raw),out=overlay?.querySelector('.mgs-results');if(!out)return;if(q.length<1){out.innerHTML='<div class="mgs-empty">输入关键词开始搜索</div>';return}
    const mine=++seq;out.innerHTML='<div class="mgs-empty">正在搜索…</div>';
    const safe=q.replace(/[.*+?^$()|[\]\\]/g,'\\$&'),rx={$regex:safe,$options:'i'};
    const cq={$or:[{id:q},{search_text:rx},{customer_name_normalized:rx},{phone_normalized:rx},{email_normalized:rx},{wallet_normalized:rx}]};
    if(role==='sales')cq.rep_username=repUsername;
    const jobs=[base44.entities.VIPCustomer.filter(cq,'-updated_date',12,0)];
    if(role==='admin')jobs.push(base44.entities.VIPSalesRep.filter({$or:[{username:rx},{display_name:rx}]},'-created_date',8,0));else jobs.push(Promise.resolve([]));
    jobs.push(catalog?Promise.resolve(catalog):loadCatalog().then(x=>(catalog=x)));
    jobs.push(workflowCache?Promise.resolve(workflowCache):base44.entities.VIPWorkflowDefinition.filter({key:'main'},'-updated_date',1,0).then(x=>(workflowCache=(Array.isArray(x)?x:(x?.items||[]))[0]?.bundle||{})));
    let vals;try{vals=await Promise.all(jobs)}catch(e){if(mine===seq)out.innerHTML='<div class="mgs-empty">搜索失败，请稍后重试</div>';return}
    if(mine!==seq||!overlay)return;
    const customers=Array.isArray(vals[0])?vals[0]:(vals[0]?.items||[]),reps=Array.isArray(vals[1])?vals[1]:(vals[1]?.items||[]),cat=vals[2]||{items:[]},wf=vals[3]||{};
    const items=[];
    customers.forEach(r=>items.push({type:'客户',title:r.data?.f_customer_name||r.data?.customer_name||r.id,sub:(r.rep_username||'')+' · '+(r.data?.f_phone||r.data?.phone||r.data?.f_email||r.data?.email||r.id),action:()=>onCustomer?.(r)}));
    reps.forEach(r=>items.push({type:'业务员',title:r.display_name||r.username,sub:r.username,action:()=>{location.hash='rep:'+encodeURIComponent(r.username)}}));
    (cat.items||cat.tools||[]).filter(t=>norm((t.title||'')+' '+(t.name||'')+' '+(t.path||'')).includes(q)).slice(0,12).forEach(t=>{const isTpl=/docx-template|\.docx/i.test((t.id||'')+' '+(t.path||''));items.push({type:isTpl?'模板':'工具',title:t.title||t.name||t.id,sub:t.path||'',action:()=>window.open('./toolbox/'+String(t.path||'').replace(/^\.\//,''),'_blank','noopener')})});
    const flows=Array.isArray(wf.workflows)?wf.workflows:[];let flowHits=0;
    for(const f of flows){for(const st of (f.steps||[])){if(flowHits>=10)break;if(norm((f.name||'')+' '+(st.title||'')+' '+(st.contentZh||'')+' '+(st.contentForeign||'')).includes(q)){flowHits++;items.push({type:'话术',title:st.title||f.name,sub:(f.name||'')+' · '+String(st.contentForeign||st.contentZh||'').slice(0,100),action:()=>onWorkflow?onWorkflow(f,st):navigator.clipboard?.writeText(st.contentForeign||st.contentZh||'')})}}}
    if(!items.length){out.innerHTML='<div class="mgs-empty">没有找到匹配内容</div>';return}
    out.innerHTML=items.map((x,i)=>'<button class="mgs-item" data-i="'+i+'"><span class="mgs-type">'+esc(x.type)+'</span><span class="mgs-main"><div class="mgs-title">'+esc(x.title)+'</div><div class="mgs-sub">'+esc(x.sub||'')+'</div></span></button>').join('');
    out.querySelectorAll('.mgs-item').forEach(b=>b.onclick=()=>{const x=items[Number(b.dataset.i)];close();x?.action?.()});
  }
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();overlay?close():open()}else if(e.key==='Escape'&&overlay)close()});
  return {open,close};
}
export function smartCustomerSubscription({event,customers,render,load,refreshCounts,matches}){
  try{
    const record=event?.data||event?.record||event?.entity||event?.item||null;
    if(record&&record.id){
      const idx=customers.findIndex(x=>String(x.id)===String(record.id));
      if(idx>=0){
        if(!matches||matches(record)){customers[idx]={...customers[idx],...record};render();return 'patched'}
        customers.splice(idx,1);render();refreshCounts?.();return 'removed';
      }
      refreshCounts?.();return 'count-only';
    }
  }catch(_){}
  load?.();refreshCounts?.();return 'reload';
}
