import { describePdf, readPdf } from './pdf-intake.mjs';
import { discover } from './discovery.mjs';
import {designFields,identifyDesign,normalizeDesigns} from './research-design.mjs';
import {cleanIdeaTags} from './inspiration.mjs';

export const maxPdf=64*1024*1024;
const stamp=()=>new Date().toISOString();
const clean=(v,size=2000)=>String(v??'').trim().slice(0,size);
const tags=v=>[...new Set(clean(v).split(/[,，\n]/).map(x=>x.trim()).filter(Boolean))];
const states=['title','authors','year','kind','lang','doi','url','basis','tags','note','zotero','venue','abstract','keywords','journalIndex','journalEvidence'];
const positive=v=>Number.isSafeInteger(v)&&v>0;
const openAsset=name=>new URL(name,import.meta.url);
const segmenter=new Intl.Segmenter('zh',{granularity:'word'});
const stop=new Set('the and about what how which when does have for from with why are can this that 有哪些 如何 什么 怎么 多少 可以 是否 这个 哪些 哪个'.split(' '));
let config;
let legacySeed;
const scans=new Map();

function httpUrl(value) {
  try {
    const u=new URL(value);
    return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password ? u.href : '';
  }catch{return '';}
}
const idb=()=>new Promise((ok,bad)=>{
  const request=indexedDB.open('labor-relations-library-pages-v1',1);
  request.onupgradeneeded=()=>{
    request.result.createObjectStore('state');
    request.result.createObjectStore('pdfs',{keyPath:'id'});
  };
  request.onsuccess=()=>ok(request.result);
  request.onerror=()=>bad(Error('浏览器无法打开存储。请检查是否允许网站数据。'));
});
const req=call=>new Promise((ok,bad)=>{call.onsuccess=()=>ok(call.result);call.onerror=()=>bad(call.error);});
const fresh=()=>({clock:0,docs:[],marks:[],links:[],watches:[],inbox:[]});
const next=s=>++s.clock;
const internalFields=new Set(['pages','hash','segments','pdf_review','design_auto','designs','design_rev']);
const publicRow=d=>Object.fromEntries(Object.entries(d).filter(([k])=>!internalFields.has(k)));

function getDoc(s,id){
  const d=s.docs.find(d=>d.id===id);
  if(!d)throw Error('找不到该条目。');
  return d;
}
function SetFields(input,old={}){
  const result=Object.fromEntries(states.map(k=>[k,clean(input[k]??old[k],k==='note'?40000:k==='abstract'?14000:2000)]));
  if(!result.title)throw Error('请填写标题。');
  result.tags=tags(result.tags).join(',');
  result.doi=result.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\/|^doi:\s*/i,'').toLowerCase();
  result.url=httpUrl(result.url);
  result.journalEvidence=httpUrl(result.journalEvidence);
  if(!['SCIE','SSCI','SCIE + SSCI','其他'].includes(result.journalIndex)||!result.journalEvidence){
    result.journalIndex='';
    result.journalEvidence='';
  }
  result.zotero=/^[A-Z\d]{8}$/i.test(result.zotero)?result.zotero:'';
  const main=clean(input.primary_tag??old.primary_tag??tags(result.tags)[0],150);
  return {...result,primary_tag:tags(result.tags).includes(main)?main:'',updated:stamp()};
}
function storeDoc(s,input,id){
  const existing=id?getDoc(s,id):null;
  const row=SetFields(input,existing||{});
  const same=s.docs.find(d=>d.id!==id&&((row.doi&&d.doi===row.doi) ||
    (row.zotero&&d.zotero===row.zotero) || (!id&&row.url&&d.title===row.title&&d.url===row.url)));
  if(same){
    if(id)throw Error('同一 DOI 或 Zotero 题录已对应其他文献。');
    return {id:same.id,duplicate:true};
  }
  if(existing){
    Object.assign(existing,row);
    if(input.confirmReview===true)existing.review_pending=0;
    return {id};
  }
  id=next(s);
  s.docs.push({ ...row,id,review_pending:Number(input.pending===true),pdf:false,pdf_pages:0,text_pages:0,
    pages:[],segments:input.excerpt?[{loc:row.basis||'摘要',body:clean(input.excerpt,14000)}]:[]});
  return {id};
}

