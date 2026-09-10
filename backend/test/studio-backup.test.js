const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const B=require('../../studio-backup');
const H=require('../../color-handbook');

const clone=value=>JSON.parse(JSON.stringify(value));
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function mockFolder(name){
  const folder={name,permission:'granted',requested:0,events:[],files:new Map(),hooks:{},open:0,peak:0};
  async function event(type,file,content){folder.events.push({type,file,content});if(folder.hooks[type])await folder.hooks[type](file,content);}
  folder.queryPermission=async()=>{await event('query');return folder.permission;};
  folder.requestPermission=async()=>{folder.requested++;await event('request');return folder.permission;};
  folder.getFileHandle=async file=>{
    await event('get',file);
    return {createWritable:async()=>{
      await event('create',file);folder.open++;folder.peak=Math.max(folder.peak,folder.open);let content,finished=false;
      return {
        write:async value=>{content=value;await event('write',file,value);},
        close:async()=>{await event('close',file,content);folder.files.set(file,content);if(!finished){finished=true;folder.open--; }},
        abort:async()=>{await event('abort',file);if(!finished){finished=true;folder.open--; }}
      };
    }};
  };
  return folder;
}
function harness({pending=true}={}){
  const initialBook=H.seedHandbook('A');
  const aState={book:initialBook,backups:pending?[clone(initialBook)]:[]};
  let context={owner:'A',epoch:0,state:aState};
  const directories=new Map(),saved=[],hooks={};
  const api=B.create({
    getContext:()=>context,
    readFolder:async owner=>hooks.readFolder?hooks.readFolder(owner):directories.get(owner),
    writeFolder:async(owner,folder)=>{if(hooks.writeFolder)await hooks.writeFolder(owner,folder);directories.set(owner,folder);},
    save:()=>{if(hooks.save)hooks.save(context);saved.push({owner:context.owner,state:clone(context.state)});},
    serializeMarkdown:H.serializeMarkdown,now:()=>1700000000000
  });
  return {api,aState,directories,saved,hooks,get context(){return context;},switchOwner(owner){const book=H.seedHandbook(owner);context={owner,epoch:context.epoch+1,state:{book,backups:[clone(book)]}};return context.state;}};
}
function jsonBooks(folder){return [...folder.files].filter(([name])=>name.endsWith('.json')).map(([,body])=>JSON.parse(body));}

test('first connection persists and writes current handbook as JSON plus Markdown with no previous queue',async()=>{
  const h=harness({pending:false}),folder=mockFolder('SHINE 配色备份');
  const result=await h.api.connect(folder);
  assert.equal(result.status,'written');assert.equal(result.connected,true);assert.equal(result.written,1);assert.equal(result.filesWritten,2);assert.equal(result.remaining,0);
  assert.equal(h.saved[0].state.backups.length,1,'current snapshot is saved before writing');
  assert.equal(h.directories.get('A'),folder);assert.deepEqual(jsonBooks(folder),[h.aState.book]);
  assert.equal([...folder.files].find(([name])=>name.endsWith('.md'))[1],H.serializeMarkdown(h.aState.book));
  assert.equal(h.aState.backups.length,0);assert.match(B.describe(result),/JSON \+ Markdown/);
});

test('connection deduplicates current snapshot and existing duplicate queue entries',async()=>{
  const h=harness(),folder=mockFolder('A');h.aState.backups.push(clone(h.aState.book));
  assert.equal(B.enqueue(h.aState.backups,h.aState.book).length,1);
  const result=await h.api.connect(folder);
  assert.equal(result.written,1);assert.equal(folder.files.size,2);assert.equal(result.remaining,0);
});

test('a partial Markdown failure retains the full queued snapshot and retry writes a complete pair',async()=>{
  const h=harness(),folder=mockFolder('A');let fail=true;
  folder.hooks.close=name=>{if(fail&&name.endsWith('.md'))throw new Error('disk full');};
  const first=await h.api.connect(folder);
  assert.equal(first.status,'partial');assert.equal(first.written,0);assert.equal(first.filesWritten,1);assert.equal(first.remaining,1);
  assert.equal(folder.files.size,1);assert.equal(h.aState.backups.length,1);assert.match(B.describe(first),/未全部完成/);
  assert.equal(folder.events.filter(event=>event.type==='abort').length,1);
  fail=false;
  const retry=await h.api.flush(true);
  assert.equal(retry.status,'written');assert.equal(retry.written,1);assert.equal(retry.filesWritten,2);assert.equal(retry.remaining,0);
  assert.equal(folder.files.size,3,'retry keeps the previous partial file recoverable and writes a fresh pair');
});

