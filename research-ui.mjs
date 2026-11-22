import {designFields} from './research-design.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const valueText=(value,placeholder)=>value?esc(value):`<span class="muted">${placeholder}</span>`;
const textFold=value=>String(value??'').normalize('NFKC').toLowerCase();

function diagram(row){
  return `<div class="design-diagram" aria-label="研究设计示意图">
    <div class="design-flow">
      <div class="design-node"><strong>X · 解释变量</strong><span>${valueText(row.x,'待填写')}</span>${row.xMeasure?`<small>${esc(row.xMeasure)}</small>`:''}</div>
      <div class="design-node model-node"><strong>回归模型</strong><span>${valueText(row.model,'待填写')}</span></div>
      <div class="design-node"><strong>Y · 被解释变量</strong><span>${valueText(row.y,'待填写')}</span>${row.yMeasure?`<small>${esc(row.yMeasure)}</small>`:''}</div>
    </div>
    <div class="design-data"><strong>数据</strong><span>${valueText(row.data,'待填写')}</span></div>
  </div>`;
}
export function designSummary(doc){
  const rows=doc.designs||[];
  const reviewed=rows.filter(r=>r.reviewed).length;
  const caption=rows.length?`<p class="meta">${rows.length} 组研究设计 · ${reviewed} 组已核对</p>`:
    '<p class="meta">填写解释变量、被解释变量、回归模型及数据来源。</p>';
  return `<div class="panelhead"><div><h3>研究设计</h3>${caption}</div>
    <button type="button" data-study="${doc.id}">${rows.length?'核对或编辑':'识别或填写'}</button></div>
    ${rows.length?diagram(rows[0]):''}`;
}

function fieldEvidence(evidence,docId,changed){
  if(!evidence?.page)return '';
  return `<details class="design-evidence"><summary>${changed?'自动候选原文':'核对原文'} · 第 ${evidence.page} 页</summary>
    <blockquote>${esc(evidence.quote)}</blockquote><button type="button" data-pdf="${docId}" data-page="${evidence.page}">打开 PDF 第 ${evidence.page} 页</button></details>`;
}
function rowForm(row,index,docId){
  return `<fieldset class="design-card" data-study-row>
    <legend>第 ${index+1} 组</legend>
    <div class="design-card-tools">
      <label>模型或检验名称<input name="name" maxlength="120" value="${esc(row.name)}" placeholder="如 基准回归、稳健性检验"></label>
      <button type="button" class="quiet danger" data-remove-design aria-label="移除第 ${index+1} 组">移除</button>
    </div>
    <div class="design-field-grid">${designFields.map(f=>`<div class="design-field">
      <label>${f.label}<textarea name="${f.key}" rows="${f.key==='data'?3:2}" maxlength="${f.key==='data'?1200:450}" placeholder="${f.placeholder}">${esc(row[f.key])}</textarea></label>
      ${fieldEvidence(row.evidence?.[f.key],docId,!!row.evidence?.[f.key]?.value&&row.evidence?.[f.key]?.value!==row[f.key])}
      </div>`).join('')}</div>
    <label class="design-review"><input type="checkbox" name="reviewed"${row.reviewed?' checked':''}> 本组已核对</label>
    <details class="design-preview"><summary>查看本组示意图</summary><div data-study-diagram>${diagram(row)}</div></details>
  </fieldset>`;
}

