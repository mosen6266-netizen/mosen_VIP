import { base44, esc, showMessage, buildFieldControl, buildGroupedFieldControls, initDateTimeControls, formatDate, downloadCsv, uiAlert, uiConfirm, uiPrompt, localDateKey, buildCustomerSearchText, readDashboardStat, adjustDashboardStat, createEntityBatch } from './base44.js';
import { customerSearchFields, ensureCustomerIndex, initGlobalSearch, runDailyMaintenance, smartCustomerSubscription, reconcileDashboardStats } from './vip-optimizations.js?v=20260929-1';
const ADMIN_HASH='78fd5f1e5a3f6eef05ab8d692942fd0ff4a8f4cc0e6087026626006a7fae452d';
let reps=[],fields=[],customers=[],progressStages=[],editingCustomerId=null,draggedFieldId=null,dragSaving=false,draggedProgressId=null,progressDragSaving=false,editingFieldTypeId=null;
let currentView='all',currentRepFilter='';
const CUSTOMER_PAGE_SIZE=50;
let customerPage=1,customerHasNext=false,totalCustomerCount=0,totalArchivedCount=0,customerCountByRep={},archivedCountByRep={},customerCountTimer=null,globalCustomerRows=null,searchTimer=null,adminEditorBaseline='',adminDraftTimer=null;
let adminCustomerFormSaving=false;
const LOG_PAGE_SIZE=100;
let logPage=1,logHasNext=false;

const loginView=document.getElementById('loginView'),appView=document.getElementById('appView'),loginNote=document.getElementById('loginNote');
const customerModal=document.getElementById('customerModal'),customerEditForm=document.getElementById('customerEditForm'),customerEditNote=document.getElementById('customerEditNote');

function unwrap(v){return Array.isArray(v)?v:(v?.items||[])}
function deepCloneValue(v){return globalThis.structuredClone?structuredClone(v):JSON.parse(JSON.stringify(v))}
async function sha256(v){const b=new TextEncoder().encode(v);const h=await crypto.subtle.digest('SHA-256',b);return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('')}

function showAdminView(view,repUsername=''){
  currentView=view;currentRepFilter=repUsername||'';
  document.querySelectorAll('.admin-view').forEach(x=>x.hidden=true);
  document.querySelectorAll('.sidebar-item').forEach(x=>x.classList.remove('active'));

  if(view==='all'||view==='rep'||view==='archive'){
    document.getElementById('view-customers').hidden=false;
    if(view==='all'){
      document.querySelector('.sidebar-item[data-view="all"]').classList.add('active');
      document.getElementById('customerViewTitle').textContent='全部客户';
      document.getElementById('customerViewDesc').textContent='显示所有业务员登记的正常客户。';
    }else if(view==='archive'){
      document.querySelector('.sidebar-item[data-view="archive"]').classList.add('active');
      document.getElementById('customerViewTitle').textContent='归档客户';
      document.getElementById('customerViewDesc').textContent='归档客户资料不会删除，可以预览、复制、恢复或由管理员永久删除。';
    }else{
      const rep=reps.find(r=>String(r.username||'')===String(repUsername));
      const btn=[...document.querySelectorAll('.sidebar-item[data-rep]')].find(x=>x.dataset.rep===repUsername);
      if(btn)btn.classList.add('active');
      const name=rep?.display_name||rep?.username||repUsername;
      document.getElementById('customerViewTitle').textContent=name+' 的客户';
      document.getElementById('customerViewDesc').textContent='只显示业务员 '+repUsername+' 登记的客户。';
    }
    customerPage=1;loadCustomers({resetPage:true});return;
  }
  if(view==='reps'){document.getElementById('view-reps').hidden=false;document.querySelector('.sidebar-item[data-view="reps"]').classList.add('active')}
  if(view==='fields'){document.getElementById('view-fields').hidden=false;document.querySelector('.sidebar-item[data-view="fields"]').classList.add('active')}
  if(view==='progress'){document.getElementById('view-progress').hidden=false;document.querySelector('.sidebar-item[data-view="progress"]').classList.add('active')}
  if(view==='workflows'){document.getElementById('view-workflows').hidden=false;document.querySelector('.sidebar-item[data-view="workflows"]').classList.add('active');const frame=document.getElementById('workflowAdminFrame');if(frame&&(!frame.src||frame.src==='about:blank'||!frame.src.includes('20260929-attachments-2')))frame.src='./workflow-admin.html?v=20260929-full-sync-13'}
  if(view==='logs'){document.getElementById('view-logs').hidden=false;document.querySelector('.sidebar-item[data-view="logs"]').classList.add('active');loadLogs()}
  if(view==='backup'){document.getElementById('view-backup').hidden=false;document.querySelector('.sidebar-item[data-view="backup"]').classList.add('active')}
}
document.querySelector('.sidebar-item[data-view="all"]').onclick=()=>showAdminView('all');
document.querySelector('.sidebar-item[data-view="archive"]').onclick=()=>showAdminView('archive');
document.querySelector('.sidebar-item[data-view="reps"]').onclick=()=>showAdminView('reps');
document.querySelector('.sidebar-item[data-view="fields"]').onclick=()=>showAdminView('fields');
document.querySelector('.sidebar-item[data-view="progress"]').onclick=()=>showAdminView('progress');
document.querySelector('.sidebar-item[data-view="workflows"]').onclick=()=>showAdminView('workflows');
document.querySelector('.sidebar-item[data-view="logs"]').onclick=()=>showAdminView('logs');
document.querySelector('.sidebar-item[data-view="backup"]').onclick=()=>showAdminView('backup');

async function enter(){
  loginView.hidden=true;appView.hidden=false;
  document.getElementById('logDate').value=new Date().toISOString().slice(0,10);
  await Promise.all([loadReps(),loadFields(),loadProgress(),loadLogs(),refreshCustomerCounts()]);
  showAdminView('all');
  try{
    let repTimer=0,fieldTimer=0,progressTimer=0,customerTimer=0,logTimer=0,statTimer=0;
    base44.entities.VIPSalesRep.subscribe(()=>{if(window.MVIP_MAINTENANCE)return;clearTimeout(repTimer);repTimer=setTimeout(()=>loadReps(),450)});
    base44.entities.VIPFormField.subscribe(()=>{if(window.MVIP_MAINTENANCE||dragSaving)return;clearTimeout(fieldTimer);fieldTimer=setTimeout(()=>{loadFields();loadCustomers()},500)});
    base44.entities.VIPProgressStage.subscribe(()=>{if(window.MVIP_MAINTENANCE||progressDragSaving)return;clearTimeout(progressTimer);progressTimer=setTimeout(()=>{loadProgress();loadCustomers()},500)});
    base44.entities.VIPCustomer.subscribe(evt=>{if(window.MVIP_MAINTENANCE)return;clearTimeout(customerTimer);customerTimer=setTimeout(()=>smartCustomerSubscription({event:evt,customers,render:renderCustomers,load:()=>loadCustomers(),refreshCounts:scheduleCustomerCountRefresh,matches:r=>((currentView==='archive')===Boolean(r.archived))&&(!currentRepFilter||String(r.rep_username||'')===String(currentRepFilter))&&matchesAdminFilters(r)}),650)});
    base44.entities.VIPDashboardStats.subscribe(()=>{if(window.MVIP_MAINTENANCE)return;clearTimeout(statTimer);statTimer=setTimeout(()=>refreshCustomerCounts(),450)});
    base44.entities.VIPActivityLog.subscribe(()=>{if(window.MVIP_MAINTENANCE)return;clearTimeout(logTimer);logTimer=setTimeout(()=>loadLogs(),650)});
  }catch(_){}
  ensureCustomerIndex(base44,{},800).catch(()=>{});
    initGlobalSearch({base44,role:'admin',onCustomer:openGlobalAdminCustomer,onWorkflow:()=>showAdminView('workflows')});
    runDailyMaintenance(base44).then(()=>refreshCustomerCounts()).catch(()=>{});
}
document.getElementById('adminLogin').onclick=async()=>{
  const p=document.getElementById('adminPassword').value;
  if(!p){showMessage(loginNote,'请输入管理员密码。','err');return}
  if(await sha256(p)!==ADMIN_HASH){showMessage(loginNote,'管理员密码错误。','err');return}
  localStorage.setItem('mVIP_admin','1');await enter()
};

async function loadReps(){
  try{
    reps=unwrap(await base44.entities.VIPSalesRep.list({sort:'-created_date',limit:500}));
    document.getElementById('salesCount').textContent=reps.length;
    const rf=document.getElementById('adminRepFilter');if(rf)rf.innerHTML='<option value="">全部业务员</option>'+reps.map(r=>'<option value="'+esc(r.username)+'">'+esc(r.display_name||r.username)+'</option>').join('');
    renderReps();renderSidebar();
  }catch(err){document.getElementById('repList').innerHTML='<div class="notice err">读取业务员失败：'+esc(err?.message||String(err))+'</div>'}
}
function renderSidebar(){
  const nav=document.getElementById('repCustomerNav');
  nav.innerHTML=reps.map(r=>{
    const count=customerCountByRep[String(r.username||'')]||0, archived=archivedCountByRep[String(r.username||'')]||0;
    const label=r.display_name||r.username||'未命名';
    return '<button class="sidebar-item" data-view="rep" data-rep="'+esc(r.username||'')+'"><span class="sidebar-avatar">'+esc(String(label).slice(0,1).toUpperCase())+'</span><span class="sidebar-text"><b>'+esc(label)+'</b><small>'+esc(r.username||'')+' · 归档 '+archived+'</small></span><span class="sidebar-count">'+count+'</span></button>';
  }).join('');
  nav.querySelectorAll('.sidebar-item[data-rep]').forEach(btn=>btn.onclick=()=>showAdminView('rep',btn.dataset.rep));
}
function renderReps(){
  const box=document.getElementById('repList');
  if(!reps.length){box.innerHTML='<div class="empty">还没有业务员用户名</div>';return}
  box.innerHTML='<div class="table-wrap"><table><thead><tr><th>用户名</th><th>显示名称</th><th>客户数</th><th>创建时间</th><th>操作</th></tr></thead><tbody>'+reps.map(r=>{
    const count=customerCountByRep[String(r.username||'')]||0;
    return '<tr><td><b>'+esc(r.username||'')+'</b></td><td>'+esc(r.display_name||'')+'</td><td>'+count+'</td><td>'+esc(formatDate(r.created_date))+'</td><td><button class="btn danger delrep" data-id="'+r.id+'">删除</button></td></tr>';
  }).join('')+'</tbody></table></div>';
  box.querySelectorAll('.delrep').forEach(b=>b.onclick=async()=>{if(!await uiConfirm('删除后这个业务员将无法继续登录。',{title:'删除业务员',confirmText:'确认删除',danger:true}))return;await base44.entities.VIPSalesRep.delete(b.dataset.id);await loadReps()})
}
document.getElementById('createRep').onclick=async()=>{
  const username=document.getElementById('repUsername').value.trim(),display_name=document.getElementById('repDisplayName').value.trim(),note=document.getElementById('repNote');
  if(!username){showMessage(note,'请输入业务员用户名。','err');return}
  try{
    const current=unwrap(await base44.entities.VIPSalesRep.list({sort:'-created_date',limit:500}));
    if(current.some(r=>String(r.username||'').toLowerCase()===username.toLowerCase())){showMessage(note,'这个用户名已经存在。','err');return}
    await base44.entities.VIPSalesRep.create({username,display_name});showMessage(note,'业务员用户名已创建：'+username,'ok');
    document.getElementById('repUsername').value='';document.getElementById('repDisplayName').value='';await loadReps()
  }catch(err){showMessage(note,'创建失败：'+(err?.message||String(err)),'err')}
};