test('missing folder and denied authorization are explicit outcomes, never written success',async()=>{
  const h=harness(),folder=mockFolder('A');
  const missing=await h.api.flush(false);assert.equal(missing.status,'no-folder');assert.equal(missing.remaining,1);
  folder.permission='prompt';
  const denied=await h.api.connect(folder);
  assert.equal(denied.status,'no-authorization');assert.equal(denied.connected,true);assert.equal(denied.written,0);assert.equal(denied.remaining,1);
  assert.equal(folder.requested,1);assert.equal(folder.files.size,0);assert.match(B.describe(denied),/未获得写入授权/);
  await h.api.flush(false);assert.equal(folder.requested,1,'automatic flush must not open a permission prompt');
  folder.permission='granted';assert.equal((await h.api.flush(true)).status,'written');
  const empty=await h.api.flush(true);assert.equal(empty.status,'connected');assert.equal(empty.written,0);assert.match(B.describe(empty),/未新写文件/);
});

test('late account A lookup cannot populate the cache used by account B or remove either queue',async()=>{
  const h=harness(),a=mockFolder('A'),b=mockFolder('B'),entered=deferred(),lookup=deferred();
  h.hooks.readFolder=owner=>{if(owner==='A'){entered.resolve();return lookup.promise;}return b;};
  const oldJob=h.api.flush(false);await entered.promise;
  const bState=h.switchOwner('B');lookup.resolve(a);
  const oldResult=await oldJob;assert.equal(oldResult.status,'owner-changed');
  assert.equal(a.events.length,0);assert.equal(a.files.size,0);assert.equal(h.aState.backups.length,1);assert.equal(bState.backups.length,1);
  assert.equal((await h.api.flush(false)).status,'written');
  assert.equal(a.files.size,0);assert.deepEqual(jsonBooks(b).map(book=>book.owner),['B']);assert.equal(bState.backups.length,0);
});

test('switch during permission query stops before requesting permission or creating a file',async()=>{
  const h=harness(),folder=mockFolder('A'),entered=deferred(),permission=deferred();h.directories.set('A',folder);folder.permission='prompt';
  folder.hooks.query=()=>{entered.resolve();return permission.promise;};
  const oldJob=h.api.flush(true);await entered.promise;const bState=h.switchOwner('B');permission.resolve();
  assert.equal((await oldJob).status,'owner-changed');assert.equal(folder.requested,0);assert.equal(folder.files.size,0);
  assert.equal(h.aState.backups.length,1);assert.equal(bState.backups.length,1);
});

test('switch during explicit permission request stops before file creation',async()=>{
  const h=harness(),folder=mockFolder('A'),entered=deferred(),permission=deferred();h.directories.set('A',folder);folder.permission='prompt';
  folder.hooks.request=()=>{entered.resolve();return permission.promise;};
  const oldJob=h.api.flush(true);await entered.promise;h.switchOwner('B');folder.permission='granted';permission.resolve();
  assert.equal((await oldJob).status,'owner-changed');assert.equal(folder.events.filter(event=>event.type==='get').length,0);
});

test('switch during a write aborts the captured writer and never routes remaining files to a new folder',async()=>{
  const h=harness(),a=mockFolder('A'),b=mockFolder('B');h.directories.set('A',a);h.directories.set('B',b);
  a.hooks.write=()=>h.switchOwner('B');
  const result=await h.api.flush(false);
  assert.equal(result.status,'owner-changed');assert.equal(a.files.size,0);assert.equal(b.events.length,0);
  assert.equal(a.events.filter(event=>event.type==='abort').length,1);assert.equal(a.events.filter(event=>event.type==='get').length,1);
  assert.equal(h.aState.backups.length,1);assert.equal(h.context.state.backups.length,1);
  assert.equal((await h.api.flush(false)).status,'written');assert.deepEqual(jsonBooks(b).map(book=>book.owner),['B']);
});

test('switch during close can complete only the already-started old-account file, not the next file or queue removal',async()=>{
  const h=harness(),folder=mockFolder('A');h.directories.set('A',folder);folder.hooks.close=()=>h.switchOwner('B');
  const result=await h.api.flush(false);
  assert.equal(result.status,'owner-changed');assert.equal(folder.files.size,1);assert.equal(result.filesWritten,1);
  assert.equal(folder.events.filter(event=>event.type==='get').length,1);assert.equal(h.aState.backups.length,1);assert.equal(h.context.state.backups.length,1);
});

