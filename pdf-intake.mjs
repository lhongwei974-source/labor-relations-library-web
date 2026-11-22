const squash = text => String(text ?? '').replace(/\s+/g,' ').trim();
const cjk = text => /\p{Script=Han}/u.test(text);
const words = text => squash(text).normalize('NFKC').toLowerCase();
const unspace = text => text.replace(/(?<=[\p{Script=Han}，；。！？：、])[ \t]+(?=[\p{Script=Han}，；。！？：、])/gu,'');

function linesFrom(items) {
  const result=[];
  let line;
  let newLine=false;
  for(const item of items){
    const text=item.str?.trim();
    if (!text) {
      newLine ||= item.hasEOL;
      continue;
    }
    const [,,,,x,y]=item.transform;
    const size=item.height || Math.hypot(item.transform[2],item.transform[3]);
    const superscript=line && !newLine && size<line.size*.78 && y>line.y+2 && y-line.y<line.size*.85 &&
      x>=line.end-4 && x-line.end<16 && /^\d{1,2}$/.test(text);
    if(superscript){
      line.end=x+item.width;
      newLine=!!item.hasEOL;
      continue;
    }
    if (newLine || !line || Math.abs(y-line.y)>Math.max(4,line.size*.28) || x<line.x-3 || x-line.end>75) {
      line={text:'',x,y,size,end:x};
      result.push(line);
    }
    const joiner=line.text && (x-line.end>1.4 || !cjk(line.text.at(-1)+text[0]))?' ':'';
    line.text+=joiner+text;
    line.size=Math.max(line.size,size);
    line.end=x+item.width;
    newLine=!!item.hasEOL;
  }
  return result.map(line=>({...line,text:unspace(squash(line.text))}));
}

function joinLines(list) {
  return unspace(squash(list.join('\n').replace(/([a-z])-\n(?=[a-z])/g,'$1')));
}

export async function readPdf(bytes) {
  if (!new TextDecoder().decode(bytes.subarray(0,1024)).includes('%PDF-')) throw Error('请选择有效的 PDF 文件。');
  const pdfjs=await import('./vendor/pdfjs/build/pdf.mjs');
  const asset=path=>new URL('./vendor/pdfjs/'+path,import.meta.url).href;
  pdfjs.GlobalWorkerOptions.workerSrc=asset('build/pdf.worker.mjs');
  const task=pdfjs.getDocument({
    data:new Uint8Array(bytes),useSystemFonts:false,disableFontFace:true,
    cMapUrl:asset('cmaps/'),cMapPacked:true,
    standardFontDataUrl:asset('standard_fonts/')
  });
  try {
    const pdf=await task.promise;
    const {info,metadata}=await pdf.getMetadata().catch(()=>({}));
    const pages=[];
    const layouts=[];
    for(let n=1;n<=pdf.numPages;n++){
      const page=await pdf.getPage(n);
      const lines=linesFrom((await page.getTextContent()).items);
      pages.push(lines.map(l=>l.text).join('\n'));
      layouts.push({lines,height:page.getViewport({scale:1}).height});
      page.cleanup();
    }
    return {pages,layouts,info:info||{},xmp:metadata?.getAll()||{}};
  } catch(error) {
    throw Error('PDF 无法解析。若文档受密码保护，请先在授权范围内解除保护。 '+error.message);
  } finally { await task.destroy(); }
}

