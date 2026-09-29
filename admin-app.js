import { createBackupController } from './backup-ui.js?v=20260929-safe-backup1';
import { base44, esc, showMessage, buildFieldControl, buildGroupedFieldControls, initDateTimeControls, formatDate, downloadCsv, uiAlert, uiConfirm, uiPrompt, localDateKey, buildCustomerSearchText, readDashboardStat, adjustDashboardStat, createEntityBatch } from './base44.js';
import { customerSearchFields, initGlobalSearch } from './vip-optimizations.js?v=20260929-stable-load1';
import { createCustomerStore, customerPage as selectCustomerPage, customerNotice, subscribeCustomerRefresh, retryRead, recordRows } from './customer-loader.js?v=20260929-stable-load1';
const ADMIN_HASH='78fd5f1e5a3f6eef05ab8d692942fd0ff4a8f4cc0e6087026626006a7fae452d';
let reps=[],fields=[],customers=[],progressStages=[],editingCustomerId=null,draggedFieldId=null,dragSaving=false,draggedProgressId=null,progressDragSaving=false,editingFieldTypeId=null;
let currentView='all',currentRepFilter='';
const CUSTOMER_PAGE_SIZE=50;
let customerPage=1,customerHasNext=false,totalCustomerCount=0,totalArchivedCount=0,customerCountByRep={},archivedCountByRep={},customerCountTimer=null,globalCustomerRows=null,searchTimer=null,adminEditorBaseline='',adminDraftTimer=null;
let adminCustomerFormSaving=false;
let customerLoadSequence=0, customerHasSnapshot=false, adminSubscriptionsStarted=false;
let customerSessionStorage;try{customerSessionStorage=sessionStorage}catch(_){}
const customerStore=createCustomerStore(base44.entities.VIPCustomer,{cacheKey:'mVIP_customer_snapshot_v1_admin',storage:customerSessionStorage});
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
    customerPage=1;return loadCustomers({resetPage:true});
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
  // A normal page visit must never replay a historical backup or perform bulk writes.
  await showAdminView('all');
  await loadReps();await loadFields();await loadProgress();
  if(customerHasSnapshot)renderCustomers();
  if(adminSubscriptionsStarted)return;
  adminSubscriptionsStarted=true;
  try{
    let repTimer=0,fieldTimer=0,progressTimer=0,logTimer=0;
    base44.entities.VIPSalesRep.subscribe(()=>{clearTimeout(repTimer);repTimer=setTimeout(()=>{if(!window.MVIP_MAINTENANCE)loadReps()},800)});
    base44.entities.VIPFormField.subscribe(()=>{clearTimeout(fieldTimer);fieldTimer=setTimeout(async()=>{if(window.MVIP_MAINTENANCE||dragSaving)return;await loadFields();if(customerHasSnapshot)renderCustomers()},800)});
    base44.entities.VIPProgressStage.subscribe(()=>{clearTimeout(progressTimer);progressTimer=setTimeout(async()=>{if(window.MVIP_MAINTENANCE||progressDragSaving)return;await loadProgress();if(customerHasSnapshot)renderCustomers()},800)});
    subscribeCustomerRefresh(base44.entities.VIPCustomer,()=>loadCustomers({force:true}),{blocked:()=>!!window.MVIP_MAINTENANCE});
    base44.entities.VIPActivityLog.subscribe(()=>{clearTimeout(logTimer);logTimer=setTimeout(()=>{if(!window.MVIP_MAINTENANCE&&currentView==='logs')loadLogs()},800)});
  }catch(error){console.warn('Realtime updates unavailable',error)}
  initGlobalSearch({base44,role:'admin',onCustomer:openGlobalAdminCustomer,onWorkflow:()=>showAdminView('workflows')});
  window.addEventListener('online',()=>loadCustomers());
}

document.getElementById('adminLogin').onclick=async()=>{
  const p=document.getElementById('adminPassword').value;
  if(!p){showMessage(loginNote,'请输入管理员密码。','err');return}
  if(await sha256(p)!==ADMIN_HASH){showMessage(loginNote,'管理员密码错误。','err');return}
  localStorage.setItem('mVIP_admin','1');await enter()
};

async function loadReps(){
  try{
    reps=recordRows(await retryRead(()=>base44.entities.VIPSalesRep.list('-created_date',500,0)));
    document.getElementById('salesCount').textContent=reps.length;
    const rf=document.getElementById('adminRepFilter');if(rf){const selected=rf.value;rf.innerHTML='<option value="">全部业务员</option>'+reps.map(r=>'<option value="'+esc(r.username)+'">'+esc(r.display_name||r.username)+'</option>').join('');rf.value=selected;}
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
    const current=recordRows(await retryRead(()=>base44.entities.VIPSalesRep.list('-created_date',500,0)));
    if(current.some(r=>String(r.username||'').toLowerCase()===username.toLowerCase())){showMessage(note,'这个用户名已经存在。','err');return}
    await base44.entities.VIPSalesRep.create({username,display_name});showMessage(note,'业务员用户名已创建：'+username,'ok');
    document.getElementById('repUsername').value='';document.getElementById('repDisplayName').value='';await loadReps()
  }catch(err){showMessage(note,'创建失败：'+(err?.message||String(err)),'err')}
};

