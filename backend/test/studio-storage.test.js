const test=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../../studio-storage');
function memory(){const data=new Map();return {get length(){return data.size;},key:i=>[...data.keys()][i],getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};}
test('personal orders and palettes are isolated without changing shared device settings',()=>{
  const disk=memory(),session=memory(),s=create(disk,session);
  s.setItem('shine:orders:v0.6','legacy');s.setOwner('alice');assert.equal(s.getItem('shine:orders:v0.6'),null);
  s.setItem('shine:orders:v0.6','alice');s.setItem('shine:cloud-profile-endpoint:v1','endpoint');s.setOwner('bob');
  assert.equal(s.getItem('shine:orders:v0.6'),null);assert.equal(s.getItem('shine:cloud-profile-endpoint:v1'),'endpoint');
  s.setOwner('alice');assert.equal(s.getItem('shine:orders:v0.6'),'alice');s.setOwner('local');assert.equal(s.getItem('shine:orders:v0.6'),'legacy');
});
test('legacy import requires an explicit owner and confirmation, backs up and never deletes the source',()=>{
  const disk=memory(),s=create(disk,memory());s.setItem('shine:orders:v0.6','legacy');
  assert.throws(()=>s.claimLegacy({confirmed:true}),/CONFIRMATION/);s.setOwner('alice');assert.throws(()=>s.claimLegacy(),/CONFIRMATION/);
  const result=s.claimLegacy({confirmed:true,now:()=>new Date('2026-09-07T00:00:00Z')});
  assert.equal(result.count,1);assert.equal(s.getItem('shine:orders:v0.6'),'legacy');assert.equal(disk.getItem('shine:orders:v0.6'),'legacy');assert.ok(disk.getItem(result.backupKey));
  s.setOwner('bob');assert.throws(()=>s.claimLegacy({confirmed:true}),/ALREADY_CLAIMED/);
});
test('quota errors are reported and an import cannot overwrite existing account data',()=>{
  const disk=memory(),s=create(disk,memory());s.setItem('shine:orders:v0.6','legacy');s.setOwner('alice');s.setItem('shine:orders:v0.6','new');
  assert.throws(()=>s.claimLegacy({confirmed:true}),/PERSONAL_DATA_EXISTS/);assert.equal(s.getItem('shine:orders:v0.6'),'new');
  let reported=false;const broken=create({getItem:()=>null,setItem(){throw new Error('quota');}},memory(),{onError:()=>reported=true});
  assert.throws(()=>broken.setItem('x','y'),/quota/);assert.equal(reported,true);
});
