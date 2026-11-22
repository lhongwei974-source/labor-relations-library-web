export const designFields=[
  {key:'x',label:'X · 核心解释变量',placeholder:'如 ESG 表现'},
  {key:'xMeasure',label:'X 的指标或计算口径',placeholder:'如 华证 ESG 评级转换为 1–9 分'},
  {key:'y',label:'Y · 被解释变量',placeholder:'如 企业绩效'},
  {key:'yMeasure',label:'Y 的指标或计算口径',placeholder:'如 ROA = 净利润 / 平均总资产'},
  {key:'model',label:'回归模型',placeholder:'如 企业和年份双向固定效应'},
  {key:'data',label:'数据来源、样本与期间',placeholder:'如 CSMAR，2012–2023 年 A 股公司年数据'}
];

const compact=value=>String(value??'').replace(/\s+/g,' ').trim();
const limit=(value,length)=>compact(value).slice(0,length);
const roleX='核心解释变量|核心自变量|主要解释变量|主要自变量|解释变量|自变量|main independent variables?|key explanatory variables?|explanatory variables?|independent variables?|regressors?';
const roleY='被解释变量|因变量|结果变量|dependent variables?|outcome variables?|response variables?';
const measureX=String.raw`X\s*(?:的)?\s*(?:指标|度量|测量|代理变量)|(?:核心)?(?:解释变量|自变量)(?:的)?(?:指标|度量|代理变量)|X\s+measures?|(?:independent|explanatory) variable measures?`;
const measureY=String.raw`Y\s*(?:的)?\s*(?:指标|度量|测量|代理变量)|(?:被解释变量|因变量)(?:的)?(?:指标|度量|代理变量)|Y\s+measures?|(?:dependent|outcome) variable measures?`;
const modelNames=/双向固定效应|多维固定效应|多期双重差分|交错双重差分|渐进双重差分|双重差分|双重机器学习|断点回归|事件研究法|事件研究模型|固定效应|随机效应|面板回归|最小二乘(?:法)?|二阶段最小二乘(?:法)?|两阶段最小二乘(?:法)?|工具变量法|广义矩估计|分位数回归|合成控制(?:法)?|差分GMM|系统GMM|\b(?:two[- ]way fixed effects?|(?:firm|year|industry|time|entity) fixed effects?|fixed effects?|random effects?|difference[- ]in[- ]differences?|event[- ]study(?: regression| model)?|regression discontinuity(?: design)?|ordinary least squares|two[- ]stage least squares|instrumental variables?|system GMM|quantile regression|Fama[- –]MacBeth(?: regressions?)?|OLS|2SLS|DID|TWFE|GMM|Logit|Probit|Tobit|GARCH|VAR|VECM|ARDL|Poisson)\b/gi;
const dataNames=/\b(?:CSMAR|CNRDS|RESSET|Wind|Compustat|CRSP|WRDS|Refinitiv|Bloomberg|FactSet|EDGAR|FRED|Orbis|DealScan|Nielsen)\b|国泰安|锐思|万得|同花顺|国家统计局|中国工业企业数据库|北京大学数字普惠金融指数|巨潮资讯/i;
const headings=/^(?:(?:第[一二三四五六七八九十\d]+[章节]|\d+(?:\.\d+)*[.)、]?|[一二三四五六七八九十]+[、.])\s*)?(?:数据来源|数据与样本|样本选取(?:与数据来源)?|样本来源|样本构建|变量(?:选择|定义|说明|构造|测度)|研究设计|模型设定|实证策略|data(?: sources?)?|data and sample|sample and data|sample selection|variable definitions?|research design|empirical strategy|model specification)\s*$/i;
const references=/^(?:(?:\d+[.]?)\s+)?(?:参考文献|references|bibliography|literature cited)(?:\s*[:：])?$/i;
const headingMark=/^(?:\d+(?:\.\d+)*[.)、]?\s+|[（(]?[一二三四五六七八九十]+[）)、.]\s*)/u;
const multiRole=new RegExp(`(?:[,，;；]\\s*(?:而|同时|其中|and\\s+)?\\s*(?:${roleY}|${roleX}|控制变量|control variables?)\\b)|(?:[,，;；]\\s*(?:${roleY}|${roleX}|控制变量))`,'i');
const freshField=new RegExp(`^(?:[XY]\\s*[:：=]|[\\p{Script=Han}]{2,16}[:：]|(?:the\\s+)?(?:${roleX}|${roleY})\\b|(?:${measureX}|${measureY}|data sources?|dataset|data and sample|sample|regression model|baseline model|model specification|estimation method|control variables?)\\s*[:：])`,'iu');

