import {api,checkWatches,entryMarkdown,getPdf,exportBackup,restoreBackup} from './browser-api.mjs?v=summary-1';
import {designSummary,mountComparison,mountDesignEditor} from './research-ui.mjs';

const asset=path=>new URL(path,import.meta.url).href;

const $ = (sel, parent=document) => parent.querySelector(sel);
const $$ = (sel, parent=document) => [...parent.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const detail = $('#detail'), edit = $('#edit'), reader = $('#reader'), research = $('#research'), view = $('#view');
const state = { view:'library', docs:[], topics:[], engine:'', q:'', kind:'', tag:'', zone:'', primaryOnly:false, discovery:null, terms:{zh:'',en:'',kind:''}, answer:null, question:'' };
const kinds = ['论文','政策','报告','著作','新闻','网页','练习'];
const linkTypes = ['比较案例','补充证据','观点分歧','理论与案例','政策回应'];
const symbols = {
  library:'<path d="M4 5h4v14H4zM10 5h4v14h-4zM16 6l3.3-.8L23 18l-3.3.9z"/>',
  studies:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M3 14.5h18M9 5v14m6-14v14"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.1"/><path d="m15 15 5 5"/>',
  inbox:'<path d="M4 7h16l2 7v5H2v-5zM2 14h6l2 2h4l2-2h6"/>',
  ask:'<path d="M20 17H9l-5 3V5h16zM8 9h8M8 13h5"/>',
  map:'<circle cx="5" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7 5h9M6 7l5 9m6-9-4 9"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>'
};
const icon = name => `<span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24">${symbols[name]||''}</svg></span>`;
$$('[data-icon]').forEach(n=>n.innerHTML=icon(n.dataset.icon));
const tags = d => (d.tags || '').split(',').filter(Boolean);
const label = kind => `<span class="type" data-kind="${esc(kind)}">${esc(kind)}</span>`;
const chips = list => list.map(t=>`<span class="tag">${esc(t)}</span>`).join('');
const meta = d => [d.authors,d.venue,d.year,d.lang,d.pdf?'PDF 全文':'',d.basis].filter(Boolean).map(esc).join(' · ');
const options = (values,chosen='') => values.map(x=>`<option${x===chosen?' selected':''}>${esc(x)}</option>`).join('');
const empty = message => `<div class="empty">${esc(message)}</div>`;
const formData = form => Object.fromEntries(new FormData(form));
const outbound = (url,text) => /^https?:\/\//i.test(url || '') ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>` : '';
const formatNote = text => esc(text).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>');
const close = id => `<button class="quiet" data-close="${id}" aria-label="关闭">${icon('close')}</button>`;
let toastTimer;

function download(blob,name){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=name;
  document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),15000);
}
function toast(message,error=false) {
  const el=$('#toast');
  el.textContent=message;
  el.className=error?'error':'';
  el.hidden=false;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.hidden=true,4000);
}
function bind(form, handler) {
  form.addEventListener('submit',async ev=>{
    ev.preventDefault();
    const btn=ev.submitter || $('button[type=submit]',form);
    if (btn) btn.disabled=true;
    const err=$('.errorText',form);
    if (err) err.textContent='';
    try { await handler(form,ev.submitter); }
    catch(e) { if(err) err.textContent=e.message; else toast(e.message,true); }
    finally { if(btn) btn.disabled=false; }
  });
}
const heading = (title,sub,tools='') => `<header class="viewhead"><div><h1>${title}</h1><p class="subtitle">${sub}</p></div><div class="tools">${tools}</div></header>`;
function glance(d){
  if(d.kind==='练习')return '';
  const s=d.designSummary||d.designs?.find(x=>x.reviewed)||d.designs?.[0]||{};
  const fields=[['收录',d.journalIndex||'待核验'],['X',s.x],['Y',s.y],['回归方法',s.model],['数据',s.data]];
  return `<div class="paper-glance" aria-label="研究设计速览">
    ${fields.map(([name,val])=>`<span title="${esc(val||'待填写')}"${name==='数据'?' class="glance-data"':''}><strong>${name}</strong> ${esc(val||'—')}</span>`).join('')}
    ${s.x||s.y||s.model||s.data?`<small>${s.reviewed?'已核对':'自动候选或待核对'}${s.count>1?' · '+s.count+' 组':''}</small>`:''}</div>`;
}
const compactEntry = d => `<article class="entry"><div class="entryline"><div><button class="entrytitle" data-doc="${d.id}">${esc(d.title)}</button><div class="meta">${meta(d)}</div></div>${label(d.review_pending?'待核对':d.kind)}</div>${d.hit?`<p class="meta">${esc(d.hit)}</p>`:''}<div class="row">
  ${d.primary_tag&&!d.review_pending?`<span class="tag mainTag" title="主专题">${esc(d.primary_tag)}</span>`:''}${chips(tags(d).filter(t=>d.review_pending||t!==d.primary_tag))}</div>${glance(d)}</article>`;

