(function(){
  'use strict';

  var DATA_URL='./toolbox/data/chat-flows.json?v=20260929-standalone-1';
  var STORAGE_PREFIX='mosen_vip_customer_flow_v1:';
  var OLD_BASE='./toolbox/';
  var flowBundle=null;
  var currentCustomer=null;
  var observer=null;
  var base44Promise=null;
  var cloudRows={};
  var cloudSaveTimers={};

  function getBase44(){
    if(!base44Promise)base44Promise=import('./base44.js').then(function(m){return m.base44});
    return base44Promise;
  }

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
      '.vip-flow-summary{position:relative;z-index:1;background:transparent;padding:0 0 10px}',
      '.vip-flow-summary-card{background:#fff;border:1px solid #e5e8ef;border-radius:15px;padding:14px 16px;box-shadow:0 8px 26px rgba(26,35,55,.05)}',
      '.vip-flow-summary-top{display:flex;align-items:center;gap:12px}.vip-flow-summary-top h3{margin:0;font-size:17px}.vip-flow-percent{margin-left:auto;font-size:18px;font-weight:900;color:#6d4aff}',
      '.vip-flow-progress{height:8px;background:#edf0f4;border-radius:99px;overflow:hidden;margin-top:11px}.vip-flow-progress span{display:block;height:100%;background:#6d4aff;border-radius:99px;transition:.2s}',
      '.vip-flow-next{margin-top:10px;display:flex;align-items:center;gap:8px;font-size:12px;color:#657084}.vip-flow-next b{color:#273248}.vip-flow-next button{margin-left:auto;border:0;background:#eeeaff;color:#5b35d5;border-radius:9px;padding:7px 9px;font-weight:800;cursor:pointer}',
      '.vip-flow-filter{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px;color:#657084}.vip-flow-filter input{accent-color:#6d4aff}',
      '.vip-flow-step-list{display:flex;flex-direction:column;gap:8px}',
      '.vip-flow-step{background:#fff;border:1px solid #e4e8ef;border-radius:15px;overflow:hidden;box-shadow:0 5px 18px rgba(20,29,48,.035);transition:.16s}.vip-flow-step.done{opacity:.68;background:#fbfcfd}.vip-flow-step.next{border-color:#8b72f0;box-shadow:0 0 0 3px rgba(109,74,255,.10),0 8px 24px rgba(20,29,48,.05)}',
      '.vip-flow-step-head{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #eef1f5}.vip-flow-check{width:19px;height:19px;accent-color:#16a36a;cursor:pointer}.vip-flow-num{width:25px;height:25px;border-radius:8px;background:#f1edff;color:#633fd7;display:grid;place-items:center;font-size:10px;font-weight:900;flex:0 0 auto}.vip-flow-step-title{min-width:0;flex:1}.vip-flow-step-title strong{font-size:13px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.vip-flow-step-title span{font-size:10px;color:#8a93a4;margin-top:2px;display:block}.vip-flow-copy{border:0;border-radius:8px;background:#6d4aff;color:#fff;padding:7px 9px;font-size:11px;font-weight:800;cursor:pointer;white-space:nowrap}.vip-flow-copy:hover{background:#5837d0}',
      '.vip-flow-step-body{padding:8px 12px 10px}.vip-flow-language{font-size:9px;font-weight:900;color:#8a93a4;margin:0 0 3px;letter-spacing:.05em}.vip-flow-text{white-space:normal;line-height:1.45;font-size:12px;color:#293449;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;text-overflow:ellipsis;word-break:break-word}.vip-flow-text.zh{height:44px;box-sizing:border-box;background:#f7f8fa;border-radius:8px;padding:6px 9px;margin-bottom:6px;color:#5a6577}.vip-flow-text.foreign{height:36px;font-size:12.5px}',
      '.vip-flow-note{margin-top:6px;border-left:3px solid #d6cdfa;background:#faf8ff;border-radius:0 8px 8px 0;padding:6px 8px;font-size:10px;color:#6d6680;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.vip-flow-links{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px;overflow:visible}.vip-flow-pill{display:inline-flex;align-items:center;gap:4px;text-decoration:none;border:1px solid #dfe3ea;border-radius:8px;background:#f8fafc;color:#344054;padding:5px 7px;font-size:10px;font-weight:800;white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis}.vip-flow-pill.tool{border-color:#bde1de;background:#effaf8;color:#137b73}.vip-flow-pill:hover{filter:brightness(.97)}.vip-flow-image-thumb{width:72px;height:54px;border:1px solid #dfe3ea;border-radius:8px;background:#fff;padding:0;overflow:hidden;cursor:zoom-in;display:block;flex:0 0 auto}.vip-flow-image-thumb img{width:100%;height:100%;object-fit:cover;display:block}.vip-flow-image-wrap{display:flex;flex-direction:column;gap:3px;max-width:86px}.vip-flow-image-name{font-size:9px;color:#667085;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.vip-flow-viewer{position:fixed;inset:0;z-index:2147483647;background:rgba(8,12,20,.86);display:grid;place-items:center;padding:28px}.vip-flow-viewer[hidden]{display:none}.vip-flow-viewer-stage{position:relative;max-width:min(94vw,1500px);max-height:92vh;display:grid;place-items:center}.vip-flow-viewer img{max-width:94vw;max-height:88vh;object-fit:contain;border-radius:10px;box-shadow:0 24px 80px rgba(0,0,0,.4);background:#fff}.vip-flow-viewer-close{position:absolute;top:-18px;right:-18px;width:38px;height:38px;border:0;border-radius:999px;background:#fff;color:#111827;font-size:22px;font-weight:900;cursor:pointer;box-shadow:0 8px 30px rgba(0,0,0,.24)}.vip-flow-viewer-caption{position:absolute;left:0;right:0;bottom:-25px;text-align:center;color:#fff;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.vip-flow-empty{background:#fff;border:1px dashed #cfd5df;border-radius:15px;padding:34px;text-align:center;color:#7b8495}',
      '.vip-flow-toast{position:fixed;left:50%;bottom:28px;transform:translate(-50%,20px);background:#1f2937;color:#fff;padding:10px 14px;border-radius:10px;font-size:12px;font-weight:700;opacity:0;pointer-events:none;transition:.2s;z-index:100000}.vip-flow-toast.show{opacity:1;transform:translate(-50%,0)}',
      'body.vip-flow-open{overflow:hidden}',
      '.vip-flow-inline-shell{margin-top:16px;border:1px solid #e5e8ef;border-radius:16px;overflow:hidden;background:#f7f8fb}.vip-flow-inline-head{padding:12px 14px;background:#fff;border-bottom:1px solid #e6e9ef;display:flex;align-items:center;gap:10px}.vip-flow-inline-head strong{font-size:14px}.vip-flow-inline-head span{font-size:11px;color:#7a8497}.vip-flow-inline-body{display:grid;grid-template-columns:230px minmax(0,1fr);min-height:520px}.vip-flow-inline-body .vip-flow-sidebar{position:relative;height:auto;max-height:680px}.vip-flow-inline-body .vip-flow-main{max-height:680px}',
      '@media(max-width:780px){.vip-flow-panel{width:100vw}.vip-flow-body,.vip-flow-inline-body{grid-template-columns:1fr}.vip-flow-sidebar{display:flex;overflow:auto;border-right:0;border-bottom:1px solid #e6e9ef;padding:9px}.vip-flow-group{display:none}.vip-flow-tab{min-width:180px}.vip-flow-main{padding:13px}.vip-flow-head{padding:12px}.vip-flow-title{font-size:17px}.vip-flow-head-actions .vip-flow-action{display:none}}'
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

  function isImageAttachment(a){
    var type=String(a&&a.type||'').toLowerCase();
    var name=String(a&&a.name||a&&a.url||'').toLowerCase();
    var src=String(a&&a.data||a&&a.url||'').toLowerCase();
    return type.indexOf('image/')===0||/^data:image\//.test(src)||/\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(name);
  }

  function openImageViewer(src,name){
    if(!src)return;
    var viewer=document.getElementById('vipFlowImageViewer');
    if(!viewer){
      viewer=document.createElement('div');
      viewer.id='vipFlowImageViewer';
      viewer.className='vip-flow-viewer';
      viewer.hidden=true;
      viewer.innerHTML='<div class="vip-flow-viewer-stage"><button type="button" class="vip-flow-viewer-close" aria-label="关闭">×</button><img alt="附件预览"><div class="vip-flow-viewer-caption"></div></div>';
      document.body.appendChild(viewer);
      viewer.addEventListener('click',function(e){if(e.target===viewer)viewer.hidden=true;});
      viewer.querySelector('.vip-flow-viewer-close').addEventListener('click',function(){viewer.hidden=true;});
    }
    viewer.querySelector('img').src=src;
    viewer.querySelector('img').alt=name||'附件预览';
    viewer.querySelector('.vip-flow-viewer-caption').textContent=name||'';
    viewer.hidden=false;
  }

  async function loadBundle(force){
    if(flowBundle&&!force)return flowBundle;
    try{
      var base44=await getBase44();
      var result=await base44.entities.VIPWorkflowDefinition.filter({key:'main'},'-updated_date',1,0);
      var rows=Array.isArray(result)?result:(result&&result.items)||[];
      if(rows[0]&&rows[0].bundle&&Array.isArray(rows[0].bundle.workflows)){
        flowBundle=rows[0].bundle;
        return flowBundle;
      }
    }catch(e){}
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

  async function loadCloudProgress(customerId){
    var local=loadProgress(customerId);
    try{
      var base44=await getBase44();
      var result=await base44.entities.VIPWorkflowProgress.filter({customer_id:String(customerId)},'-updated_date',1,0);
      var rows=Array.isArray(result)?result:(result&&result.items)||[];
      var row=rows[0];
      if(!row)return local;
      cloudRows[String(customerId)]=row.id;
      var cloud={
        activeFlowId:row.active_flow_id||local.activeFlowId||'',
        hideDone:row.hide_done===true,
        flows:row.flows&&typeof row.flows==='object'?row.flows:(local.flows||{}),
        updatedAt:Date.parse(row.updated_date||'')||Date.now()
      };
      try{localStorage.setItem(keyFor(customerId),JSON.stringify(cloud))}catch(_){}
      return cloud;
    }catch(e){
      return local;
    }
  }

  function queueCloudSave(customerId,data){
    var key=String(customerId);
    clearTimeout(cloudSaveTimers[key]);
    cloudSaveTimers[key]=setTimeout(async function(){
      try{
        var base44=await getBase44();
        var payload={
          customer_id:key,
          customer_name:currentCustomer&&String(currentCustomer.id)===key?currentCustomer.name:'',
          active_flow_id:data.activeFlowId||'',
          hide_done:data.hideDone===true,
          flows:data.flows||{},
          updated_by:(localStorage.getItem('mVIP_rep_username')||'admin')
        };
        var rowId=cloudRows[key];
        if(!rowId){
          var found=await base44.entities.VIPWorkflowProgress.filter({customer_id:key},'-updated_date',1,0);
          var rows=Array.isArray(found)?found:(found&&found.items)||[];
          if(rows[0]){rowId=rows[0].id;cloudRows[key]=rowId}
        }
        if(rowId)await base44.entities.VIPWorkflowProgress.update(rowId,payload);
        else{
          var created=await base44.entities.VIPWorkflowProgress.create(payload);
          if(created&&created.id)cloudRows[key]=created.id;
        }
      }catch(e){}
    },350);
  }

  function saveProgress(customerId,data){
    data.updatedAt=Date.now();
    try{
      localStorage.setItem(keyFor(customerId),JSON.stringify(data));
    }catch(e){
      toast('本地保存空间不足');
    }
    queueCloudSave(customerId,data);
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
      var id=findCustomerId(row);
      if(!id)return;
      var pct=overallCompleted(id);
      var existing=row.querySelector('.vip-flow-btn');
      if(existing){
        existing.innerHTML='维权流程'+(pct?'<span class="vip-flow-dot">'+pct+'%</span>':'');
        return;
      }
      var actionCell=row.querySelector('td[data-label="操作"] .row')||row.querySelector('td:last-child .row');
      if(!actionCell)return;
      var btn=document.createElement('button');
      btn.type='button';
      btn.className='btn soft vip-flow-btn';
      btn.dataset.id=id;
      btn.innerHTML='维权流程'+(pct?'<span class="vip-flow-dot">'+pct+'%</span>':'');
      btn.addEventListener('click',function(e){
        e.preventDefault();e.stopPropagation();
        openPanel(id,findCustomerName(row));
      });
      actionCell.insertBefore(btn,actionCell.firstChild);
    });
  }

  function observeTables(){
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
          '<div class="vip-flow-head-actions"><button type="button" class="vip-flow-action" data-vip-open-launcher>打开 VIP 工具箱</button><button type="button" class="vip-flow-icon-btn" data-vip-close aria-label="关闭">×</button></div>'+
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
    var lastFlow=last&&bundle.workflows.find(function(f){return String(f.id)===String(last);});
    if(lastFlow){
      var lastStats=flowStats(lastFlow,progress);
      if(lastStats.completed>0&&lastStats.completed<lastStats.total)return String(lastFlow.id);
    }
    for(var i=0;i<bundle.workflows.length;i++){
      var st=flowStats(bundle.workflows[i],progress);
      if(st.completed>0&&st.completed<st.total)return String(bundle.workflows[i].id);
    }
    if(lastFlow){
      var ls=flowStats(lastFlow,progress);
      if(ls.completed<ls.total)return String(lastFlow.id);
    }
    for(var j=0;j<bundle.workflows.length;j++){
      var s2=flowStats(bundle.workflows[j],progress);
      if(s2.completed<s2.total)return String(bundle.workflows[j].id);
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
        renderAll(overlay,bundle,progress,btn.dataset.vipFlowId,true);
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
          html+='<div class="vip-flow-language">中文参考</div><div class="vip-flow-text zh" title="'+esc(step.contentZh)+'">'+esc(step.contentZh)+'</div>';
        }
        if(step.contentForeign){
          html+='<div class="vip-flow-language">实际发送内容</div><div class="vip-flow-text foreign" title="'+esc(step.contentForeign)+'">'+esc(step.contentForeign)+'</div>';
        }
        if(step.note)html+='<div class="vip-flow-note"><b>备注：</b> '+esc(step.note)+'</div>';
        if(attachments.length||tools.length){
          html+='<div class="vip-flow-links">';
          attachments.forEach(function(a){
            var href=absAsset(a.url||a.data||'');
            if(isImageAttachment(a)){
              html+='<div class="vip-flow-image-wrap"><button type="button" class="vip-flow-image-thumb" data-vip-image="'+esc(href)+'" data-vip-image-name="'+esc(a.name||'图片附件')+'"><img src="'+esc(href)+'" alt="'+esc(a.name||'图片附件')+'" loading="lazy"></button><div class="vip-flow-image-name" title="'+esc(a.name||'图片附件')+'">'+esc(a.name||'图片附件')+'</div></div>';
            }else{
              html+='<a class="vip-flow-pill" href="'+esc(href)+'" target="_blank" rel="noopener">附件 · '+esc(a.name||'查看')+'</a>';
            }
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
      });
    });

    main.querySelectorAll('[data-vip-image]').forEach(function(btn){
      btn.addEventListener('click',function(){
        openImageViewer(btn.dataset.vipImage,btn.dataset.vipImageName||'图片附件');
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
        }catch(e){
          toast('复制失败，请重试');
        }
      });
    });
  }

  function locateCurrentStep(overlay,behavior){
    setTimeout(function(){
      var main=overlay.querySelector('[data-vip-main]');
      if(!main)return;
      var el=main.querySelector('.vip-flow-step.next');
      if(!el){main.scrollTop=0;return;}
      var mainBox=main.getBoundingClientRect(),elBox=el.getBoundingClientRect();
      var target=main.scrollTop+(elBox.top-mainBox.top)-18;
      try{main.scrollTo({top:Math.max(0,target),behavior:behavior||'auto'});}catch(e){main.scrollTop=Math.max(0,target);}
    },50);
  }

  function renderAll(overlay,bundle,progress,activeId,autoLocate){
    renderSidebar(overlay,bundle,progress,activeId);
    renderFlow(overlay,bundle,progress,activeId);
    if(autoLocate)locateCurrentStep(overlay,'auto');
  }

  async function openPanel(customerId,customerName){
    injectStyles();
    var overlay=createShell(customerId,customerName);
    try{
      var bundle=await loadBundle(true);
      if(!document.body.contains(overlay))return;
      var progress=await loadCloudProgress(customerId);
      var activeId=chooseInitialFlow(bundle,progress);
      progress.activeFlowId=activeId;
      saveProgress(customerId,progress);
      renderAll(overlay,bundle,progress,activeId,true);
    }catch(e){
      var side=overlay.querySelector('[data-vip-sidebar]');
      var main=overlay.querySelector('[data-vip-main]');
      if(side)side.innerHTML='<div class="vip-flow-empty">流程载入失败</div>';
      if(main)main.innerHTML='<div class="vip-flow-empty">'+esc(e&&e.message?e.message:String(e))+'<br><br>请刷新页面后重试。</div>';
    }
  }

  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'){
      var viewer=document.getElementById('vipFlowImageViewer');
      if(viewer&&!viewer.hidden){viewer.hidden=true;return;}
      if(document.getElementById('vipFlowOverlay'))closePanel();
    }
  });

  async function mountInline(container,customerId,customerName){
    if(!container)return;
    injectStyles();
    currentCustomer={id:String(customerId),name:customerName||'未命名客户'};
    container.hidden=false;
    container.innerHTML='<section class="vip-flow-inline-shell"><div class="vip-flow-inline-head"><div><strong>维权流程</strong><br><span>'+esc(customerName||'未命名客户')+' · 当前客户独立进度</span></div></div><div class="vip-flow-inline-body"><aside class="vip-flow-sidebar" data-vip-sidebar><div class="vip-flow-empty">正在读取流程…</div></aside><main class="vip-flow-main" data-vip-main><div class="vip-flow-empty">正在读取流程内容…</div></main></div></section>';
    try{
      var bundle=await loadBundle(true);
      var progress=await loadCloudProgress(customerId);
      var activeId=chooseInitialFlow(bundle,progress);
      progress.activeFlowId=activeId;
      saveProgress(customerId,progress);
      renderAll(container,bundle,progress,activeId,true);
    }catch(e){
      container.innerHTML='<div class="vip-flow-empty">'+esc(e&&e.message?e.message:String(e))+'</div>';
    }
  }

  window.MosenVIPWorkflow={
    open:function(customerId,customerName){
      return openPanel(customerId,customerName);
    },
    mount:function(container,customerId,customerName){
      return mountInline(container,customerId,customerName);
    }
  };
})();