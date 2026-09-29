(function(){
  'use strict';
  let lastSignature='',hoverTimer=null;

  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]))}

  function ensureStyle(){
    if(document.getElementById('vipSalesToolSidebarStyle'))return;
    const s=document.createElement('style');
    s.id='vipSalesToolSidebarStyle';
    s.textContent=[
      '.vip-sales-tools{position:fixed;z-index:15;top:78px;width:226px;max-height:calc(100vh - 94px);display:flex;flex-direction:column;background:#fff;border:1px solid #e4e7ec;border-radius:18px;box-shadow:0 8px 28px rgba(16,24,40,.055);overflow:hidden}',
      '.vip-sales-tools-head{padding:10px;border-bottom:1px solid #eef1f4;background:#fff;flex:0 0 auto}',
      '.vip-sales-tools-open{width:100%;border:0;border-radius:11px;background:#111827;color:#fff;padding:10px 12px;font-size:12px;font-weight:850;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.vip-sales-tools-open:hover{background:#263244}.vip-sales-tools-open span:last-child{font-size:15px}',
      '.vip-sales-tools-preview{flex:0 0 auto;border-bottom:1px solid #eef1f4;padding:8px 9px 9px;background:#fafbfc}',
      '.vip-sales-tools-preview-title{height:18px;display:flex;align-items:center;gap:6px;font-size:9.5px;font-weight:800;color:#667085;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:6px}',
      '.vip-sales-tools-preview-frame{position:relative;height:118px;border:1px solid #e2e7ee;border-radius:10px;overflow:hidden;background:linear-gradient(180deg,#fff,#f7f8fa)}',
      '.vip-sales-tools-preview-placeholder{position:absolute;inset:0;display:grid;place-items:center;padding:14px;text-align:center;color:#98a2b3;font-size:10px;line-height:1.55}',
      '.vip-sales-tools-preview-frame iframe{position:absolute;left:0;top:0;width:820px;height:460px;border:0;transform:scale(.252);transform-origin:0 0;pointer-events:none;background:#fff}',
      '.vip-sales-tools-scroll{overflow:auto;padding:8px 7px 11px;scrollbar-width:thin}',
      '.vip-sales-tools-group{margin:2px 0 10px}.vip-sales-tools-group:last-child{margin-bottom:0}',
      '.vip-sales-tools-title{display:flex;align-items:center;gap:7px;padding:5px 6px 6px;color:#98a2b3;font-size:9px;font-weight:900;letter-spacing:.08em}',
      '.vip-sales-tools-title:after{content:"";height:1px;background:#eef1f4;flex:1}',
      '.vip-sales-tool{display:flex;align-items:center;gap:8px;width:100%;min-width:0;text-decoration:none;color:#344054;border-radius:9px;padding:7px 8px;margin:1px 0;transition:.12s}',
      '.vip-sales-tool:hover,.vip-sales-tool.previewing{background:#f5f3ff;color:#5936cf}',
      '.vip-sales-tool-icon{width:23px;height:23px;flex:0 0 23px;border-radius:7px;background:#f2f4f7;display:grid;place-items:center;font-size:9px;font-weight:900;color:#667085}',
      '.vip-sales-tool:hover .vip-sales-tool-icon,.vip-sales-tool.previewing .vip-sales-tool-icon{background:#ebe6ff;color:#5f3fd0}',
      '.vip-sales-tool-name{min-width:0;font-size:10.5px;font-weight:780;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.vip-sales-tools-empty{padding:20px 10px;text-align:center;color:#98a2b3;font-size:11px}',
      '.vip-sales-tools-mobile-toggle{display:none;position:fixed;left:8px;top:82px;z-index:29;border:0;border-radius:0 10px 10px 0;background:#111827;color:#fff;padding:9px 8px;font-size:11px;font-weight:850;box-shadow:0 8px 24px rgba(15,23,42,.18);cursor:pointer}',
      '.vip-sales-tools.drawer-mode{display:none;left:8px!important;z-index:30;width:230px;max-height:calc(100vh - 92px);box-shadow:0 20px 70px rgba(15,23,42,.25)}',
      '.vip-sales-tools.drawer-mode.mobile-open{display:flex}',
      '.vip-sales-tools-mobile-toggle.visible{display:block}',
      '@media(max-width:760px){.vip-sales-tools-mobile-toggle{top:72px}.vip-sales-tools{top:70px}}'
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
    aside.innerHTML=
      '<div class="vip-sales-tools-head"><button type="button" class="vip-sales-tools-open"><span>打开 VIP 工具中心</span><span>↗</span></button></div>'+
      '<div class="vip-sales-tools-preview">'+
        '<div class="vip-sales-tools-preview-title">工具预览</div>'+
        '<div class="vip-sales-tools-preview-frame"><div class="vip-sales-tools-preview-placeholder">鼠标放到下面任意工具上<br>这里会显示工具小画面</div></div>'+
      '</div>'+
      '<div class="vip-sales-tools-scroll"><div class="vip-sales-tools-empty">正在读取工具…</div></div>';
    document.body.appendChild(aside);

    const toggle=document.createElement('button');
    toggle.type='button';
    toggle.className='vip-sales-tools-mobile-toggle';
    toggle.textContent='工具';
    document.body.appendChild(toggle);

    toggle.onclick=()=>aside.classList.toggle('mobile-open');
    aside.querySelector('.vip-sales-tools-open').onclick=()=>window.open('./toolbox/index.html','_blank','noopener');

    document.addEventListener('click',e=>{
      if(!aside.classList.contains('drawer-mode')||!aside.classList.contains('mobile-open'))return;
      if(aside.contains(e.target)||toggle.contains(e.target))return;
      aside.classList.remove('mobile-open');
    });
    return aside;
  }

  function placeSidebar(){
    const aside=ensureShell();
    const toggle=document.querySelector('.vip-sales-tools-mobile-toggle');
    const shell=document.querySelector('.shell');
    if(!shell)return;

    const width=226;
    const gap=14;
    const shellLeft=shell.getBoundingClientRect().left;
    const desired=Math.floor(shellLeft-width-gap);
    const canFit=desired>=8;

    aside.classList.toggle('drawer-mode',!canFit);
    if(canFit){
      aside.classList.remove('mobile-open');
      aside.style.left=desired+'px';
      aside.style.width=width+'px';
      toggle?.classList.remove('visible');
    }else{
      aside.style.left='8px';
      aside.style.width='230px';
      toggle?.classList.add('visible');
    }
  }

  function setPreview(tool,link){
    const aside=ensureShell();
    const title=aside.querySelector('.vip-sales-tools-preview-title');
    const frame=aside.querySelector('.vip-sales-tools-preview-frame');
    aside.querySelectorAll('.vip-sales-tool.previewing').forEach(x=>x.classList.remove('previewing'));
    if(link)link.classList.add('previewing');
    title.textContent=tool?.title?'预览 · '+tool.title:'工具预览';
    frame.innerHTML='';
    if(!tool?.path){
      frame.innerHTML='<div class="vip-sales-tools-preview-placeholder">暂无可预览内容</div>';
      return;
    }
    const iframe=document.createElement('iframe');
    iframe.setAttribute('aria-hidden','true');
    iframe.tabIndex=-1;
    iframe.loading='eager';
    iframe.src=window.VIPToolCatalog.toolboxUrl(tool.path);
    frame.appendChild(iframe);
  }

  function bindPreviews(box,catalog){
    box.querySelectorAll('.vip-sales-tool[data-tool-id]').forEach(link=>{
      link.addEventListener('mouseenter',()=>{
        clearTimeout(hoverTimer);
        hoverTimer=setTimeout(()=>{
          const tool=(catalog.items||[]).find(x=>String(x.id)===String(link.dataset.toolId));
          if(tool)setPreview(tool,link);
        },220);
      });
      link.addEventListener('mouseleave',()=>clearTimeout(hoverTimer));
      link.addEventListener('focus',()=>{
        const tool=(catalog.items||[]).find(x=>String(x.id)===String(link.dataset.toolId));
        if(tool)setPreview(tool,link);
      });
    });
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
      html+=items.map(t=>
        '<a class="vip-sales-tool" data-tool-id="'+esc(t.id)+'" href="'+esc(window.VIPToolCatalog.toolboxUrl(t.path))+'" target="_blank" rel="noopener" title="'+esc(t.title)+'">'+
          '<span class="vip-sales-tool-icon">'+esc(initials(t.title))+'</span>'+
          '<span class="vip-sales-tool-name">'+esc(t.title)+'</span>'+
        '</a>'
      ).join('');
      html+='</section>';
    });
    box.innerHTML=html||'<div class="vip-sales-tools-empty">工具中心暂无工具</div>';
    bindPreviews(box,catalog);
    placeSidebar();
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
    ensureStyle();
    ensureShell();
    placeSidebar();
    refresh(true);
    window.addEventListener('resize',placeSidebar);
    window.addEventListener('focus',()=>refresh(true));
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(true)});
    setInterval(()=>refresh(true),60000);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();