const assets=Promise.all([idb(),...['config.json?v=summary-1','seed.json'].map(path=>fetch(openAsset(path)).then(r=>{
  if(!r.ok)throw Error('工作台资源加载失败。');
  return r.json();
}))]);
const ready=assets.then(async ([db,settings,seed])=>{
  config=settings;
  legacySeed={
    documents:seed.documents.map(d=>({...SetFields(d),segments:d.segments.map(([loc,body])=>({loc,body}))})),
    links:seed.links,
    practice:SetFields({title:'PDF 批注练习页',authors:'工作台示例',kind:'练习',lang:'English',basis:'合成练习材料'})
  };
  const stored=await req(db.transaction('state').objectStore('state').get('library'));
  if(stored?.sampleCleanup)return db;
  await write(db,(s,files)=>{
    if(s.sampleCleanup)return;
    const removed=removeLegacySamples(s);
    for(const id of removed)files.delete(id);
  });
  return db;
});

function removeLegacySamples(s){
  const {documents,links,practice}=legacySeed;
  const sampleNumbers=new Map();
  const removed=new Set();
  const sameFields=(doc,sample)=>[...states,'primary_tag'].every(key=>(doc[key]??'')===sample[key]);
  // Older versions did not label seeded entries. Match their original content and keep any user work.
  for(const doc of s.docs){
    const index=documents.findIndex(sample=>doc.title===sample.title&&doc.url===sample.url);
    if(index>=0)sampleNumbers.set(doc.id,index+1);
    if(doc.review_pending||doc.designs?.length||doc.design_auto||doc.pdf_review||doc.pages?.length)continue;
    const sample=documents[index];
    const sameExcerpt=sample&&doc.segments?.length===sample.segments.length&&
      sample.segments.every(({loc,body},i)=>doc.segments[i].loc===loc&&doc.segments[i].body===body);
    const practicePdf=doc.pdf&&doc.pdf_pages===2&&doc.text_pages===2&&
      (!doc.hash||doc.hash==='4afae75453183f4fad8ef98a2cd0fc891012b16451cc0bea9c740a1089cc692b');
    if((!doc.pdf&&sameExcerpt&&sameFields(doc,sample))||
      (practicePdf&&!doc.segments?.length&&sameFields(doc,practice)))removed.add(doc.id);
  }
  for(const mark of s.marks)removed.delete(mark.doc);
  for(const link of s.links){
    const builtIn=links.some(([a,b,type,note])=>
      a===sampleNumbers.get(link.a)&&b===sampleNumbers.get(link.b)&&type===link.type&&note===link.note);
    if(builtIn)continue;
    removed.delete(link.a);
    removed.delete(link.b);
  }
  s.docs=s.docs.filter(d=>!removed.has(d.id));
  s.links=s.links.filter(l=>!removed.has(l.a)&&!removed.has(l.b));
  s.sampleCleanup=true;
  return removed;
}

function write(db,operation){
  return new Promise((ok,bad)=>{
    const tx=db.transaction(['state','pdfs'],'readwrite');
    const store=tx.objectStore('state');
    let result,error;
    tx.oncomplete=()=>ok(result);
    tx.onabort=()=>bad(error||tx.error||Error('数据保存失败。'));
    const load=store.get('library');
    load.onsuccess=()=>{
      const s=load.result||fresh();
      try{
        result=operation(s,tx.objectStore('pdfs'));
        store.put(s,'library');
      }catch(e){error=e;tx.abort();}
    };
  });
}
const mutate=async operation=>write(await ready,operation);
async function current(){
  const db=await ready;
  return req(db.transaction('state').objectStore('state').get('library'));
}