export function mountDesignEditor(dialog,doc,{save,extract,notify}){
  if(dialog.open)dialog.close();
  let rows=doc.designs?.length?structuredClone(doc.designs):[{}];
  let candidate=doc.designCandidate;
  const content=dialog.querySelector('#researchContent');
  content.innerHTML=`<header class="dialogHead"><div><h2>研究设计</h2><p class="meta">${esc(doc.title)}</p></div>
    <button class="quiet" data-close="research" aria-label="关闭">关闭</button></header>
    <form id="studyForm" class="dialogBody forms">
    <div class="design-scroll"><p class="meta">每组对应一种模型或检验。自动识别的字段可修改，缺失字段可以手填。</p>
    <div class="row design-toolbar">${doc.pdf?'<button type="button" data-extract-design>从 PDF 补空白字段</button>':''}
    <button type="button" data-add-design>添加一组</button><span class="meta" id="studyStatus" role="status"></span></div>
    <div id="studyRows" class="stack"></div></div>
    <div class="row intakeActions"><button type="submit" class="primary">保存研究设计</button><span class="errorText meta" role="status"></span></div>
    </form>`;
  const form=content.querySelector('form');
  const place=form.querySelector('#studyRows');
  const status=form.querySelector('#studyStatus');
  const render=()=>{place.innerHTML=rows.map((r,i)=>rowForm(r,i,doc.id)).join('');};
  const read=()=>[...place.querySelectorAll('[data-study-row]')].map((element,index)=>({
    ...rows[index],...Object.fromEntries(['name',...designFields.map(f=>f.key)].map(k=>[k,element.querySelector('[name='+k+']').value.trim()])),
    reviewed:element.querySelector('[name=reviewed]').checked
  }));
  render();
  form.addEventListener('input',e=>{
    const element=e.target.closest('[data-study-row]');
    if(!element||e.target.name==='reviewed')return;
    const index=[...place.children].indexOf(element);
    element.querySelector('[data-study-diagram]').innerHTML=diagram(read()[index]);
  });
  form.addEventListener('click',async e=>{
    const target=e.target.closest('button');
    if(!target)return;
    if(target.matches('[data-add-design]')){
      rows=read();
      if(rows.length>=30){status.textContent='每篇文章最多保存 30 组。';return;}
      rows.push({});render();
      place.lastElementChild.querySelector('input').focus();
    }
    if(target.matches('[data-remove-design]')){
      rows=read();
      const index=[...place.children].indexOf(target.closest('[data-study-row]'));
      rows.splice(index,1);
      if(!rows.length)rows.push({});
      render();
    }
    if(target.matches('[data-extract-design]')){
      target.disabled=true;
      status.textContent='正在检查 PDF 原文…';
      try{
        candidate=candidate||await extract();
        if(!candidate){status.textContent='未找到清楚的变量或模型定义，可以手填。';return;}
        rows=read();
        const first=rows[0];
        const evidence={...first.evidence};
        let filled=0;
        for(const {key} of designFields){
          if(!first[key]&&candidate[key]){
            first[key]=candidate[key];
            evidence[key]=candidate.evidence?.[key];
            filled++;
          }
        }
        first.evidence=evidence;
        if(filled)first.reviewed=false;
        render();
        status.textContent=filled?`已补入 ${filled} 个候选值，请核对原文。`:'第一组的相关字段已有内容。';
      }catch(error){status.textContent=error.message;}
      finally{target.disabled=false;}
    }
  });
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    const button=e.submitter||form.querySelector('[type=submit]');
    button.disabled=true;
    form.querySelector('.errorText').textContent='';
    try{await save(read());dialog.close();notify('研究设计已保存。');}
    catch(error){form.querySelector('.errorText').textContent=error.message;}
    finally{button.disabled=false;}
  });
  dialog.showModal();
}

