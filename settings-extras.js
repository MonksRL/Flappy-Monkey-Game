(function installFlappySettingsExtras(){
    'use strict';

    const STORAGE_KEY='gameAccessibilitySettings';
    const defaults={showFps:false,showPing:false,showExplosionVfx:true,showAuras:true,showWeatherOverlays:true,weatherMode:'random',secretAutoDownload:false,cursorTheme:'default',muteEmotes:false};
    const read=()=>{try{const value=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}');return value&&typeof value==='object'?value:{};}catch(_){return{};}};
    const settings=window.gameAccessibility||read();
    for(const [key,value] of Object.entries(defaults)) if(settings[key]===undefined) settings[key]=value;
    window.gameAccessibility=settings;
    window.flappyVisualSettings=settings;
    window.flappyVisualEffectsEnabled=kind=>kind==='aura'?settings.showAuras!==false:kind==='explosion'?settings.showExplosionVfx!==false:true;
    const save=()=>localStorage.setItem(STORAGE_KEY,JSON.stringify({...read(),...settings}));
    const NAME_STYLE_KEY='flappyNameAppearance';
    const NAME_STYLE_VERSION_KEY='flappyNameAppearanceVersion';
    const nameStyleDefaults={color:'#fff3a5',glow:false,rgb:false,gradient:false,rgbSpeed:3};
    const nameStyleFlag=value=>value===true||value===1||value==='true'||value==='1';
    const readNameStyle=()=>{try{const value=JSON.parse(localStorage.getItem(NAME_STYLE_KEY)||'{}');return value&&typeof value==='object'?value:{};}catch(_){return{};}};
    const nameStyle={...nameStyleDefaults,...readNameStyle()};
    if(Number(localStorage.getItem(NAME_STYLE_VERSION_KEY)||0)<2){
        const old=Number(nameStyle.rgbSpeed)||1.5,oldChoices=[3,1.5,.75,.4],newChoices=[6,3,1.5,.65];
        const closest=oldChoices.reduce((best,value,index)=>Math.abs(value-old)<Math.abs(oldChoices[best]-old)?index:best,0);
        nameStyle.rgbSpeed=newChoices[closest];
        localStorage.setItem(NAME_STYLE_KEY,JSON.stringify(nameStyle));
        localStorage.setItem(NAME_STYLE_VERSION_KEY,'2');
    }
    const normalizeNameStyle=()=>{
        nameStyle.color=/^#[0-9a-f]{6}$/i.test(String(nameStyle.color||''))?String(nameStyle.color).toLowerCase():nameStyleDefaults.color;
        // Older saves can contain the strings "false"/"true". Boolean("false")
        // is true, which made a disabled glow return after a refresh.
        nameStyle.glow=nameStyleFlag(nameStyle.glow);nameStyle.rgb=nameStyleFlag(nameStyle.rgb);nameStyle.gradient=nameStyleFlag(nameStyle.gradient)&&!nameStyle.rgb;
        nameStyle.rgbSpeed=Math.max(.35,Math.min(8,Number(nameStyle.rgbSpeed)||3));
        return {...nameStyle};
    };
    const saveNameStyle=()=>localStorage.setItem(NAME_STYLE_KEY,JSON.stringify(normalizeNameStyle()));

    const style=document.createElement('style');
    style.id='settings-extras-style';
    style.textContent=`
        #performanceHud{position:fixed;z-index:2147483200;right:max(12px,env(safe-area-inset-right));bottom:max(64px,calc(env(safe-area-inset-bottom) + 64px));display:none;min-width:64px;padding:5px 8px;border:1px solid rgba(198,255,218,.26);border-radius:9px;color:#dfffe6;background:rgba(2,20,13,.82);box-shadow:0 5px 14px rgba(0,0,0,.28);font:800 9px/1.35 Arial,sans-serif;text-align:right;pointer-events:none}
        #performanceHud.show{display:grid;gap:1px}#performanceHud b{color:#ffe779;font-weight:1000}
        body:has(#monkeyWorldScreen.open) #performanceHud{top:max(92px,calc(env(safe-area-inset-top) + 92px));right:max(18px,env(safe-area-inset-right));bottom:auto;left:auto;text-align:right}
        body.online-global-controls-visible:has(#monkeyWorldScreen.open) #performanceHud{right:max(92px,calc(env(safe-area-inset-right) + 92px))}
        body:has(#monkeyWorldScreen.open) #quickSettingsBtn{display:none!important}
        .cursor-settings-note{display:block;margin:6px 0 0;color:#a8c6b0;font-size:9px;line-height:1.35}
        .weather-mode-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(145px,1.2fr);gap:10px;align-items:center;min-height:40px;font-size:12px}.weather-mode-row select{width:100%;min-height:36px;padding:6px 30px 6px 10px;border:1px solid rgba(136,205,153,.36);border-radius:9px;color:#f4fff1;background:#0a3025;font:800 11px/1.2 inherit}.weather-mode-row select:disabled{opacity:.45}
        .cursor-theme-picker{position:relative;width:100%}.cursor-theme-trigger{display:grid;width:100%;min-height:44px;grid-template-columns:27px minmax(0,1fr) auto;align-items:center;gap:9px;padding:6px 10px;border:1px solid rgba(255,238,148,.42);border-radius:12px;color:#f8fff3;background:linear-gradient(145deg,#174b34,#092d24);box-shadow:inset 0 1px rgba(255,255,255,.08);font-weight:950;text-align:left}.cursor-theme-trigger[aria-expanded="true"]{border-color:#ffe467;box-shadow:0 0 0 3px rgba(255,222,75,.18),inset 0 1px rgba(255,255,255,.1)}
        .cursor-theme-preview{display:block;width:24px;height:24px;object-fit:contain;filter:drop-shadow(0 2px 2px rgba(0,0,0,.4))}.cursor-theme-trigger>b{display:grid;width:21px;height:21px;place-items:center;border-radius:50%;color:#ffe884;background:rgba(0,0,0,.22)}
        .cursor-theme-menu{position:absolute;z-index:150500;left:0;right:0;top:calc(100% + 7px);display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;padding:8px;border:1px solid rgba(255,231,112,.48);border-radius:14px;background:linear-gradient(150deg,#082d22,#061a18);box-shadow:0 18px 45px rgba(0,0,0,.62)}.cursor-theme-menu[hidden]{display:none}.cursor-theme-choice{position:relative;display:grid!important;width:100%;min-height:48px!important;grid-template-columns:28px minmax(0,1fr);align-items:center;gap:8px;padding:7px 9px!important;border:1px solid rgba(139,213,154,.18)!important;border-radius:10px!important;color:#effff1!important;background:linear-gradient(145deg,rgba(38,102,66,.7),rgba(15,58,42,.8))!important;font:850 10px/1.2 inherit!important;text-align:left!important;box-shadow:inset 0 1px rgba(255,255,255,.05)!important}.cursor-theme-choice:hover,.cursor-theme-choice:focus-visible{border-color:#ffe478!important;color:#fff6bd!important;background:linear-gradient(145deg,#2c7650,#164d3c)!important;transform:translateY(-1px)}.cursor-theme-choice.active{border-color:#8ff1ad!important;box-shadow:inset 0 0 0 1px rgba(141,241,173,.2)!important}.cursor-theme-choice.active::after{content:'✓';position:absolute;right:7px;top:6px;color:#9cffb9;font-size:12px}.cursor-theme-choice .cursor-theme-preview{width:24px;height:24px}@media(max-width:420px){.cursor-theme-menu{grid-template-columns:1fr}}
        .appearance-settings{display:grid;gap:9px;margin-top:16px;padding-top:14px;border-top:1px solid color-mix(in srgb,var(--equipped-theme-accent,#ffe467) 28%,transparent)}
        .appearance-settings h3{margin:0}.appearance-settings.locked{opacity:.6}.appearance-preview{display:flex;align-items:center;justify-content:center;min-height:48px;padding:8px 12px;border:1px solid color-mix(in srgb,var(--equipped-theme-accent,#ffe467) 38%,transparent);border-radius:12px;background:color-mix(in srgb,var(--equipped-theme-panel-color,#0a3025) 82%,#000 18%);font-size:17px;font-weight:1000;overflow:hidden}
        .appearance-setting-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(132px,1fr);gap:10px;align-items:center;min-height:36px;font-size:11px}.appearance-setting-row input[type="color"]{width:100%;height:34px;padding:3px;border:1px solid color-mix(in srgb,var(--equipped-theme-accent,#ffe467) 34%,transparent);border-radius:9px;background:var(--equipped-theme-panel-color,#0a3025)}.appearance-setting-row select{width:100%;min-height:34px;padding:5px 28px 5px 9px;border:1px solid color-mix(in srgb,var(--equipped-theme-accent,#ffe467) 30%,transparent);border-radius:9px;color:#f4fff1;background:color-mix(in srgb,var(--equipped-theme-panel-color,#0a3025) 88%,#000 12%)}
        .appearance-settings .settings-toggle-row{min-height:34px}.appearance-title-divider{display:grid;gap:3px;margin-top:5px;padding-top:10px;border-top:1px solid rgba(255,255,255,.13)}.appearance-title-divider h4{margin:0;color:var(--equipped-theme-accent,#ffe467);font-size:14px}.appearance-title-divider p{margin:0;color:#d6e4dc;font-size:10px;line-height:1.35}.appearance-title-button{width:100%;min-height:38px;border-radius:10px!important}@property --flappy-name-live-color{syntax:'<color>';inherits:true;initial-value:#fff3a5}.flappy-name-style{--flappy-name-live-color:var(--flappy-name-color,#fff3a5);color:var(--flappy-name-live-color)!important;text-shadow:none!important;animation:none!important}.flappy-name-glow{text-shadow:0 0 4px currentColor,0 0 11px currentColor,0 2px 2px rgba(0,0,0,.72)!important}.flappy-name-rgb{animation:flappy-name-rgb var(--flappy-name-speed,3s) linear infinite!important;text-shadow:none!important}.flappy-name-rgb.flappy-name-glow{text-shadow:0 0 4px currentColor,0 0 11px currentColor,0 2px 2px rgba(0,0,0,.72)!important}.flappy-name-gradient{color:transparent!important;-webkit-text-fill-color:transparent!important;background:linear-gradient(90deg,#ff5576,#ffd95a,#63f5aa,#62d9ff,#a881ff,#ff6cdc,#ff5576);background-size:260% 100%;-webkit-background-clip:text;background-clip:text;animation:flappy-name-gradient var(--flappy-name-speed,3s) linear infinite!important;text-shadow:none!important}.flappy-name-gradient.flappy-name-glow{filter:drop-shadow(0 0 3px rgba(255,255,255,.8)) drop-shadow(0 0 7px rgba(98,217,255,.72));text-shadow:none!important}@keyframes flappy-name-rgb{0%{--flappy-name-live-color:#ff5b68}16%{--flappy-name-live-color:#ffc857}33%{--flappy-name-live-color:#73ee87}50%{--flappy-name-live-color:#59d9ff}67%{--flappy-name-live-color:#8877ff}83%{--flappy-name-live-color:#ff62cf}100%{--flappy-name-live-color:#ff5b68}}@keyframes flappy-name-gradient{to{background-position:260% 0}}
        @property --flappy-title-live-color{syntax:'<color>';inherits:true;initial-value:#ffffff}.flappy-title-solid-rgb{--flappy-title-live-color:var(--mp-title-color,#ffffff);color:var(--flappy-title-live-color)!important;-webkit-text-fill-color:currentColor!important;animation:flappy-title-solid-rgb var(--flappy-title-speed,2s) linear infinite!important}.flappy-title-gradient{color:transparent!important;-webkit-text-fill-color:transparent!important;background:linear-gradient(90deg,#ff5576,#ffd95a,#63f5aa,#62d9ff,#a881ff,#ff6cdc,#ff5576)!important;background-size:400% 100%!important;-webkit-background-clip:text!important;background-clip:text!important;animation:flappy-title-gradient var(--flappy-title-speed,2s) linear infinite!important}.flappy-title-gradient.flappy-title-glow{filter:drop-shadow(0 0 3px rgba(255,255,255,.8)) drop-shadow(0 0 7px rgba(98,217,255,.72));text-shadow:none!important}@keyframes flappy-title-solid-rgb{0%{--flappy-title-live-color:#ff5b68}16%{--flappy-title-live-color:#ffc857}33%{--flappy-title-live-color:#73ee87}50%{--flappy-title-live-color:#59d9ff}67%{--flappy-title-live-color:#8877ff}83%{--flappy-title-live-color:#ff62cf}100%{--flappy-title-live-color:#ff5b68}}@keyframes flappy-title-gradient{from{background-position:0 0}to{background-position:-400% 0}}
        #nameAppearancePopup{display:none;position:fixed;inset:0;z-index:2147483646;align-items:center;justify-content:center;padding:20px;background:rgba(1,9,7,.58);backdrop-filter:blur(5px) saturate(.82)}
        #nameAppearancePopup.open{display:flex}#nameAppearancePopup .box{display:grid;width:min(460px,calc(100vw - 32px));max-height:min(680px,calc(100vh - 32px));gap:13px;padding:22px;border:1px solid color-mix(in srgb,var(--equipped-theme-accent,#ffe467) 58%,transparent);border-radius:18px;color:var(--equipped-theme-text,#f3fff3);background:linear-gradient(145deg,color-mix(in srgb,var(--equipped-theme-panel-color,#0a3025) 92%,#000 8%),color-mix(in srgb,var(--equipped-theme-panel-2,#08251d) 88%,#000 12%));box-shadow:0 24px 70px rgba(0,0,0,.56);overflow:auto}#nameAppearancePopup h2{margin:0;color:var(--equipped-theme-accent,#ffe467);font-size:24px}.name-appearance-popup-controls{display:grid;gap:9px}.name-appearance-popup-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:3px}.name-appearance-popup-actions button{min-height:40px}.name-appearance-popup-actions #saveNameAppearanceSetting{border-color:color-mix(in srgb,var(--equipped-theme-accent,#ffe467) 62%,transparent)!important;color:#082116!important;background:linear-gradient(145deg,var(--equipped-theme-accent,#ffe467),color-mix(in srgb,var(--equipped-theme-accent,#ffe467) 64%,#49b66b))!important}@media(max-width:420px){.name-appearance-popup-actions{grid-template-columns:1fr}}
        html[data-cursor-theme],html[data-cursor-theme] *{cursor:var(--flappy-custom-cursor)!important}
    `;
    document.head.appendChild(style);

    const hud=document.createElement('div');
    hud.id='performanceHud';hud.setAttribute('aria-live','off');
    hud.innerHTML='<span id="fpsHudLine"></span><span id="pingHudLine"></span>';
    document.body.appendChild(hud);
    const fpsLine=hud.querySelector('#fpsHudLine'),pingLine=hud.querySelector('#pingHudLine');
    let fpsFrame=0,fpsStarted=performance.now(),fpsLoop=0;
    function updateHud(){
        const online=Boolean(window.isFlappyOnline?.());
        const showPing=Boolean(settings.showPing&&online);
        hud.classList.toggle('show',Boolean(settings.showFps||showPing));
        fpsLine.style.display=settings.showFps?'':'none';
        pingLine.style.display=showPing?'':'none';
        if(showPing) pingLine.innerHTML=`PING <b>${Number.isFinite(window.flappyOnlinePingMs)?Math.max(0,Math.round(window.flappyOnlinePingMs))+' ms':'--'}</b>`;
    }
    function fpsTick(now){
        if(!settings.showFps){fpsLoop=0;updateHud();return;}
        fpsFrame+=1;
        const elapsed=now-fpsStarted;
        if(elapsed>=500){
            // Always report the browser/app requestAnimationFrame cadence. Monkey
            // World deliberately refreshes its hidden scene less often behind a
            // full-screen menu, but that is not the app's FPS and made the HUD
            // incorrectly claim it had fallen to about 6 FPS.
            fpsLine.innerHTML=`FPS <b>${Math.max(0,Math.round(fpsFrame*1000/elapsed))}</b>`;
            fpsFrame=0;fpsStarted=now;updateHud();
        }
        fpsLoop=requestAnimationFrame(fpsTick);
    }
    function startFps(){if(settings.showFps&&!fpsLoop){fpsFrame=0;fpsStarted=performance.now();fpsLoop=requestAnimationFrame(fpsTick);}updateHud();}

    const svgCursor=(body,hotX=2,hotY=2)=>({body,hotX,hotY});
    const arrowPointer=(id,start,end,stroke,decoration='')=>svgCursor(`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><defs><linearGradient id="${id}" x1="3" y1="2" x2="19" y2="25" gradientUnits="userSpaceOnUse"><stop stop-color="${start}"/><stop offset="1" stop-color="${end}"/></linearGradient></defs><path d="M2 2.3v19.2l5.2-4.8 4.5 9.4 4.1-1.9-4.4-9.2h9.9z" fill="rgba(0,0,0,.52)" stroke="rgba(0,0,0,.7)" stroke-width="3.2" stroke-linejoin="round"/><path d="M2 2.3v19.2l5.2-4.8 4.5 9.4 4.1-1.9-4.4-9.2h9.9z" fill="url(#${id})" stroke="${stroke}" stroke-width="1.25" stroke-linejoin="round"/><path d="M4.4 5.2v10.3" stroke="#fff" stroke-opacity=".58" stroke-width="1.15" stroke-linecap="round"/>${decoration}</svg>`);
    const cursors={
        default:null,
        banana:arrowPointer('bananaCursor','#fff5a0','#e7a618','#704400','<path d="M8 8c3.3 1.2 5.8 3.2 7.7 6.2" fill="none" stroke="#7a5100" stroke-width="1.25" stroke-linecap="round"/><path d="M3.1 3.6l3.1.8-2.3 2.3z" fill="#61a64a" stroke="#315d25" stroke-width=".55"/>'),
        monkey:arrowPointer('monkeyCursor','#d76b32','#6f2d1d','#3b1711','<path d="M3.4 7.5l13.2 4.3" stroke="#e22526" stroke-width="2.7"/><path d="M3.1 6.2l13.5 4.4" stroke="#ffd258" stroke-width=".9"/><circle cx="10.2" cy="16.4" r="2.1" fill="#e4a56a" stroke="#4b2115" stroke-width=".75"/><circle cx="9.5" cy="16" r=".35"/><circle cx="10.9" cy="16" r=".35"/>'),
        crown:arrowPointer('crownCursor','#9e62e9','#4b2389','#23133c','<path d="M8.1 16.8l1-4.3 2.1 2.3 2-3 2.1 3 2.4-2.2.8 4.2z" fill="#ffd94a" stroke="#754900" stroke-width=".65"/><path d="M8.3 17.2h10" stroke="#fff19a" stroke-width="1.5"/><circle cx="13.2" cy="15.3" r=".7" fill="#55e2ff"/>'),
        pipe:svgCursor('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M2 2v19l5-5 5 10 4-2-4-9h10z" fill="rgba(0,0,0,.55)" stroke="#071d10" stroke-width="3" stroke-linejoin="miter"/><path d="M2 2v19l5-5 5 10 4-2-4-9h10z" fill="#39bd5b" stroke="#c0ffb8" stroke-width="1.2" stroke-linejoin="miter"/><path d="M5 7h12v3H5zm3 7h6v2H8z" fill="#126e35"/><path d="M4 4v12" stroke="#e5ffe1" stroke-width="1.15"/></svg>'),
        star:arrowPointer('starCursor','#a8f6ff','#258bd5','#102e68','<path d="M12.2 12.8l1.25 2.5 2.8.4-2 2 .45 2.75-2.5-1.3-2.5 1.3.45-2.75-2-2 2.8-.4z" fill="#fff27a" stroke="#7a5f00" stroke-width=".55"/><path d="M16.8 9.7l.6 1.1 1.2.2-.9.8.2 1.2-1.1-.6-1.1.6.2-1.2-.9-.8 1.2-.2z" fill="#fff"/>')
    };
    function accountLevel(){try{return typeof getLevelAndProgress==='function'?Math.max(1,Number(getLevelAndProgress().level)||1):1;}catch(_){return 1;}}
    function applyNameStyle(){
        normalizeNameStyle();
        const unlocked=accountLevel()>=5;
        const root=document.documentElement;
        root.style.setProperty('--flappy-name-color',unlocked?nameStyle.color:nameStyleDefaults.color);
        root.style.setProperty('--flappy-name-speed',`${nameStyle.rgbSpeed}s`);
        const targets=[document.querySelector('#usernameDisplayHeader .header-player-name'),document.getElementById('usernameDisplay'),document.getElementById('nameAppearancePreview'),document.getElementById('nameAppearancePopupPreview')].filter(Boolean);
        for(const target of targets){
            target.classList.add('flappy-name-style');
            target.classList.toggle('flappy-name-glow',unlocked&&nameStyle.glow);
            target.classList.toggle('flappy-name-rgb',unlocked&&nameStyle.rgb);
            target.classList.toggle('flappy-name-gradient',unlocked&&nameStyle.gradient);
        }
        window.FlappyNameAppearance={current:()=>({...normalizeNameStyle(),unlocked}),apply:applyNameStyle,unlocked:()=>accountLevel()>=5};
        window.dispatchEvent(new CustomEvent('flappy-name-appearance-applied',{detail:{...normalizeNameStyle(),unlocked}}));
    }
    function applyCursor(){
        const unlocked=accountLevel()>=5;
        const id=unlocked&&cursors[settings.cursorTheme]!==undefined?settings.cursorTheme:'default';
        if(id==='default'){document.documentElement.removeAttribute('data-cursor-theme');document.documentElement.style.removeProperty('--flappy-custom-cursor');return;}
        const item=cursors[id],url=`data:image/svg+xml,${encodeURIComponent(item.body)}`;
        document.documentElement.dataset.cursorTheme=id;
        document.documentElement.style.setProperty('--flappy-custom-cursor',`url("${url}") ${item.hotX} ${item.hotY}, auto`);
    }

    function installPanel(){
        const grid=document.querySelector('#settingsPopup .settings-upgrade-grid');if(!grid||document.getElementById('visualPerformanceSettings'))return;
        const panel=document.createElement('section');panel.className='settings-upgrade-panel';panel.id='visualPerformanceSettings';
        panel.innerHTML=`<h3>Visuals & Performance</h3>
            <label class="settings-toggle-row"><span>Show FPS counter</span><input id="showFpsSetting" type="checkbox"></label>
            <label class="settings-toggle-row" id="showPingSettingRow"><span>Show online ping</span><input id="showPingSetting" type="checkbox"></label>
            <label class="settings-toggle-row"><span>Show Explosion VFX</span><input id="showExplosionVfxSetting" type="checkbox"></label>
            <label class="settings-toggle-row"><span>Show Aura effects</span><input id="showAurasSetting" type="checkbox"></label>
            <label class="settings-toggle-row"><span>Auto-save Sock quest file</span><input id="secretAutoDownloadSetting" type="checkbox"></label>
            <label class="settings-toggle-row"><span>Show weather overlays</span><input id="showWeatherOverlaysSetting" type="checkbox"></label>
            <label class="weather-mode-row"><span>Weather selection</span><select id="weatherModeSetting"><option value="random">Random Weather</option><option value="sunny">Sunny</option><option value="rain">Rain</option><option value="snow">Snow</option><option value="thunderstorm">Thunderstorm</option><option value="fog">Fog</option><option value="night">Night</option><option value="blood-moon">Blood Moon</option><option value="aurora">Aurora</option><option value="meteor-shower">Meteor Shower</option></select></label>`;
        const cursorPanel=document.createElement('section');cursorPanel.className='settings-upgrade-panel';cursorPanel.id='cursorThemeSettings';
        const cursorChoices=[['default','Classic Arrow'],['banana','Banana Peel'],['monkey','Default Monkey'],['crown','Golden Crown'],['pipe','Pixel Pipe'],['star','Star Spark']];
        const classicPointer='<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M1.5 1.5v21l6-5.6 4.7 10.1 4.5-2-4.5-9.6h10.3z" fill="#f8fff9" stroke="#17221d" stroke-width="1.8" stroke-linejoin="round"/></svg>';
        const cursorPreviewUrl=id=>`data:image/svg+xml,${encodeURIComponent(id==='default'?classicPointer:cursors[id].body)}`;
        cursorPanel.innerHTML=`<h3>Cursor Theme · Level 5</h3><div id="cursorThemeSelect" class="cursor-theme-picker" data-value="${settings.cursorTheme}"><button id="cursorThemeTrigger" class="cursor-theme-trigger" type="button" aria-haspopup="listbox" aria-expanded="false"><img id="cursorThemePreview" class="cursor-theme-preview" alt=""><span id="cursorThemeLabel"></span><b>⌄</b></button><div id="cursorThemeMenu" class="cursor-theme-menu" role="listbox" hidden>${cursorChoices.map(([id,label])=>`<button class="cursor-theme-choice" type="button" role="option" data-cursor-choice="${id}"><img class="cursor-theme-preview" src="${cursorPreviewUrl(id)}" alt=""><span>${label}</span></button>`).join('')}</div></div><span class="cursor-settings-note" id="cursorThemeNote"></span>`;
        cursorPanel.insertAdjacentHTML('beforeend',`<div id="nameAppearanceSettings" class="appearance-settings"><h3>Name Appearance &middot; Level 5</h3><div id="nameAppearancePreview" class="appearance-preview flappy-name-style">Player Name</div><span class="cursor-settings-note" id="nameAppearanceNote"></span><button id="openNameAppearanceSetting" class="appearance-title-button" type="button" data-settings-child="nameAppearancePopup">Open Name Color &amp; Effects</button><div class="appearance-title-divider"><h4>Title Appearance &middot; Level 5</h4><p id="titleAppearanceNote"></p></div><button id="openTitleAppearanceSetting" class="appearance-title-button" type="button" data-settings-child="customTitleColorPopup">Open Title Color &amp; Effects</button></div>`);
        if(!document.getElementById('nameAppearancePopup')) document.body.insertAdjacentHTML('beforeend',`<div id="nameAppearancePopup" aria-hidden="true"><div class="box" role="dialog" aria-modal="true" aria-labelledby="nameAppearancePopupTitle"><h2 id="nameAppearancePopupTitle">Name Color &amp; Effects</h2><div id="nameAppearancePopupPreview" class="appearance-preview flappy-name-style">Player Name</div><span class="cursor-settings-note" id="nameAppearancePopupNote"></span><div class="name-appearance-popup-controls"><label class="appearance-setting-row"><span>Name color</span><input id="nameColorSetting" type="color" value="${nameStyle.color}" aria-label="Player name color"></label><label class="settings-toggle-row"><span>Glow name</span><input id="nameGlowSetting" type="checkbox"></label><label class="settings-toggle-row"><span>Animated RGB name</span><input id="nameRgbSetting" type="checkbox"></label><label class="settings-toggle-row"><span>Animated gradient name</span><input id="nameGradientSetting" type="checkbox"></label><label class="appearance-setting-row"><span>Effect speed</span><select id="nameRgbSpeedSetting" aria-label="Name color effect speed"><option value="6">Slow (6 seconds)</option><option value="3">Normal (3 seconds)</option><option value="1.5">Fast (1.5 seconds)</option><option value="0.65">Very fast (0.65 seconds)</option></select></label><span class="cursor-settings-note">Changes are previewed here and saved only when you choose Apply &amp; Save.</span></div><div class="name-appearance-popup-actions"><button id="saveNameAppearanceSetting" type="button">Apply &amp; Save</button><button id="closeNameAppearanceSetting" type="button">Cancel</button></div></div></div>`);
        // Keep this settings-only child inside the Settings stacking context.
        // As a body sibling it could be composited beneath Settings on some
        // Chromium/GPU combinations despite its very large z-index.
        const settingsRoot=document.getElementById('settingsPopup'),appearancePopup=document.getElementById('nameAppearancePopup');
        if(settingsRoot&&appearancePopup&&appearancePopup.parentElement!==settingsRoot)settingsRoot.appendChild(appearancePopup);
        grid.append(panel,cursorPanel);
        const weatherMode=document.getElementById('weatherModeSetting');
        const syncWeatherControls=()=>{weatherMode.value=['random','sunny','rain','snow','thunderstorm','fog','night','blood-moon','aurora','meteor-shower'].includes(settings.weatherMode)?settings.weatherMode:'random';weatherMode.disabled=settings.showWeatherOverlays===false;};
        const bindings=[['showFpsSetting','showFps'],['showPingSetting','showPing'],['showExplosionVfxSetting','showExplosionVfx'],['showAurasSetting','showAuras'],['showWeatherOverlaysSetting','showWeatherOverlays'],['secretAutoDownloadSetting','secretAutoDownload']];
        for(const [id,key] of bindings){const input=document.getElementById(id);input.checked=Boolean(settings[key]);input.addEventListener('change',()=>{settings[key]=input.checked;save();if(key==='showFps')startFps();if(key==='showWeatherOverlays')syncWeatherControls();updateHud();window.dispatchEvent(new CustomEvent('flappy-visual-settings-changed',{detail:{key,value:settings[key],settings:{...settings}}}));});}
        weatherMode.addEventListener('change',()=>{settings.weatherMode=weatherMode.value;save();window.dispatchEvent(new CustomEvent('flappy-visual-settings-changed',{detail:{key:'weatherMode',value:settings.weatherMode,settings:{...settings}}}));});
        syncWeatherControls();
        const picker=document.getElementById('cursorThemeSelect'),trigger=document.getElementById('cursorThemeTrigger'),menu=document.getElementById('cursorThemeMenu'),label=document.getElementById('cursorThemeLabel'),preview=document.getElementById('cursorThemePreview');
        const syncPicker=()=>{const choice=cursorChoices.find(([id])=>id===settings.cursorTheme)||cursorChoices[0];picker.dataset.value=choice[0];label.textContent=choice[1];preview.src=cursorPreviewUrl(choice[0]);menu.querySelectorAll('[data-cursor-choice]').forEach(button=>{const active=button.dataset.cursorChoice===choice[0];button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));});};
        trigger.addEventListener('click',()=>{const open=menu.hidden;menu.hidden=!open;trigger.setAttribute('aria-expanded',String(open));});
        menu.addEventListener('click',event=>{const button=event.target.closest('[data-cursor-choice]');if(!button)return;settings.cursorTheme=button.dataset.cursorChoice;save();syncPicker();applyCursor();menu.hidden=true;trigger.setAttribute('aria-expanded','false');trigger.focus();});
        document.addEventListener('pointerdown',event=>{if(!picker.contains(event.target)){menu.hidden=true;trigger.setAttribute('aria-expanded','false');}});
        syncPicker();
        const nameColor=document.getElementById('nameColorSetting'),nameGlow=document.getElementById('nameGlowSetting'),nameRgb=document.getElementById('nameRgbSetting'),nameGradient=document.getElementById('nameGradientSetting'),nameSpeed=document.getElementById('nameRgbSpeedSetting'),namePreview=document.getElementById('nameAppearancePreview'),namePopupPreview=document.getElementById('nameAppearancePopupPreview'),namePopup=document.getElementById('nameAppearancePopup');
        const syncNameControls=()=>{
            normalizeNameStyle();
            nameColor.value=nameStyle.color;nameGlow.checked=nameStyle.glow;nameRgb.checked=nameStyle.rgb;nameGradient.checked=nameStyle.gradient;nameSpeed.value=String(nameStyle.rgbSpeed);
        };
        syncNameControls();
        const currentDisplayName=()=>{
            const header=document.getElementById('usernameDisplayHeader');
            const headerName=header?.querySelector('.header-player-name')?.textContent?.trim();
            const headerLevel=header?.querySelector('.header-level-badge')?.textContent?.trim();
            return (headerName
                ? `${headerName}${headerLevel?` ${headerLevel}`:''}`
                : header?.textContent||document.getElementById('usernameDisplay')?.textContent||'Player Name').trim()||'Player Name';
        };
        const updateNamePreview=()=>{
            const unlocked=accountLevel()>=5,color=unlocked?nameColor.value:nameStyleDefaults.color,speed=Number(nameSpeed.value)||3;
            for(const target of [namePreview,namePopupPreview].filter(Boolean)){
                target.textContent=currentDisplayName();
                target.style.setProperty('--flappy-name-color',color);
                target.style.setProperty('--flappy-name-speed',`${speed}s`);
                target.classList.toggle('flappy-name-glow',unlocked&&nameGlow.checked);
                target.classList.toggle('flappy-name-rgb',unlocked&&nameRgb.checked);
                target.classList.toggle('flappy-name-gradient',unlocked&&nameGradient.checked);
            }
        };
        const commitNameControls=()=>{
            nameStyle.color=nameColor.value;nameStyle.glow=nameGlow.checked;nameStyle.rgb=nameRgb.checked;nameStyle.gradient=nameGradient.checked&&!nameRgb.checked;nameStyle.rgbSpeed=Number(nameSpeed.value)||3;
            saveNameStyle();applyNameStyle();
            window.dispatchEvent(new CustomEvent('flappy-name-appearance-changed',{detail:{...normalizeNameStyle(),unlocked:accountLevel()>=5}}));
        };
        let namePreviewFrame=0;
        nameColor.addEventListener('input',()=>{if(namePreviewFrame)return;namePreviewFrame=requestAnimationFrame(()=>{namePreviewFrame=0;updateNamePreview();});});
        nameColor.addEventListener('change',updateNamePreview);
        nameRgb.addEventListener('change',()=>{if(nameRgb.checked)nameGradient.checked=false;updateNamePreview();});
        nameGradient.addEventListener('change',()=>{if(nameGradient.checked)nameRgb.checked=false;updateNamePreview();});
        for(const input of [nameGlow,nameSpeed]) input.addEventListener('change',updateNamePreview);
        const closeNamePopup=(restore=true)=>{
            if(restore){syncNameControls();updateNamePreview();}
            namePopup?.classList.remove('open');namePopup?.setAttribute('aria-hidden','true');
        };
        document.getElementById('openNameAppearanceSetting')?.addEventListener('click',()=>{
            if(accountLevel()<5||!namePopup)return;
            syncNameControls();updateNamePreview();namePopup.classList.add('open');namePopup.setAttribute('aria-hidden','false');
        });
        document.getElementById('saveNameAppearanceSetting')?.addEventListener('click',()=>{commitNameControls();closeNamePopup(false);});
        document.getElementById('closeNameAppearanceSetting')?.addEventListener('click',()=>closeNamePopup(true));
        namePopup?.addEventListener('pointerdown',event=>{if(event.target===namePopup)closeNamePopup(true);});
        document.addEventListener('keydown',event=>{if((window.flappyBackBindingMatches?.(event)??event.key==='Escape')&&namePopup?.classList.contains('open')){event.preventDefault();event.stopImmediatePropagation();closeNamePopup(true);}},true);
        document.getElementById('openTitleAppearanceSetting')?.addEventListener('click',()=>{
            if(accountLevel()<5)return;
            if(typeof openCustomTitleColorMenu==='function') openCustomTitleColorMenu();
            else if(typeof window.openTitleAppearanceEditor==='function') window.openTitleAppearanceEditor();
        });
        updateNamePreview();
        refreshSettingsAvailability();
    }
    function refreshSettingsAvailability(){
        const online=Boolean(window.isFlappyOnline?.()),pingRow=document.getElementById('showPingSettingRow');if(pingRow)pingRow.style.display=online?'':'none';
        const level=accountLevel(),trigger=document.getElementById('cursorThemeTrigger'),note=document.getElementById('cursorThemeNote');
        if(trigger)trigger.disabled=level<5;
        if(note)note.textContent=level<5?`Reach Monkey Level 5 to unlock cursor themes. Current level: ${level}.`:'Free game-themed cursors are unlocked. They do not count toward the Collection Index.';
        const appearance=document.getElementById('nameAppearanceSettings'),appearanceNote=document.getElementById('nameAppearanceNote'),popupNote=document.getElementById('nameAppearancePopupNote'),nameAppearanceButton=document.getElementById('openNameAppearanceSetting'),titleAppearanceButton=document.getElementById('openTitleAppearanceSetting'),titleAppearanceNote=document.getElementById('titleAppearanceNote');
        if(appearance)appearance.classList.toggle('locked',level<5);
        for(const id of ['nameColorSetting','nameGlowSetting','nameRgbSetting','nameGradientSetting','nameRgbSpeedSetting','saveNameAppearanceSetting']){const control=document.getElementById(id);if(control)control.disabled=level<5;}
        if(nameAppearanceButton)nameAppearanceButton.disabled=level<5;
        if(titleAppearanceButton)titleAppearanceButton.disabled=level<5;
        const nameMessage=level<5?`Reach Monkey Level 5 to unlock name colors, glow, and RGB effects. Current level: ${level}.`:'Your name appearance is visible anywhere your online profile style is shown.';
        if(appearanceNote)appearanceNote.textContent=nameMessage;
        if(popupNote)popupNote.textContent=nameMessage;
        if(titleAppearanceNote)titleAppearanceNote.textContent=level<5?`Reach Monkey Level 5 to unlock title colors, glow, and animated effects. Current level: ${level}.`:`Customize your equipped title's color, glow, and animated effects.`;
        applyCursor();applyNameStyle();updateHud();
    }
    window.addEventListener('flappy-online-ping',()=>{refreshSettingsAvailability();updateHud();});
    window.addEventListener('flappy-online-status',refreshSettingsAvailability);
    window.addEventListener('flappy-xp-changed',refreshSettingsAvailability);
    document.getElementById('settingsPopup')?.addEventListener('flappy:settings-open',refreshSettingsAvailability);
    installPanel();applyCursor();applyNameStyle();startFps();updateHud();
})();
// Load the shared menu-theme coverage layer once. This stays here instead of
// relying on every individual screen to remember its own stylesheet include.
(() => {
  const href = "theme-coverage.css";
  if (!document.querySelector(`link[href$="${href}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }
})();
// Shared theme coverage is loaded here because this script is present on every
// game screen (including online modes and Monkey World interiors).
(() => {
  const href = "theme-coverage.css";
  if (!document.querySelector(`link[href$="${href}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }
})();