function marksOf(s,id){return s.marks.filter(m=>m.doc===id).sort((a,b)=>a.page-b.page||a.id-b.id);}
function designCandidate(d){
  return 'design_auto' in d ? d.design_auto : identifyDesign(d.pages||[]);
}
function documentDesigns(d,auto){
  return d.designs ?? (auto?[auto]:[]);
}
function designIndex(s){
  const papers=s.docs.filter(d=>d.kind!=='练习').map(d=>({
    id:d.id,title:d.title,year:d.year,review_pending:d.review_pending,pdf:d.pdf
  }));
  const rows=s.docs.filter(d=>d.kind!=='练习').flatMap(d=>{
    const designs=d.designs??documentDesigns(d,designCandidate(d));
    return designs.map((design,index)=>({...design,
      doc:d.id,title:d.title,year:d.year,index,pdf:d.pdf,review_pending:d.review_pending}));
  });
  return {papers,rows};
}
function details(s,id){
  const d=getDoc(s,id);
  const auto=designCandidate(d);
  return {
    ...publicRow(d),segments:d.segments||[],pdf_review:d.pdf_review||null,suggestions:d.pdf_review?.suggestions||[],
    designs:documentDesigns(d,auto),designCandidate:auto,designRevision:d.design_rev||'',
    marks:marksOf(s,id),
    links:s.links.filter(l=>l.a===id||l.b===id).map(l=>{
      const other=l.a===id?l.b:l.a;
      return {...l,other,title:getDoc(s,other).title};
    })
  };
}
function queryTerms(text,bigrams=true){
  const n=fold(text);
  const words=[...segmenter.segment(n)].filter(x=>x.isWordLike&&x.segment.length>1&&!stop.has(x.segment)).map(x=>x.segment);
  if(bigrams)for(const run of n.matchAll(/\p{Script=Han}{2,}/gu)){
    const chars=[...run[0]];
    for(let i=1;i<chars.length;i++)words.push(chars[i-1]+chars[i]);
  }
  return [...new Set(words)].filter(t=>!stop.has(t)).slice(0,90);
}
function fold(text){return clean(text,1000000).normalize('NFKC').toLowerCase();}
function chunks(page){
  const found=[];
  const text=page.replace(/\s+/g,' ').trim();
  for(let i=0;i<text.length;i+=750)found.push(text.slice(i,i+950));
  return found;
}
function excerpts(s,d,includeMeta=false){
  const meta=[d.title,d.authors,d.year,d.venue,d.tags,d.doi,d.keywords].filter(Boolean).join(' · ');
  return [
    ...(includeMeta?[{type:'题录',location:'题录',text:meta}]:[]),
    ...(d.abstract?[{type:'整理摘要',location:'整理摘要',text:d.abstract}]:[]),
    ...(d.note?[{type:'研究笔记',location:'研究笔记',text:d.note}]:[]),
    ...(d.segments||[]).map(x=>({type:'来源摘述',location:x.loc,text:x.body})),
    ...marksOf(s,d.id).map(m=>({type:'个人批注',location:'PDF 第 '+m.page+' 页',page:m.page,text:[m.quote,m.note].filter(Boolean).join(' · ')})),
    ...(d.pages||[]).flatMap((p,i)=>chunks(p).map(text=>({type:'PDF正文',location:'PDF 第 '+(i+1)+' 页',page:i+1,text})))
  ];
}
function matcher(q,topicList=[]){
  const exact=fold(q).replace(/[？?。！!]+$/u,'');
  const terms=queryTerms(exact);
  const extra=topicList.filter(t=>[t.name,...t.terms].some(k=>exact.includes(fold(k))))
    .flatMap(t=>[t.name,...t.terms].map(fold));
  return {
    terms,
    rate(text){
      const n=fold(text);
      if(!n)return 0;
      const direct=terms.filter(t=>n.includes(t)).length;
      const aliases=[...new Set(extra)].filter(t=>!terms.includes(t)&&n.includes(t)).length;
      return direct*2+Math.min(aliases,5)*0.4+(exact.length>1&&n.includes(exact)?7:0);
    }
  };
}
function shortText(text,terms,len=380){
  const t=String(text).replace(/\s+/g,' ').trim();
  const hits=terms.toSorted((a,b)=>b.length-a.length).map(k=>fold(t).indexOf(k)).find(i=>i>=0)||0;
  const start=Math.max(0,Math.min(hits-65,t.length-len));
  return (start?'…':'')+t.slice(start,start+len)+(t.length>start+len?'…':'');
}
function list(s,params){
  const q=params.get('q')||'',kind=params.get('kind')||'',tag=params.get('tag')||'',zone=params.get('zone')||'';
  const primary=params.get('primary')==='1';
  const find=matcher(q,config.topics);
  const rows=[];
  for(const d of s.docs){
    if((kind&&d.kind!==kind)||(tag&&(d.review_pending||(primary?d.primary_tag!==tag:!tags(d.tags).includes(tag)))) ||
      (zone==='pending'&&!d.review_pending)||(zone==='unfiled'&&(d.review_pending||d.primary_tag||d.kind==='练习')))continue;
    let best=0,hit='';
    if(q){
      for(const part of excerpts(s,d,true)){
        const score=find.rate(part.text)*(part.type==='题录'?1.4:1);
        if(score>best){best=score;hit=shortText(part.text,find.terms,175);}
      }
      if(!best)continue;
    }
    rows.push({d,hit,best});
  }
  return rows.sort((a,b)=>b.best-a.best||b.d.updated.localeCompare(a.d.updated)||b.d.id-a.d.id)
    .map(({d,hit})=>{
      const designs=documentDesigns(d,designCandidate(d));
      const first=designs.find(x=>x.reviewed)||designs[0];
      return {...publicRow(d),hit,designSummary:first?{
        x:first.x,y:first.y,model:first.model,data:first.data,reviewed:first.reviewed,count:designs.length}:null};
    });
}
function ask(s,q){
  if(!q)throw Error('请填写研究问题。');
  const find=matcher(q,config.topics);
  const ranked=s.docs.filter(d=>!d.review_pending&&d.kind!=='练习').flatMap(d=>excerpts(s,d)
    .map(item=>({d,item,score:find.rate(item.text)})).filter(x=>x.score>=2)).sort((a,b)=>b.score-a.score);
  const sources=[],seen=new Set(),count=new Map();
  for(const {d,item} of ranked){
    const key=JSON.stringify([d.id,item.type,item.location]);
    if(seen.has(key) || (count.get(d.id)||0)>=3)continue;
    seen.add(key);
    count.set(d.id,(count.get(d.id)||0)+1);
    sources.push({n:sources.length+1,id:d.id,title:d.title,year:d.year,type:item.type,location:item.location,
      page:item.page||null,url:d.url|| (d.doi?'https://doi.org/'+d.doi:''),excerpt:shortText(item.text,find.terms)});
    if(sources.length>=6)break;
  }
  return {sources,mode:sources.length?'extract':'none',answer:sources.length?sources.slice(0,4).map(r=>`[${r.n}] ${r.excerpt}`).join('\n\n'):'当前库中未找到可引用的段落。可以换用术语或添加相关资料。'};
}

