(function installMonkeyWorld3D(global) {
    'use strict';
    document.documentElement.dataset.monkeyWorld3d = 'loading';

    const loadThree = async () => {
        if (typeof global.require === 'function') {
            try { return global.require('three'); } catch (_) {}
        }
        try {
            // This bundled browser module is part of the shipped game, so the
            // 3D coast works on GitHub/static hosting as well as in the EXE.
            return await import('./assets/vendor/three.module.min.js?v=20260815b');
        } catch (bundledError) {
            try {
                // Kept as a compatibility path for the local preview server.
                return await import('/__flappy_vendor__/three.module.js');
            } catch (_) {
                throw bundledError;
            }
        }
    };

    global.FlappyMonkeyWorld3DReady = loadThree().then((THREE) => {
        const WORLD_WIDTH = 5200;
        const WORLD_HEIGHT = 3400;
        const WORLD_SCALE = 100;
        const TAU = Math.PI * 2;
        const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
        const seeded = (index, salt = 0) => {
            const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
            return value - Math.floor(value);
        };
        const disposeObject = (object) => {
            object?.traverse?.((child) => {
                child.geometry?.dispose?.();
                if (Array.isArray(child.material)) child.material.forEach((material) => material?.dispose?.());
                else child.material?.dispose?.();
            });
            object?.removeFromParent?.();
        };

        class BananaCoast3D {
            constructor(options = {}) {
                this.root = options.root;
                this.worldWidth = Number(options.worldWidth) || WORLD_WIDTH;
                this.worldHeight = Number(options.worldHeight) || WORLD_HEIGHT;
                this.buildings = Array.isArray(options.buildings) ? options.buildings : [];
                this.ready = false;
                this.playerNodes = new Map();
                this.textureCache = new Map();
                this.animatedTextures = new Set();
                this.animatedTextureImages = new Map();
                this.animatedTextureStates = new Map();
                this.animatedImageHost = null;
                this.lastAnimatedTextureRefresh = 0;
                this.animatedFrameSerial = 0;
                this.eventNodes = new Map();
                this.buildingGroups = [];
                this.transientEffects = [];
                this.lastEventId = '';
                this.lastWidth = 0;
                this.lastHeight = 0;
                this.pixelRatio = 1;
                this.performanceSamples = [];
                this.roadKeepouts = [];
                this.environmentCollisions = [];
                this.lastRenderAt = 0;
                this.qualityReduced = false;
                this.qualityStage = 0;
                this.lastAverageFrameMs = 0;
                this.lastStatsAt = 0;
                this.nightLights = [];
                this.lastLightPhase = '';
                this.target = new THREE.Vector3();
                this.cameraTarget = new THREE.Vector3();
                this.desiredCamera = new THREE.Vector3();
                this.backgroundTarget = new THREE.Color();
                this.fogTarget = new THREE.Color();
                this.sunColorTarget = new THREE.Color();

                this.canvas = document.createElement('canvas');
                this.canvas.id = 'monkeyWorld3DCanvas';
                this.canvas.className = 'mw-three-canvas';
                this.canvas.setAttribute('aria-label', '3D Banana Coast');
                this.canvas.setAttribute('role', 'img');
                this.root?.prepend(this.canvas);
                try {
                    this.createRenderer();
                    this.createScene();
                    this.ready = true;
                    document.documentElement.dataset.monkeyWorld3d = 'ready';
                } catch (error) {
                    console.warn('Monkey World 3D unavailable; using the 2D fallback.', error);
                    document.documentElement.dataset.monkeyWorld3d = `fallback:${String(error?.message || error).slice(0,120)}`;
                    this.canvas.remove();
                }
                this.onEventEffect = (message) => this.handleEventEffect(message.detail || {});
                global.addEventListener('flappy-monkey-world-event-effect', this.onEventEffect);
            }

            worldPosition(x, y, elevation = 0) {
                return new THREE.Vector3(
                    (Number(x) - this.worldWidth / 2) / WORLD_SCALE,
                    elevation,
                    (Number(y) - this.worldHeight / 2) / WORLD_SCALE
                );
            }

            mapPosition(x, z) {
                return {
                    x:Number(x) * WORLD_SCALE + this.worldWidth / 2,
                    y:Number(z) * WORLD_SCALE + this.worldHeight / 2
                };
            }

            registerEnvironmentCollision(x, z, radius) {
                const point = this.mapPosition(x, z);
                this.environmentCollisions.push({ x:point.x, y:point.y, radius:Math.max(4, Number(radius) || 4) });
            }

            collidesEnvironment(x, y, extraRadius = 12) {
                const px=Number(x),py=Number(y),padding=Math.max(0,Number(extraRadius)||0);
                if(!Number.isFinite(px)||!Number.isFinite(py))return false;
                return this.environmentCollisions.some((obstacle)=>Math.hypot(px-obstacle.x,py-obstacle.y)<obstacle.radius+padding);
            }

            createRenderer() {
                this.renderer = new THREE.WebGLRenderer({
                    canvas:this.canvas,
                    antialias:true,
                    alpha:false,
                    powerPreference:'high-performance',
                    preserveDrawingBuffer:false
                });
                this.renderer.outputColorSpace = THREE.SRGBColorSpace;
                this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
                this.renderer.toneMappingExposure = 1.12;
                this.renderer.shadowMap.enabled = true;
                this.renderer.shadowMap.type = THREE.PCFShadowMap;
                const memory = Number(navigator.deviceMemory) || 8;
                // Full-screen 1.6x rendering plus a 2048px live shadow map was
                // enough to drop mid-range GPUs into single digits. Native 1x
                // stays crisp at desktop resolution and leaves room for events.
                this.pixelRatio = Math.min(memory <= 4 ? .9 : 1, Math.max(.82, Number(devicePixelRatio) || 1));
                this.renderer.setPixelRatio(this.pixelRatio);
            }

            material(color, options = {}) {
                return new THREE.MeshStandardMaterial({
                    color,
                    roughness:options.roughness ?? .72,
                    map:options.map || null,
                    bumpMap:options.bumpMap || null,
                    bumpScale:options.bumpScale ?? .025,
                    metalness:options.metalness ?? .02,
                    emissive:options.emissive || 0x000000,
                    emissiveIntensity:options.emissiveIntensity || 0,
                    transparent:Boolean(options.transparent),
                    opacity:options.opacity ?? 1,
                    side:options.side || THREE.FrontSide
                });
            }

            patternTexture(name,size,repeatX,repeatY,draw){
                const key=`pattern:${name}`;if(this.textureCache.has(key))return this.textureCache.get(key);
                const texture=this.canvasTexture(size,size,draw);texture.wrapS=THREE.RepeatWrapping;texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(repeatX,repeatY);texture.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());this.textureCache.set(key,texture);return texture;
            }

            createProceduralTextures(){
                const noise=(context,size,count,colors)=>{for(let index=0;index<count;index+=1){context.globalAlpha=.1+seeded(index,77)*.28;context.fillStyle=colors[index%colors.length];context.beginPath();context.arc(seeded(index,78)*size,seeded(index,79)*size,.4+seeded(index,80)*1.8,0,TAU);context.fill();}context.globalAlpha=1;};
                this.surfaceTextures={
                    grass:this.patternTexture('grass',256,12,8,(context,size)=>{const gradient=context.createLinearGradient(0,0,size,size);gradient.addColorStop(0,'#9bd47c');gradient.addColorStop(1,'#3b8b4f');context.fillStyle=gradient;context.fillRect(0,0,size,size);noise(context,size,720,['#d4e993','#286d40','#73b761','#f2da80']);context.lineWidth=1.2;for(let index=0;index<150;index+=1){const x=seeded(index,301)*size,y=seeded(index,302)*size;context.strokeStyle=index%3?'rgba(18,93,48,.38)':'rgba(230,244,163,.3)';context.beginPath();context.moveTo(x,y);context.quadraticCurveTo(x+3,y-6,x+seeded(index,303)*5,y-10);context.stroke();}}),
                    sand:this.patternTexture('sand',256,9,6,(context,size)=>{const gradient=context.createLinearGradient(0,0,0,size);gradient.addColorStop(0,'#ffe8a5');gradient.addColorStop(1,'#d2a85d');context.fillStyle=gradient;context.fillRect(0,0,size,size);noise(context,size,900,['#fff3c4','#b77f3f','#ecc87a','#8e683d']);}),
                    road:this.patternTexture('road',256,12,3,(context,size)=>{context.fillStyle='#415459';context.fillRect(0,0,size,size);noise(context,size,760,['#26393d','#728084','#506368','#1d3034']);}),
                    paving:this.patternTexture('paving',256,6,6,(context,size)=>{context.fillStyle='#d8c094';context.fillRect(0,0,size,size);context.strokeStyle='rgba(81,58,38,.32)';context.lineWidth=3;for(let y=0;y<size+42;y+=42)for(let x=-42;x<size+42;x+=42)context.strokeRect(x+(Math.floor(y/42)%2)*21,y,42,42);noise(context,size,240,['#fff0bf','#927253','#bf9a6d']);}),
                    stucco:this.patternTexture('stucco',256,3,2,(context,size)=>{context.fillStyle='#f2ead0';context.fillRect(0,0,size,size);noise(context,size,820,['#ffffff','#b8aa91','#e3d5bc','#8f836f']);}),
                    roof:this.patternTexture('roof',256,5,4,(context,size)=>{context.fillStyle='#934f3a';context.fillRect(0,0,size,size);context.strokeStyle='rgba(255,222,168,.3)';context.lineWidth=3;for(let y=0;y<size;y+=27)for(let x=-20;x<size;x+=42){context.beginPath();context.arc(x+(Math.floor(y/27)%2)*21,y,24,0,Math.PI);context.stroke();}noise(context,size,180,['#d47a55','#5e302c','#ef9a65']);}),
                    wood:this.patternTexture('wood',256,8,2,(context,size)=>{context.fillStyle='#996238';context.fillRect(0,0,size,size);for(let y=9;y<size;y+=22){context.strokeStyle='rgba(55,28,16,.38)';context.lineWidth=2;context.beginPath();context.moveTo(0,y);context.bezierCurveTo(size*.3,y+6,size*.7,y-6,size,y+2);context.stroke();}noise(context,size,160,['#d49a58','#61381f','#b77a42']);}),
                    stone:this.patternTexture('stone',256,5,4,(context,size)=>{context.fillStyle='#a99573';context.fillRect(0,0,size,size);context.strokeStyle='rgba(55,45,34,.36)';context.lineWidth=3;for(let y=0;y<size;y+=48)for(let x=-32;x<size;x+=64)context.strokeRect(x+(Math.floor(y/48)%2)*32,y,64,48);noise(context,size,260,['#d5c299','#73644f','#b5a17d']);})
                };
                this.palmFrondTexture=this.canvasTexture(512,192,(context,width,height)=>{
                    context.clearRect(0,0,width,height);
                    const centerAt=(progress)=>({x:18+progress*(width-34),y:height*.57-Math.pow(progress,1.55)*height*.24});
                    for(let index=1;index<17;index+=1){
                        const progress=index/18,center=centerAt(progress),remaining=1-progress;
                        const leafLength=12+remaining*50,leafWidth=4+remaining*8;
                        for(const direction of [-1,1]){
                            const curl=direction*(leafLength*(.72+.2*Math.sin(index*.8)));
                            const tipX=center.x+leafLength*.16;
                            const tipY=center.y+curl;
                            const gradient=context.createLinearGradient(center.x,center.y,tipX,tipY);
                            gradient.addColorStop(0,index%2?'#1e8750':'#2ea85b');
                            gradient.addColorStop(.72,index%2?'#48bd62':'#68ca69');
                            gradient.addColorStop(1,'rgba(164,226,107,.24)');
                            context.fillStyle=gradient;
                            context.beginPath();
                            context.moveTo(center.x-2,center.y);
                            context.bezierCurveTo(center.x+leafLength*.22,center.y+curl*.22,tipX-leafWidth,tipY-direction*leafWidth,tipX,tipY);
                            context.bezierCurveTo(tipX-leafWidth*.2,tipY+direction*leafWidth,center.x+leafLength*.08,center.y+direction*leafWidth*.32,center.x-2,center.y);
                            context.fill();
                        }
                    }
                    const vein=context.createLinearGradient(0,0,width,0);vein.addColorStop(0,'#79542e');vein.addColorStop(.22,'#91bd53');vein.addColorStop(1,'rgba(193,224,105,.35)');
                    context.strokeStyle=vein;context.lineWidth=6;context.lineCap='round';context.beginPath();context.moveTo(12,height*.57);context.bezierCurveTo(width*.32,height*.55,width*.72,height*.48,width-12,height*.33);context.stroke();
                    context.strokeStyle='rgba(235,244,143,.48)';context.lineWidth=1.5;context.stroke();
                });
                this.palmFrondTexture.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());
            }

            createSky(){
                this.skyUniforms={uNight:{value:0},uSunset:{value:0}};
                this.sky=new THREE.Mesh(new THREE.SphereGeometry(72,48,24),new THREE.ShaderMaterial({uniforms:this.skyUniforms,side:THREE.BackSide,depthWrite:false,vertexShader:'varying vec3 vWorld;void main(){vWorld=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'uniform float uNight;uniform float uSunset;varying vec3 vWorld;void main(){float h=clamp(normalize(vWorld).y*.5+.5,0.,1.);vec3 day=mix(vec3(.82,.96,1.),vec3(.11,.58,.88),smoothstep(.18,.9,h));vec3 dusk=mix(vec3(1.,.48,.28),vec3(.38,.12,.48),smoothstep(.1,1.,h));vec3 night=mix(vec3(.025,.045,.12),vec3(.01,.015,.06),h);gl_FragColor=vec4(mix(mix(day,dusk,uSunset),night,uNight),1.);}'}));this.sky.renderOrder=-100;this.scene.add(this.sky);
                this.sunDisc=new THREE.Mesh(new THREE.SphereGeometry(.95,24,16),new THREE.MeshBasicMaterial({color:0xffef9d,transparent:true,opacity:.9}));this.sunDisc.position.set(-24,22,-34);this.scene.add(this.sunDisc);
                // Broad, partially submerged domes read as distant islands.
                // The old cone primitives looked like spikes in the ocean.
                const islandMaterials=[this.material(0x527c63,{roughness:1}),this.material(0x6c8d68,{roughness:1}),this.material(0x4e735b,{roughness:1})];
                for(let index=0;index<9;index+=1){
                    const angle=index/9*TAU+.18,radius=27+seeded(index,811)*7;
                    const mound=new THREE.Mesh(new THREE.SphereGeometry(1,24,12),islandMaterials[index%islandMaterials.length]);
                    mound.position.set(Math.cos(angle)*radius,-1.18,Math.sin(angle)*radius*.72);
                    mound.scale.set(2.7+seeded(index,812)*2.4,.72+seeded(index,813)*.42,1.8+seeded(index,814)*1.8);
                    mound.rotation.y=seeded(index,815)*TAU;this.environment.add(mound);
                }
            }
            clearInterior(){while(this.interiorLayer?.children?.length)disposeObject(this.interiorLayer.children[0]);this.interiorPlayer=null;this.interiorId='';}

            enterInterior(id){
                if(!id||this.interiorId===id)return;this.clearInterior();this.interiorId=String(id);this.interiorLayer.visible=true;
                this.renderer.shadowMap.enabled=false;
                this.sunLight.castShadow=false;
                const themes={market:{wall:0xe6a43d,trim:0xffd968,floor:'paving'},wardrobe:{wall:0x8a5bd0,trim:0xd7a3ff,floor:'wood'},cafe:{wall:0xe87558,trim:0xffc883,floor:'paving'},arcade:{wall:0x315fc8,trim:0x6be0ff,floor:'road'},clan:{wall:0x2f8152,trim:0xffdf70,floor:'stone'}},theme=themes[this.interiorId]||themes.market;
                const floorMap=this.surfaceTextures[theme.floor]||this.surfaceTextures.wood,floor=new THREE.Mesh(new THREE.BoxGeometry(11,.18,7.4),this.material(0xffffff,{map:floorMap,bumpMap:floorMap,bumpScale:.026,roughness:.83}));floor.position.y=.08;floor.receiveShadow=true;this.interiorLayer.add(floor);
                const wallMaterial=this.material(theme.wall,{map:this.surfaceTextures.stucco,bumpMap:this.surfaceTextures.stucco,bumpScale:.028,roughness:.75});for(const [x,y,z,w,h,d] of [[0,1.8,-3.65,11,3.6,.18],[-5.42,1.8,0,.18,3.6,7.2],[5.42,1.8,0,.18,3.6,7.2]]){const wall=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),wallMaterial);wall.position.set(x,y,z);wall.receiveShadow=true;wall.castShadow=true;this.interiorLayer.add(wall);}
                const trimMaterial=this.material(theme.trim,{roughness:.55});for(const y of [.28,3.28]){const trim=new THREE.Mesh(new THREE.BoxGeometry(10.95,.16,.16),trimMaterial);trim.position.set(0,y,-3.5);this.interiorLayer.add(trim);}for(const x of [-5.05,-2.55,0,2.55,5.05]){const column=new THREE.Mesh(new THREE.BoxGeometry(.18,3.15,.22),this.material(0x725033,{map:this.surfaceTextures.wood,roughness:.88}));column.position.set(x,1.68,-3.42);column.castShadow=true;this.interiorLayer.add(column);}const rug=new THREE.Mesh(new THREE.PlaneGeometry(7.4,2.7),new THREE.MeshStandardMaterial({color:theme.trim,roughness:.72,transparent:true,opacity:.22}));rug.rotation.x=-Math.PI/2;rug.position.set(0,.185,1.05);this.interiorLayer.add(rug);for(const x of [-3.65,0,3.65]){const frame=new THREE.Mesh(new THREE.BoxGeometry(2.25,1.42,.12),this.material(0x6a452d,{map:this.surfaceTextures.wood,roughness:.8}));frame.position.set(x,2.28,-3.35);this.interiorLayer.add(frame);const glass=new THREE.Mesh(new THREE.PlaneGeometry(1.88,1.08),new THREE.MeshPhysicalMaterial({color:0x7fd5e5,emissive:0x123d48,emissiveIntensity:.3,transparent:true,opacity:.72,roughness:.12,metalness:.08}));glass.position.set(x,2.28,-3.27);this.interiorLayer.add(glass);}
                const roomNames={market:'BANANA MARKET',wardrobe:'MONKEY STYLE',cafe:'BANANA CAFÉ',arcade:'MONKEY ARCADE',clan:'CLAN HALL'},titleSign=new THREE.Mesh(new THREE.PlaneGeometry(3.9,.72),new THREE.MeshBasicMaterial({map:this.createTextTexture(roomNames[this.interiorId]||'BANANA COAST',{width:900,height:170,fontSize:52,background:'rgba(3,34,31,.94)',border:'#ffe477'}),transparent:true,depthWrite:false}));titleSign.position.set(0,2.95,-3.2);this.interiorLayer.add(titleSign);const labels={market:['CRATE COUNTER','BOOST SHELF','COSMETICS WALL'],wardrobe:['MONKEY WARDROBE','INVENTORY','TITLE STUDIO'],cafe:['SMOOTHIE BAR','FRIENDS TABLE'],arcade:['ONLINE CABINETS','PROFILE TERMINAL'],clan:['CLAN COMMAND','RECRUITMENT BOARD']},names=labels[this.interiorId]||labels.market,positions=names.length===2?[[-2.6,-1.85],[2.6,-1.85]]:[[-3,-1.65],[0,-2.35],[3,-1.65]];
                names.forEach((name,index)=>{const [x,z]=positions[index],counter=new THREE.Mesh(new THREE.BoxGeometry(2.25,1.05,.76),this.material(index%2?theme.trim:theme.wall,{map:this.surfaceTextures.wood,bumpMap:this.surfaceTextures.wood,bumpScale:.02,roughness:.76}));counter.position.set(x,.62,z);counter.castShadow=true;this.interiorLayer.add(counter);const sign=new THREE.Mesh(new THREE.PlaneGeometry(2.2,.58),new THREE.MeshBasicMaterial({map:this.createTextTexture(name,{width:620,height:150,fontSize:39,background:'rgba(3,34,31,.96)',border:'#ffe477'}),transparent:true,depthWrite:false}));sign.position.set(x,1.55,z-.4);this.interiorLayer.add(sign);const marker=new THREE.Mesh(new THREE.RingGeometry(.48,.62,38),new THREE.MeshBasicMaterial({color:theme.trim,transparent:true,opacity:.62,side:THREE.DoubleSide}));marker.rotation.x=-Math.PI/2;marker.position.set(x,.21,z+.85);marker.userData.interiorMarker=true;marker.userData.phase=index*1.7;this.interiorLayer.add(marker);});
                const exitSign=new THREE.Mesh(new THREE.PlaneGeometry(2.2,.58),new THREE.MeshBasicMaterial({map:this.createTextTexture('EXIT TO BANANA COAST',{width:620,height:150,fontSize:36,background:'rgba(68,19,22,.96)',border:'#ff9c83'}),transparent:true,depthWrite:false}));exitSign.position.set(0,1.2,3.48);exitSign.rotation.y=Math.PI;this.interiorLayer.add(exitSign);
                for(let index=0;index<4;index+=1){const lamp=new THREE.PointLight(index%2?0xffe0a0:theme.trim,2.1,6.5,2.25);lamp.position.set(-3.9+(index%2)*7.8,2.85,index<2?-2.25:2.15);this.interiorLayer.add(lamp);}
                if(this.interiorId==='market'){
                    for(let row=0;row<3;row+=1)for(let col=0;col<5;col+=1){const crate=new THREE.Mesh(new THREE.BoxGeometry(.5,.45,.5),this.material(0xb97838,{map:this.surfaceTextures.wood,roughness:.86}));crate.position.set(-4+col*.58,.42+row*.48,-3.05);crate.castShadow=true;this.interiorLayer.add(crate);}
                    for(let index=0;index<18;index+=1){const fruit=new THREE.Mesh(new THREE.SphereGeometry(.1+seeded(index,930)*.055,10,7),this.material([0xffd52e,0xe94b43,0x55ae4c][index%3],{roughness:.72}));fruit.scale.y=.72;fruit.position.set(-4.05+(index%6)*.34,1.66+Math.floor(index/6)*.17,-3.02);this.interiorLayer.add(fruit);}
                    const banana=this.iconSprite('🍌','#ffe15a');banana.scale.set(1.25,1.25,1);banana.position.set(0,2.05,-3.05);this.interiorLayer.add(banana);
                }else if(this.interiorId==='wardrobe'){
                    for(const x of [-3.6,0,3.6]){const platform=new THREE.Mesh(new THREE.CylinderGeometry(.72,.82,.18,28),this.material(theme.trim,{metalness:.2,roughness:.42,emissive:theme.trim,emissiveIntensity:.08}));platform.position.set(x,.28,.35);this.interiorLayer.add(platform);const mannequin=this.iconSprite(x===0?'👑':'🐵',x===0?'#ffe879':'#e7c5ff');mannequin.scale.set(1.05,1.05,1);mannequin.position.set(x,.52,.35);this.interiorLayer.add(mannequin);}
                    for(const x of [-4.3,4.3]){const mirror=new THREE.Mesh(new THREE.PlaneGeometry(1.25,2.1),new THREE.MeshPhysicalMaterial({color:0xaedcff,metalness:.35,roughness:.08,transparent:true,opacity:.78}));mirror.position.set(x,1.55,-3.24);this.interiorLayer.add(mirror);}
                }else if(this.interiorId==='cafe'){
                    for(const x of [-3,0,3]){const table=new THREE.Mesh(new THREE.CylinderGeometry(.65,.65,.09,18),this.material(0xf4dcaa,{roughness:.8}));table.position.set(x,.72,.7);this.interiorLayer.add(table);const stem=new THREE.Mesh(new THREE.CylinderGeometry(.06,.08,.7,9),this.material(0x4b3b2b,{metalness:.2}));stem.position.set(x,.36,.7);this.interiorLayer.add(stem);for(const z of [.05,1.35]){const chair=new THREE.Mesh(new THREE.BoxGeometry(.52,.55,.5),this.material(0x4c8b63,{map:this.surfaceTextures.wood,roughness:.82}));chair.position.set(x,.38,z);this.interiorLayer.add(chair);}}
                    const cup=this.iconSprite('🥤','#fff1a2');cup.scale.set(1.15,1.15,1);cup.position.set(0,1.8,-3.02);this.interiorLayer.add(cup);
                }else if(this.interiorId==='arcade'){
                    for(let index=0;index<6;index+=1){const cabinet=new THREE.Mesh(new THREE.BoxGeometry(.8,1.55,.65),this.material(index%2?0x6736bb:0x173d73,{emissive:index%2?0x240052:0x001c52,emissiveIntensity:.3,roughness:.45}));cabinet.position.set(-3.9+index*1.55,.85,-3);cabinet.castShadow=true;this.interiorLayer.add(cabinet);const screen=new THREE.Mesh(new THREE.PlaneGeometry(.55,.45),new THREE.MeshBasicMaterial({color:index%2?0xff4ee8:0x55e9ff}));screen.position.set(cabinet.position.x,1.18,-2.66);this.interiorLayer.add(screen);}
                    const grid=new THREE.GridHelper(10,20,0x62eaff,0x263a89);grid.position.y=.2;grid.material.transparent=true;grid.material.opacity=.2;this.interiorLayer.add(grid);
                }else if(this.interiorId==='clan'){
                    const table=new THREE.Mesh(new THREE.CylinderGeometry(1.55,1.7,.3,8),this.material(0x6d472e,{map:this.surfaceTextures.wood,bumpMap:this.surfaceTextures.wood,bumpScale:.02,roughness:.76}));table.position.set(0,.58,.7);this.interiorLayer.add(table);const map=new THREE.Mesh(new THREE.PlaneGeometry(2.25,1.45),new THREE.MeshStandardMaterial({color:0xe7cf8b,map:this.surfaceTextures.paving,roughness:.82}));map.rotation.x=-Math.PI/2;map.position.set(0,.75,.7);this.interiorLayer.add(map);for(const x of [-3.7,3.7]){const banner=this.iconSprite('🛡️','#ffe17a');banner.scale.set(1.15,1.15,1);banner.position.set(x,1.55,-3.05);this.interiorLayer.add(banner);}
                }
                const playerSprite=new THREE.Sprite(new THREE.SpriteMaterial({map:this.texture('Default Monkey.png'),transparent:true,alphaTest:.035,depthWrite:false}));playerSprite.center.set(.5,.08);playerSprite.scale.set(1.35,1.35,1);playerSprite.position.set(0,.25,2.1);playerSprite.renderOrder=20;playerSprite.userData.facingScale=1;this.interiorLayer.add(playerSprite);this.interiorPlayer=playerSprite;
            }

            exitInterior(){if(!this.interiorId)return;this.interiorLayer.visible=false;this.environment.visible=true;this.dynamicEnvironment.visible=true;this.playerLayer.visible=true;this.eventLayer.visible=true;this.effectLayer.visible=true;this.renderer.shadowMap.enabled=!this.qualityReduced;this.sunLight.castShadow=!this.qualityReduced;}

            renderInterior(interior,now){
                if(this.interiorId!==interior.id)this.enterInterior(interior.id);this.renderer.shadowMap.enabled=false;this.sunLight.castShadow=false;this.environment.visible=false;this.dynamicEnvironment.visible=false;this.playerLayer.visible=false;this.eventLayer.visible=false;this.effectLayer.visible=false;this.interiorLayer.visible=true;
                const x=clamp((Number(interior.x)||50),5,95),y=clamp((Number(interior.y)||78),10,94),px=(x-50)*.1,pz=(y-52)*.072;if(this.interiorPlayer){if(this.interiorPlayer.userData.skin!==interior.skin){this.interiorPlayer.userData.skin=interior.skin;this.interiorPlayer.material.map=this.texture(interior.skin||'Default Monkey.png');this.interiorPlayer.material.needsUpdate=true;}const currentFacing=this.interiorPlayer.userData.facingScale||1,targetFacing=interior.direction==='left'?-1:interior.direction==='right'?1:(currentFacing<0?-1:1);this.interiorPlayer.userData.facingScale=THREE.MathUtils.lerp(currentFacing,targetFacing,.22);this.interiorPlayer.position.set(px,.2+Math.abs(Math.sin(now*.012))*.05,pz);this.interiorPlayer.scale.x=this.interiorPlayer.userData.facingScale*1.35;}
                this.interiorLayer.children.forEach(object=>{if(object.userData.interiorMarker){object.material.opacity=.42+Math.sin(now*.004+object.userData.phase)*.24;object.rotation.z=now*.0007;}});const desired=new THREE.Vector3(px*.1,7.85,8.45);this.camera.position.lerp(desired,.1);this.cameraTarget.lerp(new THREE.Vector3(px*.08,.72,pz*.1-.2),.14);this.camera.lookAt(this.cameraTarget);this.renderer.render(this.scene,this.camera);
            }
            createScene() {
                this.scene = new THREE.Scene();
                this.scene.background = new THREE.Color(0x83d9ef);
                this.scene.fog = new THREE.FogExp2(0x8fd6de, .019);
                this.camera = new THREE.PerspectiveCamera(43, 16 / 9, .08, 130);
                this.camera.position.set(0, 12, 14);

                this.hemiLight = new THREE.HemisphereLight(0xdff9ff, 0x164b32, 2.1);
                this.scene.add(this.hemiLight);
                this.sunLight = new THREE.DirectionalLight(0xfff1bd, 3.4);
                this.sunLight.position.set(-12, 24, 10);
                this.sunLight.castShadow = true;
                this.sunLight.shadow.mapSize.set(1024, 1024);
                this.sunLight.shadow.camera.left = -22;
                this.sunLight.shadow.camera.right = 22;
                this.sunLight.shadow.camera.top = 18;
                this.sunLight.shadow.camera.bottom = -18;
                this.sunLight.shadow.camera.near = 1;
                this.sunLight.shadow.camera.far = 65;
                this.sunLight.shadow.bias = -.00025;
                this.scene.add(this.sunLight);
                this.scene.add(this.sunLight.target);

                this.environment = new THREE.Group();
                this.environment.name = 'Banana Coast Environment';
                this.scene.add(this.environment);
                this.dynamicEnvironment = new THREE.Group();
                this.scene.add(this.dynamicEnvironment);
                this.playerLayer = new THREE.Group();
                this.scene.add(this.playerLayer);
                this.eventLayer = new THREE.Group();
                this.scene.add(this.eventLayer);
                this.effectLayer = new THREE.Group();
                this.scene.add(this.effectLayer);
                this.interiorLayer = new THREE.Group();
                this.interiorLayer.visible = false;
                this.scene.add(this.interiorLayer);

                this.createProceduralTextures();
                this.createSky();
                this.createOcean();
                this.createIsland();
                this.createRoadNetwork();
                this.createBeachfront();
                this.createPlaza();
                this.createBoardwalks();
                this.createBuildings();
                this.createDistricts();
                this.createFoliage();
                this.createProps();
                this.createAtmosphere();
                this.batchStaticEnvironment();
            }

            staticMaterialKey(material) {
                const textureKey = (texture) => texture?.uuid || '';
                const emissiveStrength = Number(material.emissiveIntensity || 0);
                const strongEmissive = emissiveStrength > .12;
                const rounded = (value, step) => (Math.round(Number(value || 0) / step) * step).toFixed(3);
                return [
                    material.type,
                    strongEmissive ? material.emissive?.getHexString?.() || '' : 'none',
                    strongEmissive ? emissiveStrength.toFixed(3) : '0',
                    rounded(material.roughness ?? 1, .1),
                    rounded(material.metalness ?? 0, .1),
                    textureKey(material.map),
                    textureKey(material.bumpMap),
                    rounded(material.bumpScale || 0, .01),
                    material.side,
                    material.alphaTest || 0,
                    material.transparent ? 1 : 0,
                    Number(material.opacity ?? 1).toFixed(3),
                    material.depthWrite ? 1 : 0,
                    material.vertexColors ? 1 : 0
                ].join('|');
            }

            staticGeometryKey(geometry) {
                const attributes = Object.entries(geometry.attributes || {})
                    .map(([name, attribute]) => `${name}:${attribute.itemSize}:${attribute.normalized ? 1 : 0}`)
                    .sort()
                    .join(',');
                return `${geometry.index ? 'indexed' : 'plain'}|${attributes}`;
            }

            batchStaticEnvironment() {
                if (!THREE.BatchedMesh || !this.environment) return;
                this.scene.updateMatrixWorld(true);
                const excluded = new Set();
                const excludeTree = (object) => object?.traverse?.((child) => excluded.add(child));
                [this.boat, this.clouds, this.fountainWater, this.shoreFoam, this.fireflies, ...(this.fountainJets || []), ...(this.fountainRipples || []), ...(this.waterfallSheets || []), ...(this.waterfallRipples || []), ...(this.waterfallMist || []), ...(this.districtAnimated || []), ...(this.buildingGroups || [])].forEach(excludeTree);

                const groups = new Map();
                let totalMeshes = 0;
                let eligibleMeshes = 0;
                this.environment.traverse((object) => {
                    if (object?.isMesh) totalMeshes += 1;
                    if (!object?.isMesh || object.isInstancedMesh || object.isBatchedMesh || excluded.has(object)) return;
                    const material = object.material;
                    const geometry = object.geometry;
                    const alphaCutout = material?.transparent && material.alphaTest >= .05 && material.opacity >= .999 && material.depthWrite;
                    if (!material?.isMeshStandardMaterial || Array.isArray(material) || material.transparent && !alphaCutout || material.opacity < .999 || material.wireframe) return;
                    if (!geometry?.attributes?.position || geometry.morphAttributes && Object.keys(geometry.morphAttributes).length) return;
                    if (geometry.groups?.length > 1 || object.isSkinnedMesh) return;
                    eligibleMeshes += 1;
                    const key = `${this.staticMaterialKey(material)}::${this.staticGeometryKey(geometry)}`;
                    if (!groups.has(key)) groups.set(key, { material, meshes:[] });
                    groups.get(key).meshes.push(object);
                });

                const environmentInverse = new THREE.Matrix4().copy(this.environment.matrixWorld).invert();
                const relativeMatrix = new THREE.Matrix4();
                this.staticBatches = [];
                let sourceMeshes = 0;
                for (const group of groups.values()) {
                    if (group.meshes.length < 2) continue;
                    const geometries = new Map();
                    for (const mesh of group.meshes) geometries.set(mesh.geometry.uuid, mesh.geometry);
                    let vertexCount = 0;
                    let indexCount = 0;
                    for (const geometry of geometries.values()) {
                        vertexCount += geometry.attributes.position.count;
                        indexCount += geometry.index?.count || 0;
                    }
                    const batchMaterial = group.material.clone();
                    batchMaterial.color.setHex(0xffffff);
                    batchMaterial.roughness = Math.round(batchMaterial.roughness * 10) / 10;
                    batchMaterial.metalness = Math.round(batchMaterial.metalness * 10) / 10;
                    batchMaterial.bumpScale = Math.round((batchMaterial.bumpScale || 0) * 100) / 100;
                    if (batchMaterial.emissiveIntensity <= .12) {
                        batchMaterial.emissive.setHex(0x000000);
                        batchMaterial.emissiveIntensity = 0;
                    }
                    const batch = new THREE.BatchedMesh(
                        group.meshes.length,
                        Math.max(1, vertexCount),
                        Math.max(1, indexCount || vertexCount * 2),
                        batchMaterial
                    );
                    batch.name = `Banana Coast static batch (${group.meshes.length})`;
                    batch.castShadow = group.meshes.some((mesh) => mesh.castShadow);
                    batch.receiveShadow = group.meshes.some((mesh) => mesh.receiveShadow);
                    batch.sortObjects = false;
                    batch.perObjectFrustumCulled = false;
                    const geometryIds = new Map();
                    for (const [uuid, geometry] of geometries) geometryIds.set(uuid, batch.addGeometry(geometry));
                    for (const mesh of group.meshes) {
                        relativeMatrix.multiplyMatrices(environmentInverse, mesh.matrixWorld);
                        const instanceId = batch.addInstance(geometryIds.get(mesh.geometry.uuid));
                        batch.setMatrixAt(instanceId, relativeMatrix);
                        batch.setColorAt(instanceId, mesh.material.color);
                    }
                    batch.computeBoundingBox();
                    batch.computeBoundingSphere();
                    for (const mesh of group.meshes) mesh.removeFromParent();
                    this.environment.add(batch);
                    this.staticBatches.push(batch);
                    sourceMeshes += group.meshes.length;
                }
                document.documentElement.dataset.monkeyWorldBatches = JSON.stringify({
                    batches:this.staticBatches.length,
                    sourceMeshes,
                    totalMeshes,
                    eligibleMeshes,
                    materialGroups:groups.size,
                    singletonGroups:[...groups.values()].filter((group)=>group.meshes.length===1).length,
                    largestGroups:[...groups.values()].map((group)=>group.meshes.length).sort((a,b)=>b-a).slice(0,8)
                });
            }

            createOcean() {
                this.waterUniforms = {
                    uTime:{ value:0 },
                    uSunset:{ value:0 },
                    uNight:{ value:0 }
                };
                const material = new THREE.ShaderMaterial({
                    uniforms:this.waterUniforms,
                    vertexShader:`
                        uniform float uTime;
                        varying float vWave;
                        varying vec2 vUv;
                        void main(){
                            vUv=uv;
                            vec3 p=position;
                            float wave=sin(p.x*1.35+uTime*1.4)*.08+cos(p.y*1.8-uTime*1.05)*.055+sin((p.x+p.y)*.8+uTime*.72)*.035;
                            p.z+=wave;
                            vWave=wave;
                            gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
                        }`,
                    fragmentShader:`
                        uniform float uTime;
                        uniform float uSunset;
                        uniform float uNight;
                        varying float vWave;
                        varying vec2 vUv;
                        void main(){
                            vec3 shallow=vec3(.05,.72,.78);
                            vec3 deep=vec3(.015,.23,.47);
                            vec3 color=mix(deep,shallow,clamp(vUv.y*.68+vWave*2.8+.18,0.,1.));
                            color=mix(color,vec3(.86,.28,.20),uSunset*.20);
                            color=mix(color,vec3(.015,.04,.18),uNight*.60);
                            float rippleA=sin(vUv.x*118.+sin(vUv.y*37.-uTime*.34)*3.1+uTime*1.5);
                            float rippleB=sin(vUv.y*83.-vUv.x*19.-uTime*1.12);
                            float glint=smoothstep(.89,1.,rippleA*.68+rippleB*.22+vWave*1.65)*(.08+max(vWave,0.)*.82);
                            color+=vec3(.68,.94,1.)*glint;
                            gl_FragColor=vec4(color,1.0);
                        }`
                });
                const geometry = new THREE.PlaneGeometry(82, 60, 150, 110);
                const ocean = new THREE.Mesh(geometry, material);
                ocean.rotation.x = -Math.PI / 2;
                ocean.position.y = -.72;
                ocean.receiveShadow = true;
                this.environment.add(ocean);
                this.ocean = ocean;
            }

            islandShape(inset = 0) {
                const points = [
                    [190+inset,340+inset],[620,125+inset],[1250,80+inset],[1960,105+inset],
                    [2850,70+inset],[3660,130+inset],[4510-inset,310],[5000-inset,760],
                    [5110-inset,1450],[5050-inset,2280],[4740-inset,2920],[4110-inset,3260],
                    [3200,3340-inset],[2250,3300-inset],[1350,3160-inset],[650,2860-inset],
                    [220+inset,2360-inset],[70+inset,1580],[75+inset,850],[95+inset,610]
                ];
                const shape = new THREE.Shape();
                points.forEach(([x,y], index) => {
                    const p = this.worldPosition(x,y);
                    if (!index) shape.moveTo(p.x,p.z); else shape.lineTo(p.x,p.z);
                });
                shape.closePath();
                return shape;
            }

            createIslandLayer(shape, depth, y, color, bevelSize) {
                const geometry = new THREE.ExtrudeGeometry(shape, {
                    depth,
                    bevelEnabled:true,
                    bevelSegments:3,
                    bevelSize,
                    bevelThickness:.08,
                    curveSegments:4
                });
                geometry.rotateX(Math.PI / 2);
                const surfaceMap=color===0xeac46f?this.surfaceTextures.sand:this.surfaceTextures.grass;
                const mesh = new THREE.Mesh(geometry, this.material(color, { map:surfaceMap, bumpMap:surfaceMap, bumpScale:.018, roughness:.93 }));
                mesh.position.y = y;
                mesh.receiveShadow = true;
                mesh.castShadow = true;
                this.environment.add(mesh);
                return mesh;
            }

            createIsland() {
                this.sandIsland = this.createIslandLayer(this.islandShape(0), .42, -.27, 0xeac46f, .18);
                this.grassIsland = this.createIslandLayer(this.islandShape(62), .25, .02, 0x4f9d4f, .12);
            }

            createBeachfront(){
                const coastPoints=[[95,1420],[390,1365],[760,1405],[1140,1515],[1575,1570],[1970,1525],[2390,1435],[2790,1380],[3090,1460],[3140,2050],[2800,2130],[2240,2160],[1640,2185],[1010,2160],[455,2080],[80,1940]];
                const shape=new THREE.Shape();
                coastPoints.forEach(([x,y],index)=>{const point=this.worldPosition(x,y);if(index===0)shape.moveTo(point.x,point.z);else shape.lineTo(point.x,point.z);});shape.closePath();
                const beach=new THREE.Mesh(new THREE.ShapeGeometry(shape,36),this.material(0xffdf8c,{map:this.surfaceTextures.sand,bumpMap:this.surfaceTextures.sand,bumpScale:.012,roughness:.98,side:THREE.DoubleSide}));
                beach.rotation.x=Math.PI/2;beach.position.y=.292;beach.receiveShadow=true;this.environment.add(beach);this.beachfront=beach;
                const edgePoints=[[90,1930],[470,2070],[1030,2150],[1600,2180],[2220,2155],[2780,2120],[3120,2020]].map(([x,y])=>this.worldPosition(x,y,.325));
                const edgeCurve=new THREE.CatmullRomCurve3(edgePoints,false,'centripetal');
                const foamMaterial=new THREE.MeshBasicMaterial({color:0xe9ffff,transparent:true,opacity:.78,depthWrite:false,blending:THREE.AdditiveBlending});
                const foam=new THREE.Mesh(new THREE.TubeGeometry(edgeCurve,64,.045,6,false),foamMaterial);foam.position.z=.05;this.environment.add(foam);this.shoreFoam=foam;
                const chairMaterial=this.material(0x2f786b,{roughness:.76}),clothMaterials=[this.material(0xff826f,{roughness:.72}),this.material(0x65cfe1,{roughness:.72}),this.material(0xffd45d,{roughness:.72})];
                const beachSpots=[[360,1990,-.28],[680,2040,.16],[1260,2025,-.18],[1940,2035,.2],[2520,2020,-.12],[2860,1985,.28]];
                beachSpots.forEach(([x,y,rotation],index)=>{
                    const point=this.worldPosition(x,y,.35);
                    if(!this.isLandscapeClear(point.x,point.z,.5,{allowBeach:true}))return;
                    // The original map treated furniture as part of the world,
                    // rather than decoration players could walk through. Keep the
                    // chair and umbrella collisions separate so the remaining
                    // beach path does not become one oversized blocked circle.
                    this.environmentCollisions.push({x:Number(x),y:Number(y),radius:42});
                    const shadeLocalX=.8,shadeLocalY=-.08;
                    const shadeX=x+(shadeLocalX*Math.cos(rotation)+shadeLocalY*Math.sin(rotation))*WORLD_SCALE;
                    const shadeY=y+(-shadeLocalX*Math.sin(rotation)+shadeLocalY*Math.cos(rotation))*WORLD_SCALE;
                    this.environmentCollisions.push({x:shadeX,y:shadeY,radius:32});
                    const group=new THREE.Group();group.position.copy(point);group.rotation.y=rotation;
                    const seat=new THREE.Mesh(new THREE.BoxGeometry(.82,.08,.42),clothMaterials[index%clothMaterials.length]);seat.position.set(0,.22,0);seat.rotation.x=-.08;seat.castShadow=true;group.add(seat);
                    const back=new THREE.Mesh(new THREE.BoxGeometry(.82,.08,.62),clothMaterials[index%clothMaterials.length]);back.position.set(0,.52,-.28);back.rotation.x=-.65;back.castShadow=true;group.add(back);
                    for(const side of [-1,1]){const leg=new THREE.Mesh(new THREE.BoxGeometry(.06,.36,.06),chairMaterial);leg.position.set(side*.34,.16,.08);leg.rotation.z=side*.08;group.add(leg);}
                    const pole=new THREE.Mesh(new THREE.CylinderGeometry(.035,.05,1.48,8),chairMaterial);pole.position.set(.8,.72,-.08);group.add(pole);
                    const shade=new THREE.Mesh(new THREE.ConeGeometry(.78,.28,18,1,true),clothMaterials[(index+1)%clothMaterials.length]);shade.position.set(.8,1.48,-.08);shade.rotation.y=index*.6;shade.castShadow=true;group.add(shade);
                    this.environment.add(group);
                });
                const volley=new THREE.Group();volley.position.copy(this.worldPosition(1600,2070,.35));
                const poleMaterial=this.material(0xf4ead3,{roughness:.72});
                for(const side of [-1,1]){this.environmentCollisions.push({x:1600+side*1.12*WORLD_SCALE,y:2070,radius:16});const pole=new THREE.Mesh(new THREE.CylinderGeometry(.035,.045,1.45,8),poleMaterial);pole.position.set(side*1.12,.72,0);pole.castShadow=true;volley.add(pole);}
                const netTexture=this.canvasTexture(256,96,(context,width,height)=>{context.clearRect(0,0,width,height);context.strokeStyle='rgba(250,255,246,.82)';context.lineWidth=3;for(let x=0;x<=width;x+=20){context.beginPath();context.moveTo(x,0);context.lineTo(x,height);context.stroke();}for(let y=0;y<=height;y+=18){context.beginPath();context.moveTo(0,y);context.lineTo(width,y);context.stroke();}});
                const net=new THREE.Mesh(new THREE.PlaneGeometry(2.2,.72),new THREE.MeshBasicMaterial({map:netTexture,transparent:true,side:THREE.DoubleSide,depthWrite:false}));net.position.y=.78;volley.add(net);
                const ball=new THREE.Mesh(new THREE.SphereGeometry(.13,14,10),this.material(0xffd95a,{roughness:.55}));ball.position.set(1.48,.14,.52);ball.castShadow=true;volley.add(ball);this.environment.add(volley);
                [[1410,1980,0xff7e83],[1790,1985,0x55cfe7]].forEach(([x,y,color],index)=>{const towel=new THREE.Mesh(new THREE.BoxGeometry(.72,.025,1.1),this.material(color,{roughness:.88}));towel.position.copy(this.worldPosition(x,y,.335));towel.rotation.y=index ? .22 : -.18;towel.receiveShadow=true;this.environment.add(towel);});
            }

            createRoadSegment(first, second, width, color = 0x41565a, elevation = .245, markings = true, surfaceName = '') {
                const a = this.worldPosition(first[0], first[1], elevation);
                const b = this.worldPosition(second[0], second[1], elevation);
                this.roadKeepouts.push({ ax:a.x, az:a.z, bx:b.x, bz:b.z, halfWidth:width / 2 });
                const dx = b.x - a.x;
                const dz = b.z - a.z;
                const length = Math.hypot(dx,dz);
                const angle = -Math.atan2(dz,dx);
                const surfaceTexture=markings?this.surfaceTextures.road:(this.surfaceTextures[surfaceName]||this.surfaceTextures.wood);
                const curbTexture=markings?this.surfaceTextures.stone:this.surfaceTextures.wood;
                const curb = new THREE.Mesh(new THREE.BoxGeometry(length + .24,.075,width + .25),this.material(markings?0xe9cd96:0xd7af72,{map:curbTexture,bumpMap:curbTexture,bumpScale:.018,roughness:.94}));
                curb.position.set((a.x+b.x)/2,elevation-.075,(a.z+b.z)/2);
                curb.rotation.y = angle;
                curb.receiveShadow = true;
                this.environment.add(curb);
                const road = new THREE.Mesh(new THREE.BoxGeometry(length,.085,width),this.material(color,{map:surfaceTexture,bumpMap:surfaceTexture,bumpScale:.014,roughness:.92}));
                road.position.set((a.x+b.x)/2,elevation-.015,(a.z+b.z)/2);
                road.rotation.y = angle;
                road.receiveShadow = true;
                this.environment.add(road);
                if(markings){
                    const dashMaterial = this.material(0xf9db58,{emissive:0x5c4600,emissiveIntensity:.08,roughness:.8});
                    const count = Math.max(1,Math.floor(length/1.2));
                    for(let index=0;index<count;index+=1){
                        const ratio=(index+.5)/count;
                        const dash=new THREE.Mesh(new THREE.BoxGeometry(Math.min(.54,length/count*.48),.035,.045),dashMaterial);
                        dash.position.lerpVectors(a,b,ratio);dash.position.y=elevation+.045;dash.rotation.y=angle;this.environment.add(dash);
                    }
                }
            }

            createRoad(points,width,color=0x41565a,elevation=.245,markings=true,surfaceName=''){
                for(let index=1;index<points.length;index+=1)this.createRoadSegment(points[index-1],points[index],width,color,elevation,markings,surfaceName);
                const joinTexture=markings?this.surfaceTextures.road:(this.surfaceTextures[surfaceName]||this.surfaceTextures.wood);
                const joinMaterial=this.material(color,{map:joinTexture,bumpMap:joinTexture,bumpScale:.014,roughness:.92});
                for(let index=1;index<points.length-1;index+=1){const p=this.worldPosition(points[index][0],points[index][1],elevation+.025);const join=new THREE.Mesh(new THREE.CylinderGeometry(width/2,width/2,.08,24),joinMaterial);join.position.copy(p);this.environment.add(join);}
            }

            createRoadNetwork() {
                this.roadKeepouts.length = 0;
                this.createRoad([[120,910],[670,850],[1150,895],[1600,835],[2080,900],[2570,825],[3090,850],[3510,910],[3890,1030],[4245,1125],[4620,1270]],.88);
                this.createRoad([[1590,120],[1580,520],[1600,835],[1570,1210],[1590,1840],[1820,2170],[2140,2380]],.76);
                this.createRoad([[640,870],[720,620],[935,445]],.62);
                this.createRoad([[2020,920],[2300,680],[2670,575],[3075,700]],.64);
                // Restore the secondary promenade and footpath network from
                // the classic Banana Coast. Movement has always considered
                // these routes walkable, but the first 3D pass did not draw
                // them, making players appear to cross empty grass and making
                // several landmark entrances feel disconnected.
                const footpath=(points,width=.46)=>this.createRoad(points,width,0xc9b17d,.284,false,'paving');
                footpath([[100,1410],[520,1320],[820,1510],[1190,1500],[1570,1390]],.52);
                footpath([[1490,1050],[1790,1330],[2050,1700]],.46);
                footpath([[2350,720],[2440,850],[2660,930],[2785,1045],[3050,1360],[3150,1600]],.5);
                footpath([[1080,170],[1100,390],[1210,560],[1430,700]],.42);
                footpath([[60,1180],[270,1240],[520,1340],[720,1480],[940,1510],[1170,1450],[1280,1580]],.42);
                footpath([[80,1420],[250,1530],[520,1590],[790,1660],[1080,1690],[1280,1580]],.42);
                footpath([[1160,1690],[1430,1600],[1700,1660],[2000,1580],[2240,1650]],.5);
                footpath([[3150,1080],[3060,1240],[2910,1370],[2760,1430],[2670,1520],[2470,1600],[2220,1600],[2050,1660]],.44);
                // The expanded coast is a connected exploration loop rather
                // than disconnected set dressing. Every district has a visible
                // route that also matches the authoritative movement mask.
                footpath([[3075,700],[3350,610],[3650,470],[3900,720],[4245,1125]],.5);
                footpath([[3510,910],[3660,1190],[3710,1390],[3950,1540],[4520,1710]],.52);
                footpath([[4245,1125],[4480,1450],[4620,1740],[4580,2150],[4410,2540]],.5);
                footpath([[4410,2540],[4140,2790],[3790,2980],[3370,3070],[2860,3130],[2450,3120],[1920,2960],[1390,2900],[850,2670],[520,2390]],.54);
                footpath([[2050,1700],[2110,1980],[2180,2260],[2140,2380]],.48);
                footpath([[3165,1955],[3400,2140],[3720,2320],[4140,2500]],.5);
                footpath([[1280,1580],[1030,1810],[810,2030],[620,2250],[520,2390]],.46);
                // The beach edge is a timber promenade rather than another
                // asphalt road. It visually joins the sand, docks and beach
                // furniture without a highway cutting across the shoreline.
                this.createRoad([[500,1840],[930,1810],[1280,1850],[1590,1840],[1910,1850],[2250,1815],[2580,1840],[2900,1810],[3120,1920]],.72,0x9a6438,.355,false);
            }

            createPlaza() {
                const plaza = new THREE.Mesh(new THREE.CylinderGeometry(4.15,4.2,.16,64),this.material(0xd8c091,{map:this.surfaceTextures.paving,bumpMap:this.surfaceTextures.paving,bumpScale:.018,roughness:.92}));
                plaza.position.copy(this.worldPosition(1600,930,.28));plaza.receiveShadow=true;this.environment.add(plaza);
                const ring = new THREE.Mesh(new THREE.TorusGeometry(2.02,.12,12,64),this.material(0x9c7d55,{roughness:.8}));
                ring.rotation.x=Math.PI/2;ring.position.copy(this.worldPosition(1600,930,.47));ring.castShadow=true;this.environment.add(ring);
                const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.82,1.96,.42,64),this.material(0x8b775f,{roughness:.72}));
                basin.position.copy(this.worldPosition(1600,930,.48));basin.castShadow=true;basin.receiveShadow=true;this.environment.add(basin);
                this.fountainWater = new THREE.Mesh(new THREE.CircleGeometry(1.65,64),new THREE.MeshPhysicalMaterial({color:0x4ae1ed,roughness:.14,metalness:.05,transparent:true,opacity:.82,transmission:.12}));
                this.fountainWater.rotation.x=-Math.PI/2;this.fountainWater.position.copy(this.worldPosition(1600,930,.72));this.environment.add(this.fountainWater);
                this.fountainRipples=[];
                for(const [radius,phase] of [[.48,0],[.9,1.7],[1.34,3.4]]){const ripple=new THREE.Mesh(new THREE.TorusGeometry(radius,.018,6,64),new THREE.MeshBasicMaterial({color:0xd8ffff,transparent:true,opacity:.36,blending:THREE.AdditiveBlending,depthWrite:false}));ripple.rotation.x=Math.PI/2;ripple.position.copy(this.worldPosition(1600,930,.745));ripple.userData.phase=phase;this.environment.add(ripple);this.fountainRipples.push(ripple);}
                const pillar = new THREE.Mesh(new THREE.CylinderGeometry(.25,.45,1.25,16),this.material(0xe1cda0,{roughness:.85}));
                pillar.position.copy(this.worldPosition(1600,930,1.25));pillar.castShadow=true;this.environment.add(pillar);
                const banana = new THREE.Mesh(new THREE.TorusGeometry(.42,.12,10,28,Math.PI*1.32),this.material(0xffd62f,{emissive:0x6d4300,emissiveIntensity:.16,roughness:.42}));
                banana.rotation.set(.25,.15,.7);banana.position.copy(this.worldPosition(1600,930,2.05));banana.castShadow=true;this.environment.add(banana);
                this.fountainJets=[];
                for(let index=0;index<7;index+=1){const angle=index/7*TAU;const curve=new THREE.QuadraticBezierCurve3(new THREE.Vector3(Math.cos(angle)*.3,1.3,Math.sin(angle)*.3),new THREE.Vector3(Math.cos(angle)*.85,2.4,Math.sin(angle)*.85),new THREE.Vector3(Math.cos(angle)*1.25,.78,Math.sin(angle)*1.25));const jet=new THREE.Mesh(new THREE.TubeGeometry(curve,18,.025,5,false),new THREE.MeshBasicMaterial({color:0xcaffff,transparent:true,opacity:.76}));jet.position.copy(this.worldPosition(1600,930,0));this.environment.add(jet);this.fountainJets.push(jet);}
            }

            createBoardwalk(points,width=.95){
                const wood=this.material(0x946238,{map:this.surfaceTextures.wood,bumpMap:this.surfaceTextures.wood,bumpScale:.02,roughness:.9});
                const rail=this.material(0x563b28,{roughness:.86});
                for(let index=1;index<points.length;index+=1){
                    const a=this.worldPosition(...points[index-1],.36),b=this.worldPosition(...points[index],.36),dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz),angle=-Math.atan2(dz,dx),count=Math.max(1,Math.ceil(length/.28));
                    // Boardwalks are walkable landmarks, not foliage beds.
                    // Register their full deck width before scenery is placed
                    // so trees, flowers and rocks cannot clip through planks or
                    // hang over the handrails.
                    this.roadKeepouts.push({ax:a.x,az:a.z,bx:b.x,bz:b.z,halfWidth:width/2+.18});
                    for(let plank=0;plank<count;plank+=1){const p=new THREE.Mesh(new THREE.BoxGeometry(length/count-.018,.1,width),wood);p.position.lerpVectors(a,b,(plank+.5)/count);p.rotation.y=angle;p.castShadow=true;p.receiveShadow=true;this.environment.add(p);}
                    for(const side of [-1,1]){const beam=new THREE.Mesh(new THREE.BoxGeometry(length,.1,.08),rail);beam.position.set((a.x+b.x)/2,.68,(a.z+b.z)/2);beam.rotation.y=angle;beam.translateZ(side*(width/2+.06));this.environment.add(beam);for(let post=0;post<=Math.floor(length/.9);post+=1){const support=new THREE.Mesh(new THREE.CylinderGeometry(.045,.075,1.48,7),rail);support.position.lerpVectors(a,b,post/Math.max(1,Math.floor(length/.9)));support.position.y=-.06;support.position.x+=Math.sin(angle)*side*(width/2+.06);support.position.z+=Math.cos(angle)*side*(width/2+.06);support.castShadow=true;this.environment.add(support);}}
                }
            }

            createBoardwalks(){
                // Docks begin on the seaward side of the promenade. Keeping
                // their handrails away from the roadway prevents the old
                // boardwalk/road intersections from looking like barriers.
                this.createBoardwalk([[1010,1895],[1010,2050],[960,2180]],1.05);
                this.createBoardwalk([[2380,1900],[2680,1940],[3030,2070]],1.0);
                this.createBoardwalk([[420,1895],[275,2020],[135,2140]],.82);
                this.createBoardwalk([[520,2390],[790,2600],[1160,2790],[1540,2940],[1920,3000]],.9);
                this.createBoardwalk([[1920,3000],[2360,3130],[2860,3160],[3310,3090]],1.08);
                this.createBoardwalk([[4410,2540],[4660,2700],[4860,2850]],.88);
            }

            createDistrictLabel(name,x,y,color='#ffe77a'){
                const texture=this.createTextTexture(name,{width:768,height:144,fontSize:38,color,border:color,background:'rgba(3,35,30,.94)',backgroundEnd:'rgba(7,68,55,.94)'});
                const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false,depthTest:true}));
                sprite.position.copy(this.worldPosition(x,y,2.12));sprite.scale.set(2.55,.48,1);sprite.renderOrder=18;this.environment.add(sprite);return sprite;
            }

            createDistricts(){
                this.districtAnimated=[];this.waterfallSheets=[];this.waterfallRipples=[];this.waterfallMist=[];
                const stone=this.material(0x71817a,{map:this.surfaceTextures.stone,bumpMap:this.surfaceTextures.stone,bumpScale:.025,roughness:.96});
                const wood=this.material(0x88522f,{map:this.surfaceTextures.wood,bumpMap:this.surfaceTextures.wood,bumpScale:.02,roughness:.9});
                const leaf=this.material(0x2e9953,{roughness:.88}),gold=this.material(0xffd94c,{emissive:0x8a5700,emissiveIntensity:.22,roughness:.48});
                const addCollision=(x,y,radius)=>this.environmentCollisions.push({x,y,radius});
                const addRock=(x,y,size=.45,colorMaterial=stone)=>{const rock=new THREE.Mesh(new THREE.DodecahedronGeometry(size,1),colorMaterial);rock.position.copy(this.worldPosition(x,y,.25));rock.scale.set(1,.72,1);rock.rotation.set(.18,seeded(Math.round(x+y),901)*TAU,.08);rock.castShadow=true;rock.receiveShadow=true;this.environment.add(rock);addCollision(x,y,size*72);return rock;};
                const addTree=(x,y,scale=1)=>{const group=new THREE.Group();group.position.copy(this.worldPosition(x,y,.25));const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.08,.14,1.25,8),wood);trunk.position.y=.62*scale;trunk.scale.setScalar(scale);trunk.castShadow=true;group.add(trunk);for(const [ox,oy,oz,s] of [[0,1.4,0,.72],[-.38,1.24,.08,.52],[.38,1.28,-.05,.56]]){const crown=new THREE.Mesh(new THREE.SphereGeometry(s*scale,12,9),leaf);crown.position.set(ox*scale,oy*scale,oz*scale);crown.castShadow=true;group.add(crown);}group.userData.sway=.018*scale;group.userData.phase=(x+y)*.007;this.environment.add(group);this.districtAnimated.push(group);addCollision(x,y,30*scale);return group;};
                const addBench=(x,y,rotation=0)=>{const group=new THREE.Group();group.position.copy(this.worldPosition(x,y,.3));group.rotation.y=rotation;for(const z of [-.15,.15]){const slat=new THREE.Mesh(new THREE.BoxGeometry(1.08,.085,.11),wood);slat.position.set(0,.42,z);slat.castShadow=true;group.add(slat);}for(const sx of [-.42,.42]){const leg=new THREE.Mesh(new THREE.BoxGeometry(.08,.4,.34),stone);leg.position.set(sx,.2,0);group.add(leg);}this.environment.add(group);addCollision(x,y,50);};
                const addArea=(x,y,rx,rz,color=0xb9a579,surface='paving')=>{const surfaceMap=this.surfaceTextures[surface]||this.surfaceTextures.paving;const pad=new THREE.Mesh(new THREE.CylinderGeometry(1,1,.08,48),this.material(color,{map:surfaceMap,bumpMap:surfaceMap,bumpScale:.012,roughness:.94}));pad.position.copy(this.worldPosition(x,y,.3));pad.scale.set(rx/WORLD_SCALE,1,rz/WORLD_SCALE);pad.receiveShadow=true;this.environment.add(pad);return pad;};
                const addSparkles=(x,y,color,count=12,radius=1.7,height=1.4)=>{const positions=new Float32Array(count*3);for(let index=0;index<count;index+=1){const angle=index/count*TAU+seeded(index+Math.round(x),1301)*.7;const distance=.3+seeded(index+Math.round(y),1303)*radius;positions[index*3]=Math.cos(angle)*distance;positions[index*3+1]=.35+seeded(index+Math.round(x+y),1307)*height;positions[index*3+2]=Math.sin(angle)*distance;}const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));const points=new THREE.Points(geometry,new THREE.PointsMaterial({color,size:.075,transparent:true,opacity:.78,depthWrite:false,blending:THREE.AdditiveBlending}));points.position.copy(this.worldPosition(x,y,.3));points.userData.spin=.0014;points.userData.phase=(x+y)*.006;this.dynamicEnvironment.add(points);this.districtAnimated.push(points);return points;};
                const addGlowRing=(x,y,color,radius=.8,height=.42,tilt=Math.PI/2)=>{const ring=new THREE.Mesh(new THREE.TorusGeometry(radius,.045,8,48),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.62,blending:THREE.AdditiveBlending,depthWrite:false}));ring.position.copy(this.worldPosition(x,y,height));ring.rotation.x=tilt;ring.userData.spin=.0045;ring.userData.pulseScale=.14;ring.userData.phase=(x+y)*.008;this.dynamicEnvironment.add(ring);this.districtAnimated.push(ring);return ring;};
                const addButterflies=(x,y,colorA=0xffdc64,colorB=0x84efff,count=5)=>{for(let index=0;index<count;index+=1){const butterfly=new THREE.Group(),wingMaterial=new THREE.MeshBasicMaterial({color:index%2?colorA:colorB,transparent:true,opacity:.84,side:THREE.DoubleSide,depthWrite:false});for(const side of [-1,1]){const wing=new THREE.Mesh(new THREE.CircleGeometry(.08+(index%3)*.012,10,0,Math.PI),wingMaterial.clone());wing.position.x=side*.065;wing.rotation.y=side*.48;butterfly.add(wing);}const body=new THREE.Mesh(new THREE.CylinderGeometry(.012,.018,.14,6),new THREE.MeshBasicMaterial({color:0x332436}));body.rotation.z=Math.PI/2;butterfly.add(body);const origin=this.worldPosition(x,y,.72+(index%3)*.22);butterfly.position.copy(origin);butterfly.scale.setScalar(.75+(index%2)*.18);butterfly.userData={kind:'butterfly',origin:origin.clone(),phase:index/count*TAU+(x+y)*.003,radius:.52+(index%3)*.23,speed:.55+(index%2)*.18,wings:butterfly.children.filter((child)=>child!==body)};this.dynamicEnvironment.add(butterfly);this.districtAnimated.push(butterfly);}};

                // 1. Classic plaza is created separately. 2. Banana Gardens.
                addArea(3710,1390,300,220,0xa9c675);this.createDistrictLabel('BANANA GARDENS',3710,1210);
                for(const [x,y,color] of [[3590,1340,0xff7da8],[3650,1460,0xffdc64],[3780,1325,0x8ee6ff],[3840,1460,0xb699ff]]){const bed=new THREE.Mesh(new THREE.CylinderGeometry(.62,.67,.18,18),this.material(0x714929,{roughness:.96}));bed.position.copy(this.worldPosition(x,y,.37));this.environment.add(bed);for(let index=0;index<9;index+=1){const flower=new THREE.Mesh(new THREE.SphereGeometry(.055,7,5),this.material(color,{emissive:color,emissiveIntensity:.06}));const angle=index/9*TAU;flower.position.copy(bed.position).add(new THREE.Vector3(Math.cos(angle)*.4,.18,Math.sin(angle)*.4));this.environment.add(flower);}addCollision(x,y,58);}addBench(3710,1515,0);
                const gardenGazebo=new THREE.Group();gardenGazebo.position.copy(this.worldPosition(3710,1390,.34));for(let index=0;index<6;index+=1){const angle=index/6*TAU;const post=new THREE.Mesh(new THREE.CylinderGeometry(.045,.065,1.4,8),wood);post.position.set(Math.cos(angle)*.68,.7,Math.sin(angle)*.68);gardenGazebo.add(post);}const gazeboRoof=new THREE.Mesh(new THREE.ConeGeometry(.98,.55,6),this.material(0xffe4a1,{roughness:.65}));gazeboRoof.position.y=1.48;gazeboRoof.rotation.y=Math.PI/6;gazeboRoof.castShadow=true;gardenGazebo.add(gazeboRoof);this.environment.add(gardenGazebo);addCollision(3710,1390,68);
                addSparkles(3710,1390,0xffd7ef,10,2.05,1.12);addButterflies(3710,1390,0xff8dc9,0x86eaff,7);

                // 3. Arcade Terrace.
                addArea(4245,1240,310,205,0x697cb4);this.createDistrictLabel('ARCADE TERRACE',4380,1240,'#77efff');
                for(const side of [-1,1]){const pillar=new THREE.Mesh(new THREE.BoxGeometry(.32,2.35,.32),this.material(side<0?0x715cff:0xff4ed5,{emissive:side<0?0x3020b0:0x9b176f,emissiveIntensity:.8,roughness:.28}));pillar.position.copy(this.worldPosition(4245+side*190,1295,1.45));pillar.castShadow=true;this.environment.add(pillar);addCollision(4245+side*190,1295,28);this.districtAnimated.push(pillar);}
                const arcadeHalo=new THREE.Mesh(new THREE.TorusGeometry(1.28,.07,10,52),new THREE.MeshBasicMaterial({color:0x5ff7ff,transparent:true,opacity:.78,blending:THREE.AdditiveBlending,depthWrite:false}));arcadeHalo.position.copy(this.worldPosition(4245,1270,.48));arcadeHalo.rotation.x=Math.PI/2;arcadeHalo.userData.spin=.009;this.dynamicEnvironment.add(arcadeHalo);this.districtAnimated.push(arcadeHalo);
                for(const [radius,color,phase] of [[.56,0x7af7ff,0],[.96,0xff61dd,1.2],[1.42,0x8d6bff,2.4]]){const ring=addGlowRing(4245,1270,color,radius,.38);ring.userData.phase=phase;ring.userData.spin=.006+radius*.002;}

                // 4. Lantern Grove.
                addArea(4520,1710,280,230,0x72965d,'grass');this.createDistrictLabel('LANTERN GROVE',4520,1535,'#ffd479');
                for(const [x,y] of [[4380,1625],[4510,1585],[4660,1650],[4390,1790],[4560,1840],[4710,1770]]){addTree(x,y,.78);this.createLamp(x+32,y+18);}
                addSparkles(4520,1710,0xffe57f,18,2.2,1.72);addButterflies(4520,1710,0xffe57f,0x8effbd,6);

                // 5. Crystal Cascades: a solid cliff, walkable pool edge and
                // animated water/mist localized to this one destination.
                addArea(4410,2540,330,250,0x819b83);this.createDistrictLabel('CRYSTAL CASCADES',4410,2350,'#9ff4ff');
                for(const [x,y,size] of [[4280,2410,.9],[4345,2375,1.16],[4420,2360,1.3],[4500,2378,1.12],[4575,2420,.86]])addRock(x,y,size);
                const cliffWall=new THREE.Group();cliffWall.position.copy(this.worldPosition(4430,2415,.3));
                for(let row=0;row<3;row+=1){for(let column=0;column<6-row;column+=1){const cliffRock=new THREE.Mesh(new THREE.DodecahedronGeometry(.5+(column%2)*.08,1),stone);cliffRock.position.set((column-(5-row)/2)*.57,row*.52+.34,(row%2)*-.08);cliffRock.scale.set(1.18,.88,.82);cliffRock.rotation.set(row*.08,column*.19,(column%2-.5)*.12);cliffRock.castShadow=true;cliffRock.receiveShadow=true;cliffWall.add(cliffRock);}}
                this.environment.add(cliffWall);addCollision(4430,2415,150);
                const fallTexture=this.canvasTexture(128,384,(context,width,height)=>{const gradient=context.createLinearGradient(0,0,0,height);gradient.addColorStop(0,'rgba(179,250,255,.72)');gradient.addColorStop(.38,'rgba(38,197,226,.55)');gradient.addColorStop(.78,'rgba(88,219,236,.42)');gradient.addColorStop(1,'rgba(220,255,255,.18)');context.fillStyle=gradient;context.fillRect(0,0,width,height);for(let streak=0;streak<12;streak+=1){context.strokeStyle=`rgba(225,255,255,${.08+(streak%4)*.045})`;context.lineWidth=3+(streak%3)*2;context.beginPath();const x=8+streak*10;context.moveTo(x,-18);context.bezierCurveTo(x+18,height*.28,x-14,height*.62,x+6,height+18);context.stroke();}});
                fallTexture.wrapS=THREE.RepeatWrapping;fallTexture.wrapT=THREE.RepeatWrapping;fallTexture.repeat.set(1,1.4);
                const cascadeMaterial=new THREE.MeshBasicMaterial({map:fallTexture,color:0xa8f8ff,transparent:true,opacity:.72,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide});
                for(let index=0;index<4;index+=1){
                    const sheet=new THREE.Mesh(new THREE.PlaneGeometry(.82+(index%2)*.13,1.92,6,18),cascadeMaterial.clone());
                    sheet.position.copy(this.worldPosition(4338+index*63,2447,1.42));
                    sheet.rotation.y=(index-1.5)*.034;
                    sheet.userData.phase=index*1.37;
                    sheet.userData.baseY=sheet.position.y;
                    this.dynamicEnvironment.add(sheet);
                    this.waterfallSheets.push(sheet);
                }
                const upperStream=new THREE.Mesh(new THREE.CircleGeometry(1.24,40),new THREE.MeshPhysicalMaterial({color:0x43cbd8,roughness:.2,transparent:true,opacity:.58}));upperStream.rotation.x=-Math.PI/2;upperStream.position.copy(this.worldPosition(4430,2390,1.92));upperStream.scale.set(1.45,.52,1);this.environment.add(upperStream);
                const pool=new THREE.Mesh(new THREE.CircleGeometry(1.78,56),new THREE.MeshPhysicalMaterial({color:0x36e3ed,emissive:0x0d667b,emissiveIntensity:.3,roughness:.08,metalness:.06,transparent:true,opacity:.86}));pool.rotation.x=-Math.PI/2;pool.position.copy(this.worldPosition(4440,2570,.35));this.environment.add(pool);addCollision(4440,2570,92);
                for(let ringIndex=0;ringIndex<3;ringIndex+=1){const ripple=new THREE.Mesh(new THREE.RingGeometry(.48+ringIndex*.34,.53+ringIndex*.34,48),new THREE.MeshBasicMaterial({color:0xd9ffff,transparent:true,opacity:.32,depthWrite:false,side:THREE.DoubleSide}));ripple.rotation.x=-Math.PI/2;ripple.position.copy(this.worldPosition(4440,2548,.39+ringIndex*.004));ripple.userData.phase=ringIndex*1.75;this.dynamicEnvironment.add(ripple);this.waterfallRipples||(this.waterfallRipples=[]);this.waterfallRipples.push(ripple);}
                const mistTexture=this.canvasTexture(96,96,(context,width,height)=>{const mistGradient=context.createRadialGradient(width/2,height/2,2,width/2,height/2,width/2);mistGradient.addColorStop(0,'rgba(235,255,255,.9)');mistGradient.addColorStop(.45,'rgba(180,246,255,.42)');mistGradient.addColorStop(1,'rgba(160,230,255,0)');context.fillStyle=mistGradient;context.fillRect(0,0,width,height);});
                for(let index=0;index<18;index+=1){const mist=new THREE.Sprite(new THREE.SpriteMaterial({map:mistTexture,transparent:true,opacity:.28,depthWrite:false,blending:THREE.AdditiveBlending}));mist.position.copy(this.worldPosition(4288+(index%9)*42,2488+Math.floor(index/9)*58,.64));mist.scale.set(.34,.34,1);mist.userData.phase=index*.73;mist.userData.baseX=mist.position.x;mist.userData.baseZ=mist.position.z;this.dynamicEnvironment.add(mist);this.waterfallMist.push(mist);}
                const cascadeGlow=new THREE.PointLight(0x73edff,3.2,7.5,2);cascadeGlow.position.copy(this.worldPosition(4438,2490,1.55));cascadeGlow.userData.phase=.8;this.dynamicEnvironment.add(cascadeGlow);this.districtAnimated.push(cascadeGlow);
                for(const [x,y,color,height] of [[4260,2510,0x69efff,.72],[4320,2585,0x9c78ff,.54],[4520,2580,0x63ffce,.62],[4590,2495,0x58cfff,.82]]){const crystal=new THREE.Mesh(new THREE.OctahedronGeometry(.16,0),this.material(color,{emissive:color,emissiveIntensity:1.35,roughness:.18,transparent:true,opacity:.92}));crystal.position.copy(this.worldPosition(x,y,.35+height/2));crystal.scale.set(.7,height/.32,.7);crystal.rotation.z=(x-y)*.001;crystal.userData={bob:.055,baseY:crystal.position.y,spin:.005,phase:(x+y)*.01};this.dynamicEnvironment.add(crystal);this.districtAnimated.push(crystal);}addGlowRing(4440,2565,0xb5ffff,1.5,.405);

                // 6. Starwatch Hill.
                addArea(3790,2980,300,220,0x677a78);this.createDistrictLabel('STARWATCH HILL',3790,2800,'#cfc4ff');
                const observatory=new THREE.Group();observatory.position.copy(this.worldPosition(3790,3010,.35));const base=new THREE.Mesh(new THREE.CylinderGeometry(.78,.9,.8,24),stone);base.position.y=.4;base.castShadow=true;observatory.add(base);const dome=new THREE.Mesh(new THREE.SphereGeometry(.76,24,12,0,TAU,0,Math.PI/2),this.material(0x556fa6,{metalness:.28,roughness:.42,emissive:0x132859,emissiveIntensity:.25}));dome.position.y=.82;observatory.add(dome);const scopePivot=new THREE.Group();scopePivot.position.set(0,1.08,0);scopePivot.userData.spin=.0015;const scope=new THREE.Mesh(new THREE.CylinderGeometry(.13,.19,1.25,12),this.material(0x26365a,{metalness:.5,roughness:.35}));scope.rotation.z=-1.02;scope.position.set(.42,.12,0);scopePivot.add(scope);observatory.add(scopePivot);this.environment.add(observatory);this.districtAnimated.push(scopePivot);addCollision(3790,3010,95);addSparkles(3790,2980,0xc4b7ff,12,2.35,2.2);
                for(const [radius,color,speed] of [[1.08,0x8fe8ff,.34],[1.48,0xc783ff,-.22]]){const orbit=new THREE.Group();orbit.position.copy(this.worldPosition(3790,3010,1.72));orbit.userData={kind:'orbit',phase:radius*2.2,radius,speed,baseY:orbit.position.y};const body=new THREE.Mesh(new THREE.SphereGeometry(.1+(radius-1)*.05,12,8),this.material(color,{emissive:color,emissiveIntensity:1.2,roughness:.25}));orbit.add(body);this.dynamicEnvironment.add(orbit);this.districtAnimated.push(orbit);}

                // 7. Sunset Boardwalk.
                this.createDistrictLabel('SUNSET BOARDWALK',2860,2965,'#ffbd75');for(const [x,y] of [[2580,3090],[2860,3130],[3140,3090]]){this.createLamp(x,y);addBench(x,y+58,.08);}addSparkles(2860,3080,0xffbf78,9,2.65,.82);addGlowRing(2860,3095,0xffaf6c,1.24,.48);

                // 8. Tiki Beach.
                addArea(1640,2940,430,260,0xffdc8a,'sand');this.createDistrictLabel('TIKI BEACH',1640,2820,'#ffe46c');
                for(const [x,y] of [[1430,2930],[1640,2990],[1840,2935]]){const tiki=new THREE.Mesh(new THREE.CylinderGeometry(.16,.22,1.35,7),wood);tiki.position.copy(this.worldPosition(x,y,.95));tiki.castShadow=true;this.environment.add(tiki);const flame=new THREE.Mesh(new THREE.SphereGeometry(.13,10,8),this.material(0xffa52c,{emissive:0xff5a00,emissiveIntensity:2.2}));flame.position.copy(this.worldPosition(x,y,1.72));this.dynamicEnvironment.add(flame);flame.userData.phase=x*.01;flame.userData.spin=.007;this.districtAnimated.push(flame);addCollision(x,y,24);}
                const beachFire=new THREE.Group();beachFire.position.copy(this.worldPosition(1640,2860,.36));for(let index=0;index<7;index+=1){const emberRock=new THREE.Mesh(new THREE.DodecahedronGeometry(.15,0),stone);const angle=index/7*TAU;emberRock.position.set(Math.cos(angle)*.38,.08,Math.sin(angle)*.38);beachFire.add(emberRock);}for(const rotation of [-.7,.7]){const log=new THREE.Mesh(new THREE.CylinderGeometry(.09,.11,.82,8),wood);log.rotation.z=Math.PI/2;log.rotation.y=rotation;log.position.y=.14;beachFire.add(log);}const beachFlame=new THREE.Mesh(new THREE.ConeGeometry(.24,.68,9),this.material(0xffa52c,{emissive:0xff3d00,emissiveIntensity:2.5,transparent:true,opacity:.88}));beachFlame.position.y=.53;beachFlame.userData.sway=.08;beachFlame.userData.phase=.7;beachFire.add(beachFlame);this.environment.add(beachFire);this.districtAnimated.push(beachFlame);addCollision(1640,2860,38);
                const fireGlow=new THREE.PointLight(0xff7a24,2.4,4.3,2);fireGlow.position.copy(this.worldPosition(1640,2860,.92));fireGlow.userData.phase=.7;this.dynamicEnvironment.add(fireGlow);this.districtAnimated.push(fireGlow);

                // 9. Palm Cove.
                addArea(850,2670,300,210,0x8ebd72,'grass');this.createDistrictLabel('PALM COVE',850,2500,'#d8ff9c');for(const [x,y,s] of [[690,2610,.9],[1020,2600,.85],[730,2780,.8],[1040,2770,.9]])addTree(x,y,s);addBench(850,2730,.25);const covePool=new THREE.Mesh(new THREE.CircleGeometry(1.18,48),new THREE.MeshPhysicalMaterial({color:0x43d8c8,roughness:.12,transparent:true,opacity:.72}));covePool.rotation.x=-Math.PI/2;covePool.position.copy(this.worldPosition(850,2635,.35));this.environment.add(covePool);for(const radius of [.44,.78,1.04])addGlowRing(850,2635,0xa8fff1,radius,.375);

                // 10. Picnic Meadow.
                addArea(2140,2380,330,230,0x8fc878,'grass');this.createDistrictLabel('PICNIC MEADOW',2140,2200,'#fff0a4');
                for(const [x,y,color] of [[2020,2370,0xff796f],[2240,2410,0x6ecfff],[2140,2510,0xffd45d]]){const blanket=new THREE.Mesh(new THREE.BoxGeometry(1.25,.03,.82),this.material(color,{roughness:.85}));blanket.position.copy(this.worldPosition(x,y,.35));blanket.rotation.y=(x+y)*.002;this.environment.add(blanket);}
                const basket=new THREE.Group();basket.position.copy(this.worldPosition(2140,2325,.36));const basketBody=new THREE.Mesh(new THREE.BoxGeometry(.72,.42,.48),this.material(0xb06d36,{roughness:.9}));basketBody.position.y=.22;basket.add(basketBody);const handle=new THREE.Mesh(new THREE.TorusGeometry(.32,.045,8,20,Math.PI),wood);handle.position.y=.5;basket.add(handle);this.environment.add(basket);addCollision(2140,2325,30);
                addSparkles(2140,2380,0xfff1a3,11,2.3,1.05);addButterflies(2140,2380,0xffec70,0xff8fc8,5);

                // 11. Moonstone Cave has a true dark entrance and stone arch.
                // The opening stays walkable while colored ore provides the
                // cavern's light, so it reads as a destination rather than a
                // ring of decorative rocks.
                addArea(810,2050,330,270,0x4d5361,'stone');this.createDistrictLabel('MOONSTONE CAVE',810,1785,'#d5b7ff');
                // An open-front U-shaped cavern keeps the center explorable
                // while reading as a real chamber from the isometric camera.
                const chamberFloor=new THREE.Mesh(new THREE.CircleGeometry(2.15,48),this.material(0x171827,{map:this.surfaceTextures.stone,bumpMap:this.surfaceTextures.stone,bumpScale:.055,roughness:.99,emissive:0x08091a,emissiveIntensity:.24}));chamberFloor.rotation.x=-Math.PI/2;chamberFloor.position.copy(this.worldPosition(810,2070,.35));chamberFloor.scale.set(1,.84,1);this.environment.add(chamberFloor);
                const caveMouth=new THREE.Group();caveMouth.position.copy(this.worldPosition(810,1910,.32));
                const darkness=new THREE.Mesh(new THREE.CircleGeometry(1.58,48,0,Math.PI),new THREE.MeshBasicMaterial({color:0x03040b,transparent:true,opacity:.985,side:THREE.DoubleSide}));darkness.position.set(0,.04,-.08);darkness.scale.set(1.08,1.28,1);caveMouth.add(darkness);
                for(let index=0;index<11;index+=1){const angle=index/10*Math.PI;const archRock=new THREE.Mesh(new THREE.DodecahedronGeometry(.46+(index%3)*.07,1),stone);archRock.position.set(Math.cos(angle)*1.62,Math.sin(angle)*1.82-.04,.02+(index%2)*.08);archRock.scale.set(1.12,.94,1.08);archRock.rotation.set(index*.13,index*.31,index*.09);archRock.castShadow=true;caveMouth.add(archRock);}this.environment.add(caveMouth);addCollision(660,1935,46);addCollision(960,1935,46);
                // Thick side walls taper toward the open entrance instead of
                // surrounding the player with a circular decorative rock ring.
                for(const [x,y,size] of [[600,1980,.78],[590,2070,.72],[620,2160,.64],[1020,1980,.78],[1030,2070,.72],[1000,2160,.64],[690,1870,.72],[810,1845,.82],[930,1870,.72]])addRock(x,y,size);
                const tunnelFloor=new THREE.Mesh(new THREE.BoxGeometry(2.75,.08,2.65),this.material(0x202232,{map:this.surfaceTextures.stone,bumpMap:this.surfaceTextures.stone,bumpScale:.05,roughness:.98,emissive:0x0b0c23,emissiveIntensity:.2}));tunnelFloor.position.copy(this.worldPosition(810,2090,.36));tunnelFloor.rotation.y=.02;this.environment.add(tunnelFloor);for(const [x,y,flip] of [[655,2015,-1],[965,2015,1],[665,2165,-1],[955,2165,1]]){const fang=new THREE.Mesh(new THREE.ConeGeometry(.18,.78,7),this.material(0x565b70,{roughness:.86,emissive:0x16172a,emissiveIntensity:.22}));fang.position.copy(this.worldPosition(x,y,.72));fang.rotation.z=flip*.07;fang.castShadow=true;this.environment.add(fang);}
                const oreData=[[675,2050,0xffbf52,.7],[720,1948,0xa970ff,.94],[755,2170,0x51f4ae,.62],[850,1938,0x59ddff,.88],[900,2125,0xff80df,.9],[970,2020,0xff5d62,.68],[835,2200,0x5f7dff,.58]];
                for(const [x,y,color,height] of oreData){const cluster=new THREE.Group();cluster.position.copy(this.worldPosition(x,y,.36));for(let shard=0;shard<5;shard+=1){const crystal=new THREE.Mesh(new THREE.ConeGeometry(.085+shard*.016,height*(.5+shard*.11),6),this.material(color,{emissive:color,emissiveIntensity:1.2,roughness:.2,metalness:.18,transparent:true,opacity:.96}));crystal.position.set((shard-2)*.085,height*(.28+shard*.05),(shard%2-.5)*.14);crystal.rotation.z=(shard-2)*.13;crystal.castShadow=true;cluster.add(crystal);}const oreGlow=new THREE.PointLight(color,2.6,2.9,2);oreGlow.position.y=.7;cluster.add(oreGlow);cluster.userData.phase=(x+y)*.013;cluster.userData.pulseScale=.045;this.dynamicEnvironment.add(cluster);this.districtAnimated.push(cluster);addCollision(x,y,18);}
                addSparkles(810,2070,0xbda1ff,30,2.35,1.72);for(const [radius,color] of [[.72,0x8c6bff],[1.18,0x43e9ff],[1.62,0xff77dd]])addGlowRing(810,2110,color,radius,.41);

                // 12. Banana Farm.
                addArea(2380,420,340,210,0xc7b46a,'grass');this.createDistrictLabel('BANANA FARM',2380,245,'#ffe45e');
                for(let row=0;row<3;row+=1){const soil=new THREE.Mesh(new THREE.BoxGeometry(3.8,.06,.34),this.material(0x70401f,{roughness:.98}));soil.position.copy(this.worldPosition(2380,350+row*85,.35));soil.receiveShadow=true;this.environment.add(soil);}
                for(let row=0;row<3;row+=1)for(let col=0;col<5;col+=1){const x=2220+col*80,y=350+row*85;const plant=new THREE.Group();plant.position.copy(this.worldPosition(x,y,.3));const stem=new THREE.Mesh(new THREE.CylinderGeometry(.035,.05,.55,7),leaf);stem.position.y=.28;plant.add(stem);for(let blade=0;blade<5;blade+=1){const frond=new THREE.Mesh(new THREE.CapsuleGeometry(.035,.32,3,6),leaf);frond.position.y=.55;frond.rotation.z=(blade/5*TAU);frond.rotation.x=.45;plant.add(frond);}for(let fruitIndex=0;fruitIndex<3;fruitIndex+=1){const fruit=new THREE.Mesh(new THREE.TorusGeometry(.105,.035,7,14,Math.PI*1.25),gold);fruit.position.set((fruitIndex-1)*.09,.66+fruitIndex*.025,0);fruit.rotation.z=.58+(fruitIndex-1)*.14;plant.add(fruit);}plant.userData.sway=.035;plant.userData.phase=row*.9+col*.42;this.environment.add(plant);this.districtAnimated.push(plant);addCollision(x,y,12);}

                // 13. Cloudtop Shrine.
                addArea(3650,470,280,205,0xaaa7bd);this.createDistrictLabel('CLOUDTOP SHRINE',3650,285,'#edf1ff');
                for(const radius of [.72,1.05]){const step=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius+.08,.15,36),stone);step.position.copy(this.worldPosition(3650,500,.31+(1.05-radius)*.16));this.environment.add(step);}for(const side of [-1,1]){const column=new THREE.Mesh(new THREE.CylinderGeometry(.18,.24,2,10),stone);column.position.copy(this.worldPosition(3650+side*130,500,1.3));column.castShadow=true;this.environment.add(column);addCollision(3650+side*130,500,24);}const shrine=new THREE.Mesh(new THREE.TorusGeometry(.52,.1,10,36),this.material(0xb8efff,{emissive:0x3c8ab5,emissiveIntensity:.8,roughness:.28}));shrine.position.copy(this.worldPosition(3650,480,1.3));shrine.rotation.y=Math.PI/2;shrine.userData.spin=.006;this.dynamicEnvironment.add(shrine);this.districtAnimated.push(shrine);const shrineOrb=new THREE.Mesh(new THREE.IcosahedronGeometry(.28,2),this.material(0xf1fbff,{emissive:0x75cfff,emissiveIntensity:1.8,transparent:true,opacity:.9}));shrineOrb.position.copy(this.worldPosition(3650,480,1.44));shrineOrb.userData.spin=.012;shrineOrb.userData.bob=.12;shrineOrb.userData.baseY=shrineOrb.position.y;this.dynamicEnvironment.add(shrineOrb);this.districtAnimated.push(shrineOrb);
                addSparkles(3650,470,0xd7f6ff,18,2.05,2.2);for(const radius of [.82,1.32])addGlowRing(3650,480,0xb8efff,radius,.42);

                // 14. Shipwreck Bay.
                addArea(4770,760,260,210,0xe1bd70,'sand');this.createDistrictLabel('SHIPWRECK BAY',4770,585,'#ffd08a');
                const wreck=new THREE.Group();wreck.position.copy(this.worldPosition(4770,800,.35));wreck.rotation.y=-.42;const hull=new THREE.Mesh(new THREE.BoxGeometry(2.2,.52,.85),wood);hull.rotation.z=.12;hull.castShadow=true;wreck.add(hull);const mast=new THREE.Mesh(new THREE.CylinderGeometry(.055,.08,2.25,8),wood);mast.position.set(.15,1.05,0);mast.rotation.z=.18;wreck.add(mast);const torn=new THREE.Mesh(new THREE.PlaneGeometry(1.1,.92),this.material(0xe7d19e,{transparent:true,opacity:.88,side:THREE.DoubleSide}));torn.position.set(.58,1.18,.02);torn.rotation.y=Math.PI/2;torn.userData.sway=.055;torn.userData.phase=1.8;wreck.add(torn);this.environment.add(wreck);this.districtAnimated.push(torn);addCollision(4770,800,112);const treasure=new THREE.Group();treasure.position.copy(this.worldPosition(4890,900,.36));const chest=new THREE.Mesh(new THREE.BoxGeometry(.7,.42,.48),this.material(0x7c3f22,{roughness:.7,metalness:.08}));chest.position.y=.2;treasure.add(chest);const chestBand=new THREE.Mesh(new THREE.BoxGeometry(.12,.48,.53),gold);chestBand.position.y=.23;treasure.add(chestBand);const chestGlow=new THREE.PointLight(0xffc94c,1.4,2.4,2);chestGlow.position.y=.65;treasure.add(chestGlow);treasure.userData.phase=2.2;this.dynamicEnvironment.add(treasure);this.districtAnimated.push(treasure);addCollision(4890,900,34);for(const [x,y,radius] of [[4670,900,.52],[4800,950,.74],[4950,820,.46]])addGlowRing(x,y,0xc9ffff,radius,.36);
            }

            canvasTexture(width,height,draw){
                const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d');draw(context,width,height);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.minFilter=THREE.LinearFilter;return texture;
            }

            createTextTexture(text,options={}){
                return this.canvasTexture(options.width||512,options.height||144,(context,width,height)=>{
                    context.clearRect(0,0,width,height);
                    const gradient=context.createLinearGradient(0,0,width,height);gradient.addColorStop(0,options.background||'rgba(3,35,30,.94)');gradient.addColorStop(1,options.backgroundEnd||'rgba(8,65,52,.94)');
                    context.fillStyle=gradient;context.strokeStyle=options.border||'#ffe673';context.lineWidth=8;context.beginPath();context.roundRect(8,8,width-16,height-16,28);context.fill();context.stroke();
                    context.fillStyle=options.color||'#fff6bd';context.textAlign='center';context.textBaseline='middle';context.font=`1000 ${options.fontSize||48}px Arial`;context.shadowColor='rgba(0,0,0,.65)';context.shadowBlur=8;context.fillText(String(text).slice(0,44),width/2,height/2,width-46);
                });
            }

            createHipRoofGeometry(width,depth,height){
                const halfWidth=width/2,halfDepth=depth/2,ridgeInset=Math.min(width*.2,1.05);
                const positions=new Float32Array([
                    -halfWidth,0,halfDepth, halfWidth,0,halfDepth, halfWidth-ridgeInset,height,0,
                    -halfWidth,0,halfDepth, halfWidth-ridgeInset,height,0, -halfWidth+ridgeInset,height,0,
                    halfWidth,0,-halfDepth, -halfWidth,0,-halfDepth, -halfWidth+ridgeInset,height,0,
                    halfWidth,0,-halfDepth, -halfWidth+ridgeInset,height,0, halfWidth-ridgeInset,height,0,
                    -halfWidth,0,-halfDepth, -halfWidth,0,halfDepth, -halfWidth+ridgeInset,height,0,
                    halfWidth,0,halfDepth, halfWidth,0,-halfDepth, halfWidth-ridgeInset,height,0
                ]);
                const geometry=new THREE.BufferGeometry();
                geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
                geometry.computeVertexNormals();
                geometry.computeBoundingSphere();
                return geometry;
            }

            createPalmFrondGeometry(length=1.35,width=.42){
                const geometry=new THREE.PlaneGeometry(length,width,8,2);
                const position=geometry.getAttribute('position');
                for(let index=0;index<position.count;index+=1){
                    const sourceX=position.getX(index),sourceY=position.getY(index),progress=clamp(sourceX/length+.5,0,1);
                    position.setXYZ(index,progress*length,sourceY,-Math.pow(progress,1.65)*.31);
                }
                position.needsUpdate=true;
                geometry.computeVertexNormals();
                geometry.computeBoundingSphere();
                return geometry;
            }

            distanceToSegment(x,z,segment){
                const dx=segment.bx-segment.ax,dz=segment.bz-segment.az,lengthSquared=dx*dx+dz*dz||1;
                const t=clamp(((x-segment.ax)*dx+(z-segment.az)*dz)/lengthSquared,0,1);
                return Math.hypot(x-(segment.ax+dx*t),z-(segment.az+dz*t));
            }

            isBeachfrontPoint(x,z){
                // The grass-to-sand line bows south through the plaza and back
                // inland at both edges. Keeping broadleaf trees above this line
                // leaves a visibly open sandy beachfront while palms and beach
                // furniture can opt in deliberately.
                const normalizedX=Math.min(1,Math.abs(x)/(this.worldWidth/WORLD_SCALE/2));
                const coastZ=3.0+1.72*(1-normalizedX);
                return z>=coastZ;
            }

            isInsideIsland(x,z){
                const mapX=x*WORLD_SCALE+this.worldWidth/2,mapY=z*WORLD_SCALE+this.worldHeight/2;
                const boundary=[[190,340],[620,125],[1250,80],[1960,105],[2850,70],[3660,130],[4510,310],[5000,760],[5110,1450],[5050,2280],[4740,2920],[4110,3260],[3200,3340],[2250,3300],[1350,3160],[650,2860],[220,2360],[70,1580],[75,850],[95,610]];
                let inside=false;
                for(let first=0,last=boundary.length-1;first<boundary.length;last=first++){
                    const [ax,ay]=boundary[first],[bx,by]=boundary[last];
                    if(((ay>mapY)!==(by>mapY))&&(mapX<(bx-ax)*(mapY-ay)/((by-ay)||1)+ax))inside=!inside;
                }
                return inside;
            }

            isLandscapeClear(x,z,radius=.35,options={}){
                // Never scatter scenery beyond the island silhouette. This
                // checks the full footprint rather than only its center, which
                // catches the old edge cases where canopies floated over water.
                if(!this.isInsideIsland(x,z))return false;
                const edgeRadius=Math.max(.08,radius+.12);
                for(let sample=0;sample<8;sample+=1){
                    const angle=sample/8*TAU;
                    if(!this.isInsideIsland(x+Math.cos(angle)*edgeRadius,z+Math.sin(angle)*edgeRadius))return false;
                }
                if(!options.allowBeach&&this.isBeachfrontPoint(x,z))return false;
                const plazaCenter=this.worldPosition(1600,930);
                if(Math.hypot(x-plazaCenter.x,z-plazaCenter.z)<5.35+radius)return false;
                if(this.roadKeepouts.some((segment)=>this.distanceToSegment(x,z,segment)<segment.halfWidth+radius+.24))return false;
                for(const building of this.buildings){
                    const collisions=building.collisions?.length?building.collisions:[building.collision||{x:building.x,y:building.y,w:building.w,h:building.h}];
                    for(const collision of collisions){const min=this.worldPosition(collision.x,collision.y),max=this.worldPosition(collision.x+collision.w,collision.y+collision.h);if(x>min.x-radius-.42&&x<max.x+radius+.42&&z>min.z-radius-.42&&z<max.z+radius+.42)return false;}
                    const door=this.worldPosition(building.doorX,building.doorY);
                    if(Math.abs(x-door.x)<1.05+radius&&z>door.z-1.05-radius&&z<door.z+2.3+radius)return false;
                }
                return true;
            }

            createBuilding(building,index){
                const group=new THREE.Group();group.name=building.name;
                const width=clamp(Number(building.w)/WORLD_SCALE*.72,3.5,6.8);
                const depth=clamp(((building.collision?.h||building.h*.68)/WORLD_SCALE)*.8,2.5,4.6);
                const height=[2.75,3.1,2.65,2.95,3.25][index]||2.8;
                const center=this.worldPosition(building.x+building.w/2,building.doorY-depth*WORLD_SCALE*.48,.28);
                group.position.copy(center);
                const body=new THREE.Mesh(new THREE.BoxGeometry(width,height,depth),this.material(building.color,{map:this.surfaceTextures.stucco,bumpMap:this.surfaceTextures.stucco,bumpScale:.024,roughness:.72}));body.position.y=height/2;body.castShadow=true;body.receiveShadow=true;group.add(body);
                const foundation=new THREE.Mesh(new THREE.BoxGeometry(width+.12,.46,depth+.12),this.material(0xb4a17e,{map:this.surfaceTextures.stone,bumpMap:this.surfaceTextures.stone,bumpScale:.035,roughness:.9}));foundation.position.y=.22;foundation.castShadow=true;foundation.receiveShadow=true;group.add(foundation);
                const eave=new THREE.Mesh(new THREE.BoxGeometry(width+.42,.16,depth+.42),this.material(building.highlight,{roughness:.52}));eave.position.y=height+.02;eave.castShadow=true;group.add(eave);
                const columnMaterial=this.material(building.highlight,{map:this.surfaceTextures.stucco,bumpMap:this.surfaceTextures.stucco,bumpScale:.018,roughness:.7});for(const x of [-width/2+.12,width/2-.12])for(const z of [-depth/2+.12,depth/2-.12]){const column=new THREE.Mesh(new THREE.BoxGeometry(.24,height+.18,.24),columnMaterial);column.position.set(x,(height+.18)/2,z);column.castShadow=true;group.add(column);}
                const trim=new THREE.Mesh(new THREE.BoxGeometry(width+.18,.18,depth+.18),this.material(building.highlight,{roughness:.58,emissive:building.highlight,emissiveIntensity:.06}));trim.position.y=height*.72;trim.castShadow=true;group.add(trim);
                const roofHeight=.88+Math.min(.25,width*.025);
                const roofMaterial=this.material(building.roof,{map:this.surfaceTextures.roof,bumpMap:this.surfaceTextures.roof,bumpScale:.028,roughness:.62,metalness:.025});
                const roof=new THREE.Mesh(this.createHipRoofGeometry(width+.62,depth+.68,roofHeight),roofMaterial);roof.position.y=height+.08;roof.castShadow=true;roof.receiveShadow=true;group.add(roof);
                const ridge=new THREE.Mesh(new THREE.BoxGeometry(Math.max(.9,width-2.02),.11,.16),this.material(building.highlight,{roughness:.54,emissive:building.highlight,emissiveIntensity:.035}));ridge.position.set(0,height+roofHeight+.1,0);ridge.castShadow=true;group.add(ridge);
                const pedimentShape=new THREE.Shape();pedimentShape.moveTo(-.72,0);pedimentShape.lineTo(.72,0);pedimentShape.lineTo(0,.58);pedimentShape.closePath();
                const pediment=new THREE.Mesh(new THREE.ShapeGeometry(pedimentShape),this.material(building.highlight,{side:THREE.DoubleSide,roughness:.64}));pediment.position.set(0,height-.02,depth/2+.055);group.add(pediment);
                const frontZ=depth/2+.032;
                const door=new THREE.Mesh(new THREE.BoxGeometry(.82,1.5,.12),this.material(0x173029,{roughness:.75}));door.position.set(0,.76,frontZ);door.castShadow=true;group.add(door);
                const handle=new THREE.Mesh(new THREE.SphereGeometry(.06,10,8),this.material(0xffdd63,{metalness:.55,roughness:.28}));handle.position.set(.26,.78,frontZ+.08);group.add(handle);
                const windowMaterial=new THREE.MeshPhysicalMaterial({color:0x7ee9ff,roughness:.16,metalness:.1,transparent:true,opacity:.8,emissive:0x1b6e89,emissiveIntensity:.28});
                for(const x of [-width*.3,width*.3]){const windowFrame=new THREE.Mesh(new THREE.BoxGeometry(.95,.84,.12),this.material(0x18352e,{roughness:.66}));windowFrame.position.set(x,1.55,frontZ);group.add(windowFrame);const glass=new THREE.Mesh(new THREE.PlaneGeometry(.76,.66),windowMaterial);glass.position.set(x,1.55,frontZ+.066);group.add(glass);}
                const signTexture=this.createTextTexture(`${building.icon} ${building.name}`,{width:640,height:138,fontSize:50,background:'rgba(15,45,37,.98)',border:'#ffe66d'});
                const sign=new THREE.Mesh(new THREE.PlaneGeometry(Math.min(width*.78,4.9),.85),new THREE.MeshBasicMaterial({map:signTexture,transparent:true,depthWrite:false}));sign.position.set(0,height-.52,frontZ+.075);group.add(sign);
                const awning=new THREE.Mesh(new THREE.BoxGeometry(Math.min(width*.72,4.2),.12,.7),this.material(building.highlight,{roughness:.5}));awning.position.set(0,height-.94,frontZ+.32);awning.rotation.x=-.18;awning.castShadow=true;group.add(awning);
                const frontWalk=new THREE.Mesh(new THREE.BoxGeometry(1.46,.075,1.6),this.material(0xd5bd8e,{map:this.surfaceTextures.paving,bumpMap:this.surfaceTextures.paving,bumpScale:.014,roughness:.94}));frontWalk.position.set(0,.12,frontZ+.76);frontWalk.receiveShadow=true;group.add(frontWalk);
                for(const side of [-1,1]){const awningPost=new THREE.Mesh(new THREE.CylinderGeometry(.045,.055,1.15,8),this.material(0x275045,{roughness:.74}));awningPost.position.set(side*Math.min(width*.3,1.48),.58,frontZ+.64);awningPost.castShadow=true;group.add(awningPost);}
                const light=new THREE.PointLight(index===3?0x5de9ff:0xffd980,4.2,7,2.2);light.position.set(0,1.45,frontZ+1);light.visible=false;group.add(light);this.nightLights.push(light);
                for(let potIndex=0;potIndex<2;potIndex+=1){const side=potIndex?-1:1;const pot=new THREE.Mesh(new THREE.CylinderGeometry(.18,.23,.34,10),this.material(0xb55f35));pot.position.set(side*(width/2-.38),.17,frontZ+.42);group.add(pot);const plant=new THREE.Mesh(new THREE.SphereGeometry(.34,10,8),this.material(0x3fb55e));plant.scale.y=.72;plant.position.set(side*(width/2-.38),.55,frontZ+.42);plant.castShadow=true;group.add(plant);}
                group.userData.buildingId=building.id;
                // Keep the same map-space cover zone used by the classic
                // renderer.  A pure camera-to-building distance check misses
                // wide roofs (Clan Hall in particular), leaving the player
                // completely hidden even though the building centre is not
                // directly between the camera and the player.
                group.userData.occlusion=building.occlusion?{...building.occlusion}:null;
                group.userData.occlusionRadius=Math.max(width,depth)*.56;
                group.userData.occlusionMaterials=[];
                const seenMaterials=new Set();
                group.traverse((object)=>{const materials=Array.isArray(object.material)?object.material:[object.material];for(const material of materials){if(!material||seenMaterials.has(material))continue;seenMaterials.add(material);material.userData.baseOpacity=Number(material.opacity??1);material.userData.baseTransparent=Boolean(material.transparent);material.userData.baseDepthWrite=Boolean(material.depthWrite);group.userData.occlusionMaterials.push(material);}});
                this.buildingGroups.push(group);
                this.environment.add(group);
                const doorGlow=new THREE.Mesh(new THREE.RingGeometry(.55,.72,40),new THREE.MeshBasicMaterial({color:0xffe76e,transparent:true,opacity:.36,side:THREE.DoubleSide}));doorGlow.rotation.x=-Math.PI/2;doorGlow.position.copy(this.worldPosition(building.doorX,building.doorY,.33));this.dynamicEnvironment.add(doorGlow);doorGlow.userData.phase=index*1.3;doorGlow.userData.doorGlow=true;
            }

            createBuildings(){this.buildings.forEach((building,index)=>this.createBuilding(building,index));}

            updateBuildingOcclusion(localX,localY){
                if(!this.buildingGroups?.length)return;
                const first=new THREE.Vector2(this.target.x,this.target.z),second=new THREE.Vector2(this.camera.position.x,this.camera.position.z),line=second.clone().sub(first),lengthSq=Math.max(.0001,line.lengthSq());
                const playerX=Number(localX),playerY=Number(localY);
                for(const group of this.buildingGroups){
                    const point=new THREE.Vector2(group.position.x,group.position.z),ratio=clamp(point.clone().sub(first).dot(line)/lengthSq,0,1),projection=first.clone().addScaledVector(line,ratio),gap=point.distanceTo(projection),between=ratio>.08&&ratio<.96;
                    const zone=group.userData.occlusion;
                    const insideClassicCover=Boolean(zone&&Number.isFinite(playerX)&&Number.isFinite(playerY)&&playerX>=Number(zone.x)&&playerX<=Number(zone.x)+Number(zone.w)&&playerY>=Number(zone.y)&&playerY<=Number(zone.frontY??(Number(zone.y)+Number(zone.h))));
                    const shouldFade=insideClassicCover||(between&&gap<Number(group.userData.occlusionRadius||2.6));
                    for(const material of group.userData.occlusionMaterials||[]){
                        // A readable cutaway is clearer than removing the whole
                        // landmark: keep enough of the facade visible to retain
                        // orientation while the monkey/nameplate stays on top.
                        const baseOpacity=Number(material.userData.baseOpacity??1),wanted=shouldFade?Math.min(baseOpacity,.34):baseOpacity;
                        material.opacity=THREE.MathUtils.lerp(Number(material.opacity??baseOpacity),wanted,shouldFade?.24:.11);
                        const faded=material.opacity<baseOpacity-.01;
                        const transparent=faded||Boolean(material.userData.baseTransparent),depthWrite=faded?false:Boolean(material.userData.baseDepthWrite);
                        if(material.transparent!==transparent||material.depthWrite!==depthWrite){material.transparent=transparent;material.depthWrite=depthWrite;material.needsUpdate=true;}
                    }
                }
            }

            createFoliage(){
                const trunkGeometry=new THREE.CylinderGeometry(.075,.12,1.25,7);
                const trunkMaterial=this.material(0x7b4928,{roughness:.96});
                const crownGeometry=new THREE.SphereGeometry(.62,12,8);
                const crownMaterials=[
                    this.material(0x237f48,{roughness:.9}),
                    this.material(0x36a854,{roughness:.88}),
                    this.material(0x69bd5a,{roughness:.9})
                ];
                const flowerGeometry=new THREE.SphereGeometry(.07,6,5);
                const flowerMaterials=[this.material(0xff719d),this.material(0xffdd58),this.material(0x9a79ff),this.material(0x70e8ff)];
                const palms=[];
                for(let index=0;index<72;index+=1){
                    const angle=seeded(index,44)*TAU,radiusX=10.6+seeded(index,45)*4.7,radiusZ=6.1+seeded(index,46)*2.1;
                    const x=Math.cos(angle)*radiusX+(seeded(index,47)-.5)*1.2,z=Math.sin(angle)*radiusZ+(seeded(index,48)-.5)*.8;
                    if(!this.isLandscapeClear(x,z,.43))continue;const scale=.75+seeded(index,49)*.72;palms.push({x,z,scale,phase:seeded(index,50)*TAU});this.registerEnvironmentCollision(x,z,Math.max(18,scale*25));
                }
                const trunks=new THREE.InstancedMesh(trunkGeometry,trunkMaterial,palms.length);trunks.castShadow=true;trunks.receiveShadow=true;
                const crownLayers=crownMaterials.map((crownMaterial)=>{const layer=new THREE.InstancedMesh(crownGeometry,crownMaterial,palms.length);layer.castShadow=true;return layer;});
                const matrix=new THREE.Matrix4();
                palms.forEach((tree,index)=>{
                    matrix.compose(new THREE.Vector3(tree.x,.58*tree.scale,tree.z),new THREE.Quaternion(),new THREE.Vector3(tree.scale,tree.scale,tree.scale));trunks.setMatrixAt(index,matrix);
                    const offsets=[[-.26,.02,-.04],[.25,.07,.02],[0,.27,.08]];
                    crownLayers.forEach((layer,layerIndex)=>{const offset=offsets[layerIndex];matrix.compose(new THREE.Vector3(tree.x+offset[0]*tree.scale,1.27*tree.scale+offset[1]*tree.scale,tree.z+offset[2]*tree.scale),new THREE.Quaternion(),new THREE.Vector3(tree.scale*(layerIndex===2?.72:.92),tree.scale*(layerIndex===2?.48:.58),tree.scale*(layerIndex===2?.78:.9)));layer.setMatrixAt(index,matrix);});
                });
                this.environment.add(trunks,...crownLayers);
                const palmFrondMap=new THREE.TextureLoader().load('assets/world/palm-frond.png?v=20260808a');palmFrondMap.colorSpace=THREE.SRGBColorSpace;palmFrondMap.magFilter=THREE.LinearFilter;palmFrondMap.minFilter=THREE.LinearMipmapLinearFilter;palmFrondMap.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());
                const palmLeafGeometry=this.createPalmFrondGeometry(1.58,.88),palmLeafMaterials=[0xe4ffde,0xffffff,0xd6f7bd].map((color)=>new THREE.MeshStandardMaterial({color,map:palmFrondMap,transparent:true,alphaTest:.065,side:THREE.DoubleSide,roughness:.82,depthWrite:true}));
                for(let index=0;index<24;index+=1){const angle=index/24*TAU+.18,radius=8.8+(index%5)*1.12,x=Math.cos(angle)*radius,z=Math.sin(angle)*radius*.62;if(!this.isLandscapeClear(x,z,.58,{allowBeach:true}))continue;this.registerEnvironmentCollision(x,z,24);const group=new THREE.Group();group.position.set(x,.24,z);group.rotation.y=-angle+.4;const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.07,.15,2.05,9),this.material(0x9a6336,{map:this.surfaceTextures.wood,bumpMap:this.surfaceTextures.wood,bumpScale:.025,roughness:.93}));trunk.position.y=1.02;trunk.rotation.z=(seeded(index,421)-.5)*.16;trunk.castShadow=true;group.add(trunk);for(let leafIndex=0;leafIndex<10;leafIndex+=1){const leaf=new THREE.Mesh(palmLeafGeometry,palmLeafMaterials[(index+leafIndex)%palmLeafMaterials.length]);leaf.position.set(0,2.07+(leafIndex%2)*.025,0);leaf.rotation.set(-1.03+(leafIndex%3)*.07,leafIndex/10*TAU,.02);leaf.scale.setScalar(.9+seeded(index*12+leafIndex,425)*.2);leaf.castShadow=true;group.add(leaf);}for(let coconut=0;coconut<3;coconut+=1){const fruit=new THREE.Mesh(new THREE.SphereGeometry(.085,8,6),this.material(0x684326,{roughness:.9}));fruit.position.set((coconut-1)*.1,1.91,.06*(coconut%2));group.add(fruit);}this.environment.add(group);}
                for(let index=0;index<115;index+=1){const angle=seeded(index,61)*TAU,radius=5.3+seeded(index,62)*8.7,x=Math.cos(angle)*radius,z=Math.sin(angle)*radius*.62;if(!this.isLandscapeClear(x,z,.12))continue;const flower=new THREE.Mesh(flowerGeometry,flowerMaterials[index%flowerMaterials.length]);flower.position.set(x,.34+seeded(index,63)*.12,z);flower.scale.setScalar(.75+seeded(index,64)*1.5);this.environment.add(flower);}
            }

            createLamp(x,y){const position=this.worldPosition(x,y,.3),group=new THREE.Group();this.environmentCollisions.push({x:Number(x),y:Number(y),radius:10});group.position.copy(position);const post=new THREE.Mesh(new THREE.CylinderGeometry(.045,.07,1.45,8),this.material(0x24403c,{metalness:.4,roughness:.45}));post.position.y=.72;post.castShadow=true;group.add(post);const bulb=new THREE.Mesh(new THREE.SphereGeometry(.14,12,8),this.material(0xffe987,{emissive:0xffc42c,emissiveIntensity:2.2,roughness:.2}));bulb.position.y=1.48;group.add(bulb);const light=new THREE.PointLight(0xffd36b,2.5,4.8,2.2);light.position.y=1.46;light.visible=false;group.add(light);this.nightLights.push(light);this.environment.add(group);}

            createProps(){
                [[1110,680],[1190,1080],[2010,700],[2030,1080],[970,850],[2230,875],[1480,520],[1710,520]].forEach((point)=>this.createLamp(...point));
                const benchWood=this.material(0x9a6137,{roughness:.9}),benchMetal=this.material(0x25433e,{metalness:.32,roughness:.55});
                for(const [x,y,rotation] of [[1270,680,.2],[1950,690,-.3],[1180,1120,-.15],[2050,1120,.2],[620,1270,.55]]){this.environmentCollisions.push({x:Number(x),y:Number(y),radius:45});const group=new THREE.Group();group.position.copy(this.worldPosition(x,y,.31));group.rotation.y=rotation;for(const z of [-.16,.16]){const slat=new THREE.Mesh(new THREE.BoxGeometry(1.1,.09,.12),benchWood);slat.position.set(0,.42,z);slat.castShadow=true;group.add(slat);}for(const side of [-.42,.42]){const leg=new THREE.Mesh(new THREE.BoxGeometry(.09,.42,.38),benchMetal);leg.position.set(side,.22,0);group.add(leg);}this.environment.add(group);}
                const rockMaterial=this.material(0x7f8f84,{roughness:1});
                for(let index=0;index<36;index+=1){const angle=seeded(index,80)*TAU,radius=12.1+seeded(index,81)*2.1,x=Math.cos(angle)*radius,z=Math.sin(angle)*radius*.61,size=.16+seeded(index,82)*.28;if(!this.isLandscapeClear(x,z,size,{allowBeach:true}))continue;const rock=new THREE.Mesh(new THREE.DodecahedronGeometry(size,0),rockMaterial);rock.position.set(x,.14,z);rock.scale.y=.65;rock.rotation.set(seeded(index,83),seeded(index,84),seeded(index,85));rock.castShadow=true;this.environment.add(rock);}
                const boat=new THREE.Group();boat.position.set(-11.7,-.42,12.25);boat.rotation.y=-.4;
                const hull=new THREE.Mesh(new THREE.CylinderGeometry(.34,.46,2.15,12,1,false),this.material(0x7d3f25,{map:this.surfaceTextures.wood,bumpMap:this.surfaceTextures.wood,bumpScale:.02,roughness:.78}));hull.rotation.z=Math.PI/2;hull.scale.z=.82;hull.castShadow=true;boat.add(hull);
                const innerHull=new THREE.Mesh(new THREE.CylinderGeometry(.26,.3,1.75,12,1,false),this.material(0x3f251c,{roughness:.88}));innerHull.rotation.z=Math.PI/2;innerHull.position.y=.14;innerHull.scale.z=.78;boat.add(innerHull);
                const mast=new THREE.Mesh(new THREE.CylinderGeometry(.035,.05,1.85,8),this.material(0x604025,{roughness:.86}));mast.position.set(.08,.95,0);mast.castShadow=true;boat.add(mast);
                const sailShape=new THREE.Shape();sailShape.moveTo(.05,.08);sailShape.lineTo(.05,1.58);sailShape.lineTo(1.05,.22);sailShape.closePath();
                const sail=new THREE.Mesh(new THREE.ShapeGeometry(sailShape),this.material(0xfff2c2,{side:THREE.DoubleSide,roughness:.75}));sail.position.set(.11,.14,.035);sail.rotation.y=Math.PI/2;sail.castShadow=true;boat.add(sail);
                const pennantShape=new THREE.Shape();pennantShape.moveTo(0,0);pennantShape.lineTo(0,.32);pennantShape.lineTo(.52,.18);pennantShape.closePath();const pennant=new THREE.Mesh(new THREE.ShapeGeometry(pennantShape),this.material(0xff695c,{side:THREE.DoubleSide,roughness:.66}));pennant.position.set(.08,1.8,.02);pennant.rotation.y=Math.PI/2;boat.add(pennant);
                boat.userData.baseY=-.42;this.environment.add(boat);this.boat=boat;
                const crateMaterial=this.material(0xb97935,{map:this.surfaceTextures.wood,bumpMap:this.surfaceTextures.wood,bumpScale:.025,roughness:.9});for(const [x,z] of [[-8.1,-3.3],[-7.65,-3.5],[-8.4,-2.95]]){const crate=new THREE.Mesh(new THREE.BoxGeometry(.42,.38,.42),crateMaterial);crate.position.set(x,.44,z);crate.rotation.y=seeded(Math.round((x+z)*100),12)*.35;crate.castShadow=true;this.environment.add(crate);}
                const umbrellaSpots=[
                    [2325,755,0xff8f67],[2405,795,0xffd95f],[2275,825,0x70c8c8],
                    // Classic-map social spots restored around the western
                    // garden and eastern promenade.
                    [430,1270,0xff7d8d],[2720,1280,0x69d6e8],[680,1370,0xffd65d]
                ];
                for(const [mapX,mapY,color] of umbrellaSpots){
                    const position=this.worldPosition(mapX,mapY,.3),group=new THREE.Group();group.position.copy(position);
                    this.environmentCollisions.push({x:mapX,y:mapY,radius:38});
                    const stem=new THREE.Mesh(new THREE.CylinderGeometry(.035,.05,1.35,8),this.material(0x5d4931,{roughness:.85}));stem.position.y=.67;group.add(stem);
                    const shade=new THREE.Mesh(new THREE.ConeGeometry(.85,.36,16,1,true),this.material(color,{side:THREE.DoubleSide,roughness:.72}));shade.position.y=1.36;shade.rotation.y=.2;shade.castShadow=true;group.add(shade);
                    const table=new THREE.Mesh(new THREE.CylinderGeometry(.42,.42,.09,16),this.material(0xefe0b0,{roughness:.8}));table.position.y=.5;table.castShadow=true;group.add(table);
                    for(const side of [-1,1]){const stool=new THREE.Mesh(new THREE.CylinderGeometry(.16,.18,.27,12),this.material(0x2f786b,{roughness:.8}));stool.position.set(side*.68,.16,.08);stool.castShadow=true;group.add(stool);}
                    this.environment.add(group);
                }
                const bulbMaterial=this.material(0xffe994,{emissive:0xffba35,emissiveIntensity:2.2,roughness:.22});for(let strand=0;strand<3;strand+=1){const start=new THREE.Vector3(-5.8+strand*5.7,3.3,-4.7),end=new THREE.Vector3(-.6+strand*5.7,3.1,-4.1),curve=new THREE.QuadraticBezierCurve3(start,start.clone().lerp(end,.5).add(new THREE.Vector3(0,-.6,0)),end),wire=new THREE.Mesh(new THREE.TubeGeometry(curve,18,.018,4,false),this.material(0x263a35,{roughness:.7}));this.environment.add(wire);for(let bulb=1;bulb<8;bulb+=1){const lamp=new THREE.Mesh(new THREE.SphereGeometry(.055,8,6),bulbMaterial);lamp.position.copy(curve.getPoint(bulb/8));this.environment.add(lamp);}}
            }

            createAtmosphere(){
                const particleCount=130;const positions=new Float32Array(particleCount*3);for(let index=0;index<particleCount;index+=1){positions[index*3]=(seeded(index,91)-.5)*31;positions[index*3+1]=.7+seeded(index,92)*5;positions[index*3+2]=(seeded(index,93)-.5)*18;}
                const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
                const material=new THREE.PointsMaterial({color:0xffef8d,size:.055,transparent:true,opacity:.58,depthWrite:false,blending:THREE.AdditiveBlending});
                this.fireflies=new THREE.Points(geometry,material);this.environment.add(this.fireflies);
                this.clouds=new THREE.Group();const cloudMaterial=this.material(0xffffff,{transparent:true,opacity:.38,roughness:1});for(let index=0;index<12;index+=1){const cloud=new THREE.Group();for(let puff=0;puff<5;puff+=1){const sphere=new THREE.Mesh(new THREE.SphereGeometry(.7+seeded(index*7+puff,1)*.5,12,8),cloudMaterial);sphere.position.set((puff-2)*.55,seeded(index*7+puff,2)*.28,seeded(index*7+puff,3)*.4);sphere.scale.y=.55;cloud.add(sphere);}cloud.position.set(-17+seeded(index,95)*34,8+seeded(index,96)*4,-16+seeded(index,97)*15);cloud.userData.speed=.08+seeded(index,98)*.14;this.clouds.add(cloud);}this.environment.add(this.clouds);
            }

            animatedImageHostElement(){
                if(this.animatedImageHost?.isConnected)return this.animatedImageHost;
                const host=document.createElement('div');
                host.className='mw-animated-skin-decode-host';
                host.setAttribute('aria-hidden','true');
                // Chromium can freeze an animated image that has never joined
                // the rendered document. Keep a nearly transparent 2px decode
                // surface alive without affecting layout or input.
                host.style.cssText='position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:.001;pointer-events:none;z-index:-2147483647;contain:strict;';
                (document.body||document.documentElement).appendChild(host);
                this.animatedImageHost=host;
                return host;
            }

            animatedImageFallback(source,texture){
                const image=document.createElement('img');
                image.alt='';
                image.decoding='auto';
                image.loading='eager';
                image.fetchPriority='high';
                image.style.cssText='display:block;width:2px;height:2px;object-fit:contain;';
                image.addEventListener('load',()=>{
                    texture.image=image;
                    texture.needsUpdate=true;
                },{once:true});
                this.animatedImageHostElement().appendChild(image);
                image.src=source;
                this.animatedTextureImages.set(texture,image);
                const state=this.animatedTextureStates.get(texture);
                if(state)state.fallback=true;
            }

            async beginAnimatedDecode(source,texture,state){
                try{
                    if(typeof global.ImageDecoder!=='function'||!(await global.ImageDecoder.isTypeSupported('image/gif')))throw new Error('Animated GIF decoding is unavailable');
                    const response=await fetch(source,{cache:'force-cache'});
                    if(!response.ok)throw new Error(`GIF request failed (${response.status})`);
                    const decoder=new global.ImageDecoder({data:await response.arrayBuffer(),type:'image/gif',preferAnimation:true});
                    await decoder.tracks.ready;
                    const track=decoder.tracks.selectedTrack;
                    if(!track||Number(track.frameCount)<2)throw new Error('GIF has no animated track');
                    state.decoder=decoder;
                    state.frameCount=Math.max(1,Number(track.frameCount)||1);
                    state.nextFrameAt=0;
                }catch(error){
                    console.warn('Using browser GIF fallback for Monkey World skin.',source,error);
                    state.decoder?.close?.();
                    state.decoder=null;
                    this.animatedImageFallback(source,texture);
                }
            }

            async decodeAnimatedFrame(state,now){
                if(!state?.decoder||state.decoding)return;
                state.decoding=true;
                try{
                    const result=await state.decoder.decode({frameIndex:state.frameIndex});
                    const frame=result?.image;
                    if(!frame)throw new Error('GIF decoder returned no frame');
                    const width=Math.max(1,Number(frame.displayWidth||frame.codedWidth)||1);
                    const height=Math.max(1,Number(frame.displayHeight||frame.codedHeight)||1);
                    if(state.canvas.width!==width||state.canvas.height!==height){state.canvas.width=width;state.canvas.height=height;}
                    state.context.clearRect(0,0,width,height);
                    state.context.drawImage(frame,0,0,width,height);
                    if(!state.pixelSample){
                        const pixels=state.context.getImageData(0,0,width,height).data;
                        let opaquePixels=0,maxAlpha=0;
                        for(let offset=3;offset<pixels.length;offset+=4){const alpha=pixels[offset];if(alpha>12)opaquePixels+=1;if(alpha>maxAlpha)maxAlpha=alpha;}
                        state.pixelSample={width,height,opaquePixels,maxAlpha};
                    }
                    const duration=Math.max(20,Number(frame.duration||50000)/1000);
                    frame.close?.();
                    state.frameIndex=(state.frameIndex+1)%state.frameCount;
                    state.nextFrameAt=Math.max(Number(now)||performance.now(),performance.now())+duration;
                    state.texture.needsUpdate=true;
                    state.frameSerial+=1;
                    this.animatedFrameSerial+=1;
                }catch(error){
                    console.warn('Animated Monkey World skin frame failed; using browser fallback.',state.source,error);
                    state.decoder?.close?.();
                    state.decoder=null;
                    this.animatedImageFallback(state.source,state.texture);
                }finally{
                    state.decoding=false;
                }
            }

            animatedTexture(source){
                // Browsers already composite GIF disposal frames correctly.
                // Keeping a tiny live <img> in the document and re-uploading
                // its current frame avoids ImageDecoder implementations that
                // can return an empty/delta frame for RGB and Trippy Monkey.
                const image=document.createElement('img');
                image.alt='';image.decoding='auto';image.loading='eager';image.fetchPriority='high';
                image.style.cssText='display:block;width:2px;height:2px;object-fit:contain;';
                const texture=new THREE.Texture(image),canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;
                const state={source,texture,canvas,context:canvas.getContext('2d',{alpha:true,willReadFrequently:true}),decoder:null,frameCount:0,frameIndex:0,nextFrameAt:0,decoding:false,fallback:true,frameSerial:0,pixelSample:null};
                this.animatedTextures.add(texture);
                this.animatedTextureStates.set(texture,state);
                this.animatedTextureImages.set(texture,image);
                image.addEventListener('load',()=>{texture.needsUpdate=true;},{once:true});
                this.animatedImageHostElement().appendChild(image);
                image.src=source;
                return texture;
            }

            texture(path){
                const source=String(path||'Default Monkey.png');
                if(this.textureCache.has(source))return this.textureCache.get(source);
                const animated=/\.gif(?:$|[?#])/i.test(source);
                const texture=animated?this.animatedTexture(source):new THREE.TextureLoader().load(source);
                texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=THREE.LinearFilter;texture.minFilter=animated?THREE.LinearFilter:THREE.LinearMipmapLinearFilter;texture.generateMipmaps=!animated;texture.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());
                // All local/interior and remote-player sprites share this one
                // actively decoded image and receive its current frame at 20 FPS.
                this.textureCache.set(source,texture);return texture;
            }

            rankIconSource(ranked={}){
                const rankName=String(ranked.rank||ranked.name||'').toLowerCase().replace(/[^a-z]/g,' ').trim();
                if(rankName==='monkey king')return 'rank-icons/monkeyking.svg';
                const match=/^(bronze|silver|gold|platinum|diamond|master|champion) (i|ii|iii)$/.exec(rankName);
                if(match)return `rank-icons/${match[1]}${match[2]==='i'?'':`-${match[2]}`}.svg`;
                return String(ranked.icon||'');
            }

            refreshAnimatedTextures(now){
                if(!this.animatedTextures.size||now-this.lastAnimatedTextureRefresh<16)return;
                this.lastAnimatedTextureRefresh=now;
                for(const texture of this.animatedTextures){
                    const state=this.animatedTextureStates.get(texture);
                    if(state?.decoder&&!state.decoding&&now>=state.nextFrameAt){this.decodeAnimatedFrame(state,now);continue;}
                    const image=this.animatedTextureImages.get(texture)||texture?.image;
                    if(state?.fallback&&image?.complete&&Number(image.naturalWidth)>0){
                        texture.needsUpdate=true;
                        // A tiny probe proves native GIF frames keep advancing
                        // without reading the full 300px sprite every frame.
                        if(state.context&&state.canvas&&now>=state.nextFrameAt){
                            state.context.clearRect(0,0,state.canvas.width,state.canvas.height);
                            state.context.drawImage(image,0,0,state.canvas.width,state.canvas.height);
                            const pixels=state.context.getImageData(0,0,state.canvas.width,state.canvas.height).data;
                            let opaquePixels=0,maxAlpha=0;for(let offset=3;offset<pixels.length;offset+=4){const alpha=pixels[offset];if(alpha>12)opaquePixels+=1;if(alpha>maxAlpha)maxAlpha=alpha;}
                            state.pixelSample={width:state.canvas.width,height:state.canvas.height,opaquePixels,maxAlpha};
                            state.frameSerial+=1;this.animatedFrameSerial+=1;state.nextFrameAt=now+50;
                        }
                    }
                }
            }

            createPlayerNode(player){
                const group=new THREE.Group();
                const shadow=new THREE.Mesh(new THREE.CircleGeometry(.48,24),new THREE.MeshBasicMaterial({color:0x041a18,transparent:true,opacity:.32,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=.02;group.add(shadow);
                const material=new THREE.SpriteMaterial({map:this.texture(player.skin),transparent:true,alphaTest:.05,depthWrite:true});
                // Monkey artwork is intentionally rendered larger than its
                // source PNG in the world. Nearest filtering made the new map
                // look blocky even though the classic renderer was smooth.
                material.map.magFilter=THREE.LinearFilter;material.map.minFilter=material.map.generateMipmaps!==false?THREE.LinearMipmapLinearFilter:THREE.LinearFilter;material.map.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());material.map.needsUpdate=true;
                const sprite=new THREE.Sprite(material);sprite.center.set(.5,.08);sprite.position.y=.08;sprite.scale.set(1.42,1.42,1);sprite.castShadow=true;group.add(sprite);
                // Keep the identity stack compact like classic Monkey World so
                // it frames the monkey instead of covering the character/map.
                const label=new THREE.Sprite(new THREE.SpriteMaterial({transparent:true,depthTest:false,depthWrite:false}));label.position.y=1.67;label.scale.set(2.28,.70,1);label.renderOrder=90;group.add(label);
                const rankIcon=new THREE.Sprite(new THREE.SpriteMaterial({transparent:true,depthTest:false,depthWrite:false}));rankIcon.position.set(-.99,1.76,.02);rankIcon.scale.set(.27,.27,1);rankIcon.visible=false;rankIcon.renderOrder=92;group.add(rankIcon);
                // Voice activity remains outside the right edge of the plate.
                const voice=this.iconSprite('🔊','#4ff0a2',128);voice.position.set(1.18,1.73,.02);voice.scale.set(.29,.29,1);voice.visible=false;voice.renderOrder=93;voice.material.depthTest=false;group.add(voice);
                const emoteFx=new THREE.Mesh(new THREE.TorusGeometry(.72,.035,8,52),new THREE.MeshBasicMaterial({color:0xffdf64,transparent:true,opacity:.72,depthWrite:false,blending:THREE.AdditiveBlending}));emoteFx.rotation.x=Math.PI/2;emoteFx.position.y=.16;emoteFx.visible=false;group.add(emoteFx);
                const aura=new THREE.Mesh(new THREE.TorusGeometry(.68,.045,8,48),new THREE.MeshBasicMaterial({color:0xffdf59,transparent:true,opacity:.72,depthWrite:false,blending:THREE.AdditiveBlending}));aura.rotation.x=Math.PI/2;aura.position.y=.2;group.add(aura);
                // Monkey World combat uses the recognizable Duel Wood Sword
                // artwork instead of the old generic metal box geometry.
                const swordMap=this.texture('assets/duel/runtime/sword-wood-world.png?v=20260815c');
                const swordMaterial=new THREE.SpriteMaterial({map:swordMap,transparent:true,alphaTest:.025,depthWrite:false});
                const sword=new THREE.Sprite(swordMaterial);sword.center.set(.27,.14);sword.position.set(.42,.48,.12);sword.scale.set(.72,.9,1);sword.visible=false;sword.renderOrder=18;group.add(sword);
                const guard=new THREE.Group();
                const guardArc=new THREE.Mesh(new THREE.TorusGeometry(.47,.065,10,48,Math.PI*1.32),new THREE.MeshBasicMaterial({color:0x6feaff,transparent:true,opacity:.9,blending:THREE.AdditiveBlending,depthWrite:false}));guardArc.rotation.z=-2.34;guard.add(guardArc);
                const guardGlow=new THREE.Mesh(new THREE.CircleGeometry(.42,32,Math.PI*.2,Math.PI*.62),new THREE.MeshBasicMaterial({color:0x55dfff,transparent:true,opacity:.16,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false}));guardGlow.rotation.z=-2.34;guard.add(guardGlow);
                guard.position.set(.12,.78,.18);guard.visible=false;guard.renderOrder=22;group.add(guard);
                group.userData={sprite,label,rankIcon,rankIconSource:'',voice,emoteFx,aura,sword,guard,guardArc,guardGlow,labelKey:'',skin:player.skin,baseScale:1.42,facingScale:player.direction==='left'?-1:1,lastDirection:String(player.direction||'down'),turnStartedAt:0,attackStartedAt:0,attackUntil:0};
                this.playerLayer.add(group);return group;
            }

            updatePlayerLabel(node,player,local,now){
                const title=player.equippedTitle&&player.equippedTitle!=='None'?String(player.equippedTitle):'';
                const clan=player.clan?.tag?`[${player.clan.tag}] `:'';
                const nameStyle=player.nameStyle&&typeof player.nameStyle==='object'?player.nameStyle:{};
                const titleStyle=player.titleStyle&&typeof player.titleStyle==='object'?player.titleStyle:{};
                const bannerId=String(player.banner||'skin-default');
                const banner=bannerId==='skin-default'||bannerId==='none'?null:global.FlappyBanners?.byId?.(bannerId);
                const animatedStyle=Boolean(nameStyle.rgb||nameStyle.gradient||titleStyle.rgb||titleStyle.gradient||titleStyle.fx==='neonpulse');
                const animationBucket=animatedStyle?Math.floor(Number(now||0)/120):0;
                const rankSource=this.rankIconSource(player.ranked||{});
                const key=`${clan}${player.username}|${title}|${player.level}|${local}|${bannerId}|${player.platform}|${rankSource}|${JSON.stringify(nameStyle)}|${JSON.stringify(titleStyle)}|${animationBucket}`;
                if(node.userData.labelKey===key)return;
                node.userData.labelKey=key;
                if(rankSource!==node.userData.rankIconSource){node.userData.rankIconSource=rankSource;node.userData.rankIcon.material.map=rankSource?this.texture(rankSource):null;node.userData.rankIcon.material.needsUpdate=true;node.userData.rankIcon.visible=Boolean(rankSource);}
                node.userData.label.material.map?.dispose?.();
                node.userData.label.material.map=this.canvasTexture(768,236,(context,width,height)=>{
                    context.clearRect(0,0,width,height);context.textAlign='center';context.textBaseline='middle';
                    const plateGradient=context.createLinearGradient(18,14,width-18,88);plateGradient.addColorStop(0,banner?.b1||'#031817');plateGradient.addColorStop(.56,banner?.b2||'#123d31');plateGradient.addColorStop(1,banner?.b1||'#031817');
                    context.fillStyle=plateGradient;context.strokeStyle=local?'#ffe36b':(banner?.accent||'rgba(183,238,211,.92)');context.lineWidth=6;context.beginPath();context.roundRect(18,14,width-36,72,28);context.fill();context.stroke();
                    const flag=(value)=>value===true||value===1||value==='true'||value==='1';
                    const nameRgb=flag(nameStyle.rgb),nameGradient=flag(nameStyle.gradient)&&!nameRgb,nameSpeed=Math.max(.35,Math.min(8,Number(nameStyle.rgbSpeed)||3)),nameHue=(Number(now||0)/(nameSpeed*1000)*360)%360;
                    let nameColor=/^#[0-9a-f]{6}$/i.test(String(nameStyle.color||''))?String(nameStyle.color):'#fff3a5';
                    if(nameRgb)nameColor=`hsl(${nameHue},100%,76%)`;
                    else if(nameGradient){const gradient=context.createLinearGradient(95,0,width-95,0);for(let stop=0;stop<=6;stop+=1)gradient.addColorStop(stop/6,`hsl(${(nameHue+stop*60)%360},100%,72%)`);nameColor=gradient;}
                    context.fillStyle=nameColor;context.shadowColor=nameRgb||nameGradient?`hsl(${nameHue},100%,70%)`:nameColor;context.shadowBlur=flag(nameStyle.glow)?11:0;context.font='1000 37px Arial';context.fillText(`${clan}${player.username||'Monkey'}`.slice(0,32),width/2,50,width-174);context.shadowBlur=0;
                    if(['mobile','pc'].includes(player.platform)){context.save();context.translate(width-60,50);context.strokeStyle=player.platform==='mobile'?'#7cfff0':'#9fc7ff';context.fillStyle='rgba(6,25,35,.94)';context.lineWidth=4;if(player.platform==='mobile'){context.beginPath();context.roundRect(-10,-16,20,32,5);context.fill();context.stroke();context.fillRect(-4,11,8,2);}else{context.beginPath();context.roundRect(-16,-12,32,22,4);context.fill();context.stroke();context.beginPath();context.moveTo(-6,16);context.lineTo(6,16);context.moveTo(0,10);context.lineTo(0,16);context.stroke();}context.restore();}
                    if(title){
                        const titleRgb=flag(titleStyle.rgb),titleGradient=flag(titleStyle.gradient)&&!titleRgb,titleSpeed=Math.max(.35,Math.min(30,Number(titleStyle.rgbSpeed)||2)),titleHue=(Number(now||0)/(titleSpeed*1000)*360)%360,fx=String(titleStyle.fx||'none').toLowerCase();
                        context.fillStyle='rgba(3,47,39,.96)';context.strokeStyle=fx==='glitch'?'#42eeff':(banner?.accent||'#d7ae4b');context.lineWidth=4;context.beginPath();context.roundRect(155,98,width-310,44,19);context.fill();context.stroke();
                        let titleColor=/^#[0-9a-f]{6}$/i.test(String(titleStyle.color||''))?String(titleStyle.color):'#ffe988';if(titleRgb||fx==='neonpulse')titleColor=`hsl(${titleHue},100%,82%)`;else if(titleGradient){const gradient=context.createLinearGradient(125,0,width-125,0);for(let stop=0;stop<=6;stop+=1)gradient.addColorStop(stop/6,`hsl(${(titleHue+stop*60)%360},100%,72%)`);titleColor=gradient;}else if(fx==='fire')titleColor='#fff0a8';else if(fx==='sparkle')titleColor='#fff8c9';
                        context.font='900 22px Arial';context.shadowColor=titleRgb||titleGradient||fx!=='none'?`hsl(${titleHue},100%,68%)`:titleColor;context.shadowBlur=flag(titleStyle.glow)||fx!=='none'?8:0;if(fx==='glitch'){context.fillStyle='#00efff';context.fillText(title.slice(0,35),width/2-2,120,width-344);context.fillStyle='#ff43c8';context.fillText(title.slice(0,35),width/2+2,120,width-344);}context.fillStyle=titleColor;context.fillText(title.slice(0,35),width/2,120,width-344);context.shadowBlur=0;
                    }
                    const levelY=title?174:122;context.font='1000 22px Arial';context.lineWidth=5;context.strokeStyle='rgba(3,18,17,.92)';context.strokeText(`LEVEL ${Math.max(1,Number(player.level)||1)}`,width/2,levelY);context.fillStyle='#ffe66d';context.fillText(`LEVEL ${Math.max(1,Number(player.level)||1)}`,width/2,levelY);
                });
                node.userData.label.material.needsUpdate=true;
            }

            syncPlayers(players,event,now,localProfileId){
                const activeIds=new Set();
                for(const player of players){
                    const id=String(player.profileId||player.id||'');if(!id)continue;activeIds.add(id);
                    let node=this.playerNodes.get(id);if(!node){node=this.createPlayerNode(player);this.playerNodes.set(id,node);}
                    if(node.userData.skin!==player.skin){node.userData.skin=player.skin;const skinTexture=this.texture(player.skin);skinTexture.magFilter=THREE.LinearFilter;skinTexture.minFilter=skinTexture.generateMipmaps!==false?THREE.LinearMipmapLinearFilter:THREE.LinearFilter;skinTexture.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());skinTexture.needsUpdate=true;node.userData.sprite.material.map=skinTexture;node.userData.sprite.material.needsUpdate=true;}
                    const local=id===localProfileId;const position=this.worldPosition(player.x,player.y,.3);node.position.lerp(position,local?1:.2);
                    const moving=Boolean(player.moving),emoteActive=Boolean(player.emoteId&&Number(player.emoteUntil||0)>Date.now()),emoteTime=(Date.now()-Number(player.emoteStartedAt||Date.now()))/1000;
                    const step=moving?Math.sin(now*.012+Number(player.x)*.01):Math.sin(now*.0025+Number(player.y)*.01)*.18;
                    const nextDirection=String(player.direction||node.userData.lastDirection||'down');
                    if(nextDirection!==node.userData.lastDirection){node.userData.lastDirection=nextDirection;node.userData.turnStartedAt=now;}
                    const turnProgress=node.userData.turnStartedAt?Math.min(1,Math.max(0,(now-node.userData.turnStartedAt)/220)):1;
                    const turnPulse=Math.sin(turnProgress*Math.PI);
                    const currentFacing=node.userData.facingScale??1,targetFacing=player.direction==='left'?-1:player.direction==='right'?1:(currentFacing<0?-1:1);node.userData.facingScale=THREE.MathUtils.lerp(currentFacing,targetFacing,.2);
                    let emoteLift=0,emoteLean=0,emoteShift=0,emoteScaleX=1,emoteScaleY=1;
                    if(emoteActive){
                        const emoteId=String(player.emoteId),beat=Math.sin(emoteTime*6);
                        if(emoteId==='wave'){emoteLean=Math.sin(emoteTime*5)*.15;emoteShift=Math.sin(emoteTime*2.5)*.05;emoteScaleX=1+Math.sin(emoteTime*5)*.025;}
                        else if(emoteId==='banana-shuffle'){const shuffle=Math.sin(emoteTime*8);emoteShift=shuffle*.24;emoteLift=Math.abs(Math.cos(emoteTime*8))*.08;emoteLean=shuffle*.14;emoteScaleX=1-Math.abs(shuffle)*.04;emoteScaleY=1+Math.abs(shuffle)*.1;}
                        else if(emoteId==='monkey-groove'){const groove=Math.sin(emoteTime*5.5);emoteLift=Math.abs(groove)*.19;emoteLean=Math.sin(emoteTime*2.75)*.22;emoteShift=Math.sin(emoteTime*2.75)*.1;emoteScaleX=1+Math.abs(groove)*.1;emoteScaleY=1-Math.abs(groove)*.06;}
                        else if(emoteId==='crown-bounce'){const jump=Math.pow(Math.abs(Math.sin(emoteTime*2.75)),1.35);emoteLift=jump*.48;emoteScaleX=1+(1-jump)*.13;emoteScaleY=.88+jump*.22;emoteLean=Math.sin(emoteTime*1.35)*.035;}
                        else if(emoteId==='pirate-jig'){const jig=Math.sin(emoteTime*7.4),heel=Math.sin(emoteTime*14.8);emoteShift=jig*.28;emoteLift=Math.max(0,heel)*.08;emoteLean=Math.sign(jig)*.23;emoteScaleX=.96+Math.abs(heel)*.06;emoteScaleY=1.04-Math.abs(heel)*.05;}
                        else if(emoteId==='snow-spin'){emoteLean=emoteTime*5;emoteShift=Math.sin(emoteTime*3.4)*.11;emoteLift=.1+Math.abs(Math.sin(emoteTime*3.4))*.1;emoteScaleX=.94+Math.abs(Math.cos(emoteTime*3.4))*.08;}
                        else if(emoteId==='robot-glitch'){const tick=Math.floor(emoteTime*12);emoteShift=((tick%5)-2)*.055;emoteLift=((tick%3)-1)*.04;emoteLean=((tick%4)-1.5)*.07;emoteScaleX=tick%2?1.09:.91;emoteScaleY=tick%3?1.03:.9;}
                        else if(emoteId==='inferno-stomp'){const stomp=Math.max(0,Math.sin(emoteTime*5.2));emoteLift=stomp*.2;emoteScaleX=1+(1-stomp)*.13;emoteScaleY=.87+stomp*.19;emoteLean=Math.sin(emoteTime*2.6)*.055;}
                        else if(emoteId==='galaxy-float'){emoteLift=.28+Math.sin(emoteTime*2.1)*.14;emoteLean=Math.sin(emoteTime*1.35)*.11;emoteShift=Math.sin(emoteTime*.9)*.08;emoteScaleX=1.03;emoteScaleY=1.03;}
                        else if(emoteId==='disco-peel'){const disco=Math.sin(emoteTime*6.2);emoteShift=disco*.18;emoteLift=Math.abs(Math.cos(emoteTime*6.2))*.16;emoteLean=disco*.2;emoteScaleX=1+Math.abs(disco)*.09;emoteScaleY=1-Math.abs(disco)*.05;}
                        else if(emoteId==='victory-flex'){const cycle=((emoteTime%4)+4)%4,direction=Math.floor(emoteTime/4)%2?-1:1;if(cycle<.58){const charge=cycle/.58,ease=charge*charge*(3-2*charge);emoteLift=-.06*ease;emoteLean=-direction*.07*ease;emoteShift=-direction*.05*ease;emoteScaleX=1+.14*ease;emoteScaleY=1-.18*ease;}else if(cycle<1.28){const launch=(cycle-.58)/.7,jump=Math.sin(launch*Math.PI),turn=Math.sin(launch*Math.PI*2);emoteLift=.52*jump;emoteLean=direction*turn*.15;emoteShift=direction*Math.sin(launch*Math.PI)*.1;emoteScaleX=1.12-jump*.08;emoteScaleY=.92+jump*.2;}else{const pump=Math.sin((cycle-1.28)*7.5),accent=Math.pow(Math.abs(pump),1.7);emoteLift=.06+Math.abs(pump)*.04;emoteLean=direction*pump*.055;emoteShift=direction*pump*.055;emoteScaleX=1.22+accent*.13;emoteScaleY=.92-accent*.035;}}
                        else{emoteLift=Math.abs(beat)*.12;emoteLean=beat*.13;emoteShift=beat*.09;emoteScaleX=1+Math.abs(beat)*.07;emoteScaleY=1-Math.abs(beat)*.045;}
                    }
                    const turnLean=(nextDirection==='left'?-1:nextDirection==='right'?1:nextDirection==='up'?-0.45:0.45)*turnPulse*.11;
                    node.userData.sprite.position.x=emoteShift;node.userData.sprite.position.y=.08+Math.abs(step)*.08+emoteLift;node.userData.sprite.material.rotation=emoteActive?emoteLean:(moving?step*.035:0)+turnLean;
                    const turnSquash=1-turnPulse*.075,turnStretch=1+turnPulse*.055;
                    node.userData.sprite.scale.x=node.userData.facingScale*node.userData.baseScale*(1-Math.abs(step)*.025)*emoteScaleX*turnSquash;node.userData.sprite.scale.y=node.userData.baseScale*(1+Math.abs(step)*.04)*emoteScaleY*turnStretch;
                    this.updatePlayerLabel(node,player,local,now);
                    node.userData.emoteFx.visible=emoteActive;if(emoteActive){const emoteHue=Math.abs(String(player.emoteId).split('').reduce((sum,char)=>sum+char.charCodeAt(0),0)*37)%360,pulse=(Math.sin(emoteTime*7)+1)/2;node.userData.emoteFx.material.color.setHSL(emoteHue/360,.92,.62);node.userData.emoteFx.material.opacity=.38+pulse*.42;node.userData.emoteFx.scale.setScalar(.86+pulse*.3);node.userData.emoteFx.rotation.z=emoteTime*1.4;}
                    const voiceActivity=global.flappyMonkeyWorldVoiceActivity?.(id),voiceVisible=Boolean(voiceActivity?.speaking||voiceActivity?.muted);node.userData.voice.visible=voiceVisible;if(voiceVisible){const level=Math.min(1,Math.max(.15,Number(voiceActivity?.level||0)*8)),pulse=voiceActivity.muted?0:(Math.sin(now*.018)+1)*.5*level;node.userData.voice.scale.setScalar(.3+pulse*.08);node.userData.voice.material.color.set(voiceActivity.muted?0x77847f:0x4ff0a2);node.userData.voice.material.opacity=voiceActivity.muted?.72:1;}
                    const auraAllowed=global.flappyVisualEffectsEnabled?.('aura')!==false;node.userData.aura.visible=auraAllowed&&Boolean(player.aura&&player.aura!=='none');
                    if(node.userData.aura.visible){const hue=Math.abs(String(player.aura).split('').reduce((sum,char)=>sum+char.charCodeAt(0),0)*31)%360;node.userData.aura.material.color.setHSL(hue/360,.92,.62);node.userData.aura.rotation.z=now*.0012;node.userData.aura.scale.setScalar(1+Math.sin(now*.004+Number(player.x))*.08);}
                    const playerStats=event?.leaderboard?.find((entry)=>entry.profileId===id);
                    const alive=!event?.leaderboard||playerStats?.alive!==false;
                    const guarding=alive&&Number(playerStats?.blockUntil||0)>Date.now();
                    node.visible=alive;
                    node.userData.sword.visible=Boolean(event?.combat&&alive);
                    node.userData.guard.visible=Boolean(event?.combat&&guarding);
                    if(node.userData.guard.visible){const guardPulse=(Math.sin(now*.018)+1)/2;node.userData.guard.scale.setScalar(.92+guardPulse*.12);node.userData.guardArc.material.opacity=.62+guardPulse*.32;node.userData.guardGlow.material.opacity=.12+guardPulse*.12;}
                    if(node.userData.sword.visible){
                        const facing=player.direction==='left'?-1:1;
                        const idleAngle=(player.direction==='up'?-.42:player.direction==='down'?.42:-.16)+Math.sin(now*.0025+Number(player.x))*.025;
                        const duration=520;
                        const progress=node.userData.attackUntil>now&&node.userData.attackStartedAt
                            ?Math.min(1,(now-node.userData.attackStartedAt)/duration)
                            :0;
                        const ease=(value)=>value*value*(3-2*value);
                        let angle=guarding?-.98:idleAngle;
                        if(!guarding&&progress>0&&progress<1){
                            if(progress<.18){const t=ease(progress/.18);angle=idleAngle+(-.92-idleAngle)*t;}
                            else if(progress<.58){const t=ease((progress-.18)/.4);angle=-.92+(1.94*t);}
                            else{const t=ease((progress-.58)/.42);angle=1.02+(idleAngle-1.02)*t;}
                        }
                        node.userData.sword.position.x=facing*.42;
                        node.userData.sword.scale.x=facing*.72;
                        node.userData.sword.material.rotation=facing>0?angle:-angle;
                    }
                }
                for(const [id,node] of this.playerNodes)if(!activeIds.has(id)){disposeObject(node);this.playerNodes.delete(id);}
            }

            iconSprite(text,color='#ffffff',size=256){
                const texture=this.canvasTexture(size,size,(context,width,height)=>{context.clearRect(0,0,width,height);const glow=context.createRadialGradient(width/2,height/2,10,width/2,height/2,width*.47);glow.addColorStop(0,`${color}88`);glow.addColorStop(1,`${color}00`);context.fillStyle=glow;context.fillRect(0,0,width,height);context.font=`${Math.round(width*.55)}px Arial`;context.textAlign='center';context.textBaseline='middle';context.fillText(text,width/2,height*.53);});
                const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false}));sprite.scale.set(1.05,1.05,1);return sprite;
            }

            eventNodeFor(key,create){let node=this.eventNodes.get(key);if(!node){node=create();node.userData.eventKey=key;this.eventNodes.set(key,node);this.eventLayer.add(node);}return node;}

            smoothNodePosition(node,target,now,responsiveness=10){
                // A newly received NPC must begin at its authoritative map
                // position. Lerping from Three.js' default (0, 0, 0) made
                // bosses and pirates glide across the plaza when they first
                // appeared, which looked like network lag.
                if(!node.userData.motionInitialized){
                    node.position.copy(target);
                    node.userData.motionInitialized=true;
                    node.userData.motionAt=Number(now);
                    return;
                }
                const previous=Number(node.userData.motionAt)||Number(now)-16.67,delta=Math.max(.001,Math.min(.05,(Number(now)-previous)/1000));
                node.userData.motionAt=Number(now);
                node.position.lerp(target,1-Math.exp(-Math.max(1,responsiveness)*delta));
            }

            syncEvent(event,now){
                const activeKeys=new Set();
                if(!event){for(const node of this.eventNodes.values())disposeObject(node);this.eventNodes.clear();this.lastEventId='';return;}
                if(this.lastEventId!==event.id){for(const node of this.eventNodes.values())disposeObject(node);this.eventNodes.clear();this.lastEventId=event.id;}
                if(event.type==='snowstorm'){
                    const key='weather:snow';activeKeys.add(key);const snow=this.eventNodeFor(key,()=>{const count=520,positions=new Float32Array(count*3);for(let i=0;i<count;i+=1){positions[i*3]=(seeded(i,120)-.5)*34;positions[i*3+1]=seeded(i,121)*9;positions[i*3+2]=(seeded(i,122)-.5)*20;}const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));const points=new THREE.Points(geometry,new THREE.PointsMaterial({color:0xf4fbff,size:.07,transparent:true,opacity:.88,depthWrite:false}));points.userData.snow=true;return points;});snow.position.y=-((now*.0008)%1.8);
                }
                if(event.type==='dance_party'&&event.danceCenter){
                    const key='dance-floor';activeKeys.add(key);
                    const floor=this.eventNodeFor(key,()=>{
                        const group=new THREE.Group();
                        const stage=new THREE.Sprite(new THREE.SpriteMaterial({map:this.texture('assets/event-vault/dance-party-stage-runtime.png?v=20260815a'),transparent:true,alphaTest:.02,depthWrite:false}));
                        stage.center.set(.5,.34);stage.scale.set(8.2,8.2,1);stage.renderOrder=4;group.add(stage);
                        // This artwork already contains its polished disco ball and both speaker
                        // stacks. Extra sprites/rings duplicated those details and never aligned
                        // with the illustrated cones, so animation is applied to the complete
                        // stage as a single coherent prop instead.
                        const lights=[0xff4f9a,0x56dfff,0xffde55,0x75ff9b].map((color,index)=>{const light=new THREE.PointLight(color,2.4,8);light.position.set(Math.cos(index*Math.PI/2)*2.5,3.1,Math.sin(index*Math.PI/2)*2.5);group.add(light);return light;});
                        group.userData={stage,lights};return group;
                    });
                    floor.position.copy(this.worldPosition(event.danceCenter[0],event.danceCenter[1],.34));
                    const beat=(Math.sin(now*.008)+1)/2;
                    floor.userData.stage.material.opacity=.92+beat*.08;floor.userData.stage.material.color.setHSL((now*.00005)%1,.1,1);floor.userData.stage.scale.setScalar(8.2*(1+beat*.012));
                    floor.userData.lights.forEach((light,index)=>{light.intensity=1.7+Math.sin(now*.004+index*1.7)*.8;light.position.x=Math.cos(now*.0011+index*Math.PI/2)*2.8;light.position.z=Math.sin(now*.0011+index*Math.PI/2)*2.8;});
                }
                if(event.boss&&Number(event.boss.hp)>0){
                    const key=`boss:${event.boss.id}`;activeKeys.add(key);
                    const node=this.eventNodeFor(key,()=>{const group=new THREE.Group();const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:this.texture('bossbreakermonkey.png'),transparent:true,alphaTest:.04,depthWrite:false}));sprite.center.set(.5,.08);sprite.scale.set(2.6,2.6,1);sprite.renderOrder=22;group.add(sprite);const ring=new THREE.Mesh(new THREE.TorusGeometry(1.2,.08,10,56),new THREE.MeshBasicMaterial({color:0xff4a34,transparent:true,opacity:.75,blending:THREE.AdditiveBlending,depthWrite:false}));ring.rotation.x=Math.PI/2;ring.position.y=.1;group.add(ring);const label=new THREE.Sprite(new THREE.SpriteMaterial({transparent:true,depthTest:false,depthWrite:false}));label.position.y=2.9;label.scale.set(3.3,.75,1);label.renderOrder=90;group.add(label);group.userData={sprite,ring,label,hpKey:'',lastX:Number(event.boss.x),lastY:Number(event.boss.y),movingUntil:0,attackStartedAt:0,attackUntil:0};return group;});
                    const bossDeltaX=Number(event.boss.x)-node.userData.lastX,bossTarget=this.worldPosition(event.boss.x,event.boss.y,.3),bossTargetChanged=Math.hypot(bossDeltaX,Number(event.boss.y)-node.userData.lastY)>.5;
                    if(bossTargetChanged)node.userData.movingUntil=now+380;const bossMoved=Boolean(event.boss.moving)||now<node.userData.movingUntil;
                    this.smoothNodePosition(node,bossTarget,now,8.5);node.userData.lastX=Number(event.boss.x);node.userData.lastY=Number(event.boss.y);
                    const attackProgress=node.userData.attackUntil>now?Math.min(1,(now-node.userData.attackStartedAt)/900):0,windup=attackProgress>0&&attackProgress<.32?Math.sin(attackProgress/.32*Math.PI/2):0,strike=attackProgress>=.32&&attackProgress<.7?Math.sin((attackProgress-.32)/.38*Math.PI):0;
                    const bossStep=bossMoved?Math.sin(now*.011+Number(event.boss.x)*.01):Math.sin(now*.0025+Number(event.boss.y)*.01)*.18,bossFacing=event.boss.direction==='left'||(!event.boss.direction&&bossDeltaX<0)?-1:1;
                    node.userData.sprite.position.y=.06+Math.abs(bossStep)*(bossMoved?.22:.05);node.userData.sprite.position.x=(bossMoved?bossStep*.055:0)+strike*bossFacing*.42;node.userData.sprite.material.rotation=bossStep*.055+bossFacing*(-windup*.1+strike*.08);node.userData.sprite.scale.set(bossFacing*(2.6*(1-Math.abs(bossStep)*.04)+strike*.28),2.6*(1+Math.abs(bossStep)*.065)-windup*.2+strike*.25,1);node.userData.ring.rotation.z=now*.001;
                    const hpKey=`${Math.ceil(event.boss.hp)}/${event.boss.maxHp}`;if(node.userData.hpKey!==hpKey){node.userData.hpKey=hpKey;node.userData.label.material.map?.dispose?.();node.userData.label.material.map=this.createTextTexture(`BOSS BREAKER · ${Math.ceil(event.boss.hp).toLocaleString()} HP`,{width:700,height:150,fontSize:43,background:'rgba(49,8,10,.94)',border:'#ff6b4f',color:'#fff0b0'});node.userData.label.material.needsUpdate=true;}
                }
                for(const enemy of (event.enemies||[]).filter((entry)=>Number(entry.hp)>0)){
                    const key=`enemy:${enemy.id}`;activeKeys.add(key);
                    const node=this.eventNodeFor(key,()=>{const group=new THREE.Group();const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:this.texture('Pirate Monkey.png'),transparent:true,alphaTest:.05,depthWrite:false}));sprite.center.set(.5,.08);sprite.scale.set(1.1,1.1,1);sprite.renderOrder=21;group.add(sprite);const label=new THREE.Sprite(new THREE.SpriteMaterial({transparent:true,depthTest:false,depthWrite:false}));label.position.y=1.36;label.scale.set(1.35,.34,1);label.renderOrder=90;group.add(label);group.userData={sprite,label,hpKey:'',lastX:Number(enemy.x),lastY:Number(enemy.y),movingUntil:0,attackStartedAt:0,attackUntil:0};return group;});
                    const enemyDeltaX=Number(enemy.x)-node.userData.lastX,enemyTarget=this.worldPosition(enemy.x,enemy.y,.3),enemyTargetChanged=Math.hypot(enemyDeltaX,Number(enemy.y)-node.userData.lastY)>.5;if(enemyTargetChanged)node.userData.movingUntil=now+340;const enemyMoved=Boolean(enemy.moving)||now<node.userData.movingUntil;this.smoothNodePosition(node,enemyTarget,now,10);node.userData.lastX=Number(enemy.x);node.userData.lastY=Number(enemy.y);
                    const attackProgress=node.userData.attackUntil>now?Math.min(1,(now-node.userData.attackStartedAt)/640):0,windup=attackProgress>0&&attackProgress<.34?Math.sin(attackProgress/.34*Math.PI/2):0,strike=attackProgress>=.34&&attackProgress<.72?Math.sin((attackProgress-.34)/.38*Math.PI):0,facing=enemy.direction==='left'||(!enemy.direction&&enemyDeltaX<0)?-1:1;
                    const enemyStep=enemyMoved?Math.sin(now*.012+Number(enemy.x)*.01):Math.sin(now*.0025+Number(enemy.y)*.01)*.18;
                    node.userData.sprite.position.y=Math.abs(enemyStep)*(enemyMoved?.15:.035);node.userData.sprite.position.x=(enemyMoved?enemyStep*.035:0)+strike*facing*.2;node.userData.sprite.material.rotation=enemyStep*.055+facing*(-windup*.14+strike*.12);node.userData.sprite.scale.set(facing*(1.1*(1-Math.abs(enemyStep)*.04)+strike*.08),1.1*(1+Math.abs(enemyStep)*.065)-windup*.07+strike*.08,1);
                    const hpKey=`${enemy.hp}/${enemy.maxHp}`;if(node.userData.hpKey!==hpKey){node.userData.hpKey=hpKey;node.userData.label.material.map?.dispose?.();node.userData.label.material.map=this.createTextTexture(`${enemy.name} · ${Math.ceil(enemy.hp)} HP`,{width:520,height:132,fontSize:35,background:'rgba(52,8,9,.92)',border:'#ff5d55'});node.userData.label.material.needsUpdate=true;}
                }
                for(const entity of event.entities||[]){const key=`entity:${entity.id}`;activeKeys.add(key);const node=this.eventNodeFor(key,()=>{if(entity.type==='health_potion'||entity.type==='shield_potion'){const group=new THREE.Group(),shield=entity.type==='shield_potion',glass=new THREE.Mesh(new THREE.CylinderGeometry(.16,.2,.42,12),new THREE.MeshPhysicalMaterial({color:shield?0x38bfff:0xff4d68,transparent:true,opacity:.82,roughness:.15,emissive:shield?0x075b9a:0x8a091e,emissiveIntensity:.65}));glass.position.y=.25;group.add(glass);const cap=new THREE.Mesh(new THREE.CylinderGeometry(.1,.1,.12,10),this.material(0xf1fbff,{metalness:.18,roughness:.35}));cap.position.y=.53;group.add(cap);const glow=new THREE.PointLight(shield?0x4bc9ff:0xff5069,2.2,2.4);glow.position.y=.3;group.add(glow);return group;}const icons={banana:'🍌',frozen_treasure:'🧊',pirate_treasure:'🎁'};return this.iconSprite(icons[entity.type]||'✦',entity.type==='frozen_treasure'?'#bcecff':'#ffe067');});const fallProgress=entity.type==='banana'?Math.min(1,Math.max(0,(Date.now()-Number(entity.createdAt||Date.now()))/Math.max(350,Number(entity.fallDurationMs)||850))):1,fallHeight=(1-fallProgress)*2.4;node.position.copy(this.worldPosition(entity.x,entity.y,.42+fallHeight+Math.sin(now*.004+entity.x)*.09));node.rotation.y=now*.0012;}
                for(const launcher of event.launchers||[]){const key=`launcher:${launcher.id}`;activeKeys.add(key);const node=this.eventNodeFor(key,()=>{const group=new THREE.Group();const art=new THREE.Sprite(new THREE.SpriteMaterial({map:this.texture('assets/event-vault/firework-launcher-runtime.png?v=20260815a'),transparent:true,alphaTest:.02,depthWrite:false}));art.center.set(.5,.16);art.scale.set(1.95,1.95,1);art.renderOrder=12;group.add(art);const ring=new THREE.Mesh(new THREE.TorusGeometry(.68,.045,8,48),new THREE.MeshBasicMaterial({color:0x69edff,transparent:true,opacity:.62,blending:THREE.AdditiveBlending,depthWrite:false}));ring.rotation.x=Math.PI/2;ring.position.y=.04;group.add(ring);const glow=new THREE.PointLight(0xff62d8,2.2,3.4);glow.position.y=.75;group.add(glow);group.userData={art,ring,glow};return group;});node.position.copy(this.worldPosition(launcher.x,launcher.y,.3));const pulse=(Math.sin(now*.006+launcher.x*.01)+1)/2;node.userData.ring.scale.setScalar(.92+pulse*.16);node.userData.ring.material.opacity=.36+pulse*.42;node.userData.glow.intensity=1.7+pulse*1.3;node.userData.art.position.y=.03+Math.sin(now*.004+launcher.y)*.035;}
                for(const [key,node] of this.eventNodes)if(!activeKeys.has(key)){disposeObject(node);this.eventNodes.delete(key);}
            }

            createDamageNumber(text,x,y,color='#fff081'){
                const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:this.createTextTexture(text,{width:420,height:150,fontSize:72,background:'rgba(55,10,7,.75)',border:color,color}),transparent:true,depthTest:false,depthWrite:false}));sprite.position.copy(this.worldPosition(x,y,2.2));sprite.scale.set(1.7,.62,1);sprite.renderOrder=120;this.effectLayer.add(sprite);this.transientEffects.push({kind:'rise',object:sprite,createdAt:performance.now(),duration:1450});
            }

            handleEventEffect(effect){
                if(['damage','sword_hit'].includes(effect.kind)&&effect.amount&&Number.isFinite(Number(effect.x)))this.createDamageNumber(`-${Math.floor(effect.amount)}`,effect.x,effect.y,effect.kind==='sword_hit'?'#ffe56b':'#ff8077');
                if(effect.kind==='sword_swing'||effect.kind==='sword_hit'){
                    const attacker=this.playerNodes.get(String(effect.attackerId||''));
                    if(attacker){attacker.userData.attackStartedAt=performance.now();attacker.userData.attackUntil=attacker.userData.attackStartedAt+520;}
                }
                if(effect.kind==='sword_hit'){
                    const flash=new THREE.Mesh(new THREE.OctahedronGeometry(.25,0),new THREE.MeshBasicMaterial({color:0xfff29a,transparent:true,opacity:1,blending:THREE.AdditiveBlending}));flash.position.copy(this.worldPosition(effect.x,effect.y,1));this.effectLayer.add(flash);this.transientEffects.push({kind:'flash',object:flash,createdAt:performance.now(),duration:420});
                }else if(effect.kind==='firework'){
                    const group=new THREE.Group();group.position.copy(this.worldPosition(effect.launcher?.x||1600,effect.launcher?.y||930,.6));const color=new THREE.Color(effect.color||'#ffd85c');
                    const rocket=new THREE.Mesh(new THREE.ConeGeometry(.08,.36,8),new THREE.MeshBasicMaterial({color:0xfff5c2,transparent:true,opacity:1,blending:THREE.AdditiveBlending,depthWrite:false}));rocket.position.y=.18;group.add(rocket);
                    const trail=[];for(let index=0;index<9;index+=1){const ember=new THREE.Mesh(new THREE.SphereGeometry(.025+index*.003,5,4),new THREE.MeshBasicMaterial({color:index%2?color:0xfff2a6,transparent:true,opacity:.8-index*.06,blending:THREE.AdditiveBlending,depthWrite:false}));ember.visible=false;group.add(ember);trail.push(ember);}
                    const sparks=[];for(let index=0;index<52;index+=1){const sparkColor=index%5===0?new THREE.Color(0xfff5c4):index%7===0?new THREE.Color().setHSL(((index*37)%360)/360,.95,.62):color;const spark=new THREE.Mesh(new THREE.SphereGeometry(.028+(index%3)*.008,5,4),new THREE.MeshBasicMaterial({color:sparkColor,transparent:true,opacity:1,blending:THREE.AdditiveBlending,depthWrite:false}));const angle=index/52*TAU,layer=.75+(index%6)*.075;spark.userData.velocity=new THREE.Vector3(Math.cos(angle)*(1.25+layer),.25+((index%9)-4)*.22,Math.sin(angle)*(1.25+layer));spark.visible=false;sparks.push(spark);group.add(spark);}
                    const burstCore=new THREE.Mesh(new THREE.SphereGeometry(.18,10,8),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false}));burstCore.visible=false;group.add(burstCore);
                    const light=new THREE.PointLight(0xfff4c6,0,10);group.add(light);group.userData={rocket,trail,sparks,light,burstCore,burst:false};this.effectLayer.add(group);this.transientEffects.push({kind:'firework',object:group,createdAt:performance.now(),duration:3400,golden:Boolean(effect.golden)});
                    if(effect.golden)this.createDamageNumber('FLAPPY MONKEY',effect.launcher?.x||1600,(effect.launcher?.y||930)-400,'#ffd85c');
                }else if(effect.kind==='boss_attack'){
                    const boss=this.eventNodes.get([...this.eventNodes.keys()].find((key)=>key.startsWith('boss:'))||'');
                    if(boss){
                        boss.userData.attackStartedAt=performance.now();boss.userData.attackUntil=boss.userData.attackStartedAt+900;
                    }
                    const ring=new THREE.Mesh(new THREE.TorusGeometry(.5,.07,10,60),new THREE.MeshBasicMaterial({color:0xff5b3d,transparent:true,opacity:.9,blending:THREE.AdditiveBlending}));ring.rotation.x=Math.PI/2;ring.position.copy(this.worldPosition(effect.x,effect.y,.36));this.effectLayer.add(ring);this.transientEffects.push({kind:'shockwave',object:ring,createdAt:performance.now(),duration:900});
                }else if(effect.kind==='pirate_attack'){
                    const pirate=this.eventNodes.get(`enemy:${effect.attackerId}`);
                    if(pirate){pirate.userData.attackStartedAt=performance.now();pirate.userData.attackUntil=pirate.userData.attackStartedAt+640;}
                    const slash=new THREE.Mesh(new THREE.TorusGeometry(.34,.055,8,24,Math.PI*1.15),new THREE.MeshBasicMaterial({color:0xffe18b,transparent:true,opacity:1,blending:THREE.AdditiveBlending}));slash.rotation.set(Math.PI/2,0,-.7);slash.position.copy(this.worldPosition(effect.targetX,effect.targetY,1));this.effectLayer.add(slash);this.transientEffects.push({kind:'flash',object:slash,createdAt:performance.now(),duration:480});
                }else if(effect.kind==='block'||effect.kind==='parry'){
                    const shield=new THREE.Mesh(new THREE.TorusGeometry(.38,.07,10,40,Math.PI*1.28),new THREE.MeshBasicMaterial({color:effect.kind==='parry'?0xfff07c:0x65e7ff,transparent:true,opacity:1,blending:THREE.AdditiveBlending,depthWrite:false}));shield.rotation.set(0,0,-2.2);shield.position.copy(this.worldPosition(effect.x,effect.y,1.05));shield.renderOrder=110;this.effectLayer.add(shield);this.transientEffects.push({kind:'guard',object:shield,createdAt:performance.now(),duration:effect.kind==='parry'?820:650});
                }else if(effect.kind==='snowman'){
                    const snowman=new THREE.Group(),snowMaterial=new THREE.MeshPhysicalMaterial({color:0xf4fbff,roughness:.5,emissive:0x5cb7d8,emissiveIntensity:.09});
                    for(const [radius,height] of [[.3,.29],[.23,.7],[.17,1.06]]){const part=new THREE.Mesh(new THREE.SphereGeometry(radius,18,14),snowMaterial);part.position.y=height;part.castShadow=true;snowman.add(part);}
                    const coal=this.material(0x101b23,{roughness:.82});for(const x of [-.065,.065]){const eye=new THREE.Mesh(new THREE.SphereGeometry(.019,8,6),coal);eye.position.set(x,1.11,.16);snowman.add(eye);}for(const y of [.76,.68,.6]){const button=new THREE.Mesh(new THREE.SphereGeometry(.022,8,6),coal);button.position.set(0,y,.225);snowman.add(button);}
                    const carrot=new THREE.Mesh(new THREE.ConeGeometry(.035,.22,10),this.material(0xff8b24,{roughness:.65}));carrot.rotation.x=Math.PI/2;carrot.position.set(0,1.055,.27);snowman.add(carrot);
                    const brim=new THREE.Mesh(new THREE.CylinderGeometry(.2,.2,.045,18),this.material(0x18233b,{roughness:.74}));brim.position.y=1.24;snowman.add(brim);const hat=new THREE.Mesh(new THREE.CylinderGeometry(.13,.15,.23,18),this.material(0x26345b,{roughness:.7}));hat.position.y=1.36;snowman.add(hat);
                    const scarf=new THREE.Mesh(new THREE.TorusGeometry(.16,.035,8,22),new THREE.MeshStandardMaterial({color:0xf04e68,roughness:.68}));scarf.rotation.x=Math.PI/2;scarf.position.y=.91;snowman.add(scarf);
                    snowman.position.copy(this.worldPosition(effect.x,effect.y,.25));this.effectLayer.add(snowman);this.transientEffects.push({kind:'static',object:snowman,createdAt:performance.now(),duration:12000});
                }else if(effect.kind==='snowball'){
                    const ball=new THREE.Group();const core=new THREE.Mesh(new THREE.SphereGeometry(.15,16,12),new THREE.MeshPhysicalMaterial({color:0xf7fdff,roughness:.3,emissive:0x79dfff,emissiveIntensity:.55}));ball.add(core);
                    for(let index=1;index<=4;index+=1){const trail=new THREE.Mesh(new THREE.SphereGeometry(.09-index*.01,10,7),new THREE.MeshBasicMaterial({color:0xb9efff,transparent:true,opacity:.32-index*.045,blending:THREE.AdditiveBlending,depthWrite:false}));trail.position.z=index*.13;ball.add(trail);}
                    const impact=[];for(let index=0;index<12;index+=1){const shard=new THREE.Mesh(new THREE.SphereGeometry(.025+(index%3)*.009,7,5),new THREE.MeshBasicMaterial({color:index%4===0?0xffffff:0xbcecff,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false}));shard.visible=false;ball.add(shard);impact.push(shard);}ball.userData.impact=impact;
                    const start=this.worldPosition(effect.x,effect.y,.72),target=this.worldPosition(effect.targetX??effect.x,effect.targetY??effect.y,.55);ball.position.copy(start);
                    const directions={left:[-1,0],right:[1,0],up:[0,-1],down:[0,1]},vector=directions[effect.direction]||[0,1];
                    if(!Number.isFinite(Number(effect.targetX))){target.copy(start).add(new THREE.Vector3(vector[0]*3.3,0,vector[1]*3.3));}
                    this.effectLayer.add(ball);this.transientEffects.push({kind:'snowball',object:ball,createdAt:performance.now(),duration:820,start:start.clone(),target:target.clone()});
                }
            }

            updateEffects(now){
                this.transientEffects=this.transientEffects.filter((effect)=>{
                    const age=now-effect.createdAt;if(age>=effect.duration){disposeObject(effect.object);return false;}const progress=age/effect.duration;
                    if(effect.kind==='rise'){effect.object.position.y+=.007;effect.object.material.opacity=Math.max(0,1-progress);}
                    else if(effect.kind==='flash'){effect.object.scale.setScalar(1+progress*5);effect.object.material.opacity=1-progress;effect.object.rotation.y+=.18;}
                    else if(effect.kind==='shockwave'){effect.object.scale.setScalar(1+progress*10);effect.object.material.opacity=1-progress;}
                    else if(effect.kind==='firework'){
                        const launchDuration=720,burstAge=Math.max(0,age-launchDuration),burstProgress=burstAge/Math.max(1,effect.duration-launchDuration),data=effect.object.userData;
                        if(age<launchDuration){const rise=age/launchDuration;data.rocket.visible=true;data.rocket.position.y=.18+rise*4.7;data.rocket.rotation.z=Math.sin(age*.025)*.08;data.light.position.y=data.rocket.position.y;data.light.intensity=1.2+Math.sin(age*.05)*.7;data.trail.forEach((ember,index)=>{ember.visible=true;ember.position.set(Math.sin(age*.018+index)*.018,data.rocket.position.y-.18-index*.1,Math.cos(age*.016+index)*.018);ember.material.opacity=Math.max(.08,.76-index*.075);});}
                        else{if(!data.burst){data.burst=true;data.rocket.visible=false;data.trail.forEach((ember)=>{ember.visible=false;});data.sparks.forEach((spark)=>{spark.visible=true;spark.position.set(0,4.9,0);});data.burstCore.visible=true;data.burstCore.position.y=4.9;}data.light.position.y=4.9;data.light.intensity=Math.max(0,9*(1-burstProgress));data.burstCore.scale.setScalar(1+burstProgress*6);data.burstCore.material.opacity=Math.max(0,1-burstProgress*1.35);data.sparks.forEach((spark)=>{spark.position.addScaledVector(spark.userData.velocity,.016);spark.userData.velocity.y-=.012;spark.material.opacity=Math.max(0,1-burstProgress*.9);});}
                    }
                    else if(effect.kind==='guard'){effect.object.scale.setScalar(1+progress*.65);effect.object.material.opacity=1-progress;effect.object.rotation.z+=.025;}
                    else if(effect.kind==='snowball'){
                        const eased=progress*progress*(3-2*progress);effect.object.position.lerpVectors(effect.start,effect.target,eased);effect.object.position.y+=Math.sin(progress*Math.PI)*1.15;effect.object.rotation.x+=.2;effect.object.rotation.z+=.14;
                        const impactProgress=Math.max(0,(progress-.82)/.18);effect.object.scale.setScalar(impactProgress?Math.max(.12,1-impactProgress*.88):1);
                        for(let index=0;index<(effect.object.userData.impact||[]).length;index+=1){const shard=effect.object.userData.impact[index];shard.visible=impactProgress>0;const angle=index/12*TAU,radius=.16+impactProgress*(.55+(index%3)*.12);shard.position.set(Math.cos(angle)*radius,.08+Math.sin(angle*2)*.08+impactProgress*(index%2?.18:.05),Math.sin(angle)*radius);shard.material.opacity=Math.max(0,1-impactProgress);}
                    }
                    else if(effect.kind==='static'&&progress>.82){const fade=Math.max(0,1-(progress-.82)/.18);effect.object.traverse?.((child)=>{if(child.material&&'opacity' in child.material){child.material.transparent=true;child.material.opacity=fade;}});effect.object.scale.setScalar(.96+fade*.04);}
                    return true;
                });
            }

            resize(){
                const width=Math.max(1,Math.round(this.root?.clientWidth||innerWidth));const height=Math.max(1,Math.round(this.root?.clientHeight||innerHeight));if(width===this.lastWidth&&height===this.lastHeight)return;this.lastWidth=width;this.lastHeight=height;this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.renderer.setSize(width,height,false);
            }

            monitorPerformance(now){
                if(this.lastRenderAt){
                    const delta=now-this.lastRenderAt;
                    if(delta>0&&delta<500)this.performanceSamples.push(delta);
                }
                this.lastRenderAt=now;
                if(this.performanceSamples.length<45)return;
                const average=this.performanceSamples.reduce((sum,value)=>sum+value,0)/this.performanceSamples.length;
                this.lastAverageFrameMs=average;
                this.performanceSamples.length=0;
                // If this device still cannot hold a smooth frame cadence,
                // reduce only costly GPU features. Geometry and decorations
                // remain intact, so the coast does not turn into a basic map.
                // Outdoor Banana Coast is dramatically more expensive than an
                // interior because it contains the complete island, water,
                // foliage, players and event layers. Waiting until the average
                // frame exceeded 24ms meant the adaptive path only activated
                // after the world had already fallen below roughly 42 FPS.
                // Adapt as soon as it cannot sustain a smooth 60 FPS instead.
                // This keeps every mesh and decoration, but removes live shadow
                // maps and lowers only the internal WebGL render resolution.
                if(!this.qualityReduced&&average>18.5){
                    this.qualityReduced=true;
                    this.qualityStage=1;
                    this.pixelRatio=Math.min(this.pixelRatio,.88);
                    this.renderer.setPixelRatio(this.pixelRatio);
                    this.renderer.shadowMap.enabled=false;
                    this.sunLight.castShadow=false;
                    this.lastWidth=0;this.lastHeight=0;
                    document.documentElement.dataset.monkeyWorldQuality='performance';
                }else if(this.qualityStage===1&&average>19.5){
                    // A single reduction was not enough on a full-HD outdoor
                    // viewport: affected devices settled near 40-55 FPS. Keep
                    // all buildings, foliage, water, effects and decorations,
                    // but lower only the internal WebGL resolution once more.
                    this.qualityStage=2;
                    this.pixelRatio=Math.min(this.pixelRatio,.82);
                    this.renderer.setPixelRatio(this.pixelRatio);
                    this.lastWidth=0;this.lastHeight=0;
                    document.documentElement.dataset.monkeyWorldQuality='performance-2';
                }else if(this.qualityStage===2&&average>21){
                    // Some integrated GPUs still remained around 40-50 FPS at
                    // stage two. Preserve the complete 3D coast and all event
                    // objects, but give those devices one final resolution-only
                    // step instead of leaving the adaptive system half-finished.
                    this.qualityStage=3;
                    this.pixelRatio=Math.min(this.pixelRatio,.76);
                    this.renderer.setPixelRatio(this.pixelRatio);
                    this.lastWidth=0;this.lastHeight=0;
                    document.documentElement.dataset.monkeyWorldQuality='performance-3';
                }
            }

            updateDayCycle(phase){
                const name=String(phase?.name||'DAY');const night=name==='NIGHT',sunset=name==='SUNSET',dawn=name==='DAWN';
                if(this.lastLightPhase!==name){
                    this.lastLightPhase=name;
                    const visibleLightCount=night?4:(sunset||dawn)?2:0;
                    this.nightLights.forEach((light,index)=>{light.visible=index<visibleLightCount;});
                }
                this.waterUniforms.uNight.value+=(Number(night)-this.waterUniforms.uNight.value)*.04;this.waterUniforms.uSunset.value+=(Number(sunset||dawn)-this.waterUniforms.uSunset.value)*.04;
                this.skyUniforms.uNight.value+=(Number(night)-this.skyUniforms.uNight.value)*.035;
                this.skyUniforms.uSunset.value+=(Number(sunset||dawn)-this.skyUniforms.uSunset.value)*.035;
                this.sunDisc.visible=!night;this.sunDisc.material.opacity=THREE.MathUtils.lerp(this.sunDisc.material.opacity,sunset?.62:.92,.03);
                this.backgroundTarget.setHex(night?0x071430:sunset?0x8c7398:dawn?0x9ec8dc:0x83d9ef);this.scene.background.lerp(this.backgroundTarget,.025);
                this.fogTarget.setHex(night?0x0a1734:sunset?0x9b8196:dawn?0xa7c7d1:0x8fd6de);this.scene.fog.color.lerp(this.fogTarget,.025);
                this.hemiLight.intensity=THREE.MathUtils.lerp(this.hemiLight.intensity,night ? .65 : 2.1,.025);
                this.sunLight.intensity=THREE.MathUtils.lerp(this.sunLight.intensity,night ? .35 : sunset ? 2.1 : 3.4,.025);
                this.sunColorTarget.setHex(night?0x7386c8:sunset?0xff916d:0xfff1bd);this.sunLight.color.lerp(this.sunColorTarget,.025);
            }

            render(data = {}) {
                if(!this.ready)return false;
                this.resize();
                const now=Number(data.now)||performance.now();const elapsed=now*.001;
                this.monitorPerformance(now);
                this.refreshAnimatedTextures(now);
                // Interiors hide every outdoor layer. Render the room before
                // touching ocean, foliage, event, or remote-player animation
                // so entering a shop does not keep updating the whole island
                // behind the walls.
                if(data.interior){this.updateDayCycle(data.phase);this.renderInterior(data.interior,now);return true;}
                this.waterUniforms.uTime.value=elapsed;
                this.fountainWater.material.opacity=.78+Math.sin(elapsed*2.1)*.06;this.fountainWater.rotation.z=elapsed*.055;
                this.fountainJets.forEach((jet,index)=>{jet.material.opacity=.62+Math.sin(elapsed*3+index)*.16;jet.scale.y=.96+Math.sin(elapsed*3.2+index*.7)*.045;});
                this.fountainRipples?.forEach((ripple)=>{const pulse=(Math.sin(elapsed*1.9+ripple.userData.phase)+1)/2;ripple.scale.setScalar(.9+pulse*.16);ripple.material.opacity=.12+(1-pulse)*.34;ripple.rotation.z=elapsed*.08+ripple.userData.phase;});
                this.waterfallSheets?.forEach((sheet,index)=>{const pulse=Math.sin(elapsed*4.2+sheet.userData.phase);sheet.material.opacity=.64+pulse*.17;sheet.scale.y=.96+(pulse+1)*.045;sheet.position.y=(sheet.userData.baseY||1.42)+Math.sin(elapsed*3.1+index)*.035;if(sheet.material.map)sheet.material.map.offset.y=(-elapsed*.52+sheet.userData.phase*.08)%1;});
                this.waterfallRipples?.forEach((ripple,index)=>{const pulse=(Math.sin(elapsed*2.25+ripple.userData.phase)+1)/2;ripple.scale.setScalar(.82+pulse*.4);ripple.material.opacity=.08+(1-pulse)*.36;ripple.rotation.z=elapsed*.08+index*.7;});
                this.waterfallMist?.forEach((mist,index)=>{const pulse=(Math.sin(elapsed*1.8+mist.userData.phase)+1)/2;mist.material.opacity=.1+pulse*.22;mist.position.y=.52+pulse*.34;mist.position.x=mist.userData.baseX+Math.sin(elapsed*.7+index)*.08;mist.position.z=mist.userData.baseZ+Math.cos(elapsed*.55+index)*.045;mist.scale.setScalar(.18+pulse*.16);});
                this.districtAnimated?.forEach((object,index)=>{const pulse=(Math.sin(elapsed*(1.3+(index%4)*.18)+(object.userData.phase||index*.7))+1)/2;if(object.userData.kind==='butterfly'){const angle=elapsed*object.userData.speed+object.userData.phase;object.position.x=object.userData.origin.x+Math.cos(angle)*object.userData.radius;object.position.z=object.userData.origin.z+Math.sin(angle*.83)*object.userData.radius;object.position.y=object.userData.origin.y+Math.sin(angle*2.1)*.16;object.rotation.y=-angle+.4;(object.userData.wings||[]).forEach((wing,wingIndex)=>{wing.rotation.y=(wingIndex?1:-1)*(.24+Math.abs(Math.sin(elapsed*9+object.userData.phase))*1.08);});}else if(object.userData.kind==='orbit'){const angle=elapsed*object.userData.speed+object.userData.phase;object.children[0].position.set(Math.cos(angle)*object.userData.radius,Math.sin(angle*1.6)*.18,Math.sin(angle)*object.userData.radius);}if(object.userData.spin)object.rotation.y+=object.userData.spin;if(object.userData.sway)object.rotation.z=Math.sin(elapsed*(1.15+(index%3)*.12)+(object.userData.phase||0))*object.userData.sway;if(object.userData.bob)object.position.y=(object.userData.baseY||0)+Math.sin(elapsed*1.75+(object.userData.phase||0))*object.userData.bob;if(object.userData.pulseScale)object.scale.setScalar(1+(pulse-.5)*2*object.userData.pulseScale);object.traverse?.((child)=>{if(child.material?.emissive&&Number(child.material.emissiveIntensity)>0)child.material.emissiveIntensity=THREE.MathUtils.lerp(child.material.emissiveIntensity,.45+pulse*.9,.08);if(child.isPointLight)child.intensity=.7+pulse*1.8;});});
                this.dynamicEnvironment.children.forEach((object)=>{if(object.userData.doorGlow){object.material.opacity=.24+Math.sin(elapsed*2.6+object.userData.phase)*.14;object.scale.setScalar(1+Math.sin(elapsed*2.6+object.userData.phase)*.12);}});
                this.fireflies.rotation.y=elapsed*.012;this.fireflies.material.opacity=.38+Math.sin(elapsed*.9)*.18;
                this.clouds.children.forEach((cloud)=>{cloud.position.x+=cloud.userData.speed*.006;if(cloud.position.x>20)cloud.position.x=-20;});
                if(this.boat){this.boat.position.y=(this.boat.userData.baseY??-.42)+Math.sin(elapsed*1.4)*.08;this.boat.rotation.z=Math.sin(elapsed*1.2)*.025;}
                this.syncPlayers(data.players||[],data.event||null,now,String(data.localProfileId||''));
                if(this.interiorId)this.exitInterior();
                this.syncEvent(data.event||null,now);
                this.updateEffects(now);
                this.updateDayCycle(data.phase);
                this.target.copy(this.worldPosition(data.localX||1600,data.localY||930,.45));
                // A closer camera matches the classic Monkey World scale,
                // keeps monkey art and nameplates crisp, and makes the larger
                // island feel like a place to explore instead of a map viewed
                // from far overhead.
                const cameraDistance=innerWidth<700?7.05:6.85;const cameraHeight=innerWidth<700?7.55:7.7;this.desiredCamera.set(this.target.x,this.target.y+cameraHeight,this.target.z+cameraDistance);
                this.camera.position.lerp(this.desiredCamera,.085);this.cameraTarget.lerp(this.target,.12);this.camera.lookAt(this.cameraTarget.x,this.cameraTarget.y+.28,this.cameraTarget.z-.45);
                this.updateBuildingOcclusion(data.localX,data.localY);
                this.sunLight.target.position.copy(this.target);this.sunLight.position.set(this.target.x-11,22,this.target.z+9);
                this.renderer.render(this.scene,this.camera);
                if(now-this.lastStatsAt>=1000){
                    this.lastStatsAt=now;
                    const stats=window.__flappyRenderStats||(window.__flappyRenderStats={});
                    const firstAnimatedState=this.animatedTextureStates.values().next().value;
                    stats.world3D={
                        calls:Number(this.renderer.info?.render?.calls)||0,
                        triangles:Number(this.renderer.info?.render?.triangles)||0,
                        points:Number(this.renderer.info?.render?.points)||0,
                        pixelRatio:this.pixelRatio,
                        qualityStage:this.qualityStage,
                        averageFrameMs:Number(this.lastAverageFrameMs.toFixed(2)),
                        animatedTextures:this.animatedTextures.size,
                        animatedTextureVersion:[...this.animatedTextures].reduce((total,texture)=>total+(Number(texture?.version)||0),0),
                        animatedFrameSerial:this.animatedFrameSerial,
                        animatedFrameSample:firstAnimatedState?.pixelSample||null
                    };
                    document.documentElement.dataset.monkeyWorldStats=JSON.stringify(stats.world3D);
                }
                return true;
            }

            destroy(){global.removeEventListener('flappy-monkey-world-event-effect',this.onEventEffect);for(const state of this.animatedTextureStates.values())state.decoder?.close?.();for(const texture of this.textureCache.values())texture?.dispose?.();this.textureCache.clear();this.animatedTextures.clear();this.animatedTextureImages.clear();this.animatedTextureStates.clear();this.animatedImageHost?.remove();this.animatedImageHost=null;this.renderer?.dispose?.();this.canvas?.remove();this.ready=false;}
        }

        global.FlappyMonkeyWorld3D = BananaCoast3D;
        document.documentElement.dataset.monkeyWorld3d = 'runtime-ready';
        return BananaCoast3D;
    }).catch((error) => {
        console.warn('Could not load the bundled Monkey World 3D runtime.', error);
        document.documentElement.dataset.monkeyWorld3d = `load-error:${String(error?.message || error).slice(0,120)}`;
        return null;
    });
})(window);
