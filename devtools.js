(function(){
  const d=document, b=d.body;
  if(d.getElementById('my-devtools-panel') || d.getElementById('my-devtools-btn')) return;

  const w=d.createElement('div'), m=d.createElement('div');
  w.id='my-devtools-panel';
  m.id='my-devtools-btn';

  // Stylizacja panelu dolnego
  w.style.cssText='position:fixed;bottom:0;left:0;width:100%;height:350px;background:#111;color:#fff;z-index:9999999;font-family:monospace;font-size:11px;display:none;flex-direction:column;border-top:2px solid #007fff;box-sizing:border-box';
  
  // Stylizacja mobilnej kulki - dodany ostry jaskrawy kolor i gruba ramka, żeby była widoczna na każdym tle
  m.style.cssText='position:fixed;top:80px;right:20px;width:60px;height:60px;background:#007fff;color:#fff;z-index:9999999;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;font-family:sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.8);user-select:none;touch-action:none;cursor:pointer;border:3px solid #fff;font-size:14px';
  m.innerText='Dev';
  
  let isDragging=false, startX=0, startY=0, initialX=0, initialY=0;
  
  m.addEventListener('touchstart', (e)=>{
    isDragging=false;
    const t=e.touches[0];
    startX=t.clientX; startY=t.clientY;
    const r=m.getBoundingClientRect();
    initialX=r.left; initialY=r.top;
  }, {passive:true});
  
  m.addEventListener('touchmove', (e)=>{
    const t=e.touches[0];
    if(Math.abs(t.clientX-startX)>10 || Math.abs(t.clientY-startY)>10) isDragging=true;
    if(isDragging){
      m.style.right='auto'; m.style.bottom='auto';
      m.style.left=(initialX+(t.clientX-startX))+'px';
      m.style.top=(initialY+(t.clientY-startY))+'px';
    }
  }, {passive:true});

  m.addEventListener('touchend', ()=>{
    if(!isDragging){ m.style.display='none'; w.style.display='flex'; go('t1'); }
  });

  h='<div style="background:#222;padding:10px;display:flex;justify-content:space-between;align-items:center"><b>🛠️ DevCustom Pro</b><span id="cls" style="cursor:pointer;padding:5px;font-weight:bold;font-size:14px">[X]</span></div><div style="display:flex;background:#333"><button id="t1" style="flex:1;color:#fff;background:none;border:none;padding:12px;font-family:monospace">Log</button><button id="t2" style="flex:1;color:#fff;background:none;border:none;padding:12px;font-family:monospace">HTML</button><button id="t3" style="flex:1;color:#fff;background:none;border:none;padding:12px;font-family:monospace">Storage</button></div><div id="c" style="flex:1;overflow:auto;padding:10px;box-sizing:border-box"></div>';
  w.innerHTML=h; b.appendChild(m); b.appendChild(w);
  
  const c=w.querySelector('#c'), s=(t)=>{c.innerHTML=t};
  
  w.querySelector('#cls').onclick=()=>{ w.style.display='none'; m.style.display='flex'; };
  w.querySelector('#t1').onclick=()=>go('t1');
  w.querySelector('#t2').onclick=()=>go('t2');
  w.querySelector('#t3').onclick=()=>go('t3');

  function go(t){
    if(t=='t1'){
      s('<div id="l" style="height:220px;overflow:auto;margin-bottom:5px;border-bottom:1px solid #333;font-family:monospace"></div><div style="display:flex;gap:5px"><input id="i" placeholder="Wpisz JS..." style="flex:1;background:#222;color:#fff;border:1px solid #444;padding:8px;font-family:monospace"><button id="r" style="background:#007fff;color:#fff;border:none;padding:8px 15px;font-family:monospace;font-weight:bold">Run</button></div>');
      const l=c.querySelector('#l'), i=c.querySelector('#i');
      c.querySelector('#r').onclick=()=>{
        try{ l.innerHTML+='<div style="color:#00ff00">> '+eval(i.value)+'</div>'; }
        catch(e){ l.innerHTML+='<div style="color:#ff3333">Err: '+e.message+'</div>'; }
        i.value=''; l.scrollTop=l.scrollHeight;
      }
    }
    if(t=='t2'){
      s('<input id="s" placeholder="Selektor CSS (np. h1, img)..." style="width:100%;background:#222;color:#fff;border:1px solid #444;padding:8px;box-sizing:border-box;font-family:monospace"><div id="o" style="margin-top:8px;height:220px;overflow:auto"></div>');
      const o=c.querySelector('#o'), i=c.querySelector('#s');
      i.oninput=(e)=>{
        o.innerHTML=''; if(!i.value)return;
        try{
          const els=d.querySelectorAll(i.value);
          o.innerHTML=`<b>Znaleziono: ${els.length}</b><br><br>`;
          els.forEach((el,idx)=>{
            const pre=d.createElement('pre');
            pre.style.cssText='background:#222;padding:8px;border:1px solid #444;overflow:auto;max-height:100px;white-space:pre-wrap;font-size:10px;margin-bottom:5px;color:#ffaa00;font-family:monospace';
            pre.innerText=`[${idx}] ` + el.outerHTML;
            o.appendChild(pre);
          });
        }catch(x){ o.innerHTML='<span style="color:red">Błędny selektor CSS</span>'; }
      }
    }
    if(t=='t3'){
      let txt='<b>LocalStorage:</b><br>';
      for(let k in localStorage) if(localStorage.hasOwnProperty(k)) txt+=`<span style="color:#007fff">${k}</span>: ${localStorage[k]}<br>`;
      s(txt+'<br><b>Cookies:</b><br>'+(d.cookie||'Brak ciasteczek'));
    }
  }
})();