function withPdf(d,parsed,hash,review){
  if(d.pdf&&d.hash!==hash&&d.designs){
    d.designs=d.designs.map(design=>({...design,evidence:{}}));
    d.design_rev=crypto.randomUUID();
  }
  Object.assign(d,{pdf:true,hash,pdf_pages:parsed.pages.length,text_pages:parsed.pages.filter(Boolean).length,
    pages:parsed.pages,pdf_review:review,design_auto:identifyDesign(parsed.pages),updated:stamp()});
}
async function ingest(file,name,id){
  if(!(file instanceof Blob)||!file.size||file.size>maxPdf)throw Error('请选择 PDF。单个文件上限 64 MB。');
  const bytes=new Uint8Array(await file.arrayBuffer());
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const duplicate=id?null:(await current()).docs.find(d=>d.hash===hash);
  if(duplicate)return {id:duplicate.id,duplicate:true,reason:'file'};
  const parsed=await readPdf(bytes);
  const review=describePdf(parsed,name,config.topics);
  return mutate((s,files)=>{
    let row;
    if(id){
      row=getDoc(s,id);
      if(row.hash!==hash&&row.pdf&&s.marks.some(m=>m.doc===id))throw Error('该 PDF 已有批注。请将新版本另行导入。');
    }else{
      const same=s.docs.find(d=>d.hash===hash);
      if(same)return {id:same.id,duplicate:true,reason:'file'};
      row=review.doi?s.docs.find(d=>d.doi===review.doi):null;
      if(row?.pdf)return {id:row.id,duplicate:true,reason:'doi'};
    }
    const attached=!!row;
    if(!row){
      const suggestions=review.suggestions.slice(0,4).map(t=>t.name);
      const {id:newId}=storeDoc(s,{...review,tags:suggestions.join(','),primary_tag:suggestions[0]||'',
        basis:review.warning?'PDF（待 OCR 或手动补录）':'浏览器导入 PDF',pending:true});
      row=getDoc(s,newId);
    }
    withPdf(row,parsed,hash,review);
    files.put({id:row.id,blob:file});
    return {id:row.id,attached:attached&&!id,pending:!attached,pages:row.pdf_pages,textPages:row.text_pages};
  });
}
export async function getPdf(id){
  const db=await ready;
  const r=await req(db.transaction('pdfs').objectStore('pdfs').get(id));
  if(!r?.blob)throw Error('找不到这份 PDF。');
  return r.blob;
}
async function analyze(id){
  const before=getDoc(await current(),id);
  const file=await getPdf(id);
  const parsed=await readPdf(new Uint8Array(await file.arrayBuffer()));
  const review=describePdf(parsed,before.title,config.topics);
  return mutate(s=>{
    const d=getDoc(s,id);
    if(d.hash!==before.hash||!d.pdf)throw Error('附件已更新，请重新打开条目。');
    withPdf(d,parsed,d.hash,review);
    return {id};
  });
}
function normalizeMark(value,d) {
  const page=Number(value.page);
  const quote=clean(value.quote,4000),note=clean(value.note,12000);
  if(!d.pdf||!Number.isInteger(page)||page<1||page>d.pdf_pages||(!quote&&!note))throw Error('请选择 PDF 页和有效批注内容。');
  const style=['高亮','下划线','批注'].includes(value.style)?value.style:'批注';
  const rects=Array.isArray(value.rects)?value.rects.slice(0,100).filter(r=>Array.isArray(r)&&r.length===4&&r.every(n=>Number.isFinite(n)&&n>=0&&n<=1)):[];
  return {doc:d.id,page,style,quote,note,rects,ideaTags:cleanIdeaTags(value.ideaTags)};
}
function cslImport(s,items){
  if(!Array.isArray(items)||items.length>1000)throw Error('请选择 Zotero 的 CSL JSON 数组，每批最多 1000 条。');
  const count={added:0,duplicate:0,skipped:0,last:null};
  for(const x of items){
    if(!x||!x.title){count.skipped++;continue;}
    const isZh=/\p{Script=Han}/u.test(x.title);
    const result=storeDoc(s,{title:x.title,authors:(Array.isArray(x.author)?x.author:[]).map(a=>a.literal||[a.given,a.family].filter(Boolean).join(' ')).join('; '),
      year:x.issued?.['date-parts']?.[0]?.[0],doi:x.DOI,url:x.URL,
      kind:({book:'著作',chapter:'著作',report:'报告','article-newspaper':'新闻'})[x.type]||'论文',
      lang:isZh?'中文':'English',venue:x['container-title'],abstract:x.abstract,keywords:x.keyword,basis:'Zotero CSL JSON'});
    count[result.duplicate?'duplicate':'added']++;
    count.last=result.id;
  }
  return count;
}
const discoverNow=(zh,en,kind='')=>{
  if(!zh&&!en)throw Error('请至少填写一组检索词。');
  return discover(zh,en,kind);
};
function scan(watch){
  if(scans.has(watch.id))return scans.get(watch.id);
  const running=discoverNow(watch.zh,watch.en).then(result=>mutate(s=>{
    const active=s.watches.find(w=>w.id===watch.id);
    if(!active)return result;
    const keys=new Set(s.inbox.filter(i=>i.watch===active.id).map(i=>i.key));
    for(const item of result.results){
      const key=fold(item.doi||item.url||item.title);
      if(!key||keys.has(key))continue;
      keys.add(key);
      s.inbox.push({id:next(s),watch:active.id,key,item,seen:0,stamp:Date.now()});
    }
    active.last=Date.now();
    active.status=result.sources;
    return result;
  })).finally(()=>scans.delete(watch.id));
  scans.set(watch.id,running);
  return running;
}
export async function checkWatches(){
  const s=await current();
  for(const w of s.watches.filter(x=>Date.now()-x.last>=86400000)){
    await scan(w).catch(()=>{});
  }
}
export async function api(path,body,method=body===undefined?'GET':'POST'){
  await ready;
  const u=new URL(path,location.origin),p=u.pathname;
  const q=k=>clean(u.searchParams.get(k),500);
  const post=method==='POST';
  if(p==='/api/status')return {topics:config.topics,provider:'',browser:true};
  if(p==='/api/docs')return post?mutate(s=>storeDoc(s,body)):list(await current(),u.searchParams);
  if(p==='/api/pdf-import'&&post)return ingest(body,q('name'));
  if(p==='/api/discover')return discoverNow(q('zh'),q('en'),q('kind'));
  if(p==='/api/ask'&&post)return ask(await current(),clean(body.q,800));
  if(p==='/api/designs')return designIndex(await current());
  if(p==='/api/ideas'){
    const s=await current();
    const docs=new Map(s.docs.map(d=>[d.id,d]));
    return s.marks.filter(m=>docs.has(m.doc)).toReversed().map(m=>({...m,title:docs.get(m.doc).title}));
  }
  if(p==='/api/map'){
    const s=await current();
    const docs=s.docs.filter(d=>!d.review_pending).map(publicRow);
    const ids=new Set(docs.map(d=>d.id));
    return {docs,links:s.links.filter(l=>ids.has(l.a)&&ids.has(l.b))};
  }
  if(p==='/api/zotero/import'&&post)return mutate(s=>cslImport(s,body));
  const doc=p.match(/^\/api\/docs\/(\d+)(?:\/(pdf|analyze|marks|links|designs))?$/);
  if(doc){
    const id=Number(doc[1]),action=doc[2];
    if(!action&&method==='DELETE')return mutate((s,files)=>{
      s.docs=s.docs.filter(d=>d.id!==id);
      s.marks=s.marks.filter(m=>m.doc!==id);
      s.links=s.links.filter(l=>l.a!==id&&l.b!==id);
      files.delete(id);
      return {deleted:true};
    });
    if(!action)return post?mutate(s=>storeDoc(s,body,id)):details(await current(),id);
    if(action==='designs'&&post)return mutate(s=>{
      const d=getDoc(s,id);
      const count=d.pdf?d.pdf_pages:0;
      if((body.revision||'')!==(d.design_rev||''))throw Error('研究设计已在其他页面更新，请重新打开后再保存。');
      d.designs=normalizeDesigns(body.designs,count);
      d.design_rev=crypto.randomUUID();
      return {id,designs:d.designs};
    });
    if(action==='pdf')return post?ingest(body,q('name')||'附件.pdf',id):getPdf(id);
    if(post&&action==='analyze')return analyze(id);
    if(post&&action==='marks')return mutate(s=>{
      const mark={...normalizeMark(body,getDoc(s,id)),id:next(s)};
      s.marks.push(mark);
      return {id:mark.id};
    });
    if(post&&action==='links')return mutate(s=>{
      const b=Number(body.b),type=clean(body.type,40),note=clean(body.note,3000);
      if(id===b||!type||!note)throw Error('请选择两条不同文献并填写关系和依据。');
      getDoc(s,id);getDoc(s,b);
      const match=s.links.find(l=>l.a===id&&l.b===b&&l.type===type);
      if(match)match.note=note;
      else s.links.push({id:next(s),a:id,b,type,note});
      return {changed:1};
    });
  }
  const item=p.match(/^\/api\/(marks|links|watches|inbox)\/(\d+)$/);
  if(item){
    const [,key,raw]=item,id=Number(raw);
    if(key==='marks'&&post)return mutate(s=>{
      const mark=s.marks.find(m=>m.id===id);
      if(!mark)throw Error('这条批注已不存在。');
      mark.ideaTags=cleanIdeaTags(body.ideaTags);
      return {id};
    });
    if(key==='watches'&&post){
      const watch=(await current()).watches.find(w=>w.id===id);
      if(!watch)throw Error('找不到该订阅。');
      return scan(watch);
    }
    if(key==='inbox'&&post)return mutate(s=>{ const entry=s.inbox.find(i=>i.id===id);if(entry)entry.seen=1;return {updated:!!entry};});
    if(method==='DELETE'&&key!=='inbox')return mutate(s=>{
      s[key]=s[key].filter(x=>x.id!==id);
      if(key==='watches')s.inbox=s.inbox.filter(i=>i.watch!==id);
      return {deleted:true};
    });
  }
  if(p==='/api/watches'){
    if(post){
      const zh=clean(body.zh,250),en=clean(body.en,250);
      if(!zh&&!en)throw Error('请至少填写一种语言的检索词。');
      const w=await mutate(s=>{
        let found=s.watches.find(x=>x.zh===zh&&x.en===en);
        if(!found){found={id:next(s),zh,en,last:0,status:[]};s.watches.push(found);}
        return found;
      });
      return scan(w);
    }
    const s=await current();
    return {watches:s.watches,items:s.inbox.filter(x=>!x.seen).sort((a,b)=>b.stamp-a.stamp||b.id-a.id).slice(0,150)};
  }
  throw Error('此功能没有可用接口。');
}

