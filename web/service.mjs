// This adapter has the same responses as the local app, but NEVER sends the PDF over HTTP.
import * as pdfjs from './vendor/pdf.mjs';
import { zipSync, strToU8 } from 'fflate';
import { extractArtwork, pageInfo } from './engine.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs',import.meta.url).href;
let current=null, sequence=0, conversionWorker;
const jobs=new Map();

function convert(art,options) {
  if (!conversionWorker) {
    conversionWorker=new Worker(new URL('./convert-worker.js',import.meta.url),{type:'module'});
    conversionWorker.onmessage=({data})=> {
      const job=jobs.get(data.id);
      if (!job) return;
      jobs.delete(data.id);
      if (data.error) job.reject(new Error(data.error)); else job.resolve(data.result);
    };
    conversionWorker.onerror=()=> {
      for (const job of jobs.values()) job.reject(new Error('変換処理を続行できません。小さいPDFでお試しください。'));
      jobs.clear(); conversionWorker.terminate(); conversionWorker=null;
    };
  }
  return new Promise((resolve,reject)=> {
    const id=++sequence; jobs.set(id,{resolve,reject}); conversionWorker.postMessage({id,art,options});
  });
}

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const abort=signal=> { if(signal?.aborted) throw new DOMException('Cancelled','AbortError'); };

async function load(data,name) {
  if (data.byteLength>50*1024*1024) throw new Error('50MB以下のPDFを選択してください。');
  const task=pdfjs.getDocument({data,cMapUrl:new URL('./vendor/cmaps/',import.meta.url).href,cMapPacked:true,
    standardFontDataUrl:new URL('./vendor/standard_fonts/',import.meta.url).href,
    wasmUrl:new URL('./vendor/wasm/',import.meta.url).href,
    isEvalSupported:false,enableXfa:false,stopAtErrors:true});
  let doc;
  try {
    doc=await task.promise;
    if(doc.numPages<1||doc.numPages>200) throw new Error('1〜200ページのPDFを選択してください。');
    const replacement={task,doc,name,id:String(++sequence),cache:new Map()};
    const first=await artwork(replacement,1);
    const previous=current; current=replacement;
    if(previous) await previous.task.destroy();
    return {id:current.id,name,pages:doc.numPages,first:pageInfo(first.art,1)};
  } catch(error) {
    await task.destroy();
    if(error.name==='PasswordException') throw new Error('パスワード付きPDFには対応していません。保護を解除してから選択してください。');
    if(error.name==='InvalidPDFException') throw new Error('PDFを読み込めません。ファイルが破損していないか確認してください。');
    throw error;
  }
}

async function artwork(file,number) {
  if (!file.cache.has(number)) {
    const promise=(async()=> {
      const page=await file.doc.getPage(number);
      const [ops,text,optional]=await Promise.all([
        page.getOperatorList({annotationMode:pdfjs.AnnotationMode.DISABLE}),
        page.getTextContent(),file.doc.getOptionalContentConfig({intent:'display'})]);
      return {page,art:extractArtwork(ops,text,page.getViewport({scale:1}),pdfjs.OPS,optional)};
    })();
    file.cache.set(number,promise);
    promise.catch(()=>file.cache.delete(number));
    // Bound extracted geometry independently of the parser's own page cache.
    while(file.cache.size>3) file.cache.delete(file.cache.keys().next().value);
  }
  return file.cache.get(number);
}

async function pdfPreview(page,signal) {
  abort(signal);
  const base=page.getViewport({scale:1});
  const viewport=page.getViewport({scale:Math.min(2,1800/Math.max(base.width,base.height))});
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.ceil(viewport.width)); canvas.height=Math.max(1,Math.ceil(viewport.height));
  const task=page.render({canvasContext:canvas.getContext('2d'),viewport,annotationMode:pdfjs.AnnotationMode.DISABLE});
  const cancel=()=>task.cancel(); signal?.addEventListener('abort',cancel,{once:true});
  try {
    await task.promise; abort(signal);
    return await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('プレビューを作成できません。')),'image/png'));
  } finally { signal?.removeEventListener('abort',cancel); canvas.width=canvas.height=0; }
}

async function dispatch(path,request={}) {
  const {signal}=request; abort(signal);
  if(path==='/api/upload') {
    const file=request.body.get('file');
    return json(await load(new Uint8Array(await file.arrayBuffer()),file.name));
  }
  if(path==='/api/sample') {
    // The only application fetch is the bundled public demonstration PDF.
    const response=await fetch(new URL('./sample.pdf',import.meta.url));
    if(!response.ok) throw new Error('サンプル図面を取得できませんでした。');
    return json(await load(new Uint8Array(await response.arrayBuffer()),'サンプル図面.pdf'));
  }
  const url=new URL(path,'https://local.invalid');
  const match=url.pathname.match(/^\/api\/files\/([^/]+)\/(page|preview|report|export)$/);
  if(!match||!current||match[1]!==current.id) throw new Error('PDFをもう一度選択してください。');
  const file=current, endpoint=match[2], query=url.searchParams;
  const number=Number(query.get('page')||1);
  if(!Number.isInteger(number)||number<1||number>file.doc.numPages) throw new Error('指定したページは存在しません。');
  const options={scale:Number(query.get('scale')||100),text:query.get('text')!=='0',colors:query.get('colors')!=='0'};
  if(endpoint==='export'&&query.get('all')==='1') {
    const files={},reports=[];
    let successes=0,totalSize=0;
    const stem=file.name.replace(/\.pdf$/i,'').replace(/[\/\\\u0000-\u001f]/g,'_')||'drawing';
    for(let p=1;p<=file.doc.numPages;p++) {
      abort(signal);
      window.dispatchEvent(new CustomEvent('trace-progress',{detail:`${p} / ${file.doc.numPages} ページを変換中…`}));
      let item;
      try {
        item=await artwork(file,p);
        const result=await convert(item.art,options);
        const bytes=strToU8(result.dxf); totalSize+=bytes.length;
        if(totalSize>100*1024*1024) throw new RangeError('出力サイズが100MBを超えました。ページごとに保存してください。');
        files[`${stem}_p${p}.dxf`]=bytes;
        reports.push({...result.report,page:p}); successes++;
      } catch(error) {
        if(error instanceof RangeError) throw error;
        reports.push({page:p,error:error.message});
      } finally {
        item?.page.cleanup();
      }
    }
    if(!successes) throw new Error('全ページで変換できる線・文字が見つかりませんでした。');
    files['変換結果.json']=strToU8(JSON.stringify(reports,null,2));
    return new Response(zipSync(files,{level:1}),{headers:{'Content-Type':'application/zip','X-Trace-Skipped':String(file.doc.numPages-successes)}});
  }
  const item=await artwork(file,number); abort(signal);
  if(endpoint==='page') return json(pageInfo(item.art,number));
  if(endpoint==='preview'&&query.get('mode')!=='dxf') return new Response(await pdfPreview(item.page,signal));
  const result=await convert(item.art,options); abort(signal);
  if(endpoint==='report') return json({...result.report,page:number});
  if(endpoint==='preview') return new Response(result.svg,{headers:{'Content-Type':'image/svg+xml'}});
  return new Response(result.dxf,{headers:{'Content-Type':'application/dxf'}});
}

export async function localRequest(path,request) {
  try { return await dispatch(path,request); }
  catch(error) {
    if(request?.signal?.aborted) throw new DOMException('Cancelled','AbortError');
    return json({error:error.message||'処理に失敗しました。PDFをもう一度選択してください。'},400);
  }
}