async function refreshDocs() { state.docs=await api('/api/docs'); }
async function refreshInbox() {
  const inbox=await api('/api/watches');
  $('#inboxCount').hidden=!inbox.items.length;
  $('#inboxCount').textContent=inbox.items.length;
  return inbox;
}
function updateEngine(status) {
  $('#workspaceName').textContent='浏览器工作区';
  $('#engineBadge').textContent='资料保存在此浏览器';
}
function go(name) {
  state.view=name;
  if(name==='studies'&&location.hash!=='#research-designs')history.replaceState(null,'','#research-designs');
  if(name!=='studies'&&location.hash==='#research-designs')history.replaceState(null,'',location.pathname+location.search);
  $$('.nav').forEach(btn=>{
    const active=btn.dataset.view===name;
    btn.classList.toggle('active',active);
    if(active) btn.setAttribute('aria-current','page'); else btn.removeAttribute('aria-current');
  });
  const handler=({library:showLibrary,studies:showStudies,discover:showDiscovery,inbox:showInbox,ask:showAsk,map:showMap})[name];
  if (handler) Promise.resolve(handler()).catch(e=>toast(e.message,true));
}
async function showStudies(){
  const index=await api('/api/designs');
  if(state.view!=='studies')return;
  mountComparison(view,index,{open:id=>openStudy(id).catch(e=>toast(e.message,true)),download});
}
async function openStudy(id){
  const d=await api(`/api/docs/${id}`);
  mountDesignEditor(research,d,{
    notify:toast,
    extract:async()=>{
      await api(`/api/docs/${id}/analyze`,{});
      return (await api(`/api/docs/${id}`)).designCandidate;
    },
    save:async designs=>{
      const updated=await api(`/api/docs/${id}/designs`,{designs,revision:d.designRevision});
      for(const target of $$('[data-study-summary="'+id+'"]')){
        target.innerHTML=designSummary({...d,designs:updated.designs});
      }
      if(state.view==='studies')await showStudies();
    }
  });
}
let searchGeneration=0;
function showLibrary() {
  const pending=state.docs.filter(d=>d.review_pending).length;
  const confirmed=state.docs.filter(d=>!d.review_pending&&d.kind!=='练习');
  const topics=[...new Set([...state.topics.map(t=>t.name),...confirmed.flatMap(tags)])];
  const active=state.tag || ({pending:'待核对',unfiled:'未归类'})[state.zone] || '全部资料';
  const section=(key,title,count,selected)=>`<button class="topicLine${selected?' selected':''}" ${key} ${selected?'aria-current="true"':''}>${esc(title)}<span>${count} 条</span></button>`;
  view.innerHTML=heading('文献库','导入 PDF，核对提取结果，再按专题归档。',
    `<button data-backup>备份与迁移</button><button data-import>Zotero 导入</button><button data-new>手动添加</button><button class="primary" data-pdfimport>${icon('plus')} 导入 PDF</button>`) +
    `
    <div class="columns"><section class="panel">
      <div class="panelhead"><h2>${esc(active)}</h2><span class="meta" id="docCount"></span></div>
      <div class="searchbar">${icon('search')}<input id="q" type="search" value="${esc(state.q)}" aria-label="搜索文献" placeholder="搜索标题、作者、DOI、关键词或批注"></div>
      <div class="filter"><select id="kind" aria-label="资料类型"><option value="">全部类型</option>${options(kinds,state.kind)}</select>
      ${state.tag?`<select id="scope" aria-label="专题范围"><option value="0"${state.primaryOnly?'':' selected'}>全部关联资料</option><option value="1"${state.primaryOnly?' selected':''}>仅主专题归档</option></select>`:''}</div>
      <div id="entries"></div></section>
      <aside class="stack">
        <section class="panel"><h2>你的资料存在此浏览器</h2><p class="meta">PDF、批注、笔记和专题不会上传。更换浏览器或设备时，可以导出备份再导入。</p></section>
        <section class="panel"><h2>归档</h2>
          ${section('data-zone=""','全部资料',state.docs.length,!state.zone&&!state.tag)}
          ${section('data-zone="pending"','待核对',pending,state.zone==='pending')}
          ${section('data-zone="unfiled"','未归类',confirmed.filter(d=>!d.primary_tag).length,state.zone==='unfiled')}
        </section>
        <section class="panel"><h2>研究专题</h2>${topics.map(t=>section(`data-tag="${esc(t)}"`,t,confirmed.filter(d=>tags(d).includes(t)).length,state.tag===t)).join('')}</section>
        <section class="panel"><h2>从 PDF 回到证据</h2><p class="meta">选中文字后可高亮、下划线或写批注。批注随页码保存，并能在库内检索。</p>
        ${state.docs.find(d=>d.kind==='练习')?`<button data-pdf="${state.docs.find(d=>d.kind==='练习').id}">打开练习 PDF</button>`:''}</section>
      </aside></div>`;
  let debounce;
  $('#q').addEventListener('input',e=>{
    state.q=e.target.value;
    clearTimeout(debounce);
    debounce=setTimeout(fetchDocs,220);
  });
  $('#kind').onchange=e=>{state.kind=e.target.value;fetchDocs();};
  if($('#scope'))$('#scope').onchange=e=>{state.primaryOnly=e.target.value==='1';fetchDocs();};
  return fetchDocs();
}
async function fetchDocs(){
  const generation=++searchGeneration;
  const docs=await api('/api/docs?'+new URLSearchParams({q:state.q,kind:state.kind,tag:state.tag,zone:state.zone,primary:state.primaryOnly?'1':'0'}));
  if(state.view!=='library'||generation!==searchGeneration)return;
  $('#docCount').textContent=docs.length+' 条资料';
  $('#entries').innerHTML=docs.map(compactEntry).join('') || empty('当前条件下没有找到资料。');
}
const statusHtml = sources => `<div class="sourceStatus">${sources.map(s=>`<span class="${s.ok?'':'failed'}">${esc(s.name)} · ${s.ok?esc(s.detail):'暂时不可用'}</span>`).join('')}</div>`;

