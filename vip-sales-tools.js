(function(){
  'use strict';
  let lastSignature='';

  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]))}
  function ensureStyle(){
    if(document.getElementById('vipSalesToolSidebarStyle'))return;
    const s=document.createElement('style');
    s.id='vipSalesToolSidebarStyle';
    s.textContent=[
      '.vip-sales-tools{position:fixed;z-index:15;top:84px;left:max(18px,calc((100vw - 1280px)/2 - 260px));width:238px;max-height:calc(100vh - 104px);display:flex;flex-direction:column;background:#fff;border:1px solid #e4e7ec;border-radius:18px;box-shadow:0 8px 28px rgba(16,24,40,.055);overflow:hidden}',
      '.vip-sales-tools-head{padding:12px;border-bottom:1px solid #eef1f4;background:#fff;flex:0 0 auto}',
      '.vip-sales-tools-open{width:100%;border:0;border-radius:11px;background:#111827;color:#fff;padding:10px 12px;font-size:12px;font-weight:850;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.vip-sales-tools-open:hover{background:#263244}.vip-sales-tools-open span:last-child{font-size:15px}',
      '.vip-sales-tools-scroll{overflow:auto;padding:9px 8px 12px;scrollbar-width:thin}',
      '.vip-sales-tools-group{margin:2px 0 10px}.vip-sales-tools-group:last-child{margin-bottom:0}',
      '.vip-sales-tools-title{display:flex;align-items:center;gap:7px;padding:5px 6px 6px;color:#98a2b3;font-size:9px;font-weight:900;letter-spacing:.08em}',
      '.vip-sales-tools-title:after{content:"";height:1px;background:#eef1f4;flex:1}',
      '.vip-sales-tool{display:flex;align-items:center;gap:8px;width:100%;min-width:0;text-decoration:none;color:#344054;border-radius:9px;padding:7px 8px;margin:1px 0;transition:.12s}',
      '.vip-sales-tool:hover{background:#f5f3ff;color:#5936cf}',
      '.vip-sales-tool-icon{width:23px;height:23px;flex:0 0 23px;border-radius:7px;background:#f2f4f7;display:grid;place-items:center;font-size:9px;font-weight:900;color:#667085}',
      '.vip-sales-tool:hover .vip-sales-tool-icon{background:#ebe6ff;color:#5f3fd0}',
      '.vip-sales-tool-name{min-width:0;font-size:10.5px;font-weight:780;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.vip-sales-tools-empty{padding:20px 10px;text-align:center;color:#98a2b3;font-size:11px}',
      '.vip-sales-tools-mobile-toggle{display:none;position:fixed;left:8px;top:88px;z-index:29;border:0;border-radius:0 10px 10px 0;background:#111827;color:#fff;padding:9px 8px;font-size:11px;font-weight:850;box-shadow:0 8px 24px rgba(15,23,42,.18);cursor:pointer}',
      '@media(max-width:1580px){.vip-sales-tools{left:10px;width:210px}}',
      '@media(max-width:1460px){.vip-sales-tools{display:none;z-index:30;left:8px;top:76px;width:230px;max-height:calc(100vh - 92px);box-shadow:0 20px 70px rgba(15,23,42,.25)}.vip-sales-tools.mobile-open{display:flex}.vip-sales-tools-mobile-toggle{display:block}}',
      '@media(max-width:760px){.vip-sales-tools-mobile-toggle{top:72px}}'
    ].join('');
    document.head.appendChild(s);
  }
  function initials(title){
    const a=String(title||'工').match(/[A-Za-z0-9]+/g);
    if(a&&a.length)return a.slice(0,2).map(x=>x[0].toUpperCase()).join('');
    return [...String(title||'工')].slice(0,2).join('');
  }
  function ensureShell(){
    let aside=document.getElementById('vipSalesTools');
    if(aside)return aside;
    aside=document.createElement('aside');
    aside.id='vipSalesTools';
    aside.className='vip-sales-tools';
    aside.innerHTML='<div class="vip-sales-tools-head"><button type="button" class="vip-sales-tools-open"><span>打开 VIP 工具中心</span><span>↗</span></button></div><div class="vip-sales-tools-scroll"><div class="vip-sales-tools-empty">正在读取工具…</div></div>';
    document.body.appendChild(aside);
    const toggle=document.createElement('button');
    toggle.type='button';toggle.className='vip-sales-tools-mobile-toggle';toggle.textContent='工具';
    document.body.appendChild(toggle);
    toggle.onclick=()=>aside.classList.toggle('mobile-open');
    aside.querySelector('.vip-sales-tools-open').onclick=()=>window.open('./toolbox/index.html','_blank','noopener');
    document.addEventListener('click',e=>{
      if(window.innerWidth>1460)return;
      if(!aside.classList.contains('mobile-open'))return;
      if(aside.contains(e.target)||toggle.contains(e.target))return;
      aside.classList.remove('mobile-open');
    });
    return aside;
  }
  function signature(catalog){
    return (catalog.items||[]).map(x=>[x.id,x.title,x.path,x.category].join('|')).join('~');
  }
  function render(catalog){
    const aside=ensureShell(),sig=signature(catalog);
    if(sig===lastSignature)return;
    lastSignature=sig;
    const box=aside.querySelector('.vip-sales-tools-scroll');
    const labels={us:'美国',de:'德国',other:'其它工具'};
    let html='';
    ['us','de','other'].forEach(cat=>{
      const items=(catalog.groups&&catalog.groups[cat])||[];
      if(!items.length)return;
      html+='<section class="vip-sales-tools-group"><div class="vip-sales-tools-title">'+labels[cat]+'</div>';
      html+=items.map(t=>'<a class="vip-sales-tool" href="'+esc(window.VIPToolCatalog.toolboxUrl(t.path))+'" target="_blank" rel="noopener" title="'+esc(t.title)+'"><span class="vip-sales-tool-icon">'+esc(initials(t.title))+'</span><span class="vip-sales-tool-name">'+esc(t.title)+'</span></a>').join('');
      html+='</section>';
    });
    box.innerHTML=html||'<div class="vip-sales-tools-empty">工具中心暂无工具</div>';
  }
  async function refresh(force){
    try{
      const catalog=await window.VIPToolCatalog.load(!!force);
      render(catalog);
    }catch(err){
      const aside=ensureShell();
      aside.querySelector('.vip-sales-tools-scroll').innerHTML='<div class="vip-sales-tools-empty">工具目录读取失败，稍后会自动重试</div>';
    }
  }
  function init(){
    ensureStyle();ensureShell();refresh(true);
    window.addEventListener('focus',()=>refresh(true));
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(true)});
    setInterval(()=>refresh(true),60000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();