import { retryRead, recordRows } from './customer-loader.js?v=20260929-stable-load1';

export const FORMAT='MOSEN_VIP_BUSINESS_DATA_BACKUP';
export const APP_ID='6abb8b9e7bc76cdfe0aeb883';
export const CORE=['VIPSalesRep','VIPFormField','VIPProgressStage','VIPCustomer','VIPActivityLog','VIPActivityLogArchive','VIPWorkflowDefinition','VIPWorkflowProgress','VIPWorkflowFlowProgress'];
export const ENTITIES=[...CORE,'VIPToolCatalog','VIPAssetIndex','VIPDashboardStats','VIPSystemStats'];
const DERIVED=new Set(['VIPDashboardStats','VIPSystemStats']);
const SYSTEM=new Set(['id','__old_id','created_date','updated_date','created_by','created_by_id','is_sample']);
const LEGACY=new Set(['VIPSalesRep','VIPFormField','VIPProgressStage','VIPCustomer','VIPActivityLog']);
const oldId=row=>String(row.__old_id||row.id||'');
const clone=value=>JSON.parse(JSON.stringify(value));
export function canonical(value){
  if(Array.isArray(value))return '['+value.map(item=>canonical(item)??'null').join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export async function digest(text){
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
function clean(row){return Object.fromEntries(Object.entries(clone(row)).filter(([key])=>!SYSTEM.has(key)))}
export function counts(entities){
  const all=entities.VIPCustomer||[],visible=all.filter(r=>r.duplicate_record!==true);
  return {tables:Object.fromEntries(Object.entries(entities).map(([name,rows])=>[name,rows.length])),customers:visible.length,active:visible.filter(r=>r.archived!==true).length,archived:visible.filter(r=>r.archived===true).length};
}
export async function readTable(handler,{retryOptions,pageSize=500}={}){
  const all=[],ids=new Set();
  for(let skip=0;;skip+=pageSize){
    const rows=await retryRead(async()=>recordRows(await handler.list('id',pageSize,skip)),retryOptions);
    for(const row of rows){if(ids.has(String(row.id)))throw Error('分页结果重复，已停止备份');ids.add(String(row.id));all.push(row)}
    if(rows.length<pageSize)return all;
    if(skip>=100000)throw Error('数据超过本次读取上限，未生成不完整备份');
  }
}
export async function captureSnapshot(api,{names=ENTITIES,progress=()=>{},retryOptions}={}){
  const scan=async()=>{const result={};for(const name of names){progress('正在读取 '+name);result[name]=await readTable(api.entities[name],{retryOptions})}return result};
  const started_at=new Date().toISOString(),first=await scan(),second=await scan();
  if(canonical(first)!==canonical(second))throw Error('备份期间数据发生变化，请稍后重新备份；本次未生成混合快照');
  return {started_at,completed_at:new Date().toISOString(),entities:second};
}
export async function makeBackup(snapshot){
  const missing_assets=snapshot.missing_assets||[];
  const payload={app_id:APP_ID,started_at:snapshot.started_at,completed_at:snapshot.completed_at,entities:snapshot.entities,assets:snapshot.assets||[],missing_assets,attachment_policy:missing_assets.length?'embedded-with-missing':snapshot.assets?'embedded':'links-only'};
  return {format:FORMAT,version:2,exported_at:new Date().toISOString(),payload,counts:counts(payload.entities),checksum_sha256:await digest(canonical(payload))};
}

export function validateEntities(entities,{required=CORE}={}){
  if(!entities||typeof entities!=='object'||Array.isArray(entities))throw Error('备份数据表格式不正确');
  for(const name of required)if(!Array.isArray(entities[name]))throw Error('备份缺少 '+name);
  for(const [name,rows] of Object.entries(entities)){
    if(!ENTITIES.includes(name))throw Error('备份包含不支持的数据表：'+name);
    if(!Array.isArray(rows)||rows.length>100000)throw Error(name+' 数据格式或数量不正确');
    const ids=new Set();
    for(const row of rows){
      if(!row||typeof row!=='object'||Array.isArray(row)||!oldId(row))throw Error(name+' 存在缺少原始 ID 的记录');
      if(ids.has(oldId(row)))throw Error(name+' 原始 ID 重复');ids.add(oldId(row));
    }
  }
  for(const name of ['VIPSalesRep','VIPFormField','VIPWorkflowDefinition']){
    const field={VIPSalesRep:'username',VIPFormField:'field_key',VIPWorkflowDefinition:'key'}[name],seen=new Set();
    for(const row of entities[name]||[]){if(!row[field]||seen.has(String(row[field])))throw Error(name+' 标识缺失或重复');seen.add(String(row[field]))}
  }
  const reps=new Set((entities.VIPSalesRep||[]).map(r=>r.username));
  for(const name of ['VIPCustomer','VIPProgressStage']){
    const seen=new Set();for(const row of entities[name]||[]){const key=String(row.legacy_source_id||oldId(row));if(seen.has(key))throw Error(name+' 恢复标识重复');seen.add(key)}
  }
  const types=new Set(['text','number','date','datetime','email','tel','textarea','select']);
  for(const field of entities.VIPFormField||[])if(!types.has(field.field_type))throw Error('登记字段类型不支持');
  const progress=new Set((entities.VIPProgressStage||[]).map(oldId));
  for(const customer of entities.VIPCustomer||[]){
    if(!reps.has(customer.rep_username))throw Error('客户归属的业务员不在备份中');
    if(!customer.data||typeof customer.data!=='object'||Array.isArray(customer.data))throw Error('客户资料格式不正确');
    if(customer.completed_progress_ids!=null&&!Array.isArray(customer.completed_progress_ids))throw Error('客户进度格式不正确');
    if((customer.completed_progress_ids||[]).some(id=>!progress.has(String(id))))throw Error('客户引用了备份中不存在的进度，恢复已停止');
    for(const flag of ['archived','starred','duplicate_record'])if(customer[flag]!=null&&typeof customer[flag]!=='boolean')throw Error('客户状态字段格式不正确');
  }
  return entities;
}

export async function parseBackup(raw){
  if(raw?.format===FORMAT&&Number(raw.version)===2){
    if(raw.payload?.app_id!==APP_ID)throw Error('备份不属于当前客户系统');
    if(await digest(canonical(raw.payload))!==raw.checksum_sha256)throw Error('备份完整性校验失败');
    const assets=raw.payload.assets||[],missing=raw.payload.missing_assets||[],policy=raw.payload.attachment_policy;
    if(!Array.isArray(assets)||!Array.isArray(missing)||!['embedded','embedded-with-missing','links-only'].includes(policy))throw Error('附件清单格式不正确');
    for(const asset of assets){
      if(!asset.old_url||typeof asset.content!=='string'||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(asset.content)||await digest(asset.content)!==asset.checksum_sha256)throw Error('附件完整性校验失败');
      if(asset.size!=null&&atob(asset.content).length!==Number(asset.size))throw Error('附件长度校验失败');
    }
    if(policy==='embedded'||policy==='embedded-with-missing'){
      if(policy==='embedded'&&missing.length)throw Error('完整附件备份不能包含缺失附件');
      const referenced=new Set(attachmentRefs(raw.payload.entities).map(ref=>ref.old_url));
      if(missing.some(ref=>!ref||!referenced.has(ref.old_url)||typeof ref.reason!=='string'||!ref.reason.trim()))throw Error('缺失附件清单不正确');
      const urls=[...assets,...missing].map(asset=>asset.old_url),known=new Set(urls);
      if(known.size!==urls.length||attachmentRefs(raw.payload.entities).some(ref=>!known.has(ref.old_url)))throw Error('备份附件清单不完整或重复');
    }
    return {entities:validateEntities(raw.payload.entities),assets,missing_assets:missing,attachment_policy:policy,checksum:raw.checksum_sha256,version:2};
  }
  const business=raw?.format===FORMAT&&Number(raw.version)===1;
  const full=raw?.format==='MOSEN_VIP_FULL_BACKUP'&&Number(raw.version)===4;
  const legacy=raw?.format==='MOSEN717_FULL_BACKUP'&&[1,2,3].includes(Number(raw.version||1));
  if(!business&&!full&&!legacy)throw Error('不支持的备份格式或版本');
  const signed=full?{entities:raw.entities,repository:raw.repository}:raw.entities;
  // Unchecked legacy files are never allowed to trigger writes.
  if(!raw.checksum_sha256||await digest(JSON.stringify(signed))!==raw.checksum_sha256)throw Error('备份完整性校验失败或缺少校验码');
  let entities=clone(raw.entities);
  if(legacy&&!entities.VIPCustomer){
    const aliases={SalesRep:'VIPSalesRep',FormField:'VIPFormField',ProgressStage:'VIPProgressStage',Customer:'VIPCustomer',ActivityLog:'VIPActivityLog'};
    entities=Object.fromEntries(Object.entries(entities).map(([k,v])=>[aliases[k]||k,v]));
    for(const name of CORE)if(!entities[name]&&!['VIPSalesRep','VIPFormField','VIPProgressStage','VIPCustomer','VIPActivityLog'].includes(name))entities[name]=[];
  }
  return {entities:validateEntities(entities),checksum:raw.checksum_sha256,version:Number(raw.version)};
}

function identity(name,row){
  if(name==='VIPSalesRep')return ['username',row.username];
  if(name==='VIPFormField')return ['field_key',row.field_key];
  if(name==='VIPWorkflowDefinition'||name==='VIPToolCatalog')return ['key',row.key];
  if(name==='VIPWorkflowFlowProgress')return ['unique_key',row.customer_id+'::'+row.flow_id];
  if(name==='VIPWorkflowProgress')return ['customer_id',row.customer_id];
  if(name==='VIPActivityLogArchive')return ['original_id',row.original_id||oldId(row)];
  if(name==='VIPAssetIndex')return ['sha256',row.sha256];
  if(LEGACY.has(name))return ['legacy_source_id',row.legacy_source_id||oldId(row)];
  throw Error('无法安全识别 '+name);
}
function findMatch(name,source,payload,live){
  const [key,value]=identity(name,payload);
  if(!value)throw Error(name+' 缺少稳定标识，无法安全恢复');
  const matches=live.filter(row=>String(row.id)===oldId(source)||(row[key]!=null&&String(row[key])===String(value)));
  if(matches.length>1){
    if(['VIPCustomer','VIPProgressStage','VIPSalesRep','VIPFormField'].includes(name))throw Error(name+' 存在多个相同标识，已停止，避免恢复到错误记录');
    return {...matches[0],__restoreConflict:true};
  }
  return matches[0];
}
function equivalent(existing,payload){
  if(existing.__restoreConflict)return false;
  // Source can omit optional defaults. Only compare the fields actually present in it.
  return Object.entries(payload).every(([key,value])=>canonical(existing[key]??null)===canonical(value??null));
}
function remap(name,source,maps){
  const payload=clean(source);
  if(LEGACY.has(name)&&!payload.legacy_source_id)payload.legacy_source_id=oldId(source);
  if(name==='VIPActivityLogArchive'&&!payload.original_id)payload.original_id=oldId(source);
  if(name==='VIPCustomer'){
    const owner=maps.repUsernames.get(String(payload.rep_username));
    if(!owner)throw Error('缺少业务员归属映射');payload.rep_username=owner;
    const data={};
    for(const [key,value] of Object.entries(payload.data||{})){
      const mapped=maps.fieldKeys.get(key)||key;if(Object.hasOwn(data,mapped))throw Error('登记字段映射冲突，未写入客户资料');data[mapped]=value;
    }
    payload.data=data;
    payload.completed_progress_ids=(payload.completed_progress_ids||[]).map(id=>{
    const mapped=maps.VIPProgressStage.get(String(id));if(!mapped)throw Error('缺少客户进度映射');return mapped;
    });
  }
  if(payload.customer_id){
    const mapped=maps.VIPCustomer.get(String(payload.customer_id));
    if(mapped)payload.customer_id=mapped;
    else if(name==='VIPWorkflowProgress'||name==='VIPWorkflowFlowProgress')return null;
    // Logs referencing historically deleted customers remain historical records.
  }
  if(/^progress_/.test(payload.action_type||'')&&maps.VIPProgressStage.has(String(payload.target_key)))payload.target_key=maps.VIPProgressStage.get(String(payload.target_key));
  else if(maps.fieldKeys.has(String(payload.target_key)))payload.target_key=maps.fieldKeys.get(String(payload.target_key));
  if(name==='VIPWorkflowFlowProgress')payload.unique_key=payload.customer_id+'::'+payload.flow_id;
  return payload;
}

export function planRestore(entities,current){
  validateEntities(entities);
  const maps={VIPProgressStage:new Map(),VIPCustomer:new Map(),repUsernames:new Map(),fieldKeys:new Map()},operations=[];
  for(const name of ENTITIES){
    if(DERIVED.has(name))continue;
    for(const source of entities[name]||[]){
      const payload=remap(name,source,maps),key=name+':'+oldId(source);
      if(!payload){operations.push({name,key,source,status:'unresolved'});continue}
      const match=findMatch(name,source,payload,current[name]||[]);
      const status=match?(equivalent(match,payload)?'existing':'conflict'):'create';
      const op={name,key,source,payload,status,existingId:match?.id};operations.push(op);
      if(maps[name])maps[name].set(oldId(source),String(match?.id||'pending:'+key));
      if(name==='VIPSalesRep')maps.repUsernames.set(String(source.username),String(match?.username||payload.username));
      if(name==='VIPFormField')maps.fieldKeys.set(String(source.field_key),String(match?.field_key||payload.field_key));
    }
  }
  return {operations,summary:operations.reduce((out,op)=>(out[op.status]=(out[op.status]||0)+1,out),{create:0,existing:0,conflict:0,unresolved:0})};
}

export async function executeRestore(api,entities,{journal,persist,progress=()=>{},retryOptions,assetUrls={},writeTimeoutMs=20000}={}){
  if(!journal||typeof persist!=='function')throw Error('恢复日志未就绪，已停止');
  validateEntities(entities);
  const maps={VIPProgressStage:new Map(),VIPCustomer:new Map(),repUsernames:new Map(),fieldKeys:new Map()},report={created:0,existing:0,conflicts:[],unresolved:[],verified:0};
  // Preflight all tables before the first write. No delete/update operations exist in this engine.
  const current={};for(const name of Object.keys(entities))if(!DERIVED.has(name))current[name]=await readTable(api.entities[name],{retryOptions});
  planRestore(entities,current);
  for(const name of ENTITIES){
    if(DERIVED.has(name))continue;
    for(const source of entities[name]||[]){
      const key=name+':'+oldId(source),payload=remap(name,source,maps);
      if(!payload){report.unresolved.push({name,source_id:oldId(source)});continue}
      const handler=api.entities[name];
      let match=findMatch(name,source,payload,current[name]||[]);
      // Re-check a missing stable key immediately before create; never blindly retry a POST.
      if(!match){
        const [field,value]=identity(name,payload);
        const found=await retryRead(async()=>recordRows(await handler.filter({[field]:value},'id',2,0)),retryOptions);
        if(found.some(row=>String(row[field])!==String(value)))throw Error(name+' 查询结果标识不符，已停止恢复');
        if(found.length>1)throw Error(name+' 出现重复标识，已停止恢复');
        match=found[0];
      }
      if(match){
        if(equivalent(match,payload))report.existing++;
        else report.conflicts.push({name,source_id:oldId(source),current_id:match.id});
      }else{
        if(journal.operations[key]?.state==='submitting'||journal.operations[key]?.state==='uncertain')throw Error('上次写入结果尚未确认：'+key+'。已停止重复创建，现有资料均保留');
        journal.operations[key]={state:'submitting',at:new Date().toISOString()};await persist(journal);
        progress('正在补回 '+name+'（已新增 '+report.created+' 条）');
        let timer;
        try{
          const createdPayload=replaceAssetUrls(payload,assetUrls);
          const result=await Promise.race([Promise.resolve().then(()=>handler.create(createdPayload)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('写入等待超时')),writeTimeoutMs)})]);
          const id=result?.id||result?.data?.id||result?.entity?.id;
          if(!id)throw Error('服务器没有返回新记录 ID');
          // Read back every new record and compare content before marking it completed.
          match=await retryRead(()=>handler.get(id),retryOptions);
          if(!match?.id||!equivalent(match,createdPayload))throw Error('新增记录回读校验未通过');
          journal.operations[key]={state:'verified',id:match.id};await persist(journal);
          (current[name]??=[]).push(match);report.created++;report.verified++;
        }catch(error){
          journal.operations[key]={...journal.operations[key],state:'uncertain',error:String(error?.message||error)};
          try{await persist(journal)}catch(_){}
          throw Error('恢复已暂停：'+name+' 写入结果需要核对。原有资料未删除，已补回的数据保留。'+String(error?.message||error));
        }finally{clearTimeout(timer)}
      }
      if(maps[name])maps[name].set(oldId(source),String(match.id));
      if(name==='VIPSalesRep')maps.repUsernames.set(String(source.username),String(match.username));
      if(name==='VIPFormField')maps.fieldKeys.set(String(source.field_key),String(match.field_key));
    }
  }
  journal.state='completed';journal.report=report;await persist(journal);return report;
}