const abstractHead=/^(?:\[\s*摘\s*要\s*\]|【\s*摘\s*要\s*】|摘\s*要|abstract\b)\s*[:：.]?\s*/i;
const keywordHead=/^(?:\[\s*关键词\s*\]|【\s*关键词\s*】|关\s*键\s*词|key\s*words?\b)\s*[:：.]?\s*/i;
const intro=/^(?:(?:[一1][、.．]\s*)?(?:引言|前言|绪论)|(?:1[.\s]+)?introduction)\s*[:：.]?\s*$/i;
const boundary=/^(?:\s*中图分类号|文献标识码|分类号|文章编号|基金项目|作者简介|收稿日期|参考文献\s*$|references\s*$|contents\s*$|https?:\/\/|review in advance|©|copyright\b)/i;
const headings=[
  {label:'研究方法',pattern:/^(?:研究(?:方法|设计|对象|样本)|数据(?:与方法|来源)|方法(?:与数据)?|method(?:s|ology)?|research design|data (?:and methods|sources|collection))(?:\s*[:：]|\s*$)/i},
  {label:'主要发现',pattern:/^(?:研究(?:发现|结果)|主要发现|实证(?:结果|分析)|结果|(?:main\s+|empirical\s+)?(?:results|findings))(?:\s*[:：]|\s*$)/i},
  {label:'结论与讨论',pattern:/^(?:主要结论|结论(?:与(?:讨论|建议|政策启示))?|讨论(?:与结论)?|conclusions?(?:\s+and\s+discussion)?|discussion)(?:\s*[:：]|\s*$)/i}
];
const stripNumber=text=>text.replace(/^\s*(?:(?:[一二三四五六七八九十]+[、．.]|[（(][一二三四五六七八九十\d]+[）)]|\d+(?:\.\d+)*[.)、．]?\s+)\s*)/u,'');
const titleNoise=/^(?:download(?:ed)?\b|open access\b|original (?:article|research)\b|research article\b|review article\b|abstract\b|keywords?\b|doi\b|(?:https?:\/\/|www\.)|(?:摘\s*要|关键词|研究论文)(?:[:： ]|$))|[�]|Copyright|ISSN|\.(?:pdf|cls)$/i;
const isTitle=text=>text.length>=4 && text.length<=250 && !titleNoise.test(text) && /\p{L}/u.test(text);

function visualTitle(layout) {
  if(!layout)return null;
  const {lines,height}=layout;
  const stop=lines.findIndex(l=>abstractHead.test(l.text)||keywordHead.test(l.text));
  const eligible=lines.slice(0,stop<0?45:stop).map((line,i)=>({...line,i}))
    .filter(l=>l.y>=height*.27 && l.y<=height*.965 && isTitle(l.text));
  if(!eligible.length)return null;
  const lead=eligible.reduce((a,b)=>b.size>a.size?b:a);
  const picked=[lead];
  for(const direction of [-1,1]){
    let last=lead;
    for(let i=lead.i+direction;i>=0 && i<lines.length && picked.length<5;i+=direction){
      const other=lines[i];
      if(!isTitle(other.text) || Math.abs(other.size-lead.size)>lead.size*.21 ||
          Math.abs(other.y-last.y)>lead.size*2.25 || Math.abs(other.x-lead.x)>130 || other.y<height*.22)break;
      picked.push({...other,i});
      last=other;
    }
  }
  picked.sort((a,b)=>a.i-b.i);
  const text=joinLines(picked.map(x=>x.text));
  if(!isTitle(text))return null;
  return {text,end:picked.at(-1).i,start:picked[0].i};
}

function readSection(layouts,re,cap=1400,scan=2) {
  for(const [p,layout] of layouts.slice(0,scan).entries()){
    for(const [i,line] of layout.lines.entries()){
      if(!re.test(line.text))continue;
      const parts=[line.text.replace(re,'')].filter(Boolean);
      for(const next of layout.lines.slice(i+1,i+18)){
        if(abstractHead.test(next.text)||keywordHead.test(next.text)||intro.test(next.text)||boundary.test(next.text)||
            headings.some(h=>h.pattern.test(stripNumber(next.text))) ||
            Math.abs(next.x-line.x)>Math.max(50,layout.height*.11) || next.y<layout.height*.11 ||
            (cjk(line.text) && /^(?:abstract|key\s*words?)\b/i.test(next.text)) ||
            (re===keywordHead && (parts.length>=4 || /^\d+$/.test(next.text)))) break;
        parts.push(next.text);
      }
      const text=joinLines(parts).slice(0,cap);
      if(text.length>=(re===keywordHead?2:20))return {text,page:p+1};
    }
  }
}

