import { createClient } from 'https://esm.sh/@base44/sdk@0.8.52?bundle';
import { APP_ID } from './config.js?v=20260929-standalone-2';

export const base44 = createClient({ appId: APP_ID });
export const createIsolatedClient = () => createClient({ appId: APP_ID });

export function esc(value = '') {
  return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
}

export function localDateKey(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value || '').slice(0,10);
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
  return y+'-'+m+'-'+day;
}

export function buildCustomerSearchText(repUsername = '', data = {}) {
  const values=[repUsername];
  const walk=v=>{
    if(v==null)return;
    if(Array.isArray(v)){v.forEach(walk);return}
    if(typeof v==='object'){Object.values(v).forEach(walk);return}
    values.push(String(v));
  };
  walk(data);
  return values.join(' ').replace(/\s+/g,' ').trim().toLowerCase();
}

const statQueues=new Map();
export async function readDashboardStat(key){
  const rows=await base44.entities.VIPDashboardStats.filter({key:String(key)},'-updated_date',1,0);
  return Array.isArray(rows)?rows[0]:(rows?.items||[])[0]||null;
}

export function adjustDashboardStat(key,deltas={},meta={}){
  const k=String(key);
  const prev=statQueues.get(k)||Promise.resolve();
  const next=prev.catch(()=>{}).then(async()=>{
    let row=await readDashboardStat(k);
    const base=row||{
      key:k,
      scope:meta.scope|| (k==='global'?'global':'rep'),
      rep_username:meta.rep_username|| (k.startsWith('rep:')?k.slice(4):''),
      active_customers:0,archived_customers:0,today_active_customers:0,version:0
    };
    const payload={
      key:k,
      scope:base.scope||meta.scope||'rep',
      rep_username:base.rep_username||meta.rep_username||'',
      active_customers:Math.max(0,Number(base.active_customers||0)+Number(deltas.active_customers||0)),
      archived_customers:Math.max(0,Number(base.archived_customers||0)+Number(deltas.archived_customers||0)),
      today_active_customers:Math.max(0,Number(base.today_active_customers||0)+Number(deltas.today_active_customers||0)),
      updated_at:new Date().toISOString(),
      version:Number(base.version||0)+1
    };
    if(row)await base44.entities.VIPDashboardStats.update(row.id,payload);
    else row=await base44.entities.VIPDashboardStats.create(payload);
    return {...base,...payload,id:row?.id||base.id};
  }).finally(()=>{if(statQueues.get(k)===next)statQueues.delete(k)});
  statQueues.set(k,next);
  return next;
}

export async function createEntityBatch(entityHandler,records,concurrency=6){
  const rows=(records||[]).filter(Boolean);
  if(!rows.length)return [];
  if(typeof entityHandler.bulkCreate==='function'){
    try{return await entityHandler.bulkCreate(rows)}catch(_){}
  }
  const result=new Array(rows.length);
  let index=0;
  async function worker(){
    while(true){
      const i=index++;if(i>=rows.length)return;
      result[i]=await entityHandler.create(rows[i]);
    }
  }
  await Promise.all(Array.from({length:Math.min(concurrency,rows.length)},()=>worker()));
  return result;
}

export function showMessage(el, text, type = '') {
  if (!el) return;
  el.textContent = text;
  el.className = 'notice' + (type ? ' ' + type : '');
  el.hidden = false;
}

export function hideMessage(el) {
  if (el) el.hidden = true;
}

