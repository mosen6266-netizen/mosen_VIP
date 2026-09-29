import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root=process.cwd();
const catalog=JSON.parse(await fs.readFile(path.join(root,'toolbox','tool-catalog.json'),'utf8'));
const items=(catalog.items||[]).filter(x=>x&&x.id&&x.path);

await fs.mkdir(path.join(root,'toolbox','previews'),{recursive:true});

const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});

let done=0;
for(const item of items){
  const target=new URL(String(item.path).replace(/^\.?\//,''),'http://127.0.0.1:8000/toolbox/').href;
  const rel=String(item.preview||('previews/'+encodeURIComponent(String(item.id))+'.png')).replace(/^\.?\//,'');
  const dest=path.join(root,'toolbox',rel);
  await fs.mkdir(path.dirname(dest),{recursive:true});
  try{
    await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForTimeout(1200);
    await page.screenshot({path:dest,type:'png',fullPage:false});
    done++;
    console.log('preview',done+'/'+items.length,item.title);
  }catch(err){
    console.warn('preview failed',item.title,err.message);
  }
}
await browser.close();
console.log('generated',done,'of',items.length);
