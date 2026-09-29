(function(){
  'use strict';

  var DATA_URL='./data/chat-flows.json?v=20260929-1';
  var STORAGE_PREFIX='mosen_vip_customer_flow_v1:';
  var OLD_BASE='https://mosen6266-netizen.github.io/mosen6266/';
  var flowBundle=null;
  var currentCustomer=null;
  var observer=null;

  function esc(v){
    return String(v==null?'':v).replace(/[&<>"']/g,function(ch){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch];
    });
  }

  function injectStyles(){
    if(document.getElementById('vipWorkflowStyles'))return;
    var s=document.createElement('style');
    s.id='vipWorkflowStyles';
    s.textContent=[
      '.vip-flow-btn{position:relative;white-space:nowrap}',
      '.vip-flow-dot{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;margin-left:5px;border-radius:999px;background:#6d4aff;color:#fff;font-size:10px;font-weight:800}',
      '.vip-flow-overlay{position:fixed;inset:0;background:rgba(15,23,42,.46);backdrop-filter:blur(3px);z-index:99990;display:flex;justify-content:flex-end}',
      '.vip-flow-panel{height:100%;width:min(1120px,96vw);background:#f7f8fb;box-shadow:-24px 0 70px rgba(15,23,42,.22);display:grid;grid-template-rows:auto 1fr;color:#172033}',
      '.vip-flow-head{background:#fff;border-bottom:1px solid #e6e9ef;padding:16px 18px 14px;display:flex;align-items:center;gap:14px}',
      '.vip-flow-head-main{min-width:0;flex:1}.vip-flow-kicker{font-size:11px;font-weight:800;letter-spacing:.08em;color:#7c3aed;text-transform:uppercase}.vip-flow-title{font-size:20px;font-weight:900;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.vip-flow-sub{font-size:12px;color:#7a8497;margin-top:4px}',
      '.vip-flow-head-actions{display:flex;align-items:center;gap:8px}.vip-flow-icon-btn,.vip-flow-action{border:0;border-radius:10px;background:#f1f3f7;color:#3c4659;padding:9px 11px;font-weight:700;cursor:pointer}.vip-flow-icon-btn{width:38px;height:38px;padding:0;font-size:20px}.vip-flow-action:hover,.vip-flow-icon-btn:hover{background:#e7eaf0}',
      '.vip-flow-body{min-height:0;display:grid;grid-template-columns:280px minmax(0,1fr)}',
      '.vip-flow-sidebar{min-height:0;overflow:auto;background:#fff;border-right:1px solid #e6e9ef;padding:14px}',
      '.vip-flow-group{font-size:11px;font-weight:900;color:#8b95a7;margin:12px 8px 6px;letter-spacing:.08em}',
      '.vip-flow-tab{width:100%;border:0;background:transparent;text-align:left;border-radius:12px;padding:11px 12px;margin:3px 0;cursor:pointer;color:#344054}.vip-flow-tab:hover{background:#f6f3ff}.vip-flow-tab.active{background:#eeeaff;color:#5b35d5}.vip-flow-tab strong{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.vip-flow-tab span{display:block;font-size:11px;color:#8a93a4;margin-top:4px}',
      '.vip-flow-main{min-height:0;overflow:auto;padding:18px 20px 36px}',
      '.vip-flow-summary{position:sticky;top:0;z-index:5;background:rgba(247,248,251,.96);backdrop-filter:blur(12px);padding:0 0 14px}',
      '.vip-flow-summary-card{background:#fff;border:1px solid #e5e8ef;border-radius:15px;padding:14px 16px;box-shadow:0 8px 26px rgba(26,35,55,.05)}',
      '.vip-flow-summary-top{display:flex;align-items:center;gap:12px}.vip-flow-summary-top h3{margin:0;font-size:17px}.vip-flow-percent{margin-left:auto;font-size:18px;font-weight:900;color:#6d4aff}',
      '.vip-flow-progress{height:8px;background:#edf0f4;border-radius:99px;overflow:hidden;margin-top:11px}.vip-flow-progress span{display:block;height:100%;background:#6d4aff;border-radius:99px;transition:.2s}',
      '.vip-flow-next{margin-top:10px;display:flex;align-items:center;gap:8px;font-size:12px;color:#657084}.vip-flow-next b{color:#273248}.vip-flow-next button{margin-left:auto;border:0;background:#eeeaff;color:#5b35d5;border-radius:9px;padding:7px 9px;font-weight:800;cursor:pointer}',
      '.vip-flow-filter{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px;color:#657084}.vip-flow-filter input{accent-color:#6d4aff}',
      '.vip-flow-step-list{display:flex;flex-direction:column;gap:12px}',
      '.vip-flow-step{background:#fff;border:1px solid #e4e8ef;border-radius:15px;overflow:hidden;box-shadow:0 5px 18px rgba(20,29,48,.035);transition:.16s}.vip-flow-step.done{opacity:.68;background:#fbfcfd}.vip-flow-step.next{border-color:#8b72f0;box-shadow:0 0 0 3px rgba(109,74,255,.10),0 8px 24px rgba(20,29,48,.05)}',
      '.vip-flow-step-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #eef1f5}.vip-flow-check{width:22px;height:22px;accent-color:#16a36a;cursor:pointer}.vip-flow-num{width:28px;height:28px;border-radius:9px;background:#f1edff;color:#633fd7;display:grid;place-items:center;font-size:11px;font-weight:900;flex:0 0 auto}.vip-flow-step-title{min-width:0;flex:1}.vip-flow-step-title strong{font-size:14px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.vip-flow-step-title span{font-size:11px;color:#8a93a4;margin-top:3px;display:block}.vip-flow-copy{border:0;border-radius:9px;background:#6d4aff;color:#fff;padding:8px 10px;font-size:12px;font-weight:800;cursor:pointer}.vip-flow-copy:hover{background:#5837d0}',
      '.vip-flow-step-body{padding:13px 14px 14px}.vip-flow-language{font-size:10px;font-weight:900;color:#8a93a4;margin:0 0 5px;letter-spacing:.05em}.vip-flow-text{white-space:pre-wrap;line-height:1.65;font-size:13px;color:#293449}.vip-flow-text.zh{background:#f7f8fa;border-radius:10px;padding:10px 11px;margin-bottom:10px;color:#5a6577}.vip-flow-text.foreign{font-size:14px}',
      '.vip-flow-note{margin-top:10px;border-left:3px solid #d6cdfa;background:#faf8ff;border-radius:0 9px 9px 0;padding:8px 10px;font-size:11px;color:#6d6680;white-space:pre-wrap}',
      '.vip-flow-links{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.vip-flow-pill{display:inline-flex;align-items:center;gap:5px;text-decoration:none;border:1px solid #dfe3ea;border-radius:9px;background:#f8fafc;color:#344054;padding:6px 8px;font-size:11px;font-weight:800}.vip-flow-pill.tool{border-color:#bde1de;background:#effaf8;color:#137b73}.vip-flow-pill:hover{filter:brightness(.97)}',
      '.vip-flow-empty{background:#fff;border:1px dashed #cfd5df;border-radius:15px;padding:34px;text-align:center;color:#7b8495}',
      '.vip-flow-toast{position:fixed;left:50%;bottom:28px;transform:translate(-50%,20px);background:#1f2937;color:#fff;padding:10px 14px;border-radius:10px;font-size:12px;font-weight:700;opacity:0;pointer-events:none;transition:.2s;z-index:100000}.vip-flow-toast.show{opacity:1;transform:translate(-50%,0)}',
      'body.vip-flow-open{overflow:hidden}',
      '@media(max-width:780px){.vip-flow-panel{width:100vw}.vip-flow-body{grid-template-columns:1fr}.vip-flow-sidebar{display:flex;overflow:auto;border-right:0;border-bottom:1px solid #e6e9ef;padding:9px}.vip-flow-group{display:none}.vip-flow-tab{min-width:180px}.vip-flow-main{padding:13px}.vip-flow-head{padding:12px}.vip-flow-title{font-size:17px}.vip-flow-head-actions .vip-flow-action{display:none}}'
    ].join('');
    document.head.appendChild(s);
  }

  function toast(msg){
    var t=document.getElementById('vipFlowToast');
    if(!t){
      t=document.createElement('div');
      t.id='vipFlowToast';
      t.className='vip-flow-toast';
      document.body.appendChild(t);
    }
    t.textContent=msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer=setTimeout(function(){t.classList.remove('show');},1800);
  }

  function absAsset(url){
    if(!url)return '';
    if(/^data:|^https?:/i.test(url))return url;
    return OLD_BASE+String(url).replace(/^\.\.\//,'').replace(/^\.\//,'');
  }

  function absTool(path){
    if(!path)return '#';
    if(/^https?:/i.test(path))return path;
    return OLD_BASE+String(path).replace(/^\.\.\//,'').replace(/^\.\//,'');
  }

  async function loadBundle(){
    if(flowBundle)return flowBundle;
    var res=await fetch(DATA_URL,{cache:'no-store'});
    if(!res.ok)throw new Error('无法读取维权流程数据');
    flowBundle=await res.json();
    if(!flowBundle||!Array.isArray(flowBundle.workflows))throw new Error('维权流程数据格式错误');
    return flowBundle;
  }

  function keyFor(customerId){
    return STORAGE_PREFIX+String(customerId);
  }

  function loadProgress(customerId){
    try{
      var raw=localStorage.getItem(keyFor(customerId));
      var d=raw?JSON.parse(raw):{};
      if(!d||typeof d!=='object')d={};
      d.flows=d.flows&&typeof d.flows==='object'?d.flows:{};
      return d;
    }catch(e){
      return {flows:{}};
    }
  }

  function saveProgress(customerId,data){
    data.updatedAt=Date.now();
    try{
      localStorage.setItem(keyFor(customerId),JSON.stringify(data));
    }catch(e){
      toast('本地保存空间不足');
    }
  }

  function getCompletedSet(data,flowId){
    var f=data.flows[flowId]||{};
    return new Set(Array.isArray(f.completed)?f.completed.map(String):[]);
  }

  function setCompleted(data,flowId,set){
    data.flows[flowId]={completed:Array.from(set),updatedAt:Date.now()};
  }

  function groupName(flow){
    var n=String(flow.name||'');
    if(n.indexOf('德国')>=0)return '德国流程';
    if(n.indexOf('美国')>=0)return '美国流程';
    return '其他流程';
  }

  function flowStats(flow,progress){
    var done=getCompletedSet(progress,flow.id);
    var total=Array.isArray(flow.steps)?flow.steps.length:0;
    var completed=(flow.steps||[]).filter(function(s){return done.has(String(s.id));}).length;
    return {done:done,total:total,completed:completed,percent:total?Math.round(completed/total*100):0};
  }

  function overallCompleted(customerId){
    if(!flowBundle)return 0;
    var p=loadProgress(customerId),done=0,total=0;
    (flowBundle.workflows||[]).forEach(function(f){
      var s=flowStats(f,p);done+=s.completed;total+=s.total;
    });
    return total?Math.round(done/total*100):0;
  }

  function findCustomerId(row){
    var nodes=row.querySelectorAll('[data-id]');
    for(var i=0;i<nodes.length;i++){
      if(nodes[i].dataset&&nodes[i].dataset.id)return nodes[i].dataset.id;
    }
    return '';
  }

  function findCustomerName(row){
    var b=row.querySelector('td[data-label="客户姓名"] b');
    if(b)return b.textContent.trim();
    var cells=row.querySelectorAll('td');
    return cells[1]?cells[1].textContent.trim():'未命名客户';
  }

  function installButtons(root){
    (root||document).querySelectorAll('.customer-progress-row').forEach(function(row){
      if(row.querySelector('.vip-flow-btn'))return;
      var id=findCustomerId(row);
      if(!id)return;
      var actionCell=row.querySelector('td[data-label="操作"] .row')||row.querySelector('td:last-child .row');
      if(!actionCell)return;
      var btn=document.createElement('button');
      btn.type='button';
      btn.className='btn soft vip-flow-btn';
      btn.dataset.id=id;
      var pct=overallCompleted(id);
      btn.innerHTML='维权流程'+(pct?'<span class="vip-flow-dot">'+pct+'%</span>':'');
      btn.addEventListener('click',function(e){
        e.preventDefault();e.stopPropagation();
        openPanel(id,findCustomerName(row));
      });
      actionCell.insertBefore(btn,actionCell.firstChild);
    });
  }

  function observeTables(){
    installButtons(document);
    if(observer)return;
    observer=new MutationObserver(function(){installButtons(document);});
    observer.observe(document.body,{childList:true,subtree:true});
  }

  function closePanel(){
    var o=document.getElementById('vipFlowOverlay');
    if(o)o.remove();
    document.body.classList.remove('vip-flow-open');
    currentCustomer=null;
  }

  function createShell(customerId,customerName){
    closePanel();
    currentCustomer={id:String(customerId),name:customerName||'未命名客户'};
    var overlay=document.createElement('div');
    overlay.id='vipFlowOverlay';
    overlay.className='vip-flow-overlay';
    overlay.innerHTML=
      '<section class="vip-flow-panel" role="dialog" aria-modal="true">'+
        '<header class="vip-flow-head">'+
          '<div class="vip-flow-head-main"><div class="vip-flow-kicker">MOSEN VIP · 客户独立流程</div><div class="vip-flow-title">'+esc(customerName||'未命名客户')+'</div><div class="vip-flow-sub">每个客户的“已发送”勾选状态单独保存，不影响其他客户，也不会写回原两个仓库。</div></div>'+
          '<div class="vip-flow-head-actions"><button type="button" class="vip-flow-action" data-vip-open-launcher>打开墨森打开器</button><button type="button" class="vip-flow-icon-btn" data-vip-close aria-label="关闭">×</button></div>'+
        '</header>'+
        '<div class="vip-flow-body"><aside class="vip-flow-sidebar" data-vip-sidebar><div class="vip-flow-empty">正在读取流程…</div></aside><main class="vip-flow-main" data-vip-main><div class="vip-flow-empty">正在读取流程内容…</div></main></div>'+
      '</section>';
    overlay.addEventListener('click',function(e){if(e.target===overlay)closePanel();});
    overlay.querySelector('[data-vip-close]').addEventListener('click',closePanel);
    overlay.querySelector('[data-vip-open-launcher]').addEventListener('click',function(){
      window.open(OLD_BASE,'_blank','noopener');
    });
    document.body.appendChild(overlay);
    document.body.classList.add('vip-flow-open');
    return overlay;
  }

  function chooseInitialFlow(bundle,progress){
    var last=progress.activeFlowId;
    if(last&&bundle.workflows.some(function(f){return String(f.id)===String(last);}))return String(last);
    for(var i=0;i<bundle.workflows.length;i++){
      var st=flowStats(bundle.workflows[i],progress);
      if(st.completed>0&&st.completed<st.total)return String(bundle.workflows[i].id);
    }
    return bundle.workflows[0]?String(bundle.workflows[0].id):'';
  }

  function renderSidebar(overlay,bundle,progress,activeId){
    var side=overlay.querySelector('[data-vip-sidebar]');
    var groups={};
    bundle.workflows.forEach(function(f){
      var g=groupName(f);(groups[g]||(groups[g]=[])).push(f);
    });
    var html='';
    Object.keys(groups).forEach(function(g){
      html+='<div class="vip-flow-group">'+esc(g)+'</div>';
      groups[g].forEach(function(f){
        var st=flowStats(f,progress);
        html+='<button type="button" class="vip-flow-tab '+(String(f.id)===String(activeId)?'active':'')+'" data-vip-flow-id="'+esc(f.id)+'"><strong>'+esc(f.name)+'</strong><span>已发送 '+st.completed+' / '+st.total+' · '+st.percent+'%</span></button>';
      });
    });
    side.innerHTML=html||'<div class="vip-flow-empty">暂无流程</div>';
    side.querySelectorAll('[data-vip-flow-id]').forEach(function(btn){
      btn.addEventListener('click',function(){
        progress.activeFlowId=btn.dataset.vipFlowId;
        saveProgress(currentCustomer.id,progress);
        renderAll(overlay,bundle,progress,btn.dataset.vipFlowId);
      });
    });
  }

  function copyText(text){
    if(navigator.clipboard&&navigator.clipboard.writeText)return navigator.clipboard.writeText(text);
    return new Promise(function(resolve,reject){
      try{
        var t=document.createElement('textarea');t.value=text;document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();resolve();
      }catch(e){reject(e);}
    });
  }

  function renderFlow(overlay,bundle,progress,flowId){
    var main=overlay.querySelector('[data-vip-main]');
    var flow=bundle.workflows.find(function(f){return String(f.id)===String(flowId);});
    if(!flow){main.innerHTML='<div class="vip-flow-empty">未找到此流程</div>';return;}
    var st=flowStats(flow,progress);
    var nextStep=(flow.steps||[]).find(function(s){return !st.done.has(String(s.id));});
    var hideDone=progress.hideDone===true;
    var visibleSteps=(flow.steps||[]).filter(function(s){return !(hideDone&&st.done.has(String(s.id)));});
    var nextText=nextStep?('第 '+((flow.steps||[]).indexOf(nextStep)+1)+' 句 · '+(nextStep.title||'未命名步骤')):'本流程已全部完成';
    var html=
      '<div class="vip-flow-summary"><div class="vip-flow-summary-card">'+
        '<div class="vip-flow-summary-top"><h3>'+esc(flow.name)+'</h3><span class="vip-flow-percent">'+st.percent+'%</span></div>'+
        '<div class="vip-flow-progress"><span style="width:'+st.percent+'%"></span></div>'+
        '<div class="vip-flow-next"><span>已发送 <b>'+st.completed+' / '+st.total+'</b></span><span>下一句：<b>'+esc(nextText)+'</b></span>'+(nextStep?'<button type="button" data-vip-next>定位下一句</button>':'')+'</div>'+
        '<label class="vip-flow-filter"><input type="checkbox" data-vip-hide-done '+(hideDone?'checked':'')+'> 只显示未发送话术</label>'+
      '</div></div>'+
      '<div class="vip-flow-step-list">';

    if(!visibleSteps.length){
      html+='<div class="vip-flow-empty">这个流程已经全部勾选完成。</div>';
    }else{
      visibleSteps.forEach(function(step){
        var idx=(flow.steps||[]).indexOf(step)+1;
        var done=st.done.has(String(step.id));
        var isNext=nextStep&&String(nextStep.id)===String(step.id);
        var attachments=Array.isArray(step.attachments)?step.attachments:[];
        var tools=Array.isArray(step.toolLinks)?step.toolLinks:[];
        html+='<article class="vip-flow-step '+(done?'done ':'')+(isNext?'next':'')+'" data-vip-step-id="'+esc(step.id)+'">'+
          '<div class="vip-flow-step-head">'+
            '<input class="vip-flow-check" type="checkbox" '+(done?'checked':'')+' data-vip-check="'+esc(step.id)+'" title="已发送">'+
            '<div class="vip-flow-num">'+idx+'</div>'+
            '<div class="vip-flow-step-title"><strong>'+esc(step.title||'未命名步骤')+'</strong><span>'+esc(step.type||'话术')+(isNext?' · 下一句':'')+'</span></div>'+
            '<button type="button" class="vip-flow-copy" data-vip-copy="'+esc(step.id)+'">复制并勾选</button>'+
          '</div>'+
          '<div class="vip-flow-step-body">';
        if(step.contentZh){
          html+='<div class="vip-flow-language">中文参考</div><div class="vip-flow-text zh">'+esc(step.contentZh)+'</div>';
        }
        if(step.contentForeign){
          html+='<div class="vip-flow-language">实际发送内容</div><div class="vip-flow-text foreign">'+esc(step.contentForeign)+'</div>';
        }
        if(step.note)html+='<div class="vip-flow-note"><b>备注：</b> '+esc(step.note)+'</div>';
        if(attachments.length||tools.length){
          html+='<div class="vip-flow-links">';
          attachments.forEach(function(a){
            var href=absAsset(a.url||a.data||'');
            html+='<a class="vip-flow-pill" href="'+esc(href)+'" target="_blank" rel="noopener">附件 · '+esc(a.name||'查看')+'</a>';
          });
          tools.forEach(function(t){
            html+='<a class="vip-flow-pill tool" href="'+esc(absTool(t.path))+'" target="_blank" rel="noopener">快捷方式 · '+esc(t.title||t.path)+'</a>';
          });
          html+='</div>';
        }
        html+='</div></article>';
      });
    }
    html+='</div>';
    main.innerHTML=html;

    var hideToggle=main.querySelector('[data-vip-hide-done]');
    if(hideToggle)hideToggle.addEventListener('change',function(){
      progress.hideDone=hideToggle.checked;
      saveProgress(currentCustomer.id,progress);
      renderFlow(overlay,bundle,progress,flow.id);
    });

    var nextBtn=main.querySelector('[data-vip-next]');
    if(nextBtn)nextBtn.addEventListener('click',function(){
      var el=main.querySelector('.vip-flow-step.next');
      if(el)el.scrollIntoView({behavior:'smooth',block:'center'});
    });

    main.querySelectorAll('[data-vip-check]').forEach(function(cb){
      cb.addEventListener('change',function(){
        var done=getCompletedSet(progress,flow.id);
        if(cb.checked)done.add(String(cb.dataset.vipCheck));else done.delete(String(cb.dataset.vipCheck));
        setCompleted(progress,flow.id,done);
        saveProgress(currentCustomer.id,progress);
        renderAll(overlay,bundle,progress,flow.id);
        installButtons(document);
      });
    });

    main.querySelectorAll('[data-vip-copy]').forEach(function(btn){
      btn.addEventListener('click',async function(){
        var step=(flow.steps||[]).find(function(s){return String(s.id)===String(btn.dataset.vipCopy);});
        if(!step)return;
        var text=String(step.contentForeign||step.contentZh||'').trim();
        if(!text){toast('该步骤没有可复制的话术');return;}
        try{
          await copyText(text);
          var done=getCompletedSet(progress,flow.id);
          done.add(String(step.id));
          setCompleted(progress,flow.id,done);
          saveProgress(currentCustomer.id,progress);
          toast('已复制，并标记为已发送');
          renderAll(overlay,bundle,progress,flow.id);
          installButtons(document);
        }catch(e){
          toast('复制失败，请重试');
        }
      });
    });
  }

  function renderAll(overlay,bundle,progress,activeId){
    renderSidebar(overlay,bundle,progress,activeId);
    renderFlow(overlay,bundle,progress,activeId);
  }

  async function openPanel(customerId,customerName){
    injectStyles();
    var overlay=createShell(customerId,customerName);
    try{
      var bundle=await loadBundle();
      if(!document.body.contains(overlay))return;
      var progress=loadProgress(customerId);
      var activeId=chooseInitialFlow(bundle,progress);
      progress.activeFlowId=activeId;
      saveProgress(customerId,progress);
      renderAll(overlay,bundle,progress,activeId);
    }catch(e){
      var side=overlay.querySelector('[data-vip-sidebar]');
      var main=overlay.querySelector('[data-vip-main]');
      if(side)side.innerHTML='<div class="vip-flow-empty">流程载入失败</div>';
      if(main)main.innerHTML='<div class="vip-flow-empty">'+esc(e&&e.message?e.message:String(e))+'<br><br>请刷新页面后重试。</div>';
    }
  }

  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'&&document.getElementById('vipFlowOverlay'))closePanel();
  });

  injectStyles();
  loadBundle().then(function(){
    observeTables();
    setInterval(function(){installButtons(document);},2500);
  }).catch(function(){
    observeTables();
  });
})();