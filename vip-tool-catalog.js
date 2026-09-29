(function(){
  'use strict';
  const CACHE_MS=15000;
  let cache=null,cacheAt=0,pending=null;

  function cleanText(v){return String(v==null?'':v).replace(/\s+/g,' ').trim()}
  function normalizeCategory(v){
    const x=cleanText(v).toLowerCase();
    if(x==='de'||x==='德国')return'de';
    if(x==='other'||x==='其它'||x==='其他'||x==='其它工具'||x==='其他工具')return'other';
    return'us';
  }
  function toolboxUrl(path){
    return new URL('./toolbox/'+String(path||'').replace(/^\.?\//,''),location.href).href;
  }
  async function fetchText(url){
    const r=await fetch(url+(url.includes('?')?'&':'?')+'_='+Date.now(),{cache:'no-store'});
    if(!r.ok)throw new Error('读取工具中心失败 ('+r.status+')');
    return r.text();
  }
  async function fetchJson(url,fallback){
    try{return JSON.parse(await fetchText(url))}catch(_){return fallback}
  }
  function staticToolsFromHtml(html){
    const doc=new DOMParser().parseFromString(html,'text/html');
    const out=[];
    doc.querySelectorAll('[data-grid]').forEach(grid=>{
      const cat=normalizeCategory(grid.getAttribute('data-grid'));
      grid.querySelectorAll(':scope > .card[data-id]').forEach(card=>{
        const id=cleanText(card.dataset.id),path=cleanText(card.getAttribute('href'));
        if(!id||!path)return;
        out.push({
          id,
          title:cleanText(card.querySelector('.title')?.textContent||card.dataset.name||id),
          description:cleanText(card.querySelector('.desc')?.textContent||''),
          path,
          category:cat,
          source:'static'
        });
      });
    });
    return out;
  }
  function mergeTools(staticTools,dynamicData,orderData){
    const map=new Map();
    staticTools.forEach(x=>map.set(String(x.id),x));
    const obsoleteIds=new Set(['dynamic-0efef7208498']);
    const obsoletePaths=new Set(['tools/手机截图状态栏编辑器.html']);
    (dynamicData&&Array.isArray(dynamicData.tools)?dynamicData.tools:[]).forEach(t=>{
      if(!t||!t.id||!t.path||obsoleteIds.has(String(t.id))||obsoletePaths.has(String(t.path)))return;
      const id=String(t.id);
      if(map.has(id))return;
      map.set(id,{
        id,
        title:cleanText(t.title||t.name||'HTML 工具'),
        description:cleanText(t.description||'自定义 HTML 工具'),
        path:cleanText(t.path),
        category:normalizeCategory(t.category),
        icon:cleanText(t.icon||''),
        source:'dynamic'
      });
    });

    const order=(orderData&&orderData.toolCenter)||{};
    const placed=new Set();
    const groups={us:[],de:[],other:[]};
    ['us','de','other'].forEach(cat=>{
      (Array.isArray(order[cat])?order[cat]:[]).forEach(id=>{
        id=String(id);
        const item=map.get(id);
        if(!item||placed.has(id))return;
        item.category=cat;
        groups[cat].push(item);
        placed.add(id);
      });
    });
    map.forEach((item,id)=>{
      if(placed.has(id))return;
      const cat=normalizeCategory(item.category);
      item.category=cat;
      groups[cat].push(item);
    });
    const items=[...groups.us,...groups.de,...groups.other];
    return {items,groups};
  }
  async function load(force){
    if(!force&&cache&&Date.now()-cacheAt<CACHE_MS)return cache;
    if(pending&&!force)return pending;
    pending=(async()=>{
      const [html,dynamicData,orderData]=await Promise.all([
        fetchText('./toolbox/index.html'),
        fetchJson('./toolbox/tools/index.json',{tools:[]}),
        fetchJson('./toolbox/global-order.json',{toolCenter:{us:[],de:[],other:[]}})
      ]);
      cache=mergeTools(staticToolsFromHtml(html),dynamicData,orderData);
      cacheAt=Date.now();
      pending=null;
      return cache;
    })().catch(err=>{pending=null;throw err});
    return pending;
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
      const norm=s=>decodeURIComponent(String(s||'')).replace(/^\.?\/?toolbox\//,'').replace(/^\.?\//,'');
      const target=norm(path);
      const byPath=items.find(x=>norm(x.path)===target);
      if(byPath)return byPath;
    }
    const title=cleanText(ref.title||'');
    const category=normalizeCategory(ref.category||'us');
    if(title)return items.find(x=>cleanText(x.title)===title&&normalizeCategory(x.category)===category)||null;
    return null;
  }

  window.VIPToolCatalog={load,find,toolboxUrl,normalizeCategory};
})();