export function buildFieldControl(field, value = '') {
  const required = field.required ? 'required' : '';
  const star = field.required ? ' <span class="req">*</span>' : '';
  const key = esc(field.field_key);
  const label = `<label>${esc(field.label)}${star}</label>`;

  if (field.field_type === 'textarea') {
    return `<div class="field">${label}<textarea data-key="${key}" ${required}>${esc(value)}</textarea></div>`;
  }

  if (field.field_type === 'select') {
    const opts = String(field.options || '').split(',').map(x => x.trim()).filter(Boolean);
    const html = opts.map(o => `<option value="${esc(o)}" ${String(value) === o ? 'selected' : ''}>${esc(o)}</option>`).join('');
    return `<div class="field">${label}<select data-key="${key}" ${required}><option value="">请选择</option>${html}</select></div>`;
  }

  if (field.field_type === 'date' || field.field_type === 'datetime') {
    const raw = String(value || '').replace(' ', 'T');
    let date = '', hour = '00', minute = '00';
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) date = raw.slice(0,10);
    if (/T\d{2}:\d{2}/.test(raw)) {
      hour = raw.slice(11,13);
      minute = raw.slice(14,16);
    }
    const hours = Array.from({length:24},(_,i)=>String(i).padStart(2,'0'))
      .map(h=>`<option value="${h}" ${h===hour?'selected':''}>${h}</option>`).join('');
    const minutes = Array.from({length:60},(_,i)=>String(i).padStart(2,'0'))
      .map(m=>`<option value="${m}" ${m===minute?'selected':''}>${m}</option>`).join('');
    const ampm = Number(hour) >= 12 ? 'PM' : 'AM';
    return `<div class="field datetime-field">${label}
      <div class="datetime-24h" data-datetime-wrap>
        <input class="dt-date" type="date" value="${esc(date)}" data-dt-date ${required}>
        <select class="dt-hour" data-dt-hour aria-label="小时">${hours}</select>
        <span class="dt-sep">:</span>
        <select class="dt-minute" data-dt-minute aria-label="分钟">${minutes}</select>
        <span class="dt-ampm" data-dt-ampm>${ampm}</span>
        <input type="hidden" data-key="${key}" value="${esc(date ? date+'T'+hour+':'+minute : '')}" data-dt-value>
      </div>
    </div>`;
  }

  const type = ({number:'number',email:'email',tel:'tel'}[field.field_type] || 'text');
  return `<div class="field">${label}<input type="${type}" data-key="${key}" value="${esc(value)}" ${required}></div>`;
}

export function buildGroupedFieldControls(fields, data = {}) {
  const sorted=[...(fields||[])].sort((a,b)=>(a.order||0)-(b.order||0));
  const emitted=new Set();
  return sorted.map(field=>{
    const group=String(field.group_name||'').trim();
    if(!group)return buildFieldControl(field,data[field.field_key]??'');
    if(emitted.has(group))return '';
    emitted.add(group);
    const groupFields=sorted.filter(x=>String(x.group_name||'').trim()===group);
    return `<section class="field-group-block">
      <div class="field-group-title">${esc(group)}</div>
      <div class="field-group-grid">${groupFields.map(f=>buildFieldControl(f,data[f.field_key]??'')).join('')}</div>
    </section>`;
  }).join('');
}

export function initDateTimeControls(root = document) {
  root.querySelectorAll('[data-datetime-wrap]').forEach(wrap => {
    if (wrap.dataset.ready === '1') return;
    wrap.dataset.ready = '1';
    const date = wrap.querySelector('[data-dt-date]');
    const hour = wrap.querySelector('[data-dt-hour]');
    const minute = wrap.querySelector('[data-dt-minute]');
    const ampm = wrap.querySelector('[data-dt-ampm]');
    const hidden = wrap.querySelector('[data-dt-value]');
    const sync = () => {
      const h = hour.value || '00';
      ampm.textContent = Number(h) >= 12 ? 'PM' : 'AM';
      hidden.value = date.value ? date.value + 'T' + h + ':' + (minute.value || '00') : '';
    };
    date.addEventListener('change', sync);
    hour.addEventListener('change', sync);
    minute.addEventListener('change', sync);
    sync();
  });
}

export function formatDate(value) {
  if (!value) return '';
  const raw = String(value).replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return String(value);
  const date = raw.slice(0,10);
  if (!/T\d{2}:\d{2}/.test(raw)) return date;
  const hour = raw.slice(11,13), minute = raw.slice(14,16);
  const ampm = Number(hour) >= 12 ? 'PM' : 'AM';
  return date + ' ' + hour + ':' + minute + ' ' + ampm;
}