async function loadFields(){
  try{
    fields=recordRows(await retryRead(()=>base44.entities.VIPFormField.list('order',500,0))).sort((a,b)=>(a.order||0)-(b.order||0));
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
      if(!msg.includes('rate limit')&&!msg.includes('429')&&!msg.includes('traffic volume limit')&&!msg.includes('too many requests'))throw err;
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
    progressStages=recordRows(await retryRead(()=>base44.entities.VIPProgressStage.list('order',500,0))).filter(x=>x.active!==false).sort((a,b)=>(a.order||0)-(b.order||0));
    document.getElementById('sidebarProgressCount').textContent=progressStages.length;const pf=document.getElementById('adminProgressFilter');if(pf){const selected=pf.value;pf.innerHTML='<option value="">全部进度</option>'+progressStages.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.label)+'</option>').join('');pf.value=selected;}renderProgress();
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
// All backup versions use one non-destructive recovery engine.
function downloadBackupObject(backup,filename){
  const blob=new Blob([JSON.stringify(backup)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
const backupController=createBackupController({
  api:base44,
  show:(text,type)=>showMessage(document.getElementById('backupNote'),text,type),
  confirm:uiConfirm,
  download:downloadBackupObject,
  setMaintenance:value=>{window.MVIP_MAINTENANCE=value;++customerLoadSequence},
  refresh:async()=>{await loadCustomers({force:true});await loadReps();await loadFields();await loadProgress()}
});
async function exportBusinessBackup(){return backupController.exportBackup()}
async function importAnyBackup(file){return backupController.importBackup(file)}
const recoverSafetyButton=document.getElementById('recoverSafetyBackup');
if(recoverSafetyButton)recoverSafetyButton.onclick=()=>backupController.downloadSafety();

async function fetchAllAdminCustomers(query){
  const all=[];let skip=0;
  while(true){const batch=unwrap(await base44.entities.VIPCustomer.filter(query,'-admin_sort_score',500,skip));all.push(...batch);if(batch.length<500)break;skip+=500;if(skip>10000)break}
  return all;
}
function adminBaseQuery(){
  const q={archived:currentView==='archive',duplicate_record:{$ne:true}};
  if(currentView==='rep'&&currentRepFilter)q.rep_username=currentRepFilter;
  const chosen=document.getElementById('adminRepFilter')?.value||'';
  if(currentView!=='rep'&&chosen)q.rep_username=chosen;
  return q;
}
function adminFilterActive(){
  return !!((document.getElementById('customerSearch')?.value||'').trim()||(document.getElementById('adminStarFilter')?.value||'')||(document.getElementById('adminProgressFilter')?.value||'')||(document.getElementById('adminCountryFilter')?.value||'').trim()||(currentView!=='rep'&&(document.getElementById('adminRepFilter')?.value||'')));
}
function matchesAdminFilters(r){
  if(r?.duplicate_record===true)return false;
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
function applyCustomerSnapshot(snapshot){
  const rep=currentView==='rep'?currentRepFilter:(document.getElementById('adminRepFilter')?.value||'');
  const selected=selectCustomerPage(snapshot.rows,{archived:currentView==='archive',repUsername:rep,matches:matchesAdminFilters,sort:'admin_sort_score',page:customerPage,pageSize:CUSTOMER_PAGE_SIZE});
  customers=selected.rows;globalCustomerRows=selected.filtered;customerPage=selected.page;customerHasNext=selected.hasNext;
  customerHasSnapshot=true;
  applyCustomerCounts(snapshot.rows);
  renderCustomers();
}
async function fetchCustomerPage(options){return customerStore.read(options)}
function applyCustomerCounts(rows){
  let active=0,archived=0,counts={},archiveCounts={};
  for(const row of rows){if(row.duplicate_record===true)continue;const key=String(row.rep_username||'');if(row.archived===true){archived++;archiveCounts[key]=(archiveCounts[key]||0)+1}else{active++;counts[key]=(counts[key]||0)+1}}
  totalCustomerCount=active;totalArchivedCount=archived;customerCountByRep=counts;archivedCountByRep=archiveCounts;
  document.getElementById('totalCustomers').textContent=active;document.getElementById('allCustomerCount').textContent=active;
  document.getElementById('archivedCustomerCount').textContent=archived;document.getElementById('archivedCustomersStat').textContent=archived;
  renderSidebar();renderReps();
}
async function refreshCustomerCounts(){
  const snapshot=customerStore.peek();
  if(snapshot)applyCustomerCounts(snapshot.rows);
}
function scheduleCustomerCountRefresh(){clearTimeout(customerCountTimer);customerCountTimer=setTimeout(()=>loadCustomers(),1000)}
async function loadCustomers({resetPage=false,refreshCounts=false,force=false}={}){
  if(window.MVIP_MAINTENANCE)return;
  const sequence=++customerLoadSequence,box=document.getElementById('customerList');
  if(resetPage)customerPage=1;
  const saved=customerStore.peek();
  if(saved)applyCustomerSnapshot(saved);
  customerNotice(box,saved?'正在更新客户，当前显示上次成功读取的数据…':'正在读取客户资料…');
  try{
    const snapshot=await fetchCustomerPage({fresh:force||refreshCounts});
    if(sequence!==customerLoadSequence||window.MVIP_MAINTENANCE)return;
    applyCustomerSnapshot(snapshot);
    customerNotice(box,snapshot.stale?'暂时无法连接服务器，保留上次成功读取的数据（'+new Date(snapshot.at).toLocaleTimeString()+'），请重试。':'',snapshot.stale?()=>loadCustomers():null);
  }catch(error){
    if(sequence!==customerLoadSequence)return;
    customerNotice(box,'客户读取失败，'+(customerHasSnapshot?'已保留之前显示的资料。':'尚未取得客户资料，不能判断为零客户。')+' '+(error?.message||''),()=>loadCustomers());
  }
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
document.getElementById('logoutBtn').onclick=()=>{customerStore.clear();localStorage.removeItem('mVIP_admin');location.reload()};
if(localStorage.getItem('mVIP_admin')==='1')enter();
