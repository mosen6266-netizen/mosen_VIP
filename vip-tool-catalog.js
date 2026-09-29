(function(){
  'use strict';

  const scriptUrl=(document.currentScript&&document.currentScript.src)||location.href;
  const ROOT=new URL('./',scriptUrl);
  const BASE44_URL=new URL('base44.js',ROOT).href;
  const JSON_URL=new URL('toolbox/tool-catalog.json',ROOT).href;
  const CACHE_MS=60000;

  let cache=null,cacheAt=0,pending=null,base44Promise=null,unsub=null;
  const listeners=new Set();

  function cleanText(v){return String(v==null?'':v).replace(/\s+/g,' ').trim()}
  function normalizeCategory(v){
    const x=cleanText(v).toLowerCase();
    if(x==='de'||x==='德国')return'de';
    if(x==='other'||x==='其它'||x==='其他'||x==='其它工具'||x==='其他工具')return'other';
    return'us';
  }
  function normalize(raw){
    const items=(Array.isArray(raw?.items)?raw.items:[])
      .filter(x=>x&&x.id&&x.path)
      .map((x,i)=>({
        ...x,
        id:String(x.id),
        title:cleanText(x.title||x.name||'工具'),
        description:cleanText(x.description||''),
        path:cleanText(x.path),
        category:normalizeCategory(x.category),
        order:Number.isFinite(Number(x.order))?Number(x.order):i+1,
        preview:cleanText(x.preview||('previews/'+encodeURIComponent(String(x.id))+'.png'))
      }))
      .sort((a,b)=>a.order-b.order);
    const groups={us:[],de:[],other:[]};
    items.forEach(x=>groups[x.category].push(x));
    return {version:Number(raw?.version||1),updatedAt:raw?.updatedAt||raw?.updated_at||'',items,groups};
  }
  function toolboxUrl(path){return new URL('toolbox/'+String(path||'').replace(/^\.?\//,''),ROOT).href}
  function previewUrl(item){
    const p=item?.preview||('previews/'+encodeURIComponent(String(item?.id||''))+'.png');
    return new URL('toolbox/'+String(p).replace(/^\.?\//,''),ROOT).href;
  }
  async function getBase44(){
    if(!base44Promise)base44Promise=import(BASE44_URL).then(m=>m.base44);
    return base44Promise;
  }
  async function loadCloud(){
    const base44=await getBase44();
    const rows=await base44.entities.VIPToolCatalog.filter({key:'main'},'-updated_date',1,0);
    const row=Array.isArray(rows)?rows[0]:(rows?.items||[])[0];
    if(!row||!Array.isArray(row.items)||!row.items.length)throw new Error('云端工具目录为空');
    return normalize({version:row.version,updated_at:row.updated_at,items:row.items});
  }
  async function loadJson(){
    const r=await fetch(JSON_URL,{cache:'default'});
    if(!r.ok)throw new Error('读取工具目录失败 ('+r.status+')');
    return normalize(await r.json());
  }
  async function mirrorCloud(catalog){
    try{
      const base44=await getBase44();
      const rows=await base44.entities.VIPToolCatalog.filter({key:'main'},'-updated_date',1,0);
      const row=Array.isArray(rows)?rows[0]:(rows?.items||[])[0];
      const payload={
        key:'main',
        version:Number(catalog.version||1),
        items:catalog.items||[],
        updated_at:catalog.updatedAt||new Date().toISOString(),
        updated_by:'catalog-mirror',
        source_hash:'tool-catalog.json'
      };
      if(row)await base44.entities.VIPToolCatalog.update(row.id,payload);
      else await base44.entities.VIPToolCatalog.create(payload);
    }catch(_){}
  }
  function catalogTime(x){const n=Date.parse(x?.updatedAt||'');return Number.isFinite(n)?n:0}
  async function load(force){
    if(!force&&cache&&Date.now()-cacheAt<CACHE_MS)return cache;
    if(pending&&!force)return pending;
    pending=(async()=>{
      const [cloudRes,jsonRes]=await Promise.allSettled([loadCloud(),loadJson()]);
      const cloud=cloudRes.status==='fulfilled'?cloudRes.value:null;
      const json=jsonRes.status==='fulfilled'?jsonRes.value:null;
      if(!cloud&&!json)throw(cloudRes.reason||jsonRes.reason||new Error('工具目录不可用'));
      cache=(!cloud|| (json&&catalogTime(json)>catalogTime(cloud)))?json:cloud;
      if(json&&cache===json&&(!cloud||catalogTime(json)>catalogTime(cloud)))mirrorCloud(json);
      cacheAt=Date.now();
      pending=null;
      return cache;
    })().catch(err=>{pending=null;throw err});
    return pending;
  }
  async function refreshAndNotify(){
    try{
      const catalog=await load(true);
      listeners.forEach(fn=>{try{fn(catalog)}catch(_){ }});
    }catch(_){}
  }
  async function ensureRealtime(){
    if(unsub)return;
    try{
      const base44=await getBase44();
      unsub=base44.entities.VIPToolCatalog.subscribe(()=>refreshAndNotify());
    }catch(_){}
  }
  function subscribe(fn){
    if(typeof fn!=='function')return()=>{};
    listeners.add(fn);
    ensureRealtime();
    return()=>listeners.delete(fn);
  }
  function find(catalog,ref){
    if(!catalog||!ref)return null;
    const items=catalog.items||[];
    const id=cleanText(ref.toolId||ref.id||'');
    if(id){
      const byId=items.find(x=>String(x.id)===id);
      if(byId)return byId;
    }
    const path=cleanText(ref.path||'');
    if(path){
      const norm=s=>{
        try{return decodeURIComponent(String(s||''))}catch(_){return String(s||'')}
      };
      const tidy=s=>norm(s).replace(/^\.?\/?toolbox\//,'').replace(/^\.?\//,'').replace(/[?&]v=[^&]+/g,'');
      const target=tidy(path);
      const byPath=items.find(x=>tidy(x.path)===target);
      if(byPath)return byPath;
    }
    const title=cleanText(ref.title||'');
    const category=normalizeCategory(ref.category||'us');
    return title?items.find(x=>cleanText(x.title)===title&&x.category===category)||null:null;
  }

  window.VIPToolCatalog={load,subscribe,find,toolboxUrl,previewUrl,normalizeCategory,refresh:refreshAndNotify};
})();