test('late folder-handle persistence cannot enqueue or write the next account state',async()=>{
  const h=harness({pending:false}),a=mockFolder('A'),entered=deferred(),stored=deferred();
  h.hooks.writeFolder=()=>{entered.resolve();return stored.promise;};
  const job=h.api.connect(a);await entered.promise;const bState=h.switchOwner('B');stored.resolve();
  assert.equal((await job).status,'owner-changed');assert.equal(a.events.length,0);
  assert.equal(h.aState.backups.length,1);assert.equal(bState.backups.length,1);assert.ok(h.saved.every(entry=>entry.owner==='A'));
});

test('concurrent flushes are serialized without duplicate files or dropped queue entries',async()=>{
  const h=harness(),folder=mockFolder('A'),entered=deferred(),writing=deferred();h.directories.set('A',folder);
  const second={...clone(h.aState.book),version:2};h.aState.backups.push(second);
  let once=true;folder.hooks.write=()=>{if(once){once=false;entered.resolve();return writing.promise;}};
  const one=h.api.flush(false);await entered.promise;const two=h.api.flush(true);writing.resolve();
  const results=await Promise.all([one,two]);
  assert.deepEqual(results.map(result=>result.status),['written','connected']);
  assert.equal(results.reduce((sum,result)=>sum+result.written,0),2);assert.equal(folder.files.size,4);assert.equal(folder.peak,1);
  assert.deepEqual(jsonBooks(folder).map(book=>book.version),[h.aState.book.version,2]);assert.equal(h.aState.backups.length,0);
});

test('a snapshot enqueued during I/O stays pending until a later flush',async()=>{
  const h=harness(),folder=mockFolder('A'),entered=deferred(),writing=deferred();h.directories.set('A',folder);
  let once=true;folder.hooks.write=()=>{if(once){once=false;entered.resolve();return writing.promise;}};
  const job=h.api.flush(false);await entered.promise;
  h.aState.backups=B.enqueue(h.aState.backups,{...clone(h.aState.book),version:2});writing.resolve();
  const first=await job;assert.equal(first.written,1);assert.equal(first.remaining,1);assert.equal(h.aState.backups[0].version,2);
  assert.equal((await h.api.flush(false)).remaining,0);assert.equal(folder.files.size,4);
});

test('local queue-save failure after complete file writes restores the snapshot for retry',async()=>{
  const h=harness(),folder=mockFolder('A');h.directories.set('A',folder);
  h.hooks.save=context=>{if(context.state.backups.length===0)throw new Error('storage full');};
  const result=await h.api.flush(false);
  assert.equal(result.status,'partial');assert.equal(result.written,1);assert.equal(result.filesWritten,2);assert.equal(result.remaining,1);
  assert.equal(h.aState.backups.length,1);assert.equal(folder.files.size,2);
  delete h.hooks.save;assert.equal((await h.api.flush(false)).remaining,0);
});

test('folder-store errors retain the first snapshot and foreign-owner queue items are never written',async()=>{
  const h=harness({pending:false}),folder=mockFolder('A');h.hooks.writeFolder=()=>{throw new Error('handle unavailable');};
  const failed=await h.api.connect(folder);assert.equal(failed.status,'error');assert.equal(failed.connected,false);assert.equal(failed.remaining,1);assert.equal(folder.files.size,0);
  delete h.hooks.writeFolder;h.aState.backups.push(H.seedHandbook('B'));
  const mixed=await h.api.connect(folder);assert.equal(mixed.status,'error');assert.equal(folder.files.size,0);assert.equal(h.aState.backups.length,2);
});

test('backup engine is loaded before studio UI, which renders structured outcomes instead of unconditional success',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');
  const studio=fs.readFileSync(path.join(__dirname,'../../studio-next.js'),'utf8');
  assert.ok(html.indexOf('./studio-backup.js')>=0);assert.ok(html.indexOf('./studio-backup.js')<html.indexOf('./studio-next.js'));
  assert.match(studio,/backupWriter\.connect\(chosen\)/);assert.match(studio,/showBackupResult\(result\)/);
  assert.doesNotMatch(studio,/已记住这个账户的备份文件夹；提交手册/);
  assert.match(studio,/ticket!==epoch\)return;const result=await backupWriter\.connect/);
});
