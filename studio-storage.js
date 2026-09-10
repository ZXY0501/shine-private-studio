(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ShineStudioStorage=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const OWNER_KEY='shine:active-person:v1';
  const PREFIX='shine:person:v1:';
  const CLAIM_KEY='shine:legacy-person-claim:v1';
  const EXACT=new Set(['shine:orders:v0.6','shine:presets:v0.6','shine:logic:v0.6','shine:eyeSchemes:v0.6','shine:styleSchemes:v0.14','shine:styleSchemes:v0.13']);
  const PERSONAL_PREFIXES=['shine:template-flex-schema:','shine:handbook:','shine:feedback:','shine:handbook-backup:','shine:root-stack:','shine:hair-insertion:'];
  function isPersonalKey(key){return EXACT.has(key)||PERSONAL_PREFIXES.some(prefix=>key.startsWith(prefix));}
  function validOwner(value){const id=String(value||'local');if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw new Error('INVALID_OWNER');return id;}
  function create(storage,session,{onError=()=>{}}={}){
    let owner='local';
    try{owner=validOwner(session?.getItem(OWNER_KEY)||'local');}catch{}
    const keyFor=(key,person=owner)=>isPersonalKey(String(key))&&person!=='local'?PREFIX+person+':'+key:String(key);
    function write(key,value){try{storage.setItem(key,String(value));}catch(error){onError(error);throw error;}}
    function legacyEntries(){const entries={};for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key&&isPersonalKey(key)&&!/^shine:(?:handbook|feedback|handbook-backup):/.test(key))entries[key]=storage.getItem(key);}return entries;}
    function legacyClaim(){try{return JSON.parse(storage.getItem(CLAIM_KEY)||'null');}catch{return null;}}
    return {
      get owner(){return owner;},keyFor,
      getItem:key=>storage.getItem(keyFor(key)),
      setItem:(key,value)=>write(keyFor(key),value),
      removeItem:key=>storage.removeItem(keyFor(key)),
      setOwner(value){const next=validOwner(value);if(session)session.setItem(OWNER_KEY,next);owner=next;return owner;},
      legacyEntries,legacyClaim,
      claimLegacy({confirmed=false,replaceExisting=false,now=()=>new Date()}={}){
        if(!confirmed||owner==='local')throw new Error('LEGACY_CLAIM_REQUIRES_CONFIRMATION');
        const claimed=legacyClaim();if(claimed&&claimed.owner!==owner)throw new Error('LEGACY_ALREADY_CLAIMED');
        const entries=legacyEntries();
        const conflicts=Object.keys(entries).filter(key=>storage.getItem(keyFor(key))!==null);
        // Never silently replace an account's existing orders or saved palettes.
        if(conflicts.length&&!replaceExisting)throw new Error('PERSONAL_DATA_EXISTS');
        const timestamp=now().toISOString(),backupKey='shine:legacy-person-backup:v1:'+timestamp;
        const previous=Object.fromEntries(Object.keys(entries).map(key=>[keyFor(key),storage.getItem(keyFor(key))]));
        write(backupKey,JSON.stringify({schemaVersion:1,createdAt:timestamp,entries,previousPersonal:previous}));
        const written=[];
        try{
          for(const [key,value]of Object.entries(entries)){write(keyFor(key),value);written.push(keyFor(key));}
          write(CLAIM_KEY,JSON.stringify({owner,claimedAt:timestamp,backupKey}));
        }catch(error){for(const key of written){if(previous[key]===null)storage.removeItem(key);else storage.setItem(key,previous[key]);}throw error;}
        return {count:written.length,backupKey,backup:{schemaVersion:1,createdAt:timestamp,entries,previousPersonal:previous}};
      },
      exportPersonal(){const entries={};for(let i=0;i<storage.length;i++){const key=storage.key(i);if(owner==='local'?key&&isPersonalKey(key):key&&key.startsWith(PREFIX+owner+':'))entries[key]=storage.getItem(key);}return {schemaVersion:1,owner,createdAt:new Date().toISOString(),entries};}
    };
  }
  return {create,isPersonalKey,OWNER_KEY,PREFIX};
});