function researchSections(layouts) {
  const sections=[];
  for(const [p,layout] of layouts.entries()){
    if(layout.lines.some(l=>/^(?:参考文献|references|literature cited|bibliography)\s*$/i.test(stripNumber(l.text))))break;
    for(const [i,line] of layout.lines.entries()){
      const text=stripNumber(line.text);
      const heading=headings.find(h=>h.pattern.test(text) && !sections.some(s=>s.label===h.label));
      if(!heading || layout.lines[i+1]?.text.match(/^\.{3,}|^\d+$/))continue;
      const inline=text.replace(heading.pattern,'').trim();
      const parts=inline?[inline]:[];
      for(const next of layout.lines.slice(i+1,i+13)){
        const nextText=stripNumber(next.text);
        if(boundary.test(nextText)||headings.some(h=>h.pattern.test(nextText)) ||
            Math.abs(next.x-line.x)>Math.max(70,layout.height*.10) || next.y>line.y+8)break;
        if(!/\p{L}/u.test(next.text))break;
        parts.push(next.text);
        if(parts.join('').length>360)break;
      }
      const excerpt=joinLines(parts);
      if(excerpt.length>=37)sections.push({label:heading.label,page:p+1,text:excerpt.length>420?excerpt.slice(0,420)+'…':excerpt});
    }
    if(sections.length>=headings.length)break;
  }
  return sections;
}