async function loadFields(){
  try{
    fields=unwrap(await base44.entities.VIPFormField.list({sort:'order',limit:500})).sort((a,b)=>(a.order||0)-(b.order||0));
    const activeCount=fields.filter(f=>f.active!==false).length;
    document.getElementById('activeFields').textContent=activeCount;document.getElementById('sidebarFieldCount').textContent=activeCount;
    renderFields();
  }catch(err){document.getElementById('fieldList').innerHTML='<div class="notice err">读取登记字段失败：'+esc(err?.message||String(err))+'</div>'}
}
function waitMs(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
async function retryRateLimited(fn,attempts=4){
  let lastErr;
  for(let i=0;i<attempts;i++){
    try{return await fn()}catch(err){
      lastErr=err;
      const msg=String(err?.message||err||'').toLowerCase();
      if(!msg.includes('rate limit')&&!msg.includes('429'))throw err;
      if(i<attempts-1)await waitMs(500*(i+1));
    }
  }
  throw lastErr;
}
function newOrderForMovedItem(items,index){
  if(items.length<=1)return 1000;
  const prev=index>0?Number(items[index-1]?.order):null;
  const next=index<items.length-1?Number(items[index+1]?.order):null;
  if(index===0)return Number.isFinite(next)?next-1:0;
  if(index===items.length-1)return Number.isFinite(prev)?prev+1:index+1;
  if(Number.isFinite(prev)&&Number.isFinite(next))return (prev+next)/2;
  return index+1;
}
function fieldTypeLabel(type){
  return ({text:'文本',number:'数字',date:'日期时间（24小时制）',datetime:'日期时间（24小时制）',email:'邮箱',tel:'电话',textarea:'长文本',select:'下拉选项'})[type]||type||'文本';
}
function selectedFieldIds(){
  return [...document.querySelectorAll('#fieldList .field-select-checkbox:checked')].map(x=>x.value);
}
function updateFieldSelectionCount(){
  const ids=selectedFieldIds(),el=document.getElementById('fieldSelectionCount');
  el.textContent=ids.length?('已选择 '+ids.length+' 个字段'):'未选择字段';
}
function renderFields(){
  const box=document.getElementById('fieldList');
  if(!fields.length){box.innerHTML='<div class="empty">暂无登记项目</div>';updateFieldSelectionCount();return}
  box.innerHTML='<div class="field-sort-list">'+fields.map((f,i)=>'<div class="field-sort-row" draggable="true" data-id="'+f.id+'"><label class="field-select-wrap" title="选择字段"><input class="field-select-checkbox" type="checkbox" value="'+f.id+'"><span></span></label><div class="drag-handle">☰</div><div class="field-sort-name"><b>'+esc(f.label)+'</b><span>'+esc(fieldTypeLabel(f.field_type))+(f.required?' · 必填':'')+(f.group_name?' · <em class="field-group-badge">分栏：'+esc(f.group_name)+'</em>':'')+'</span></div><div class="field-sort-order">第 '+(i+1)+' 项</div><div class="row"><button class="btn soft change-type" data-id="'+f.id+'">编辑字段</button><button class="btn soft toggle" data-id="'+f.id+'" data-active="'+(f.active!==false)+'">'+(f.active===false?'启用':'停用')+'</button><button class="btn danger remove" data-id="'+f.id+'">删除</button></div></div>').join('')+'</div>';
  box.querySelectorAll('.field-select-checkbox').forEach(cb=>{cb.onclick=e=>e.stopPropagation();cb.onchange=updateFieldSelectionCount});
  box.querySelectorAll('.change-type').forEach(b=>b.onclick=e=>{e.stopPropagation();openFieldTypeModal(b.dataset.id)});
  box.querySelectorAll('.toggle').forEach(b=>b.onclick=async e=>{e.stopPropagation();await base44.entities.VIPFormField.update(b.dataset.id,{active:b.dataset.active!=='true'});await loadFields()});
  box.querySelectorAll('.remove').forEach(b=>b.onclick=async e=>{e.stopPropagation();if(!await uiConfirm('删除后该登记字段将不再显示，请确认是否继续。',{title:'删除登记字段',confirmText:'确认删除',danger:true}))return;await base44.entities.VIPFormField.delete(b.dataset.id);await loadFields()});
  box.querySelectorAll('.field-sort-row').forEach(row=>{
    row.ondragstart=e=>{if(e.target.closest('.field-select-wrap')){e.preventDefault();return}draggedFieldId=row.dataset.id;row.classList.add('dragging');e.dataTransfer.effectAllowed='move'};
    row.ondragend=()=>{row.classList.remove('dragging');draggedFieldId=null};
    row.ondragover=e=>e.preventDefault();
    row.ondrop=async e=>{e.preventDefault();if(!draggedFieldId||draggedFieldId===row.dataset.id)return;const movedId=draggedFieldId,from=fields.findIndex(x=>x.id===movedId),to=fields.findIndex(x=>x.id===row.dataset.id);if(from<0||to<0)return;const next=[...fields],m=next.splice(from,1)[0];next.splice(to,0,m);fields=next;const newOrder=newOrderForMovedItem(fields,to);m.order=newOrder;renderFields();await saveFieldOrder(movedId,newOrder)}
  });
  updateFieldSelectionCount();
}
function openFieldTypeModal(id){
  const field=fields.find(x=>String(x.id)===String(id));if(!field)return;
  editingFieldTypeId=field.id;
  document.getElementById('fieldTypeFieldName').value=field.label||'';
  document.getElementById('changeFieldType').value=field.field_type||'text';
  document.getElementById('changeFieldOptions').value=field.options||'';
  document.getElementById('changeFieldOptionsWrap').hidden=(field.field_type!=='select');
  document.getElementById('fieldTypeNote').hidden=true;
  document.getElementById('fieldTypeModal').hidden=false;
}
function closeFieldTypeModal(){
  editingFieldTypeId=null;
  document.getElementById('fieldTypeModal').hidden=true;
}
document.getElementById('changeFieldType').onchange=e=>{
  document.getElementById('changeFieldOptionsWrap').hidden=(e.target.value!=='select');
};
document.getElementById('closeFieldTypeModal').onclick=closeFieldTypeModal;
document.getElementById('cancelFieldType').onclick=closeFieldTypeModal;
document.getElementById('fieldTypeModal').onclick=e=>{if(e.target.id==='fieldTypeModal')closeFieldTypeModal()};
document.getElementById('saveFieldType').onclick=async()=>{
  const note=document.getElementById('fieldTypeNote'),label=document.getElementById('fieldTypeFieldName').value.trim(),type=document.getElementById('changeFieldType').value,options=document.getElementById('changeFieldOptions').value.trim();
  if(!editingFieldTypeId)return;
  if(!label){showMessage(note,'字段名称不能为空。','err');return}
  if(type==='select'&&!options){showMessage(note,'下拉选项不能为空。','err');return}
  try{
    await base44.entities.VIPFormField.update(editingFieldTypeId,{label,field_type:type,options:type==='select'?options:''});
    showMessage(note,'字段名称和类型已更新。','ok');
    await loadFields();
    setTimeout(closeFieldTypeModal,250);
  }catch(err){showMessage(note,'修改失败：'+(err?.message||String(err)),'err')}
};
function closeFieldGroupModal(){
  document.getElementById('fieldGroupModal').hidden=true;
  document.getElementById('fieldGroupNote').hidden=true;
}
document.getElementById('setFieldGroup').onclick=()=>{
  const ids=selectedFieldIds(),note=document.getElementById('fieldNote');
  if(!ids.length){showMessage(note,'请先勾选要放进同一栏的登记字段。','err');return}
  const chosen=fields.filter(f=>ids.includes(String(f.id)));
  const groups=[...new Set(chosen.map(f=>String(f.group_name||'').trim()).filter(Boolean))];
  document.getElementById('fieldGroupName').value=groups.length===1?groups[0]:'';
  document.getElementById('fieldGroupModal').hidden=false;
  document.getElementById('fieldGroupNote').hidden=true;
};
document.getElementById('closeFieldGroupModal').onclick=closeFieldGroupModal;
document.getElementById('cancelFieldGroup').onclick=closeFieldGroupModal;
document.getElementById('fieldGroupModal').onclick=e=>{if(e.target.id==='fieldGroupModal')closeFieldGroupModal()};
document.getElementById('saveFieldGroup').onclick=async()=>{
  const ids=selectedFieldIds(),name=document.getElementById('fieldGroupName').value.trim(),note=document.getElementById('fieldGroupNote');
  if(!ids.length){showMessage(note,'没有选择字段。','err');return}
  if(!name){showMessage(note,'请输入分栏名称。','err');return}
  try{
    for(const id of ids){await retryRateLimited(()=>base44.entities.VIPFormField.update(id,{group_name:name}));await waitMs(90)}
    showMessage(note,'分栏已保存。','ok');await loadFields();setTimeout(closeFieldGroupModal,250);
  }catch(err){showMessage(note,'保存分栏失败：'+(err?.message||String(err)),'err')}
};
document.getElementById('removeFieldGroup').onclick=async()=>{
  const ids=selectedFieldIds(),note=document.getElementById('fieldNote');
  if(!ids.length){showMessage(note,'请先勾选要移出分栏的字段。','err');return}
  try{
    for(const id of ids){await retryRateLimited(()=>base44.entities.VIPFormField.update(id,{group_name:''}));await waitMs(90)}
    showMessage(note,'所选字段已移出分栏。','ok');await loadFields();
  }catch(err){showMessage(note,'移出分栏失败：'+(err?.message||String(err)),'err')}
};

async function saveFieldOrder(movedId,newOrder){
  const note=document.getElementById('fieldNote');dragSaving=true;
  try{
    await retryRateLimited(()=>base44.entities.VIPFormField.update(movedId,{order:newOrder}));
    showMessage(note,'排序已保存。','ok');
  }catch(err){
    showMessage(note,'保存排序失败：'+(err?.message||String(err)),'err');
    await waitMs(800);
    await loadFields();
  }finally{dragSaving=false}
}
document.getElementById('addField').onclick=async()=>{
  const label=document.getElementById('fieldLabel').value.trim(),type=document.getElementById('fieldType').value,options=document.getElementById('fieldOptions').value.trim(),required=document.getElementById('fieldRequired').value==='true',note=document.getElementById('fieldNote');
  if(!label){showMessage(note,'请输入字段名称。','err');return}
  try{
    const nextOrder=fields.length?Math.max(...fields.map(f=>Number(f.order)||0))+1:1;
    await base44.entities.VIPFormField.create({label,field_key:'f_'+Date.now(),field_type:type,options,required,order:nextOrder,active:true});
    showMessage(note,'字段已添加。','ok');document.getElementById('fieldLabel').value='';document.getElementById('fieldOptions').value='';await loadFields()
  }catch(err){showMessage(note,'添加失败：'+(err?.message||'未知错误'),'err')}
};

async function loadProgress(){
  try{
    progressStages=unwrap(await base44.entities.VIPProgressStage.list({sort:'order',limit:500})).filter(x=>x.active!==false).sort((a,b)=>(a.order||0)-(b.order||0));
    document.getElementById('sidebarProgressCount').textContent=progressStages.length;const pf=document.getElementById('adminProgressFilter');if(pf)pf.innerHTML='<option value="">全部进度</option>'+progressStages.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.label)+'</option>').join('');renderProgress();
  }catch(err){document.getElementById('progressList').innerHTML='<div class="notice err">读取客户进度失败：'+esc(err?.message||String(err))+'</div>'}
}
function renderProgress(){
  const box=document.getElementById('progressList');
  if(!progressStages.length){box.innerHTML='<div class="empty">还没有客户进度，先添加一个。</div>';return}
  box.innerHTML='<div class="field-sort-list">'+progressStages.map((p,i)=>'<div class="field-sort-row progress-sort-row" draggable="true" data-id="'+p.id+'"><div class="drag-handle">☰</div><div class="field-sort-name"><input class="progress-name-input" data-id="'+p.id+'" value="'+esc(p.label)+'"><span>第 '+(i+1)+' 步</span></div><div class="field-sort-order">'+(i+1)+'</div><div class="row"><button class="btn soft save-progress" data-id="'+p.id+'">保存名称</button><button class="btn danger delete-progress" data-id="'+p.id+'">删除</button></div></div>').join('')+'</div>';
  box.querySelectorAll('.save-progress').forEach(b=>b.onclick=async()=>{const input=box.querySelector('.progress-name-input[data-id="'+b.dataset.id+'"]');const label=input.value.trim();if(!label)return;await base44.entities.VIPProgressStage.update(b.dataset.id,{label});await loadProgress()});
  box.querySelectorAll('.delete-progress').forEach(b=>b.onclick=async()=>{if(!await uiConfirm('已有客户的历史勾选不会再显示这个步骤。',{title:'删除客户进度',confirmText:'确认删除',danger:true}))return;await base44.entities.VIPProgressStage.delete(b.dataset.id);await loadProgress()});
  box.querySelectorAll('.progress-sort-row').forEach(row=>{
    row.ondragstart=e=>{draggedProgressId=row.dataset.id;row.classList.add('dragging');e.dataTransfer.effectAllowed='move'};
    row.ondragend=()=>{row.classList.remove('dragging');draggedProgressId=null};
    row.ondragover=e=>e.preventDefault();
    row.ondrop=async e=>{e.preventDefault();if(!draggedProgressId||draggedProgressId===row.dataset.id)return;const movedId=draggedProgressId,from=progressStages.findIndex(x=>x.id===movedId),to=progressStages.findIndex(x=>x.id===row.dataset.id);if(from<0||to<0)return;const next=[...progressStages],m=next.splice(from,1)[0];next.splice(to,0,m);progressStages=next;const newOrder=newOrderForMovedItem(progressStages,to);m.order=newOrder;renderProgress();await saveProgressOrder(movedId,newOrder)}
  });
}
async function saveProgressOrder(movedId,newOrder){
  const note=document.getElementById('progressNote');progressDragSaving=true;
  try{
    await retryRateLimited(()=>base44.entities.VIPProgressStage.update(movedId,{order:newOrder}));
    showMessage(note,'进度顺序已保存。','ok');
  }catch(err){
    showMessage(note,'进度排序保存失败：'+(err?.message||String(err)),'err');
    await waitMs(800);
    await loadProgress();
  }finally{progressDragSaving=false}
}
document.getElementById('addProgress').onclick=async()=>{
  const label=document.getElementById('progressLabel').value.trim(),note=document.getElementById('progressNote');if(!label){showMessage(note,'请输入进度名称。','err');return}
  try{const nextOrder=progressStages.length?Math.max(...progressStages.map(p=>Number(p.order)||0))+1:1;await base44.entities.VIPProgressStage.create({label,order:nextOrder,active:true});document.getElementById('progressLabel').value='';showMessage(note,'进度已添加。','ok');await loadProgress()}
  catch(err){showMessage(note,'添加失败：'+(err?.message||String(err)),'err')}
};

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
  const active=fields.filter(f=>f.active!==false).sort((a,b)=>(a.order||0)-(b.order||0));
  const s=progressStats(row);
  const repOptions=['<option value="">未指定</option>',...reps.map(r=>'<option value="'+esc(r.username)+'" '+(String(row.rep_username||'')===String(r.username||'')?'selected':'')+'>'+esc(r.display_name||r.username)+' ('+esc(r.username)+')</option>')].join('');
  const done=new Set((row.completed_progress_ids||[]).map(String));
  const progressHtml=progressStages.length?progressStages.map((p,i)=>'<label class="progress-check '+(done.has(String(p.id))?'checked':'')+'"><input type="checkbox" data-preview-progress-id="'+p.id+'" '+(done.has(String(p.id))?'checked':'')+'><span class="progress-check-index">'+(i+1)+'</span><span class="progress-check-label">'+esc(p.label)+'</span><span class="progress-check-mark">✓</span></label>').join(''):'<div class="progress-empty">管理员还没有设置客户进度。</div>';
  return '<div class="preview-panel-head"><div><div class="preview-title">客户完整信息</div><div class="preview-subtitle">可直接编辑资料、业务员归属和客户进度</div></div><div class="row"><button class="btn soft preview-workflow-btn" type="button">维权流程</button><button class="btn soft preview-copy-btn" type="button">复制资料</button><button class="preview-close-btn" type="button">关闭</button></div></div><div class="preview-meta-row"><div class="field"><label>所属业务员</label><select data-preview-rep>'+repOptions+'</select></div><div class="preview-readonly"><span>登记时间</span><b>'+esc(formatDate(row.created_date)||'—')+'</b></div></div><div class="preview-editor-grid">'+buildGroupedFieldControls(active,row.data||{})+'</div><div class="preview-progress-block preview-progress-edit"><div class="preview-progress-head"><b>客户进度</b><strong data-preview-percent style="color:'+s.solid+'">'+s.percent+'%</strong></div><div class="percent-progress"><span data-preview-bar style="width:'+s.percent+'%;background:'+s.solid+'"></span></div><div class="preview-progress-meta" data-preview-meta>已完成 '+s.completed+' / '+s.total+' 项</div><div class="progress-checklist preview-progress-checklist">'+progressHtml+'</div></div><div data-vip-inline-host hidden></div><div class="preview-save-bar"><div class="notice" data-preview-note hidden></div><div class="spacer"></div><button class="btn primary preview-save-btn" type="button">保存修改</button></div>';
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
function attachAdminPreviewEditor(portal,row){
  portal.querySelector('.preview-close-btn')?.addEventListener('click',()=>{portal.dataset.pinned='0';portal.hidden=true;portal.innerHTML=''});
  portal.querySelector('.preview-workflow-btn')?.addEventListener('click',()=>{const host=portal.querySelector('[data-vip-inline-host]');if(!host)return;if(!host.hidden){host.hidden=true;host.innerHTML='';return}window.MosenVIPWorkflow?.mount(host,row.id,fixedCustomerValue(row,'f_customer_name')||'未命名客户')});
  portal.querySelector('.preview-copy-btn')?.addEventListener('click',()=>copyAdminCustomer(row));
  portal.querySelectorAll('[data-preview-progress-id]').forEach(cb=>cb.onchange=()=>{cb.closest('.progress-check').classList.toggle('checked',cb.checked);updatePreviewProgressUI(portal)});
  portal.querySelector('.preview-save-btn')?.addEventListener('click',async()=>{
    const note=portal.querySelector('[data-preview-note]'),btn=portal.querySelector('.preview-save-btn');
    if(!btn||btn.dataset.saving==='1')return;
    btn.dataset.saving='1';
    const originalText=btn.textContent;
    btn.disabled=true;btn.textContent='保存中…';btn.setAttribute('aria-busy','true');
    const data={...(row.data||{})};portal.querySelectorAll('[data-key]').forEach(el=>data[el.dataset.key]=el.value);
    const completed_progress_ids=[...portal.querySelectorAll('[data-preview-progress-id]:checked')].map(x=>x.dataset.previewProgressId);
    const rep_username=portal.querySelector('[data-preview-rep]')?.value||'';
    showMessage(note,'正在保存…');
    try{
      await base44.entities.VIPCustomer.update(row.id,{rep_username,data,completed_progress_ids,admin_sort_score:completed_progress_ids.length,...customerSearchFields(rep_username,data)});
      if(String(rep_username)!==String(row.rep_username||'')){
        const active=row.archived!==true?1:0,archived=row.archived===true?1:0,today=(active&&localDateKey(row.created_date)===localDateKey())?1:0;
        await Promise.all([
          adjustDashboardStat('rep:'+String(row.rep_username||''),{active_customers:-active,archived_customers:-archived,today_active_customers:-today},{scope:'rep',rep_username:String(row.rep_username||'')}),
          adjustDashboardStat('rep:'+rep_username,{active_customers:active,archived_customers:archived,today_active_customers:today},{scope:'rep',rep_username})
        ]);
      }
      row.rep_username=rep_username;row.data=data;row.completed_progress_ids=completed_progress_ids;
      showMessage(note,'已保存并同步。','ok');
      await loadCustomers();
      const fresh=customers.find(x=>String(x.id)===String(row.id))||row;
      portal.innerHTML=previewCard(fresh);initDateTimeControls(portal);portal.hidden=false;portal.dataset.pinned='1';attachAdminPreviewEditor(portal,fresh);
      const newNote=portal.querySelector('[data-preview-note]');showMessage(newNote,'已保存并同步。','ok');
    }catch(err){
      btn.dataset.saving='0';btn.disabled=false;btn.textContent=originalText;btn.removeAttribute('aria-busy');
      showMessage(note,'保存失败：'+(err?.message||String(err)),'err');
    }
  });
}
function openGlobalAdminCustomer(row){
  if(!row)return;
  showAdminView('all');
  const portal=getPreviewPortal();
  portal.innerHTML=previewCard(row);
  initDateTimeControls(portal);
  portal.hidden=false;
  portal.dataset.pinned='1';
  attachAdminPreviewEditor(portal,row);
}
function bindPreviewHover(container){
  const portal=getPreviewPortal();let timer;
  const keep=()=>clearTimeout(timer);
  const hideLater=()=>{clearTimeout(timer);if(portal.dataset.pinned!=='1'){portal.hidden=true;portal.innerHTML=''}};
  portal.onmouseenter=keep;portal.onmouseleave=hideLater;
  container.querySelectorAll('.preview-wrap').forEach(w=>{
    const findRow=()=>customers.find(x=>String(x.id)===String(w.dataset.id));
    const open=(pin=false)=>{keep();const row=findRow();if(!row)return;portal.innerHTML=previewCard(row);initDateTimeControls(portal);portal.hidden=false;portal.dataset.pinned=pin?'1':'0';attachAdminPreviewEditor(portal,row)};
    w.onmouseenter=()=>open(false);w.onmouseleave=hideLater;
    w.querySelector('.eye-btn')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();open(true)});
  });
}

