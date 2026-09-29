import fs from 'node:fs/promises';

const html=await fs.readFile('toolbox/index.html','utf8');
const dynamic=JSON.parse(await fs.readFile('toolbox/tools/index.json','utf8')).tools||[];
const orderDoc=JSON.parse(await fs.readFile('toolbox/global-order.json','utf8'));
const order=orderDoc.toolCenter||{us:[],de:[],other:[]};

function clean(s=''){
  return String(s).replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').trim();
}
const staticItems=[];
for(const cat of ['us','de','other']){
  const sectionMatch=html.match(new RegExp('<section[^>]*data-section="'+cat+'"[\\s\\S]*?<div class="grid"[^>]*data-grid="'+cat+'"[^>]*>([\\s\\S]*?)<\\/div>\\s*<\\/section>','i'));
  const section=sectionMatch?.[1]||'';
  const re=/<a class="card"[\s\S]*?data-id="([^"]+)"[\s\S]*?data-name="([^"]*)"[\s\S]*?href="([^"]+)"[\s\S]*?<div class="title">([\s\S]*?)<\/div><div class="desc">([\s\S]*?)<\/div>[\s\S]*?<\/a>/gi;
  let m;
  while((m=re.exec(section))){
    staticItems.push({
      id:m[1],
      title:clean(m[4]||m[2]),
      description:clean(m[5]),
      path:m[3].replace(/([?&])v=[^&"]+&?/,'$1').replace(/[?&]$/,''),
      category:cat,
      source:'static'
    });
  }
}
const map=new Map(staticItems.map(x=>[String(x.id),x]));
for(const t of dynamic){
  if(!t?.id||!t?.path)continue;
  map.set(String(t.id),{
    id:String(t.id),
    title:String(t.title||t.name||'HTML 工具').trim(),
    description:String(t.description||'自定义 HTML 工具').trim(),
    path:String(t.path).trim(),
    category:['us','de','other'].includes(String(t.category))?String(t.category):'other',
    icon:String(t.icon||''),
    source:'dynamic'
  });
}
const items=[],placed=new Set();
for(const cat of ['us','de','other']){
  for(const idRaw of order[cat]||[]){
    const id=String(idRaw),item=map.get(id);
    if(!item||placed.has(id))continue;
    items.push({...item,category:cat});placed.add(id);
  }
}
for(const item of map.values()){
  if(placed.has(String(item.id)))continue;
  items.push(item);
}
items.forEach((item,i)=>{
  item.order=i+1;
  item.preview='previews/'+encodeURIComponent(String(item.id))+'.png';
});
let old={};
try{old=JSON.parse(await fs.readFile('toolbox/tool-catalog.json','utf8'))}catch{}
const same=JSON.stringify(old.items||[])===JSON.stringify(items);
const catalog={
  version:same?Number(old.version||1):Number(old.version||1)+1,
  updatedAt:same?(old.updatedAt||new Date().toISOString()):new Date().toISOString(),
  items
};
await fs.writeFile('toolbox/tool-catalog.json',JSON.stringify(catalog,null,2)+'\n');
console.log('catalog items:',items.length,'changed:',!same);
