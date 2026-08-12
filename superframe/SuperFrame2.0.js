//change log for SuperFrame 2.0:
//The SuperFrame 2.0 improved preformance
//and have greater compatibility with
//NW.js, and ElectronAPP. Please check
//WebView in NW.js/Electron ZIP, its
//*IMPORTANT*!

(function () {
  'use strict';

  if (typeof Scratch === 'undefined' || !Scratch.extensions) return;

  const PROXY_URL = 'https://proxy.skj-tech.online/?url=';
  const frames = new Map();
  const isElectron = /electron/i.test(navigator.userAgent) || (typeof nw !== 'undefined');
  let isLoopRunning = false;

  function getStageContainer() {
    if (Scratch.renderer && Scratch.renderer.canvas && Scratch.renderer.canvas.parentNode) {
      return Scratch.renderer.canvas.parentNode;
    }
    return document.body;
  }

  function checkMonitorCollisions() {
    const stage = getStageContainer();
    const monitors = stage.querySelectorAll('[class*="monitor_monitor-container"], [class*="stage_monitor-wrapper"], [class*="monitor_container"]');
    if (monitors.length === 0) return;

    const frameRects = [];
    frames.forEach(fd => {
      if (fd.container && fd.container.style.display !== 'none') {
        frameRects.push(fd.container.getBoundingClientRect());
      }
    });

    monitors.forEach(el => {
      const mRect = el.getBoundingClientRect();
      if (mRect.width === 0 && mRect.height === 0) return;

      let colliding = false;
      for (const fRect of frameRects) {
        if (
          fRect.left < mRect.right &&
          fRect.right > mRect.left &&
          fRect.top < mRect.bottom &&
          fRect.bottom > mRect.top
        ) {
          colliding = true;
          break;
        }
      }

      if (colliding) {
        el.style.display = 'none';
      } else {
        el.style.display = '';
      }
    });
  }

  function getTabDisplayTitle(url, defaultIndex) {
    try {
      if (url.startsWith('data:')) return 'HTML';
      return new URL(url).hostname.replace('www.', '') || ('Karta ' + defaultIndex);
    } catch (e) { return 'Karta ' + defaultIndex; }
  }

  function getFinalUrl(url, isHtmlData) {
    if (isHtmlData || url.startsWith('data:') || isElectron) return url;
    return url.startsWith('http') ? PROXY_URL + encodeURIComponent(url) : url;
  }

  function updateFramePosition(frameData) {
    const stage = getStageContainer();
    if (frameData.container.parentNode !== stage) {
      stage.appendChild(frameData.container);
    }
    
    if (getComputedStyle(stage).position === 'static') stage.style.position = 'relative';

    const canvas = Scratch.renderer ? Scratch.renderer.canvas : null;
    const stageRect = stage.getBoundingClientRect();
    const canvasRect = canvas ? canvas.getBoundingClientRect() : stageRect;
    const stageWidth = (Scratch.vm && Scratch.vm.runtime && Scratch.vm.runtime.stageWidth) || 480;
    const stageHeight = (Scratch.vm && Scratch.vm.runtime && Scratch.vm.runtime.stageHeight) || 360;

    const cWidth = (canvasRect.width > 10) ? canvasRect.width : (stage.clientWidth || 480);
    const cHeight = (canvasRect.height > 10) ? canvasRect.height : (stage.clientHeight || 360);
    const canvasLeft = canvas ? (canvasRect.left - stageRect.left) : 0;
    const canvasTop = canvas ? (canvasRect.top - stageRect.top) : 0;

    const scaleX = cWidth / stageWidth;
    const scaleY = cHeight / stageHeight;

    if (frameData.isMaximized) {
      frameData.container.style.left = canvasLeft + 'px';
      frameData.container.style.top = canvasTop + 'px';
      frameData.container.style.width = cWidth + 'px';
      frameData.container.style.height = cHeight + 'px';
    } else {
      const w = frameData.width * scaleX, h = frameData.height * scaleY;
      const left = canvasLeft + (cWidth / 2) + (frameData.x * scaleX) - (w / 2);
      const top = canvasTop + (cHeight / 2) - (frameData.y * scaleY) - (h / 2);
      frameData.container.style.left = left + 'px';
      frameData.container.style.top = top + 'px';
      frameData.container.style.width = w + 'px';
      frameData.container.style.height = h + 'px';
    }

    checkMonitorCollisions();
  }

  function syncAllPositions() { 
    frames.forEach(updateFramePosition); 
  }

  function renderLoop() {
    if (frames.size > 0) {
      syncAllPositions();
      requestAnimationFrame(renderLoop);
    } else {
      isLoopRunning = false;
    }
  }

  function startLoopIfNeeded() {
    if (!isLoopRunning && frames.size > 0) {
      isLoopRunning = true;
      requestAnimationFrame(renderLoop);
    }
  }

  window.addEventListener('resize', syncAllPositions);
  document.addEventListener('fullscreenchange', syncAllPositions);

  class SuperFrame {
    constructor() {
      if (Scratch.vm && Scratch.vm.runtime) {
        Scratch.vm.runtime.on('PROJECT_STOP_ALL', function () {
          frames.forEach(function (fd) { fd.container.remove(); });
          frames.clear();
          isLoopRunning = false;
          const stage = getStageContainer();
          const monitors = stage.querySelectorAll('[class*="monitor_monitor-container"], [class*="stage_monitor-wrapper"], [class*="monitor_container"]');
          monitors.forEach(el => { el.style.display = ''; });
        });
      }
    }

    getInfo() {
      return {
        id: 'superframe',
        name: 'SuperFrame',
        color1: '#4C97FF',
        color2: '#3373CC',
        blocks: [
          { opcode: 'createIframe', blockType: Scratch.BlockType.COMMAND, text: 'Stwórz iframe [NAME] z URL [URL]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'okno1' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://example.com' } } },
          { opcode: 'createIframeHtml', blockType: Scratch.BlockType.COMMAND, text: 'Otwórz długi tekst [NAME] z [HTML]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'okno1' }, HTML: { type: Scratch.ArgumentType.STRING, defaultValue: '<h1>Hej!</h1>' } } },
          { opcode: 'removeIframe', blockType: Scratch.BlockType.COMMAND, text: 'Usuń iframe [NAME]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'okno1' } } },
          { opcode: 'hideIframe', blockType: Scratch.BlockType.COMMAND, text: 'Ukryj [NAME]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'okno1' } } },
          { opcode: 'showIframe', blockType: Scratch.BlockType.COMMAND, text: 'Pokaż [NAME]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'okno1' } } },
          { opcode: 'setPosition', blockType: Scratch.BlockType.COMMAND, text: 'Zmień x [X] i y [Y] u [NAME]', arguments: { X: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 }, Y: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 }, NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'okno1' } } },
          { opcode: 'setSizeInteractive', blockType: Scratch.BlockType.COMMAND, text: 'Ustaw szerokość i wysokość okna [NAME] na szerokość [WIDTH] i wysokość [HEIGHT]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'okno1' }, WIDTH: { type: Scratch.ArgumentType.NUMBER, defaultValue: 320 }, HEIGHT: { type: Scratch.ArgumentType.NUMBER, defaultValue: 240 } } },
          { opcode: 'setPositionInteractive', blockType: Scratch.BlockType.COMMAND, text: 'Ustaw x, y okna [NAME] na x: [X] y: [Y]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'okno1' }, X: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 }, Y: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 } } },
          { opcode: 'setMode', blockType: Scratch.BlockType.COMMAND, text: 'Ustaw tryb iframe [NAME] na [MODE]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'okno1' }, MODE: { type: Scratch.ArgumentType.STRING, menu: 'modes', defaultValue: 'interactive' } } },
          { opcode: 'clearCache', blockType: Scratch.BlockType.COMMAND, text: 'Wyczyść ciasteczka i pamięć podręczną okna [NAME]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'okno1' } } },
          { opcode: 'reloadFrame', blockType: Scratch.BlockType.COMMAND, text: 'Odśwież okno [NAME]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'okno1' } } },
          { opcode: 'goBackFrame', blockType: Scratch.BlockType.COMMAND, text: 'Przejdź wstecz w oknie [NAME]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'okno1' } } },
          { opcode: 'goForwardFrame', blockType: Scratch.BlockType.COMMAND, text: 'Przejdź do przodu w oknie [NAME]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'okno1' } } },
          { opcode: 'getCurrentUrl', blockType: Scratch.BlockType.REPORTER, text: 'Pobierz aktualny URL okna [NAME]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'okno1' } } },
          { opcode: 'getOpenWindowCount', blockType: Scratch.BlockType.REPORTER, text: 'Ilość otwartych okien iframe/webview' },
          { opcode: 'iframeExists', blockType: Scratch.BlockType.BOOLEAN, text: 'Czy iframe [NAME] istnieje?', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'okno1' } } }
        ],
        menus: { modes: { acceptReporters: false, items: ['kiosk', 'interactive', 'przeglądarka'] } }
      };
    }

    _setupFrame(name, sourceUrl, isHtmlData) {
      if (frames.has(name)) {
        const ex = frames.get(name), act = ex.tabs.find(function (t) { return t.id === ex.activeTabId; });
        if (act && sourceUrl && act.url !== sourceUrl) {
          act.url = sourceUrl; act.title = getTabDisplayTitle(sourceUrl, act.id);
          ex.iframe.src = getFinalUrl(sourceUrl, isHtmlData);
        }
        updateFramePosition(ex);
        return;
      }

      const self = this;
      const stage = getStageContainer();
      if (getComputedStyle(stage).position === 'static') stage.style.position = 'relative';

      const container = document.createElement('div');
      container.id = 'superframe-' + name;
      container.style.cssText = 'position:absolute;z-index:99999;display:flex;flex-direction:column;box-sizing:border-box;overflow:hidden;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.25);background:#fff;';

      const browserBar = document.createElement('div');
      browserBar.style.cssText = 'display:none;background:#e0e0e0;padding:6px 8px;user-select:none;gap:6px;align-items:center;';

      const windowControls = document.createElement('div');
      windowControls.style.cssText = 'display:flex;gap:8px;align-items:center;';

      const btnBase = 'width:14px;height:14px;border-radius:50%;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,0.3);';
      const redBtn = document.createElement('div');
      redBtn.style.cssText = btnBase + 'background:#ff5f56;';
      const yellowBtn = document.createElement('div');
      yellowBtn.style.cssText = btnBase + 'background:#ffbd2e;';

      const stopProp = function (e) { e.stopPropagation(); };
      redBtn.addEventListener('pointerdown', stopProp);
      redBtn.addEventListener('click', function (e) { stopProp(e); self.removeIframe({ NAME: name }); });

      yellowBtn.addEventListener('pointerdown', stopProp);
      yellowBtn.addEventListener('click', function (e) {
        stopProp(e);
        const fd = frames.get(name);
        if (fd) { fd.isMaximized = !fd.isMaximized; updateFramePosition(fd); }
      });

      windowControls.appendChild(redBtn);
      windowControls.appendChild(yellowBtn);

      const tabsContainer = document.createElement('div');
      tabsContainer.style.cssText = 'display:flex;gap:4px;align-items:center;overflow-x:auto;';

      const addTabBtn = document.createElement('button');
      addTabBtn.textContent = '+';
      addTabBtn.style.cssText = 'border:none;background:#ccc;border-radius:3px;cursor:pointer;padding:2px 8px;font-weight:700;';
      addTabBtn.addEventListener('pointerdown', stopProp);
      addTabBtn.onclick = function (e) { stopProp(e); addNewTab('https://example.com'); };

      const dragArea = document.createElement('div');
      dragArea.style.cssText = 'flex:1;height:24px;min-width:30px;cursor:grab;';

      const urlRow = document.createElement('div');
      urlRow.style.cssText = 'display:flex;gap:4px;width:100%;margin-top:4px;';

      const addressBar = document.createElement('input');
      addressBar.style.cssText = 'flex:1;border:1px solid #ccc;border-radius:3px;padding:3px 6px;font-weight:700;';
      addressBar.addEventListener('pointerdown', stopProp);

      const goBtn = document.createElement('button');
      goBtn.textContent = 'Idź';
      goBtn.style.cssText = 'cursor:pointer;border:1px solid #aaa;border-radius:3px;font-weight:700;';
      goBtn.addEventListener('pointerdown', stopProp);

      urlRow.appendChild(addressBar);
      urlRow.appendChild(goBtn);

      const navContainer = document.createElement('div');
      navContainer.style.cssText = 'display:flex;flex-direction:column;width:100%;';
      const topRow = document.createElement('div');
      topRow.style.cssText = 'display:flex;align-items:center;width:100%;';
      topRow.appendChild(tabsContainer);
      topRow.appendChild(addTabBtn);
      topRow.appendChild(dragArea);
      navContainer.appendChild(topRow);
      navContainer.appendChild(urlRow);
      browserBar.appendChild(navContainer);

      const frameElement = document.createElement(isElectron ? 'webview' : 'iframe');
      frameElement.style.cssText = 'width:100%;flex:1;border:none;background:#fff;';
      if (!isElectron) {
        frameElement.setAttribute('allow', 'pointer-lock; fullscreen; autoplay; camera; microphone; clipboard-read; clipboard-write');
        frameElement.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals');
      }

      const resizeHandle = document.createElement('div');
      resizeHandle.style.cssText = 'position:absolute;bottom:0;right:0;width:16px;height:16px;cursor:nwse-resize;z-index:999999;background:linear-gradient(135deg, transparent 50%, rgba(0,0,0,0.4) 50%);';

      let tabCounter = 1;
      const frameData = {
        name: name, container: container, iframe: frameElement, browserBar: browserBar, resizeHandle: resizeHandle, topRow: topRow, windowControls: windowControls, yellowBtn: yellowBtn,
        x: 0, y: 0, width: 320, height: 240, isMaximized: false, mode: 'interactive', tabs: [], activeTabId: null
      };

      const loadUrlInFrame = function (url) { frameElement.src = getFinalUrl(url, false); };

      if (isElectron) {
        const handleNav = function (e) {
          const u = e.url || (typeof frameElement.getURL === 'function' ? frameElement.getURL() : '')
          if (!u) return
          const act = frameData.tabs.find(function (t) { return t.id === frameData.activeTabId })
          if (act) {
            act.url = u
            act.title = getTabDisplayTitle(u, act.id)
            addressBar.value = u
            renderTabs()
          }
        }
        frameElement.addEventListener('new-window', function (e) {
          e.preventDefault()
          if (e.url) frameElement.src = e.url
        })
        frameElement.addEventListener('did-start-navigation', handleNav)
        frameElement.addEventListener('did-navigate', handleNav)
      } else {
        frameElement.onload = function () {
          try {
            const doc = frameElement.contentDocument || frameElement.contentWindow.document
            if (doc) doc.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').forEach(function (el) { el.remove() })
            frameElement.contentWindow.open = function (u) { if (u) addNewTab(u); return null }
            const u = frameElement.contentWindow.location.href
            if (u && u !== 'about:blank') {
              const act = frameData.tabs.find(function (t) { return t.id === frameData.activeTabId })
              if (act) {
                act.url = u
                act.title = getTabDisplayTitle(u, act.id)
                addressBar.value = u
                renderTabs()
              }
            }
          } catch (e) {}
        }
      }

      const renderTabs = function () {
        tabsContainer.innerHTML = '';
        frameData.tabs.forEach(function (t) {
          const tabEl = document.createElement('div');
          tabEl.style.cssText = 'display:flex;align-items:center;gap:4px;padding:3px 8px;border-radius:4px 4px 0 0;font-size:11px;cursor:pointer;user-select:none;border:1px solid #999;background:' + (t.id === frameData.activeTabId ? '#fff' : '#ccc') + ';';
          if (t.id === frameData.activeTabId) tabEl.style.borderBottom = 'none';

          const titleSpan = document.createElement('span');
          titleSpan.textContent = t.title || ('Karta ' + t.id);
          titleSpan.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:80px;font-weight:700;';
          tabEl.appendChild(titleSpan);

          if (frameData.tabs.length > 1) {
            const closeBtn = document.createElement('div');
            closeBtn.textContent = '×';
            closeBtn.style.cssText = 'cursor:pointer;color:#d00000;margin-left:6px;';
            closeBtn.onclick = function (e) {
              stopProp(e);
              frameData.tabs = frameData.tabs.filter(function (tab) { return tab.id !== t.id; });
              if (frameData.activeTabId === t.id) {
                const next = frameData.tabs[frameData.tabs.length - 1];
                if (next) { frameData.activeTabId = next.id; addressBar.value = next.url; loadUrlInFrame(next.url); }
              }
              renderTabs();
            };
            tabEl.appendChild(closeBtn);
          }

          tabEl.onclick = function (e) { stopProp(e); frameData.activeTabId = t.id; addressBar.value = t.url; loadUrlInFrame(t.url); renderTabs(); };
          tabEl.addEventListener('pointerdown', stopProp);
          tabsContainer.appendChild(tabEl);
        });
      };

      const addNewTab = function (url) {
        const id = tabCounter++;
        frameData.tabs.push({ id: id, title: getTabDisplayTitle(url, id), url: url });
        frameData.activeTabId = id; addressBar.value = url; loadUrlInFrame(url); renderTabs();
      };

      const navCur = function () {
        const act = frameData.tabs.find(function (t) { return t.id === frameData.activeTabId; });
        if (act) { act.url = addressBar.value; act.title = getTabDisplayTitle(act.url, act.id); loadUrlInFrame(act.url); renderTabs(); }
      };
      addressBar.onkeydown = function (e) { if (e.key === 'Enter') navCur(); };
      goBtn.onclick = function (e) { stopProp(e); navCur(); };

      addNewTab(sourceUrl || 'https://example.com');

      let isDrag = false, sx = 0, sy = 0, ix = 0, iy = 0;
      dragArea.onpointerdown = function (e) {
        const fd = frames.get(name); if (fd && fd.isMaximized) return;
        isDrag = true; sx = e.clientX; sy = e.clientY; ix = fd.x; iy = fd.y;
        window.addEventListener('pointermove', doDrag); window.addEventListener('pointerup', stopDrag);
      };
      const doDrag = function (e) { 
        const fd = frames.get(name); 
        if (isDrag && fd) { 
          fd.x = ix + (e.clientX - sx); 
          fd.y = iy - (e.clientY - sy); 
          updateFramePosition(fd); 
        } 
      };
      const stopDrag = function () { 
        isDrag = false; 
        window.removeEventListener('pointermove', doDrag); 
        window.removeEventListener('pointerup', stopDrag);
        checkMonitorCollisions();
      };

      let isRes = false, sw = 0, sh = 0, smx = 0, smy = 0;
      resizeHandle.onpointerdown = function (e) {
        stopProp(e); const fd = frames.get(name); if (fd && fd.isMaximized) return;
        isRes = true; smx = e.clientX; smy = e.clientY; sw = fd.width; sh = fd.height;
        window.addEventListener('pointermove', doRes); window.addEventListener('pointerup', stopRes);
      };
      const doRes = function (e) {
        if (!isRes) return;
        const cv = Scratch.renderer ? Scratch.renderer.canvas : null;
        const cr = cv ? cv.getBoundingClientRect() : getStageContainer().getBoundingClientRect();
        const fd = frames.get(name);
        if (fd) {
          fd.width = Math.max(50, sw + (e.clientX - smx) / (cr.width / 480));
          fd.height = Math.max(50, sh + (e.clientY - smy) / (cr.height / 360));
          updateFramePosition(fd);
        }
      };
      const stopRes = function () { 
        isRes = false; 
        window.removeEventListener('pointermove', doRes); 
        window.removeEventListener('pointerup', stopRes);
        checkMonitorCollisions();
      };

      container.appendChild(browserBar);
      container.appendChild(frameElement);
      container.appendChild(resizeHandle);
      frames.set(name, frameData);
      
      this.setMode({ NAME: name, MODE: 'interactive' });
      updateFramePosition(frameData);
      startLoopIfNeeded();
    }

    createIframe(args) { this._setupFrame(String(args.NAME), String(args.URL), false); }

    async decompressZIP(b64) {
      try {
        const bin = atob(b64), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).text();
      } catch (e) { return '<h1>Błąd ZIP</h1>'; }
    }

    async createIframeHtml(args) {
      let html = String(args.HTML);
      if (html.startsWith('ZIP:')) html = await this.decompressZIP(html.substring(4));
      this._setupFrame(String(args.NAME), 'data:text/html;charset=utf-8,' + encodeURIComponent(html), true);
    }

    removeIframe(args) {
      const fd = frames.get(String(args.NAME));
      if (fd) { 
        fd.container.remove(); 
        frames.delete(fd.name); 
        if (frames.size === 0) {
          const stage = getStageContainer();
          const monitors = stage.querySelectorAll('[class*="monitor_monitor-container"], [class*="stage_monitor-wrapper"], [class*="monitor_container"]');
          monitors.forEach(el => { el.style.display = ''; });
        } else {
          checkMonitorCollisions();
        }
      }
    }
    hideIframe(args) { 
      const fd = frames.get(String(args.NAME)); 
      if (fd) { 
        fd.container.style.display = 'none'; 
        checkMonitorCollisions();
      } 
    }
    showIframe(args) { 
      const fd = frames.get(String(args.NAME)); 
      if (fd) { 
        fd.container.style.display = 'flex'; 
        updateFramePosition(fd);
      } 
    }
    setPosition(args) {
      const fd = frames.get(String(args.NAME));
      if (fd) { fd.x = Number(args.X) || 0; fd.y = Number(args.Y) || 0; updateFramePosition(fd); }
    }

    setSizeInteractive(args) {
      const fd = frames.get(String(args.NAME));
      if (fd) {
        fd.width = Math.max(10, Number(args.WIDTH) || 320);
        fd.height = Math.max(10, Number(args.HEIGHT) || 240);
        updateFramePosition(fd);
      }
    }

    setPositionInteractive(args) {
      const fd = frames.get(String(args.NAME));
      if (fd) {
        fd.x = Number(args.X) || 0;
        fd.y = Number(args.Y) || 0;
        updateFramePosition(fd);
      }
    }

    clearCache(args) {
      const fd = frames.get(String(args.NAME));
      if (!fd || !fd.iframe) return;
      if (isElectron) {
        try {
          const wc = typeof fd.iframe.getWebContents === 'function' ? fd.iframe.getWebContents() : null;
          if (wc && wc.session) wc.session.clearStorageData();
          else if (typeof fd.iframe.clearData === 'function') fd.iframe.clearData();
        } catch (e) {}
      } else {
        try {
          const win = fd.iframe.contentWindow;
          if (win) { win.localStorage.clear(); win.sessionStorage.clear(); }
        } catch (e) {}
      }
    }

    reloadFrame(args) {
      const fd = frames.get(String(args.NAME));
      if (!fd || !fd.iframe) return;
      if (isElectron && typeof fd.iframe.reload === 'function') {
        fd.iframe.reload();
      } else {
        fd.iframe.src = fd.iframe.src;
      }
    }

    goBackFrame(args) {
      const fd = frames.get(String(args.NAME));
      if (!fd || !fd.iframe) return;
      if (isElectron && typeof fd.iframe.goBack === 'function') {
        fd.iframe.goBack();
      } else {
        try { if (fd.iframe.contentWindow) fd.iframe.contentWindow.history.back(); } catch (e) {}
      }
    }

    goForwardFrame(args) {
      const fd = frames.get(String(args.NAME));
      if (!fd || !fd.iframe) return;
      if (isElectron && typeof fd.iframe.goForward === 'function') {
        fd.iframe.goForward();
      } else {
        try { if (fd.iframe.contentWindow) fd.iframe.contentWindow.history.forward(); } catch (e) {}
      }
    }

    getCurrentUrl(args) {
      const fd = frames.get(String(args.NAME));
      if (!fd) return '';
      if (isElectron && typeof fd.iframe.getURL === 'function') {
        return fd.iframe.getURL() || '';
      }
      const act = fd.tabs ? fd.tabs.find(function (t) { return t.id === fd.activeTabId; }) : null;
      if (act && act.url) return act.url;
      try { return fd.iframe.contentWindow.location.href; } catch (e) { return fd.iframe.src || ''; }
    }

    getOpenWindowCount() {
      return frames.size;
    }

    iframeExists(args) {
      return frames.has(String(args.NAME));
    }

    setMode(args) {
      const fd = frames.get(String(args.NAME)), mode = String(args.MODE);
      if (!fd) return;
      fd.mode = mode;

      if (mode === 'przeglądarka') {
        fd.container.style.zIndex = '99999';
        fd.windowControls.style.cssText = 'display:flex;gap:8px;align-items:center;margin-left:8px;position:static;';
        fd.topRow.appendChild(fd.windowControls);
        fd.browserBar.style.display = 'flex';
        fd.resizeHandle.style.display = 'block';
        fd.yellowBtn.style.display = 'block';
        fd.container.style.border = '1px solid #ccc';
      } else if (mode === 'interactive') {
        fd.container.style.zIndex = '99999';
        if (fd.windowControls.parentNode) fd.windowControls.parentNode.removeChild(fd.windowControls);
        fd.browserBar.style.display = 'none';
        fd.resizeHandle.style.display = 'none';
        fd.yellowBtn.style.display = 'none';
        fd.container.style.border = 'none';
      } else if (mode === 'kiosk') {
        fd.container.style.zIndex = '99999';
        if (fd.windowControls.parentNode) fd.windowControls.parentNode.removeChild(fd.windowControls);
        fd.browserBar.style.display = 'none';
        fd.resizeHandle.style.display = 'none';
        fd.yellowBtn.style.display = 'none';
        fd.container.style.border = 'none';
      }
      updateFramePosition(fd);
    }
  }

  Scratch.extensions.register(new SuperFrame());
})();