export async function entryMarkdown(id){
  const d=details(await current(),id);
  const lines=['---',`title: ${JSON.stringify(d.title)}`,`primary_tag: ${JSON.stringify(d.primary_tag)}`,`tags: ${JSON.stringify(tags(d.tags))}`,
    '---','',`# ${d.title}`,'',d.authors,d.venue,d.year,d.url,'','## 整理摘要','',d.abstract,'','## 研究笔记','',d.note,
    '','## PDF 批注','',...d.marks.map(m=>`- PDF 第 ${m.page} 页 · ${m.style} · ${m.quote || ''}\n  ${m.note || ''}`),
    '','## 研究关系','',...d.links.map(l=>`- ${l.type} · [[${l.title}]] · ${l.note}`),
    ...d.designs.flatMap((row,i)=>['',`## ${row.name||'研究设计 '+(i+1)}（${row.reviewed?'已核对':'待核对'}）`,
      ...designFields.filter(f=>row[f.key]).map(f=>`- ${f.label}｜${row[f.key]}`)]),''];
  return new Blob([lines.join('\n')],{type:'text/markdown;charset=utf-8'});
}

const format='labor-library-browser-v1';
function encodeBlob(blob){
  return new Promise((ok,bad)=>{
    const reader=new FileReader();
    reader.onload=()=>ok(String(reader.result).split(',',2)[1]);
    reader.onerror=()=>bad(reader.error);
    reader.readAsDataURL(blob);
  });
}
export async function exportBackup(){
  const db=await ready;
  const tx=db.transaction(['state','pdfs']);
  const [state,files]=await Promise.all([req(tx.objectStore('state').get('library')),req(tx.objectStore('pdfs').getAll())]);
  const pdfs=[];
  for(const item of files)pdfs.push({id:item.id,base64:await encodeBlob(item.blob)});
  return new Blob([JSON.stringify({format,state,pdfs})],{type:'application/json'});
}
function validatedReview(review,pageCount){
  if(!review||typeof review!=='object')return null;
  const sections=Array.isArray(review.sections)?review.sections.filter(s=>s&&positive(s.page)&&s.page<=pageCount)
    .slice(0,12).map(s=>({page:s.page,label:clean(s.label,60),text:clean(s.text,4000)})):[];
  const sources=Object.fromEntries(['title','authors','year','doi','venue'].filter(k=>review.sources?.[k]).map(k=>[k,clean(review.sources[k],100)]));
  const suggestions=Array.isArray(review.suggestions)?review.suggestions.filter(x=>x&&config.topics.some(t=>t.name===x.name)).slice(0,8)
    .map(x=>({name:x.name,matches:Array.isArray(x.matches)?x.matches.filter(Boolean).slice(0,4).map(m=>({source:clean(m.source,40),term:clean(m.term,120)})):[]})):[];
  return {...Object.fromEntries(['title','authors','year','kind','lang','doi','venue','abstract','keywords'].map(k=>[k,clean(review[k],4000)])),
    sections,sources,suggestions,warning:clean(review.warning,240)};
}
export async function restoreBackup(file,{merge=false}={}){
  await ready;
  if(!(file instanceof Blob)||!file.size)throw Error('请选择知识库备份文件。');
  const source=JSON.parse(await file.text());
  const original=source.state;
  if(source.format!==format||!original||!['docs','marks','links','watches','inbox'].every(k=>Array.isArray(original[k]))||!Array.isArray(source.pdfs)){
    throw Error('此文件不是受支持的知识库备份。');
  }
  const s=fresh(),files=[],ids=new Set();
  for(const doc of original.docs){
    if(!doc||!positive(doc.id)||ids.has(doc.id))throw Error('备份中的文献编号重复或无效。');
    ids.add(doc.id);
    const pageCount=doc.pdf&&positive(doc.pdf_pages)?doc.pdf_pages:0;
    s.docs.push({...SetFields(doc),id:doc.id,updated:/^\d{4}-\d\d-\d\d/.test(doc.updated)?clean(doc.updated,40):stamp(),
      review_pending:Number(!!doc.review_pending),pdf:!!pageCount,pdf_pages:pageCount,
      text_pages:Math.min(pageCount,Math.max(0,Number(doc.text_pages)||0)),
      pages:pageCount&&Array.isArray(doc.pages)?doc.pages.slice(0,pageCount).map(p=>clean(p,500000)):[],
      hash:/^[\da-f]{64}$/i.test(doc.hash)?doc.hash:'',
      segments:Array.isArray(doc.segments)?doc.segments.filter(Boolean).slice(0,200).map(v=>({loc:clean(v.loc,100),body:clean(v.body,14000)})):[],
      pdf_review:validatedReview(doc.pdf_review,pageCount),
      ...(Array.isArray(doc.designs)?{designs:normalizeDesigns(doc.designs,pageCount),design_rev:crypto.randomUUID()}:{}),
      ...('design_auto' in doc?{design_auto:doc.design_auto?normalizeDesigns([doc.design_auto],pageCount)[0]||null:null}:{})});
    s.clock=Math.max(s.clock,doc.id);
  }
  const expected=new Set(s.docs.filter(d=>d.pdf).map(d=>d.id));
  for(const p of source.pdfs){
    if(!p||!expected.delete(p.id)||typeof p.base64!=='string'||p.base64.length>maxPdf*1.34+8)throw Error('备份中存在无效或过大的 PDF。');
    const data=Uint8Array.from(atob(p.base64),c=>c.charCodeAt(0));
    if(!new TextDecoder().decode(data.subarray(0,1024)).includes('%PDF-'))throw Error('备份中的 PDF 格式无效。');
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(n=>n.toString(16).padStart(2,'0')).join('');
    const doc=getDoc(s,p.id);
    if(doc.hash&&doc.hash!==digest)throw Error('备份中的 PDF 与文献记录不匹配。');
    doc.hash=digest;
    files.push({id:p.id,blob:new Blob([data],{type:'application/pdf'})});
  }
  if(expected.size)throw Error('备份中的 PDF 附件不完整。');
  for(const mark of original.marks){
    const doc=getDoc(s,mark.doc);
    s.marks.push({...normalizeMark(mark,doc),id:next(s)});
  }
  for(const link of original.links){
    if(!ids.has(link.a)||!ids.has(link.b)||link.a===link.b)throw Error('备份中的研究关系无效。');
    s.links.push({id:next(s),a:link.a,b:link.b,type:clean(link.type,40),note:clean(link.note,3000)});
  }
  const watches=new Map();
  for(const watch of original.watches){
    const zh=clean(watch.zh,250),en=clean(watch.en,250);
    if(!zh&&!en)continue;
    const id=next(s);
    watches.set(watch.id,id);
    s.watches.push({id,zh,en,last:Number(watch.last)||0,status:Array.isArray(watch.status)?watch.status.filter(Boolean).slice(0,20).map(x=>
      ({name:clean(x.name,120),ok:!!x.ok,detail:clean(x.detail,150)})):[]});
  }
  for(const entry of original.inbox){
    const watch=watches.get(entry.watch);
    if(!watch||!entry.item?.title)continue;
    const item=SetFields(entry.item);
    s.inbox.push({id:next(s),watch,key:clean(entry.key,2000),seen:Number(!!entry.seen),stamp:Number(entry.stamp)||0,
      item:{...item,via:clean(entry.item.via,120),excerpt:clean(entry.item.excerpt,14000),pdfUrl:httpUrl(entry.item.pdfUrl)}});
  }
  const removed=removeLegacySamples(s);
  const personalFiles=files.filter(file=>!removed.has(file.id));
  return mutate((existing,store)=>{
    if(merge)return mergeLibraries(existing,store,s,personalFiles);
    Object.assign(existing,s);
    store.clear();
    for(const file of personalFiles)store.put(file);
    return {added:s.docs.length,duplicates:0,marks:s.marks.length,conflicts:0};
  });
}