function updateAdminEditProgressSummary(){
  const total=progressStages.length;
  const checked=[...document.querySelectorAll('#adminProgressChecklist input[type="checkbox"]:checked')].length;
  const percent=total?Math.round(checked/total*100):0;
  const pseudo={completed_progress_ids:[...document.querySelectorAll('#adminProgressChecklist input[type="checkbox"]:checked')].map(x=>x.dataset.progressId)};
  const s=progressStats(pseudo);
  document.getElementById('adminEditProgressPercent').textContent=percent+'%';
  document.getElementById('adminEditProgressPercent').style.color=s.solid;
  const bar=document.getElementById('adminEditProgressBar');bar.style.width=percent+'%';bar.style.background=s.solid;
}
function renderAdminProgressChecklist(completed=[]){
  const done=new Set((completed||[]).map(String)),box=document.getElementById('adminProgressChecklist');
  if(!progressStages.length){box.innerHTML='<div class="progress-empty">还没有设置客户进度。</div>';updateAdminEditProgressSummary();return}
  box.innerHTML=progressStages.map((p,i)=>'<label class="progress-check '+(done.has(String(p.id))?'checked':'')+'"><input type="checkbox" data-progress-id="'+p.id+'" '+(done.has(String(p.id))?'checked':'')+'><span class="progress-check-index">'+(i+1)+'</span><span class="progress-check-label">'+esc(p.label)+'</span><span class="progress-check-mark">✓</span></label>').join('');
  box.querySelectorAll('input[type="checkbox"]').forEach(cb=>cb.onchange=()=>{cb.closest('.progress-check').classList.toggle('checked',cb.checked);updateAdminEditProgressSummary()});
  updateAdminEditProgressSummary();
}