const qualifiers = text=>text.replace(/^作者\s*[:：]\s*/u,'').replace(/[①②③④⑤⑥⑦⑧⑨⑩*†‡]/g,'').trim();
const authorLine = text => {
  const value=qualifiers(text);
  if (value.length<2 || value.length>160 || /[@\d/()（）]|\b(?:department|university|college|review|journal|institute|abstract|copyright|press)\b|大学|学院|研究院|作者简介|编辑|作者单位/i.test(value))return '';
  if(cjk(value)){
    const people=value.split(/\s+|[,，、；;和与]/).filter(Boolean);
    return people.length>0 && people.length<=10&&people.every(x=>/^[\p{Script=Han}·]{2,5}$/u.test(x))?people.join('；'):'';
  }
  const people=value.split(/\s+and\s+|[,;&]+/i).map(x=>x.trim()).filter(Boolean);
  return people.length && people.length<=8 && people.every(x=>/^(?:[\p{Lu}][\p{L}.’'’-]* )(?:[\p{L}.’'’-]+ )*[\p{Lu}][\p{L}.’'’-]*$/u.test(x))?people.join('; '):'';
};
const pickYear = value => String(value||'').match(/\b(?:19|20)\d{2}\b/)?.[0]||'';
function exactMatch(text,term){
  if(cjk(term))return text.includes(term);
  const literal=term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return new RegExp('(?:^|[^a-z])'+literal+'(?:$|[^a-z])','i').test(text);
}
function rankTopics(topics,{title='',abstract,keywords,pages=[]}) {
  const focus=[{text:title,page:1,source:'题名',weight:8},{text:keywords?.text,page:keywords?.page,source:'关键词',weight:7},
    {text:abstract?.text,page:abstract?.page,source:'摘要',weight:4},...pages.slice(0,8).map((text,i)=>({text,page:i+1,source:'正文',weight:1}))];
  for(const field of focus)field.text=words(field.text);
  return topics.map(topic=>{
    const terms=[...new Set([topic.name,...topic.terms].map(words))];
    const matched=terms.flatMap(term=>{
      const hit=focus.find(field=>exactMatch(field.text,term));
      return hit?[{...hit,text:undefined,term}]:[];
    }).sort((a,b)=>b.weight-a.weight);
    const score=matched.reduce((sum,m,i)=>sum+(i<3?m.weight:m.weight*.25),0);
    return {name:topic.name,score,matches:matched.slice(0,3)};
  }).filter(t=>t.score>=4).sort((a,b)=>b.score-a.score).slice(0,5);
}

export function describePdf(result,filename,topics) {
  const {pages,layouts,info,xmp}=result;
  const name=String(filename||'').split(/[\\/]/).at(-1).replace(/\.pdf$/i,'').trim() || '未命名 PDF';
  const titleBlock=visualTitle(layouts[0]);
  const first=layouts[0]?.lines || [];
  const header=(pages[0]||'').split(/\n(?:abstract\b|摘\s*要|关键词)/i)[0];
  const bilingual=layouts.slice(0,2);
  const abstract=readSection(bilingual,abstractHead);
  const keywords=readSection(bilingual,keywordHead,280);
  const textPages=pages.filter(p=>p.length>0).length;
  const sources={};
  const use=(field,value,source)=>{if(value)sources[field]=source;return value;};
  const metadataTitle=squash(xmp['dc:title']||info.Title);
  const visual=titleBlock?.text;
  const useMetadata=isTitle(metadataTitle)&&!/^microsoft|^untitled|^arxiv:|^pdf\b/i.test(metadataTitle) &&
    (!visual || words(visual).includes(words(metadataTitle)) || words(metadataTitle).includes(words(visual)) || words(pages[0]||'').includes(words(metadataTitle)));
  const title=use('title',useMetadata?metadataTitle:visual||name,useMetadata?'PDF 元数据':visual?'PDF 第 1 页版式':'文件名，待核对');
  const metaAuthors=(Array.isArray(xmp['dc:creator'])?xmp['dc:creator'].filter(Boolean).join('; '):xmp['dc:creator'])||info.Author;
  const authors=squash(metaAuthors);
  const metadataName=authors && !/^(?:user|admin(?:istrator)?|author|unknown|anonymous|unauthored|none|author name|windows user|microsoft word)$/i.test(authors) && !/[@<>]/.test(authors);
  const guessed=titleBlock?first.slice(titleBlock.end+1,titleBlock.end+6).find(l=>authorLine(l.text)):null;
  const author=use('authors',metadataName?authors:guessed?authorLine(guessed.text):'',metadataName?'PDF 元数据，待核对':'PDF 第 1 页署名区，待核对');
  const fixedHeader=header.replace(/(-)\s*\n\s*(?=[\da-z])/ig,'$1');
  const doi=use('doi',(([
    xmp['prism:doi'],xmp['dc:identifier'],fixedHeader.substring(0,2500), (pages[0] || '').slice(0,1800)
  ].filter(Boolean).map(v=>String(v).match(/\b10\.\d{4,9}\/[a-z\d][a-z\d._;()/:-]*/i)?.[0]).find(Boolean))||'')
    .replace(/[.,;)]+$/g,'').toLowerCase(), 'PDF 题录区');
  const venueMeta=squash(xmp['prism:publicationname']||xmp['prism:publicationName']);
  const venueLine=first.find(l=>/^(?:[\p{L}. ]{3,40}\s+)?(?:annual review |journal |review |proceedings |transactions )of\b|^(?:journal|review)\s+for\b/i.test(l.text))?.text;
  const cnVenue=first.find(l=>/^《[^》]{2,40}》|^[\p{Script=Han}]{2,18}(?:学报|研究|评论|论坛|科学)\s*$/u.test(l.text) && l.text!==title)?.text;
  const venue=use('venue',venueMeta||venueLine||cnVenue||'',venueMeta?'PDF 元数据':'PDF 第 1 页刊名候选');
  const yearMeta=pickYear(xmp['prism:publicationdate']||xmp['prism:coverdate']||xmp['dc:date']);
  const yearLine=first.find(l=>/^(?:copyright\b|©)|\b(?:19|20)\d{2}\.\s*\d{1,4}[:：]|(?:19|20)\d{2}\s*年\s*第\s*\d+\s*期|(?:p[úu]blished|publication date|出版年|出版日期)\s*[:： ]/i.test(l.text))?.text;
  const year=use('year',yearMeta||pickYear(yearLine),yearMeta?'PDF 出版元数据':'PDF 第 1 页出版信息');
  const sample=[title,abstract?.text||'',(pages[0]||'').slice(0,500)].join(' ');
  const han=(sample.match(/\p{Script=Han}/gu)||[]).length;
  const latin=(sample.match(/[a-z]/gi)||[]).length;
  const lang=!textPages&&!useMetadata?'其他':han>=8 && han>=latin*.16?'中文':latin>=12?'English':'其他';
  const kind=/^(?:关于.+的通知|.+(?:条例|规定|指引|办法)(?:（.*）|\(.*\))?)$/.test(title)?'政策':'论文';
  const findings=researchSections(layouts);
  const suggestions=rankTopics(topics,{title:!textPages&&!useMetadata?'':title,abstract,keywords,pages});
  return {title,authors:author,year,kind,lang,doi,venue,abstract:abstract?.text||'',keywords:keywords?.text||'',
    sources,sections:[...(abstract?[{label:'原文摘要',...abstract}]:[]),...(keywords?[{label:'原文关键词',...keywords}]:[]),...findings],suggestions,
    warning:textPages===0?'此 PDF 未提取到正文。可先核对题录，或为扫描件做 OCR 后重新导入。':''};
}