function foundRow(item,index,inboxId) {
  return `<article class="entry"><div class="entryline"><div><h3>${outbound(item.url,item.title) || esc(item.title)}</h3><div class="meta">${esc([item.authors,item.year,item.lang,item.via,item.basis].filter(Boolean).join(' · '))}</div></div>${label(item.kind)}</div>
    ${item.excerpt?`<p class="meta">${esc(item.excerpt.slice(0,270))}${item.excerpt.length>270?'…':''}</p>`:''}
    <div class="row"><button data-savefound="${index}"${inboxId?` data-inboxid="${inboxId}"`:''}>收入文献库</button>${outbound(item.pdfUrl,'开放获取 PDF')}${inboxId?`<button class="quiet" data-dismiss="${inboxId}">略过</button>`:''}</div></article>`;
}
function showDiscovery() {
  view.innerHTML=heading('双语发现','按中文和英文检索论文、新闻与著作，筛选后再入库。')+
    `<div class="columns"><div class="stack"><section class="panel">
      <form class="forms" id="findForm">
        <div class="formgrid"><label>中文检索词<input name="zh" value="${esc(state.terms.zh)}" placeholder="如 外卖骑手 劳动报酬"></label>
        <label>英文检索词<input name="en" value="${esc(state.terms.en)}" placeholder="e.g. platform work minimum wage"></label></div>
        <div class="formgrid"><label>资料类型<select name="kind"><option value="">论文、著作与新闻</option>${options(['论文','著作','新闻'],state.terms.kind)}</select></label></div>
        <div class="row"><button class="primary" type="submit">联网检索</button><button type="submit" name="saveWatch">订阅这组检索词</button></div><div class="errorText meta" role="status"></div>
      </form></section><section class="panel"><h2>发现结果</h2><div id="results"></div></section></div>
      <aside class="stack"><section class="panel"><h2>填入主题词</h2>${state.topics.map(t=>`<button class="topicLine" data-preset="${esc(t.name)}">${esc(t.name)}</button>`).join('')}</section>
      <section class="panel"><h2>手动补充来源</h2><p class="meta">站外入口可补查中文社科论文、官方政策和付费全文。取得 PDF 后再添加到库。</p>
      <div class="refs">${outbound('https://ncpssd.org/','国家哲学社会科学文献中心')}${outbound('https://www.cnki.net/','中国知网')}${outbound('https://www.ilo.org/topics-and-sectors/digital-labour-platforms','国际劳工组织 · 数字劳动平台')}${outbound('https://chinajob.mohrss.gov.cn/','人社部 · 中国就业网')}</div></section></aside></div>`;
  function renderResult(result) {
    const target=$('#results');
    if (!target) return;
    target.innerHTML=result?(statusHtml(result.sources)+ (result.results.map((item,i)=>foundRow(item,i)).join('')||empty('这一轮没有返回结果，可换词或使用站外入口。'))):empty('填写主题，或选用右侧的研究主题词。');
  }
  renderResult(state.discovery);
  bind($('#findForm'),async(form,button)=>{
    const terms=formData(form);
    if(!terms.zh.trim()&&!terms.en.trim()) throw Error('请填写至少一种语言的检索词。');
    state.terms=terms;
    $('#results').textContent='正在查询各来源…';
    if(button?.name==='saveWatch'){
      await api('/api/watches',{zh:terms.zh,en:terms.en});
      toast('已订阅，并已运行首次扫描。');
      return go('inbox');
    }
    state.discovery=await api('/api/discover?'+new URLSearchParams(terms));
    if(state.view==='discover')renderResult(state.discovery);
  });
}
async function showInbox() {
  view.innerHTML=heading('订阅与收件箱','网页打开时检查到期订阅，也可以手动扫描。',
    '<button class="primary" data-view="discover">添加订阅</button>')+'<div class="panel" id="inboxLoading">正在读取…</div>';
  const inbox=await refreshInbox();
  if(state.view!=='inbox')return;
  state.inbox=inbox;
  $('#inboxLoading').outerHTML=`<div class="columns"><section class="panel"><div class="panelhead"><h2>待筛选</h2><span class="meta">${inbox.items.length} 条</span></div>
    ${inbox.items.map((x,i)=>foundRow(x.item,i,x.id)).join('')||empty('收件箱为空。可以添加或刷新订阅。')}</section>
    <aside class="panel"><h2>检索订阅</h2>
    ${inbox.watches.map(w=>`<article class="entry"><h3>${esc(w.zh || w.en)}</h3>${w.zh&&w.en?`<div class="meta">${esc(w.en)}</div>`:''}
      <div class="meta">${w.last?'上次扫描 '+new Date(w.last).toLocaleString('zh-CN'):'尚未扫描'}</div>
      ${statusHtml(w.status)}<div class="row"><button data-scan="${w.id}">立即扫描</button><button class="quiet danger" data-unwatch="${w.id}">取消订阅</button></div></article>`).join('') || empty('暂无订阅。')}</aside></div>`;
}
function showAsk() {
  view.innerHTML=heading('证据检索','输入问题查找相关段落，可以打开引用来源或 PDF 原页。')+
    `<div class="columns"><div class="stack"><section class="panel"><form id="askForm" class="forms">
      <label>研究问题<textarea name="q" required placeholder="如 平台劳动报酬和工作时间有哪些相关材料？">${esc(state.question)}</textarea></label>
      <div class="row"><button type="submit" class="primary">查找证据</button></div>
      <div class="errorText meta" role="status"></div></form></section><section class="panel"><h2>回答</h2><div id="answer"></div></section></div>
      <aside class="panel"><h2>出处</h2><div id="references"></div></aside></div>`;
  const render=result=>{
    if(state.view!=='ask')return;
    $('#answer').innerHTML=result?`<p class="meta">${result.mode==='model'?'本地模型综合 · '+esc(result.model):result.mode==='extract'?'从库内直接摘录的证据':'未检出可引用证据'}</p><div class="answer">${esc(result.answer)}</div>`:empty('提交问题后，这里会显示回答。');
    $('#references').innerHTML=result?.sources.length? result.sources.map(s=>`<article class="reference"><h3>[${s.n}] ${esc(s.title)}</h3>
      <div class="meta">${esc([s.year,s.type,s.location].filter(Boolean).join(' · '))}</div><p class="meta">${esc(s.excerpt)}</p>
      <div class="row"><button ${s.page?`data-pdf="${s.id}" data-page="${s.page}"`:`data-doc="${s.id}"`}>${s.page?'打开 PDF 原页':'查看库内条目'}</button>${outbound(s.url,'来源网站')}</div></article>`).join(''):empty('引用会显示在这里。');
  };
  render(state.answer);
  bind($('#askForm'),async(form)=>{
    state.question=formData(form).q;
    $('#answer').textContent='正在检索本地证据…';
    state.answer=await api('/api/ask',{q:state.question});
    render(state.answer);
  });
}

