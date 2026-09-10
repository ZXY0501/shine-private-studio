/* Personal studio: private Inbox, versioned color data, and reviewed feedback.
   Palette overrides are frozen on the order, never read live from an edited recipe. */
(function(){
  'use strict';
  const H=globalThis.SHINE_HANDBOOK,L=globalThis.ShineColorLink,B=globalThis.ShineStudioBackup;
  if(!H||!L||!B||typeof S==='undefined')return;
  const KEY='shine:handbook:workspace:v1',BACKUPS='shine:handbook-backup:pending:v1';
  const q=s=>document.querySelector(s),copy=x=>JSON.parse(JSON.stringify(x)),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let state,section='book',editing=null,items=[],epoch=0,backupResult=null,busy=false;
  const assetTreeCache=new WeakMap();
  function load(){
    const raw=appStorage.getItem(KEY);
    if(raw){const parsed=JSON.parse(raw),valid=H.validateHandbook(parsed.book);if(!valid.valid||valid.value.owner!==appStorage.owner)throw new Error('配色手册数据校验失败，已停止写入；请先导出本机备份。');state={versions:[],feedback:[],backups:JSON.parse(appStorage.getItem(BACKUPS)||'[]'),...parsed,book:valid.value};}
    else state={book:H.seedHandbook(appStorage.owner),versions:[],feedback:[],backups:[],cloudEtag:null,cloudEndpoint:null,dirty:true};
  }
  function save(){appStorage.setItem(KEY,JSON.stringify(state));}
  function note(text,bad=false){const el=q('#studioStatus');if(el){el.textContent=text;el.className='studioStatus'+(bad?' error':'');}}
  const stamp=()=>new Date().toISOString();
  function download(name,content,type='application/json'){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function config(){const c=cloudProfileConfig(),url=new URL(c.endpoint);if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('后端地址需要 HTTPS（本机测试除外）。');if(!c.token||appStorage.owner==='local')throw new Error('请先在账户区登录独立账户，临时口令不能代替个人账户。');return {endpoint:url.href.replace(/\/$/,''),token:c.token};}
  async function request(path,{method='GET',body,headers={}}={}){
    const c=config(),owner=appStorage.owner,ticket=epoch,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),35000);
    try{const res=await fetch(c.endpoint+path,{method,headers:{Authorization:'Bearer '+c.token,...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:controller.signal});
      const data=await res.json();if(owner!==appStorage.owner||ticket!==epoch)throw new Error('账号已经切换，本次响应未写入当前账户。');
      if(!res.ok){const e=new Error(res.status===412?'云端已被另一台设备更新，请先导出本地版本，再读取云端。':`云端暂未完成（${res.status} / ${data.error||'请求失败'}），本机数据保留。`);e.status=res.status;throw e;}
      return {data,etag:res.headers.get('ETag'),endpoint:c.endpoint};
    }finally{clearTimeout(timer);}
  }
  async function run(fn){if(busy)return;busy=true;try{await fn();}catch(e){note(e.name==='AbortError'?'请求超时，本机数据保留，可以重试。':e.message,true);}finally{busy=false;}}
  const eyeChannels=typeof EYE_ROLE_FIELD==='object'?EYE_ROLE_FIELD:{};
  function treeVisible(node,byPath,overrides={}){const parts=node.path.split('/');for(let i=1;i<=parts.length;i++){const path=parts.slice(0,i).join('/'),n=byPath.get(path);if(Object.prototype.hasOwnProperty.call(overrides,path)?!overrides[path]:n?.layer?.hidden)return false;}return true;}
  function categoryFor(role,path){if(/^EYE_/.test(role))return 'EYE';if(/^HAIR_|^BROW_/.test(role))return 'HAIR';if(/^OUTFIT_/.test(role))return 'CLOTHING';if(/头发/.test(path))return 'HAIR';return 'CLOTHING';}
  function nodesFor(raw){
    const counts={};raw.forEach(n=>{if(n.channel)counts[n.channel]=(counts[n.channel]||0)+1;});
    return raw.map(n=>({...n,key:n.channel&&counts[n.channel]===1?n.channel:'layer-'+L.stableId([n.path]).slice(10)}));
  }
  function component(identity,name,category,slot,nodes,extra={}){return {id:L.stableId(identity),identity,name,category,slot,nodes:nodesFor(nodes),...extra};}
  function templateComponents(order=getActiveOrder()){
    if(!S.master||!order)return [];const groups=new Map(),byPath=new Map((S.flat||[]).map(n=>[n.path,n]));
    for(const n of S.flat||[]){
      if(n.isGroup||!n.layer?.canvas||!treeVisible(n,byPath,S.visOverride))continue;
      const b=S.bindings[n.path]||{},slot=['A','B'].includes(b.slot)?b.slot:guessSlot(n.path,n.name);
      if(!['A','B'].includes(slot))continue;
      const flex=(order.flexibleComponents?.[slot]||[]).filter(x=>x.sourceType==='TEMPLATE'&&(n.path===x.sourceKey||n.path.startsWith(x.sourceKey+'/'))).sort((a,b)=>b.sourceKey.length-a.sourceKey.length)[0];
      const category=categoryFor(b.role,n.path),channel=eyeChannels[b.role]||L.channel(b.role,n.name)||(flex&&!isFixedBodyComponentName(n.path)?flexibleLayerChannel(n.name):null);
      if(!channel||L.protectedLayer(b.role,n.name)||isFixedBodyComponentName(n.path)||b.locked&&!flex)continue;
      const folder=flex?.sourceKey||quickBigGroupPath(n.path).replace(/ \/ /g,'/'),key=JSON.stringify([slot,folder,category]);
      const g=groups.get(key)||{slot,folder,category,flex,nodes:[]};
      g.nodes.push({path:n.path,manualKey:n.path,channel,protected:false,node:n});groups.set(key,g);
    }
    return [...groups.values()].map(g=>component(['template',S.templateSignature,g.slot,g.folder,g.category],`${g.slot} · ${g.flex?.name||g.folder}`,g.category,g.slot,g.nodes,{folder:g.folder,flex:g.flex,source:'template'}));
  }
  function assetComponent(asset){
    if(!asset.enabled||!['HAIR','CLOTHING','EYE'].includes(asset.type))return null;
    initAssetBindings(asset,false);
    let tree=assetTreeCache.get(asset);if(!tree||tree.psd!==asset.psd||tree.groupPath!==asset.groupPath){tree={psd:asset.psd,groupPath:asset.groupPath,leaves:assetRelevantLeaves(asset),byPath:new Map(flatten(asset.psd?.children||[]).map(n=>[n.path,n]))};assetTreeCache.set(asset,tree);}
    const nodes=tree.leaves.filter(n=>!n.isGroup&&treeVisible(n,tree.byPath,asset.layerVisibility)).map(n=>{
      const role=asset.bindings[n.path],channel=eyeChannels[role]||L.channel(role,n.name);
      return {path:n.path,manualKey:assetLayerKey(asset,n.path),channel,protected:!channel||L.protectedLayer(role,n.name),node:n};
    }).filter(n=>!n.protected);
    return component(['asset',S.templateSignature,asset.assetId||assetSourceName(asset),String(asset.version||1),asset.slot,asset.groupPath||'',asset.type],`${asset.slot} · ${asset.packageName||asset.variant||assetSourceName(asset)}${asset.componentName?' / '+asset.componentName:''}`,asset.type,asset.slot,nodes,{source:'asset',asset,folder:asset.groupPath||''});
  }
  function catalog(order=getActiveOrder()){return [...templateComponents(order),...(S.assets||[]).map(assetComponent).filter(c=>c&&c.nodes.length)];}
  function driver(c,o){
    if(c.category==='EYE')return {base:o?.[c.slot]?.eye||'',scheme:o?.[c.slot]?.eyeSchemeId||'',accent:o?.[c.slot]?.pupilAccent||''};
    if(c.source==='asset'){const s=o.assetComponentColors?.[`${assetFamilyKey(c.asset)}::${c.slot}`]||{};return {base:s.base||'',shadow:s.shadow||'',enabled:c.category==='HAIR'?s.useGeneratedColor===true:c.asset.colorModeExplicit===true&&c.asset.colorMode==='FOLLOW_ORDER'};}
    if(c.category==='HAIR')return {base:o?.[c.slot]?.hair||'',shadow:o.componentColors?.[c.slot]?.HAIR?.overrides?.shadow||''};
    if(c.flex)return {base:c.flex.base||'',shadow:c.flex.shadow||''};
    return {base:o?.[c.slot]?.outfit||'',manual:o?.[c.slot]?.outfitManual||''};
  }
  function selection(c,o){const s=o?.handbookSelections?.[c.id];return L.applicable(s,c.identity,driver(c,o))?s:null;}
  function resolvedPalette(c,o){const s=selection(c,o);if(!s)return {};const palette=L.palette(s,c.identity,driver(c,o),c.nodes);if(c.category==='EYE'&&normalizeHex(o?.[c.slot]?.pupilAccent||'')&&o[c.slot].pupilAccent!==(c.slot==='A'?'#E6F9FF':'#FFD6A6'))c.nodes.filter(n=>n.channel==='pupil').forEach(n=>delete palette[n.path]);return palette;}
  function applyRecipe(c,recipe,o=getActiveOrder()){
    if(!o||!c||recipe.category!==c.category)throw new Error('请先选择对应大类的当前画面组件。');
    if(recipe.scope.templateSignatures.length&&!recipe.scope.templateSignatures.includes(S.templateSignature))throw new Error('这套配色不适用于当前模板。');
    if(recipe.scope.schemeIds.length&&!recipe.scope.schemeIds.includes(o[c.slot]?.eyeSchemeId))throw new Error('眼睛图层方案不匹配，请先切换对应方案。');
    if(!c.nodes.some(n=>!n.protected&&(recipe.layers[n.key]||recipe.layers[n.channel])))throw new Error('这套配方的图层角色与当前夹子不匹配，未改色。请从当前组件另存配方或检查角色名称。');
    startReview('manual',false);
    if(c.category==='EYE')o[c.slot].eye=recipe.anchorHex;
    else if(c.category==='HAIR'){o[c.slot].hair=recipe.anchorHex;enableSelectedHairGeneratedColor(c.slot,recipe.anchorHex,o);}
    if(c.source==='asset'){
      o.assetComponentColors=o.assetComponentColors||{};o.assetComponentColors[`${assetFamilyKey(c.asset)}::${c.slot}`]={base:recipe.anchorHex,shadow:'',useGeneratedColor:true};c.asset.colorMode='FOLLOW_ORDER';c.asset.colorModeExplicit=true;
      (o.flexibleComponents?.[c.slot]||[]).filter(x=>x.sourceType==='ASSET'&&x.sourceKey===assetFamilyKey(c.asset)).forEach(x=>{x.base=recipe.anchorHex;x.shadow='';});
    }else if(c.flex){c.flex.base=recipe.anchorHex;c.flex.shadow='';}
    else if(c.category==='CLOTHING'){o[c.slot].outfit='__CUSTOM__';o[c.slot].outfitManual=recipe.anchorHex;}
    o.handbookSelections=o.handbookSelections||{};o.handbookSelections[c.id]=L.freeze(recipe,state.book,c.identity,driver(c,o));
    traceAction(c,null,'recipe');
  }
  function snapshot(source='manual'){
    const o=getActiveOrder();if(!o)return {components:[]};
    return H.snapshotComponents(catalog(o).map(c=>{
      const map=c.source==='asset'?assetOverrideMap(c.asset,o):S.ruleColorOverrides,layers={};
      for(const n of c.nodes){const actual=normalizeHex(S.manualLayerOverrides[n.manualKey]||map[n.path]||'');if(actual)layers[n.key]=actual;}
      const selected=selection(c,o),baseColors=[...new Set(c.nodes.filter(n=>['base','irisBase'].includes(n.channel)).map(n=>layers[n.key]).filter(Boolean))];
      const inputText=field(characterSection(o.formText||'',c.slot),c.category==='HAIR'?['发色']:c.category==='EYE'?['瞳色']:[c.flex?.name||c.asset?.componentName||'衣服颜色','衣服颜色','衣服']);
      return {id:c.id,category:c.category,name:c.name.slice(0,120),recipeId:selected?.recipeId||'',anchorHex:baseColors.length===1?baseColors[0]:null,layers,context:{orderId:o.id,templateSignature:S.templateSignature||'',schemeId:c.category==='EYE'?o[c.slot]?.eyeSchemeId||'':'',characterName:o[c.slot]?.name||'',slot:c.slot,assetId:c.asset?.assetId||'',assetVersion:String(c.asset?.version||1),folderPath:c.folder.slice(0,160),source,inputText:inputText.slice(0,160)}};
    }));
  }
  function startReview(source='manual',replace=true){const o=getActiveOrder();if(!o)return;if(!replace&&o.handbookBaseline?.templateSignature===S.templateSignature)return;o.handbookBaseline={templateSignature:S.templateSignature,at:stamp(),source,snapshot:snapshot(source),actions:[]};persistOrders();}
  function traceAction(c,role,origin){const review=getActiveOrder()?.handbookBaseline;if(!review)return;review.actions=review.actions||[];const id=c.id+':'+(role||'all')+':'+origin;if(!review.actions.some(x=>x.id===id))review.actions.push({id,componentId:c.id,...(role?{role}:{}),type:'manual'});}
  function beforeManual(path){startReview('manual',false);if(!path)return;for(const c of catalog()){const n=c.nodes.find(x=>x.manualKey===path);if(n)traceAction(c,n.key,'layer');}}
  function beforeControl(el){
    if(el.closest('#tab-studio'))return;startReview('manual',false);
    const row=el.closest('.flexComponentRow'),slot=row?.closest('[data-slot]')?.dataset.slot;
    if(row){const entry=getActiveOrder()?.flexibleComponents?.[slot]?.find(x=>x.id===row.dataset.flexId),role=el.dataset.flexColor||el.dataset.flexHex||'base';for(const c of catalog().filter(c=>c.slot===slot&&(c.flex===entry||c.asset&&assetFamilyKey(c.asset)===entry?.sourceKey)))for(const n of c.nodes.filter(n=>n.channel===role))traceAction(c,n.key,'form');return;}
    const m=/^([ab])(Hair|Eye|PupilAccent)/.exec(el.id||'');if(m){const role=m[2]==='Eye'?'irisBase':m[2]==='PupilAccent'?'pupil':'base',cat=m[2]==='Hair'?'HAIR':'EYE';for(const c of catalog().filter(c=>c.slot===m[1].toUpperCase()&&c.category===cat))for(const n of c.nodes.filter(n=>n.channel===role))traceAction(c,n.key,'form');}
    else if(/^quick(?:Color|Hex)$/.test(el.id||''))beforeManual(q('#quickLayer')?.value);
  }
  function readForm(o,text,unresolved){
    if(!state)return;
    // Read only active, compatible components. Never select assets by an IP name.
    for(const c of catalog(o)){
      const sec=characterSection(text,c.slot),names=c.category==='HAIR'?['发色']:c.category==='EYE'?['瞳色']:[c.flex?.name||c.asset?.componentName||'衣服颜色','衣服颜色','衣服'];
      const raw=field(sec,names);if(!raw&&!o[c.slot]?.name)continue;
      const result=H.matchRecipe(state.book,{category:c.category,text:raw||'',templateSignature:S.templateSignature||'',schemeId:o[c.slot]?.eyeSchemeId||'',characterName:o[c.slot]?.name||''});
      if(raw&&o.handbookSelections)delete o.handbookSelections[c.id];
      if(result.status==='match'){applyRecipe(c,result.recipe,o);const path=c.slot+(c.category==='HAIR'?'.hairHex':c.category==='EYE'?'.eyeHex':'.outfitPreset');for(let i=unresolved.length-1;i>=0;i--)if(unresolved[i]===path)unresolved.splice(i,1);}
      else if(result.status==='ambiguous'){const path=c.slot+(c.category==='HAIR'?'.hairHex':c.category==='EYE'?'.eyeHex':'.outfitPreset');if(!unresolved.includes(path))unresolved.push(path);}
    }
  }
  function apiCatalog(){
    const o=getActiveOrder(),cs=catalog(o),result={A:{HAIR:[],EYE:[]},B:{HAIR:[],EYE:[]}};
    if(!state)return result;
    for(const slot of ['A','B'])for(const category of ['HAIR','EYE']){
      if(!cs.some(c=>c.slot===slot&&c.category===category))continue;
      result[slot][category]=state.book.recipes.filter(r=>r.status==='STABLE'&&r.category===category&&(!r.scope.templateSignatures.length||r.scope.templateSignatures.includes(S.templateSignature))&&(!r.scope.schemeIds.length||r.scope.schemeIds.includes(o[slot]?.eyeSchemeId))&&(!r.scope.characterNames.length||r.scope.characterNames.includes(o[slot]?.name))&&/^[A-Za-z0-9._:-]{1,160}$/.test(r.id)).slice(0,20).map(r=>({id:r.id,name:r.name.slice(0,80),anchorHex:r.anchorHex,aliases:r.aliases.filter(x=>x.weight>0).map(x=>x.text).filter(x=>x.length<=40).slice(0,12)}));
    }return result;
  }
  function applyApiRecipes(data,fields,sent){
    const o=getActiveOrder();let applied=false;
    for(const c of catalog(o)){
      if(!['HAIR','EYE'].includes(c.category))continue;const kind=c.category==='HAIR'?'hair':'eye';
      if(!fields.includes(c.slot+'.'+kind+'Hex'))continue;
      const id=data[c.slot]?.[kind+'RecipeId'];if(!id||!sent?.[c.slot]?.[c.category]?.some(r=>r.id===id))continue;
      const raw=field(characterSection(o.formText,c.slot),c.category==='HAIR'?['发色']:['瞳色']);if(/#[0-9a-f]{3,6}/i.test(raw))continue;
      const r=state.book.recipes.find(r=>r.id===id&&r.status==='STABLE');if(!r)continue;
      applyRecipe(c,r,o);applied=true;
    }
    if(applied){persistOrders();selectOrder(o.id);}
  }
  globalThis.ShineStudio={assetColors(asset,o,map){const c=assetComponent(asset);if(c)Object.assign(map,resolvedPalette(c,o));},templateColors(o,map){for(const c of templateComponents(o))Object.assign(map,resolvedPalette(c,o));},readForm,startReview,beforeManual,catalog,snapshot,apiCatalog,applyApiRecipes,version:()=>state?.book?.version};
  // Capturing the first interaction, not every slider tick, gives one reviewed diff.
  document.addEventListener('pointerdown',e=>{if(e.target instanceof HTMLInputElement&&e.target.type==='color')beforeControl(e.target);},true);
  document.addEventListener('focusin',e=>{if(e.target instanceof HTMLInputElement&&(/Hex$/.test(e.target.id)||e.target.dataset.flexHex)||e.target instanceof HTMLSelectElement&&e.target.hasAttribute('data-flex-preset'))beforeControl(e.target);},true);

  function mount(){
    const style=document.createElement('link');style.rel='stylesheet';style.href='./studio-next.css?v=studio-v1';document.head.append(style);
    const button=document.createElement('button');button.className='taskTab';button.dataset.tab='studio';button.textContent='收件与配色';q('#taskTabs').append(button);
    const panel=document.createElement('section');panel.id='tab-studio';panel.className='taskPanel';q('#taskDock').append(panel);
    panel.innerHTML='<div class="studioHeading"><h2>我的工作室</h2><span id="studioOwner"></span></div><div class="studioNav">'+[['inbox','收件箱'],['book','配色手册'],['review','定稿复盘'],['backup','版本与备份']].map(([id,name])=>`<button data-section="${id}">${name}</button>`).join('')+'</div><p id="studioStatus" class="studioStatus" role="status"></p><div id="studioContent"></div>';
    button.onclick=()=>{document.querySelectorAll('.taskTab').forEach(b=>b.classList.toggle('active',b===button));document.querySelectorAll('.taskPanel').forEach(p=>p.classList.toggle('active',p===panel));q('#workHeadTitle').textContent='我的工作室';q('#workHeadSub').textContent='私人收件 · 颜色知识 · 经你确认才学习';render();};
    panel.addEventListener('click',e=>{const b=e.target.closest('button[data-section]');if(b){section=b.dataset.section;editing=null;render();}});
  }
  function render(){
    q('#studioOwner').textContent=(appStorage.owner==='local'?'本机未登录':S.authAccount?.displayName||S.authAccount?.username||'个人账户')+' · 手册 v'+state.book.version;
    document.querySelectorAll('#tab-studio [data-section]').forEach(b=>b.classList.toggle('selected',b.dataset.section===section));
    ({book:renderBook,inbox:renderInbox,review:renderReview,backup:renderBackup}[section])();
  }
  function bind(id,fn){q(id).onclick=()=>run(fn);}
  function roleLabel(role){return {base:'底色',shadow:'重色',lineart:'线稿',highlight:'高光',irisBase:'虹膜主色',irisDark:'虹膜重色',irisMid:'虹膜藏色',irisHighlight:'虹膜高光（下方反光）',irisHighlightMid:'虹膜高光藏色',pupil:'瞳孔点缀',outline:'眼睛线稿'}[role]||role;}
  function colorField(role,label,value){return `<label class="studioColor"><span>${esc(roleLabel(label))}</span><input type="color" data-color="${esc(role)}" value="${esc(value||'#FFFFFF')}"><input data-hex="${esc(role)}" value="${esc(value||'#FFFFFF')}" maxlength="7" aria-label="${esc(label)} HEX"></label>`;}
  function wireColors(){q('#studioContent').querySelectorAll('[data-color]').forEach(c=>{const t=[...q('#studioContent').querySelectorAll('[data-hex]')].find(x=>x.dataset.hex===c.dataset.color);c.oninput=()=>t.value=c.value.toUpperCase();t.onchange=()=>{const hex=normalizeHex(t.value);if(hex){c.value=hex;t.value=hex;}else note('请使用 #RRGGBB 格式的颜色。',true);};});}
  function renderBook(){
    const host=q('#studioContent');
    if(editing){renderEditor(editing);return;}
    host.innerHTML='<p class="studioHelp">每套配色都是你确认过的实际颜色。实验中的规则仅供手选；“已稳定”才会参与本地读表。手工改色始终优先，肤色等保护层不参与。</p><div class="studioToolbar"><button id="studioNew">＋ 新配色</button><button id="studioPull">读取云端</button><button id="studioPush">同步本机到云端</button></div><div class="studioRecipes">'+state.book.recipes.map(r=>`<article class="studioCard"><div><b>${esc(r.name)}</b><span class="studioBadge">${esc({HAIR:'头发',CLOTHING:'衣服',EYE:'眼睛'}[r.category]||r.category)} · ${esc({EXPERIMENTAL:'实验中',CONFIRMED:'已确认',STABLE:'已稳定'}[r.status])}</span></div><div class="studioSwatches">${Object.entries(r.layers).map(([role,hex])=>`<span title="${esc(role+' '+hex)}" style="background:${hex}"></span>`).join('')}</div><p>${r.aliases.map(a=>esc(a.text)).join(' / ')||'暂无关键词'}</p><button data-edit="${esc(r.id)}">编辑这套颜色</button><button data-use="${esc(r.id)}">用到当前画面…</button></article>`).join('')+'</div><div id="studioApply"></div>';
    bind('#studioNew',()=>{editing={id:'recipe-'+crypto.randomUUID(),name:'新配色',category:'HAIR',anchorHex:'#FAEFE7',aliases:[],excludeAliases:[],status:'EXPERIMENTAL',scope:{templateSignatures:[],schemeIds:[],characterNames:[]},layers:{base:'#FAEFE7',shadow:'#E9CEC4',lineart:'#DBB8AB',highlight:'#FFFDFB'}};render();});
    host.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{editing=copy(state.book.recipes.find(r=>r.id===b.dataset.edit));render();});
    host.querySelectorAll('[data-use]').forEach(b=>b.onclick=()=>renderApply(state.book.recipes.find(r=>r.id===b.dataset.use)));
    bind('#studioPull',pullBook);bind('#studioPush',pushBook);
    const capture=document.createElement('button');capture.id='studioCapture';capture.textContent='从当前画面保存配方…';host.querySelector('.studioToolbar').append(capture);capture.onclick=renderCapture;
  }
  function renderCapture(){
    const cs=catalog(),host=q('#studioApply');host.innerHTML=`<div class="studioCard"><h3>保存你已经调好的颜色</h3><select id="studioCaptureTarget">${cs.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><button id="studioCaptureCreate">建立配方草稿</button><p class="studioHelp">仅保存有明确 HEX 的图层。尚未改色的多色原图不会被压成一个猜测色；PSD 原模式、透明度只作规范记录，不强制覆盖。</p></div>`;
    bind('#studioCaptureCreate',()=>{const c=cs.find(c=>c.id===q('#studioCaptureTarget').value),snap=snapshot().components.find(x=>x.id===c?.id);if(!snap||!snap.anchorHex)throw new Error('当前组件还没有唯一、实际生效的底色。先给底色选色，再保存配方。');editing={id:'recipe-'+crypto.randomUUID(),name:c.name.slice(0,110)+'配色',category:c.category,anchorHex:snap.anchorHex,aliases:[],excludeAliases:[],status:'EXPERIMENTAL',scope:{templateSignatures:S.templateSignature?[S.templateSignature]:[],schemeIds:c.category==='EYE'?[getActiveOrder()[c.slot].eyeSchemeId]:[],characterNames:[]},layers:copy(snap.layers),layerSpecs:c.nodes.map(n=>({role:n.key,name:n.node.name,aliases:[],blendMode:n.node.layer.blendMode||'normal',opacity:Number.isFinite(n.node.layer.opacity)?n.node.layer.opacity:1,protected:false}))};render();});
  }
  function renderApply(recipe){
    const cs=catalog().filter(c=>c.category===recipe.category),host=q('#studioApply');host.innerHTML=`<div class="studioCard"><b>把“${esc(recipe.name)}”用到哪里？</b><p class="studioHelp">只列当前启用的组件。已有单层手调颜色不会被冲掉。</p><select id="studioTarget">${cs.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><button id="studioDoApply" ${cs.length?'':'disabled'}>应用配色</button></div>`;
    bind('#studioDoApply',()=>{const c=catalog().find(c=>c.id===q('#studioTarget').value);applyRecipe(c,recipe);persistOrders();selectOrder(S.activeOrderId);note('已应用，并在此订单冻结配色 v'+state.book.version+'。你仍可在表单或单层微调里覆盖。');});
  }
  function renderEditor(r){
    const roles=Object.keys(r.layers),host=q('#studioContent');
    host.innerHTML=`<div class="studioCard"><div class="studioFields"><label>配色名称<input id="studioName" value="${esc(r.name)}" maxlength="120"></label><label>大类<select id="studioCategory">${state.book.categories.map(c=>`<option value="${esc(c.id)}" ${c.id===r.category?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><label>状态<select id="studioStage">${[['EXPERIMENTAL','实验中'],['CONFIRMED','已确认'],['STABLE','已稳定']].map(([id,name])=>`<option value="${id}" ${r.status===id?'selected':''}>${name}</option>`).join('')}</select></label></div>${colorField('anchorHex','主锚点',r.anchorHex)}<label>命中词与权重（每行一个，如 金色:80）<textarea id="studioAliases">${esc(r.aliases.map(a=>a.text+':'+a.weight).join('\n'))}</textarea></label><label>不命中词（逗号分开）<input id="studioExcludes" value="${esc(r.excludeAliases.join('，'))}"></label><details><summary>模板 / 眼睛方案 / IP 适用范围</summary><p class="studioHelp">留空表示不限制。只绑定颜色，绝不自动选头发素材。</p><label>模板标识（逗号分开）<input id="studioTemplates" value="${esc(r.scope.templateSignatures.join(','))}"></label><button id="studioThisTemplate" type="button">只用当前模板</button><label>眼睛方案 ID<input id="studioSchemes" value="${esc(r.scope.schemeIds.join(','))}"></label><label>角色名称<input id="studioCharacters" value="${esc(r.scope.characterNames.join('，'))}"></label></details>${specEditor(r,roles)}<h3>每层实际使用的颜色</h3><div id="studioLayerColors">${roles.map(role=>colorField(role,role,r.layers[role])).join('')}</div><p class="studioHelp">头发/衣服：base 底色、shadow 重色、lineart 线稿、highlight 高光。眼睛使用现有 irisBase / irisDark / irisHighlight / pupil 等角色名，不更改 PSD 混合模式与透明度。</p><label>新增图层角色<input id="studioNewRole" placeholder="例如 irisMid"></label><button id="studioAddRole">添加颜色层</button><label>本次修改说明<input id="studioReason" placeholder="例如：金色线稿降一点饱和度" maxlength="600"></label><div class="studioToolbar"><button id="studioSaveRecipe">保存新版本</button><button id="studioCancelRecipe">取消</button></div></div>`;
    wireColors();
    bind('#studioThisTemplate',()=>{if(!S.templateSignature)throw new Error('请先载入模板。');q('#studioTemplates').value=S.templateSignature;});
    function read(){const split=id=>q(id).value.split(/[,，\n]/).map(x=>x.trim()).filter(Boolean),layers={};host.querySelectorAll('[data-hex]').forEach(el=>{if(el.dataset.hex!=='anchorHex')layers[el.dataset.hex]=el.value;});return {...r,name:q('#studioName').value,category:q('#studioCategory').value,status:q('#studioStage').value,anchorHex:host.querySelector('[data-hex="anchorHex"]').value,aliases:q('#studioAliases').value.split('\n').map(x=>x.trim()).filter(Boolean).map(x=>{const m=x.match(/^(.*?)[：:]([\d.]+)$/);return {text:m?m[1]:x,weight:m?Number(m[2]):80};}),excludeAliases:split('#studioExcludes'),layerSpecs:readSpecs(),scope:{templateSignatures:split('#studioTemplates'),schemeIds:split('#studioSchemes'),characterNames:split('#studioCharacters')},layers};}
    bind('#studioAddRole',()=>{const role=q('#studioNewRole').value.trim();if(!/^[A-Za-z][\w-]{0,79}$/.test(role)||['constructor','prototype','__proto__','anchorHex'].includes(role))throw new Error('角色 ID 请用英文字母开头，不能使用保留字段。');editing=read();editing.layers[role]='#FFFFFF';render();});
    bind('#studioSaveRecipe',async()=>{const next=read();if(next.status==='STABLE'&&r.status!=='STABLE'&&!confirm('设为已稳定后，符合范围的本地读表会自动用这套颜色。确认已验证好吗？'))return;const recipes=state.book.recipes.filter(x=>x.id!==r.id).concat(next);await commitBook({...state.book,recipes},q('#studioReason').value||'手动编辑配色');editing=null;render();note('新版本已保存在本机。备份和云端同步状态请看“版本与备份”。');});
    bind('#studioCancelRecipe',()=>{editing=null;render();});
  }
  function specEditor(r,roles){
    const list=Array.isArray(r.layerSpecs)?r.layerSpecs:[];
    return '<details><summary>图层命名、混合模式和透明度规范</summary><p class="studioHelp">这些是你记录的素材规范，不会擅自改 PSD 的原始混合模式或透明度。</p>'+roles.map(role=>{const s=list.find(x=>x.role===role)||{};return `<div class="studioSpec" data-spec="${esc(role)}"><b>${esc(roleLabel(role))}</b><label>标准图层名<input data-spec-name value="${esc(s.name||roleLabel(role))}" maxlength="80"></label><label>允许别名（逗号分开）<input data-spec-aliases value="${esc((s.aliases||[]).join('，'))}"></label><label>混合模式<input data-spec-mode value="${esc(s.blendMode||'normal')}" maxlength="40"></label><label>透明度 %<input data-spec-opacity type="number" min="0" max="100" value="${Math.round((s.opacity??1)*100)}"></label></div>`;}).join('')+'</details>';
  }
  function readSpecs(){return [...q('#studioContent').querySelectorAll('[data-spec]')].map(el=>{const opacity=Number(el.querySelector('[data-spec-opacity]').value)/100;if(!Number.isFinite(opacity)||opacity<0||opacity>1)throw new Error('透明度必须在 0～100% 之间。');return {role:el.dataset.spec,name:el.querySelector('[data-spec-name]').value.trim(),aliases:el.querySelector('[data-spec-aliases]').value.split(/[,，]/).map(x=>x.trim()).filter(Boolean),blendMode:el.querySelector('[data-spec-mode]').value.trim()||'normal',opacity};});}

  // Remaining views share the same account-scoped state and error handling.
  async function commitBook(edited,reason){
    const next=H.commit(state.book,edited,{at:stamp(),by:appStorage.owner,reason});
    const previous=copy(state);state.versions.push(copy(state.book));state.book=next;state.dirty=true;state.backups=B.enqueue(state.backups,next);
    try{save();}catch(e){state=previous;throw e;}
    await flushBackups(false);
  }
  async function pushBook(){
    const c=config();if(state.cloudEndpoint&&state.cloudEndpoint!==c.endpoint)throw new Error('后端地址已变化，请先读取该服务器的手册，避免覆盖。');
    const r=await request('/api/handbook',{method:'PUT',body:{data:state.book},headers:state.cloudEtag?{'If-Match':state.cloudEtag}:{'If-None-Match':'*'}});
    if(!r.etag)throw new Error('云端没有提供版本标识，请检查跨域 ETag 配置；本地保持待同步。');
    state.cloudEtag=r.etag;state.cloudEndpoint=r.endpoint;state.dirty=false;save();note('手册已同步云端，版本冲突保护已开启。');
  }
  async function pullBook(){
    if(state.dirty&&!confirm('当前本机有未同步手册。读取云端会先保留本机历史，再切换为云端版本，继续吗？'))return;
    const r=await request('/api/handbook'),valid=H.validateHandbook(r.data.data);if(!valid.valid||valid.value.owner!==appStorage.owner)throw new Error('云端手册不属于当前账户，未导入。');
    const old=copy(state);state.versions.push(copy(state.book));state.book=valid.value;state.cloudEtag=r.etag;state.cloudEndpoint=r.endpoint;state.dirty=false;try{save();}catch(e){state=old;throw e;}render();note('已读取云端版本。旧订单冻结配色不变。');
  }

  function renderReview(){
    const o=getActiveOrder(),baseline=o?.handbookBaseline,valid=baseline?.templateSignature===S.templateSignature,final=snapshot(baseline?.source||'manual');
    const diffs=valid?H.diffSnapshots(baseline.snapshot,final):[],host=q('#studioContent');
    host.innerHTML='<p class="studioHelp">读表后自动记录起点；从原色开始手调也会记录。只比较这次真正启用的组件。未改色的 PSD 原图没有单一 HEX，不会用假颜色当原色。导出图片或滑动色盘不会重复投票。</p><div class="studioToolbar"><button id="studioBaseline">从现在重新开始记录</button><button id="studioReviewRefresh">刷新最终改动</button><button id="studioFeedbackSync">同步已确认记录</button></div>'+(!valid?'<p>当前模板还没有修改起点。先读表，或点“从现在重新开始记录”。</p>':'')+diffs.map((d,i)=>`<article class="studioCard"><b>${esc(d.name)}</b><p class="studioHelp">原词：${esc(d.context.inputText||"未记录")} · 手动项：${esc((baseline.actions||[]).filter(a=>a.componentId===d.componentId).map(a=>a.role?roleLabel(a.role):"整套配方").join(" / ")||"来源未细分，本次按组件净色差确认")}</p><p>${d.changes.map(c=>esc(c.role)+': '+esc(c.from||'原色/未设置')+' → '+esc(c.to||'原色/已撤销')).join('<br>')}</p><label>本次修改原因<select data-review-reason="${i}"><option value="">先选原因</option><option value="SEMANTIC">词义纠正</option><option value="AESTHETIC">审美优化</option><option value="CUSTOMER_OVERRIDE">仅本次客户要求（不学习）</option><option value="IP">IP 特殊配色（需角色名和模板）</option></select></label><label class="studioCheck"><input type="checkbox" data-review-confirm="${i}">我确认这条记录的归因</label><button data-review-save="${i}">确认这条改动</button></article>`).join('')+`<div class="studioCard"><h3>⭐ 加入优质样本</h3><p>没有改动也可以收藏。只收你自己认可的最终颜色。</p><select id="studioGoldenComponent">${final.components.filter(c=>Object.keys(c.layers).length).map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><button id="studioGolden">确认加入优质样本</button></div><h3>已确认记录 · ${state.feedback.filter(x=>!x.withdrawn).length}</h3>`+state.feedback.filter(x=>!x.withdrawn).slice(-30).reverse().map(x=>`<div class="studioLog">${esc(x.data.name)} · ${esc(x.data.reason)} · ${x.serverId?'已同步':'本机待同步'} <button data-withdraw="${esc(x.data.id)}">撤回</button></div>`).join('');
    bind('#studioBaseline',()=>{if(valid&&!confirm('这会把当前画面设为新起点，尚未确认的改动将不再显示，继续吗？'))return;startReview('manual');render();});
    bind('#studioReviewRefresh',render);bind('#studioFeedbackSync',syncFeedback);
    host.querySelectorAll('[data-review-save]').forEach(b=>b.onclick=()=>run(()=>{
      const i=Number(b.dataset.reviewSave),d=diffs[i],reason=host.querySelector(`[data-review-reason="${i}"]`).value,confirmed=host.querySelector(`[data-review-confirm="${i}"]`).checked;
      if(!reason||!confirmed)throw new Error('请先选择原因，并勾选确认。');
      if(reason==='CUSTOMER_OVERRIDE'){note('这条改动不进入学习记录，客户颜色仍保留在订单。');b.disabled=true;return;}
      const tracked=(baseline.actions||[]).filter(a=>a.componentId===d.componentId&&(!a.role||d.changes.some(x=>x.role===a.role)));
      const actions=tracked.length?tracked.map(a=>({...a,confirmed:true,reason})):[{componentId:d.componentId,type:'manual',confirmed:true,reason}];
      const proposals=H.createFeedbackProposal(baseline.snapshot,final,actions);const proposal=proposals.find(p=>p.componentId===d.componentId);storeFeedback(proposal);render();note('这是一条待复盘记录，衍生颜色保留在最终快照，不单独计票；不会立即修改内置配色。');
    }));
    bind('#studioGolden',()=>{const componentId=q('#studioGoldenComponent').value;if(!componentId)throw new Error('当前还没有已解析的颜色可保存。');if(!confirm('确认这套最终颜色是你自己认可、值得作为优质参考的吗？'))return;storeFeedback(H.createGoldenSample(final,{componentId,confirmed:true,reason:'AESTHETIC'}));render();note('已加入优质样本，不会自行修改默认配色。');});
    host.querySelectorAll('[data-withdraw]').forEach(b=>b.onclick=()=>run(async()=>{const item=state.feedback.find(x=>x.data.id===b.dataset.withdraw);if(item.serverId)await request('/api/handbook/feedback/'+encodeURIComponent(item.serverId),{method:'DELETE'});item.withdrawn=true;save();render();note('记录已撤回，不再进入复盘。');}));
  }
  function storeFeedback(data){if(!data?.learningEligible)throw new Error('这条记录缺少学习条件。IP 记录需要具体角色名及模板或眼睛方案；新增/删除素材不算颜色纠错。');if(state.feedback.some(x=>x.data.id===data.id))throw new Error('这条最终改动已经确认过（或已撤回），不会重复计入。');state.feedback.push({data,createdAt:stamp(),serverId:null});try{save();}catch(e){state.feedback.pop();throw e;}}
  async function syncFeedback(){for(const item of state.feedback.filter(x=>!x.withdrawn&&!x.serverId)){const r=await request('/api/handbook/feedback',{method:'POST',body:{data:item.data}});item.serverId=r.data.id;save();}render();note('已确认且允许学习的记录已同步。客户单次要求不会上传到学习库。');}

  function renderInbox(){
    const host=q('#studioContent');host.innerHTML='<p class="studioHelp">iPad 先打开手机收件页，分享/选择 PSD 后传入你的私人收件箱。这里接收为本单临时头发，不自动进公共素材库。其他 PSD/PNG 先下载后按用途上传；设备分享快捷指令说明见手机页。</p><div class="studioToolbar"><button id="studioInboxRefresh">刷新收件箱</button><a href="./inbox.html" target="_blank" rel="noopener">打开手机收件页</a><button id="studioDevice">生成仅上传设备口令</button><button id="studioDevices">管理设备口令</button></div><div id="studioDeviceResult"></div><p class="studioHelp">文件 48 小时后不可再读取；服务器在后续访问时清理过期文件，不承诺到点立即物理删除。重要 PSD 请自己保留原件。</p><label>收到当前订单的哪个位置？<select id="studioInboxSlot"><option>A</option><option>B</option></select></label>'+items.map(item=>`<article class="studioCard"><b>${esc(item.fileName)}</b><p>${(item.byteSize/1024/1024).toFixed(1)} MB · ${esc(item.status)} · 到期 ${esc(item.expiresAt)}</p>${['READY','RECEIVED'].includes(item.status)?`<button data-inbox-import="${esc(item.id)}" ${/\.psd$/i.test(item.fileName)?'':'disabled'}>作为临时头发接入当前单</button><button data-inbox-download="${esc(item.id)}">下载原件</button>`:''}<button data-inbox-delete="${esc(item.id)}">删除此文件</button></article>`).join('');
    bind('#studioInboxRefresh',refreshInbox);bind('#studioDevice',createDevice);bind('#studioDevices',listDevices);
    host.querySelectorAll('[data-inbox-import]').forEach(b=>b.onclick=()=>run(()=>receiveInbox(items.find(x=>x.id===b.dataset.inboxImport),q('#studioInboxSlot').value)));
    host.querySelectorAll('[data-inbox-download]').forEach(b=>b.onclick=()=>run(async()=>{const r=await request('/api/inbox/'+encodeURIComponent(b.dataset.inboxDownload)+'/source');const a=document.createElement('a');a.href=r.data.downloadUrl;a.rel='noopener';a.target='_blank';a.click();}));
    host.querySelectorAll('[data-inbox-delete]').forEach(b=>b.onclick=()=>run(async()=>{if(!confirm('删除这个云端临时文件？未接收的文件需要从 iPad 重传。'))return;await request('/api/inbox/'+encodeURIComponent(b.dataset.inboxDelete),{method:'DELETE'});await refreshInbox();}));
  }
  async function refreshInbox(){const r=await request('/api/inbox');items=r.data.items||[];render();note('私人收件箱已刷新。');}
  async function receiveInbox(item,slot){
    if(!S.master)throw new Error('先载入目标模板，再接收本单头发。');const owner=appStorage.owner,orderId=S.activeOrderId,template=S.templateSignature;
    if(!confirm(`将“${item.fileName}”作为 ${slot} 位临时头发接到当前单？会替换该位当前选择，不删除原素材。`))return;
    const source=await request('/api/inbox/'+encodeURIComponent(item.id)+'/source');note('正在下载并解析 PSD，请保持在当前订单。');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),120000);let response,blob;
    try{response=await fetch(source.data.downloadUrl,{signal:controller.signal,cache:'no-store'});if(!response.ok)throw new Error('原件下载失败，请重新刷新收件箱。');blob=await response.blob();}finally{clearTimeout(timer);}
    if(owner!==appStorage.owner||orderId!==S.activeOrderId||template!==S.templateSignature)throw new Error('下载期间已切换账号、订单或模板，未自动接入。');
    if(blob.size!==item.byteSize)throw new Error('文件长度与收件记录不一致，未载入。');
    const records=await loadHairAsset(new File([blob],item.fileName,{type:item.contentType}),slot,{sessionOnly:true});if(!records?.length)throw new Error('PSD 没有成功载入，文件仍留在收件箱。');
    await request('/api/inbox/'+encodeURIComponent(item.id)+'/received',{method:'POST',body:{}});await refreshInbox();note('临时头发已接入本单并保留原色，未存入公共素材库。');
  }
  async function createDevice(){const name=prompt('给这台 iPad 起个名字','我的 iPad');if(!name)return;const r=await request('/api/inbox/devices',{method:'POST',body:{name}}),token=r.data.token||r.data.deviceToken;if(!token)throw new Error('设备令牌未返回。');q('#studioDeviceResult').innerHTML='<div class="studioCard"><b>仅这一次显示：复制到 iPad 收件页或快捷指令</b><p>只能上传，不能读取订单、素材或管理账户。用完可撤销。</p><textarea id="studioDeviceSecret" readonly></textarea><button id="studioHideDevice">我保存好了，隐藏</button></div>';q('#studioDeviceSecret').value=token;bind('#studioHideDevice',()=>{q('#studioDeviceResult').replaceChildren();});}
  async function listDevices(){const r=await request('/api/inbox/devices'),devices=r.data.devices||[];q('#studioDeviceResult').innerHTML=devices.map(d=>`<div class="studioLog">${esc(d.name)} · ${esc(d.expiresAt)} <button data-revoke="${esc(d.id)}">撤销</button></div>`).join('')||'<p>暂无设备口令。</p>';q('#studioDeviceResult').querySelectorAll('[data-revoke]').forEach(b=>b.onclick=()=>run(async()=>{if(!confirm('撤销后，该 iPad 需要新的口令才能上传，继续吗？'))return;await request('/api/inbox/devices/'+encodeURIComponent(b.dataset.revoke),{method:'DELETE'});await listDevices();}));}

  // A directory is selected explicitly; no assumed Obsidian path or background localhost service.
  async function folderDb(mode,fn){return new Promise((resolve,reject)=>{const open=indexedDB.open('shine-studio-backup-handles',1);open.onupgradeneeded=()=>open.result.createObjectStore('handles');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result;let tx,value;try{tx=db.transaction('handles',mode);value=fn(tx.objectStore('handles'));}catch(e){db.close();reject(e);return;}tx.oncomplete=()=>{db.close();resolve(value?.result);};tx.onerror=tx.onabort=()=>{db.close();reject(tx.error||new Error('备份文件夹记录未能保存，请重试。'));};};});}
  const backupWriter=B.create({getContext:()=>({owner:appStorage.owner,epoch,state}),readFolder:owner=>folderDb('readonly',s=>s.get(owner)),writeFolder:(owner,chosen)=>folderDb('readwrite',s=>s.put(chosen,owner)),save,serializeMarkdown:H.serializeMarkdown});
  function showBackupResult(result){
    if(result.owner!==appStorage.owner||result.epoch!==epoch||result.status==='owner-changed')return;
    backupResult=result;note(B.describe(result),!['written','connected'].includes(result.status));
  }
  async function flushBackups(interactive){const result=await backupWriter.flush(interactive);showBackupResult(result);return result;}
  function renderBackup(){
    const pending=state.backups,host=q('#studioContent');host.innerHTML=`<p class="studioHelp">本机手册 v${state.book.version} · ${state.dirty?'待同步云端':'已同步云端'} · 文件夹备份待办 ${pending.length} 份。不会自动查找或写入你的 Obsidian 仓库；请选择其中一个专用文件夹。</p><div class="studioToolbar"><button id="studioFolder">选择 Obsidian 备份文件夹</button><button id="studioRetryBackup">重试文件夹备份</button><button id="studioExportBook">下载手册 JSON</button><button id="studioExportMd">下载手册 Markdown</button><button id="studioExportReview">导出每周复盘包</button><button id="studioExportPersonal">下载本机个人数据备份</button></div><label>导入配色手册 JSON（校验后另存新版本）<input type="file" id="studioImportBook" accept=".json,application/json"></label><h3>本机历史版本</h3><p class="studioHelp">恢复旧配方会创建一个新版本，不抹掉历史，也不改旧订单。</p>`+state.versions.map((v,i)=>`<div class="studioLog">v${v.version} · ${v.recipes.length} 套颜色 <button data-restore="${i}">另存为当前新版本</button><button data-version-export="${i}">导出</button></div>`).reverse().join('')+`<details class="studioCard"><summary>旧版本订单归属（仅迁移自己的数据）</summary><p>旧工作台没有分账户。这一步必须由你确认：先备份旧数据及本账户现有数据，再复制给当前账户；原文件仍保留，不会分享给朋友。</p><button id="studioClaim">备份并认领旧版本个人数据</button></details><p class="studioHelp">每周复盘只生成候选方案与测试报告；目前未创建定时任务，不会自动发布或改正式站。</p>`;
    if(backupResult){const summary=document.createElement('p');summary.className='studioHelp';summary.textContent=B.describe(backupResult);host.prepend(summary);}
    bind('#studioFolder',async()=>{if(!window.showDirectoryPicker)throw new Error('此浏览器不支持直接选文件夹，请使用 Chrome / Edge，或下载 Markdown 与 JSON 手动放进 Obsidian。');const owner=appStorage.owner,ticket=epoch,chosen=await window.showDirectoryPicker({mode:'readwrite',id:'shine-backup'});if(owner!==appStorage.owner||ticket!==epoch)return;const result=await backupWriter.connect(chosen);showBackupResult(result);if(owner===appStorage.owner&&ticket===epoch)render();});
    bind('#studioRetryBackup',async()=>{const owner=appStorage.owner,ticket=epoch;await flushBackups(true);if(owner===appStorage.owner&&ticket===epoch)render();});
    bind('#studioExportBook',()=>download(`SHINE-handbook-v${state.book.version}.json`,JSON.stringify(state.book,null,2)));
    bind('#studioExportMd',()=>download(`SHINE-handbook-v${state.book.version}.md`,H.serializeMarkdown(state.book),'text/markdown'));
    bind('#studioExportReview',()=>download('SHINE-weekly-review.json',JSON.stringify({handbook:state.book,feedback:state.feedback.filter(x=>!x.withdrawn).map(x=>x.data)},null,2)));
    bind('#studioExportPersonal',()=>download('SHINE-personal-backup.json',JSON.stringify(appStorage.exportPersonal(),null,2)));
    q('#studioImportBook').onchange=e=>run(async()=>{const file=e.target.files[0];if(!file)return;if(file.size>1024*1024)throw new Error('手册文件超过 1 MB。');const owner=appStorage.owner,input=JSON.parse(await file.text()),valid=H.validateHandbook(input);if(owner!==appStorage.owner)return;if(!valid.valid)throw new Error(valid.errors.join('；'));if(valid.value.owner!==owner)throw new Error('文件属于另一账户，请不要直接混入个人审美库。');if(!confirm('将导入文件中的配方另存为当前手册的新版本？'))return;await commitBook({...state.book,categories:valid.value.categories,recipes:valid.value.recipes},'导入经校验的配色手册');render();});
    host.querySelectorAll('[data-restore]').forEach(b=>b.onclick=()=>run(async()=>{const v=state.versions[Number(b.dataset.restore)];if(!confirm(`将 v${v.version} 的配方恢复为新的手册版本？`))return;await commitBook({...state.book,categories:v.categories,recipes:v.recipes},'恢复历史 v'+v.version);render();}));
    host.querySelectorAll('[data-version-export]').forEach(b=>b.onclick=()=>{const v=state.versions[Number(b.dataset.versionExport)];download(`SHINE-handbook-v${v.version}.json`,JSON.stringify(v,null,2));});
    bind('#studioClaim',()=>{if(!confirm('这些旧订单和配色确定属于你吗？本账户已有的同类数据会被备份后替换，请先下载个人数据备份。'))return;const result=appStorage.claimLegacy({confirmed:true,replaceExisting:true});download('SHINE-legacy-claim-backup.json',JSON.stringify(result.backup,null,2));loadProductionState();load();render();note('旧个人数据已备份并归入本账户；素材文件未删除。');});
  }
  try{load();mount();render();if(location.hash==='#studio')q('[data-tab="studio"]').click();}catch(e){console.error('Studio initialization failed:',e.message);const el=q('#accountStatus');if(el){el.textContent=e.message;el.className='status bad';}}
  window.addEventListener('shine:owner-changed',()=>{epoch++;items=[];backupResult=null;editing=null;busy=false;try{load();render();note('已切换到此账户的个人手册。不会自动认领旧数据。');}catch(e){note(e.message,true);}});
})();
