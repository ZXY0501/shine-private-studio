'use strict';
// Run against the locally served workspace. Uses a fresh, disposable browser context.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.SHINE_PLAYWRIGHT_MODULE||'playwright');
async function main(){
  const url=process.argv[2]||'http://127.0.0.1:8782/';
  if(!['127.0.0.1','localhost'].includes(new URL(url).hostname))throw new Error('Browser QA only accepts a loopback server.');
  const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser=await chromium.launch({headless:true,...(fs.existsSync(edge)?{executablePath:edge}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  try{
    await page.goto(url,{waitUntil:'networkidle'});await page.locator('[data-tab="studio"]').click();
    assert.match(await page.locator('#studioOwner').innerText(),/v1/);
    const initial=await page.evaluate(async()=>{
      const leaf=(name,hex)=>{const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;const ctx=canvas.getContext('2d');ctx.fillStyle=hex;ctx.fillRect(0,0,8,8);return {name,canvas,left:0,top:0,right:8,bottom:8,opacity:.6,blendMode:name==='重色'?'multiply':'normal'};};
      const bytes=agPsd.writePsd({width:32,height:24,children:[leaf('背景底色','#FFFFFF')]},{generateThumbnail:false});await loadMaster(new File([bytes],'模板_QA.psd'));
      for(const slot of ['A','B']){const data=agPsd.writePsd({width:32,height:24,children:[{name:slot+'头发',children:[leaf('线稿','#224466'),leaf('底色','#ABCDEF'),leaf('重色','#884466'),leaf('高光','#FFBBCC'),leaf('肤色','#EDBCAB')]}]},{generateThumbnail:false});await loadHairAsset(new File([data],'头发_'+slot+'_QA.psd'),slot,{sessionOnly:true});}
      return S.assets.filter(a=>a.enabled).map(a=>({slot:a.slot,colors:assetOverrideMap(a,getActiveOrder()),category:a.categoryId}));
    });
    assert.equal(initial.length,2);initial.forEach(a=>{assert.deepEqual(a.colors,{});assert.equal(a.category,'TEMP_HAIR');});
    const colors=await page.evaluate(()=>{document.querySelector('#orderForm').value='A：\n发色：金色\nB：\n发色：银白';localParseForm();return S.assets.filter(a=>a.enabled).map(a=>({slot:a.slot,colors:assetOverrideMap(a,getActiveOrder()),mode:assetRelevantLeaves(a).find(n=>n.name==='重色').layer.blendMode}));});
    assert.equal(colors[0].colors['A头发/线稿'],'#DBB8AB');assert.equal(colors[1].colors['B头发/底色'],'#FCF9FB');colors.forEach(a=>{assert.equal(a.mode,'multiply');assert.equal(a.colors[a.slot+'头发/肤色'],undefined);});
    await page.locator('[data-edit="hair-gold"]').click();await page.locator('[data-hex="lineart"]').fill('#BBAAAA');await page.locator('#studioSaveRecipe').click();
    await page.waitForFunction(()=>document.querySelector('#studioOwner')?.textContent.includes('v2')&&!document.querySelector('#studioSaveRecipe'));
    assert.match(await page.locator('#studioOwner').innerText(),/v2/);
    const frozen=await page.evaluate(()=>{applyOrderColors({live:true});const a=S.assets.find(a=>a.enabled&&a.slot==='A');return assetOverrideMap(a,getActiveOrder())['A头发/线稿'];});assert.equal(frozen,'#DBB8AB','editing handbook must not recompute a frozen order');
    await page.evaluate(()=>{const a=S.assets.find(a=>a.enabled&&a.slot==='A'),n=assetRelevantLeaves(a).find(n=>n.name==='线稿');setManualLayerOverride(assetLayerKey(a,n.path),'#AA8899');});
    await page.locator('[data-section="review"]').click();assert.match(await page.locator('#studioContent').innerText(),/手动项：线稿/);
    await page.locator('[data-review-reason="0"]').selectOption('AESTHETIC');await page.locator('[data-review-confirm="0"]').check();await page.locator('[data-review-save="0"]').click();
    const feedback=await page.evaluate(()=>JSON.parse(appStorage.getItem('shine:handbook:workspace:v1')).feedback);assert.equal(feedback.length,1);assert.equal(feedback[0].data.changes.length,1);assert.equal(feedback[0].data.changes[0].role,'lineart');assert.equal(feedback[0].data.learningEligible,true);
    await page.locator('#studioGolden').click();
    assert.equal(await page.evaluate(()=>JSON.parse(appStorage.getItem('shine:handbook:workspace:v1')).feedback.length),2);
    await page.locator('[data-section="backup"]').click();assert.match(await page.locator('#studioContent').innerText(),/备份待办 1 份/);
    await page.locator('[data-restore="0"]').click();await page.waitForFunction(()=>document.querySelector('#studioOwner')?.textContent.includes('v3'));assert.match(await page.locator('#studioOwner').innerText(),/v3/);
    await page.evaluate(()=>switchStudioOwner('qa-alice'));assert.match(await page.locator('#studioOwner').innerText(),/v1/);
    const privateState=await page.evaluate(()=>({feedback:JSON.parse(appStorage.getItem('shine:handbook:workspace:v1')||'{"feedback":[]}').feedback.length,enabled:S.assets.filter(a=>a.enabled).length}));assert.equal(privateState.feedback,0);assert.equal(privateState.enabled,0);
    await page.evaluate(()=>switchStudioOwner('local'));assert.match(await page.locator('#studioOwner').innerText(),/v3/);assert.deepEqual(errors,[]);
    const keyCheck=await page.evaluate(()=>{const a=S.assets.find(a=>a.enabled&&a.slot==='A'),p=assetRelevantLeaves(a).find(n=>n.name==='底色').path,duplicate={...a,assetId:'qa-same-name-other-order',enabled:false};S.assets.unshift(duplicate);const key=assetLayerKey(a,p),other=assetLayerKey(duplicate,p);return {distinct:key!==other,chosen:assetFromLayerKey(parseAssetLayerKey(key))===a};});assert.deepEqual(keyCheck,{distinct:true,chosen:true});
    let sent;
    await page.route('**/qa-parse',route=>{sent=route.request().postDataJSON();return route.fulfill({json:{A:{hairRecipeId:'hair-silver-white'},B:{},parseMeta:{tier:'flash0731'}}});});
    await page.evaluate(async()=>{S.apiConfig.endpoint=location.origin+'/qa-parse';document.querySelector('#apiEndpoint').value=S.apiConfig.endpoint;document.querySelector('#orderForm').value='A：\n发色：雾蒙蒙的钛\nB：';await apiParseForm();});
    assert.deepEqual(sent.unresolvedFields,['A.hairHex']);assert.ok(sent.colorRecipeCatalog.A.HAIR.some(r=>r.id==='hair-silver-white'));
    const apiColors=await page.evaluate(()=>assetOverrideMap(S.assets.find(a=>a.enabled&&a.slot==='A'),getActiveOrder()));assert.equal(apiColors['A头发/底色'],'#FCF9FB');assert.equal(apiColors['A头发/线稿'],'#AA8899','manual line wins over an API-selected palette');
    let release,started;const startedPromise=new Promise(resolve=>{started=resolve;});
    await page.route('**/qa-delayed',async route=>{started();await new Promise(resolve=>{release=resolve;});await route.fulfill({json:{A:{hairRecipeId:'hair-gold'},B:{},parseMeta:{tier:'flash0731'}}});});
    const parsing=page.evaluate(async()=>{S.apiConfig.endpoint=location.origin+'/qa-delayed';document.querySelector('#apiEndpoint').value=S.apiConfig.endpoint;await apiParseForm();});
    await startedPromise;await page.evaluate(()=>{const a=S.assets.find(a=>a.enabled&&a.slot==='A'),n=assetRelevantLeaves(a).find(n=>n.name==='线稿');setManualLayerOverride(assetLayerKey(a,n.path),'#997788');});release();await parsing;
    assert.match(await page.locator('#apiStatus').innerText(),/未覆盖/);assert.deepEqual(errors,[]);
    process.stdout.write('PASS: studio startup, PSD original, A/B recipes, fixed skin, blend modes, frozen orders, manual feedback, Golden, backups, rollback, owner isolation.\n');
  }finally{await context.close();await browser.close();}
}
main().catch(e=>{process.stderr.write(e.stack+'\n');process.exitCode=1;});
