import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
export function createStorageProbe({python,historyPath,databaseUrl,timeout=5000}){
  const exits=new Set();
  let child=null,pending=null,buffer='',stopped=false;
  const unavailable=()=>new Error('Storage probe unavailable.');
  function fail(worker){
    if(child!==worker)return;
    child=null;buffer='';worker.kill('SIGKILL');
    if(pending){clearTimeout(pending.timer);pending.reject(unavailable());pending=null;}
  }
  function start(){
    const worker=spawn(python(),['-B',path.join(ROOT,'readiness_bridge.py')],{cwd:ROOT,env:{...process.env,FLOW_HISTORY_PATH:historyPath,FLOW_DATABASE_URL:databaseUrl || '',PYTHONIOENCODING:'utf-8'},stdio:['pipe','pipe','pipe']});
    const exited=new Promise(resolve=>worker.once('close',resolve));
    exits.add(exited);void exited.then(()=>exits.delete(exited));
    child=worker;buffer='';worker.stdout.setEncoding('utf8');worker.stderr.resume();
    worker.on('error',()=>fail(worker));worker.on('close',()=>fail(worker));worker.stdin.on('error',()=>fail(worker));
    worker.stdout.on('data',chunk=>{
      if(child!==worker)return;buffer+=chunk;
      if(buffer.length>8192){fail(worker);return;}
      const index=buffer.indexOf('\n');if(index<0)return;
      const line=buffer.slice(0,index);buffer=buffer.slice(index+1);
      if(!pending || buffer){fail(worker);return;}
      let result;try{result=JSON.parse(line);}catch{fail(worker);return;}
      const current=pending;pending=null;clearTimeout(current.timer);
      result?.ok===true?current.resolve():current.reject(unavailable());
    });
  }
  function check(){
    if(stopped)return Promise.reject(unavailable());
    if(pending)return pending.promise;
    if(!child)start();
    const worker=child;let resolve,reject;
    const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
    pending={promise,resolve,reject,timer:setTimeout(()=>fail(worker),timeout)};
    worker.stdin.write('{"operation":"probe"}\n');return promise;
  }
  function stop(){stopped=true;if(child)fail(child);return Promise.allSettled([...exits]);}
  return {check,stop};
}
