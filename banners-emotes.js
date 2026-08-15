(function bannersAndEmotesFeature() {
    'use strict';

    const BANNER_OWNED_KEY = 'flappyOwnedBanners:v1';
    const BANNER_SELECTED_KEY = 'selectedBanner';
    const DEFAULT_BANNER_ID = 'skin-default';
    const EMOTE_OWNED_KEY = 'flappyOwnedEmotes:v1';

    const readSet = key => {
        try { const value=JSON.parse(localStorage.getItem(key)||'[]'); return new Set(Array.isArray(value)?value:[]); }
        catch (_) { return new Set(); }
    };
    const slug = value => String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    const hash = value => [...String(value||'')].reduce((total,char)=>(Math.imul(total,31)+char.charCodeAt(0))>>>0,2166136261);
    const esc = value => String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));

    const STYLE_PRESETS = Object.freeze({
        tree:['tree','#2d170a','#5f3418','#78bf4a'], rocks:['rocks','#20252a','#555d65','#c5d0d6'], banana:['banana','#362500','#765000','#ffe35d'], vines:['vines','#062719','#174d2e','#65da74'], ocean:['ocean','#031c39','#075f96','#5de8ff'], clouds:['clouds','#44718f','#91c6de','#f4fbff'], golden:['golden','#392000','#a86a00','#ffe779'], silver:['silver','#242a31','#6d7883','#e9f3ff'], honey:['honey','#402300','#a86000','#ffcd47'], flowers:['flowers','#3a1230','#8b365e','#ff9ec9'], water:['water','#052d4a','#0877a2','#81f1ff'], lightning:['lightning','#141347','#3533a5','#fff36f'], glitch:['glitch','#120625','#4c0a72','#32fff0'], lava:['lava','#260603','#761407','#ff6a22'], galaxy:['galaxy','#080526','#28116a','#ca7dff'], purplefire:['purplefire','#170224','#4f0874','#db67ff'], toxic:['toxic','#0b2604','#236d0d','#8dff37'], aurora:['aurora','#061d2d','#125c64','#8bffda'], blackhole:['blackhole','#010108','#1d0a38','#ad56ff'], rgb:['rgb','#280916','#0b3543','#ff5bbd'], magma:['magma','#1f0905','#4b1710','#ff7c38'], neon:['neon','#051c29','#063a44','#35f4ff'], sunset:['sunset','#401224','#b3433e','#ffbe67'], prism:['prism','#171339','#3f377c','#9ff8ff']
    });

    function skinStyle(name) {
        const text=String(name||'').toLowerCase();
        const tests=[['tree',['tree','bark']],['rocks',['rock','stone']],['banana',['banana','peel']],['golden',['gold','crown']],['silver',['silver']],['honey',['honey']],['flowers',['flower','bloom']],['lightning',['lightning','thunder']],['glitch',['glitch','404']],['magma',['molten','magma']],['lava',['lava','fire']],['galaxy',['galaxy','astronaut','space','star']],['toxic',['toxic','venom','slime']],['rgb',['rgb','rainbow']],['neon',['neon']],['sunset',['sunset']],['ocean',['ocean','pirate','underwater']],['aurora',['aurora']],['blackhole',['dark matter','void']]];
        return tests.find(([,words])=>words.some(word=>text.includes(word)))?.[0] || ['vines','clouds','water','purplefire','prism'][hash(text)%5];
    }

    function eligibleBannerSkin(skin) {
        return skin && !['sockmonkey','developer','icon'].includes(String(skin.rarity||'').toLowerCase())
            && !skin.developerOnly && !skin.ownerOnly && !skin.adminOnly && !skin.grantOnly
            && skin.unlockType !== 'developerGrant';
    }

    const MARKET_BANNER_ICONS = Object.freeze({
        'banana-peel':'assets/banners/banner-banana-peel.png','vines':'assets/banners/banner-vines.png','ocean-wave':'assets/banners/banner-ocean-wave.png','cloud-drift':'assets/banners/banner-cloud-drift.png',
        'water-ripples':'assets/banners/banner-water-ripples.png','lava-flow':'assets/banners/banner-lava-flow.png','purple-fire':'assets/banners/banner-purple-fire.png','aurora-borealis':'assets/banners/banner-aurora-borealis.png',
        'black-hole':'assets/banners/banner-black-hole.png','prismatic-grid':'assets/banners/banner-prismatic-grid.png','jungle-canopy':'assets/banners/banner-jungle-canopy.png','cosmic-comets':'assets/banners/banner-cosmic-comets.png'
    });
    const MARKET_BANNERS = Object.freeze([
        ['banana-peel','Banana Peel','banana','uncommon',180],['vines','Living Vines','vines','uncommon',220],['ocean-wave','Ocean Wave','ocean','rare',320],['cloud-drift','Cloud Drift','clouds','rare',340],
        ['water-ripples','Water Ripples','water','rare',360],['lava-flow','Lava Flow','lava','epic',480],['purple-fire','Purple Fire','purplefire','epic',520],['aurora-borealis','Aurora Borealis','aurora','legendary',650],
        ['black-hole','Black Hole','blackhole','mythic',850],['prismatic-grid','Prismatic Grid','prism','epic',540],['jungle-canopy','Jungle Canopy','tree','rare',380],['cosmic-comets','Cosmic Comets','galaxy','legendary',700]
    ].map(([id,name,style,rarity,cost])=>({id,name,style,rarity,cost,icon:MARKET_BANNER_ICONS[id],menuBg:MARKET_BANNER_ICONS[id],description:`Animated ${name.toLowerCase()} player banner from the Banana Market.`,market:true,...palette(style)})));

    // These four shop skins predate the authored skin-banner export set. Their
    // normal menu backgrounds are complete artwork and are a better fallback
    // than pointing at files that do not exist.
    const SKIN_BANNER_BACKGROUND_FALLBACKS = new Set(['Lizzy Monkey','MonksRL','Giuze','ChillPenguin91']);

    function palette(style) { const values=STYLE_PRESETS[style]||STYLE_PRESETS.prism; return { b1:values[1],b2:values[2],accent:values[3],swatch:`linear-gradient(135deg,${values[1]},${values[2]} 58%,${values[3]})` }; }
    function skinPalette(skin, style) {
        const preset=palette(style),seed=hash(`${skin.name}|${skin.rarity}|${skin.unlockType}`),hue=seed%360;
        const hasNamedStyle=Object.entries(STYLE_PRESETS).some(([key])=>String(skin.name||'').toLowerCase().includes(key));
        if (hasNamedStyle) return preset;
        return {b1:`hsl(${hue} 62% 10%)`,b2:`hsl(${(hue+34)%360} 58% 25%)`,accent:`hsl(${(hue+112)%360} 88% 70%)`,swatch:`linear-gradient(135deg,hsl(${hue} 62% 10%),hsl(${(hue+34)%360} 58% 25%) 58%,hsl(${(hue+112)%360} 88% 70%))`};
    }
    let cachedBannerCatalog = null;
    let cachedBannerSkinCount = -1;
    function ensureBannerCatalog() {
        const skins = typeof monkeySkins === 'undefined' ? [] : monkeySkins;
        if (cachedBannerCatalog && cachedBannerSkinCount === skins.length) return cachedBannerCatalog;
        const skinDefinitions = skins.filter(eligibleBannerSkin).map(skin=>{const style=skinStyle(skin.name),id=`skin-${slug(skin.name)}`,authoredIcon=`assets/banners/skins/${id}.png`,icon=SKIN_BANNER_BACKGROUND_FALLBACKS.has(skin.name)?(skin.menuBg||skin.file):authoredIcon,isDefault=skin.name==='Default Monkey';return {id,name:`${skin.name.replace(/ Monkey$/,'')} Banner`,style,rarity:skin.rarity||'common',skinUnlock:true,skinName:skin.name,skinFile:skin.file,icon,menuBg:isDefault?'':icon,seed:hash(skin.name),description:isDefault?'The plain default presentation. It adds no banner styling.':`A detailed animated ${skin.name} environment unlocked with that skin.`,...skinPalette(skin,style)};});
        const definitions = Object.freeze([...skinDefinitions,...MARKET_BANNERS]);
        cachedBannerSkinCount = skins.length;
        cachedBannerCatalog = {
            definitions,
            byId:new Map(definitions.map(item=>[item.id,item])),
            skinByName:new Map(skins.map(skin=>[skin.name,skin]))
        };
        return cachedBannerCatalog;
    }
    function skinBannerDefinitions() { return ensureBannerCatalog().definitions.filter(item=>item.skinUnlock); }
    function bannerDefinitions() { return ensureBannerCatalog().definitions; }
    let ownedBanners=readSet(BANNER_OWNED_KEY);
    let bannerOwnershipDirty=false;
    function flushBannerOwnership(){if(!bannerOwnershipDirty)return false;localStorage.setItem(BANNER_OWNED_KEY,JSON.stringify([...ownedBanners]));bannerOwnershipDirty=false;return true;}
    function bannerById(id){return ensureBannerCatalog().byId.get(id)||null;}
    function ownsBanner(id){const item=bannerById(id);if(!item)return false;if(ownedBanners.has(id))return true;if(item.skinUnlock)return Boolean(ensureBannerCatalog().skinByName.get(item.skinName)?.unlocked);return false;}
    function selectedBanner(){const stored=localStorage.getItem(BANNER_SELECTED_KEY);const id=!stored||stored==='none'?DEFAULT_BANNER_ID:stored;return ownsBanner(id)?id:DEFAULT_BANNER_ID;}
    const collectionBatchActive=()=>window.__flappyBatchingCollectionUpdates===true;
    const bannerMarketVisible=()=>{const grid=document.getElementById('bannersGrid');return Boolean(grid&&grid.style.display!=='none'&&document.getElementById('shopMenu')?.classList.contains('open'));};
    function selectBanner(id){const next=!id||id==='none'?DEFAULT_BANNER_ID:id;if(!ownsBanner(next))return false;localStorage.setItem(BANNER_SELECTED_KEY,next);window.dispatchEvent(new CustomEvent('flappy-banner-changed',{detail:{id:next}}));if(collectionBatchActive()){window.__flappyCollectionBatchDirty=true;}else{window.dispatchEvent(new CustomEvent('flappy-collection-changed',{detail:{category:'banners',selected:next}}));if(bannerMarketVisible())renderBannerMarket();}return true;}
    function safeCssUrl(value){return String(value||'').replace(/["'()\\]/g,character=>`%${character.charCodeAt(0).toString(16).toUpperCase()}`);}
    function variables(item){const seed=Math.max(0,Number(item.seed)||hash(item.id)),image=item.menuBg?`--banner-image:url("${safeCssUrl(item.menuBg)}");`:'';return `--banner-one:${item.b1};--banner-two:${item.b2};--banner-accent:${item.accent};--banner-shift:${seed%47}px;--banner-angle:${35+(seed%110)}deg;${image}`;}
    function attributes(id){const item=bannerById(id)||bannerById(DEFAULT_BANNER_ID);if(!item||item.id===DEFAULT_BANNER_ID)return '';return `data-player-banner="${esc(item.id)}" data-banner-style="${esc(item.style)}" style="${variables(item)}"`;}
    function clearAppliedBanner(element){if(!element)return;delete element.dataset.playerBanner;delete element.dataset.bannerStyle;['--banner-one','--banner-two','--banner-accent','--banner-shift','--banner-angle','--banner-image'].forEach(property=>element.style.removeProperty(property));}
    function applyTo(element,id){const item=bannerById(id)||bannerById(DEFAULT_BANNER_ID);if(!element||!item)return false;if(item.id===DEFAULT_BANNER_ID){clearAppliedBanner(element);return true;}element.dataset.playerBanner=item.id;element.dataset.bannerStyle=item.style;element.style.setProperty('--banner-one',item.b1);element.style.setProperty('--banner-two',item.b2);element.style.setProperty('--banner-accent',item.accent);if(item.menuBg)element.style.setProperty('--banner-image',`url("${safeCssUrl(item.menuBg)}")`);else element.style.removeProperty('--banner-image');const seed=Math.max(0,Number(item.seed)||hash(item.id));element.style.setProperty('--banner-shift',`${seed%47}px`);element.style.setProperty('--banner-angle',`${35+(seed%110)}deg`);return true;}
    function previewMarkup(item,size='card'){
        const isDefault=item.id===DEFAULT_BANNER_ID;
        /* The wide preview uses the authored banner image as its environment,
           while this small foreground emblem makes the cosmetic immediately
           recognizable in Inventory and the Collection Index.  Skin-linked
           banners use the real in-game skin art; market banners use the icon
           the full banner was designed from. */
        const art=item.skinUnlock?(item.skinFile||item.icon):(item.icon||item.menuBg);
        const classes=[`banner-preview`,`banner-preview-${esc(size)}`,item.skinUnlock?'skin-linked-banner':'market-banner-preview',isDefault?'banner-default-preview':''].filter(Boolean).join(' ');
        return `<div class="${classes}" data-banner-id="${esc(item.id)}" data-banner-style="${esc(item.style)}" style="${variables(item)}" role="img" aria-label="${esc(item.name)} preview">${art?`<span class="banner-preview-art"><img class="banner-preview-icon${item.skinUnlock?' skin-banner-icon':''}" src="${esc(art)}" alt="" loading="lazy" decoding="async"></span>`:''}</div>`;
    }

    function setBannerOwned(id, owned = true) {
        const item=bannerById(id);if(!item)return false;
        if(owned)ownedBanners.add(id);else ownedBanners.delete(id);
        bannerOwnershipDirty=true;
        if(!collectionBatchActive())flushBannerOwnership();
        if(!owned&&selectedBanner()===id)selectBanner(DEFAULT_BANNER_ID);
        if(collectionBatchActive()){window.__flappyCollectionBatchDirty=true;}
        else{window.dispatchEvent(new CustomEvent('flappy-collection-changed',{detail:{category:'banners',itemId:id,owned:Boolean(owned)}}));if(bannerMarketVisible())renderBannerMarket();}
        return true;
    }

    function currentCoinBalance(){
        const live=typeof monkeyCoins!=='undefined'&&Number.isFinite(Number(monkeyCoins))?Math.max(0,Math.floor(Number(monkeyCoins))):0;
        const stored=Math.max(0,Number.parseInt(localStorage.getItem('monkeyCoins')||'0',10)||0);
        const shown=Math.max(0,Number.parseInt(document.getElementById('shopCoins')?.textContent||'0',10)||0);
        return Math.max(live,stored,shown);
    }
    function spend(cost){
        const price=Math.max(0,Math.floor(Number(cost)||0)),balance=currentCoinBalance();
        if(balance<price)return false;
        const next=Math.max(0,balance-price);
        if(typeof monkeyCoins!=='undefined')monkeyCoins=balance;
        if(typeof spendBananaCoins==='function')spendBananaCoins(price);
        else localStorage.setItem('monkeyCoins',String(next));
        if(typeof monkeyCoins!=='undefined')monkeyCoins=next;
        localStorage.setItem('monkeyCoins',String(next));
        const displayed=document.getElementById('shopCoins');if(displayed)displayed.textContent=String(next);
        return true;
    }
    function buyBanner(id){const item=MARKET_BANNERS.find(entry=>entry.id===id);if(!item||ownsBanner(id))return;if(!spend(item.cost)){window.gameAlert?.(`You need more Banana Coins for ${item.name}.`,{title:'Not Enough Bananas'})||window.alert('Not enough Banana Coins.');return;}ownedBanners.add(id);localStorage.setItem(BANNER_OWNED_KEY,JSON.stringify([...ownedBanners]));selectBanner(id);window.dispatchEvent(new CustomEvent('flappy-collection-changed',{detail:{category:'banners',itemId:id,owned:true}}));renderBannerMarket();}

    const EMOTES=Object.freeze([
        ['wave','Wave','uncommon',200,'wave',''],
        ['banana-shuffle','Banana Shuffle','uncommon',200,'shuffle','assets/audio/emotes/banana-shuffle.mp3'],
        ['monkey-groove','Monkey Groove','rare',500,'groove','assets/audio/emotes/monkey-groove.mp3'],
        ['crown-bounce','Crown Bounce','rare',500,'bounce','assets/audio/emotes/crown-bounce.mp3'],
        ['pirate-jig','Pirate Jig','rare',500,'jig','assets/audio/emotes/pirate-jig.mp3'],
        ['snow-spin','Snow Spin','rare',500,'spin','assets/audio/emotes/snow-spin.mp3'],
        ['robot-glitch','Robot Glitch','epic',800,'robot','assets/audio/emotes/robot-glitch.mp3'],
        ['inferno-stomp','Inferno Stomp','epic',800,'stomp','assets/audio/emotes/inferno-stomp.mp3'],
        ['galaxy-float','Galaxy Float','epic',800,'float','assets/audio/emotes/galaxy-float.mp3'],
        ['disco-peel','Disco Peel','epic',800,'disco','assets/audio/emotes/disco-peel.mp3'],
        ['victory-flex','Victory Flex','epic',800,'flex','assets/audio/emotes/victory-flex.mp3']
    ].map(([id,name,rarity,cost,animation,audio])=>({id,name,icon:`assets/emotes/emote-${id}.png`,rarity,cost,animation,audio,duration:audio?86400000:(id==='wave'?8000:12000),loop:Boolean(audio),description:`Perform the ${name} animation in Monkey World.`})));
    let ownedEmotes=readSet(EMOTE_OWNED_KEY);
    let emoteOwnershipDirty=false;
    function flushEmoteOwnership(){if(!emoteOwnershipDirty)return false;localStorage.setItem(EMOTE_OWNED_KEY,JSON.stringify([...ownedEmotes]));emoteOwnershipDirty=false;return true;}
    function ownsEmote(id){return ownedEmotes.has(id);}
    function buyEmote(id){const item=EMOTES.find(entry=>entry.id===id);if(!item||ownsEmote(id))return;if(!spend(item.cost)){window.gameAlert?.(`You need more Banana Coins for ${item.name}.`,{title:'Not Enough Bananas'})||window.alert('Not enough Banana Coins.');return;}ownedEmotes.add(id);localStorage.setItem(EMOTE_OWNED_KEY,JSON.stringify([...ownedEmotes]));window.dispatchEvent(new CustomEvent('flappy-collection-changed',{detail:{category:'emotes',itemId:id,owned:true}}));renderEmoteMarket();}
    function setEmoteOwned(id,owned=true){if(!EMOTES.some(item=>item.id===id))return false;if(owned)ownedEmotes.add(id);else ownedEmotes.delete(id);emoteOwnershipDirty=true;if(!collectionBatchActive())flushEmoteOwnership();if(collectionBatchActive()){window.__flappyCollectionBatchDirty=true;}else{window.dispatchEvent(new CustomEvent('flappy-collection-changed',{detail:{category:'emotes',itemId:id,owned:Boolean(owned)}}));const grid=document.getElementById('emotesMarketGrid');if(grid&&grid.style.display!=='none'&&document.getElementById('shopMenu')?.classList.contains('open'))renderEmoteMarket();}return true;}

    function installMarket() {
        const tabs=document.getElementById('shopTabs'),shop=document.getElementById('shopMenu'),close=document.getElementById('closeShopMenu');if(!tabs||!shop||!close||document.querySelector('[data-tab="banners"]'))return;
        const createTab=(id,label,icon)=>{const button=document.createElement('button');button.className='shop-tab shop-tab-with-icon';button.dataset.tab=id;button.innerHTML=`<img class="market-tab-art" src="${icon}" alt="" aria-hidden="true">${label}`;return button;};
        const bannerTab=createTab('banners','Banners','assets/market-tabs/banners.png?v=20260808e'),emoteTab=createTab('emotes','Emotes','assets/market-tabs/emotes.png?v=20260808e'),crate=tabs.querySelector('[data-tab="crates"]');tabs.insertBefore(bannerTab,crate);tabs.insertBefore(emoteTab,crate);
        const bannerGrid=document.createElement('div');bannerGrid.id='bannersGrid';bannerGrid.className='banana-market-grid feature-market-grid';bannerGrid.style.display='none';
        const emoteGrid=document.createElement('div');emoteGrid.id='emotesMarketGrid';emoteGrid.className='banana-market-grid feature-market-grid';emoteGrid.style.display='none';shop.insertBefore(bannerGrid,close);shop.insertBefore(emoteGrid,close);
        const gridForTab={trails:'trailsGrid',boosts:'boostsGrid',explosions:'explosionsGrid',pipes:'pipesGrid','title-styles':'titleStylesGrid','background-themes':'backgroundThemesGrid','monkey-skins':'monkeySkinsGrid',emojis:'emojisGrid','monkey-xp':'monkeyXpGrid',auras:'aurasGrid','event-vault':'eventVaultGrid',banners:'bannersGrid',emotes:'emotesMarketGrid',crates:'cratesGrid'};
        const renderForTab={banners:renderBannerMarket,emotes:renderEmoteMarket,auras:()=>window.FlappyAuras?.renderMarket?.(),'monkey-xp':()=>window.FlappyAuras?.renderXpMarket?.(),'event-vault':()=>window.FlappyAuras?.renderEventVault?.()};
        tabs.addEventListener('click',event=>{
            const tab=event.target.closest('.shop-tab');if(!tab||!tabs.contains(tab))return;
            const grid=document.getElementById(gridForTab[tab.dataset.tab]||'');if(!grid)return;
            event.preventDefault();event.stopImmediatePropagation();
            tabs.querySelectorAll('.shop-tab').forEach(entry=>entry.classList.toggle('active',entry===tab));
            shop.querySelectorAll('.banana-market-grid').forEach(entry=>{entry.style.display='none';});
            grid.style.display=['trails','boosts','explosions','pipes','title-styles','background-themes','monkey-skins','emojis','crates'].includes(tab.dataset.tab)?'flex':'grid';
            renderForTab[tab.dataset.tab]?.();
        },true);
    }
    function renderBannerMarket(){const grid=document.getElementById('bannersGrid');if(!grid)return;const selected=selectedBanner();grid.innerHTML='<h3 class="feature-market-title">Animated Banners</h3><p class="feature-market-subtitle">These Banana Market banners style your online name cards. Skin-linked banners unlock with their matching skin and appear in Inventory, not here. Default Banner is always equipped whenever no other banner is selected.</p>';for(const item of MARKET_BANNERS){const owned=ownsBanner(item.id),equipped=selected===item.id,card=document.createElement('article');card.className=`shop-option feature-market-card rarity-${item.rarity}${equipped?' selected':''}`;card.innerHTML=`${previewMarkup(item)}<h3>${esc(item.name)}</h3><span class="feature-rarity">${esc(item.rarity)}</span><p>${esc(item.description)}</p><strong>${owned?(equipped?'EQUIPPED':'OWNED'):`${item.cost} 🍌`}</strong><button type="button" ${equipped?'disabled':''}>${equipped?'EQUIPPED':owned?'EQUIP BANNER':`BUY · ${item.cost} 🍌`}</button>`;card.querySelector('button').addEventListener('click',()=>owned?selectBanner(item.id):buyBanner(item.id));grid.appendChild(card);}}
    function renderEmoteMarket(){const grid=document.getElementById('emotesMarketGrid');if(!grid)return;grid.innerHTML='<h3 class="feature-market-title">Monkey World Emotes</h3><p class="feature-market-subtitle">Owned emotes appear on your B-key emote wheel in Monkey World.</p>';for(const item of EMOTES){const owned=ownsEmote(item.id),card=document.createElement('article');card.className=`shop-option feature-market-card rarity-${item.rarity}`;card.innerHTML=`<div class="emote-market-icon emote-${item.animation}"><img src="${esc(item.icon)}" alt=""></div><h3>${esc(item.name)}</h3><span class="feature-rarity">${esc(item.rarity)}</span><p>${esc(item.description)}</p><strong>${owned?'OWNED':`${item.cost} 🍌`}</strong><button type="button" ${owned?'disabled':''}>${owned?'IN EMOTE WHEEL':`BUY · ${item.cost} 🍌`}</button>`;if(!owned)card.querySelector('button').addEventListener('click',()=>buyEmote(item.id));grid.appendChild(card);}}

    function installEmoteWheel(){
        const world=document.getElementById('mwGame');if(!world||document.getElementById('mwEmoteWheel'))return;
        const trigger=document.createElement('button');trigger.id='mwEmoteTrigger';trigger.type='button';trigger.setAttribute('aria-label','Open Monkey World emote wheel');trigger.innerHTML='<img src="assets/market-tabs/emotes.png?v=20260810a" alt=""><span>B · EMOTES</span>';
        const wheel=document.createElement('section');wheel.id='mwEmoteWheel';wheel.setAttribute('aria-hidden','true');wheel.innerHTML='<header><strong>MONKEY WORLD EMOTES</strong><span>B / D-Pad Down to close</span></header><div id="mwEmoteWheelItems"></div>';
        world.append(trigger,wheel);
        const render=()=>{const items=EMOTES.filter(item=>ownsEmote(item.id)),grid=wheel.querySelector('#mwEmoteWheelItems');grid.innerHTML=items.length?items.map((item,index)=>`<button type="button" data-world-emote="${esc(item.id)}" style="--emote-index:${index}"><img src="${esc(item.icon)}" alt=""><span>${esc(item.name)}</span>${item.audio?'<i>♫</i>':''}</button>`).join(''):'<p>Buy an emote from the Banana Market to add it here.</p>';};
        const open=value=>{const next=value??!wheel.classList.contains('open');if(next)render();wheel.classList.toggle('open',next);wheel.setAttribute('aria-hidden',String(!next));trigger.classList.toggle('active',next);};
        const perform=id=>{if(!ownsEmote(id))return;open(false);window.dispatchEvent(new CustomEvent('flappy-monkey-world-emote-request',{detail:{id}}));};
        trigger.addEventListener('click',()=>open());
        wheel.addEventListener('click',event=>{const button=event.target.closest('[data-world-emote]');if(button)perform(button.dataset.worldEmote);});
        window.addEventListener('keydown',event=>{const binding=window.gameControls?.emoteWheel||'KeyB',worldOpen=document.getElementById('monkeyWorldScreen')?.classList.contains('open');if(!worldOpen||event.code!==binding||event.repeat||/INPUT|TEXTAREA|SELECT/.test(event.target?.tagName||''))return;event.preventDefault();event.stopImmediatePropagation();open();},true);
        let padDown=false,padConfirm=false,padIndex=0,padFrame=0;
        const worldIsOpen=()=>document.getElementById('monkeyWorldScreen')?.classList.contains('open');
        const pollPad=()=>{
            padFrame=0;
            if(!worldIsOpen()){padDown=false;padConfirm=false;return;}
            const pad=navigator.getGamepads?.()[0];
            if(pad){const down=Boolean(pad.buttons?.[13]?.pressed);if(down&&!padDown)open();padDown=down;const buttons=[...wheel.querySelectorAll('[data-world-emote]')];if(wheel.classList.contains('open')&&buttons.length){const x=Number(pad.axes?.[0])||0,y=Number(pad.axes?.[1])||0;if(Math.hypot(x,y)>.55){const angle=(Math.atan2(y,x)+Math.PI*2)%(Math.PI*2);padIndex=Math.round(angle/(Math.PI*2)*buttons.length)%buttons.length;buttons.forEach((button,index)=>button.classList.toggle('controller-selected',index===padIndex));}const confirm=Boolean(pad.buttons?.[0]?.pressed);if(confirm&&!padConfirm)perform(buttons[padIndex]?.dataset.worldEmote);padConfirm=confirm;}else padConfirm=false;}else{padDown=false;padConfirm=false;}
            padFrame=requestAnimationFrame(pollPad);
        };
        const startPadPolling=()=>{if(worldIsOpen()&&!padFrame)padFrame=requestAnimationFrame(pollPad);};
        const worldScreen=document.getElementById('monkeyWorldScreen');
        if(worldScreen)new MutationObserver(startPadPolling).observe(worldScreen,{attributes:true,attributeFilter:['class']});
        window.addEventListener('gamepadconnected',startPadPolling);
        startPadPolling();
        window.addEventListener('flappy-collection-changed',event=>{if(event.detail?.category==='emotes'&&wheel.classList.contains('open'))render();});
    }

    window.FlappyBanners=Object.freeze({get definitions(){return bannerDefinitions();},market:MARKET_BANNERS,owns:ownsBanner,selectedId:selectedBanner,select:selectBanner,setOwned:setBannerOwned,flushOwned:flushBannerOwnership,attributes,applyTo,previewMarkup,byId:bannerById,renderMarket:renderBannerMarket});
    window.FlappyEmotes=Object.freeze({definitions:EMOTES,owns:ownsEmote,setOwned:setEmoteOwned,flushOwned:flushEmoteOwnership,renderMarket:renderEmoteMarket});
    installMarket();
    installEmoteWheel();
    window.addEventListener('flappy-banner-changed',event=>{
        const id=event.detail?.id||selectedBanner();
        applyTo(document.getElementById('usernameDisplayHeader'),id);
    });
    if (!document.getElementById('mwEmoteWheel')) {
        window.addEventListener('DOMContentLoaded', installEmoteWheel, { once:true });
        window.addEventListener('load', installEmoteWheel, { once:true });
        setTimeout(installEmoteWheel, 0);
    }
    if (localStorage.getItem(BANNER_SELECTED_KEY) === 'none' || !localStorage.getItem(BANNER_SELECTED_KEY)) selectBanner(DEFAULT_BANNER_ID);
    window.addEventListener('flappy-skins-changed',()=>{if(selectedBanner()!==localStorage.getItem(BANNER_SELECTED_KEY))selectBanner(DEFAULT_BANNER_ID);});
})();