async function showMap() {
  view.innerHTML=heading('知识地图','按研究议题查看资料，把可比较的文献用有依据的关系连起来。')+'<div id="mapping"><div class="panel">正在读取…</div></div>';
  const {docs,links}=await api('/api/map');
  if(state.view!=='map')return;
  const title=id=>docs.find(d=>d.id===id)?.title;
  const groups=[...new Set([...state.topics.map(t=>t.name),...docs.flatMap(tags)])].map(tag=>({tag,docs:docs.filter(d=>tags(d).includes(tag))}));
  const linked=new Set(links.map(l=>[Math.min(l.a,l.b),Math.max(l.a,l.b)].join('|')));
  const suggested=[];
  for(const [i,a] of docs.entries()){
    if(a.kind==='练习')continue;
    for(const b of docs.slice(i+1)){
      if(b.kind==='练习' || linked.has([Math.min(a.id,b.id),Math.max(a.id,b.id)].join('|')))continue;
      const shared=tags(a).filter(t=>tags(b).includes(t));
      if(shared.length) suggested.push({a,b,shared});
    }
    if(suggested.length>=100)break;
  }
  suggested.sort((a,b)=>b.shared.length-a.shared.length);
  const selectable=docs.filter(d=>d.kind!=='练习');
  const anchor=selectable.find(d=>d.id===state.anchor) || selectable.find(d=>links.some(l=>l.a===d.id||l.b===d.id)) || selectable[0];
  state.anchor=anchor?.id;
  const neighbours=anchor?links.filter(l=>l.a===anchor.id||l.b===anchor.id):[];
  $('#mapping').innerHTML=`<div class="stack"><section class="panel"><div class="panelhead"><div><h2>关系图</h2><p class="meta">选择一条文献，查看已有的研究关系。</p></div><label>中心文献<select id="mapAnchor">${selectable.map(d=>`<option value="${d.id}"${anchor?.id===d.id?' selected':''}>${esc(d.title)}</option>`).join('')}</select></label></div>
  ${anchor?`<div class="mapFocus"><button class="mapCenter primary" data-doc="${anchor.id}">${esc(anchor.title)}</button>
    <div class="mapBranches">${neighbours.length?neighbours.map(l=>{const other=l.a===anchor.id?l.b:l.a;return `<div><span>${esc(l.type)}</span><button data-doc="${other}">${esc(title(other))}</button></div>`;}).join(''):empty('此文献暂无已确认的关系。')}</div></div>`:empty('收入资料后即可建立关系图。')}</section>
  <section class="panel"><h2>按主题浏览</h2><div class="mapgrid">
    ${groups.map(g=>`<section class="mapcard"><h3>${esc(g.tag)}</h3><div class="meta">${g.docs.length} 条资料</div>${g.docs.slice(0,3).map(d=>`<button data-doc="${d.id}">${esc(d.title)}</button>`).join('')}
    ${g.docs.length>3?`<button class="quiet" data-tag="${esc(g.tag)}">查看全部</button>`:''}</section>`).join('')}</div></section>
    <div class="columns"><section class="panel"><h2>已确认的关系</h2>
    ${links.map(l=>`<article class="suggestion"><div class="row">${label(l.type)}<button data-doc="${l.a}">${esc(title(l.a))}</button><button data-doc="${l.b}">${esc(title(l.b))}</button></div><p class="meta">${esc(l.note)}</p></article>`).join('')||empty('打开文献详情，为两篇文献添加关系。')}</section>
    <aside class="panel"><h2>可检查的关联</h2>
    ${suggested.slice(0,7).map(s=>`<article class="suggestion"><h3>${esc(s.a.title)} × ${esc(s.b.title)}</h3><div class="row">${chips(s.shared)}</div>
    <button class="quiet" data-rel="${s.a.id}" data-other="${s.b.id}">确认关系与依据</button></article>`).join('')||empty('给多篇文献加上共同主题后，这里会出现关联建议。')}</aside></div></div>`;
  $('#mapAnchor').onchange=e=>{state.anchor=Number(e.target.value);showMap().catch(error=>toast(error.message,true));};
}
function pdfEvidence(d) {
  const draft=d.pdf_review;
  if(!draft)return '';
  const names={title:'题名',authors:'作者',year:'年份',doi:'DOI',venue:'刊名'};
  const origins=Object.entries(draft.sources).map(([field,value])=>
    `<li><strong>${names[field]||esc(field)}</strong> <span>${esc(value)}</span></li>`).join('');
  return `<div class="pdfEvidence">
    ${draft.warning?`<p class="empty">${esc(draft.warning)}</p>`:''}
    ${origins?`<details class="fieldSources"><summary>查看题录提取依据</summary><ul>${origins}</ul></details>`:''}
    ${draft.sections.map(s=>`<article class="intakeExcerpt">
      <div class="panelhead"><h3>${esc(s.label)}</h3><button type="button" data-pdf="${d.id}" data-page="${s.page}" aria-label="打开 PDF 第 ${s.page} 页">PDF 第 ${s.page} 页</button></div>
      <p class="preserve">${esc(s.text)}</p></article>`).join('')}
    ${!draft.sections.length&&!draft.warning?'<p class="meta">没有找到可直接提取的摘要或研究章节。</p>':''}
    </div>`;
}
function openReview(id) {
  return api(`/api/docs/${id}`).then(d=>{state.doc=d;openEdit(id,true);});
}
function showPdfImport() {
  $('#editContent').innerHTML=`<header class="dialogHead"><div><h2>导入 PDF</h2><p class="meta">选择文件后自动识别，并生成可以修改的核对稿。</p></div>${close('edit')}</header>
    <form class="dialogBody forms" id="pdfImportForm">
    <label class="pdfPicker">选择一个 PDF<input type="file" name="pdf" accept=".pdf,application/pdf" required></label>
    <div class="row"><button type="submit" class="primary">提取文章内容</button><span id="intakeProgress" class="meta" role="status"></span></div>
    <div class="errorText meta" role="status"></div></form>`;
  edit.showModal();
  const form=$('#pdfImportForm');
  const field=form.elements.pdf;
  let uploading=false;
  bind(form,async()=>{
    if(uploading)return;
    const file=field.files[0];
    if(!file?.size)throw Error('请选择 PDF。');
    uploading=true;
    try{
      $('#intakeProgress',form).textContent='正在读取版式、提取正文和匹配主题…';
      field.disabled=true;
      const uploaded=await api('/api/pdf-import?'+new URLSearchParams({name:file.name}),file);
      await refreshDocs();
      if(state.view==='library')showLibrary();
      if(!edit.open || !form.isConnected){
        toast(uploaded.duplicate?'资料已在库中。':'识别已完成，可以在文献库打开。');
        return;
      }
      edit.close();
      if(uploaded.duplicate&&!state.docs.find(d=>d.id===uploaded.id)?.review_pending){
        toast(uploaded.reason==='doi'?'这个 DOI 已有 PDF，已打开已有资料。':'这份 PDF 已在文献库。');
        return await openDetail(uploaded.id);
      }
      if(uploaded.attached)toast('PDF 已附加到已有题录，可以核对并采用提取结果。');
      await openReview(uploaded.id);
    } finally {
      uploading=false;
      field.disabled=false;
      $('#intakeProgress',form).textContent='';
    }
  });
  field.addEventListener('change',()=>{if(field.files.length)form.requestSubmit();});
}
async function openDetail(id,other) {
  const d=await api(`/api/docs/${id}`);
  if(d.review_pending){state.doc=d;openEdit(id,true);return;}
  state.doc=d;
  $('#detailContent').innerHTML=`<header class="dialogHead"><div>${label(d.kind)}<h2>${esc(d.title)}</h2><div class="meta">${meta(d)}</div></div>${close('detail')}</header>
    <div class="dialogBody">
    <section><div class="row"><button data-edit="${d.id}">编辑资料</button>${d.pdf?`<button class="primary" data-pdf="${d.id}">打开 PDF</button><button data-analyze="${d.id}">${d.pdf_review?'核对 PDF 提取结果':'识别 PDF 内容'}</button>`:''}
      ${d.zotero?`<a href="zotero://select/library/items/${d.zotero}">在 Zotero 中打开</a>`:''}
      ${outbound(d.url || (d.doi?'https://doi.org/'+d.doi:''),'来源网站')}
      <button data-markdown="${d.id}">导出 Markdown</button></div>
    <div class="row">${d.primary_tag?`<span class="tag mainTag">主专题 · ${esc(d.primary_tag)}</span>`:''}${chips(tags(d).filter(t=>t!==d.primary_tag))}</div>
    ${glance(d)}${outbound(d.journalEvidence,'查看期刊收录依据')}
    ${d.pdf?`<p class="meta">${d.pdf_pages} 页，${d.text_pages} 页已提取文本。${d.text_pages<d.pdf_pages?' 纯扫描页可阅读和写页码批注，需先 OCR 才能全文检索。':''}</p>`:''}
    <form class="row" id="attach"><label>附加本地 PDF<input type="file" name="pdf" accept=".pdf,application/pdf" required></label><button type="submit">上传并索引</button><span class="errorText meta" role="status"></span></form></section>
    ${d.abstract?`<section><h3>整理摘要</h3><div class="preserve">${esc(d.abstract)}</div>${d.keywords?`<p class="meta">作者关键词 · ${esc(d.keywords)}</p>`:''}</section>`:d.keywords?`<section><h3>作者关键词</h3><p>${esc(d.keywords)}</p></section>`:''}
    <section data-study-summary="${d.id}">${designSummary(d)}</section>
    ${d.pdf_review?.sections.length?`<section><h3>PDF 内容提取</h3>${pdfEvidence(d)}</section>`:''}
    <section><h3>研究笔记</h3>${d.note?`<div class="preserve">${formatNote(d.note)}</div>`:empty('可以在编辑资料时记录研究问题、方法、主要发现及你的判断。')}</section>
    ${d.segments.length?`<section><h3>来源摘述</h3>${d.segments.map(s=>`<p class="meta"><strong>${esc(s.loc)}</strong> · ${esc(s.body)}</p>`).join('')}</section>`:''}
    ${d.marks.length?`<section><h3>PDF 批注</h3>${d.marks.map(m=>`<article class="entry"><button data-pdf="${d.id}" data-page="${m.page}">第 ${m.page} 页 · ${esc(m.style)}</button><p class="preserve">${formatNote(m.note || m.quote)}</p></article>`).join('')}</section>`:''}
    <section id="relations"><h3>研究关系</h3>
      ${d.links.map(l=>`<article class="entry"><div class="row">${label(l.type)}<button data-doc="${l.other}">${esc(l.title)}</button><button class="quiet danger" data-dellink="${l.id}">移除关联</button></div><div class="meta">${esc(l.note)}</div></article>`).join('')}
      <form class="forms" id="linkForm"><div class="formgrid"><label>关联文献<select name="b" required><option value="">请选择</option>${state.docs.filter(x=>x.id!==d.id&&x.kind!=='练习').map(x=>`<option value="${x.id}"${x.id===other?' selected':''}>${esc(x.title)}</option>`).join('')}</select></label>
      <label>关系<select name="type">${options(linkTypes)}</select></label></div>
      <label>依据<input name="note" required placeholder="如 这两篇都讨论算法派单，可比较不同用工场景"></label>
      <div class="row"><button type="submit">保存研究关系</button><span class="errorText meta" role="status"></span></div></form></section>
    <section><button class="quiet danger" data-delete-doc="${d.id}">删除库内条目</button></section></div>`;
  if(!detail.open)detail.showModal();
  if(other)$('#relations').scrollIntoView();
  bind($('#attach'),async form=>{
    const f=formData(form).pdf;
    if(!f.size)throw Error('请选择 PDF。');
    const result=await api(`/api/docs/${d.id}/pdf?`+new URLSearchParams({name:f.name}),f);
    toast(`已收录 ${result.pages} 页，其中 ${result.textPages} 页可全文搜索。`);
    await refreshDocs();
    await openReview(d.id);
  });
  bind($('#linkForm'),async form=>{
    await api(`/api/docs/${d.id}/links`,formData(form));
    toast('研究关系已保存。');
    if(state.view==='map')go('map');
    await openDetail(d.id);
  });
}
function openEdit(id,reviewing=false) {
  const d=id ? state.doc : {};
  const draft=reviewing?d.pdf_review:null;
  const field=name=>esc(d.review_pending ? d[name] : d[name] || draft?.[name] || '');
  const proposed=draft?.suggestions.filter(t=>!tags(d).includes(t.name)) || d.suggestions?.filter(t=>!tags(d).includes(t.name));
  const proposedTags=proposed?.length?`<div class="wide"><p class="meta">可补充的专题</p><div class="row">${proposed.map(s=>
    `<button type="button" data-addtag="${esc(s.name)}" title="${esc(s.matches?.map(m=>m.source+' · '+m.term).join('；') || s.term || '')}">${esc(s.name)}</button>`).join('')}</div></div>`:'';
  $('#editContent').innerHTML=`<header class="dialogHead"><div><h2>${d.review_pending?'核对并归档':reviewing?'核对 PDF 提取结果':id?'编辑资料':'手动添加资料'}</h2>
    ${d.review_pending?'<p class="meta">可以修订题录和摘要，选择一个主专题后确认归档。</p>':''}</div>${close('edit')}</header>
    <form class="dialogBody forms" id="editForm"><div class="formgrid">
    <label class="wide">标题<input name="title" required value="${field('title')}"></label>
    <label>作者或机构<input name="authors" value="${field('authors')}"></label><label>年份<input name="year" inputmode="numeric" value="${field('year')}"></label>
    <label>类型<select name="kind">${options(kinds,d.kind)}</select></label><label>语言<select name="lang">${options(['中文','English','其他'],d.lang)}</select></label>
    <label>DOI<input name="doi" value="${field('doi')}"></label><label>刊名或出版来源<input name="venue" value="${field('venue')}"></label>
    <label>来源网址<input name="url" type="url" value="${esc(d.url)}"></label><label>证据状态<input name="basis" value="${esc(d.basis)}" placeholder="如 题录、摘要、作者稿"></label>
    <label>期刊收录<select name="journalIndex"><option value="">待核验</option>${options(['SCIE','SSCI','SCIE + SSCI','其他'],d.journalIndex)}</select></label>
    <label>收录依据链接<input name="journalEvidence" type="url" value="${esc(d.journalEvidence)}"><small>${outbound('https://mjl.clarivate.com/','在 Clarivate 核验刊名或 ISSN')}</small></label>
    <label>主题标签<input name="tags" value="${esc(d.tags)}" placeholder="如 平台用工,算法管理"><small>可填写多个，用逗号分隔</small></label>
    <label>主专题<select name="primary_tag"></select><small>决定文献的主归档专题</small></label>
    ${proposedTags}
    ${draft?.suggestions.length?`<details class="wide fieldSources"><summary>查看标签建议依据</summary><ul>
      ${draft.suggestions.map(t=>`<li><strong>${esc(t.name)}</strong> <span>${t.matches.map(m=>esc(m.source+' · '+m.term)).join('，')}</span></li>`).join('')}</ul></details>`:''}
    ${id?`<section class="wide intakePanel" data-study-summary="${id}">${designSummary(d)}</section>`:''}
    <label class="wide">整理摘要<textarea name="abstract" placeholder="可修订自动提取的摘要">${field('abstract')}</textarea></label>
    <label class="wide">作者关键词<input name="keywords" value="${field('keywords')}"></label>
    ${draft?`<section class="wide intakePanel"><div class="panelhead"><h3>从原文提取的内容</h3><button type="button" data-pdf="${d.id}">打开原文</button></div>${pdfEvidence(d)}
      ${draft.sections.length?`<button type="button" data-insert-extract>复制原文摘录到研究笔记</button>`:''}</section>`:''}
    <label class="wide">研究笔记<textarea name="note" placeholder="研究问题、方法、证据、作者主张和你的判断">${esc(d.note)}</textarea></label>
    <div class="wide"><button type="button" data-note-template>插入精读提纲</button></div>
    </div><div class="row intakeActions"><button class="primary" type="submit">${d.review_pending?'确认归档':'保存资料'}</button>${d.review_pending?`<button type="submit" name="keepDraft">保存待核对</button><button type="button" class="quiet danger" data-discard-draft="${d.id}">删除待核对稿</button>`:''}<span class="errorText meta" role="status"></span></div></form>`;
  if(!edit.open)edit.showModal();
  const form=$('#editForm'),tagField=form.elements.tags,primary=form.elements.primary_tag;
  function renderPrimary(current){
    const labels=tags({tags:tagField.value.replaceAll('，',',').split(',').map(t=>t.trim()).filter(Boolean).join(',')});
    primary.innerHTML='<option value="">未归类</option>'+options([...new Set(labels)],current);
    primary.value=labels.includes(current)?current:'';
  }
  renderPrimary(d.primary_tag||'');
  tagField.addEventListener('input',()=>renderPrimary(primary.value));
  bind(form,async(form,button)=>{
    const record=formData(form);
    if(record.journalIndex&&!record.journalEvidence)throw Error('请填写期刊收录的核验链接。');
    if(d.zotero)record.zotero=d.zotero;
    const keep=button?.name==='keepDraft';
    if(d.review_pending&&!keep)record.confirmReview=true;
    const result=await api(id?`/api/docs/${id}`:'/api/docs',record);
    edit.close();
    toast(keep?'已保存，在「待核对」中可以继续。':result.duplicate?'该条目已在库中。':d.review_pending?'PDF 已确认归档。':'资料已保存。');
    await refreshDocs();
    if(record.confirmReview){state.zone=record.primary_tag?'':'unfiled';state.tag=record.primary_tag;state.q='';state.kind='';state.primaryOnly=false;}
    if(state.view==='library')showLibrary();
    if(!keep)await openDetail(result.id);
  });
  return d;
}
function showImport() {
  $('#editContent').innerHTML=`<header class="dialogHead"><h2>从 Zotero 导入题录</h2>${close('edit')}</header>
    <div class="dialogBody forms"><p class="meta">在 Zotero 导出 CSL JSON，再在这里选择文件。可以从文献详情附加 PDF。</p>
    <form class="forms" id="zoteroForm"><label>CSL JSON 文件<input name="jsonFile" type="file" accept=".json" required></label>
    <div class="row"><button type="submit">导入文件</button><span class="errorText meta" role="status"></span></div></form><div class="meta" id="importStatus" role="status"></div></div>`;
  edit.showModal();
  const done=async result=>{
    $('#importStatus').textContent=`新增 ${result.added} 条，既有 ${result.duplicate} 条，略过 ${result.skipped} 条。`;
    await refreshDocs();
    if(state.view==='library')showLibrary();
  };
  bind($('#zoteroForm'),async form=>done(await api('/api/zotero/import',JSON.parse(await formData(form).jsonFile.text()))));
}
function showBackup(){
  $('#editContent').innerHTML=`<header class="dialogHead"><h2>备份与迁移</h2>${close('edit')}</header>
    <div class="dialogBody forms"><p class="meta">备份包含 PDF、题录、笔记、批注、专题和文献关系。备份文件请保存在自己信任的位置。</p>
    <div><button data-backupexport>导出当前知识库</button></div>
    <form class="forms" id="backupForm"><label>备份文件<input type="file" name="backup" accept=".json,application/json" required></label>
    <div class="row"><button class="primary" type="submit">合并导入</button><button type="submit" name="replace">替换恢复</button><span class="errorText meta" role="status"></span></div></form></div>`;
  edit.showModal();
  bind($('#backupForm'),async(form,button)=>{
    const merge=button?.name!=='replace';
    if(!merge&&!window.confirm('替换恢复会覆盖此浏览器里的知识库。继续吗？'))return;
    const result=await restoreBackup(formData(form).backup,{merge});
    edit.close();await refreshDocs();await refreshInbox();
    state.tag='';state.zone='';state.kind='';state.q='';go('library');
    toast(merge?`已合并。新增 ${result.added} 篇文献、${result.marks} 条批注，匹配 ${result.duplicates} 篇既有文献。${result.conflicts?' '+result.conflicts+' 篇有不同 PDF 版本，保留当前版本及其批注。':''}`:'已恢复备份。');
  });
}

