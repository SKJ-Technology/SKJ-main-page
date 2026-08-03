(function (Scratch) {
  'use strict';

  if (!Scratch.extensions.unsandboxed) {
    throw new Error('Rozszerzenie SuperFrame wymaga uruchomienia w trybie unsandboxed!');
  }

  const PROXY_URL = 'https://proxy.skj-tech.online/?url=';
  const frames = new Map();
  const isElectron = /electron/i.test(navigator.userAgent);
  let isLoopRunning = false;

  function getStageContainer() {
    const fs = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement;
    if (fs) return fs;
    if (Scratch.renderer && Scratch.renderer.canvas) {
      return Scratch.renderer.canvas.parentNode;
    }
    return document.body;
  }

  function getTabDisplayTitle(url, defaultIndex) {
    try {
      if (url.startsWith('data:')) return `Zasób HTML`;
      const parsed = new URL(url);
      return parsed.hostname.replace('www.', '') || `Karta ${defaultIndex}`;
    } catch (e) {
      return `Karta ${defaultIndex}`;
    }
  }

  function getFinalUrl(url, isHtmlData) {
    if (isHtmlData || url.startsWith('data:')) return url;
    if (isElectron) return url;
    return url.startsWith('http') ? PROXY_URL + encodeURIComponent(url) : url;
  }

  function updateFramePosition(frameData) {
    const stage = getStageContainer();
    if (frameData.container.parentNode !== stage) stage.appendChild(frameData.container);
    if (getComputedStyle(stage).position === 'static') stage.style.position = 'relative';

    const canvas = Scratch.renderer ? Scratch.renderer.canvas : null;
    const stageRect = stage.getBoundingClientRect();
    const canvasRect = canvas ? canvas.getBoundingClientRect() : stageRect;
    const stageWidth = (Scratch.vm && Scratch.vm.runtime && Scratch.vm.runtime.stageWidth) || 480;
    const stageHeight = (Scratch.vm && Scratch.vm.runtime && Scratch.vm.runtime.stageHeight) || 360;

    const scaleX = canvasRect.width / stageWidth;
    const scaleY = canvasRect.height / stageHeight;
    const canvasLeft = canvasRect.left - stageRect.left;
    const canvasTop = canvasRect.top - stageRect.top;

    if (frameData.isMaximized) {
      frameData.container.style.left = `${canvasLeft}px`;
      frameData.container.style.top = `${canvasTop}px`;
      frameData.container.style.width = `${canvasRect.width}px`;
      frameData.container.style.height = `${canvasRect.height}px`;
    } else {
      const centerX = canvasLeft + (canvasRect.width / 2);
      const centerY = canvasTop + (canvasRect.height / 2);
      const widthPx = frameData.width * scaleX;
      const heightPx = frameData.height * scaleY;
      const left = centerX + (frameData.x * scaleX) - (widthPx / 2);
      const top = centerY - (frameData.y * scaleY) - (heightPx / 2);

      frameData.container.style.left = `${left}px`;
      frameData.container.style.top = `${top}px`;
      frameData.container.style.width = `${widthPx}px`;
      frameData.container.style.height = `${heightPx}px`;
    }
  }

  function syncAllPositions() {
    frames.forEach(updateFramePosition);
  }

  // Optymalizacja CPU: Pętla działa tylko, gdy istnieją iframe'y
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

  window.addEventListener('resize', () => { if (frames.size > 0) syncAllPositions(); });
  document.addEventListener('fullscreenchange', () => { if (frames.size > 0) syncAllPositions(); });

  // Sprzątanie po zatrzymaniu projektu (Garbage Collection)
  if (Scratch.vm && Scratch.vm.runtime) {
    Scratch.vm.runtime.on('PROJECT_STOP_ALL', () => {
      frames.forEach(frameData => {
        if (frameData.container.parentNode) {
          frameData.container.parentNode.removeChild(frameData.container);
        }
      });
      frames.clear();
      isLoopRunning = false;
    });
  }

  class SuperFrame {
    getInfo() {
      return {
        id: 'superframe',
        name: 'SuperFrame',
        color1: '#4C97FF',
        color2: '#3373CC',
        blocks: [
          {
            opcode: 'createIframe',
            blockType: Scratch.BlockType.COMMAND,
            text: 'Stwórz iframe o nazwie [NAME] z URL [URL]',
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'okno1' },
              URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://example.com' }
            }
          },
          {
            opcode: 'createIframeHtml',
            blockType: Scratch.BlockType.COMMAND,
            text: 'otwórz długi tekst o nazwie [NAME] z [HTML]',
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'okno1' },
              HTML: { type: Scratch.ArgumentType.STRING, defaultValue: '<h1>Witaj świecie!</h1>' }
            }
          },
          {
            opcode: 'removeIframe',
            blockType: Scratch.BlockType.COMMAND,
            text: 'Usuń iframe [NAME]',
            arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'okno1' } }
          },
          {
            opcode: 'hideIframe',
            blockType: Scratch.BlockType.COMMAND,
            text: 'Ukryj [NAME]',
            arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'okno1' } }
          },
          {
            opcode: 'showIframe',
            blockType: Scratch.BlockType.COMMAND,
            text: 'Pokaż [NAME]',
            arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'okno1' } }
          },
          {
            opcode: 'setPosition',
            blockType: Scratch.BlockType.COMMAND,
            text: 'Zmień x [X] i y [Y] u [NAME]',
            arguments: {
              X: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
              Y: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'okno1' }
            }
          },
          {
            opcode: 'setMode',
            blockType: Scratch.BlockType.COMMAND,
            text: 'Ustaw tryb iframe [NAME] na [MODE]',
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'okno1' },
              MODE: { type: Scratch.ArgumentType.STRING, menu: 'modes', defaultValue: 'interactive' }
            }
          }
        ],
        menus: {
          modes: {
            acceptReporters: false,
            items: ['kiosk', 'interactive', 'przeglądarka']
          }
        }
      };
    }

    _setupFrame(name, sourceUrl, isHtmlData) {
      if (frames.has(name)) {
        const existing = frames.get(name);
        const activeTab = existing.tabs.find(t => t.id === existing.activeTabId);
        if (activeTab && sourceUrl && activeTab.url !== sourceUrl) {
          activeTab.url = sourceUrl;
          activeTab.title = getTabDisplayTitle(sourceUrl, activeTab.id);
          existing.iframe.src = getFinalUrl(sourceUrl, isHtmlData);
        }
        return;
      }

      const stage = getStageContainer();
      if (getComputedStyle(stage).position === 'static') stage.style.position = 'relative';

      const container = document.createElement('div');
      container.id = 'superframe-' + name;
      container.style.position = 'absolute';
      container.style.zIndex = '99999';
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.boxSizing = 'border-box';
      container.style.overflow = 'hidden';
      container.style.borderRadius = '6px';
      container.style.boxShadow = '0 4px 12px rgba(0,0,0,0.25)';

      const browserBar = document.createElement('div');
      browserBar.style.display = 'none';
      browserBar.style.backgroundColor = '#e0e0e0';
      browserBar.style.padding = '6px 8px';
      browserBar.style.userSelect = 'none';
      browserBar.style.gap = '6px';
      browserBar.style.alignItems = 'center';

      const windowControls = document.createElement('div');
      windowControls.style.display = 'flex';
      windowControls.style.gap = '10px';
      windowControls.style.marginRight = '10px';
      windowControls.style.alignItems = 'center';

      const redBtn = document.createElement('div');
      redBtn.style.width = '18px';
      redBtn.style.height = '18px';
      redBtn.style.borderRadius = '50%';
      redBtn.style.backgroundColor = '#ff5f56';
      redBtn.style.cursor = 'pointer';

      const greenBtn = document.createElement('div');
      greenBtn.style.width = '18px';
      greenBtn.style.height = '18px';
      greenBtn.style.borderRadius = '50%';
      greenBtn.style.backgroundColor = '#27c93f';
      greenBtn.style.cursor = 'pointer';

      const stopProp = e => e.stopPropagation();
      redBtn.addEventListener('pointerdown', stopProp);
      redBtn.addEventListener('click', e => { e.stopPropagation(); this.removeIframe({ NAME: name }); });
      greenBtn.addEventListener('pointerdown', stopProp);
      greenBtn.addEventListener('click', e => {
        e.stopPropagation();
        const fd = frames.get(name);
        if (fd) { fd.isMaximized = !fd.isMaximized; updateFramePosition(fd); }
      });

      windowControls.appendChild(redBtn);
      windowControls.appendChild(greenBtn);

      const tabsContainer = document.createElement('div');
      tabsContainer.style.display = 'flex';
      tabsContainer.style.gap = '4px';
      tabsContainer.style.alignItems = 'center';
      tabsContainer.style.overflowX = 'auto';

      const addTabBtn = document.createElement('button');
      addTabBtn.textContent = '+';
      addTabBtn.style.border = 'none';
      addTabBtn.style.background = '#ccc';
      addTabBtn.style.borderRadius = '3px';
      addTabBtn.style.cursor = 'pointer';
      addTabBtn.style.padding = '2px 8px';
      addTabBtn.style.cssText += ' font-weight: 700 !important;';
      addTabBtn.addEventListener('pointerdown', stopProp);

      const dragArea = document.createElement('div');
      dragArea.style.flex = '1';
      dragArea.style.height = '24px';
      dragArea.style.minWidth = '30px';
      dragArea.style.cursor = 'grab';

      const urlRow = document.createElement('div');
      urlRow.style.display = 'flex';
      urlRow.style.gap = '4px';
      urlRow.style.width = '100%';
      urlRow.style.marginTop = '4px';

      const addressBar = document.createElement('input');
      addressBar.type = 'text';
      addressBar.value = sourceUrl;
      addressBar.style.flex = '1';
      addressBar.style.border = '1px solid #ccc';
      addressBar.style.borderRadius = '3px';
      addressBar.style.padding = '3px 6px';
      addressBar.style.cssText += ' font-weight: 700 !important;';
      addressBar.addEventListener('pointerdown', stopProp);

      const goBtn = document.createElement('button');
      goBtn.textContent = 'Idź';
      goBtn.style.cursor = 'pointer';
      goBtn.style.border = '1px solid #aaa';
      goBtn.style.borderRadius = '3px';
      goBtn.style.cssText += ' font-weight: 700 !important;';
      goBtn.addEventListener('pointerdown', stopProp);

      urlRow.appendChild(addressBar);
      urlRow.appendChild(goBtn);

      const navContainer = document.createElement('div');
      navContainer.style.display = 'flex';
      navContainer.style.flexDirection = 'column';
      navContainer.style.width = '100%';

      const topRow = document.createElement('div');
      topRow.style.display = 'flex';
      topRow.style.alignItems = 'center';
      topRow.style.width = '100%';
      topRow.appendChild(windowControls);
      topRow.appendChild(tabsContainer);
      topRow.appendChild(addTabBtn);
      topRow.appendChild(dragArea);

      navContainer.appendChild(topRow);
      navContainer.appendChild(urlRow);
      browserBar.appendChild(navContainer);

      const frameElement = document.createElement(isElectron ? 'webview' : 'iframe');
      frameElement.style.width = '100%';
      frameElement.style.flex = '1';
      frameElement.style.border = 'none';
      frameElement.style.backgroundColor = '#ffffff';
      
      if (!isElectron) {
        frameElement.setAttribute('allow', 'pointer-lock; fullscreen; autoplay; camera; microphone; clipboard-read; clipboard-write');
        frameElement.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals');
      }

      const resizeHandle = document.createElement('div');
      resizeHandle.style.position = 'absolute';
      resizeHandle.style.bottom = '0';
      resizeHandle.style.right = '0';
      resizeHandle.style.width = '16px';
      resizeHandle.style.height = '16px';
      resizeHandle.style.cursor = 'nwse-resize';
      resizeHandle.style.zIndex = '999999';
      resizeHandle.style.display = 'none';
      resizeHandle.style.background = 'linear-gradient(135deg, transparent 50%, rgba(0,0,0,0.4) 50%)';

      let tabCounter = 1;
      const frameData = {
        name: name,
        container: container,
        iframe: frameElement,
        browserBar: browserBar,
        resizeHandle: resizeHandle,
        x: 0, y: 0, width: 320, height: 240,
        isMaximized: false, mode: 'interactive',
        tabs: [], activeTabId: null
      };

      const loadUrlInFrame = function (url) {
        frameElement.src = getFinalUrl(url, false);
      };

      if (!isElectron) {
        frameElement.addEventListener('load', function () {
          try {
            const doc = frameElement.contentDocument || frameElement.contentWindow.document;
            if (doc) {
              const cspMetas = doc.querySelectorAll('meta[http-equiv="Content-Security-Policy"]');
              cspMetas.forEach(el => el.remove());
              frameElement.contentWindow.open = url => { if (url) addNewTab(url); return null; };
            }
          } catch (e) {}
        });
      }

      // Bezpieczne generowanie kart (ochrona przed XSS z użyciem textContent)
      const renderTabs = function () {
        tabsContainer.textContent = '';
        frameData.tabs.forEach(t => {
          const tabEl = document.createElement('div');
          tabEl.style.display = 'flex';
          tabEl.style.alignItems = 'center';
          tabEl.style.gap = '4px';
          tabEl.style.padding = '3px 8px';
          tabEl.style.borderRadius = '4px 4px 0 0';
          tabEl.style.fontSize = '11px';
          tabEl.style.cursor = 'pointer';
          tabEl.style.userSelect = 'none';
          tabEl.style.background = t.id === frameData.activeTabId ? '#ffffff' : '#cccccc';
          tabEl.style.border = '1px solid #999';
          if (t.id === frameData.activeTabId) tabEl.style.borderBottom = 'none';

          const titleSpan = document.createElement('span');
          titleSpan.textContent = t.title || ('Karta ' + t.id);
          titleSpan.style.whiteSpace = 'nowrap';
          titleSpan.style.overflow = 'hidden';
          titleSpan.style.textOverflow = 'ellipsis';
          titleSpan.style.maxWidth = '80px';
          titleSpan.style.cssText += ' font-weight: 700 !important;';
          tabEl.appendChild(titleSpan);

          if (frameData.tabs.length > 1) {
            const closeBtn = document.createElement('div');
            closeBtn.textContent = '×';
            closeBtn.style.cursor = 'pointer';
            closeBtn.style.color = '#d00000';
            closeBtn.style.marginLeft = '6px';
            closeBtn.addEventListener('click', e => {
              e.stopPropagation();
              frameData.tabs = frameData.tabs.filter(tab => tab.id !== t.id);
              if (frameData.activeTabId === t.id) {
                const nextTab = frameData.tabs[frameData.tabs.length - 1];
                if (nextTab) {
                  frameData.activeTabId = nextTab.id;
                  addressBar.value = nextTab.url;
                  loadUrlInFrame(nextTab.url);
                }
              }
              renderTabs();
            });
            tabEl.appendChild(closeBtn);
          }

          tabEl.addEventListener('click', e => {
            e.stopPropagation();
            frameData.activeTabId = t.id;
            addressBar.value = t.url;
            loadUrlInFrame(t.url);
            renderTabs();
          });

          tabEl.addEventListener('pointerdown', stopProp);
          tabsContainer.appendChild(tabEl);
        });
      };

      const addNewTab = function (url) {
        if (!url) url = 'https://example.com';
        const id = tabCounter++;
        frameData.tabs.push({ id: id, title: getTabDisplayTitle(url, id), url: url });
        frameData.activeTabId = id;
        addressBar.value = url;
        loadUrlInFrame(url);
        renderTabs();
      };

      addTabBtn.addEventListener('click', e => { e.stopPropagation(); addNewTab('https://example.com'); });

      const navigateCurrentTab = function () {
        const activeTab = frameData.tabs.find(t => t.id === frameData.activeTabId);
        if (activeTab) {
          activeTab.url = addressBar.value;
          activeTab.title = getTabDisplayTitle(addressBar.value, activeTab.id);
          loadUrlInFrame(activeTab.url);
          renderTabs();
        }
      };

      addressBar.addEventListener('keydown', e => { if (e.key === 'Enter') navigateCurrentTab(); });
      goBtn.addEventListener('click', e => { e.stopPropagation(); navigateCurrentTab(); });

      addNewTab(sourceUrl);

      let isDragging = false, startX = 0, startY = 0, initialX = 0, initialY = 0;
      const startDrag = function (e) {
        const fd = frames.get(name);
        if (fd && fd.isMaximized) return;
        isDragging = true; startX = e.clientX; startY = e.clientY; initialX = fd.x; initialY = fd.y;
        window.addEventListener('pointermove', doDrag);
        window.addEventListener('pointerup', stopDrag);
      };
      const doDrag = function (e) {
        if (!isDragging) return;
        const fd = frames.get(name);
        if (fd) { fd.x = initialX + (e.clientX - startX); fd.y = initialY - (e.clientY - startY); updateFramePosition(fd); }
      };
      const stopDrag = function () {
        isDragging = false;
        window.removeEventListener('pointermove', doDrag);
        window.removeEventListener('pointerup', stopDrag);
      };

      dragArea.addEventListener('pointerdown', startDrag);

      let isResizing = false, startW = 0, startH = 0, startMouseX = 0, startMouseY = 0;
      const startResize = function (e) {
        e.stopPropagation();
        const fd = frames.get(name);
        if (fd && fd.isMaximized) return;
        isResizing = true; startMouseX = e.clientX; startMouseY = e.clientY; startW = fd.width; startH = fd.height;
        window.addEventListener('pointermove', doResize);
        window.addEventListener('pointerup', stopResize);
      };
      const doResize = function (e) {
        if (!isResizing) return;
        const stage = getStageContainer();
        const stageW = (Scratch.vm && Scratch.vm.runtime && Scratch.vm.runtime.stageWidth) || 480;
        const stageH = (Scratch.vm && Scratch.vm.runtime && Scratch.vm.runtime.stageHeight) || 360;
        const canvas = Scratch.renderer ? Scratch.renderer.canvas : null;
        const canvasRect = canvas ? canvas.getBoundingClientRect() : stage.getBoundingClientRect();
        
        let newW = startW + ((e.clientX - startMouseX) / (canvasRect.width / stageW));
        let newH = startH + ((e.clientY - startMouseY) / (canvasRect.height / stageH));
        if (newW < 200) newW = 200; if (newH < 100) newH = 100;

        const fd = frames.get(name);
        if (fd) { fd.width = newW; fd.height = newH; updateFramePosition(fd); }
      };
      const stopResize = function () {
        isResizing = false;
        window.removeEventListener('pointermove', doResize);
        window.removeEventListener('pointerup', stopResize);
      };

      resizeHandle.addEventListener('pointerdown', startResize);

      container.appendChild(browserBar);
      container.appendChild(frameElement);
      container.appendChild(resizeHandle);
      stage.appendChild(container);

      frames.set(name, frameData);
      updateFramePosition(frameData);
      
      startLoopIfNeeded();
    }

    createIframe(args) {
      const name = String(args.NAME);
      const rawUrl = String(args.URL);
      this._setupFrame(name, rawUrl, false);
    }

    async decompressZIP(base64Str) {
      try {
        const binary = atob(base64Str);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
        return await new Response(stream).text();
      } catch (e) {
        console.error('Błąd dekompresji ZIP:', e);
        return '<h1>Błąd odczytu spakowanego HTML</h1>';
      }
    }

    async createIframeHtml(args) {
      const name = String(args.NAME);
      let htmlContent = String(args.HTML);

      if (htmlContent.startsWith('ZIP:')) {
        htmlContent = await this.decompressZIP(htmlContent.substring(4));
      }

      const dataUri = 'data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent);
      this._setupFrame(name, dataUri, true);
    }

    removeIframe(args) {
      const name = String(args.NAME);
      if (frames.has(name)) {
        const frameData = frames.get(name);
        if (frameData.container.parentNode) {
          frameData.container.parentNode.removeChild(frameData.container);
        }
        frames.delete(name);
      }
    }

    hideIframe(args) {
      const name = String(args.NAME);
      if (frames.has(name)) {
        frames.get(name).container.style.display = 'none';
      }
    }

    showIframe(args) {
      const name = String(args.NAME);
      if (frames.has(name)) {
        frames.get(name).container.style.display = 'flex';
      }
    }

    setPosition(args) {
      const name = String(args.NAME);
      const frameData = frames.get(name);
      if (!frameData) return;

      frameData.x = Number(args.X) || 0;
      frameData.y = Number(args.Y) || 0;
      updateFramePosition(frameData);
    }

    setMode(args) {
      const name = String(args.NAME);
      const mode = String(args.MODE);
      const frameData = frames.get(name);
      if (!frameData) return;

      frameData.mode = mode;

      if (mode === 'przeglądarka') {
        frameData.browserBar.style.display = 'flex';
        frameData.resizeHandle.style.display = 'block';
        frameData.container.style.border = '1px solid #ccc';
      } else if (mode === 'kiosk' || mode === 'interactive') {
        frameData.browserBar.style.display = 'none';
        frameData.resizeHandle.style.display = 'none';
        frameData.container.style.border = 'none';
      }
    }
  }

  Scratch.extensions.register(new SuperFrame());
})(Scratch);  function updateFramePosition(frameData) {
    const stage = getStageContainer();
    if (frameData.container.parentNode !== stage) stage.appendChild(frameData.container);
    if (getComputedStyle(stage).position === 'static') stage.style.position = 'relative';

    const canvas = Scratch.renderer ? Scratch.renderer.canvas : null;
    const stageRect = stage.getBoundingClientRect();
    const canvasRect = canvas ? canvas.getBoundingClientRect() : stageRect;
    const stageWidth = (Scratch.vm && Scratch.vm.runtime && Scratch.vm.runtime.stageWidth) || 480;
    const stageHeight = (Scratch.vm && Scratch.vm.runtime && Scratch.vm.runtime.stageHeight) || 360;

    const scaleX = canvasRect.width / stageWidth;
    const scaleY = canvasRect.height / stageHeight;
    const canvasLeft = canvasRect.left - stageRect.left;
    const canvasTop = canvasRect.top - stageRect.top;

    if (frameData.isMaximized) {
      frameData.container.style.left = `${canvasLeft}px`;
      frameData.container.style.top = `${canvasTop}px`;
      frameData.container.style.width = `${canvasRect.width}px`;
      frameData.container.style.height = `${canvasRect.height}px`;
    } else {
      const centerX = canvasLeft + (canvasRect.width / 2);
      const centerY = canvasTop + (canvasRect.height / 2);
      const widthPx = frameData.width * scaleX;
      const heightPx = frameData.height * scaleY;
      const left = centerX + (frameData.x * scaleX) - (widthPx / 2);
      const top = centerY - (frameData.y * scaleY) - (heightPx / 2);

      frameData.container.style.left = `${left}px`;
      frameData.container.style.top = `${top}px`;
      frameData.container.style.width = `${widthPx}px`;
      frameData.container.style.height = `${heightPx}px`;
    }
  }

  function syncAllPositions() { frames.forEach(updateFramePosition); }
  function renderLoop() {
    if (frames.size > 0) syncAllPositions();
    requestAnimationFrame(renderLoop);
  }
  requestAnimationFrame(renderLoop);

  window.addEventListener('resize', syncAllPositions);
  document.addEventListener('fullscreenchange', syncAllPositions);

  class SuperFrame {
    getInfo() {
      return {
        id: 'superframe',
        name: 'SuperFrame',
        color1: '#4C97FF',
        color2: '#3373CC',
        blocks: [
          {
            opcode: 'createIframe',
            blockType: Scratch.BlockType.COMMAND,
            text: 'Stwórz iframe o nazwie [NAME] z URL [URL]',
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'okno1' },
              URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://example.com' }
            }
          },
          {
            opcode: 'createIframeHtml',
            blockType: Scratch.BlockType.COMMAND,
            text: 'otwórz długi tekst o nazwie [NAME] z [HTML]',
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'okno1' },
              HTML: { type: Scratch.ArgumentType.STRING, defaultValue: '<h1>Witaj świecie!</h1>' }
            }
          },
          {
            opcode: 'removeIframe',
            blockType: Scratch.BlockType.COMMAND,
            text: 'Usuń iframe [NAME]',
            arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'okno1' } }
          },
          {
            opcode: 'hideIframe',
            blockType: Scratch.BlockType.COMMAND,
            text: 'Ukryj [NAME]',
            arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'okno1' } }
          },
          {
            opcode: 'showIframe',
            blockType: Scratch.BlockType.COMMAND,
            text: 'Pokaż [NAME]',
            arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'okno1' } }
          },
          {
            opcode: 'setPosition',
            blockType: Scratch.BlockType.COMMAND,
            text: 'Zmień x [X] i y [Y] u [NAME]',
            arguments: {
              X: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
              Y: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'okno1' }
            }
          },
          {
            opcode: 'setMode',
            blockType: Scratch.BlockType.COMMAND,
            text: 'Ustaw tryb iframe [NAME] na [MODE]',
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'okno1' },
              MODE: { type: Scratch.ArgumentType.STRING, menu: 'modes', defaultValue: 'interactive' }
            }
          }
        ],
        menus: {
          modes: {
            acceptReporters: false,
            items: ['kiosk', 'interactive', 'przeglądarka']
          }
        }
      };
    }

    _setupFrame(name, sourceUrl, isHtmlData) {
      if (frames.has(name)) {
        const existing = frames.get(name);
        const activeTab = existing.tabs.find(t => t.id === existing.activeTabId);
        if (activeTab && sourceUrl && activeTab.url !== sourceUrl) {
          activeTab.url = sourceUrl;
          activeTab.title = getTabDisplayTitle(sourceUrl, activeTab.id);
          existing.iframe.src = getFinalUrl(sourceUrl, isHtmlData);
        }
        return;
      }

      const stage = getStageContainer();
      if (getComputedStyle(stage).position === 'static') stage.style.position = 'relative';

      const container = document.createElement('div');
      container.id = 'superframe-' + name;
      container.style.position = 'absolute';
      container.style.zIndex = '99999';
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.boxSizing = 'border-box';
      container.style.overflow = 'hidden';
      container.style.borderRadius = '6px';
      container.style.boxShadow = '0 4px 12px rgba(0,0,0,0.25)';

      const browserBar = document.createElement('div');
      browserBar.style.display = 'none';
      browserBar.style.backgroundColor = '#e0e0e0';
      browserBar.style.padding = '6px 8px';
      browserBar.style.userSelect = 'none';
      browserBar.style.gap = '6px';
      browserBar.style.alignItems = 'center';

      const windowControls = document.createElement('div');
      windowControls.style.display = 'flex';
      windowControls.style.gap = '10px';
      windowControls.style.marginRight = '10px';
      windowControls.style.alignItems = 'center';

      const redBtn = document.createElement('div');
      redBtn.style.width = '18px';
      redBtn.style.height = '18px';
      redBtn.style.borderRadius = '50%';
      redBtn.style.backgroundColor = '#ff5f56';
      redBtn.style.cursor = 'pointer';

      const greenBtn = document.createElement('div');
      greenBtn.style.width = '18px';
      greenBtn.style.height = '18px';
      greenBtn.style.borderRadius = '50%';
      greenBtn.style.backgroundColor = '#27c93f';
      greenBtn.style.cursor = 'pointer';

      const stopProp = e => e.stopPropagation();
      redBtn.addEventListener('pointerdown', stopProp);
      redBtn.addEventListener('click', e => { e.stopPropagation(); this.removeIframe({ NAME: name }); });
      greenBtn.addEventListener('pointerdown', stopProp);
      greenBtn.addEventListener('click', e => {
        e.stopPropagation();
        const fd = frames.get(name);
        if (fd) { fd.isMaximized = !fd.isMaximized; updateFramePosition(fd); }
      });

      windowControls.appendChild(redBtn);
      windowControls.appendChild(greenBtn);

      const tabsContainer = document.createElement('div');
      tabsContainer.style.display = 'flex';
      tabsContainer.style.gap = '4px';
      tabsContainer.style.alignItems = 'center';
      tabsContainer.style.overflowX = 'auto';

      const addTabBtn = document.createElement('button');
      addTabBtn.innerText = '+';
      addTabBtn.style.border = 'none';
      addTabBtn.style.background = '#ccc';
      addTabBtn.style.borderRadius = '3px';
      addTabBtn.style.cursor = 'pointer';
      addTabBtn.style.padding = '2px 8px';
      addTabBtn.style.cssText += ' font-weight: 700 !important;';
      addTabBtn.addEventListener('pointerdown', stopProp);

      const dragArea = document.createElement('div');
      dragArea.style.flex = '1';
      dragArea.style.height = '24px';
      dragArea.style.minWidth = '30px';
      dragArea.style.cursor = 'grab';

      const urlRow = document.createElement('div');
      urlRow.style.display = 'flex';
      urlRow.style.gap = '4px';
      urlRow.style.width = '100%';
      urlRow.style.marginTop = '4px';

      const addressBar = document.createElement('input');
      addressBar.type = 'text';
      addressBar.value = sourceUrl;
      addressBar.style.flex = '1';
      addressBar.style.border = '1px solid #ccc';
      addressBar.style.borderRadius = '3px';
      addressBar.style.padding = '3px 6px';
      addressBar.style.cssText += ' font-weight: 700 !important;';
      addressBar.addEventListener('pointerdown', stopProp);

      const goBtn = document.createElement('button');
      goBtn.innerText = 'Idź';
      goBtn.style.cursor = 'pointer';
      goBtn.style.border = '1px solid #aaa';
      goBtn.style.borderRadius = '3px';
      goBtn.style.cssText += ' font-weight: 700 !important;';
      goBtn.addEventListener('pointerdown', stopProp);

      urlRow.appendChild(addressBar);
      urlRow.appendChild(goBtn);

      const navContainer = document.createElement('div');
      navContainer.style.display = 'flex';
      navContainer.style.flexDirection = 'column';
      navContainer.style.width = '100%';

      const topRow = document.createElement('div');
      topRow.style.display = 'flex';
      topRow.style.alignItems = 'center';
      topRow.style.width = '100%';
      topRow.appendChild(windowControls);
      topRow.appendChild(tabsContainer);
      topRow.appendChild(addTabBtn);
      topRow.appendChild(dragArea);

      navContainer.appendChild(topRow);
      navContainer.appendChild(urlRow);
      browserBar.appendChild(navContainer);

      const frameElement = document.createElement(isElectron ? 'webview' : 'iframe');
      frameElement.style.width = '100%';
      frameElement.style.flex = '1';
      frameElement.style.border = 'none';
      frameElement.style.backgroundColor = '#ffffff';
      
      if (!isElectron) {
        frameElement.setAttribute('allow', 'pointer-lock; fullscreen; autoplay; camera; microphone; clipboard-read; clipboard-write');
        frameElement.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals');
      }

      const resizeHandle = document.createElement('div');
      resizeHandle.style.position = 'absolute';
      resizeHandle.style.bottom = '0';
      resizeHandle.style.right = '0';
      resizeHandle.style.width = '16px';
      resizeHandle.style.height = '16px';
      resizeHandle.style.cursor = 'nwse-resize';
      resizeHandle.style.zIndex = '999999';
      resizeHandle.style.display = 'none';
      resizeHandle.style.background = 'linear-gradient(135deg, transparent 50%, rgba(0,0,0,0.4) 50%)';

      let tabCounter = 1;
      const frameData = {
        name: name,
        container: container,
        iframe: frameElement,
        browserBar: browserBar,
        resizeHandle: resizeHandle,
        x: 0, y: 0, width: 320, height: 240,
        isMaximized: false, mode: 'interactive',
        tabs: [], activeTabId: null
      };

      const loadUrlInFrame = function (url) {
        frameElement.src = getFinalUrl(url, false);
      };

      if (!isElectron) {
        frameElement.addEventListener('load', function () {
          try {
            const doc = frameElement.contentDocument || frameElement.contentWindow.document;
            if (doc) {
              const cspMetas = doc.querySelectorAll('meta[http-equiv="Content-Security-Policy"]');
              cspMetas.forEach(el => el.remove());
              frameElement.contentWindow.open = url => { if (url) addNewTab(url); return null; };
            }
          } catch (e) {}
        });
      }

      const renderTabs = function () {
        tabsContainer.innerHTML = '';
        frameData.tabs.forEach(t => {
          const tabEl = document.createElement('div');
          tabEl.style.display = 'flex';
          tabEl.style.alignItems = 'center';
          tabEl.style.gap = '4px';
          tabEl.style.padding = '3px 8px';
          tabEl.style.borderRadius = '4px 4px 0 0';
          tabEl.style.fontSize = '11px';
          tabEl.style.cursor = 'pointer';
          tabEl.style.userSelect = 'none';
          tabEl.style.background = t.id === frameData.activeTabId ? '#ffffff' : '#cccccc';
          tabEl.style.border = '1px solid #999';
          if (t.id === frameData.activeTabId) tabEl.style.borderBottom = 'none';

          const titleSpan = document.createElement('span');
          titleSpan.innerText = t.title || ('Karta ' + t.id);
          titleSpan.style.whiteSpace = 'nowrap';
          titleSpan.style.overflow = 'hidden';
          titleSpan.style.textOverflow = 'ellipsis';
          titleSpan.style.maxWidth = '80px';
          titleSpan.style.cssText += ' font-weight: 700 !important;';
          tabEl.appendChild(titleSpan);

          if (frameData.tabs.length > 1) {
            const closeBtn = document.createElement('div');
            closeBtn.innerText = '×';
            closeBtn.style.cursor = 'pointer';
            closeBtn.style.color = '#d00000';
            closeBtn.style.marginLeft = '6px';
            closeBtn.addEventListener('click', e => {
              e.stopPropagation();
              frameData.tabs = frameData.tabs.filter(tab => tab.id !== t.id);
              if (frameData.activeTabId === t.id) {
                const nextTab = frameData.tabs[frameData.tabs.length - 1];
                if (nextTab) {
                  frameData.activeTabId = nextTab.id;
                  addressBar.value = nextTab.url;
                  loadUrlInFrame(nextTab.url);
                }
              }
              renderTabs();
            });
            tabEl.appendChild(closeBtn);
          }

          tabEl.addEventListener('click', e => {
            e.stopPropagation();
            frameData.activeTabId = t.id;
            addressBar.value = t.url;
            loadUrlInFrame(t.url);
            renderTabs();
          });

          tabEl.addEventListener('pointerdown', stopProp);
          tabsContainer.appendChild(tabEl);
        });
      };

      const addNewTab = function (url) {
        if (!url) url = 'https://example.com';
        const id = tabCounter++;
        frameData.tabs.push({ id: id, title: getTabDisplayTitle(url, id), url: url });
        frameData.activeTabId = id;
        addressBar.value = url;
        loadUrlInFrame(url);
        renderTabs();
      };

      addTabBtn.addEventListener('click', e => { e.stopPropagation(); addNewTab('https://example.com'); });

      const navigateCurrentTab = function () {
        const activeTab = frameData.tabs.find(t => t.id === frameData.activeTabId);
        if (activeTab) {
          activeTab.url = addressBar.value;
          activeTab.title = getTabDisplayTitle(addressBar.value, activeTab.id);
          loadUrlInFrame(activeTab.url);
          renderTabs();
        }
      };

      addressBar.addEventListener('keydown', e => { if (e.key === 'Enter') navigateCurrentTab(); });
      goBtn.addEventListener('click', e => { e.stopPropagation(); navigateCurrentTab(); });

      addNewTab(sourceUrl);

      let isDragging = false, startX = 0, startY = 0, initialX = 0, initialY = 0;
      const startDrag = function (e) {
        const fd = frames.get(name);
        if (fd && fd.isMaximized) return;
        isDragging = true; startX = e.clientX; startY = e.clientY; initialX = fd.x; initialY = fd.y;
        window.addEventListener('pointermove', doDrag);
        window.addEventListener('pointerup', stopDrag);
      };
      const doDrag = function (e) {
        if (!isDragging) return;
        const fd = frames.get(name);
        if (fd) { fd.x = initialX + (e.clientX - startX); fd.y = initialY - (e.clientY - startY); updateFramePosition(fd); }
      };
      const stopDrag = function () {
        isDragging = false;
        window.removeEventListener('pointermove', doDrag);
        window.removeEventListener('pointerup', stopDrag);
      };

      dragArea.addEventListener('pointerdown', startDrag);

      let isResizing = false, startW = 0, startH = 0, startMouseX = 0, startMouseY = 0;
      const startResize = function (e) {
        e.stopPropagation();
        const fd = frames.get(name);
        if (fd && fd.isMaximized) return;
        isResizing = true; startMouseX = e.clientX; startMouseY = e.clientY; startW = fd.width; startH = fd.height;
        window.addEventListener('pointermove', doResize);
        window.addEventListener('pointerup', stopResize);
      };
      const doResize = function (e) {
        if (!isResizing) return;
        const stage = getStageContainer();
        const stageW = (Scratch.vm && Scratch.vm.runtime && Scratch.vm.runtime.stageWidth) || 480;
        const stageH = (Scratch.vm && Scratch.vm.runtime && Scratch.vm.runtime.stageHeight) || 360;
        const canvas = Scratch.renderer ? Scratch.renderer.canvas : null;
        const canvasRect = canvas ? canvas.getBoundingClientRect() : stage.getBoundingClientRect();
        
        let newW = startW + ((e.clientX - startMouseX) / (canvasRect.width / stageW));
        let newH = startH + ((e.clientY - startMouseY) / (canvasRect.height / stageH));
        if (newW < 200) newW = 200; if (newH < 100) newH = 100;

        const fd = frames.get(name);
        if (fd) { fd.width = newW; fd.height = newH; updateFramePosition(fd); }
      };
      const stopResize = function () {
        isResizing = false;
        window.removeEventListener('pointermove', doResize);
        window.removeEventListener('pointerup', stopResize);
      };

      resizeHandle.addEventListener('pointerdown', startResize);

      container.appendChild(browserBar);
      container.appendChild(frameElement);
      container.appendChild(resizeHandle);
      stage.appendChild(container);

      frames.set(name, frameData);
      updateFramePosition(frameData);
    }

    createIframe(args) {
      const name = String(args.NAME);
      const rawUrl = String(args.URL);
      this._setupFrame(name, rawUrl, false);
    }

    async decompressZIP(base64Str) {
      try {
        const binary = atob(base64Str);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
        return await new Response(stream).text();
      } catch (e) {
        console.error('Błąd dekompresji ZIP:', e);
        return '<h1>Błąd odczytu spakowanego HTML</h1>';
      }
    }

    async createIframeHtml(args) {
      const name = String(args.NAME);
      let htmlContent = String(args.HTML);

      if (htmlContent.startsWith('ZIP:')) {
        htmlContent = await this.decompressZIP(htmlContent.substring(4));
      }

      const dataUri = 'data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent);
      this._setupFrame(name, dataUri, true);
    }

    removeIframe(args) {
      const name = String(args.NAME);
      if (frames.has(name)) {
        const frameData = frames.get(name);
        frameData.container.remove();
        frames.delete(name);
      }
    }

    hideIframe(args) {
      const name = String(args.NAME);
      if (frames.has(name)) {
        frames.get(name).container.style.display = 'none';
      }
    }

    showIframe(args) {
      const name = String(args.NAME);
      if (frames.has(name)) {
        frames.get(name).container.style.display = 'flex';
      }
    }

    setPosition(args) {
      const name = String(args.NAME);
      const frameData = frames.get(name);
      if (!frameData) return;

      frameData.x = Number(args.X) || 0;
      frameData.y = Number(args.Y) || 0;
      updateFramePosition(frameData);
    }

    setMode(args) {
      const name = String(args.NAME);
      const mode = String(args.MODE);
      const frameData = frames.get(name);
      if (!frameData) return;

      frameData.mode = mode;

      if (mode === 'przeglądarka') {
        frameData.browserBar.style.display = 'flex';
        frameData.resizeHandle.style.display = 'block';
        frameData.container.style.border = '1px solid #ccc';
      } else if (mode === 'kiosk' || mode === 'interactive') {
        frameData.browserBar.style.display = 'none';
        frameData.resizeHandle.style.display = 'none';
        frameData.container.style.border = 'none';
      }
    }
  }

  Scratch.extensions.register(new SuperFrame());
})(Scratch);