function localLogDate(value){
  if(!value)return '';
  const d=new Date(value);if(Number.isNaN(d.getTime()))return String(value).slice(0,10);
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
  return y+'-'+m+'-'+day;
}
function localLogTime(value){
  if(!value)return '';
  const d=new Date(value);if(Number.isNaN(d.getTime()))return String(value).replace('T',' ').slice(0,16);
  return d.toLocaleString('zh-CN',{hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
let activityLogs=[];
function renderLogPager(){
  const box=document.getElementById('logPager');if(!box)return;
  box.innerHTML='<div class="customer-pager-info">第 <b>'+logPage+'</b> 页 · 每页 '+LOG_PAGE_SIZE+' 条</div><div class="customer-pager-actions"><button id="logPrevPage" class="btn soft" '+(logPage<=1?'disabled':'')+'>上一页</button><button id="logNextPage" class="btn soft" '+(!logHasNext?'disabled':'')+'>下一页</button></div>';
  document.getElementById('logPrevPage')?.addEventListener('click',()=>{if(logPage>1){logPage--;loadLogs()}});
  document.getElementById('logNextPage')?.addEventListener('click',()=>{if(logHasNext){logPage++;loadLogs()}});
}
function logServerQuery(){
  const date=document.getElementById('logDate')?.value||localDateKey();
  const q=(document.getElementById('logSearch')?.value||'').trim();
  const query={event_day:date};
  if(q){
    const rx={$regex:adminRegexEscape(q),$options:'i'};
    query.$or=[{actor_display_name:rx},{actor_username:rx},{customer_name:rx},{message:rx},{target_label:rx}];
  }
  return query;
}
async function loadLogs(reset=false){
  const box=document.getElementById('logList');if(!box)return;
  if(reset)logPage=1;
  try{
    const skip=(logPage-1)*LOG_PAGE_SIZE;
    const selectedDate=document.getElementById('logDate')?.value||localDateKey();
    const archiveCutoff=new Date(Date.now()-90*86400000).toISOString().slice(0,10);
    const usingArchive=selectedDate<archiveCutoff;
    const logEntity=usingArchive?base44.entities.VIPActivityLogArchive:base44.entities.VIPActivityLog;
    const query=logServerQuery();
    if(!usingArchive)query.migration_duplicate={$ne:true};
    let rows=unwrap(await logEntity.filter(query,'-event_time',LOG_PAGE_SIZE+1,skip));
    logHasNext=rows.length>LOG_PAGE_SIZE;
    activityLogs=rows.slice(0,LOG_PAGE_SIZE);
    document.getElementById('sidebarLogCount').textContent=logHasNext?(LOG_PAGE_SIZE+'+'):String(activityLogs.length);
    if(!activityLogs.length){box.innerHTML='<div class="empty">这一天暂无匹配日志</div>';renderLogPager();return}
    box.innerHTML='<div class="activity-list">'+activityLogs.map(x=>'<div class="activity-item"><div class="activity-time">'+esc(localLogTime(x.event_time||x.created_date))+'</div><div class="activity-body"><div class="activity-title">'+esc(x.message||'')+'</div><div class="activity-meta">'+esc(x.actor_display_name||x.actor_username||'未知业务员')+(x.customer_name?' · '+esc(x.customer_name):'')+(x.target_label?' · '+esc(x.target_label):'')+'</div></div></div>').join('')+'</div>';
    renderLogPager();
  }catch(err){box.innerHTML='<div class="notice err">读取日志失败：'+esc(err?.message||String(err))+'</div>'}
}
const FULL_BACKUP_FORMAT='MOSEN_VIP_FULL_BACKUP';
const FULL_BACKUP_VERSION=4;
const VIP_REPO_OWNER='mosen6266-netizen';
const VIP_REPO_NAME='mosen_VIP';
const VIP_REPO_BRANCH='main';
const BACKUP_ENTITY_NAMES=['VIPSalesRep','VIPFormField','VIPProgressStage','VIPCustomer','VIPActivityLog','VIPWorkflowDefinition','VIPWorkflowProgress','VIPWorkflowFlowProgress','VIPToolCatalog','VIPDashboardStats','VIPSystemStats','VIPActivityLogArchive','VIPAssetIndex'];

async function getAllEntityRecords(entityName){
  const all=[];let skip=0;
  while(true){
    const part=unwrap(await base44.entities[entityName].list({sort:'created_date',limit:500,skip}));
    all.push(...part);
    if(part.length<500)break;
    skip+=500;
    if(skip>50000)throw new Error(entityName+' 数据量异常，已停止备份');
  }
  return all;
}

function stripSystemFields(row){
  const x={...row};
  ['id','created_date','updated_date','created_by_id','is_sample'].forEach(k=>delete x[k]);
  return x;
}
function backupRow(row){return {...stripSystemFields(row),__old_id:row.id}}

async function collectBackupEntities(){
  const rows=await Promise.all(BACKUP_ENTITY_NAMES.map(name=>getAllEntityRecords(name)));
  return {
    VIPSalesRep:rows[0].map(backupRow),
    VIPFormField:rows[1].map(backupRow),
    VIPProgressStage:rows[2].map(backupRow),
    VIPCustomer:rows[3].map(backupRow),
    VIPActivityLog:rows[4].filter(x=>x.migration_duplicate!==true).map(backupRow),
    VIPWorkflowDefinition:rows[5].map(backupRow),
    VIPWorkflowProgress:rows[6].map(backupRow),
    VIPWorkflowFlowProgress:rows[7].map(backupRow),
    VIPToolCatalog:rows[8].map(backupRow),
    VIPDashboardStats:rows[9].map(backupRow),
    VIPSystemStats:rows[10].map(backupRow),
    VIPActivityLogArchive:rows[11].map(backupRow),
    VIPAssetIndex:rows[12].map(backupRow)
  };
}

function backupCounts(entities,repository){
  return {
    sales_reps:(entities.VIPSalesRep||entities.SalesRep||[]).length,
    form_fields:(entities.VIPFormField||entities.FormField||[]).length,
    progress_stages:(entities.VIPProgressStage||entities.ProgressStage||[]).length,
    customers:(entities.VIPCustomer||entities.Customer||[]).length,
    activity_logs:(entities.VIPActivityLog||entities.ActivityLog||[]).length,
    archived_activity_logs:(entities.VIPActivityLogArchive||[]).length,
    asset_index:(entities.VIPAssetIndex||[]).length,
    workflow_definitions:(entities.VIPWorkflowDefinition||[]).length,
    workflow_progress:(entities.VIPWorkflowProgress||[]).length,
    workflow_flow_progress:(entities.VIPWorkflowFlowProgress||[]).length,
    tool_catalog:(entities.VIPToolCatalog||[]).length,
    dashboard_stats:(entities.VIPDashboardStats||[]).length,
    system_stats:(entities.VIPSystemStats||[]).length,
    toolbox_files:(repository?.toolbox_files||[]).length
  };
}

function bytesToBase64(bytes){
  let out='';
  const step=0x8000;
  for(let i=0;i<bytes.length;i+=step)out+=String.fromCharCode(...bytes.subarray(i,Math.min(i+step,bytes.length)));
  return btoa(out);
}
function base64ToBytes(base64){
  const bin=atob(base64),out=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);
  return out;
}

async function githubPublicJson(path){
  const r=await fetch('https://api.github.com/repos/'+VIP_REPO_OWNER+'/'+VIP_REPO_NAME+path,{headers:{Accept:'application/vnd.github+json'},cache:'no-store'});
  if(!r.ok)throw new Error('读取 GitHub 仓库失败：HTTP '+r.status);
  return r.json();
}
async function collectToolboxSnapshot(note){
  if(note)showMessage(note,'正在备份工具中心全部工具、模板、排序和配置…','warn');
  const tree=await githubPublicJson('/git/trees/'+encodeURIComponent(VIP_REPO_BRANCH)+'?recursive=1');
  const files=(tree.tree||[]).filter(x=>x.type==='blob'&&String(x.path||'').startsWith('toolbox/')).map(x=>({path:x.path,size:x.size||0,sha:x.sha||''}));
  const result=new Array(files.length);
  let next=0,done=0;
  async function worker(){
    while(true){
      const idx=next++;if(idx>=files.length)return;
      const file=files[idx];
      const raw='https://raw.githubusercontent.com/'+VIP_REPO_OWNER+'/'+VIP_REPO_NAME+'/'+VIP_REPO_BRANCH+'/'+file.path.split('/').map(encodeURIComponent).join('/');
      const r=await fetch(raw+'?v='+Date.now(),{cache:'no-store'});
      if(!r.ok)throw new Error('读取工具中心文件失败：'+file.path+'（HTTP '+r.status+'）');
      const bytes=new Uint8Array(await r.arrayBuffer());
      result[idx]={path:file.path,mode:'100644',size:bytes.length,sha:file.sha,encoding:'base64',content:bytesToBase64(bytes)};
      done++;
      if(note&&done%8===0)showMessage(note,'正在备份工具中心文件 '+done+' / '+files.length+'…','warn');
    }
  }
  await Promise.all(Array.from({length:Math.min(5,Math.max(1,files.length))},()=>worker()));
  return {
    owner:VIP_REPO_OWNER,
    repo:VIP_REPO_NAME,
    branch:VIP_REPO_BRANCH,
    captured_at:new Date().toISOString(),
    toolbox_files:result
  };
}

async function makeBackupObject(note){
  if(note)showMessage(note,'正在读取全部客户、业务员、登记字段、进度、日志和话术数据…','warn');
  const entities=await collectBackupEntities();
  const repository=await collectToolboxSnapshot(note);
  const payload={entities,repository};
  const checksum=await sha256(JSON.stringify(payload));
  return {
    format:FULL_BACKUP_FORMAT,
    version:FULL_BACKUP_VERSION,
    exported_at:new Date().toISOString(),
    checksum_sha256:checksum,
    counts:backupCounts(entities,repository),
    compatibility:{
      standalone_vip:true,
      includes_all_cloud_entities:true,
      includes_workflow_definitions:true,
      includes_per_customer_workflow_progress:true,
      includes_toolbox_files:true,
      includes_tool_order:true,
      includes_tool_access_config:true,
      includes_templates:true,
      supports_dynamic_fields:true,
      supports_date_and_datetime:true,
      supports_select_options:true,
      supports_progress_mapping:true,
      supports_activity_logs:true,
      supports_field_groups:true
    },
    entities,
    repository
  };
}

function downloadBackupObject(backup,filename){
  const blob=new Blob([JSON.stringify(backup)],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=filename;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),3000);
}

async function exportFullBackup(){
  const note=document.getElementById('backupNote');
  try{
    const backup=await makeBackupObject(note);
    downloadBackupObject(backup,'mosen_VIP-完整系统备份-V4-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
    const n=backup.counts;
    showMessage(note,
      '完整备份已导出：业务员 '+n.sales_reps+
      '、登记字段 '+n.form_fields+
      '、客户进度 '+n.progress_stages+
      '、客户 '+n.customers+
      '、日志 '+n.activity_logs+
      '、话术配置 '+n.workflow_definitions+
      '、客户话术进度 '+n.workflow_progress+
      '、工具中心文件 '+n.toolbox_files+'。已生成完整性校验码。',
      'ok'
    );
  }catch(err){
    showMessage(note,'备份失败：'+(err?.message||String(err)),'err');
  }
}

async function wipeEntity(entityName){
  while(true){
    const rows=unwrap(await base44.entities[entityName].list({limit:500}));
    if(!rows.length)break;
    for(const row of rows)await base44.entities[entityName].delete(row.id);
  }
}
function withoutOldId(row){const x={...row};delete x.__old_id;return x}
function createdId(result){
  return result?.id||result?.data?.id||result?.entity?.id||
    result?.[0]?.id||result?.items?.[0]?.id||result?.data?.[0]?.id||'';
}
function normalizeLegacyEntities(e){
  if(e.VIPSalesRep)return e;
  return {
    VIPSalesRep:e.SalesRep||[],
    VIPFormField:e.FormField||[],
    VIPProgressStage:e.ProgressStage||[],
    VIPCustomer:e.Customer||[],
    VIPActivityLog:e.ActivityLog||[],
    VIPWorkflowDefinition:e.VIPWorkflowDefinition||[],
    VIPWorkflowProgress:e.VIPWorkflowProgress||[],
    VIPWorkflowFlowProgress:e.VIPWorkflowFlowProgress||[],
    VIPToolCatalog:e.VIPToolCatalog||[],
    VIPDashboardStats:e.VIPDashboardStats||[],
    VIPSystemStats:e.VIPSystemStats||[]
  };
}

function validateBackupStructure(raw){
  const isV4=raw?.format===FULL_BACKUP_FORMAT&&Number(raw?.version)>=4;
  const isLegacy=raw?.format==='MOSEN717_FULL_BACKUP'&&raw?.entities;
  if(!isV4&&!isLegacy)throw new Error('这不是有效的 MOSEN VIP 完整备份文件');

  const e=normalizeLegacyEntities(raw.entities||{});
  for(const name of ['VIPSalesRep','VIPFormField','VIPProgressStage','VIPCustomer','VIPActivityLog']){
    if(!Array.isArray(e[name]))throw new Error('备份文件缺少 '+name+' 数据表');
  }
  if(isV4){
    if(!Array.isArray(e.VIPWorkflowDefinition))throw new Error('备份缺少话术定义');
    if(!Array.isArray(e.VIPWorkflowProgress))throw new Error('备份缺少客户话术进度');
    if(!Array.isArray(raw.repository?.toolbox_files))throw new Error('备份缺少工具中心文件');
  }

  const allowedTypes=new Set(['text','number','date','datetime','email','tel','textarea','select']);
  const fieldKeys=new Set();
  for(const f of e.VIPFormField){
    if(!f.field_key)throw new Error('存在缺少 field_key 的登记字段');
    if(fieldKeys.has(String(f.field_key)))throw new Error('登记字段 key 重复：'+f.field_key);
    fieldKeys.add(String(f.field_key));
    if(!allowedTypes.has(String(f.field_type||'')))throw new Error('不支持的字段类型：'+String(f.field_type));
  }
  for(const p of e.VIPProgressStage){
    if(!p.__old_id)throw new Error('客户进度缺少原始 ID，无法安全恢复勾选关系');
  }
  for(const cust of e.VIPCustomer){
    if(cust.data!=null&&(typeof cust.data!=='object'||Array.isArray(cust.data)))throw new Error('客户动态资料格式不正确');
    if(cust.completed_progress_ids!=null&&!Array.isArray(cust.completed_progress_ids))throw new Error('客户进度勾选数据格式不正确');
  }
  return {isV4,entities:e};
}

async function validateBackupChecksum(raw){
  const version=Number(raw.version||1);
  if(version>=4&&raw.format===FULL_BACKUP_FORMAT){
    if(!raw.checksum_sha256)throw new Error('V4 备份缺少完整性校验码');
    const actual=await sha256(JSON.stringify({entities:raw.entities,repository:raw.repository}));
    if(actual!==raw.checksum_sha256)throw new Error('备份完整性校验失败：文件可能已损坏或被修改');
  }else if(version>=2){
    if(!raw.checksum_sha256)throw new Error('旧版备份缺少完整性校验码');
    const actual=await sha256(JSON.stringify(raw.entities));
    if(actual!==raw.checksum_sha256)throw new Error('备份完整性校验失败：文件可能已损坏或被修改');
  }
}

async function restoreEntities(entities,workflowAssetUrlMap={}){
  const e=normalizeLegacyEntities(entities);

  for(const row of e.VIPSalesRep||[])await base44.entities.VIPSalesRep.create(withoutOldId(row));
  for(const row of e.VIPFormField||[])await base44.entities.VIPFormField.create(withoutOldId(row));

  const progressMap={};
  for(const row of e.VIPProgressStage||[]){
    const old=row.__old_id;
    const created=await base44.entities.VIPProgressStage.create(withoutOldId(row));
    const id=createdId(created);
    if(old&&id)progressMap[String(old)]=String(id);
  }
  if(Object.keys(progressMap).length!==(e.VIPProgressStage||[]).length){
    const restored=unwrap(await base44.entities.VIPProgressStage.list({sort:'order',limit:500})).sort((a,b)=>(a.order||0)-(b.order||0));
    const original=[...(e.VIPProgressStage||[])].sort((a,b)=>(a.order||0)-(b.order||0));
    original.forEach((row,i)=>{if(row.__old_id&&restored[i]?.id)progressMap[String(row.__old_id)]=String(restored[i].id)});
  }

  const customerMap={};
  for(const row of e.VIPCustomer||[]){
    const old=row.__old_id,clean=withoutOldId(row);
    clean.data=(clean.data&&typeof clean.data==='object')?clean.data:{};
    clean.completed_progress_ids=(clean.completed_progress_ids||[]).map(id=>progressMap[String(id)]||'').filter(Boolean);
    const created=await base44.entities.VIPCustomer.create(clean);
    const cid=createdId(created);
    if(old&&cid)customerMap[String(old)]=String(cid);
  }

  for(const row of e.VIPActivityLog||[]){
    const clean=withoutOldId(row);
    if(clean.customer_id&&customerMap[String(clean.customer_id)])clean.customer_id=customerMap[String(clean.customer_id)];
    if(clean.action_type?.startsWith('progress_')&&clean.target_key&&progressMap[String(clean.target_key)])clean.target_key=progressMap[String(clean.target_key)];
    await base44.entities.VIPActivityLog.create(clean);
  }
  for(const row of e.VIPActivityLogArchive||[]){
    const clean=withoutOldId(row);
    if(clean.customer_id&&customerMap[String(clean.customer_id)])clean.customer_id=customerMap[String(clean.customer_id)];
    if(clean.action_type?.startsWith('progress_')&&clean.target_key&&progressMap[String(clean.target_key)])clean.target_key=progressMap[String(clean.target_key)];
    await base44.entities.VIPActivityLogArchive.create(clean);
  }

  for(const row of e.VIPWorkflowDefinition||[]){
    const clean=withoutOldId(row);
    if(clean.bundle&&workflowAssetUrlMap&&Object.keys(workflowAssetUrlMap).length){
      clean.bundle=deepCloneValue(clean.bundle);
      for(const flow of clean.bundle.workflows||[]){
        for(const step of flow.steps||[]){
          for(const att of step.attachments||[]){
            const oldUrl=String(att?.url||'');
            if(oldUrl&&workflowAssetUrlMap[oldUrl]){
              att.url=workflowAssetUrlMap[oldUrl];
              att.storage='base44';
            }
          }
        }
      }
    }
    await base44.entities.VIPWorkflowDefinition.create(clean);
  }

  for(const row of e.VIPWorkflowProgress||[]){
    const clean=withoutOldId(row);
    if(clean.customer_id&&customerMap[String(clean.customer_id)])clean.customer_id=customerMap[String(clean.customer_id)];
    await base44.entities.VIPWorkflowProgress.create(clean);
  }

  for(const row of e.VIPWorkflowFlowProgress||[]){
    const clean=withoutOldId(row);
    const oldCustomer=String(clean.customer_id||'');
    if(oldCustomer&&customerMap[oldCustomer])clean.customer_id=customerMap[oldCustomer];
    clean.unique_key=String(clean.customer_id||'')+'::'+String(clean.flow_id||'');
    await base44.entities.VIPWorkflowFlowProgress.create(clean);
  }

  for(const row of e.VIPToolCatalog||[])await base44.entities.VIPToolCatalog.create(withoutOldId(row));
  for(const row of e.VIPAssetIndex||[]){
    const clean=withoutOldId(row);
    if(clean.url&&workflowAssetUrlMap[clean.url])clean.url=workflowAssetUrlMap[clean.url];
    await base44.entities.VIPAssetIndex.create(clean);
  }
  for(const row of e.VIPDashboardStats||[])await base44.entities.VIPDashboardStats.create(withoutOldId(row));
  for(const row of e.VIPSystemStats||[])await base44.entities.VIPSystemStats.create(withoutOldId(row));
}

async function githubWrite(path,token,options={}){
  const r=await fetch('https://api.github.com/repos/'+VIP_REPO_OWNER+'/'+VIP_REPO_NAME+path,{
    ...options,
    headers:{
      Accept:'application/vnd.github+json',
      Authorization:'Bearer '+token,
      'X-GitHub-Api-Version':'2022-11-28',
      ...(options.headers||{})
    }
  });
  if(!r.ok){
    let msg='HTTP '+r.status;
    try{const j=await r.json();if(j?.message)msg=j.message}catch(_){}
    throw new Error('GitHub 操作失败：'+msg);
  }
  return r.status===204?null:r.json();
}
async function requestRestoreToken(){
  const token=await uiPrompt(
    '完整恢复需要写回 mosen_VIP GitHub 仓库。请输入仅对 mosen_VIP 具有 Contents: Read and write 权限的 Fine-grained GitHub Token。Token 只用于本次恢复，不会保存。',
    {title:'GitHub 恢复授权',placeholder:'github_pat_…',confirmText:'验证并继续',textarea:false}
  );
  if(!token||!token.trim())return null;
  await githubWrite('',token.trim(),{method:'GET'});
  return token.trim();
}
async function restoreToolboxSnapshot(repository,token,note){
  const files=repository?.toolbox_files||[];
  if(!files.length)throw new Error('备份中没有工具中心文件');

  if(note)showMessage(note,'正在恢复工具中心文件，请不要关闭页面…','warn');

  const ref=await githubWrite('/git/ref/heads/'+encodeURIComponent(VIP_REPO_BRANCH),token,{method:'GET'});
  const headSha=ref.object?.sha;
  const commit=await githubWrite('/git/commits/'+headSha,token,{method:'GET'});
  const baseTree=commit.tree?.sha;
  const currentTree=await githubWrite('/git/trees/'+baseTree+'?recursive=1',token,{method:'GET'});
  const currentToolbox=(currentTree.tree||[]).filter(x=>x.type==='blob'&&String(x.path||'').startsWith('toolbox/')).map(x=>x.path);
  const backupPaths=new Set(files.map(x=>x.path));

  let done=0;
  const uploaded=await mapLimit(files,5,async file=>{
    const blob=await retryAsync(()=>githubWrite('/git/blobs',token,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({content:file.content,encoding:'base64'})
    }),4);
    done++;
    if(note&&(done%5===0||done===files.length))showMessage(note,'正在恢复工具中心文件 '+done+' / '+files.length+'…','warn');
    return {path:file.path,mode:file.mode||'100644',type:'blob',sha:blob.sha};
  });
  const entries=[...uploaded];
  currentToolbox.filter(p=>!backupPaths.has(p)).forEach(path=>entries.push({path,mode:'100644',type:'blob',sha:null}));

  const tree=await githubWrite('/git/trees',token,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({base_tree:baseTree,tree:entries})
  });
  const newCommit=await githubWrite('/git/commits',token,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      message:'Restore MOSEN VIP toolbox from full system backup',
      tree:tree.sha,
      parents:[headSha]
    })
  });
  await githubWrite('/git/refs/heads/'+encodeURIComponent(VIP_REPO_BRANCH),token,{
    method:'PATCH',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({sha:newCommit.sha,force:false})
  });
}

async function importFullBackup(file){
  const note=document.getElementById('backupNote');
  window.MVIP_MAINTENANCE=true;
  try{
    showMessage(note,'正在检查备份文件完整性…','warn');
    const raw=JSON.parse(await file.text());
    const info=validateBackupStructure(raw);
    await validateBackupChecksum(raw);
    const entities=info.entities;
    const counts=backupCounts(entities,raw.repository);

    let token=null;
    if(info.isV4){
      token=await requestRestoreToken();
      if(!token){showMessage(note,'已取消恢复：未提供 GitHub 恢复授权。','warn');return}
    }

    const ok=await uiConfirm(
      '备份文件校验通过（V'+Number(raw.version||1)+'）。\n\n'+
      '业务员：'+counts.sales_reps+
      '\n登记字段：'+counts.form_fields+
      '\n客户进度：'+counts.progress_stages+
      '\n客户：'+counts.customers+
      '\n日志：'+counts.activity_logs+
      '\n话术配置：'+counts.workflow_definitions+
      '\n客户话术进度：'+counts.workflow_progress+
      '\n工具中心文件：'+counts.toolbox_files+
      '\n\n继续后会先自动导出当前系统的完整安全备份，然后恢复全部数据和工具中心。',
      {title:'完整恢复 MOSEN VIP',confirmText:'开始完整恢复',danger:true}
    );
    if(!ok)return;

    showMessage(note,'正在生成恢复前完整安全备份…','warn');
    const safety=await makeBackupObject(note);
    downloadBackupObject(safety,'mosen_VIP-恢复前安全备份-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');

    showMessage(note,'正在清理并恢复全部云端数据，请不要关闭页面…','warn');
    for(const name of ['VIPActivityLog','VIPWorkflowFlowProgress','VIPWorkflowProgress','VIPToolCatalog','VIPDashboardStats','VIPSystemStats','VIPWorkflowDefinition','VIPCustomer','VIPProgressStage','VIPFormField','VIPSalesRep']){
      await wipeEntity(name);
    }
    await restoreEntities(entities);

    if(info.isV4){
      await restoreToolboxSnapshot(raw.repository,token,note);
    }

    await Promise.all([loadReps(),loadFields(),loadProgress(),loadCustomers(),loadLogs(),refreshCustomerCounts()]);
    showMessage(note,
      info.isV4
        ?'完整恢复成功：客户资料、业务员、登记字段、进度、日志、话术、分类、每个客户的话术进度，以及工具中心全部文件/模板/排序/访问配置均已恢复。GitHub Pages 会自动重新部署。'
        :'旧版备份数据恢复完成。旧版备份不包含独立 VIP 工具中心文件和话术云端数据。',
      'ok'
    );
  }catch(err){
    showMessage(note,'恢复未完成：'+(err?.message||String(err))+'。如已进入恢复阶段，请使用刚刚自动下载的“恢复前安全备份”再次恢复。','err');
  }finally{
    window.MVIP_MAINTENANCE=false;
  }
}

