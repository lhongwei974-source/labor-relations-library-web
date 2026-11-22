function decode(value = '') {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#\d{1,7}|#x[0-9a-f]{1,6});/gi, (entity, key) => {
      const base = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[key.toLowerCase()];
      if (base) return base;
      const point = key[1]?.toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
      return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    }).replace(/\s+/g, ' ').trim();
}

async function request(host, path, params, asText = false) {
  const url = new URL(path, host);
  url.search = new URLSearchParams(params);
  const res = await fetch(url, { signal: AbortSignal.timeout(7500), credentials:'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return asText ? res.text() : res.json();
}

function papers(query, lang, booksOnly = false) {
  const fields = 'title,author,published,DOI,URL,type,publisher,container-title,abstract';
  const filters = booksOnly ? {filter:'type:book'} : {};
  return request('https://api.crossref.org', '/works', { 'query.bibliographic': query, rows: '7', select: fields, ...filters })
    .then(data => data.message.items.filter(item => item.title?.[0]).map(item => {
      const title = decode(item.title[0]);
      return {
        title, lang: /\p{Script=Han}/u.test(title) ? '中文' : lang === 'English' ? 'English' : '其他',
        authors: (item.author || []).slice(0, 6).map(a => a.name || [a.given, a.family].filter(Boolean).join(' ')).join('; ') || item.publisher || '',
        year: String(item.published?.['date-parts']?.[0]?.[0] || ''), doi: item.DOI,
        kind: /^(book|monograph)/.test(item.type) ? '著作' : item.type === 'report' ? '报告' : '论文',
        url: item.URL, via: 'Crossref', basis: item.abstract ? '登记摘要' : '题录', excerpt: decode(item.abstract)
      };
    }));
}

function openAlex(query, lang) {
  const filter = 'type:article|review|preprint,language:' + (lang === '中文' ? 'zh' : 'en');
  return request('https://api.openalex.org', '/works', { search:query,filter,per_page:'7',
    select:'id,display_name,doi,publication_year,authorships,primary_location,language' })
    .then(data=>data.results.map(item=>{
      const location=item.primary_location;
      return {title:item.display_name,authors:(item.authorships || []).slice(0,6).map(x=>x.author?.display_name).filter(Boolean).join('; '),
        year:String(item.publication_year || ''), lang,doi:item.doi?.replace(/^https?:\/\/doi\.org\//i,''),
        url:location?.landing_page_url || item.doi || item.id, pdfUrl:location?.is_oa ? location.pdf_url : null,
        kind:'论文',via:'OpenAlex',basis:'题录'};
    }));
}

function books(query, lang) {
  return request('https://openlibrary.org', '/search.json', { q: query, limit: '5', fields: 'key,title,author_name,first_publish_year,language', lang: lang === '中文' ? 'zh' : 'en' })
    .then(data => data.docs.map(item => ({
      title: item.title, authors: (item.author_name || []).join('; '),
      year: String(item.first_publish_year || ''), lang: /\p{Script=Han}/u.test(item.title) ? '中文' : lang === 'English' ? 'English' : '其他',
      url: new URL(item.key, 'https://openlibrary.org').href, kind: '著作', via: 'Open Library', basis: '书目'
    })));
}

function queryWords(query,lang) {
  const segmenter = new Intl.Segmenter(lang==='中文'?'zh':'en',{granularity:'word'});
  return [...segmenter.segment(query.toLowerCase())].map(x=>x.segment)
    .filter(t=>t.length>1&&!/^(of|the|and|for|in|to|with)$/.test(t));
}

function rss(xml,lang,via,query='') {
      if (!/<rss\b/i.test(xml)) throw new Error('RSS 格式异常');
      const terms = queryWords(query,lang);
      return Array.from(xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)).map(([, item]) => {
        const read = name => decode(item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'))?.[1]);
        const date = new Date(read('pubDate'));
        const title=read('title'), description=read('description');
        return { title, authors: read('source') || (via==='联合国新闻' ? via : ''), year: Number.isNaN(+date) ? '' : String(date.getUTCFullYear()),
          lang, url: read('link'), kind: '新闻', via, basis: '新闻索引',
          matched:terms.length===0 || terms.filter(t=>(title+' '+description).toLowerCase().includes(t)).length>=Math.min(2,terms.length) };
      }).filter(x => x.title && x.url && x.matched).slice(0,7);
}

function googleNews(query, lang) {
  const locale = lang === '中文' ? { hl: 'zh-TW', gl: 'TW', ceid: 'TW:zh-Hant' } : { hl: 'en-US', gl: 'US', ceid: 'US:en' };
  return request('https://news.google.com', '/rss/search', { q: `${query} when:90d`, ...locale }, true)
    .then(xml => rss(xml,lang,'Google News RSS'));
}

function unNews(query,lang,pending) {
  const code=lang==='中文'?'zh':'en';
  if(!pending.has(code))pending.set(code,request('https://news.un.org',`/feed/subscribe/${code}/news/all/rss.xml`,{},true));
  return pending.get(code).then(xml=>rss(xml,lang,'联合国新闻',query));
}

function hrNews(query) {
  return request('https://www.hrdive.com','/feeds/news/',{},true).then(xml=>rss(xml,'English','HR Dive',query));
}

function chinaEmployment(query) {
  const origin='https://chinajob.mohrss.gov.cn';
  const terms=queryWords(query,'中文');
  return request(origin,'/',{},true).then(html=>{
    if(!html.includes('中国就业网'))throw Error('门户页面格式异常');
    const seen=new Set();
    const entries=[];
    for(const [,path,year,body] of html.matchAll(/<a\b[^>]*\bhref=["'](\/c\/(\d{4})-\d{2}-\d{2}\/\d+\.shtml)["'][^>]*>([\s\S]*?)<\/a>/gi)){
      const title=decode(body);
      if(!title || !terms.some(t=>title.includes(t)) || seen.has(path))continue;
      entries.push({title,authors:'中国就业网',year,lang:'中文',url:new URL(path,origin).href,kind:'新闻',via:'中国就业网',basis:'门户头条索引'});
      seen.add(path);
      if(entries.length===8)break;
    }
    return entries;
  });
}

export async function discover(zh, en, kind) {
  const jobs = [];
  const feeds = new Map();
  for (const [query, lang] of [[zh, '中文'], [en, 'English']]) {
    if (!query) continue;
    if (!kind || kind === '论文') {
      jobs.push(['OpenAlex · ' + lang, openAlex(query, lang)]);
      const crossref=papers(query,lang).then(results=>kind==='论文'?results.filter(x=>x.kind!=='著作'):results);
      jobs.push(['Crossref · ' + lang,crossref]);
    }
    if (!kind || kind === '著作') {
      jobs.push(['Open Library · ' + lang, books(query, lang)]);
      if(kind==='著作' || lang==='English')jobs.push(['Crossref 图书 · ' + lang,papers(query,lang,true)]);
    }
    if (!kind || kind === '新闻') {
      if(lang==='中文') jobs.push(['中国就业网 · 中文',chinaEmployment(query)]);
      else jobs.push(['HR Dive · English',hrNews(query)]);
      jobs.push(['Google News · ' + lang, googleNews(query, lang)]);
      jobs.push(['联合国新闻 · ' + lang, unNews(query, lang,feeds)]);
    }
  }
  const settled = await Promise.allSettled(jobs.map(job => job[1]));
  const seen = new Set();
  const results = settled.flatMap(item => item.status === 'fulfilled' ? item.value : []).filter(item => {
    const key = (item.doi || item.url || item.title).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const sources = settled.map((item, index) => ({ name: jobs[index][0], ok: item.status === 'fulfilled',
    detail: item.status === 'fulfilled' ? `${item.value.length} 条` : item.reason.message }));
  return { results, sources };
}
