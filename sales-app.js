import { base44, esc, showMessage, buildFieldControl, buildGroupedFieldControls, initDateTimeControls, formatDate, uiAlert, uiConfirm, uiPrompt, localDateKey, buildCustomerSearchText, readDashboardStat, adjustDashboardStat, createEntityBatch } from './base44.js';
import { customerSearchFields, ensureCustomerIndex, initGlobalSearch, smartCustomerSubscription } from './vip-optimizations.js?v=20260929-1';
let username=localStorage.getItem('mVIP_rep_username')||'',displayName=localStorage.getItem('mVIP_rep_display_name')||'',fields=[],customers=[],progressStages=[],editingId=null;
const CUSTOMER_PAGE_SIZE=50;
let customerPage=1,customerHasNext=false,myCustomerTotal=0,myArchivedTotal=0,myTodayTotal=0,customerCountTimer=null;
let customerMode='active',globalCustomerRows=null,searchTimer=null,editorBaseline='',draftTimer=null;
let salesFormSaving=false;
const modal=document.getElementById('modal'),form=document.getElementById('customerForm'),note=document.getElementById('formNote'),list=document.getElementById('customerList');
function unwrap(v){return Array.isArray(v)?v:(v?.items||[])}
async function boot(){
  if(!username){location.href='./login.html';return}
  try{
    const reps=unwrap(await base44.entities.VIPSalesRep.list({sort:'-created_date',limit:500}));const rep=reps.find(r=>String(r.username||'').toLowerCase()===username.toLowerCase());
    if(!rep){localStorage.removeItem('mVIP_rep_username');location.href='./login.html';return}
    displayName=rep.display_name||rep.username;document.getElementById('who').textContent=displayName;document.getElementById('repLabel').textContent=username;
    await Promise.all([loadFields(),loadProgress(),refreshMyCustomerCounts(),loadCustomers({resetPage:true})]);
    try{
      let fieldTimer=0,progressTimer=0,customerTimer=0,repTimer=0;
      base44.entities.VIPFormField.subscribe(()=>{if(window.MVIP_MAINTENANCE)return;clearTimeout(fieldTimer);fieldTimer=setTimeout(()=>loadFields(),450)});
      base44.entities.VIPProgressStage.subscribe(()=>{if(window.MVIP_MAINTENANCE)return;clearTimeout(progressTimer);progressTimer=setTimeout(()=>{loadProgress();loadCustomers()},500)});
      base44.entities.VIPCustomer.subscribe(evt=>{if(window.MVIP_MAINTENANCE)return;clearTimeout(customerTimer);customerTimer=setTimeout(()=>smartCustomerSubscription({event:evt,customers,render:renderCustomers,load:()=>loadCustomers(),refreshCounts:scheduleMyCustomerCountRefresh,matches:r=>String(r.rep_username||'')===username&&Boolean(r.archived)===(customerMode==='archive')&&matchesSalesFilters(r)}),650)});
      base44.entities.VIPDashboardStats.subscribe(()=>{if(window.MVIP_MAINTENANCE)return;scheduleMyCustomerCountRefresh()});
      base44.entities.VIPSalesRep.subscribe(()=>{if(window.MVIP_MAINTENANCE)return;clearTimeout(repTimer);repTimer=setTimeout(()=>verifyRep(),500)});
    }catch(_){}
    ensureCustomerIndex(base44,{rep_username:username},600).catch(()=>{});
    initGlobalSearch({base44,role:'sales',repUsername:username,onCustomer:row=>openForm(row),onWorkflow:(flow,step)=>navigator.clipboard?.writeText(step.contentForeign||step.contentZh||'')});
  }catch(_){location.href='./login.html'}
}
async function verifyRep(){const reps=unwrap(await base44.entities.VIPSalesRep.list({sort:'-created_date',limit:500}));if(!reps.some(r=>String(r.username||'').toLowerCase()===username.toLowerCase())){localStorage.removeItem('mVIP_rep_username');location.href='./login.html'}}
async function loadFields(){fields=unwrap(await base44.entities.VIPFormField.list({sort:'order',limit:500})).filter(x=>x.active!==false).sort((a,b)=>(a.order||0)-(b.order||0));document.getElementById('fieldCount').textContent=fields.length;renderForm()}
async function loadProgress(){progressStages=unwrap(await base44.entities.VIPProgressStage.list({sort:'order',limit:500})).filter(x=>x.active!==false).sort((a,b)=>(a.order||0)-(b.order||0));renderProgressChecklist();const sel=document.getElementById('salesProgressFilter');if(sel)sel.innerHTML='<option value="">全部进度</option>'+progressStages.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.label)+'</option>').join('')}
async function ensureSearchIndex(){
  const all=[];let skip=0;
  while(true){
    const batch=unwrap(await base44.entities.VIPCustomer.filter({rep_username:username},'-created_date',200,skip));
    all.push(...batch);if(batch.length<200)break;skip+=200;if(skip>5000)break;
  }
  const missing=all.filter(r=>String(r.search_text||'')!==buildCustomerSearchText(r.rep_username,r.data||{}));
  let p=0;
  async function worker(){
    while(true){
      const i=p++;if(i>=missing.length)return;
      const r=missing[i];
      try{await base44.entities.VIPCustomer.update(r.id,{...customerSearchFields(r.rep_username,r.data||{})})}catch(_){}
    }
  }
  await Promise.all(Array.from({length:Math.min(4,missing.length)},()=>worker()));
}
function regexEscape(v){return String(v||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}
function salesServerQuery(){
  const q=salesBaseQuery();
  const search=(document.getElementById('search')?.value||'').trim().toLowerCase();
  const star=document.getElementById('salesStarFilter')?.value||'';
  const progress=document.getElementById('salesProgressFilter')?.value||'';
  const country=(document.getElementById('salesCountryFilter')?.value||'').trim().toLowerCase();
  if(star==='1')q.starred=true;
  if(star==='0')q.starred=false;
  if(progress)q.completed_progress_ids={$in:[progress]};
  const terms=[];
  if(search){
    const rx={$regex:regexEscape(search),$options:'i'};
    terms.push({$or:[{customer_name_normalized:rx},{phone_normalized:rx},{email_normalized:rx},{wallet_normalized:rx},{search_text:rx}]});
  }
  if(country){
    const rx={$regex:regexEscape(country),$options:'i'};
    terms.push({$or:[{country_normalized:rx},{search_text:rx}]});
  }
  if(terms.length)q.$and=terms;
  return q;
}
async function fetchAllSalesCustomers(query){
  const all=[];let skip=0;
  while(true){
    const batch=unwrap(await base44.entities.VIPCustomer.filter(query,'-created_date',500,skip));
    all.push(...batch);if(batch.length<500)break;skip+=500;if(skip>10000)break;
  }
  return all;
}
function salesBaseQuery(){
  return {rep_username:username,archived:customerMode==='archive'};
}
function salesFilterActive(){
  return !!((document.getElementById('search')?.value||'').trim()||(document.getElementById('salesStarFilter')?.value||'')||(document.getElementById('salesProgressFilter')?.value||'')||(document.getElementById('salesCountryFilter')?.value||'').trim());
}
function matchesSalesFilters(r){
  const q=(document.getElementById('search')?.value||'').trim().toLowerCase();
  const star=document.getElementById('salesStarFilter')?.value||'';
  const progress=document.getElementById('salesProgressFilter')?.value||'';
  const country=(document.getElementById('salesCountryFilter')?.value||'').trim().toLowerCase();
  const hay=(String(r.rep_username||'')+' '+JSON.stringify(r.data||{})).toLowerCase();
  if(q&&!hay.includes(q))return false;
  if(star==='1'&&r.starred!==true)return false;
  if(star==='0'&&r.starred===true)return false;
  if(progress&&!(r.completed_progress_ids||[]).map(String).includes(String(progress)))return false;
  if(country&&!hay.includes(country))return false;
  return true;
}
async function refreshMyCustomerCounts(){
  let stat=await readDashboardStat('rep:'+username);
  if(!stat){
    const all=await fetchAllSalesCustomers({rep_username:username});
    const today=localDateKey();
    stat={
      active_customers:all.filter(x=>x.archived!==true).length,
      archived_customers:all.filter(x=>x.archived===true).length,
      today_active_customers:all.filter(x=>x.archived!==true&&localDateKey(x.created_date)===today).length
    };
  }
  myCustomerTotal=Number(stat.active_customers||0);
  myArchivedTotal=Number(stat.archived_customers||0);
  myTodayTotal=Number(stat.today_active_customers||0);
  document.getElementById('myCount').textContent=myCustomerTotal;
  document.getElementById('todayCount').textContent=myTodayTotal;
  document.getElementById('activeCustomerTabCount').textContent=myCustomerTotal;
  document.getElementById('archiveCustomerTabCount').textContent=myArchivedTotal;
}
function scheduleMyCustomerCountRefresh(){
  clearTimeout(customerCountTimer);customerCountTimer=setTimeout(()=>refreshMyCustomerCounts().catch(()=>{}),1000);
}
async function loadCustomers({resetPage=false,refreshCounts=false}={}){
  if(resetPage)customerPage=1;
  try{
    if(salesFilterActive()){
      globalCustomerRows=null;
      const skip=(customerPage-1)*CUSTOMER_PAGE_SIZE;
      try{
        const rows=unwrap(await base44.entities.VIPCustomer.filter(salesServerQuery(),'-created_date',CUSTOMER_PAGE_SIZE+1,skip));
        customerHasNext=rows.length>CUSTOMER_PAGE_SIZE;
        customers=rows.slice(0,CUSTOMER_PAGE_SIZE);
      }catch(err){
        globalCustomerRows=null;
        throw new Error('服务器筛选暂时不可用，请稍后重试。'+(err?.message?' '+err.message:''));
      }
      if(!customers.length&&customerPage>1){customerPage--;return loadCustomers({refreshCounts})}
    }else{
      globalCustomerRows=null;
      const skip=(customerPage-1)*CUSTOMER_PAGE_SIZE;
      const rows=unwrap(await base44.entities.VIPCustomer.filter(salesBaseQuery(),'-created_date',CUSTOMER_PAGE_SIZE+1,skip));
      customerHasNext=rows.length>CUSTOMER_PAGE_SIZE;
      customers=rows.slice(0,CUSTOMER_PAGE_SIZE);
      if(!customers.length&&customerPage>1){customerPage--;return loadCustomers({refreshCounts})}
    }
    renderCustomers();if(refreshCounts)await refreshMyCustomerCounts();
  }catch(err){list.innerHTML='<div class="notice err">读取客户失败：'+esc(err?.message||String(err))+'</div>'}
}
function salesPagerHtml(){
  const total=globalCustomerRows?globalCustomerRows.length:(customerMode==='archive'?myArchivedTotal:myCustomerTotal);
  return '<div class="customer-pager"><div class="customer-pager-info">第 <b>'+customerPage+'</b> 页 · 每页 '+CUSTOMER_PAGE_SIZE+' 条 · '+(customerMode==='archive'?'归档客户 ':'我的客户 ')+total+' 条</div><div class="customer-pager-actions"><button id="salesPrevPage" class="btn soft" '+(customerPage<=1?'disabled':'')+'>上一页</button><button id="salesNextPage" class="btn soft" '+(!customerHasNext?'disabled':'')+'>下一页</button></div></div>';
}
function bindSalesPager(){
  const prev=document.getElementById('salesPrevPage'),next=document.getElementById('salesNextPage');
  if(prev)prev.onclick=async()=>{if(customerPage<=1)return;customerPage--;await loadCustomers();list.scrollIntoView({behavior:'smooth',block:'start'})};
  if(next)next.onclick=async()=>{if(!customerHasNext)return;customerPage++;await loadCustomers();list.scrollIntoView({behavior:'smooth',block:'start'})};
}
function renderForm(data={}){const box=document.getElementById('dynamicFields');box.innerHTML=buildGroupedFieldControls(fields,data);initDateTimeControls(box)}
function updateEditProgressSummary(){
  const total=progressStages.length;
  const checked=[...document.querySelectorAll('#progressChecklist input[type="checkbox"]:checked')].length;
  const percent=total?Math.round(checked/total*100):0;
  document.getElementById('editProgressPercent').textContent=percent+'%';
  document.getElementById('editProgressBar').style.width=percent+'%';
}
function renderProgressChecklist(completed=[]){
  const done=new Set((completed||[]).map(String)),box=document.getElementById('progressChecklist');
  if(!progressStages.length){box.innerHTML='<div class="progress-empty">管理员还没有设置客户进度。</div>';updateEditProgressSummary();return}
  box.innerHTML=progressStages.map((p,i)=>'<label class="progress-check '+(done.has(String(p.id))?'checked':'')+'"><input type="checkbox" data-progress-id="'+p.id+'" '+(done.has(String(p.id))?'checked':'')+'><span class="progress-check-index">'+(i+1)+'</span><span class="progress-check-label">'+esc(p.label)+'</span><span class="progress-check-mark">✓</span></label>').join('');
  box.querySelectorAll('input[type="checkbox"]').forEach(cb=>cb.onchange=()=>{cb.closest('.progress-check').classList.toggle('checked',cb.checked);updateEditProgressSummary()});
  updateEditProgressSummary();
}
function localNowMinute(){const d=new Date(),y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0'),h=String(d.getHours()).padStart(2,'0'),min=String(d.getMinutes()).padStart(2,'0');return y+'-'+m+'-'+day+'T'+h+':'+min}
function openForm(row=null){
  if(salesFormSaving)return;
  editingId=row?.id||null;
  document.getElementById('modalTitle').textContent=editingId?'编辑客户':'登记客户';
  const originalData=row?.data?{...row.data}:{f_transfer_main_time:localNowMinute()};
  const originalProgress=row?.completed_progress_ids||[];
  renderForm(originalData);renderProgressChecklist(originalProgress);note.hidden=true;modal.hidden=false;
  editorBaseline=JSON.stringify({data:originalData,completed_progress_ids:originalProgress.map(String).sort()});
  try{
    const raw=localStorage.getItem(salesDraftKey());
    if(raw){
      const d=JSON.parse(raw);
      if(d?.data){renderForm(d.data);renderProgressChecklist(d.completed_progress_ids||[]);showMessage(note,'已恢复上次未保存的草稿。','ok')}
    }
  }catch(_){}
}
function progressStats(row){
  const done=new Set((row.completed_progress_ids||[]).map(String));
  const total=progressStages.length;
  const completed=progressStages.filter(p=>done.has(String(p.id))).length;
  const percent=total?Math.round(completed/total*100):0;
  let solid='#98a2b3',fill='rgba(152,162,179,.13)';
  if(percent>0&&percent<25){solid='#d92d20';fill='rgba(217,45,32,.10)'}
  else if(percent<50&&percent>0){solid='#dc6803';fill='rgba(220,104,3,.11)'}
  else if(percent<75&&percent>=50){solid='#1570ef';fill='rgba(21,112,239,.10)'}
  else if(percent<100&&percent>=75){solid='#7f56d9';fill='rgba(127,86,217,.10)'}
  else if(percent===100){solid='#079455';fill='rgba(7,148,85,.11)'}
  return {done,total,completed,percent,solid,fill};
}
function progressDetail(row){
  const s=progressStats(row);
  if(!s.total)return '<div class="preview-progress-block"><div class="preview-progress-head"><b>客户进度</b><strong>0%</strong></div><div class="percent-progress"><span style="width:0%"></span></div><div class="small" style="margin-top:8px">管理员还没有设置客户进度。</div></div>';
  return '<div class="preview-progress-block"><div class="preview-progress-head"><b>客户进度</b><strong style="color:'+s.solid+'">'+s.percent+'%</strong></div><div class="percent-progress"><span style="width:'+s.percent+'%;background:'+s.solid+'"></span></div><div class="preview-progress-meta">已完成 '+s.completed+' / '+s.total+' 项</div><div class="preview-stage-list">'+progressStages.map((p,i)=>'<div class="preview-stage '+(s.done.has(String(p.id))?'done':'')+'"><span class="preview-stage-check">'+(s.done.has(String(p.id))?'✓':'')+'</span><span class="preview-stage-index">'+(i+1)+'</span><span class="preview-stage-label">'+esc(p.label)+'</span></div>').join('')+'</div></div>';
}
function previewCard(row){
  const s=progressStats(row);
  const done=new Set((row.completed_progress_ids||[]).map(String));
  const progressHtml=progressStages.length?progressStages.map((p,i)=>'<label class="progress-check '+(done.has(String(p.id))?'checked':'')+'"><input type="checkbox" data-preview-progress-id="'+p.id+'" '+(done.has(String(p.id))?'checked':'')+'><span class="progress-check-index">'+(i+1)+'</span><span class="progress-check-label">'+esc(p.label)+'</span><span class="progress-check-mark">✓</span></label>').join(''):'<div class="progress-empty">管理员还没有设置客户进度。</div>';
  return '<div class="preview-panel-head"><div><div class="preview-title">客户完整信息</div><div class="preview-subtitle">可直接编辑客户资料和跟进进度</div></div><div class="row"><button class="btn soft preview-workflow-btn" type="button">维权流程</button><button class="btn soft preview-copy-btn" type="button">复制资料</button><button class="preview-close-btn" type="button">关闭</button></div></div><div class="preview-meta-row"><div class="preview-readonly"><span>当前业务员</span><b>'+esc(displayName||username)+'</b></div><div class="preview-readonly"><span>登记时间</span><b>'+esc(formatDate(row.created_date)||'—')+'</b></div></div><div class="preview-editor-grid">'+buildGroupedFieldControls(fields,row.data||{})+'</div><div class="preview-progress-block preview-progress-edit"><div class="preview-progress-head"><b>客户进度</b><strong data-preview-percent style="color:'+s.solid+'">'+s.percent+'%</strong></div><div class="percent-progress"><span data-preview-bar style="width:'+s.percent+'%;background:'+s.solid+'"></span></div><div class="preview-progress-meta" data-preview-meta>已完成 '+s.completed+' / '+s.total+' 项</div><div class="progress-checklist preview-progress-checklist">'+progressHtml+'</div></div><div data-vip-inline-host hidden></div><div class="preview-save-bar"><div class="notice" data-preview-note hidden></div><div class="spacer"></div><button class="btn primary preview-save-btn" type="button">保存修改</button></div>';
}
function getPreviewPortal(){
  let portal=document.getElementById('customerPreviewPortal');
  if(!portal){portal=document.createElement('div');portal.id='customerPreviewPortal';portal.className='customer-preview-portal';portal.hidden=true;portal.dataset.pinned='0';document.body.appendChild(portal)}
  return portal;
}
function updatePreviewProgressUI(portal){
  const ids=[...portal.querySelectorAll('[data-preview-progress-id]:checked')].map(x=>x.dataset.previewProgressId);
  const s=progressStats({completed_progress_ids:ids});
  const pct=portal.querySelector('[data-preview-percent]'),bar=portal.querySelector('[data-preview-bar]'),meta=portal.querySelector('[data-preview-meta]');
  if(pct){pct.textContent=s.percent+'%';pct.style.color=s.solid}
  if(bar){bar.style.width=s.percent+'%';bar.style.background=s.solid}
  if(meta)meta.textContent='已完成 '+s.completed+' / '+s.total+' 项';
}
function attachSalesPreviewEditor(portal,row){
  portal.querySelector('.preview-close-btn')?.addEventListener('click',()=>{portal.dataset.pinned='0';portal.hidden=true;portal.innerHTML=''});
  portal.querySelector('.preview-workflow-btn')?.addEventListener('click',()=>{const host=portal.querySelector('[data-vip-inline-host]');if(!host)return;if(!host.hidden){host.hidden=true;host.innerHTML='';return}window.MosenVIPWorkflow?.mount(host,row.id,fixedCustomerValue(row,'f_customer_name')||'未命名客户')});
  portal.querySelector('.preview-copy-btn')?.addEventListener('click',()=>copyCustomer(row));
  portal.querySelectorAll('[data-preview-progress-id]').forEach(cb=>cb.onchange=()=>{cb.closest('.progress-check').classList.toggle('checked',cb.checked);updatePreviewProgressUI(portal)});
  portal.querySelector('.preview-save-btn')?.addEventListener('click',async()=>{
    const note=portal.querySelector('[data-preview-note]'),btn=portal.querySelector('.preview-save-btn');
    if(!btn||btn.dataset.saving==='1')return;
    btn.dataset.saving='1';
    const originalText=btn.textContent;
    btn.disabled=true;btn.textContent='保存中…';btn.setAttribute('aria-busy','true');
    const data={...(row.data||{})};portal.querySelectorAll('[data-key]').forEach(el=>data[el.dataset.key]=el.value);
    const completed_progress_ids=[...portal.querySelectorAll('[data-preview-progress-id]:checked')].map(x=>x.dataset.previewProgressId);
    showMessage(note,'正在保存…');
    try{
      await base44.entities.VIPCustomer.update(row.id,{rep_username:username,data,completed_progress_ids,admin_sort_score:completed_progress_ids.length,...customerSearchFields(username,data)});
      await logCustomerDiff(row,data,completed_progress_ids,row.id);
      row.data=data;row.completed_progress_ids=completed_progress_ids;
      showMessage(note,'已保存并同步。','ok');
      await loadCustomers();
      const fresh=customers.find(x=>String(x.id)===String(row.id))||row;
      portal.innerHTML=previewCard(fresh);initDateTimeControls(portal);portal.hidden=false;portal.dataset.pinned='1';attachSalesPreviewEditor(portal,fresh);
      const newNote=portal.querySelector('[data-preview-note]');showMessage(newNote,'已保存并同步。','ok');
    }catch(err){
      btn.dataset.saving='0';btn.disabled=false;btn.textContent=originalText;btn.removeAttribute('aria-busy');
      showMessage(note,'保存失败：'+(err?.message||String(err)),'err');
    }
  });
}
function bindPreviewHover(container){
  const portal=getPreviewPortal();let timer;
  const keep=()=>clearTimeout(timer);
  const hideLater=()=>{clearTimeout(timer);if(portal.dataset.pinned!=='1'){portal.hidden=true;portal.innerHTML=''}};
  portal.onmouseenter=keep;portal.onmouseleave=hideLater;
  container.querySelectorAll('.preview-wrap').forEach(w=>{
    const findRow=()=>customers.find(x=>String(x.id)===String(w.dataset.id));
    const open=(pin=false)=>{keep();const row=findRow();if(!row)return;portal.innerHTML=previewCard(row);initDateTimeControls(portal);portal.hidden=false;portal.dataset.pinned=pin?'1':'0';attachSalesPreviewEditor(portal,row)};
    w.onmouseenter=()=>open(false);w.onmouseleave=hideLater;
    w.querySelector('.eye-btn')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();open(true)});
  });
}
function fixedCustomerValue(row,key){return row.data?.[key]??''}
function progressLabels(row){
  const s=progressStats(row);
  if(!progressStages.length)return {current:'未设置进度',next:'—'};
  const completedOrdered=progressStages.filter(p=>s.done.has(String(p.id)));
  const current=completedOrdered.length?completedOrdered[completedOrdered.length-1].label:'未开始';
  const nextStage=progressStages.find(p=>!s.done.has(String(p.id)));
  return {current,next:nextStage?nextStage.label:'已完成'};
}
function salesLogRecord(payload){
  const now=new Date();
  return {
    actor_username:username,
    actor_display_name:displayName||username,
    actor_type:'sales',
    action_type:payload.action_type||'update',
    customer_id:payload.customer_id||'',
    customer_name:payload.customer_name||'',
    target_key:payload.target_key||'',
    target_label:payload.target_label||'',
    old_value:payload.old_value==null?'':String(payload.old_value),
    new_value:payload.new_value==null?'':String(payload.new_value),
    message:payload.message||'',
    event_time:now.toISOString(),
    event_day:localDateKey(now),
    metadata:payload.metadata||{}
  };
}
async function writeSalesLogs(payloads){
  try{await createEntityBatch(base44.entities.VIPActivityLog,(payloads||[]).map(salesLogRecord),6)}catch(_){}
}
async function writeSalesLog(payload){return writeSalesLogs([payload])}
function customerNameFromData(data){return data?.f_customer_name||'未命名客户'}
async function logCustomerDiff(oldRow,newData,newProgress,customerId){
  const oldData=oldRow?.data||{}, name=customerNameFromData(newData),events=[];
  for(const field of fields){
    const before=oldData[field.field_key]??'',after=newData[field.field_key]??'';
    if(String(before)!==String(after)){
      events.push({
        action_type:'field_update',customer_id:customerId,customer_name:name,
        target_key:field.field_key,target_label:field.label,old_value:before,new_value:after,
        message:(displayName||username)+' 修改了 '+name+' 的「'+field.label+'」：'+(before||'空')+' → '+(after||'空')
      });
    }
  }
  const oldSet=new Set((oldRow?.completed_progress_ids||[]).map(String));
  const newSet=new Set((newProgress||[]).map(String));
  for(const p of progressStages){
    const id=String(p.id),was=oldSet.has(id),now=newSet.has(id);
    if(!was&&now)events.push({
      action_type:'progress_complete',customer_id:customerId,customer_name:name,
      target_key:id,target_label:p.label,new_value:'已完成',
      message:(displayName||username)+' 完成了 '+name+' 的客户进度「'+p.label+'」'
    });
    if(was&&!now)events.push({
      action_type:'progress_uncheck',customer_id:customerId,customer_name:name,
      target_key:id,target_label:p.label,old_value:'已完成',new_value:'未完成',
      message:(displayName||username)+' 取消了 '+name+' 的客户进度「'+p.label+'」'
    });
  }
  await writeSalesLogs(events);
}
function customerCopyText(row){
  const lines=['客户姓名：'+(fixedCustomerValue(row,'f_customer_name')||''),'业务员：'+(displayName||username)];
  for(const f of fields){const v=row.data?.[f.field_key];if(v!==undefined&&v!==null&&String(v).trim()!=='')lines.push(f.label+'：'+v)}
  const p=progressLabels(row);lines.push('目前进度：'+p.current);if(row.archived)lines.push('归档原因：'+(row.archive_reason||'未填写'));
  return lines.join('\n');
}
async function copyCustomer(row){try{await navigator.clipboard.writeText(customerCopyText(row));await uiAlert('客户资料已复制到剪贴板。',{title:'复制成功'})}catch(_){await uiAlert('复制失败，请重试。',{title:'复制失败',danger:true})}}
async function setStar(row,value){
  await base44.entities.VIPCustomer.update(row.id,{starred:value});row.starred=value;await writeSalesLog({action_type:'customer_star',customer_id:row.id,customer_name:customerNameFromData(row.data),message:(displayName||username)+(value?' 将客户设为重点「':' 取消重点客户「')+customerNameFromData(row.data)+'」'});renderCustomers();
}
async function archiveSalesCustomer(row){
  const reason=await uiPrompt('可填写归档原因，例如：已完成 / 客户失联 / 暂停跟进 / 重复客户 / 其他。',{title:'归档客户',placeholder:'归档原因（可选）',confirmText:'下一步'});
  if(reason===null)return;
  if(!await uiConfirm('确定将「'+customerNameFromData(row.data)+'」移入归档吗？\n客户资料不会删除，可以随时恢复。',{title:'确认归档',confirmText:'确认归档'}))return;
  const archived_at=new Date().toISOString();
  await base44.entities.VIPCustomer.update(row.id,{archived:true,archived_at,archived_by_username:username,archived_by_display_name:displayName||username,archived_by_type:'sales',archive_reason:reason});
  const todayDelta=localDateKey(row.created_date)===localDateKey()?-1:0;
  await Promise.all([
    adjustDashboardStat('global',{active_customers:-1,archived_customers:1,today_active_customers:todayDelta},{scope:'global'}),
    adjustDashboardStat('rep:'+username,{active_customers:-1,archived_customers:1,today_active_customers:todayDelta},{scope:'rep',rep_username:username})
  ]);
  await writeSalesLog({action_type:'customer_archive',customer_id:row.id,customer_name:customerNameFromData(row.data),message:(displayName||username)+' 将客户「'+customerNameFromData(row.data)+'」归档'+(reason?'，原因：'+reason:'')});
  await loadCustomers({refreshCounts:true});
}
async function restoreSalesCustomer(row){
  if(!await uiConfirm('将「'+customerNameFromData(row.data)+'」恢复到我的客户列表吗？',{title:'恢复客户',confirmText:'确认恢复'}))return;
  await base44.entities.VIPCustomer.update(row.id,{archived:false,archived_at:'',archived_by_username:'',archived_by_display_name:'',archived_by_type:'',archive_reason:''});
  const todayDelta=localDateKey(row.created_date)===localDateKey()?1:0;
  await Promise.all([
    adjustDashboardStat('global',{active_customers:1,archived_customers:-1,today_active_customers:todayDelta},{scope:'global'}),
    adjustDashboardStat('rep:'+username,{active_customers:1,archived_customers:-1,today_active_customers:todayDelta},{scope:'rep',rep_username:username})
  ]);
  await writeSalesLog({action_type:'customer_restore',customer_id:row.id,customer_name:customerNameFromData(row.data),message:(displayName||username)+' 将客户「'+customerNameFromData(row.data)+'」从归档恢复'});
  await loadCustomers({refreshCounts:true});
}
function renderCustomers(){
  const rows=customers;
  if(!rows.length){list.innerHTML='<div class="empty">'+(customerMode==='archive'?'暂无归档客户':'暂无匹配客户')+'</div>'+salesPagerHtml();bindSalesPager();return}
  const eye='<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="2.8" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
  list.innerHTML='<div class="table-wrap customer-table fixed-customer-table"><table><thead><tr><th>转主号时间</th><th>客户姓名</th><th>手机号</th><th>邮箱</th><th>损失金额</th><th>目前进度</th><th>'+(customerMode==='archive'?'归档信息':'下一步')+'</th><th>操作</th></tr></thead><tbody>'+rows.map(r=>{const s=progressStats(r),pl=progressLabels(r);const archiveInfo=r.archived?((r.archive_reason||'未填写原因')+' · '+(formatDate(r.archived_at)||'')):pl.next;return '<tr class="customer-progress-row '+(r.starred?'starred-row':'')+'" style="--row-progress:'+s.percent+'%;--row-fill:'+s.fill+';--row-solid:'+s.solid+'"><td data-label="转主号时间">'+esc(formatDate(fixedCustomerValue(r,'f_transfer_main_time'))||'—')+'</td><td data-label="客户姓名"><div class="customer-name-stack"><div class="customer-name-line"><button class="star-btn '+(r.starred?'active':'')+'" data-id="'+r.id+'" type="button" title="重点客户">★</button><b>'+esc(fixedCustomerValue(r,'f_customer_name')||'—')+'</b><span class="row-progress-badge">'+s.percent+'%</span></div></div></td><td data-label="手机号">'+esc(fixedCustomerValue(r,'f_phone')||'—')+'</td><td data-label="邮箱">'+esc(fixedCustomerValue(r,'f_email')||'—')+'</td><td data-label="损失金额">'+esc(fixedCustomerValue(r,'f_loss_amount')||'—')+'</td><td data-label="目前进度"><span class="current-progress-text" style="color:'+s.solid+'">'+esc(pl.current)+'</span></td><td data-label="'+(customerMode==='archive'?'归档信息':'下一步')+'">'+esc(archiveInfo||'—')+'</td><td data-label="操作"><div class="row nowrap"><button class="btn soft vipflow" data-id="'+r.id+'">维权流程</button><button class="btn soft copycustomer" data-id="'+r.id+'">复制</button>'+(customerMode==='archive'?'<button class="btn soft restorecustomer" data-id="'+r.id+'">恢复</button>':'<button class="btn soft edit" data-id="'+r.id+'">编辑</button><button class="btn soft archivecustomer" data-id="'+r.id+'">归档</button>')+'<span class="preview-wrap" data-id="'+r.id+'"><button class="eye-btn" type="button" aria-label="预览完整客户信息">'+eye+'</button></span></div></td></tr>'}).join('')+'</tbody></table></div>'+salesPagerHtml();
  bindPreviewHover(list);bindSalesPager();
  list.querySelectorAll('.edit').forEach(b=>b.onclick=()=>openForm(customers.find(x=>x.id===b.dataset.id)));
  list.querySelectorAll('.vipflow').forEach(b=>b.onclick=()=>{const row=customers.find(x=>String(x.id)===String(b.dataset.id));if(row&&window.MosenVIPWorkflow)window.MosenVIPWorkflow.open(row.id,fixedCustomerValue(row,'f_customer_name')||'未命名客户')});
  list.querySelectorAll('.copycustomer').forEach(b=>b.onclick=()=>copyCustomer(customers.find(x=>x.id===b.dataset.id)));
  list.querySelectorAll('.archivecustomer').forEach(b=>b.onclick=()=>archiveSalesCustomer(customers.find(x=>x.id===b.dataset.id)));
  list.querySelectorAll('.restorecustomer').forEach(b=>b.onclick=()=>restoreSalesCustomer(customers.find(x=>x.id===b.dataset.id)));
  list.querySelectorAll('.star-btn').forEach(b=>b.onclick=()=>{const row=customers.find(x=>x.id===b.dataset.id);if(row)setStar(row,!row.starred)});
}
function currentEditorState(){
  const data={};form.querySelectorAll('[data-key]').forEach(el=>data[el.dataset.key]=el.value);
  const completed_progress_ids=[...document.querySelectorAll('#progressChecklist input[type="checkbox"]:checked')].map(x=>x.dataset.progressId).sort();
  return JSON.stringify({data,completed_progress_ids});
}
function salesDraftKey(){return 'mVIP_draft_sales_'+username+'_'+(editingId||'new')}
function saveSalesDraft(){
  if(modal.hidden)return;clearTimeout(draftTimer);draftTimer=setTimeout(()=>{try{localStorage.setItem(salesDraftKey(),currentEditorState())}catch(_){}},250)
}
function clearSalesDraft(){try{localStorage.removeItem(salesDraftKey())}catch(_){}}
function editorDirty(){return !modal.hidden&&currentEditorState()!==editorBaseline}
async function requestCloseEditor(){
  if(salesFormSaving){await uiAlert('客户资料正在保存，请等待保存完成后再关闭。',{title:'正在保存'});return false}
  if(editorDirty()&&!await uiConfirm('当前修改尚未保存。已输入内容仍会保存在本机草稿中。',{title:'未保存的修改',confirmText:'仍然关闭',danger:true}))return false;
  modal.hidden=true;return true;
}
form.addEventListener('input',saveSalesDraft);form.addEventListener('change',saveSalesDraft);
form.onsubmit=async e=>{
  e.preventDefault();
  if(salesFormSaving)return;
  const submitBtn=e.submitter||form.querySelector('button[type="submit"]');
  const oldText=submitBtn?.textContent||'保存客户';
  salesFormSaving=true;
  if(submitBtn){submitBtn.disabled=true;submitBtn.textContent='保存中…';submitBtn.setAttribute('aria-busy','true')}
  const data={};form.querySelectorAll('[data-key]').forEach(el=>data[el.dataset.key]=el.value);
  const completed_progress_ids=[...document.querySelectorAll('#progressChecklist input[type="checkbox"]:checked')].map(x=>x.dataset.progressId);
  const startingEditingId=editingId;
  const draftKeyBeforeSave=salesDraftKey();
  try{
    if(startingEditingId){
      const oldRow=customers.find(x=>String(x.id)===String(startingEditingId));
      await base44.entities.VIPCustomer.update(startingEditingId,{rep_username:username,data,completed_progress_ids,admin_sort_score:completed_progress_ids.length,...customerSearchFields(username,data)});
      if(oldRow)await logCustomerDiff(oldRow,data,completed_progress_ids,startingEditingId);
    }else{
      const created=await base44.entities.VIPCustomer.create({rep_username:username,data,completed_progress_ids,archived:false,starred:false,admin_sort_score:completed_progress_ids.length,...customerSearchFields(username,data)});
      const cid=created?.id||'';
      if(cid)editingId=cid;
      await Promise.all([
        adjustDashboardStat('global',{active_customers:1,today_active_customers:1},{scope:'global'}),
        adjustDashboardStat('rep:'+username,{active_customers:1,today_active_customers:1},{scope:'rep',rep_username:username})
      ]);
      await writeSalesLog({
        action_type:'customer_create',customer_id:cid,customer_name:customerNameFromData(data),
        message:(displayName||username)+' 登记了新客户「'+customerNameFromData(data)+'」',
        metadata:{fields:data,completed_progress_ids}
      });
    }
    const wasNew=!startingEditingId;
    try{localStorage.removeItem(draftKeyBeforeSave)}catch(_){}
    clearSalesDraft();editorBaseline=currentEditorState();showMessage(note,'已保存并同步。','ok');
    await loadCustomers({resetPage:wasNew,refreshCounts:true});
    setTimeout(()=>{
      modal.hidden=true;salesFormSaving=false;
      if(submitBtn){submitBtn.disabled=false;submitBtn.textContent=oldText;submitBtn.removeAttribute('aria-busy')}
    },400);
  }catch(err){
    salesFormSaving=false;
    if(submitBtn){submitBtn.disabled=false;submitBtn.textContent=oldText;submitBtn.removeAttribute('aria-busy')}
    showMessage(note,'保存失败：'+(err?.message||'未知错误'),'err');
  }
};
document.getElementById('newBtn').onclick=()=>openForm();
document.getElementById('closeModal').onclick=requestCloseEditor;document.getElementById('cancelEdit').onclick=requestCloseEditor;
document.getElementById('activeCustomerTab').onclick=()=>{customerMode='active';customerPage=1;document.getElementById('activeCustomerTab').classList.add('active');document.getElementById('archiveCustomerTab').classList.remove('active');document.getElementById('salesCustomerTitle').textContent='我的客户';loadCustomers({resetPage:true})};
document.getElementById('archiveCustomerTab').onclick=()=>{customerMode='archive';customerPage=1;document.getElementById('archiveCustomerTab').classList.add('active');document.getElementById('activeCustomerTab').classList.remove('active');document.getElementById('salesCustomerTitle').textContent='已归档客户';loadCustomers({resetPage:true})};
document.getElementById('toggleSalesFilters').onclick=()=>document.getElementById('salesFilters').hidden=!document.getElementById('salesFilters').hidden;
document.getElementById('clearSalesFilters').onclick=()=>{document.getElementById('salesStarFilter').value='';document.getElementById('salesProgressFilter').value='';document.getElementById('salesCountryFilter').value='';document.getElementById('search').value='';loadCustomers({resetPage:true})};
['salesStarFilter','salesProgressFilter','salesCountryFilter'].forEach(id=>document.getElementById(id).addEventListener('change',()=>loadCustomers({resetPage:true})));
document.getElementById('salesCountryFilter').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadCustomers({resetPage:true}),450)});
document.getElementById('search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadCustomers({resetPage:true}),450)};
document.getElementById('logoutBtn').onclick=async()=>{if(editorDirty()&&!await uiConfirm('当前有未保存内容，退出后草稿仍保留在本机。',{title:'确认退出',confirmText:'退出登录',danger:true}))return;localStorage.removeItem('mVIP_rep_username');localStorage.removeItem('mVIP_rep_display_name');location.href='./login.html'};
boot();