async function ensureAdminSearchIndex(){
  const all=[];let skip=0;
  while(true){
    const batch=unwrap(await base44.entities.VIPCustomer.list('-created_date',200,skip));
    all.push(...batch);if(batch.length<200)break;skip+=200;if(skip>10000)break;
  }
  const missing=all.filter(r=>String(r.search_text||'')!==buildCustomerSearchText(r.rep_username,r.data||{}));
  let p=0;
  async function worker(){
    while(true){
      const i=p++;if(i>=missing.length)return;
      const r=missing[i];
      try{await base44.entities.VIPCustomer.update(r.id,{search_text:buildCustomerSearchText(r.rep_username,r.data||{})})}catch(_){}
    }
  }
  await Promise.all(Array.from({length:Math.min(5,missing.length)},()=>worker()));
}
function adminRegexEscape(v){return String(v||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}
function adminServerQuery(){
  const q=adminBaseQuery();
  const search=(document.getElementById('customerSearch')?.value||'').trim().toLowerCase();
  const star=document.getElementById('adminStarFilter')?.value||'';
  const progress=document.getElementById('adminProgressFilter')?.value||'';
  const country=(document.getElementById('adminCountryFilter')?.value||'').trim().toLowerCase();
  if(star==='1')q.starred=true;
  if(star==='0')q.starred=false;
  if(progress)q.completed_progress_ids={$in:[progress]};
  const terms=[];
  if(search){
    const rx={$regex:adminRegexEscape(search),$options:'i'};
    terms.push({$or:[{customer_name_normalized:rx},{phone_normalized:rx},{email_normalized:rx},{wallet_normalized:rx},{search_text:rx}]});
  }
  if(country){
    const rx={$regex:adminRegexEscape(country),$options:'i'};
    terms.push({$or:[{country_normalized:rx},{search_text:rx}]});
  }
  if(terms.length)q.$and=terms;
  return q;
}


const BUSINESS_BACKUP_FORMAT='MOSEN_VIP_BUSINESS_DATA_BACKUP';
const BUSINESS_BACKUP_VERSION=1;
const BUSINESS_BACKUP_ENTITY_NAMES=[
  'VIPSalesRep',
  'VIPFormField',
  'VIPProgressStage',
  'VIPCustomer',
  'VIPActivityLog',
  'VIPActivityLogArchive',
  'VIPWorkflowDefinition',
  'VIPWorkflowProgress',
  'VIPWorkflowFlowProgress'
];

async function collectBusinessBackupEntities(){
  const rows=await Promise.all(BUSINESS_BACKUP_ENTITY_NAMES.map(name=>getAllEntityRecords(name)));
  return {
    VIPSalesRep:rows[0].map(backupRow),
    VIPFormField:rows[1].map(backupRow),
    VIPProgressStage:rows[2].map(backupRow),
    VIPCustomer:rows[3].map(backupRow),
    VIPActivityLog:rows[4].filter(x=>x.migration_duplicate!==true).map(backupRow),
    VIPActivityLogArchive:rows[5].map(backupRow),
    VIPWorkflowDefinition:rows[6].map(backupRow),
    VIPWorkflowProgress:rows[7].map(backupRow),
    VIPWorkflowFlowProgress:rows[8].map(backupRow)
  };
}

function businessBackupCounts(entities){
  return {
    sales_reps:(entities.VIPSalesRep||[]).length,
    form_fields:(entities.VIPFormField||[]).length,
    progress_stages:(entities.VIPProgressStage||[]).length,
    customers:(entities.VIPCustomer||[]).length,
    activity_logs:(entities.VIPActivityLog||[]).length,
    archived_activity_logs:(entities.VIPActivityLogArchive||[]).length,
    workflow_definitions:(entities.VIPWorkflowDefinition||[]).length,
    workflow_progress:(entities.VIPWorkflowProgress||[]).length,
    workflow_flow_progress:(entities.VIPWorkflowFlowProgress||[]).length
  };
}

async function makeBusinessBackup(note){
  if(note)showMessage(note,'正在读取业务员、客户资料、登记字段、客户进度、日志和话术数据…','warn');
  const entities=await collectBusinessBackupEntities();
  const checksum=await sha256(JSON.stringify(entities));
  return {
    format:BUSINESS_BACKUP_FORMAT,
    version:BUSINESS_BACKUP_VERSION,
    exported_at:new Date().toISOString(),
    checksum_sha256:checksum,
    counts:businessBackupCounts(entities),
    includes:{
      sales_reps:true,
      form_fields:true,
      progress_stages:true,
      customers:true,
      customer_assignment:true,
      customer_completed_progress:true,
      customer_archive_and_starred_state:true,
      activity_logs:true,
      workflow_definitions:true,
      workflow_customer_progress:true,
      github_repository:false,
      system_code:false,
      tools_and_templates:false
    },
    entities
  };
}

function businessBackupRow(row){
  return backupRow(row);
}
function replaceBusinessEntityRows(backup,name,rows){
  backup.entities[name]=(rows||[])
    .filter(x=>name!=='VIPActivityLog'||x.migration_duplicate!==true)
    .map(businessBackupRow);
}
function mergeBusinessEntityRows(backup,name,rows){
  const list=Array.isArray(backup.entities[name])?[...backup.entities[name]]:[];
  const index=new Map(list.map((x,i)=>[String(x.__old_id||''),i]));
  for(const row of rows||[]){
    if(name==='VIPActivityLog'&&row.migration_duplicate===true)continue;
    const item=businessBackupRow(row),key=String(row.id||item.__old_id||'');
    if(!key)continue;
    const i=index.get(key);
    if(i==null){index.set(key,list.length);list.push(item)}
    else list[i]={...list[i],...item};
  }
  backup.entities[name]=list;
}
async function tryRefreshBusinessBackupFromCloud(backup){
  const since=String(backup.snapshot_updated_at||backup.exported_at||'');
  let refreshed=false,limited=false;

  const fullNames=['VIPSalesRep','VIPFormField','VIPProgressStage','VIPCustomer','VIPWorkflowProgress','VIPWorkflowFlowProgress'];
  for(const name of fullNames){
    try{
      replaceBusinessEntityRows(backup,name,await getAllEntityRecords(name));
      refreshed=true;
    }catch(err){
      if(/traffic volume limit|read traffic|limit exceeded/i.test(String(err?.message||err)))limited=true;
      else throw err;
    }
  }

  for(const name of ['VIPActivityLog','VIPActivityLogArchive']){
    try{
      const rows=since
        ?unwrap(await base44.entities[name].filter({updated_date:{$gt:since}},'created_date',500,0))
        :[];
      mergeBusinessEntityRows(backup,name,rows);
      refreshed=true;
    }catch(err){
      if(/traffic volume limit|read traffic|limit exceeded/i.test(String(err?.message||err)))limited=true;
      else throw err;
    }
  }

  try{
    const rows=since
      ?unwrap(await base44.entities.VIPWorkflowDefinition.filter({updated_date:{$gt:since}},'-updated_date',5,0))
      :[];
    if(rows.length)replaceBusinessEntityRows(backup,'VIPWorkflowDefinition',rows);
    refreshed=true;
  }catch(err){
    if(/traffic volume limit|read traffic|limit exceeded/i.test(String(err?.message||err)))limited=true;
    else throw err;
  }

  if(refreshed&&!limited)backup.snapshot_updated_at=new Date().toISOString();
  return {refreshed,limited};
}
async function exportBusinessBackup(){
  const note=document.getElementById('backupNote');
  try{
    showMessage(note,'正在读取业务数据备份快照…','warn');

    let source=null;
    try{
      const cached=localStorage.getItem('mvip_business_backup_cache_v1');
      if(cached){
        const parsed=JSON.parse(cached);
        if(parsed?.format===BUSINESS_BACKUP_FORMAT&&parsed?.entities)source=parsed;
      }
    }catch(_){}

    const r=await fetch('./business-backup-snapshot.json?v='+Date.now(),{cache:'no-store'});
    if(!r.ok)throw new Error('备份快照读取失败：HTTP '+r.status);
    const staticSource=await r.json();
    if(staticSource?.format!==BUSINESS_BACKUP_FORMAT||!staticSource?.entities)throw new Error('业务数据备份快照格式不正确');

    const cachedTime=Date.parse(source?.snapshot_updated_at||source?.exported_at||0)||0;
    const staticTime=Date.parse(staticSource?.snapshot_updated_at||staticSource?.exported_at||0)||0;
    if(!source||staticTime>cachedTime)source=staticSource;

    const backup=deepCloneValue(source);
    const refresh=await tryRefreshBusinessBackupFromCloud(backup);

    backup.exported_at=new Date().toISOString();
    backup.counts=businessBackupCounts(backup.entities);
    backup.checksum_sha256=await sha256(JSON.stringify(backup.entities));

    try{
      localStorage.setItem('mvip_business_backup_cache_v1',JSON.stringify(backup));
    }catch(_){}

    downloadBackupObject(
      backup,
      'mosen_VIP-业务数据备份-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json'
    );

    const n=backup.counts;
    const snapshotTime=backup.snapshot_updated_at||source.snapshot_updated_at||source.exported_at||'未知';
    const suffix=refresh.limited
      ?'。Base44 当前仍处于读取限流状态，本次已自动使用最近可用快照，不会导致导出失败。'
      :'。已在快照基础上合并最新增量数据。';
    showMessage(
      note,
      '业务数据备份已导出：业务员 '+n.sales_reps+
      '、登记字段 '+n.form_fields+
      '、客户进度设置 '+n.progress_stages+
      '、客户 '+n.customers+
      '、当前日志 '+n.activity_logs+
      '、历史日志 '+n.archived_activity_logs+
      '、话术配置 '+n.workflow_definitions+
      '、客户话术进度 '+(n.workflow_progress+n.workflow_flow_progress)+
      '。数据基准时间：'+snapshotTime+suffix,
      refresh.limited?'warn':'ok'
    );
  }catch(err){
    showMessage(note,'业务数据备份失败：'+(err?.message||String(err)),'err');
  }
}
function validateBusinessBackup(raw){
  if(raw?.format!==BUSINESS_BACKUP_FORMAT||Number(raw?.version)!==BUSINESS_BACKUP_VERSION){
    throw new Error('这不是有效的 MOSEN VIP 业务数据备份');
  }
  const e=raw.entities||{};
  for(const name of BUSINESS_BACKUP_ENTITY_NAMES){
    if(!Array.isArray(e[name]))throw new Error('备份缺少 '+name+' 数据');
  }
  const allowedTypes=new Set(['text','number','date','datetime','email','tel','textarea','select']);
  const fieldKeys=new Set();
  for(const field of e.VIPFormField){
    if(!field.field_key)throw new Error('存在缺少 field_key 的登记字段');
    if(fieldKeys.has(String(field.field_key)))throw new Error('登记字段 key 重复：'+field.field_key);
    fieldKeys.add(String(field.field_key));
    if(!allowedTypes.has(String(field.field_type||'')))throw new Error('不支持的字段类型：'+String(field.field_type));
  }
  for(const p of e.VIPProgressStage){
    if(!p.__old_id)throw new Error('客户进度缺少原始 ID，无法安全恢复客户勾选进度');
  }
  for(const cust of e.VIPCustomer){
    if(cust.data!=null&&(typeof cust.data!=='object'||Array.isArray(cust.data)))throw new Error('客户资料格式不正确');
    if(cust.completed_progress_ids!=null&&!Array.isArray(cust.completed_progress_ids))throw new Error('客户完成进度格式不正确');
  }
  return e;
}

async function getLatestBusinessSafetySnapshot(){
  let best=null,bestTime=0;
  try{
    const cached=localStorage.getItem('mvip_business_backup_cache_v1');
    if(cached){
      const parsed=JSON.parse(cached);
      if(parsed?.format===BUSINESS_BACKUP_FORMAT&&parsed?.entities){
        best=parsed;
        bestTime=Date.parse(parsed.snapshot_updated_at||parsed.exported_at||0)||0;
      }
    }
  }catch(_){}
  try{
    const r=await fetch('./business-backup-snapshot.json?v='+Date.now(),{cache:'no-store'});
    if(r.ok){
      const parsed=await r.json();
      if(parsed?.format===BUSINESS_BACKUP_FORMAT&&parsed?.entities){
        const t=Date.parse(parsed.snapshot_updated_at||parsed.exported_at||0)||0;
        if(!best||t>bestTime){best=parsed;bestTime=t}
      }
    }
  }catch(_){}
  if(!best)throw new Error('没有可用的恢复前业务数据安全快照，请先成功导出一次业务数据备份');
  const copy=deepCloneValue(best);
  copy.exported_at=new Date().toISOString();
  copy.counts=businessBackupCounts(copy.entities);
  copy.checksum_sha256=await sha256(JSON.stringify(copy.entities));
  return copy;
}
function assertSafetySnapshotMatchesLoadedSystem(safety){
  const n=businessBackupCounts(safety.entities||{});
  const loadedCustomerTotal=Number(totalCustomerCount||0)+Number(totalArchivedCount||0);
  const problems=[];
  if(reps.length&&Number(n.sales_reps)!==Number(reps.length))problems.push('业务员：当前 '+reps.length+'，安全快照 '+n.sales_reps);
  if(fields.length&&Number(n.form_fields)!==Number(fields.length))problems.push('登记字段：当前 '+fields.length+'，安全快照 '+n.form_fields);
  if(progressStages.length&&Number(n.progress_stages)!==Number(progressStages.length))problems.push('客户进度：当前 '+progressStages.length+'，安全快照 '+n.progress_stages);
  if(loadedCustomerTotal>0&&Number(n.customers)!==loadedCustomerTotal)problems.push('客户：当前 '+loadedCustomerTotal+'，安全快照 '+n.customers);
  if(problems.length)throw new Error('为避免资料丢失，恢复已停止：当前系统与最近安全快照数量不一致。'+problems.join('；')+'。请先重新导出一次业务数据备份，再进行导入恢复。');
}
async function deleteBusinessRowsFromSnapshot(entityName,rows,note,label){
  const handler=base44.entities[entityName];
  if(!handler)return;
  const ids=[...new Set((rows||[]).map(x=>String(x?.__old_id||'')).filter(Boolean))];
  if(!ids.length)return;
  let next=0,done=0;
  const concurrency=Math.min(8,ids.length);

  async function worker(){
    while(true){
      const i=next++;
      if(i>=ids.length)return;
      const id=ids[i];
      try{
        await handler.delete(id);
      }catch(err){
        const msg=String(err?.message||err||'').toLowerCase();
        if(!msg.includes('not found')&&!msg.includes('404'))throw err;
      }
      done++;
      if(note&&(done===ids.length||done%20===0)){
        showMessage(note,'正在清理'+label+' '+done+' / '+ids.length+'…','warn');
      }
    }
  }
  await Promise.all(Array.from({length:concurrency},()=>worker()));
}
async function clearBusinessDataFromSafetySnapshot(safety,note){
  const e=safety.entities||{};
  const order=[
    ['VIPActivityLogArchive',e.VIPActivityLogArchive,'历史操作日志'],
    ['VIPActivityLog',e.VIPActivityLog,'操作日志'],
    ['VIPWorkflowFlowProgress',e.VIPWorkflowFlowProgress,'客户话术进度'],
    ['VIPWorkflowProgress',e.VIPWorkflowProgress,'旧版客户话术进度'],
    ['VIPWorkflowDefinition',e.VIPWorkflowDefinition,'话术配置'],
    ['VIPCustomer',e.VIPCustomer,'客户资料'],
    ['VIPProgressStage',e.VIPProgressStage,'客户进度设置'],
    ['VIPFormField',e.VIPFormField,'登记字段'],
    ['VIPSalesRep',e.VIPSalesRep,'业务员']
  ];
  for(const [name,rows,label] of order){
    await deleteBusinessRowsFromSnapshot(name,rows||[],note,label);
  }
}

async function importBusinessBackup(file){
  const note=document.getElementById('backupNote');
  window.MVIP_MAINTENANCE=true;
  try{
    showMessage(note,'正在校验业务数据备份…','warn');
    const raw=JSON.parse(await file.text());
    const entities=validateBusinessBackup(raw);
    if(!raw.checksum_sha256)throw new Error('备份缺少完整性校验码');
    const actual=await sha256(JSON.stringify(entities));
    if(actual!==raw.checksum_sha256)throw new Error('备份完整性校验失败：文件可能已损坏或被修改');

    const n=businessBackupCounts(entities);
    const ok=await uiConfirm(
      '业务数据备份校验通过。\n\n'+
      '业务员：'+n.sales_reps+
      '\n登记字段：'+n.form_fields+
      '\n客户进度设置：'+n.progress_stages+
      '\n客户：'+n.customers+
      '\n当前日志：'+n.activity_logs+
      '\n历史日志：'+n.archived_activity_logs+
      '\n话术配置：'+n.workflow_definitions+
      '\n客户话术进度：'+(n.workflow_progress+n.workflow_flow_progress)+
      '\n\n继续后只会替换上述业务数据，不修改 GitHub 仓库、网页代码、工具或模板。',
      {title:'恢复业务数据',confirmText:'开始恢复',danger:true}
    );
    if(!ok)return;

    showMessage(note,'正在准备恢复前业务数据安全快照…','warn');
    const safety=await getLatestBusinessSafetySnapshot();
    assertSafetySnapshotMatchesLoadedSystem(safety);
    downloadBackupObject(
      safety,
      'mosen_VIP-恢复前业务数据备份-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json'
    );

    showMessage(note,'正在按安全快照清理并恢复业务数据，请不要关闭页面…','warn');
    await clearBusinessDataFromSafetySnapshot(safety,note);
    showMessage(note,'旧业务数据已清理，正在重建业务员、字段、客户、进度、日志和话术…','warn');

    await restoreEntities(entities);
    try{await reconcileDashboardStats(base44)}catch(_){}

    await Promise.all([
      loadReps(),
      loadFields(),
      loadProgress(),
      loadCustomers({resetPage:true}),
      loadLogs(true),
      refreshCustomerCounts()
    ]);

    showMessage(
      note,
      '业务数据恢复成功：业务员、登记字段、客户进度设置、客户全部资料与归属、客户已完成进度、归档/星标状态、操作日志、全部话术和客户话术进度均已恢复。系统代码和 GitHub 仓库未修改。',
      'ok'
    );
  }catch(err){
    showMessage(note,'业务数据恢复失败：'+(err?.message||String(err)),'err');
  }finally{
    window.MVIP_MAINTENANCE=false;
  }
}

const FULL_BACKUP_V5_FORMAT='MOSEN_VIP_DISASTER_BACKUP';
const FULL_BACKUP_V5_VERSION=5;
let jsZipPromise=null;
function getJSZip(){
  if(!jsZipPromise)jsZipPromise=import('https://esm.sh/jszip@3.10.1').then(m=>m.default||m);
  return jsZipPromise;
}
function downloadBlob(blob,filename){
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),5000);
}
async function mapLimit(items,limit,worker){
  const out=new Array(items.length);let next=0;
  async function run(){
    while(true){
      const i=next++;if(i>=items.length)return;
      out[i]=await worker(items[i],i);
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,Math.max(1,items.length))},()=>run()));
  return out;
}
async function retryAsync(fn,attempts=4){
  let last;
  for(let i=0;i<attempts;i++){
    try{return await fn(i)}catch(err){
      last=err;
      if(i<attempts-1)await new Promise(r=>setTimeout(r,500*Math.pow(2,i)));
    }
  }
  throw last;
}
function repoRawUrl(path){
  return 'https://raw.githubusercontent.com/'+VIP_REPO_OWNER+'/'+VIP_REPO_NAME+'/'+VIP_REPO_BRANCH+'/'+String(path).split('/').map(encodeURIComponent).join('/');
}
function externalWorkflowAssets(entities){
  const seen=new Map(),items=[];
  for(const row of entities.VIPWorkflowDefinition||[]){
    for(const flow of row.bundle?.workflows||[]){
      for(const step of flow.steps||[]){
        for(const att of step.attachments||[]){
          const url=String(att?.url||'').trim();
          if(!url||url.startsWith('data:')||url.startsWith('./')||url.startsWith('../')||url.startsWith('/'))continue;
          if(!/^https?:\/\//i.test(url)||seen.has(url))continue;
          const key=String(att.id||('asset-'+(items.length+1))).replace(/[^a-zA-Z0-9._-]+/g,'_');
          const name=String(att.name||('workflow-asset-'+(items.length+1))).replace(/[\\/:*?"<>|]+/g,'_');
          const path='base44/workflow-assets/'+key+'-'+name;
          const meta={old_url:url,path,name,type:String(att.type||'application/octet-stream'),size:Number(att.size||0)};
          seen.set(url,meta);items.push(meta);
        }
      }
    }
  }
  return items;
}
async function addWorkflowAssetsToZip(zip,entities,note,silent){
  const assets=externalWorkflowAssets(entities);
  if(!assets.length)return [];
  let done=0;
  await mapLimit(assets,4,async meta=>{
    const bytes=await retryAsync(async()=>{
      const r=await fetch(meta.old_url,{cache:'no-store'});
      if(!r.ok)throw new Error('话术附件读取失败：'+meta.name+' (HTTP '+r.status+')');
      return new Uint8Array(await r.arrayBuffer());
    },4);
    meta.size=bytes.length;
    zip.file(meta.path,bytes,{binary:true});
    done++;
    if(note&&!silent&&(done%3===0||done===assets.length)){
      showMessage(note,'V5：正在备份独立话术附件 '+done+' / '+assets.length+'…','warn');
    }
  });
  return assets;
}
async function restoreWorkflowAssetsFromZip(zip,manifest,note){
  const assets=Array.isArray(manifest.workflow_assets)?manifest.workflow_assets:[];
  const urlMap={};
  if(!assets.length)return urlMap;
  let done=0;
  await mapLimit(assets,3,async meta=>{
    const entry=zip.file(meta.path);
    if(!entry)throw new Error('ZIP 缺少话术附件：'+meta.name);
    const bytes=await entry.async('uint8array');
    const file=new File([bytes],meta.name||'workflow-asset',{type:meta.type||'application/octet-stream'});
    const uploaded=await retryAsync(async()=>{
      const result=await base44.integrations.Core.UploadFile({file});
      const url=result?.file_url||result?.url||result?.data?.file_url||'';
      if(!url)throw new Error('附件上传后没有返回地址');
      return url;
    },4);
    urlMap[String(meta.old_url||'')]=uploaded;
    done++;
    if(note&&(done%3===0||done===assets.length))showMessage(note,'正在恢复独立话术附件 '+done+' / '+assets.length+'…','warn');
  });
  return urlMap;
}

async function fetchRepositoryArchiveSnapshot(JSZip,note,{silent=false}={}){
  const archiveUrl='https://codeload.github.com/'+VIP_REPO_OWNER+'/'+VIP_REPO_NAME+'/zip/refs/heads/'+encodeURIComponent(VIP_REPO_BRANCH);
  if(note&&!silent)showMessage(note,'V5：正在一次性下载 GitHub 仓库快照…','warn');
  const response=await retryAsync(async()=>{
    const r=await fetch(archiveUrl,{cache:'no-store'});
    if(!r.ok)throw new Error('GitHub 仓库快照下载失败：HTTP '+r.status);
    return r;
  },4);
  const sourceZip=await JSZip.loadAsync(await response.arrayBuffer());
  const entries=Object.values(sourceZip.files).filter(x=>!x.dir);
  if(!entries.length)throw new Error('GitHub 仓库快照为空');

  const firstPath=String(entries[0].name||'');
  const rootPrefix=firstPath.includes('/')?firstPath.slice(0,firstPath.indexOf('/')+1):'';
  const files=[];
  let done=0;
  await mapLimit(entries,4,async entry=>{
    let path=String(entry.name||'');
    if(rootPrefix&&path.startsWith(rootPrefix))path=path.slice(rootPrefix.length);
    path=path.replace(/^\/+/, '');
    if(!path||path.startsWith('_site/'))return;
    const bytes=await entry.async('uint8array');
    files.push({path,mode:'100644',size:bytes.length,bytes});
    done++;
    if(note&&!silent&&(done%20===0||done===entries.length)){
      showMessage(note,'V5：正在整理仓库快照 '+done+' / '+entries.length+'…','warn');
    }
  });
  files.sort((a,b)=>a.path.localeCompare(b.path));
  return files;
}

async function buildV5Backup(note,{silent=false}={}){
  const JSZip=await getJSZip();
  const zip=new JSZip();
  if(note&&!silent)showMessage(note,'V5：正在读取全部云端数据…','warn');

  const entities=await collectBackupEntities();
  const workflowAssets=await addWorkflowAssetsToZip(zip,entities,note,silent);

  const repoSnapshot=await fetchRepositoryArchiveSnapshot(JSZip,note,{silent});
  for(const file of repoSnapshot){
    zip.file('repository/'+file.path,file.bytes,{binary:true});
  }
  const repoFiles=repoSnapshot.map(({path,mode,size})=>({path,mode,size,sha:''}));

  Object.entries(entities).forEach(([name,rows])=>{
    zip.file('base44/entities/'+name+'.json',JSON.stringify(rows,null,2)+'\n');
  });

  let schemaBlueprint=null;
  try{
    const r=await fetch('./base44-schema-blueprint.json',{cache:'default'});
    if(r.ok)schemaBlueprint=await r.json();
  }catch(_){}
  if(schemaBlueprint)zip.file('base44/schema-blueprint.json',JSON.stringify(schemaBlueprint,null,2)+'\n');

  const manifest={
    format:FULL_BACKUP_V5_FORMAT,
    version:FULL_BACKUP_V5_VERSION,
    exported_at:new Date().toISOString(),
    app_id:'6abb8b9e7bc76cdfe0aeb883',
    repository:{owner:VIP_REPO_OWNER,name:VIP_REPO_NAME,branch:VIP_REPO_BRANCH,source:'github-codeload-archive'},
    repository_files:repoFiles,
    counts:backupCounts(entities,{toolbox_files:repoFiles.filter(x=>String(x.path||'').startsWith('toolbox/'))}),
    entity_names:Object.keys(entities),
    workflow_assets:workflowAssets,
    generated_public_aliases:true,
    notes:'V5 contains the entire repository snapshot, Base44 entity data, external workflow attachment bytes and the Base44 schema blueprint. Repository export uses one GitHub codeload archive request and does not consume GitHub REST API rate limit.'
  };
  zip.file('manifest.json',JSON.stringify(manifest,null,2)+'\n');
  zip.file('RESTORE_README.txt',
    'MOSEN VIP V5 灾难恢复包\n\n'+
    '本 ZIP 包包含：\n'+
    '1. repository/：mosen_VIP GitHub 仓库完整快照；\n'+
    '2. base44/entities/：全部 VIP 云端实体数据；\n'+
    '3. base44/schema-blueprint.json：Base44 数据结构蓝图；\n'+
    '4. base44/workflow-assets/：独立文件存储中的话术附件原始文件；\n'+
    '5. manifest.json：版本、文件清单与数量。\n\n'+
    '在当前 MOSEN VIP 系统中使用“导入 V5 灾难备份”可恢复当前 Base44 数据和整个 GitHub 仓库。\n'+
    '如果原 GitHub 仓库或原 Base44 App 均已不存在，请先创建新的空 GitHub 仓库和 Base44 App，再使用本包中的 repository/ 与 schema-blueprint.json 重建。恢复后把 config.js 的 APP_ID 指向新 App。\n'
  );

  if(note&&!silent)showMessage(note,'V5：正在压缩备份文件…','warn');
  let lastShown=-1;
  const blob=await zip.generateAsync(
    {type:'blob',compression:'DEFLATE',compressionOptions:{level:6}},
    meta=>{
      const pct=Math.round(meta.percent);
      const bucket=Math.floor(pct/10)*10;
      if(note&&!silent&&bucket!==lastShown){
        lastShown=bucket;
        showMessage(note,'V5：正在压缩 '+Math.min(100,bucket)+'%…','warn');
      }
    }
  );
  return {blob,manifest};
}
async function exportV5Backup(){
  const note=document.getElementById('backupNote');
  try{
    const {blob,manifest}=await buildV5Backup(note);
    const name='mosen_VIP-V5-完整灾难备份-'+new Date().toISOString().replace(/[:.]/g,'-')+'.zip';
    downloadBlob(blob,name);
    showMessage(note,'V5 完整灾难备份已导出：客户 '+(manifest.counts.customers||0)+'、日志 '+(manifest.counts.activity_logs||0)+'、仓库文件 '+manifest.repository_files.length+'、独立话术附件 '+(manifest.workflow_assets?.length||0)+'。ZIP 同时包含整个仓库、全部云端数据、附件原文件和 Base44 schema 蓝图。','ok');
  }catch(err){
    showMessage(note,'V5 备份失败：'+(err?.message||String(err)),'err');
  }
}
async function readZipJson(zip,path){
  const entry=zip.file(path);if(!entry)return null;
  return JSON.parse(await entry.async('string'));
}
async function restoreRepositoryFromZip(zip,manifest,token,note){
  const list=Array.isArray(manifest.repository_files)?manifest.repository_files:[];
  if(!list.length)throw new Error('V5 备份没有仓库文件清单');

  showMessage(note,'正在准备恢复整个 GitHub 仓库…','warn');
  const ref=await githubWrite('/git/ref/heads/'+encodeURIComponent(VIP_REPO_BRANCH),token,{method:'GET'});
  const headSha=ref.object?.sha;
  const headCommit=await githubWrite('/git/commits/'+headSha,token,{method:'GET'});
  const baseTree=headCommit.tree?.sha;
  const currentTree=await githubWrite('/git/trees/'+baseTree+'?recursive=1',token,{method:'GET'});
  const currentFiles=(currentTree.tree||[]).filter(x=>x.type==='blob').map(x=>x.path);
  const backupPaths=new Set(list.map(x=>x.path));
  let done=0;

  const entries=await mapLimit(list,5,async meta=>{
    const entry=zip.file('repository/'+meta.path);
    if(!entry)throw new Error('ZIP 缺少仓库文件：'+meta.path);
    const base64=await entry.async('base64');
    const blob=await retryAsync(()=>githubWrite('/git/blobs',token,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({content:base64,encoding:'base64'})
    }),4);
    done++;
    if(done%6===0||done===list.length)showMessage(note,'正在上传仓库文件 '+done+' / '+list.length+'…','warn');
    return {path:meta.path,mode:meta.mode||'100644',type:'blob',sha:blob.sha};
  });
  currentFiles.filter(p=>!backupPaths.has(p)).forEach(path=>entries.push({path,mode:'100644',type:'blob',sha:null}));

  const newTree=await githubWrite('/git/trees',token,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({base_tree:baseTree,tree:entries})
  });
  const commit=await githubWrite('/git/commits',token,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({message:'Restore MOSEN VIP from V5 disaster backup',tree:newTree.sha,parents:[headSha]})
  });
  await githubWrite('/git/refs/heads/'+encodeURIComponent(VIP_REPO_BRANCH),token,{
    method:'PATCH',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({sha:commit.sha,force:false})
  });
  return commit.sha;
}
async function importV5Backup(file){
  const note=document.getElementById('backupNote');
  window.MVIP_MAINTENANCE=true;
  try{
    const JSZip=await getJSZip();
    showMessage(note,'正在读取 V5 ZIP 备份…','warn');
    const zip=await JSZip.loadAsync(file);
    const manifest=await readZipJson(zip,'manifest.json');
    if(!manifest||manifest.format!==FULL_BACKUP_V5_FORMAT||Number(manifest.version)!==FULL_BACKUP_V5_VERSION){
      throw new Error('这不是有效的 MOSEN VIP V5 灾难备份');
    }

    const entities={};
    for(const name of manifest.entity_names||[]){
      const rows=await readZipJson(zip,'base44/entities/'+name+'.json');
      if(Array.isArray(rows))entities[name]=rows;
    }
    const required=['VIPSalesRep','VIPFormField','VIPProgressStage','VIPCustomer','VIPActivityLog','VIPWorkflowDefinition'];
    for(const name of required)if(!Array.isArray(entities[name]))throw new Error('V5 备份缺少 '+name);

    const token=await requestRestoreToken();
    if(!token){showMessage(note,'已取消恢复。','warn');return}

    const ok=await uiConfirm(
      'V5 备份校验通过。\n\n客户：'+(entities.VIPCustomer?.length||0)+
      '\n日志：'+(entities.VIPActivityLog?.length||0)+
      '\n仓库文件：'+(manifest.repository_files?.length||0)+
      '\n独立话术附件：'+(manifest.workflow_assets?.length||0)+
      '\n\n继续后会先自动生成一份当前系统的 V5 安全备份，然后恢复全部 Base44 数据、附件文件和整个 GitHub 仓库。',
      {title:'恢复 V5 灾难备份',confirmText:'开始完整恢复',danger:true}
    );
    if(!ok)return;

    showMessage(note,'正在生成恢复前 V5 安全备份…','warn');
    const safety=await buildV5Backup(note,{silent:true});
    downloadBlob(safety.blob,'mosen_VIP-V5-恢复前安全备份-'+new Date().toISOString().replace(/[:.]/g,'-')+'.zip');

    showMessage(note,'正在恢复 Base44 全部数据，实时刷新已暂停…','warn');
    for(const name of ['VIPActivityLog','VIPWorkflowFlowProgress','VIPWorkflowProgress','VIPToolCatalog','VIPDashboardStats','VIPSystemStats','VIPWorkflowDefinition','VIPCustomer','VIPProgressStage','VIPFormField','VIPSalesRep']){
      try{await wipeEntity(name)}catch(_){}
    }
    const workflowAssetUrlMap=await restoreWorkflowAssetsFromZip(zip,manifest,note);
    await restoreEntities(entities,workflowAssetUrlMap);

    await restoreRepositoryFromZip(zip,manifest,token,note);

    window.MVIP_MAINTENANCE=false;
    await Promise.all([loadReps(),loadFields(),loadProgress(),loadCustomers({resetPage:true}),loadLogs(true),refreshCustomerCounts()]);
    showMessage(note,'V5 完整恢复已提交：Base44 数据和整个 GitHub 仓库都已恢复。GitHub Pages 正在自动重新部署；部署完成后刷新页面即可。','ok');
  }catch(err){
    window.MVIP_MAINTENANCE=false;
    showMessage(note,'V5 恢复未完成：'+(err?.message||String(err))+'。如果已经进入恢复阶段，请使用刚才自动下载的“V5 恢复前安全备份”。','err');
  }
}
async function importAnyBackup(file){
  const name=String(file?.name||'').toLowerCase();
  if(name.endsWith('.zip'))return importV5Backup(file);
  let raw=null;
  try{raw=JSON.parse(await file.text())}catch(_){}
  if(raw?.format===BUSINESS_BACKUP_FORMAT)return importBusinessBackup(file);
  return importFullBackup(file);
}

