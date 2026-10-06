(function(){
  const d=document, b=d.body;
  
  // Tworzenie panelu i kulki
  const w=d.createElement('div'), m=d.createElement('div');
  w.style.cssText='position:fixed;bottom:0;left:0;width:100%;height:350px;background:#111;color:#fff;z-index:999999;font-family:monospace;font-size:11px;display:none;flex-direction:column;border-top:2px solid #007fff';
  m.style.cssText='position:fixed;bottom:20px;right:20px;width:50px;height:50px;background:#007fff;color:#fff;z-index:999999;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;box-shadow:0 4px 12px #000;user-select:none;touch-action:none';
  m.innerText='Dev';
  
  // Logika przeciągania kulki palcem (Drag & Drop na telefonie)
  let isDragging=false, startX, startY, initialX, initialY;
  m.addEventListener('touchstart', (e)=>{
    isDragging=false;
    const t=e.touches[0];
    startX=t.clientX; startY=t.clientY;
    const r=m.getBoundingClientRect();
    initialX=r.left; initialY=r.top;
  });
  m.addEventListener('touchmove', (e)=>{
    const t=e.touches[0];
    if(Math.abs(t.clientX-startX)>5 || Math.abs(t.clientY-startY)>5) isDragging=true;
    if(isDragging){
      m.style.right='auto'; m.style.bottom='auto';
      m.style.left=(initialX+(t.clientX-startX))+'px';
      m.style.top=(initialY+(t.clientY-startY))+'px';
    }
  });

  // Interfejs panelu
  h='<div style="background:#222;padding:8px;display:flex;justify-content:space-between"><b>🛠️ DevCustom Pro</b><span id="cls" style="cursor:pointer;padding:0 5px">[X]</span></div><div style="display:flex;background:#333"><button id="t1" style="flex:1;color:#fff;background:none;border:none;padding:8px">Log</button><button id="t2" style="flex:1;color:#fff;background:none;border:none;padding:8px">HTML Elements</button><button id="t3" style="flex:1;color:#fff;background:none;border:none;padding:8px">Storage</button></div><div id="c" style="flex:1;overflow:auto;padding:8px"></div>';
  w.innerHTML=h; b.appendChild(m); b.appendChild(w);
  
  const c=w.querySelector('#c'), s=(t)=>{c.innerHTML=t};
  
  m.addEventListener('touchend', ()=>{
    if(!isDragging){ m.style.display='none'; w.style.display='flex'; go('t1'); }
  });
  w.querySelector('#cls').onclick=()=>{ w.style.display='none'; m.style.display='flex'; };
  w.querySelector('#t1').onclick=()=>go('t1');
  w.querySelector('#t2').onclick=()=>go('t2');
  w.querySelector('#t3').onclick=()=>go('t3');

  function go(t){
    if(t=='t1'){
      s('<div id="l" style="height:240px;overflow:auto;margin-bottom:5px;border-bottom:1px solid #333"></div><div style="display:flex;gap:5px"><input id="i" placeholder="Wpisz JS (np. document.title)..." style="flex:1;background:#222;color:#fff;border:1px solid #444;padding:5px"><button id="r" style="background:#007fff;color:#fff;border:none;padding:5px 15px">Run</button></div>');
      const l=c.querySelector('#l'), i=c.querySelector('#i');
      c.querySelector('#r').onclick=()=>{
        try{ l.innerHTML+='<div style="color:#00ff00">> '+eval(i.value)+'</div>'; }
        catch(e){ l.innerHTML+='<div style="color:#ff3333">Err: '+e.message+'</div>'; }
        i.value=''; l.scrollTop=l.scrollHeight;
      }
    }
    if(t=='t2'){
      s('<input id="s" placeholder="Wpisz selektor (np. h1, p, .klasa)..." style="width:100%;background:#222;color:#fff;border:1px solid #444;padding:5px;box-sizing:border-box"><div id="o" style="margin-top:8px;height:240px;overflow:auto"></div>');
      const o=c.querySelector('#o'), i=c.querySelector('#s');
      i.oninput=(e)=>{
        o.innerHTML=''; if(!i.value)return;
        try{
          const els=d.querySelectorAll(i.value);
          o.innerHTML=`<b>Znaleziono elementów: ${els.length}</b><br><br>`;
          els.forEach((el,idx)=>{
            const pre=d.createElement('pre');
            pre.style.cssText='background:#222;padding:5px;border:1px solid #444;overflow:auto;max-height:80px;white-space:pre-wrap;font-size:10px;margin-bottom:5px;color:#ffaa00';
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