export function replaceAssetUrls(value,map){
  if(Array.isArray(value))return value.map(x=>replaceAssetUrls(x,map));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,key==='url'&&typeof v==='string'&&map[v]?map[v]:replaceAssetUrls(v,map)]));
  return value;
}
export function attachmentRefs(entities){
  const refs=new Map();
  for(const row of entities.VIPWorkflowDefinition||[])for(const flow of row.bundle?.workflows||[])for(const step of flow.steps||[])for(const att of step.attachments||[]){
    const url=String(att?.url||'');if(url&&!url.startsWith('data:'))refs.set(url,{old_url:url,name:att.name||'attachment',type:att.type||'application/octet-stream'});
  }
  return [...refs.values()];
}

export function openVault(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('mosen-vip-recovery',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('records');
    request.onerror=()=>reject(Error('无法打开本机恢复保险库，未开始恢复'));
    request.onblocked=()=>reject(Error('恢复保险库被其他页面占用，请关闭旧页面后重试'));
    request.onsuccess=()=>{
      const db=request.result;
      resolve({
        put(key,value){return new Promise((ok,no)=>{const tx=db.transaction('records','readwrite');tx.objectStore('records').put(value,key);tx.oncomplete=()=>ok();tx.onerror=tx.onabort=()=>no(Error('恢复保险库存储失败，已停止'))})},
        get(key){return new Promise((ok,no)=>{const tx=db.transaction('records','readonly'),r=tx.objectStore('records').get(key);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(Error('恢复保险库读取失败'))})}
      });
    };
  });
}