function valueText(value){
  const first=compact(value).split(multiRole)[0];
  return limit(first.replace(/^[\s:：=“”"'、]+|[。；;，,:：\s]+$/gu,''),600);
}
function assignments(label,text,symbol=''){
  const start=new RegExp(`^(?:(?:主要|本文(?:的)?|本研究(?:的)?|我们的|the\\s+|our\\s+))?(?:${label}${symbol?'|'+symbol:''})(?:\\s*[（(][^）)]{1,18}[）)])?\\s*(?::|：|=|为|是|选取|采用|包括|设为|\\b(?:is|are|equals?|includes?)\\b)\\s*(.+)`,'i');
  const ordinary=text.match(start)?.[1];
  if(ordinary)return {value:ordinary,score:7};
  const use=new RegExp(`(?:本文|本研究|我们|we\\s+)?\\s*(?:以|将|用|选择|采用|选取|uses?\\s+|employs?\\s+|takes?\\s+)([^，,；;。.!?]{2,125}?)\\s*(?:作为|作?为|\\s+as\\s+(?:our |the )?)(?:${label})(?:[，,。；; .(（]|$)`,'i');
  const phrase=text.match(use)?.[1];
  return phrase?{value:phrase,score:5}:null;
}
function variableParts(value){
  const marker=/(?:[，,]\s*)?(?:以|用|采用|使用)[：:\s]*([^。]{2,220}?)(?:来)?(?:衡量|度量|测量|代理)(?=$|[，,。；;\s])/u;
  const english=/[,;]?\s+(?:is\s+|are\s+)?(?:measured|proxied|defined|calculated)\s+(?:by|using|as|with)\s+(.+)$/i;
  const match=value.match(marker)||value.match(english);
  if(!match){
    const alias=/\s*[（(]\s*(ROA|ROE|Tobin['’]s Q|NIM|NPL|BHAR|EPS|VaR|CVaR|TFP|CFO)\s*[）)]\.?\s*$/i.exec(value);
    return alias?{name:valueText(value.slice(0,alias.index)),measure:alias[1]}:{name:valueText(value)};
  }
  const name=valueText(value.slice(0,match.index).replace(/[，,\s]+$/u,''));
  return {name,measure:valueText(match[1])};
}
function acceptable(value){
  return !!value&&value.length>=2&&/[\p{L}\p{N}]/u.test(value)&&!/^(?:见表\s*\d*|详见|如下|如式|如下表|see table|listed|defined (?:below|as follows)|described below|not available|待填(?:写)?)/i.test(value);
}

export function identifyDesign(pages=[]){
  const selected={};
  let active='';
  const add=(key,provided,page,quote,score)=>{
    const value=valueText(provided);
    if(!acceptable(value)||selected[key]?.score>=score)return;
    selected[key]={value,page,quote:limit(quote,420),score};
  };
  for(const [pageIndex,raw] of pages.entries()){
    const page=pageIndex+1;
    const lines=String(raw||'').split(/\r?\n/).map(compact).filter(Boolean);
    for(let i=0;i<lines.length;i++){
      const line=lines[i].replace(headingMark,'');
      if(references.test(line))return result();
      if(headings.test(line)){active=line;continue;}
      // Only use the next line to complete an explicit label or a wrapped sentence.
      const next=lines[i+1]?.replace(headingMark,'')||'';
      let candidate=line;
      if(next&&!headings.test(next)&&!references.test(next)&&!/[。；;.!?]$/.test(line)&&
        (!/(?:[:：=]|为|是)$/.test(line)?line.length>45&&next.length>16:true)&&
        !freshField.test(next)){
        candidate=(line+(/\p{Script=Han}$/u.test(line)&&/^\p{Script=Han}/u.test(next)?'':' ')+next).slice(0,560);
      }
      const clauses=candidate.split(/[。；;]|(?<=[a-z)])\.[ \t]+(?=[A-Z])/u).filter(Boolean);
      for(const clause of clauses){
        const text=clause.trim();
        if(!text||text.length>560||/作者(?:指出|认为)|已有研究|文献综述|previous studies|prior research/i.test(text)&&!/^(?:X|Y)[:：]/i.test(text))continue;
        const xMeasure=assignments(measureX,text);
        const yMeasure=assignments(measureY,text);
        if(xMeasure)add('xMeasure',xMeasure.value,page,text,8);
        if(yMeasure)add('yMeasure',yMeasure.value,page,text,8);
        for(const [key,role,symbol] of [['x',roleX,'X'],['y',roleY,'Y']]){
          const found=assignments(role,text,symbol);
          if(!found)continue;
          const {name,measure}=variableParts(found.value);
          add(key,name,page,text,found.score);
          if(measure)add(key+'Measure',measure,page,text,6);
        }
        const model=/^(?:回归模型|计量模型|基准模型|模型设定|估计方法|模型|regression model|baseline model|model specification|estimation method|model)\s*[:：=]\s*(.+)/i.exec(text)?.[1];
        if(model)add('model',model,page,text,9);
        else if(/本文|本研究|基准|模型|估计|回归|采用|使用|we\s+(?:estimate|use|fit|employ)|regress|estimat|specification|model/i.test(text)){
          const names=[...text.matchAll(modelNames)].map(x=>x[0]);
          const distinct=[...new Set(names.map(n=>n.trim()))];
          const robustness=/稳健性|作为检验|替换模型|robustness|sensitivity|as an alternative/i.test(text);
          if(distinct.length&&!robustness)add('model',distinct.slice(0,3).join(' / '),page,text,/(?:基准|baseline|实证策略|empirical strategy|模型设定)/i.test(active+' '+text)?6:3);
        }
        const data=/^(?:数据来源|样本来源|数据与样本|样本与数据|数据|data sources?|dataset|data|sample)\s*[:：=]\s*(.+)/i.exec(text)?.[1];
        if(data)add('data',data,page,text,9);
        else if(/数据|样本|data|sample|observations/i.test(text)&&
          (dataNames.test(text)||(/\b(?:19|20)\d{2}\b/u.test(text)&&/选取|筛选|样本|观测|period|cover|sample|observations/i.test(text)))){
          add('data',text,page,text,dataNames.test(text)?6:4);
        }
      }
    }
  }
  return result();
  function result(){
    const explicit=[selected.model,selected.data,selected.xMeasure,selected.yMeasure].some(item=>item?.score>=8);
    if(!selected.x&&!selected.y&&!explicit&&!(selected.model&&selected.data))return null;
    const evidence=Object.fromEntries(Object.entries(selected).map(([key,{value,page,quote}])=>[key,{value,page,quote}]));
    return {name:'',reviewed:false,...Object.fromEntries(Object.entries(evidence).map(([key,e])=>[key,e.value])),evidence};
  }
}

export function normalizeDesigns(values,pages=0){
  if(!Array.isArray(values)||values.length>30)throw Error('每篇文章最多保存 30 组研究设计。');
  return values.filter(v=>v&&typeof v==='object').map(value=>{
    const fields=Object.fromEntries(designFields.map(({key})=>[key,limit(value[key],key==='data'?1200:450)]));
    const evidence={};
    for(const {key} of designFields){
      const e=value.evidence?.[key];
      if(e&&Number.isSafeInteger(e.page)&&e.page>=1&&e.page<=pages&&limit(e.quote,420)){
        evidence[key]={page:e.page,quote:limit(e.quote,420),value:limit(e.value,600)};
      }
    }
    return {name:limit(value.name,120),...fields,reviewed:value.reviewed===true,evidence};
  }).filter(value=>designFields.some(({key})=>value[key]));
}