export function downloadCsv(filename, rows) {
  const csv = rows.map(row => row.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['\ufeff' + csv], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(a.href);
  a.remove();
}


function ensureUiDialogHost(){
  let host=document.getElementById('m717UiDialogHost');
  if(host)return host;
  host=document.createElement('div');
  host.id='m717UiDialogHost';
  host.className='ui-dialog-host';
  host.hidden=true;
  host.innerHTML='<div class="ui-dialog-backdrop" data-ui-dialog-backdrop></div><div class="ui-dialog-card" role="dialog" aria-modal="true"><div class="ui-dialog-icon" data-ui-dialog-icon>!</div><div class="ui-dialog-content"><div class="ui-dialog-title" data-ui-dialog-title></div><div class="ui-dialog-message" data-ui-dialog-message></div><div class="ui-dialog-input-wrap" data-ui-dialog-input-wrap hidden></div></div><div class="ui-dialog-actions"><button class="btn soft" type="button" data-ui-dialog-cancel>取消</button><button class="btn primary" type="button" data-ui-dialog-confirm>确定</button></div></div>';
  document.body.appendChild(host);
  return host;
}
function openUiDialog({title='提示',message='',confirmText='确定',cancelText='取消',showCancel=false,danger=false,input=false,textarea=false,placeholder='',value=''}={}){
  return new Promise(resolve=>{
    const host=ensureUiDialogHost();
    const titleEl=host.querySelector('[data-ui-dialog-title]');
    const msgEl=host.querySelector('[data-ui-dialog-message]');
    const icon=host.querySelector('[data-ui-dialog-icon]');
    const wrap=host.querySelector('[data-ui-dialog-input-wrap]');
    const cancel=host.querySelector('[data-ui-dialog-cancel]');
    const confirm=host.querySelector('[data-ui-dialog-confirm]');
    titleEl.textContent=title;
    msgEl.textContent=message;
    cancel.textContent=cancelText;
    confirm.textContent=confirmText;
    cancel.hidden=!showCancel;
    confirm.className='btn '+(danger?'danger':'primary');
    icon.textContent=danger?'!':'✓';
    icon.className='ui-dialog-icon '+(danger?'danger':'');
    wrap.innerHTML='';
    wrap.hidden=!input;
    let editor=null;
    if(input){
      editor=document.createElement(textarea?'textarea':'input');
      editor.className='ui-dialog-input';
      editor.placeholder=placeholder;
      editor.value=value||'';
      if(textarea)editor.rows=4;
      wrap.appendChild(editor);
    }
    host.hidden=false;
    document.body.classList.add('ui-dialog-open');
    const finish=result=>{
      host.hidden=true;
      document.body.classList.remove('ui-dialog-open');
      confirm.onclick=null;cancel.onclick=null;
      host.querySelector('[data-ui-dialog-backdrop]').onclick=null;
      document.removeEventListener('keydown',onKey);
      resolve(result);
    };
    const onKey=e=>{
      if(e.key==='Escape'){e.preventDefault();finish(input?null:false)}
      if(e.key==='Enter'&&!textarea){e.preventDefault();confirm.click()}
    };
    confirm.onclick=()=>finish(input?(editor?.value??''):true);
    cancel.onclick=()=>finish(input?null:false);
    host.querySelector('[data-ui-dialog-backdrop]').onclick=()=>finish(input?null:false);
    document.addEventListener('keydown',onKey);
    setTimeout(()=>{(editor||confirm).focus()},0);
  });
}
export function uiAlert(message,options={}){
  return openUiDialog({title:options.title||'提示',message,confirmText:options.confirmText||'知道了',danger:!!options.danger});
}
export function uiConfirm(message,options={}){
  return openUiDialog({title:options.title||'请确认',message,confirmText:options.confirmText||'确定',cancelText:options.cancelText||'取消',showCancel:true,danger:!!options.danger});
}
export function uiPrompt(message,options={}){
  return openUiDialog({title:options.title||'请输入',message,confirmText:options.confirmText||'继续',cancelText:options.cancelText||'取消',showCancel:true,danger:!!options.danger,input:true,textarea:options.textarea!==false,placeholder:options.placeholder||'',value:options.value||''});
}