async function fetchAllAdminCustomers(query){
  const all=[];let skip=0;
  while(true){const batch=unwrap(await base44.entities.VIPCustomer.filter(query,'-admin_sort_score',500,skip));all.push(...batch);if(batch.length<500)break;skip+=500;if(skip>10000)break}
  return all;
}
function adminBaseQuery(){
  const q={archived:currentView==='archive'};
  if(currentView==='rep'&&currentRepFilter)q.rep_username=currentRepFilter;
  const chosen=document.getElementById('adminRepFilter')?.value||'';
  if(currentView!=='rep'&&chosen)q.rep_username=chosen;
  return q;
}
function adminFilterActive(){
  return !!((document.getElementById('customerSearch')?.value||'').trim()||(document.getElementById('adminStarFilter')?.value||'')||(document.getElementById('adminProgressFilter')?.value||'')||(document.getElementById('adminCountryFilter')?.value||'').trim()||(currentView!=='rep'&&(document.getElementById('adminRepFilter')?.value||'')));
}
function matchesAdminFilters(r){
  const q=(document.getElementById('customerSearch')?.value||'').trim().toLowerCase();
  const star=document.getElementById('adminStarFilter')?.value||'';
  const progress=document.getElementById('adminProgressFilter')?.value||'';
  const country=(document.getElementById('adminCountryFilter')?.value||'').trim().toLowerCase();
  const hay=(String(r.rep_username||'')+' '+JSON.stringify(r.data||{})).toLowerCase();
  if(q&&!hay.includes(q))return false;
  if(star==='1'&&r.starred!==true)return false;
  if(star==='0'&&r.starred===true)return false;
  if(progress&&!(r.completed_progress_ids||[]).map(String).includes(String(progress)))return false;
  if(country&&!hay.includes(country))return false;
  return true;
}
async function fetchCustomerPage(){
  if(adminFilterActive()){
    globalCustomerRows=null;const skip=(customerPage-1)*CUSTOMER_PAGE_SIZE;
    try{
      const rows=unwrap(await base44.entities.VIPCustomer.filter(adminServerQuery(),'-admin_sort_score',CUSTOMER_PAGE_SIZE+1,skip));
      customerHasNext=rows.length>CUSTOMER_PAGE_SIZE;customers=rows.slice(0,CUSTOMER_PAGE_SIZE);
    }catch(err){
      globalCustomerRows=null;
      throw new Error('服务器筛选暂时不可用，请稍后重试。'+(err?.message?' '+err.message:''));
    }
  }else{
    globalCustomerRows=null;const skip=(customerPage-1)*CUSTOMER_PAGE_SIZE;
    const rows=unwrap(await base44.entities.VIPCustomer.filter(adminBaseQuery(),'-admin_sort_score',CUSTOMER_PAGE_SIZE+1,skip));
    customerHasNext=rows.length>CUSTOMER_PAGE_SIZE;customers=rows.slice(0,CUSTOMER_PAGE_SIZE);
  }
  if(!customers.length&&customerPage>1){customerPage--;return fetchCustomerPage()}
}
async function refreshCustomerCounts(){
  const rows=unwrap(await base44.entities.VIPDashboardStats.list({sort:'key',limit:500}));
  const global=rows.find(x=>x.key==='global');
  if(global){
    totalCustomerCount=Number(global.active_customers||0);
    totalArchivedCount=Number(global.archived_customers||0);
    customerCountByRep={};archivedCountByRep={};
    rows.filter(x=>x.scope==='rep').forEach(x=>{
      customerCountByRep[String(x.rep_username||'')]=Number(x.active_customers||0);
      archivedCountByRep[String(x.rep_username||'')]=Number(x.archived_customers||0);
    });
  }else{
    const all=[];let skip=0;
    while(true){const batch=unwrap(await base44.entities.VIPCustomer.list('-created_date',500,skip));all.push(...batch);if(batch.length<500)break;skip+=500}
    let active=0,archived=0,counts={},archiveCounts={};
    for(const row of all){const key=String(row.rep_username||'');if(row.archived===true){archived++;archiveCounts[key]=(archiveCounts[key]||0)+1}else{active++;counts[key]=(counts[key]||0)+1}}
    totalCustomerCount=active;totalArchivedCount=archived;customerCountByRep=counts;archivedCountByRep=archiveCounts;
  }
  document.getElementById('totalCustomers').textContent=totalCustomerCount;document.getElementById('allCustomerCount').textContent=totalCustomerCount;
  document.getElementById('archivedCustomerCount').textContent=totalArchivedCount;document.getElementById('archivedCustomersStat').textContent=totalArchivedCount;
  renderSidebar();renderReps();
}
function scheduleCustomerCountRefresh(){clearTimeout(customerCountTimer);customerCountTimer=setTimeout(()=>refreshCustomerCounts().catch(()=>{}),1000)}
async function loadCustomers({resetPage=false,refreshCounts=false}={}){
  if(resetPage)customerPage=1;
  try{await fetchCustomerPage();renderCustomers();if(refreshCounts)await refreshCustomerCounts()}
  catch(err){document.getElementById('customerList').innerHTML='<div class="notice err">读取客户失败：'+esc(err?.message||String(err))+'</div>'}
}
function getVisibleCustomers(){return customers}
function adminPagerHtml(){
  const total=globalCustomerRows?globalCustomerRows.length:(currentView==='archive'?totalArchivedCount:(currentView==='rep'?(customerCountByRep[currentRepFilter]||0):totalCustomerCount));
  return '<div class="customer-pager"><div class="customer-pager-info">第 <b>'+customerPage+'</b> 页 · 每页 '+CUSTOMER_PAGE_SIZE+' 条 · 共 '+total+' 条</div><div class="customer-pager-actions"><button id="adminPrevPage" class="btn soft" '+(customerPage<=1?'disabled':'')+'>上一页</button><button id="adminNextPage" class="btn soft" '+(!customerHasNext?'disabled':'')+'>下一页</button></div></div>';
}
function bindAdminPager(){const prev=document.getElementById('adminPrevPage'),next=document.getElementById('adminNextPage');if(prev)prev.onclick=async()=>{if(customerPage<=1)return;customerPage--;await loadCustomers()};if(next)next.onclick=async()=>{if(!customerHasNext)return;customerPage++;await loadCustomers()}}
function fixedCustomerValue(row,key){return row.data?.[key]??''}
function progressLabels(row){
  const s=progressStats(row);
  if(!progressStages.length)return {current:'未设置进度',next:'—'};
  const completedOrdered=progressStages.filter(p=>s.done.has(String(p.id)));
  const current=completedOrdered.length?completedOrdered[completedOrdered.length-1].label:'未开始';
  const nextStage=progressStages.find(p=>!s.done.has(String(p.id)));
  return {current,next:nextStage?nextStage.label:'已完成'};
}
function repDisplayName(username){
  const rep=reps.find(x=>String(x.username||'')===String(username||''));
  return rep?.display_name||rep?.username||username||'未指定业务员';
}
async function writeAdminLog(payload){
  try{await base44.entities.VIPActivityLog.create({actor_username:'admin',actor_display_name:'管理员',actor_type:'admin',action_type:payload.action_type||'update',customer_id:payload.customer_id||'',customer_name:payload.customer_name||'',target_key:payload.target_key||'',target_label:payload.target_label||'',old_value:payload.old_value==null?'':String(payload.old_value),new_value:payload.new_value==null?'':String(payload.new_value),message:payload.message||'',event_time:new Date().toISOString(),event_day:localDateKey(),metadata:payload.metadata||{}})}catch(_){}
}
function adminCustomerCopyText(row){
  const lines=['客户姓名：'+(fixedCustomerValue(row,'f_customer_name')||''),'业务员：'+repDisplayName(row.rep_username)];
  for(const f of fields){const v=row.data?.[f.field_key];if(v!==undefined&&v!==null&&String(v).trim()!=='')lines.push(f.label+'：'+v)}
  const p=progressLabels(row);lines.push('目前进度：'+p.current);if(row.archived)lines.push('归档原因：'+(row.archive_reason||'未填写'));return lines.join('\n');
}
async function copyAdminCustomer(row){try{await navigator.clipboard.writeText(adminCustomerCopyText(row));await uiAlert('客户资料已复制到剪贴板。',{title:'复制成功'})}catch(_){await uiAlert('复制失败，请重试。',{title:'复制失败',danger:true})}}
async function setAdminStar(row,value){await base44.entities.VIPCustomer.update(row.id,{starred:value});row.starred=value;await writeAdminLog({action_type:'customer_star',customer_id:row.id,customer_name:fixedCustomerValue(row,'f_customer_name')||'未命名客户',message:'管理员'+(value?' 将客户设为重点「':' 取消重点客户「')+(fixedCustomerValue(row,'f_customer_name')||'未命名客户')+'」'});renderCustomers()}
async function archiveAdminCustomer(row){
  const reason=await uiPrompt('可填写归档原因，例如：已完成 / 客户失联 / 暂停跟进 / 重复客户 / 其他。',{title:'归档客户',placeholder:'归档原因（可选）',confirmText:'下一步'});if(reason===null)return;
  const name=fixedCustomerValue(row,'f_customer_name')||'未命名客户';if(!await uiConfirm('确定将「'+name+'」移入归档吗？\n客户资料不会删除，可以随时恢复。',{title:'确认归档',confirmText:'确认归档'}))return;
  await base44.entities.VIPCustomer.update(row.id,{archived:true,archived_at:new Date().toISOString(),archived_by_username:'admin',archived_by_display_name:'管理员',archived_by_type:'admin',archive_reason:reason});
  const todayDelta=localDateKey(row.created_date)===localDateKey()?-1:0;
  await Promise.all([
    adjustDashboardStat('global',{active_customers:-1,archived_customers:1,today_active_customers:todayDelta},{scope:'global'}),
    adjustDashboardStat('rep:'+String(row.rep_username||''),{active_customers:-1,archived_customers:1,today_active_customers:todayDelta},{scope:'rep',rep_username:String(row.rep_username||'')})
  ]);
  await writeAdminLog({action_type:'customer_archive',customer_id:row.id,customer_name:name,message:'管理员将客户「'+name+'」归档'+(reason?'，原因：'+reason:'')});await loadCustomers({refreshCounts:true});
}
async function restoreAdminCustomer(row){
  const name=fixedCustomerValue(row,'f_customer_name')||'未命名客户';if(!await uiConfirm('将「'+name+'」恢复到正常客户列表吗？',{title:'恢复客户',confirmText:'确认恢复'}))return;
  await base44.entities.VIPCustomer.update(row.id,{archived:false,archived_at:'',archived_by_username:'',archived_by_display_name:'',archived_by_type:'',archive_reason:''});
  const todayDelta=localDateKey(row.created_date)===localDateKey()?1:0;
  await Promise.all([
    adjustDashboardStat('global',{active_customers:1,archived_customers:-1,today_active_customers:todayDelta},{scope:'global'}),
    adjustDashboardStat('rep:'+String(row.rep_username||''),{active_customers:1,archived_customers:-1,today_active_customers:todayDelta},{scope:'rep',rep_username:String(row.rep_username||'')})
  ]);
  await writeAdminLog({action_type:'customer_restore',customer_id:row.id,customer_name:name,message:'管理员将客户「'+name+'」从归档恢复'});await loadCustomers({refreshCounts:true});
}
function renderCustomers(){
  const rows=getVisibleCustomers(),box=document.getElementById('customerList');
  if(!rows.length){box.innerHTML='<div class="empty">'+(currentView==='archive'?'暂无归档客户':'暂无匹配客户')+'</div>'+adminPagerHtml();bindAdminPager();return}
  const eye='<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="2.8" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
  const archived=currentView==='archive';
  box.innerHTML='<div class="table-wrap customer-table fixed-customer-table"><table><thead><tr><th>转主号时间</th><th>客户姓名</th><th>手机号</th><th>邮箱</th><th>损失金额</th><th>目前进度</th><th>'+(archived?'归档信息':'下一步')+'</th><th>操作</th></tr></thead><tbody>'+rows.map(r=>{const s=progressStats(r),pl=progressLabels(r),archiveInfo=r.archived?((r.archive_reason||'未填写原因')+' · '+(formatDate(r.archived_at)||'')):pl.next;return '<tr class="customer-progress-row '+(r.starred?'starred-row':'')+'" style="--row-progress:'+s.percent+'%;--row-fill:'+s.fill+';--row-solid:'+s.solid+'"><td data-label="转主号时间">'+esc(formatDate(fixedCustomerValue(r,'f_transfer_main_time'))||'—')+'</td><td data-label="客户姓名"><div class="customer-name-stack"><div class="customer-name-line"><button class="star-btn '+(r.starred?'active':'')+'" data-id="'+r.id+'" type="button">★</button><b>'+esc(fixedCustomerValue(r,'f_customer_name')||'—')+'</b><span class="row-progress-badge">'+s.percent+'%</span></div><div class="customer-owner-line">业务员：'+esc(repDisplayName(r.rep_username))+'</div></div></td><td data-label="手机号">'+esc(fixedCustomerValue(r,'f_phone')||'—')+'</td><td data-label="邮箱">'+esc(fixedCustomerValue(r,'f_email')||'—')+'</td><td data-label="损失金额">'+esc(fixedCustomerValue(r,'f_loss_amount')||'—')+'</td><td data-label="目前进度"><span class="current-progress-text" style="color:'+s.solid+'">'+esc(pl.current)+'</span></td><td data-label="'+(archived?'归档信息':'下一步')+'">'+esc(archiveInfo||'—')+'</td><td data-label="操作"><div class="row nowrap"><button class="btn soft vipflow" data-id="'+r.id+'">维权流程</button><button class="btn soft copycustomer" data-id="'+r.id+'">复制</button>'+(archived?'<button class="btn soft restorecustomer" data-id="'+r.id+'">恢复</button><button class="btn danger delcustomer" data-id="'+r.id+'">永久删除</button>':'<button class="btn soft editcustomer" data-id="'+r.id+'">编辑</button><button class="btn soft archivecustomer" data-id="'+r.id+'">归档</button>')+'<span class="preview-wrap" data-id="'+r.id+'"><button class="eye-btn" type="button">'+eye+'</button></span></div></td></tr>'}).join('')+'</tbody></table></div>'+adminPagerHtml();
  bindPreviewHover(box);bindAdminPager();
  box.querySelectorAll('.editcustomer').forEach(b=>b.onclick=()=>openCustomerEditor(customers.find(x=>x.id===b.dataset.id)));
  box.querySelectorAll('.vipflow').forEach(b=>b.onclick=()=>{const row=customers.find(x=>String(x.id)===String(b.dataset.id));if(row&&window.MosenVIPWorkflow)window.MosenVIPWorkflow.open(row.id,fixedCustomerValue(row,'f_customer_name')||'未命名客户')});
  box.querySelectorAll('.copycustomer').forEach(b=>b.onclick=()=>copyAdminCustomer(customers.find(x=>x.id===b.dataset.id)));
  box.querySelectorAll('.archivecustomer').forEach(b=>b.onclick=()=>archiveAdminCustomer(customers.find(x=>x.id===b.dataset.id)));
  box.querySelectorAll('.restorecustomer').forEach(b=>b.onclick=()=>restoreAdminCustomer(customers.find(x=>x.id===b.dataset.id)));
  box.querySelectorAll('.star-btn').forEach(b=>b.onclick=()=>{const row=customers.find(x=>x.id===b.dataset.id);if(row)setAdminStar(row,!row.starred)});
  box.querySelectorAll('.delcustomer').forEach(b=>b.onclick=async()=>{const row=customers.find(x=>x.id===b.dataset.id);if(!row||!await uiConfirm('永久删除后无法恢复，请确认是否继续。',{title:'永久删除客户',confirmText:'永久删除',danger:true}))return;await writeAdminLog({action_type:'customer_delete',customer_id:row.id,customer_name:fixedCustomerValue(row,'f_customer_name')||'未命名客户',message:'管理员永久删除了归档客户「'+(fixedCustomerValue(row,'f_customer_name')||'未命名客户')+'」'});await base44.entities.VIPCustomer.delete(row.id);await Promise.all([adjustDashboardStat('global',{archived_customers:-1},{scope:'global'}),adjustDashboardStat('rep:'+String(row.rep_username||''),{archived_customers:-1},{scope:'rep',rep_username:String(row.rep_username||'')})]);await loadCustomers({refreshCounts:true})})
}
function adminCurrentEditorState(){
  const data={};customerEditForm.querySelectorAll('[data-key]').forEach(el=>data[el.dataset.key]=el.value);
  const completed_progress_ids=[...document.querySelectorAll('#adminProgressChecklist input[type="checkbox"]:checked')].map(x=>x.dataset.progressId).sort();
  return JSON.stringify({data,completed_progress_ids,rep_username:document.getElementById('editRep').value});
}
function adminDraftKey(){return 'mVIP_draft_admin_'+(editingCustomerId||'none')}
function saveAdminDraft(){if(customerModal.hidden)return;clearTimeout(adminDraftTimer);adminDraftTimer=setTimeout(()=>{try{localStorage.setItem(adminDraftKey(),adminCurrentEditorState())}catch(_){}},250)}
function clearAdminDraft(){try{localStorage.removeItem(adminDraftKey())}catch(_){}}
function adminEditorDirty(){return !customerModal.hidden&&adminCurrentEditorState()!==adminEditorBaseline}
async function requestCloseAdminEditor(){if(adminEditorDirty()&&!await uiConfirm('当前修改尚未保存。已输入内容仍会保存在本机草稿中。',{title:'未保存的修改',confirmText:'仍然关闭',danger:true}))return false;customerModal.hidden=true;return true}
customerEditForm.addEventListener('input',saveAdminDraft);customerEditForm.addEventListener('change',saveAdminDraft);document.getElementById('editRep').addEventListener('change',saveAdminDraft);
function openCustomerEditor(row){
  if(!row)return;editingCustomerId=row.id;
  const active=fields.filter(f=>f.active!==false).sort((a,b)=>(a.order||0)-(b.order||0));
  document.getElementById('editRep').innerHTML=['<option value="">未指定</option>',...reps.map(r=>'<option value="'+esc(r.username)+'" '+(String(row.rep_username||'')===String(r.username||'')?'selected':'')+'>'+esc(r.display_name||r.username)+' ('+esc(r.username)+')</option>')].join('');
  document.getElementById('customerEditFields').innerHTML=buildGroupedFieldControls(active,row.data||{});
  initDateTimeControls(document.getElementById('customerEditFields'));
  renderAdminProgressChecklist(row.completed_progress_ids||[]);
  customerEditNote.hidden=true;customerModal.hidden=false;
  adminEditorBaseline=JSON.stringify({data:row.data||{},completed_progress_ids:(row.completed_progress_ids||[]).map(String).sort(),rep_username:row.rep_username||''});
  try{const raw=localStorage.getItem(adminDraftKey());if(raw){const d=JSON.parse(raw);if(d?.data){document.getElementById('customerEditFields').innerHTML=buildGroupedFieldControls(active,d.data);initDateTimeControls(document.getElementById('customerEditFields'));document.getElementById('editRep').value=d.rep_username||row.rep_username||'';renderAdminProgressChecklist(d.completed_progress_ids||[]);showMessage(customerEditNote,'已恢复上次未保存的草稿。','ok')}}}catch(_){}
}
customerEditForm.onsubmit=async e=>{
  e.preventDefault();
  if(adminCustomerFormSaving)return;
  const row=customers.find(x=>x.id===editingCustomerId);if(!row)return;
  const submitBtn=e.submitter||customerEditForm.querySelector('button[type="submit"]');
  const oldText=submitBtn?.textContent||'保存修改';
  adminCustomerFormSaving=true;
  if(submitBtn){submitBtn.disabled=true;submitBtn.textContent='保存中…';submitBtn.setAttribute('aria-busy','true')}
  const data={...(row.data||{})};customerEditForm.querySelectorAll('[data-key]').forEach(el=>data[el.dataset.key]=el.value);
  try{
    const completed_progress_ids=[...document.querySelectorAll('#adminProgressChecklist input[type="checkbox"]:checked')].map(x=>x.dataset.progressId);
    const newRep=document.getElementById('editRep').value;
    await base44.entities.VIPCustomer.update(row.id,{rep_username:newRep,data,completed_progress_ids,admin_sort_score:completed_progress_ids.length,search_text:buildCustomerSearchText(newRep,data)});
    if(String(newRep)!==String(row.rep_username||'')){
      const active=row.archived!==true?1:0,archived=row.archived===true?1:0,today=(active&&localDateKey(row.created_date)===localDateKey())?1:0;
      await Promise.all([
        adjustDashboardStat('rep:'+String(row.rep_username||''),{active_customers:-active,archived_customers:-archived,today_active_customers:-today},{scope:'rep',rep_username:String(row.rep_username||'')}),
        adjustDashboardStat('rep:'+newRep,{active_customers:active,archived_customers:archived,today_active_customers:today},{scope:'rep',rep_username:newRep})
      ]);
      row.rep_username=newRep;
    }
    clearAdminDraft();adminEditorBaseline=adminCurrentEditorState();showMessage(customerEditNote,'客户资料已更新。','ok');await loadCustomers();
    setTimeout(()=>{customerModal.hidden=true;adminCustomerFormSaving=false;if(submitBtn){submitBtn.disabled=false;submitBtn.textContent=oldText;submitBtn.removeAttribute('aria-busy')}},350);
  }catch(err){
    adminCustomerFormSaving=false;
    if(submitBtn){submitBtn.disabled=false;submitBtn.textContent=oldText;submitBtn.removeAttribute('aria-busy')}
    showMessage(customerEditNote,'保存失败：'+(err?.message||String(err)),'err');
  }
};

