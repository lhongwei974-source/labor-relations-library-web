export async function mountContinuous(session,scroll,refresh){
  const generation=++session.busy;
  const first=await session.pdf.getPage(session.page);
  if(session.closed||session.busy!==generation)return;
  const native=first.getViewport({scale:1});
  const width=Math.min(native.width*1.35,Math.max(180,scroll.clientWidth-38))*session.zoom;
  const stack=document.createElement('div');
  stack.className='pdf-stack';
  const frames=Array.from({length:session.pdf.numPages},(_,index)=>{
    const element=document.createElement('section');
    element.className='pdfPage pdf-slot';
    element.dataset.page=index+1;
    element.style.width=width+'px';
    element.style.height=width*native.height/native.width+'px';
    element.setAttribute('aria-label','PDF 第 '+(index+1)+' 页');
    stack.append(element);
    return element;
  });
  scroll.replaceChildren(stack);
  const origin=session.page;
  let active=true,frameId=0;
  const loaded=new Map();
  async function draw(element){
    const number=Number(element.dataset.page);
    if(loaded.has(number))return;
    const job={};
    loaded.set(number,job);
    try{
      const page=await session.pdf.getPage(number);
      if(!active||loaded.get(number)!==job)return;
      const scale=width/page.getViewport({scale:1}).width;
      const viewport=page.getViewport({scale});
      const previousHeight=element.offsetHeight;
      const above=element.getBoundingClientRect().bottom<scroll.getBoundingClientRect().top;
      element.style.height=viewport.height+'px';
      if(above)scroll.scrollTop+=element.offsetHeight-previousHeight;
      element.style.setProperty('--scale-factor',scale);
      element.innerHTML='<canvas></canvas><div class="pdfMarks"></div><div class="textLayer"></div>';
      const canvas=element.querySelector('canvas');
      const ratio=Math.min(window.devicePixelRatio||1,2);
      canvas.width=Math.ceil(viewport.width*ratio);
      canvas.height=Math.ceil(viewport.height*ratio);
      canvas.style.width=viewport.width+'px';
      canvas.style.height=viewport.height+'px';
      const textLayer=new session.TextLayer({textContentSource:page.streamTextContent(),container:element.querySelector('.textLayer'),viewport});
      const painting=page.render({canvasContext:canvas.getContext('2d'),viewport,transform:ratio===1?null:[ratio,0,0,ratio,0,0]});
      job.cancel=()=>{textLayer.cancel();painting.cancel();};
      refresh();
      await Promise.all([textLayer.render(),painting.promise]);
    }catch(error){
      if(active&&loaded.get(number)===job)element.textContent='该页暂时无法显示。';
    }
  }
  const viewportObserver=new IntersectionObserver(entries=>{
    for(const entry of entries){
      const element=entry.target;
      const n=Number(element.dataset.page);
      if(entry.isIntersecting)draw(element);
      else if(Math.abs(n-session.page)>3&&session.selection?.page!==n){
        loaded.get(n)?.cancel?.();
        loaded.delete(n);
        element.replaceChildren();
      }
    }
  },{root:scroll,rootMargin:'900px 0px'});
  frames.forEach(element=>viewportObserver.observe(element));
  function jump(number){
    const frame=frames[number-1];
    if(!frame)return;
    scroll.scrollTop+=frame.getBoundingClientRect().top-scroll.getBoundingClientRect().top-12;
    draw(frame);
  }
  function onScroll(){
    if(frameId)return;
    frameId=requestAnimationFrame(()=>{
      frameId=0;
      const {top,height}=scroll.getBoundingClientRect();
      const point=top+Math.min(height*.34,190);
      let left=0,right=frames.length-1;
      while(left<right){
        const mid=(left+right)>>1;
        if(frames[mid].getBoundingClientRect().bottom<point)left=mid+1;
        else right=mid;
      }
      if(session.page!==left+1){session.page=left+1;refresh();}
    });
  }
  scroll.addEventListener('scroll',onScroll,{passive:true});
  session.jump=jump;
  session.stopContinuous=()=>{
    active=false;
    viewportObserver.disconnect();
    scroll.removeEventListener('scroll',onScroll);
    cancelAnimationFrame(frameId);
    for(const job of loaded.values())job.cancel?.();
    session.jump=null;
  };
  jump(origin);
  refresh();
}
