import { APP_ID,CORE,ENTITIES,FORMAT,canonical,digest,counts,readTable,captureSnapshot,makeBackup,parseBackup,validateEntities,planRestore,executeRestore,openVault,attachmentRefs } from './backup-safe.js?v=20260929-safe-backup2';
import { retryRead } from './customer-loader.js?v=20260929-stable-load1';

const MAX_BYTES=100*1024*1024;
function base64(bytes){let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s)}
function decode(value){return Uint8Array.from(atob(value),c=>c.charCodeAt(0))}
export function resolveAttachmentUrl(value,pageHref=location.href){
  // Workflow files historically store paths relative to a toolbox subpage.
  // Keep the original reference as the restore key; only resolve the download URL.
  let path=String(value);
  if(/^(?:\.\.\/|\.\/)?data\/chat-flow-assets\//.test(path))path='./toolbox/'+path.replace(/^\.\.\//,'').replace(/^\.\//,'');
  const url=new URL(path,pageHref);
  if(!['https:','http:'].includes(url.protocol))throw Error('附件地址不受支持');
  return url;
}
export async function captureAttachments(entities,progress=()=>{},{retryOptions}={}){
  const assets=[],missing_assets=[];let total=0;
  for(const ref of attachmentRefs(entities)){
    try{
    const url=resolveAttachmentUrl(ref.old_url);
    progress('正在备份附件：'+ref.name);
    const bytes=await retryRead(async()=>{
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
      try{
        const response=await fetch(url,{cache:'no-store',signal:controller.signal});
        if(!response.ok)throw Object.assign(Error('附件读取失败：HTTP '+response.status),{status:response.status,response:{headers:{'retry-after':response.headers.get('retry-after')}}});
        // Some hosts return their HTML error page with HTTP 200.
        if((response.headers.get('content-type')||'').includes('text/html')&&!/\.html?$/i.test(ref.name))throw Object.assign(Error('附件地址返回了网页，未保存为原文件'),{status:422});
        if(Number(response.headers.get('content-length'))>MAX_BYTES-total)throw Object.assign(Error('附件超过剩余备份容量'),{status:413});
        const result=new Uint8Array(await response.arrayBuffer());if(result.length>MAX_BYTES-total)throw Object.assign(Error('附件超过剩余备份容量'),{status:413});return result;
      }finally{clearTimeout(timer)}
    },{timeoutMs:16000,...retryOptions});
    total+=bytes.length;
    const content=base64(bytes);assets.push({...ref,size:bytes.length,content,checksum_sha256:await digest(content)});
    }catch(error){
      missing_assets.push({...ref,reason:String(error?.message||'附件暂时无法读取'),http_status:Number(error?.status)||null});
      progress('附件未取得，已保留链接并记入清单：'+ref.name);
    }
  }
  return {assets,missing_assets};
}
function missingAttachments(source){
  const embedded=new Set((source.assets||[]).map(a=>a.old_url)),declared=new Map((source.missing_assets||[]).map(a=>[a.old_url,a]));
  return attachmentRefs(source.entities).filter(a=>!embedded.has(a.old_url)).map(a=>declared.get(a.old_url)||{...a,reason:'此备份仅保留附件链接，未嵌入原文件'});
}
export async function readBackupFile(file){
  if(file.size>MAX_BYTES*1.5)throw Error('备份文件超过容量限制');
  if(!String(file.name||'').toLowerCase().endsWith('.zip'))return parseBackup(JSON.parse(await file.text()));
  const JSZip=window.JSZip||(await import('https://esm.sh/jszip@3.10.1')).default;
  const zip=await JSZip.loadAsync(file,{checkCRC32:true});
  const read=async path=>{const entry=zip.file(path);if(!entry)throw Error('备份缺少 '+path);return JSON.parse(await entry.async('string'))};
  const manifest=await read('manifest.json');
  if(manifest.format!=='MOSEN_VIP_DISASTER_BACKUP'||Number(manifest.version)!==5||manifest.app_id!==APP_ID)throw Error('不支持的 ZIP 备份');
  const entities={};for(const name of manifest.entity_names||[]){if(!ENTITIES.includes(name))throw Error('ZIP 包含未知数据表');entities[name]=await read('base44/entities/'+name+'.json')}
  validateEntities(entities);
  const assets=[];let total=0;
  for(const meta of manifest.workflow_assets||[]){
    if(!String(meta.path).startsWith('base44/workflow-assets/')||String(meta.path).includes('..'))throw Error('附件路径不正确');
    const entry=zip.file(meta.path);if(!entry)throw Error('ZIP 缺少附件：'+meta.name);
    const bytes=await entry.async('uint8array');total+=bytes.length;if(total>MAX_BYTES)throw Error('ZIP 附件超过容量限制');
    if(meta.size!=null&&Number(meta.size)!==bytes.length)throw Error('ZIP 附件大小不符');
    const content=base64(bytes);assets.push({...meta,content,checksum_sha256:await digest(content)});
  }
  return {entities,assets,version:5,checksum:await digest(canonical({entities,assets})),zip:true};
}
export function createBackupController({api,show,confirm,refresh,setMaintenance,download,services={}}={}){
  const vaultOpen=services.openVault||openVault;
  let busy=false;
  const controls=()=>['exportBackup','importBackup','backupFile','recoverSafetyBackup'].map(id=>document.getElementById(id)).filter(Boolean);
  const leave=e=>{e.preventDefault();e.returnValue=''};
  async function exclusive(work){
    if(busy){show('备份或恢复正在进行，请等待完成。','warn');return}
    if(!navigator.locks){show('当前浏览器不支持安全恢复锁，请使用新版 Chrome 或 Edge。','err');return}
    return navigator.locks.request('mosen-vip-backup-restore',{ifAvailable:true},async lock=>{
      if(!lock){show('另一个页面正在备份或恢复，请等待完成。','warn');return}
      busy=true;controls().forEach(b=>b.disabled=true);window.addEventListener('beforeunload',leave);
      try{return await work()}
      catch(error){show(String(error?.message||error),'err')}
      finally{busy=false;controls().forEach(b=>b.disabled=false);window.removeEventListener('beforeunload',leave);setMaintenance(false);try{await refresh()}catch(error){console.warn('Customer refresh deferred after backup operation',error)}}
    });
  }
  async function capture(){
    const snapshot=await captureSnapshot(api,{progress:text=>show(text,'warn')});
    Object.assign(snapshot,await captureAttachments(snapshot.entities,text=>show(text,'warn')));
    if(snapshot.assets.length||snapshot.missing_assets.length){
      const latest={};for(const name of ENTITIES)latest[name]=await readTable(api.entities[name]);
      if(canonical(latest)!==canonical(snapshot.entities))throw Error('下载附件期间业务数据发生变化，本次备份已停止，请重试');
      snapshot.completed_at=new Date().toISOString();
    }
    const backup=await makeBackup(snapshot);
    if(new TextEncoder().encode(JSON.stringify(backup)).length>MAX_BYTES*1.5)throw Error('完整备份超过 150 MB，未导出无法重新导入的文件');
    return backup;
  }
  async function preserve(vault,key,backup){
    await vault.put(key,backup);const saved=await vault.get(key);
    if(!saved||canonical(saved)!==canonical(backup))throw Error('恢复保险库回读校验失败，未开始写入客户数据');
  }
  return {
    exportBackup(){return exclusive(async()=>{
      show('正在完整读取云端数据。数据表读取失败会停止导出；无法取得的附件会保留链接并单独列明。','warn');
      const backup=await capture();
      const vault=await vaultOpen();await preserve(vault,'export:'+backup.checksum_sha256,backup);
      const missing=backup.payload.missing_assets;
      download(backup,'mosen_VIP-业务数据备份'+(missing.length?'-附件不完整':'')+'-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
      if(missing.length)download({backup_checksum:backup.checksum_sha256,missing_assets:missing},'mosen_VIP-缺失附件清单.json');
      const n=backup.counts;show('备份已生成：'+n.customers+' 个可见客户（正常 '+n.active+'，归档 '+n.archived+'），'+Object.keys(n.tables).length+' 张数据表，'+backup.payload.assets.length+' 个附件原文件。已校验并保留本机副本。'+(missing.length?'注意：'+missing.length+' 个附件未取得原文件，已保存原链接和缺失清单；该文件不能还原这些附件的原文件。':''),missing.length?'warn':'ok');
    })},
    importBackup(file){return exclusive(async()=>{
      show('正在校验备份完整性、原始 ID 和客户关联…','warn');
      const source=await readBackupFile(file),vault=await vaultOpen();
      const safety=await capture();const plan=planRestore(source.entities,safety.payload.entities);
      const prefix='restore:'+source.checksum;
      await preserve(vault,prefix+':source',source);
      // Retain the original pre-restore safety copy across retries and reloads.
      let savedSafety=await vault.get(prefix+':safety');
      if(!savedSafety){await preserve(vault,prefix+':safety',safety);savedSafety=safety}
      // Keep both the original rollback reference and a fresh safety copy for every attempt.
      await preserve(vault,prefix+':safety:'+safety.checksum_sha256,safety);
      await preserve(vault,'latest-safety',safety);
      download(safety,'mosen_VIP-恢复前真实数据-'+safety.exported_at.replace(/[:.]/g,'-')+'.json');
      const n=counts(source.entities),p=plan.summary,sourceMissing=missingAttachments(source),safetyMissing=missingAttachments(safety.payload);
      const ok=await confirm('备份包含 '+n.customers+' 个可见客户（正常 '+n.active+'，归档 '+n.archived+'）。\n\n计划补回 '+p.create+' 条缺失记录；已存在 '+p.existing+' 条；保留当前内容的冲突 '+p.conflict+' 条；缺失关联而跳过 '+p.unresolved+' 条。\n\n恢复不会清空数据，也不会覆盖已有修改。当前真实数据已保存到本机保险库，并已发起安全备份下载。'+(source.zip?'\nZIP 中的网页代码、GitHub 仓库和工具模板不会覆盖当前系统。':'')+(sourceMissing.length?'\n待恢复备份有 '+sourceMissing.length+' 个附件没有原文件，只能保留原链接，不能重新上传这些文件。':'')+(safetyMissing.length?'\n本次恢复前安全备份有 '+safetyMissing.length+' 个附件未取得原文件，缺失清单已写入安全备份。':''),{title:'安全补回业务数据',confirmText:'补回缺失记录'});
      if(!ok){show('已取消，云端数据未改变。','warn');return}
      setMaintenance(true);
      let journal=await vault.get(prefix+':journal')||{source:source.checksum,state:'running',operations:{},assets:{}};
      const persist=next=>vault.put(prefix+':journal',next);await persist(journal);
      const assetUrls={};
      // Only missing definitions/assets require upload. Existing definitions are never overwritten.
      const needed=new Set(attachmentRefs({VIPWorkflowDefinition:plan.operations.filter(op=>op.name==='VIPWorkflowDefinition'&&op.status==='create').map(op=>op.source)}).map(x=>x.old_url));
      for(const asset of source.assets||[]){
        if(!needed.has(asset.old_url))continue;
        const existing=journal.assets[asset.old_url];
        if(existing?.url){assetUrls[asset.old_url]=existing.url;continue}
        if(existing?.state==='uploading')throw Error('上次附件上传结果未确认，已停止重复上传，客户数据保留');
        journal.assets[asset.old_url]={state:'uploading'};await persist(journal);
        let timer,result;
        try{result=await Promise.race([api.integrations.Core.UploadFile({file:new File([decode(asset.content)],asset.name||'attachment',{type:asset.type||'application/octet-stream'})}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('附件上传等待超时，已停止；客户资料未删除')),20000)})])}finally{clearTimeout(timer)}
        const url=result?.file_url||result?.url||result?.data?.file_url;if(!url)throw Error('附件上传未返回地址，已停止');
        assetUrls[asset.old_url]=url;journal.assets[asset.old_url]={state:'uploaded',url};await persist(journal);
      }
      const report=await executeRestore(api,source.entities,{journal,persist,assetUrls,progress:text=>show(text,'warn')});
      download({source_checksum:source.checksum,completed_at:new Date().toISOString(),...report,missing_source_assets:sourceMissing,missing_safety_assets:safetyMissing},'mosen_VIP-恢复核对报告.json');
      const issues=report.conflicts.length+report.unresolved.length+sourceMissing.length+safetyMissing.length;
      show('安全恢复'+(issues?'已完成可补回部分':'完成')+'：新增并回读验证 '+report.created+' 条；已存在 '+report.existing+' 条；冲突保留 '+report.conflicts.length+' 条；关联缺失跳过 '+report.unresolved.length+' 条。原有数据未删除。'+(sourceMissing.length?'待恢复备份缺少 '+sourceMissing.length+' 个附件原文件，已保留原链接。':'')+(safetyMissing.length?'恢复前安全备份缺少 '+safetyMissing.length+' 个附件原文件。':'')+(issues?'详情已写入恢复核对报告。':''),issues?'warn':'ok');
    })},
    downloadSafety(){return exclusive(async()=>{const vault=await vaultOpen(),saved=await vault.get('latest-safety');if(!saved)throw Error('本机还没有恢复前安全备份');const source=await parseBackup(saved),missing=missingAttachments(source);download(saved,'mosen_VIP-恢复前安全备份.json');show('恢复前安全备份已重新下载。'+(missing.length?'其中 '+missing.length+' 个附件只有原链接，缺少原文件。':''),missing.length?'warn':'ok')})}
  };
}
