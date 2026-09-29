(function(){
  'use strict';
  if(window.vipAlert&&window.vipConfirm&&window.vipPrompt&&window.vipSelect)return;

  function ensure(){
    if(document.getElementById('vipUiDialogRoot'))return;
    var style=document.createElement('style');
    style.id='vipUiDialogStyles';
    style.textContent=[
      '.vip-ui-dialog-backdrop{position:fixed;inset:0;z-index:2147483646;background:rgba(15,23,42,.48);backdrop-filter:blur(4px);display:grid;place-items:center;padding:18px}',
      '.vip-ui-dialog-card{width:min(460px,calc(100vw - 36px));background:#fff;border:1px solid #e5e8ef;border-radius:18px;box-shadow:0 30px 100px rgba(15,23,42,.28);overflow:hidden;color:#172033;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}',
      '.vip-ui-dialog-head{padding:18px 20px 8px}.vip-ui-dialog-title{font-size:18px;font-weight:900;letter-spacing:-.02em}.vip-ui-dialog-body{padding:8px 20px 18px;font-size:13px;line-height:1.65;color:#596579;white-space:pre-wrap;word-break:break-word}',
      '.vip-ui-dialog-input,.vip-ui-dialog-select{width:100%;border:1px solid #d7dde6;border-radius:10px;background:#fff;color:#172033;padding:10px 11px;margin-top:12px;outline:none;font:inherit}.vip-ui-dialog-input:focus,.vip-ui-dialog-select:focus{border-color:#8b72f0;box-shadow:0 0 0 3px rgba(109,74,255,.10)}',
      '.vip-ui-dialog-actions{display:flex;justify-content:flex-end;gap:8px;padding:12px 20px 18px;border-top:1px solid #eef1f5}.vip-ui-dialog-btn{border:0;border-radius:9px;padding:9px 13px;font-size:12px;font-weight:850;cursor:pointer;background:#eef1f5;color:#344054}.vip-ui-dialog-btn.primary{background:#6d4aff;color:#fff}.vip-ui-dialog-btn.danger{background:#d92d20;color:#fff}.vip-ui-dialog-btn:hover{filter:brightness(.98)}',
      '.vip-ui-dialog-note{font-size:10px;color:#98a2b3;margin-top:8px}'
    ].join('');
    document.head.appendChild(style);
    var root=document.createElement('div');
    root.id='vipUiDialogRoot';
    document.body.appendChild(root);
  }

  function show(opts){
    ensure();
    opts=opts||{};
    return new Promise(function(resolve){
      var root=document.getElementById('vipUiDialogRoot');
      var backdrop=document.createElement('div');
      backdrop.className='vip-ui-dialog-backdrop';
      var card=document.createElement('div');
      card.className='vip-ui-dialog-card';
      var title=opts.title||'提示';
      var body=opts.message==null?'':String(opts.message);
      var field='';
      if(opts.type==='prompt'){
        field='<input class="vip-ui-dialog-input" data-vip-field type="'+(opts.inputType||'text')+'" placeholder="'+escAttr(opts.placeholder||'')+'" value="'+escAttr(opts.value||'')+'">';
      }else if(opts.type==='select'){
        var options=(opts.options||[]).map(function(o){
          var v=typeof o==='object'?o.value:o;
          var l=typeof o==='object'?o.label:o;
          return '<option value="'+escAttr(v)+'" '+(String(v)===String(opts.value||'')?'selected':'')+'>'+escHtml(l)+'</option>';
        }).join('');
        field='<select class="vip-ui-dialog-select" data-vip-field>'+options+'</select>';
      }
      card.innerHTML=
        '<div class="vip-ui-dialog-head"><div class="vip-ui-dialog-title">'+escHtml(title)+'</div></div>'+
        '<div class="vip-ui-dialog-body">'+escHtml(body)+field+(opts.note?'<div class="vip-ui-dialog-note">'+escHtml(opts.note)+'</div>':'')+'</div>'+
        '<div class="vip-ui-dialog-actions">'+
          (opts.cancel===false?'':'<button type="button" class="vip-ui-dialog-btn" data-vip-cancel>'+(opts.cancelText||'取消')+'</button>')+
          '<button type="button" class="vip-ui-dialog-btn '+(opts.danger?'danger':'primary')+'" data-vip-ok>'+(opts.confirmText||'确定')+'</button>'+
        '</div>';
      backdrop.appendChild(card);root.appendChild(backdrop);
      var fieldEl=card.querySelector('[data-vip-field]');
      var done=false;
      function close(value){
        if(done)return;done=true;
        document.removeEventListener('keydown',onKey,true);
        backdrop.remove();resolve(value);
      }
      function onKey(e){
        if(e.key==='Escape'&&opts.cancel!==false){e.preventDefault();close(opts.type==='confirm'?false:null)}
        if(e.key==='Enter'&&opts.type!=='alert'&&document.activeElement===fieldEl){e.preventDefault();accept()}
      }
      function accept(){
        if(opts.type==='confirm')close(true);
        else if(opts.type==='prompt'||opts.type==='select')close(fieldEl?fieldEl.value:'');
        else close(true);
      }
      card.querySelector('[data-vip-ok]').addEventListener('click',accept);
      var cancel=card.querySelector('[data-vip-cancel]');
      if(cancel)cancel.addEventListener('click',function(){close(opts.type==='confirm'?false:null)});
      backdrop.addEventListener('click',function(e){if(e.target===backdrop&&opts.cancel!==false)close(opts.type==='confirm'?false:null)});
      document.addEventListener('keydown',onKey,true);
      setTimeout(function(){(fieldEl||card.querySelector('[data-vip-ok]')).focus();if(fieldEl&&fieldEl.select)fieldEl.select()},20);
    });
  }
  function escHtml(v){return String(v==null?'':v).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]})}
  function escAttr(v){return escHtml(v).replace(/\n/g,'&#10;')}

  window.vipAlert=function(message,opts){
    opts=Object.assign({type:'alert',title:'提示',confirmText:'知道了',cancel:false},opts||{});
    return show(Object.assign(opts,{message:message}));
  };
  window.vipConfirm=function(message,opts){
    opts=Object.assign({type:'confirm',title:'确认操作',confirmText:'确认',cancelText:'取消'},opts||{});
    return show(Object.assign(opts,{message:message}));
  };
  window.vipPrompt=function(message,opts){
    opts=Object.assign({type:'prompt',title:'请输入',confirmText:'确定',cancelText:'取消'},opts||{});
    return show(Object.assign(opts,{message:message}));
  };
  window.vipSelect=function(message,opts){
    opts=Object.assign({type:'select',title:'请选择',confirmText:'确定',cancelText:'取消'},opts||{});
    return show(Object.assign(opts,{message:message}));
  };
})();