let pdfSession;
let pdfGeneration=0;
async function openPdf(id,page=1) {
  const gen=++pdfGeneration;
  const d=await api(`/api/docs/${id}`);
  if(!d.pdf)throw Error('该条目还没有 PDF。');
  if(gen!==pdfGeneration)return;
  $('#readerContent').innerHTML=`<header class="dialogHead"><div><h2>${esc(d.title)}</h2><div class="meta">PDF 页码</div></div>${close('reader')}</header>
    <div class="readerTools"><button data-pdfstep="-1">上一页</button><input id="pdfNumber" aria-label="页码" type="number" min="1" max="${d.pdf_pages}" value="${page}">
    <span class="meta">/ ${d.pdf_pages}</span><button data-pdfstep="1">下一页</button><button data-zoom="-0.2">缩小</button><button data-zoom="0.2">放大</button>
    <button data-downloadpdf="${id}">下载原 PDF</button></div>
    <div class="readerGrid"><div class="pdfScroll" id="pdfScroll"><p class="meta">正在加载 PDF…</p></div><aside class="readerAside">
    <h3>本页批注</h3><form class="forms" id="markForm"><p class="hint">选中正文后点击标记。也可直接记录页码批注。</p>
    <div class="row"><button type="submit" name="高亮">高亮</button><button type="submit" name="下划线">下划线</button></div>
    <label>批注内容<textarea name="note" placeholder="输入你的阅读笔记"></textarea></label>
    <div class="row"><button type="button" id="boldNote" aria-label="加粗批注文字"><strong>B</strong> 加粗</button><button class="primary" type="submit" name="批注">保存批注</button></div>
    <div class="errorText meta" role="status"></div></form><div id="marks"></div></aside></div>`;
  if(!reader.open)reader.showModal();
  const session={d,page:Math.max(1,Math.min(Number(page),d.pdf_pages)),zoom:1,selection:null,pdf:null,busy:0,gen};
  pdfSession=session;
  $('#pdfNumber').onchange=e=>setPage(Number(e.target.value));
  $('#boldNote').onclick=()=>{
    const note=$('#markForm textarea');
    const start=note.selectionStart,end=note.selectionEnd;
    note.setRangeText('**'+note.value.slice(start,end)+'**',start,end,'end');
    if(start===end)note.setSelectionRange(start+2,start+2);
    note.focus();
  };
  bind($('#markForm'),async(form,button)=>{
    const style=button?.name || '批注';
    const selection=session.selection || {};
    const note=formData(form).note;
    if(style!=='批注'&&!selection.quote)throw Error('请先在本页选中文字。');
    await api(`/api/docs/${id}/marks`,{page:session.page,style,note,...selection});
    if(pdfSession!==session)return;
    session.d=await api(`/api/docs/${id}`);
    session.selection=null;
    window.getSelection()?.removeAllRanges();
    form.reset();
    renderMarks(session);
  });
  try {
    const pdfjs=await import('./vendor/pdfjs/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc=asset('./vendor/pdfjs/build/pdf.worker.mjs');
    const blob=await getPdf(id);
    if(pdfSession!==session)return;
    const task=pdfjs.getDocument({data:new Uint8Array(await blob.arrayBuffer()),cMapUrl:asset('./vendor/pdfjs/cmaps/'),cMapPacked:true,standardFontDataUrl:asset('./vendor/pdfjs/standard_fonts/')});
    session.task=task;
    session.pdf=await task.promise;
    if(pdfSession!==session)return await task.destroy();
    session.TextLayer=pdfjs.TextLayer;
    await renderPdf(session);
  } catch (e) { if(pdfSession===session)$('#pdfScroll').textContent='PDF 无法显示。'+e.message; }
}
async function setPage(p) {
  if(!pdfSession?.pdf)return;
  pdfSession.page=Math.max(1,Math.min(pdfSession.d.pdf_pages,p||1));
  await renderPdf(pdfSession);
}
async function renderPdf(session) {
  const scroll=$('#pdfScroll');
  if(!scroll||pdfSession!==session)return;
  const turn=++session.busy;
  session.selection=null;
  const p=await session.pdf.getPage(session.page);
  if(turn!==session.busy||pdfSession!==session)return;
  const native=p.getViewport({scale:1});
  const scale=Math.min(1.35,Math.max(.38,(scroll.clientWidth-38)/native.width))*session.zoom;
  const viewport=p.getViewport({scale});
  const display=document.createElement('div');
  display.className='pdfPage';
  display.style.width=viewport.width+'px';
  display.style.height=viewport.height+'px';
  display.style.setProperty('--scale-factor',scale);
  display.innerHTML='<canvas></canvas><div class="pdfMarks"></div><div class="textLayer"></div>';
  const canvas=$('canvas',display), layer=$('.textLayer',display);
  const ratio=Math.min(window.devicePixelRatio||1,2);
  canvas.width=Math.ceil(viewport.width*ratio);
  canvas.height=Math.ceil(viewport.height*ratio);
  canvas.style.width=viewport.width+'px';
  canvas.style.height=viewport.height+'px';
  scroll.replaceChildren(display);
  scroll.scrollTop=0;
  $('#pdfNumber').value=session.page;
  const textLayer=new session.TextLayer({textContentSource:p.streamTextContent(),container:layer,viewport});
  await Promise.all([textLayer.render(),p.render({canvasContext:canvas.getContext('2d'),viewport,transform:ratio===1?null:[ratio,0,0,ratio,0,0]}).promise]);
  if(pdfSession===session&&turn===session.busy)renderMarks(session);
}
function renderMarks(session) {
  const marks=session.d.marks.filter(m=>m.page===session.page);
  const overlay=$('.pdfMarks',reader);
  if(overlay)overlay.innerHTML=marks.filter(m=>m.style!=='批注').flatMap(m=>m.rects.map(([x,y,w,h])=>`<i class="${m.style==='下划线'?'underline':''}" style="left:${x*100}%;top:${y*100}%;width:${w*100}%;height:${h*100}%"></i>`)).join('');
  $('#marks').innerHTML=marks.map(m=>`<article class="entry"><div class="entryline"><span class="tag">${esc(m.style)}</span><button class="quiet danger" data-delmark="${m.id}" aria-label="删除批注">删除</button></div>
    ${m.quote?`<p class="meta">“${esc(m.quote)}”</p>`:''}${m.note?`<p class="preserve">${formatNote(m.note)}</p>`:''}</article>`).join('')||empty('本页暂无批注。');
}
document.addEventListener('selectionchange',()=>{
  const s=pdfSession,selection=window.getSelection();
  if(!s||!selection?.rangeCount||!selection.toString().trim())return;
  const layer=$('.textLayer',reader);
  if(!layer?.contains(selection.anchorNode)||!layer.contains(selection.focusNode))return;
  const page=layer.getBoundingClientRect();
  const fit=value=>Math.max(0,Math.min(1,value));
  const rects=[...selection.getRangeAt(0).getClientRects()]
    .filter(r=>r.width>0.5&&r.height>0.5)
    .map(r=>[fit((r.left-page.left)/page.width),fit((r.top-page.top)/page.height),fit(r.width/page.width),fit(r.height/page.height)]);
  s.selection={quote:selection.toString().trim(),rects};
});
reader.addEventListener('close',()=>{
  const last=pdfSession;
  pdfSession=null;
  pdfGeneration++;
  if(last?.task)last.task.destroy().catch(()=>{});
  if(detail.open&&state.doc?.id===last?.d.id)openDetail(last.d.id).catch(e=>toast(e.message,true));
});

document.addEventListener('click',async e=>{
  const target=e.target.closest('button');
  if(!target)return;
  const d=target.dataset;
  try{
    if(d.view)return go(d.view);
    if(d.close)return document.getElementById(d.close).close();
    if(d.tag || d.zone!==undefined){
      state.zone=d.zone||'';state.tag=d.tag||'';state.q='';state.kind='';state.primaryOnly=false;return go('library');
    }
    if(d.preset){
      const t=state.topics.find(t=>t.name===d.preset);
      state.terms={zh:t.zh,en:t.en,kind:''};return showDiscovery();
    }
    if(d.askpreset){state.question=d.askpreset;go('ask');return $('#askForm').requestSubmit();}
    if(d.doc)return await openDetail(Number(d.doc));
    if(d.study)return await openStudy(Number(d.study));
    if(d.rel)return await openDetail(Number(d.rel),Number(d.other));
    if(d.pdfimport!==undefined)return showPdfImport();
    if(d.analyze){
      target.disabled=true;
      if(!state.doc.pdf_review){
        const before=target.textContent;
        target.textContent='正在识别 PDF…';
        try{await api(`/api/docs/${d.analyze}/analyze`,{});}
        finally{target.textContent=before;}
      }
      return await openReview(Number(d.analyze));
    }
    if(d.discardDraft&&window.confirm('删除此待核对稿及其 PDF？')){
      await api('/api/docs/'+d.discardDraft,undefined,'DELETE');
      edit.close();
      await refreshDocs();
      go('library');
      return toast('已删除待核对稿。');
    }
    if(d.deleteDoc&&window.confirm('删除此条目、附件、批注及其研究关系？')){
      await api('/api/docs/'+d.deleteDoc,undefined,'DELETE');
      detail.close();
      await refreshDocs();
      go(state.view);
      return toast('已删除库内条目。');
    }
    if(d.edit)return openEdit(Number(d.edit));
    if(d.addtag){
      const input=$('#editForm [name=tags]');
      const list=new Set(input.value.split(/[,，]/).map(x=>x.trim()).filter(Boolean));
      list.add(d.addtag);input.value=[...list].join(',');
      input.dispatchEvent(new Event('input'));
      return;
    }
    if(d.insertExtract!==undefined){
      const input=$('#editForm [name=note]');
      const excerpts=state.doc?.pdf_review?.sections || [];
      const addition=excerpts.map(s=>`## ${s.label}（PDF 第 ${s.page} 页）\n\n${s.text}`).join('\n\n');
      if(addition&&!input.value.includes(addition))input.value+=(input.value.trim()?'\n\n':'')+addition;
      return input.focus();
    }
    if(d.noteTemplate!==undefined){
      const input=$('#editForm [name=note]');
      input.value+=(input.value.trim()?'\n\n':'')+'## 研究问题\n\n## 地区、时期与对象\n\n## 方法与数据\n\n## 主要发现与证据页码\n\n## 局限与个人判断\n\n## 可关联的文献与理由\n';
      return input.focus();
    }
    if(d.new!==undefined)return openEdit();
    if(d.import!==undefined)return showImport();
    if(d.backup!==undefined)return showBackup();
    if(d.backupexport!==undefined){
      target.disabled=true;
      return download(await exportBackup(),'劳动关系知识库备份-'+new Date().toISOString().slice(0,10)+'.json');
    }
    if(d.markdown)return download(await entryMarkdown(Number(d.markdown)),`literature-${d.markdown}.md`);
    if(d.downloadpdf)return download(await getPdf(Number(d.downloadpdf)),`literature-${d.downloadpdf}.pdf`);
    if(d.pdf)return await openPdf(Number(d.pdf),Number(d.page || 1));
    if(d.pdfstep&&pdfSession)return await setPage(pdfSession.page+Number(d.pdfstep));
    if(d.zoom&&pdfSession?.pdf){
      pdfSession.zoom=Math.max(.5,Math.min(2.7,pdfSession.zoom+Number(d.zoom)));
      return await renderPdf(pdfSession);
    }
    if(d.dellink){
      await api('/api/links/'+d.dellink,undefined,'DELETE');
      if(state.view==='map')go('map');
      return await openDetail(state.doc.id);
    }
    if(d.delmark&&pdfSession){
      const session=pdfSession;
      await api('/api/marks/'+d.delmark,undefined,'DELETE');
      session.d=await api('/api/docs/'+session.d.id);
      if(pdfSession===session)renderMarks(session);
      return;
    }
    if(d.savefound!==undefined){
      target.disabled=true;
      const item=d.inboxid?state.inbox.items[Number(d.savefound)].item:state.discovery.results[Number(d.savefound)];
      const result=await api('/api/docs',item);
      if(d.inboxid){await api('/api/inbox/'+d.inboxid,{});go('inbox');}
      await refreshDocs();
      toast(result.duplicate?'该条目已在库中。':'已收入文献库。');
      return await openDetail(result.id);
    }
    if(d.scan){
      target.disabled=true;await api('/api/watches/'+d.scan,{});
      toast('本轮扫描完成。');return go('inbox');
    }
    if(d.unwatch&&window.confirm('取消此订阅，并清理其未入库的结果？')){
      await api('/api/watches/'+d.unwatch,undefined,'DELETE');return go('inbox');
    }
    if(d.dismiss){await api('/api/inbox/'+d.dismiss,{});return go('inbox');}
  }catch(error){toast(error.message,true);}
  finally{target.disabled=false;}
});

(async()=>{
  try{
    const [status]=await Promise.all([api('/api/status'),refreshDocs()]);
    state.topics=status.topics;
    updateEngine(status);
    go(location.hash==='#research-designs'?'studies':'library');
    refreshInbox().catch(()=>{});
    const refresh=()=>checkWatches().then(refreshInbox).catch(()=>{});
    refresh();
    setInterval(refresh,120000);
  }catch(error){view.innerHTML=empty(error.message);}
})();
