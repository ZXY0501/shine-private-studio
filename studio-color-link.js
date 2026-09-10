(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ShineColorLink=api;})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const copy=x=>JSON.parse(JSON.stringify(x));
  const hex=x=>typeof x==='string'&&/^#[0-9a-f]{6}$/i.test(x)?x.toUpperCase():null;
  function protectedLayer(role,name){return /FIXED|SKIN|(?:^|_)FUR(?:_|$)|REFERENCE|WATERMARK|^EYE_PUPIL_HIGHLIGHT$/.test(role||'')||/肤色|皮肤|绒毛/.test(name||'');}
  function stableId(parts){
    const text=JSON.stringify(parts);let a=2166136261,b=5381;
    for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b,33)^text.charCodeAt(i);}
    return 'component-'+(a>>>0).toString(16)+'-'+(b>>>0).toString(16);
  }
  function channel(role,name){
    if(protectedLayer(role,name))return null;
    const roles={HAIR_BASE:'base',HAIR_SHADE_MASK:'shadow',HAIR_OUTLINE:'lineart',HAIR_HIGHLIGHT:'highlight',BROW_BASE:'lineart',OUTFIT_BASE:'base',OUTFIT_SHADOW:'shadow',OUTFIT_LINE:'lineart',OUTFIT_HIGHLIGHT:'highlight',COMPONENT_BASE:'base',COMPONENT_SHADOW:'shadow',COMPONENT_LINEART:'lineart',COMPONENT_HIGHLIGHT:'highlight'};
    return roles[role]||null;
  }
  function freeze(recipe,book,identity,driver){return {schemaVersion:1,recipeId:recipe.id,recipeName:recipe.name,bookVersion:book.version,identity:copy(identity),driver:copy(driver),anchorHex:recipe.anchorHex,layers:copy(recipe.layers)};}
  function applicable(selection,identity,driver){return !!selection&&selection.schemaVersion===1&&JSON.stringify(selection.identity)===JSON.stringify(identity)&&JSON.stringify(selection.driver)===JSON.stringify(driver);}
  function palette(selection,identity,driver,nodes,manual={}){
    if(!applicable(selection,identity,driver))return {};
    const map={};
    for(const node of nodes){if(node.protected)continue;const c=hex(selection.layers[node.key])||hex(selection.layers[node.channel]);if(c)map[node.path]=c;if(hex(manual[node.path]))map[node.path]=hex(manual[node.path]);}
    return map;
  }
  return {stableId,channel,protectedLayer,freeze,applicable,palette,hex};
});