document.getElementById('exportBtn').onclick=async()=>{
  const btn=document.getElementById('exportBtn');btn.disabled=true;btn.textContent='正在导出…';
  try{const rows=(await fetchAllAdminCustomers(adminBaseQuery())).filter(matchesAdminFilters);downloadCsv((currentView==='archive'?'归档客户':currentView==='rep'?(currentRepFilter+'_客户数据'):'客户登记数据')+'.csv',[
    ['转主号时间','客户姓名','业务员','手机号','邮箱','损失金额','目前进度','下一步/归档原因'],
    ...rows.map(r=>{const p=progressLabels(r);return [fixedCustomerValue(r,'f_transfer_main_time'),fixedCustomerValue(r,'f_customer_name'),repDisplayName(r.rep_username),fixedCustomerValue(r,'f_phone'),fixedCustomerValue(r,'f_email'),fixedCustomerValue(r,'f_loss_amount'),p.current,r.archived?(r.archive_reason||''):p.next]})
  ])}finally{btn.disabled=false;btn.textContent='导出 CSV'}
};
document.getElementById('customerSearch').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadCustomers({resetPage:true}),450)};
document.getElementById('toggleAdminFilters').onclick=()=>document.getElementById('adminFilters').hidden=!document.getElementById('adminFilters').hidden;
document.getElementById('clearAdminFilters').onclick=()=>{document.getElementById('adminRepFilter').value='';document.getElementById('adminStarFilter').value='';document.getElementById('adminProgressFilter').value='';document.getElementById('adminCountryFilter').value='';document.getElementById('customerSearch').value='';loadCustomers({resetPage:true})};
['adminRepFilter','adminStarFilter','adminProgressFilter'].forEach(id=>document.getElementById(id).addEventListener('change',()=>loadCustomers({resetPage:true})));
document.getElementById('adminCountryFilter').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadCustomers({resetPage:true}),450)});
document.getElementById('refreshCustomers').onclick=async()=>{await loadCustomers();await refreshCustomerCounts()};
document.getElementById('refreshReps').onclick=loadReps;
document.getElementById('closeCustomerModal').onclick=requestCloseAdminEditor;document.getElementById('cancelCustomerEdit').onclick=requestCloseAdminEditor;
document.getElementById('logDate').onchange=()=>loadLogs(true);
document.getElementById('logSearch').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadLogs(true),350)};
document.getElementById('refreshLogs').onclick=()=>loadLogs(true);
document.getElementById('exportBackup').onclick=exportBusinessBackup;
document.getElementById('importBackup').onclick=()=>document.getElementById('backupFile').click();
document.getElementById('backupFile').onchange=async e=>{const file=e.target.files?.[0];if(file)await importAnyBackup(file);e.target.value=''};
document.getElementById('logoutBtn').onclick=()=>{localStorage.removeItem('mVIP_admin');location.reload()};
if(localStorage.getItem('mVIP_admin')==='1')enter();