function csv(rows){
  const heads=['文献','年份','模型或检验名称','X','X 指标','Y','Y 指标','回归模型','数据','核对状态','PDF 依据'];
  const escapeCell=value=>{
    let text=String(value??'');
    if(/^\s*[=+\-@\t\r]/.test(text))text="'"+text;
    return '"'+text.replaceAll('"','""')+'"';
  };
  const lines=rows.map(r=>[r.title,r.year,r.name,r.x,r.xMeasure,r.y,r.yMeasure,r.model,r.data,r.reviewed?'已核对':'待核对',
    designFields.flatMap(f=>r.evidence?.[f.key]?.page?[f.label+' 第 '+r.evidence[f.key].page+' 页']:[]).join('；')]);
  return new Blob(['\uFEFF'+[heads,...lines].map(row=>row.map(escapeCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
}

export function mountComparison(place,{papers,rows},{open,download}){
  const remembered=Object.fromEntries([...place.querySelectorAll('.design-filters input,.design-filters select')].map(e=>[e.name,e.value]));
  const rememberedPaper=place.querySelector('#studyPaper')?.value;
  place.innerHTML=`<header class="viewhead"><div><h1>研究设计对照</h1><p class="subtitle">按论文比较 X、Y、回归模型与数据。每行对应一组设计。</p></div>
    <div class="tools"><button class="primary" type="button" id="exportDesigns">导出当前结果 · CSV</button></div></header>
    <section class="panel comparison-panel"><div class="design-filters">
      <label>文献<input type="search" name="title" placeholder="输入题名"></label>
      <label>X 或指标<input type="search" name="x" placeholder="如 ESG"></label>
      <label>Y 或指标<input type="search" name="y" placeholder="如 ROA"></label>
      <label>回归模型<input type="search" name="model" placeholder="如 固定效应"></label>
      <label>数据<input type="search" name="data" placeholder="如 CSMAR"></label>
      <label>核对状态<select name="review"><option value="">全部</option><option value="yes">已核对</option><option value="no">待核对</option></select></label>
    </div>
    <div class="comparison-top row"><label>整理一篇论文<select id="studyPaper"><option value="">从文献库选择</option>${papers.map(d=>`<option value="${d.id}">${esc(d.title)}${d.review_pending?'（入库待核对）':''}</option>`).join('')}</select></label>
    <button type="button" id="editStudyPaper">打开研究设计</button><p id="studyCount" class="meta" role="status"></p></div>
    <div id="studyTable" class="comparison-results"></div></section>`;
  const filters=place.querySelector('.design-filters');
  const exportButton=place.querySelector('#exportDesigns');
  const selector=place.querySelector('#studyPaper');
  const editButton=place.querySelector('#editStudyPaper');
  if(rememberedPaper)selector.value=rememberedPaper;
  editButton.disabled=!selector.value;
  for(const input of filters.querySelectorAll('input,select')){
    if(input.name in remembered)input.value=remembered[input.name];
  }
  selector.addEventListener('change',()=>{editButton.disabled=!selector.value;});
  editButton.onclick=()=>open(Number(selector.value));
  let visible=[];
  const render=()=>{
    const terms=Object.fromEntries([...filters.querySelectorAll('input,select')].map(e=>[e.name,textFold(e.value).trim()]));
    const match=(search,...texts)=>!search||texts.some(text=>textFold(text).includes(search));
    visible=rows.filter(r=>match(terms.title,r.title)&&match(terms.x,r.x,r.xMeasure)&&match(terms.y,r.y,r.yMeasure)&&
      match(terms.model,r.model,r.name)&&match(terms.data,r.data)&&(!terms.review||r.reviewed===(terms.review==='yes')));
    place.querySelector('#studyCount').textContent=`${visible.length} 组 · ${new Set(visible.map(r=>r.doc)).size} 篇文献`;
    exportButton.disabled=!visible.length;
    const result=place.querySelector('#studyTable');
    if(!visible.length){
      result.innerHTML=`<div class="empty">${rows.length?'当前筛选条件下没有结果。':'导入 PDF 后会加入识别出的待核对设计。也可以从上方选择文章，手动填写。'}</div>`;
      return;
    }
    const cell=(value,measure)=>`<td>${valueText(value,'—')}${measure?`<small class="design-table-measure">${esc(measure)}</small>`:''}</td>`;
    const published=visible.map(r=>`<tr><th scope="row"><button class="quiet design-title" type="button" data-doc="${r.doc}">${esc(r.title)}</button>
      <small>${esc([r.year,r.name||'第 '+(r.index+1)+' 组'].filter(Boolean).join(' · '))}</small></th>
      ${cell(r.x,r.xMeasure)}${cell(r.y,r.yMeasure)}${cell(r.model)}${cell(r.data)}
      <td><span class="design-status ${r.reviewed?'is-reviewed':''}">${r.reviewed?'已核对':'待核对'}</span>
      <button type="button" class="quiet" data-study="${r.doc}">编辑</button></td></tr>`).join('');
    result.innerHTML=`<table class="design-table"><thead><tr><th scope="col">文献</th><th scope="col">X 与指标</th><th scope="col">Y 与指标</th>
      <th scope="col">回归模型</th><th scope="col">数据</th><th scope="col">核对状态</th></tr></thead><tbody>${published}</tbody></table>`;
  };
  filters.addEventListener('input',render);
  filters.querySelector('select').addEventListener('change',render);
  exportButton.onclick=()=>download(csv(visible),'研究设计对照.csv');
  render();
}