function mergeLibraries(target,store,source,files){
  const lookup=new Map(files.map(file=>[file.id,file.blob]));
  const mapped=new Map(),samePdf=new Set();
  const result={added:0,duplicates:0,marks:0,conflicts:0};
  for(const input of source.docs){
    const match=target.docs.find(d=>(input.hash&&d.hash===input.hash)||(input.doi&&d.doi===input.doi)||
      (input.zotero&&d.zotero===input.zotero)||((!input.pdf||!d.pdf)&&fold(input.title)===fold(d.title)&&
      (!input.year||!d.year||input.year===d.year)));
    const blob=lookup.get(input.id);
    if(!match){
      const id=next(target);
      target.docs.push({...input,id});
      mapped.set(input.id,id);
      if(blob){store.put({id,blob});samePdf.add(input.id);}
      result.added++;
      continue;
    }
    result.duplicates++;
    mapped.set(input.id,match.id);
    for(const key of states){
      if(['journalIndex','journalEvidence'].includes(key))continue;
      if(!match[key]&&input[key])match[key]=input[key];
    }
    if(!match.journalIndex&&input.journalIndex){
      match.journalIndex=input.journalIndex;
      match.journalEvidence=input.journalEvidence;
    }
    match.tags=[...new Set([...tags(match.tags),...tags(input.tags)])].join(',');
    match.primary_tag ||= input.primary_tag;
    if(blob&&!match.pdf){
      for(const key of ['pdf','hash','pages','pdf_pages','text_pages','pdf_review','design_auto'])match[key]=input[key];
      store.put({id:match.id,blob});
    }
    if(blob&&match.hash===input.hash)samePdf.add(input.id);
    else if(blob)result.conflicts++;
    if(!match.designs?.length&&input.designs?.length){
      match.designs=input.designs.map(d=>samePdf.has(input.id)?d:{...d,evidence:{}});
      match.design_rev=crypto.randomUUID();
    }
  }
  for(const m of source.marks){
    if(!samePdf.has(m.doc))continue;
    const doc=mapped.get(m.doc);
    const match=target.marks.find(other=>other.doc===doc&&other.page===m.page&&other.style===m.style&&other.note===m.note&&other.quote===m.quote&&
      JSON.stringify(other.rects)===JSON.stringify(m.rects));
    if(match){
      match.ideaTags=cleanIdeaTags([...(match.ideaTags||[]),...(m.ideaTags||[])]);
      continue;
    }
    target.marks.push({...m,doc,id:next(target)});
    result.marks++;
  }
  for(const l of source.links){
    const a=mapped.get(l.a),b=mapped.get(l.b);
    if(a===b||target.links.some(x=>x.a===a&&x.b===b&&x.type===l.type))continue;
    target.links.push({...l,a,b,id:next(target)});
  }
  const watches=new Map();
  for(const watch of source.watches){
    const known=target.watches.find(w=>w.zh===watch.zh&&w.en===watch.en);
    const id=known?.id||next(target);
    if(!known)target.watches.push({...watch,id});
    watches.set(watch.id,id);
  }
  for(const item of source.inbox){
    const watch=watches.get(item.watch);
    if(!watch||target.inbox.some(i=>i.watch===watch&&i.key===item.key))continue;
    target.inbox.push({...item,watch,id:next(target)});
  }
  return result;
}
