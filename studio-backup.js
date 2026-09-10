(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ShineStudioBackup=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const copy=value=>JSON.parse(JSON.stringify(value));
  const key=book=>JSON.stringify(book);
  function enqueue(queue,book){
    const seen=new Set();
    return [...queue,...(book?[copy(book)]:[])].filter(item=>{
      const id=key(item);if(seen.has(id))return false;seen.add(id);return true;
    });
  }
  function create({getContext,readFolder,writeFolder,save,serializeMarkdown,now=Date.now}){
    let cached=null,tail=Promise.resolve(),sequence=0;
    const current=context=>{const next=getContext();return next.owner===context.owner&&next.epoch===context.epoch&&next.state===context.state;};
    const requireCurrent=context=>{if(!current(context)){const error=new Error('账号已切换，旧账户的备份操作已停止。');error.code='OWNER_CHANGED';throw error;}};
    function setQueue(context,queue){
      requireCurrent(context);
      const previous=context.state.backups;
      context.state.backups=queue;
      try{save();}catch(error){context.state.backups=previous;throw error;}
    }
    async function perform(context,{interactive=false,chosen=null}={}){
      const result={owner:context.owner,epoch:context.epoch,status:'no-folder',connected:false,folderName:'',written:0,filesWritten:0,remaining:context.state.backups.length};
      const finish=status=>({...result,status,remaining:context.state.backups.length});
      try{
        requireCurrent(context);
        // Persist the current snapshot before any first-connection I/O, even for a new handbook.
        const queue=enqueue(context.state.backups,chosen?context.state.book:null);
        if(queue.some(book=>book.owner!==context.owner))throw new Error('备份待办包含其他账户的数据，已停止写入。');
        if(chosen||queue.length!==context.state.backups.length)setQueue(context,queue);
        let directory;
        if(chosen){
          await writeFolder(context.owner,chosen);requireCurrent(context);
          directory=chosen;
        }else if(cached&&cached.owner===context.owner&&cached.epoch===context.epoch){
          directory=cached.directory;
        }else{
          directory=await readFolder(context.owner);requireCurrent(context);
        }
        if(!directory)return finish('no-folder');
        // Never let a late lookup populate another account's cache, or use a mutable handle in a write.
        cached={owner:context.owner,epoch:context.epoch,directory};
        result.connected=true;result.folderName=directory.name||'';
        let permission=await directory.queryPermission({mode:'readwrite'});requireCurrent(context);
        if(permission!=='granted'&&interactive){permission=await directory.requestPermission({mode:'readwrite'});requireCurrent(context);}
        if(permission!=='granted')return finish('no-authorization');
        const pending=enqueue(context.state.backups);
        for(const book of pending){
          requireCurrent(context);
          if(book.owner!==context.owner)throw new Error('备份待办包含其他账户的数据，已停止写入。');
          const prefix=`SHINE-${context.owner}-v${book.version}-${now()}-${++sequence}`;
          for(const [ext,content]of [['json',JSON.stringify(book,null,2)],['md',serializeMarkdown(book)]]){
            requireCurrent(context);
            const file=await directory.getFileHandle(prefix+'.'+ext,{create:true});requireCurrent(context);
            let writer=await file.createWritable();
            try{
              requireCurrent(context);await writer.write(content);requireCurrent(context);
              await writer.close();writer=null;result.filesWritten++;requireCurrent(context);
            }catch(error){
              // An in-flight OS operation can finish, but no subsequent write is issued after a switch.
              if(writer&&typeof writer.abort==='function')try{await writer.abort();}catch{}
              throw error;
            }
          }
          result.written++;
          // Remove only completed snapshots; preserve anything enqueued while file I/O was awaiting.
          setQueue(context,context.state.backups.filter(item=>key(item)!==key(book)));
        }
        return finish(result.written?'written':'connected');
      }catch(error){
        result.error=error.message||String(error);
        return finish(error.code==='OWNER_CHANGED'?'owner-changed':result.filesWritten?'partial':'error');
      }
    }
    function schedule(options){
      const context=getContext();
      // Include connection changes in this lock: one logical writer at a time, even after an account switch.
      const job=tail.then(()=>perform(context,options));
      tail=job.catch(()=>{});
      return job;
    }
    return {flush:interactive=>schedule({interactive}),connect:chosen=>schedule({interactive:true,chosen})};
  }
  function describe(result){
    const folder=result.folderName?`「${result.folderName}」`:'所选文件夹';
    const remaining=`仍有 ${result.remaining} 份待办保留在本机。`;
    switch(result.status){
      case 'written':return `已连接${folder}；本次已写入 ${result.written} 份手册（每份 JSON + Markdown）。剩余 ${result.remaining} 份待办。`;
      case 'connected':return `已连接${folder}；目前没有待办，本次未新写文件。`;
      case 'no-folder':return `尚未选择备份文件夹；${remaining}`;
      case 'no-authorization':return `已记住${folder}，但未获得写入授权；${remaining}请点击“重试文件夹备份”并允许访问。`;
      case 'partial':return `文件夹备份未全部完成：本次已写入 ${result.filesWritten} 个文件；${remaining}${result.error||''}`;
      case 'owner-changed':return '账号已切换，旧账户的备份操作已停止；未清除待办。';
      default:return `文件夹备份未完成；${remaining}${result.error||''}`;
    }
  }
  return {create,enqueue,describe};
});
