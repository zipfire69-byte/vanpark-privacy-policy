(() => {
  'use strict';

  const T = THREE;
  const $ = (id) => document.getElementById(id);
  const screens = ['homeScreen','garageScreen','howScreen','completeScreen','pauseScreen'];
  const keys = { forward:false, back:false, left:false, right:false };

  const LW = 30, LH = 21, GW = 96, GH = 68;
  const SAVE_KEY = 'sm3d';
  const obstacles = [
    {x:-9.1,z:-4.0,r:1.85},
    {x:8.0,z:3.0,r:2.18},
    {x:10.4,z:-6.8,r:2.35},
    {x:-11.0,z:6.2,r:.72},
    {x:-10.0,z:7.1,r:.55},
    {x:11.1,z:7.3,r:.62}
  ];

  let save;
  try { save = {...{balance:0,engine:0,deck:0,handling:0}, ...JSON.parse(localStorage.getItem(SAVE_KEY)||'{}')}; }
  catch { save = {balance:0,engine:0,deck:0,handling:0}; }

  let scene, camera, renderer, clock, sun;
  let mower, mowerBody, frontLeftPivot, frontRightPivot, wheelMeshes=[];
  let lawnTexture, lawnCtx, lawnState, lawnCanvas, totalCuttable=0, cutCount=0;
  let grassMesh, bladeMeta=[], cellBlades=[];
  let particles=[], particleCursor=0;
  let running=false, paused=false, speed=0, heading=Math.PI, steer=0, bonus=0;
  let straightTime=0, combo=0, lastStripeAxis=0;
  let speedHud, jobBanner, comboHud;
  let audioCtx, engineOsc, engineGain, engineOsc2, engineGain2;
  let lastCutDraw=0;

  const tmp = new T.Object3D();
  const tmpV = new T.Vector3();
  const camTarget = new T.Vector3();

  function show(id){ screens.forEach(s => $(s).classList.toggle('hidden', s !== id)); }
  function hideScreens(){ screens.forEach(s => $(s).classList.add('hidden')); }
  function persist(){ localStorage.setItem(SAVE_KEY, JSON.stringify(save)); refreshMoney(); }
  function refreshMoney(){
    $('balanceText').textContent = `£${save.balance}`;
    $('garageBalance').textContent = `£${save.balance}`;
    document.querySelectorAll('.upgrade').forEach(btn => {
      const key = btn.dataset.upgrade;
      const base = +btn.dataset.cost;
      const lvl = save[key] || 0;
      btn.classList.toggle('maxed', lvl >= 3);
      btn.querySelector('b').textContent = lvl >= 3 ? 'MAXED' : `£${base*(lvl+1)}`;
    });
  }

  function mat(color, rough=.62, metal=.02, opts={}){
    return new T.MeshStandardMaterial({color, roughness:rough, metalness:metal, ...opts});
  }

  function addMesh(parent, geo, material, pos=[0,0,0], rot=[0,0,0], scale=[1,1,1], cast=true, receive=true){
    const m = new T.Mesh(geo, material);
    m.position.set(...pos); m.rotation.set(...rot); m.scale.set(...scale);
    m.castShadow = cast; m.receiveShadow = receive;
    parent.add(m); return m;
  }

  function noiseTexture(baseA, baseB, size=256, speckle=24){
    const c=document.createElement('canvas'); c.width=c.height=size;
    const x=c.getContext('2d');
    const g=x.createLinearGradient(0,0,size,size); g.addColorStop(0,baseA); g.addColorStop(1,baseB);
    x.fillStyle=g; x.fillRect(0,0,size,size);
    for(let i=0;i<size*speckle;i++){
      const a=Math.random()*.12;
      x.fillStyle=`rgba(${Math.random()>.5?'255,255,255':'0,0,0'},${a})`;
      x.fillRect(Math.random()*size,Math.random()*size,Math.random()*2+1,Math.random()*2+1);
    }
    const tex=new T.CanvasTexture(c); tex.wrapS=tex.wrapT=T.RepeatWrapping; tex.colorSpace=T.SRGBColorSpace;
    return tex;
  }

  function init(){
    scene = new T.Scene();
    scene.fog = new T.FogExp2(0xb7d2d8, .0115);

    camera = new T.PerspectiveCamera(52, innerWidth/innerHeight, .08, 180);
    camera.position.set(0,3.7,7.2);

    renderer = new T.WebGLRenderer({antialias:true, powerPreference:'high-performance'});
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.55));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    $('game').appendChild(renderer.domElement);

    clock = new T.Clock();
    buildSky();
    buildLighting();
    buildWorld();
    buildMower();
    buildParticles();
    buildGameUI();
    bind();
    refreshMoney();
    animate();
  }

  function buildSky(){
    scene.background = new T.Color(0xa8d2e1);
    const geo = new T.SphereGeometry(110, 32, 18);
    const matSky = new T.ShaderMaterial({
      side:T.BackSide,
      uniforms:{top:{value:new T.Color(0x4e9fd0)}, bottom:{value:new T.Color(0xe7f2ef)}, offset:{value:16}, exponent:{value:.75}},
      vertexShader:'varying vec3 vWorldPosition; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vWorldPosition=w.xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader:'uniform vec3 top; uniform vec3 bottom; uniform float offset; uniform float exponent; varying vec3 vWorldPosition; void main(){ float h=normalize(vWorldPosition+vec3(0.0,offset,0.0)).y; gl_FragColor=vec4(mix(bottom,top,max(pow(max(h,0.0),exponent),0.0)),1.0); }'
    });
    scene.add(new T.Mesh(geo, matSky));

    const cloudMat = new T.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.42,depthWrite:false});
    [[-25,17,-28,1.2],[18,20,-35,1.6],[34,16,5,1.1],[-38,19,8,1.45]].forEach(([x,y,z,s])=>{
      const g=new T.Group(); g.position.set(x,y,z); scene.add(g);
      for(let i=0;i<5;i++) addMesh(g,new T.SphereGeometry((1.2+Math.random())*s,12,8),cloudMat,[i*s*1.35,(Math.random()-.5)*.7,(Math.random()-.5)*.8],[0,0,0],[1.8,.7,1],false,false);
    });
  }

  function buildLighting(){
    scene.add(new T.HemisphereLight(0xe6f4ff, 0x465b36, 1.9));
    const ambient = new T.AmbientLight(0xffffff,.38); scene.add(ambient);
    sun = new T.DirectionalLight(0xffedc6, 3.3);
    sun.position.set(-16,24,10); sun.castShadow=true;
    sun.shadow.mapSize.set(1536,1536);
    sun.shadow.camera.left=-22; sun.shadow.camera.right=22; sun.shadow.camera.top=22; sun.shadow.camera.bottom=-22;
    sun.shadow.camera.near=2; sun.shadow.camera.far=60; sun.shadow.bias=-.0005;
    scene.add(sun);
  }

  function buildWorld(){
    const groundTex = noiseTexture('#50653a','#334b30',192,12); groundTex.repeat.set(11,8);
    const groundMat = new T.MeshStandardMaterial({map:groundTex,roughness:1});
    addMesh(scene,new T.CircleGeometry(74,64),groundMat,[0,-.17,0],[-Math.PI/2,0,0],[1,1,1],false,true);

    const hillMat=mat(0x506d49,1,0);
    [[-42,-22,21,6],[35,-29,25,7],[-28,27,26,5],[35,30,22,4]].forEach(([x,z,r,h])=>{
      addMesh(scene,new T.SphereGeometry(r,24,12),hillMat,[x,-r+h,z],[0,0,0],[1,.42,1],false,true);
    });

    buildLawn();
    buildHouse();
    buildFencesAndHedges();
    buildTree();
    buildFlowerBed();
    buildShed();
    buildPatioDetails();
    buildSmallProps();
  }

  function buildLawn(){
    lawnCanvas=document.createElement('canvas'); lawnCanvas.width=768; lawnCanvas.height=544;
    lawnCtx=lawnCanvas.getContext('2d',{alpha:false});
    lawnTexture=new T.CanvasTexture(lawnCanvas); lawnTexture.colorSpace=T.SRGBColorSpace; lawnTexture.anisotropy=4;
    lawnState=new Uint8Array(GW*GH);
    cellBlades=Array.from({length:GW*GH},()=>[]);
    countTotal(); drawLawn(true);
    const lawnMat=new T.MeshStandardMaterial({map:lawnTexture,roughness:.93,metalness:0});
    addMesh(scene,new T.PlaneGeometry(LW,LH,1,1),lawnMat,[0,.01,0],[-Math.PI/2,0,0],[1,1,1],false,true);

    const bladeGeo=new T.ConeGeometry(.025,.5,3,1); bladeGeo.translate(0,.25,0);
    const bladeMat=new T.MeshStandardMaterial({color:0x3f8539,roughness:1,side:T.DoubleSide});
    const maxBlades = innerWidth < 700 ? 2400 : 3400;
    grassMesh = new T.InstancedMesh(bladeGeo, bladeMat, maxBlades);
    grassMesh.instanceMatrix.setUsage(T.DynamicDrawUsage); grassMesh.castShadow=false; grassMesh.receiveShadow=true;
    scene.add(grassMesh);
    bladeMeta=[];
    let made=0, attempts=0;
    while(made<maxBlades && attempts<maxBlades*5){
      attempts++;
      const x=(Math.random()-.5)*(LW-.7), z=(Math.random()-.5)*(LH-.7);
      if(blocked(x,z,.03)) continue;
      const gx=T.MathUtils.clamp(Math.floor((x/LW+.5)*GW),0,GW-1), gy=T.MathUtils.clamp(Math.floor((z/LH+.5)*GH),0,GH-1);
      const cell=gy*GW+gx, height=.65+Math.random()*.55, rot=Math.random()*Math.PI;
      bladeMeta.push({x,z,height,rot,cell,cut:false}); cellBlades[cell].push(made);
      tmp.position.set(x,.015,z); tmp.rotation.set((Math.random()-.5)*.12,rot,(Math.random()-.5)*.1); tmp.scale.set(1,height,1); tmp.updateMatrix();
      grassMesh.setMatrixAt(made,tmp.matrix); made++;
    }
    grassMesh.count=made; grassMesh.instanceMatrix.needsUpdate=true;
  }

  function buildHouse(){
    const brickTex=noiseTexture('#bda68f','#9e8069',256,10); brickTex.repeat.set(5,2.4);
    const wallMat=new T.MeshStandardMaterial({map:brickTex,roughness:.95});
    addMesh(scene,new T.BoxGeometry(18,6.4,4.8),wallMat,[0,3.1,16.9],[0,0,0],[1,1,1],true,true);

    const roofMat=mat(0x3d4240,.9,0);
    addMesh(scene,new T.BoxGeometry(19.3,.22,4.4),roofMat,[0,6.75,15.75],[-.45,0,0],[1,1,1],true,true);
    addMesh(scene,new T.BoxGeometry(19.3,.22,4.4),roofMat,[0,6.75,18.05],[.45,0,0],[1,1,1],true,true);

    const frameMat=mat(0xf2f0e9,.45,.02), glassMat=mat(0x6e9fb1,.18,.12,{transparent:true,opacity:.72});
    const addWindow=(x,y,w=3,h=2.2)=>{
      addMesh(scene,new T.BoxGeometry(w+.18,h+.18,.13),frameMat,[x,y,14.44],[0,0,0],[1,1,1],true,true);
      addMesh(scene,new T.BoxGeometry(w,h,.08),glassMat,[x,y,14.35],[0,0,0],[1,1,1],false,false);
      addMesh(scene,new T.BoxGeometry(.08,h,.1),frameMat,[x,y,14.29],[0,0,0],[1,1,1],false,false);
      addMesh(scene,new T.BoxGeometry(w,.08,.1),frameMat,[x,y,14.29],[0,0,0],[1,1,1],false,false);
    };
    addWindow(-5,3.8,3.2,2.25); addWindow(5,3.8,3.2,2.25);
    addMesh(scene,new T.BoxGeometry(2.15,4,.18),mat(0x23362b,.5,.08),[0,2.2,14.34],[0,0,0],[1,1,1],true,true);
    addMesh(scene,new T.SphereGeometry(.07,8,6),mat(0xd3b65b,.25,.7),[.72,2.2,14.2],[0,0,0],[1,1,1],true,true);
    addMesh(scene,new T.CylinderGeometry(.07,.07,18.4,8),mat(0x303534,.65,.2),[0,6.35,14.5],[0,0,Math.PI/2],[1,1,1],true,true);
    addMesh(scene,new T.CylinderGeometry(.07,.07,6.2,8),mat(0x303534,.65,.2),[-8.6,3.15,14.45],[0,0,0],[1,1,1],true,true);
  }

  function buildFencesAndHedges(){
    const wood=mat(0x8a5b36,.94,0), darkWood=mat(0x684029,.96,0);
    const panelGeo=new T.BoxGeometry(1.45,1.55,.11);
    for(let x=-14.3;x<=14.3;x+=1.5){
      addMesh(scene,panelGeo,wood,[x,.77,-10.7],[0,0,0],[1,1,1],true,true);
      addMesh(scene,new T.BoxGeometry(.12,1.85,.13),darkWood,[x-.72,.9,-10.65],[0,0,0],[1,1,1],true,true);
    }
    for(let z=-9.9;z<=9.4;z+=1.5){
      addMesh(scene,panelGeo,wood,[-15.1,.77,z],[0,Math.PI/2,0],[1,1,1],true,true);
      addMesh(scene,panelGeo,wood,[15.1,.77,z],[0,Math.PI/2,0],[1,1,1],true,true);
    }
    const hedgeMat=mat(0x285c2e,1,0), hedgeMat2=mat(0x367239,1,0);
    const hedgeGeo=new T.IcosahedronGeometry(.82,1);
    for(let x=-14.4;x<=14.4;x+=1.05){
      addMesh(scene,hedgeGeo,(Math.round(x*10)%2?hedgeMat:hedgeMat2),[x,1.5,-10.15],[0,Math.random()*2,0],[1.15,1.12,.82],true,true);
    }
  }

  function buildTree(){
    const trunk=mat(0x5e412b,1,0), leaf1=mat(0x2f6d32,1,0), leaf2=mat(0x3d7e39,1,0);
    addMesh(scene,new T.CylinderGeometry(.32,.52,4.2,12),trunk,[-9.1,2.1,-4],[0,0,0],[1,1,1],true,true);
    [[-9.2,5,-4,2.1],[-8.1,4.8,-4.1,1.45],[-10.1,4.7,-3.8,1.6],[-9.2,5.9,-4,1.45]].forEach(([x,y,z,r],i)=>{
      addMesh(scene,new T.IcosahedronGeometry(r,2),i%2?leaf2:leaf1,[x,y,z],[0,Math.random(),0],[1,.86,1],true,true);
    });
  }

  function buildFlowerBed(){
    addMesh(scene,new T.CylinderGeometry(2.18,2.18,.25,40),mat(0x77756d,1,0),[8,.1,3]);
    addMesh(scene,new T.CylinderGeometry(1.87,1.87,.3,40),mat(0x4e3023,1,0),[8,.17,3]);
    const colors=[0xe95f72,0xf4c84a,0xb86ee7,0xf2f0e9,0xf08b3a];
    for(let i=0;i<26;i++){
      const a=Math.random()*Math.PI*2,r=Math.sqrt(Math.random())*1.48,x=8+Math.cos(a)*r,z=3+Math.sin(a)*r;
      addMesh(scene,new T.CylinderGeometry(.018,.025,.37,5),mat(0x35743c,1),[x,.47,z],[0,0,0],[1,1,1],false,false);
      addMesh(scene,new T.SphereGeometry(.095,7,5),mat(colors[i%colors.length],.8),[x,.69,z],[0,0,0],[1,1,1],false,false);
    }
  }

  function buildShed(){
    const woodTex=noiseTexture('#7b5035','#5b3928',128,8); woodTex.repeat.set(3,2);
    const woodMat=new T.MeshStandardMaterial({map:woodTex,roughness:1});
    addMesh(scene,new T.BoxGeometry(4.1,3.25,3.25),woodMat,[10.4,1.62,-6.8],[0,0,0],[1,1,1],true,true);
    addMesh(scene,new T.ConeGeometry(3.15,1.5,4),mat(0x353938,.9),[10.4,3.95,-6.8],[0,Math.PI/4,0],[1,1,1],true,true);
    addMesh(scene,new T.BoxGeometry(1.3,2.45,.08),mat(0x5a3926,.9),[10.4,1.35,-8.45],[0,0,0],[1,1,1],true,true);
    addMesh(scene,new T.BoxGeometry(.75,.6,.09),mat(0x668da0,.25,.1,{transparent:true,opacity:.7}),[11.55,2.3,-8.46],[0,0,0],[1,1,1],false,false);
  }

  function buildPatioDetails(){
    const stoneTex=noiseTexture('#c8c1ad','#aaa18d',192,12); stoneTex.repeat.set(4,2);
    const patioMat=new T.MeshStandardMaterial({map:stoneTex,roughness:1});
    addMesh(scene,new T.BoxGeometry(11,.18,4.2),patioMat,[0,.03,12.15],[0,0,0],[1,1,1],false,true);
    const joint=mat(0x7d776d,1);
    for(let x=-5;x<=5;x+=1.1) addMesh(scene,new T.BoxGeometry(.025,.02,4.05),joint,[x,.13,12.15],[0,0,0],[1,1,1],false,false);
    for(let z=10.3;z<=14;z+=1.03) addMesh(scene,new T.BoxGeometry(10.8,.02,.025),joint,[0,.13,z],[0,0,0],[1,1,1],false,false);
    const metal=mat(0x252a27,.45,.45);
    addMesh(scene,new T.CylinderGeometry(.05,.05,1.05,8),metal,[-3.1,.65,12.2]);
    addMesh(scene,new T.CylinderGeometry(.95,.95,.08,28),mat(0x5e4530,.65),[-3.1,1.18,12.2]);
    [[-4.3,12.2],[-1.9,12.2]].forEach(([x,z])=>{
      addMesh(scene,new T.BoxGeometry(.85,.12,.78),metal,[x,.55,z]);
      addMesh(scene,new T.BoxGeometry(.85,1,.12),metal,[x,.98,z+.38],[0,0,0],[1,1,1]);
      [[-.32,-.28],[.32,-.28],[-.32,.28],[.32,.28]].forEach(([dx,dz])=>addMesh(scene,new T.CylinderGeometry(.025,.025,.55,6),metal,[x+dx,.28,z+dz]));
    });
  }

  function buildSmallProps(){
    const bin=(x,color)=>{
      const g=new T.Group();g.position.set(x,.05,13.6);scene.add(g);
      addMesh(g,new T.BoxGeometry(.65,1.05,.72),mat(color,.75),[0,.55,0],[0,0,0],[1,1,1],true,true);
      addMesh(g,new T.BoxGeometry(.73,.08,.78),mat(0x202622,.7),[0,1.12,0],[0,0,0],[1,1,1],true,true);
      addMesh(g,new T.CylinderGeometry(.1,.1,.7,10),mat(0x161a17,.9),[0,.17,.36],[0,0,Math.PI/2],[1,1,1],true,true);
    };
    bin(6.8,0x2e4933); bin(7.65,0x354f65);
    const rock=mat(0x777c79,1);
    [[-11,6.2,.75],[-10,7.1,.55],[11.1,7.3,.62]].forEach(([x,z,s])=>{
      addMesh(scene,new T.DodecahedronGeometry(s,1),rock,[x,s*.45,z],[0,Math.random()*3,0],[1,.65,1],true,true);
    });
  }

  function buildMower(){
    mower=new T.Group(); scene.add(mower);
    mowerBody=new T.Group(); mower.add(mowerBody);

    const orange=mat(0xdb6418,.3,.15), orangeDark=mat(0xa8420d,.38,.18), black=mat(0x151817,.72,.05), rubber=mat(0x101211,.96,0), metal=mat(0x4b5050,.28,.55), silver=mat(0xb2b7b4,.25,.65);

    addMesh(mowerBody,new T.CylinderGeometry(.98,1.05,.22,36),orangeDark,[0,.28,.03],[0,0,0],[1.12,1,1],true,true);
    addMesh(mowerBody,new T.CylinderGeometry(.83,.88,.08,36),black,[0,.39,.03],[0,0,0],[1.12,1,1],true,true);
    addMesh(mowerBody,new T.BoxGeometry(.68,.13,.48),black,[1.22,.29,.08],[0,0,-.12],[1,1,1],true,true);
    addMesh(mowerBody,new T.BoxGeometry(1.25,.3,1.55),metal,[0,.54,.2],[0,0,0],[1,1,1],true,true);
    addMesh(mowerBody,new T.BoxGeometry(1.38,.5,.72),orange,[0,.82,.62],[0,0,0],[1,1,1],true,true);

    const sh=new T.Shape(); sh.moveTo(-.61,0);sh.lineTo(.61,0);sh.lineTo(.61,.35);sh.lineTo(.43,.58);sh.lineTo(-.4,.58);sh.lineTo(-.61,.4);sh.closePath();
    const hoodGeo=new T.ExtrudeGeometry(sh,{depth:1.02,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.055,bevelThickness:.055}); hoodGeo.center();
    addMesh(mowerBody,hoodGeo,orange,[0,.84,-.67],[0,0,0],[1,1,1],true,true);
    addMesh(mowerBody,new T.BoxGeometry(.76,.035,1.01),black,[0,1.145,-.67],[0,0,0],[1,1,1],true,true);
    for(let i=-2;i<=2;i++) addMesh(mowerBody,new T.BoxGeometry(.055,.025,.42),black,[i*.13,1.18,-.73],[0,0,0],[1,1,1],false,false);
    const lightMat=mat(0xffe8a5,.2,.2,{emissive:0xffd87a,emissiveIntensity:.8});
    addMesh(mowerBody,new T.BoxGeometry(.25,.16,.06),lightMat,[-.36,.87,-1.22],[0,0,0],[1,1,1],false,false);
    addMesh(mowerBody,new T.BoxGeometry(.25,.16,.06),lightMat,[.36,.87,-1.22],[0,0,0],[1,1,1],false,false);
    addMesh(mowerBody,new T.BoxGeometry(.76,.18,.54),black,[0,1.04,.47],[-.08,0,0],[1,1,1],true,true);
    addMesh(mowerBody,new T.BoxGeometry(.74,.72,.16),black,[0,1.38,.72],[-.16,0,0],[1,1,1],true,true);
    addMesh(mowerBody,new T.CylinderGeometry(.035,.045,.75,10),metal,[0,1.18,-.06],[.56,0,0],[1,1,1],true,true);
    addMesh(mowerBody,new T.TorusGeometry(.27,.035,8,24),black,[0,1.48,-.29],[Math.PI/2-.54,0,0],[1,1,1],true,true);
    addMesh(mowerBody,new T.CylinderGeometry(.025,.025,.28,8),metal,[0,1.48,-.29],[Math.PI/2-.54,0,0],[1,1,1],true,true);
    addMesh(mowerBody,new T.CylinderGeometry(.045,.06,.63,10),metal,[.55,1.19,-.45],[0,0,0],[1,1,1],true,true);
    addMesh(mowerBody,new T.CylinderGeometry(.065,.065,.22,10),black,[.55,1.49,-.45],[0,0,0],[1,1,1],true,true);

    wheelMeshes=[];
    const makeWheel=(x,z,r,w,front=false)=>{
      const pivot=new T.Group();pivot.position.set(x,r,z);mowerBody.add(pivot);
      const wg=new T.CylinderGeometry(r,r,w,22);wg.rotateZ(Math.PI/2);
      const wheel=addMesh(pivot,wg,rubber,[0,0,0],[0,0,0],[1,1,1],true,true);
      addMesh(pivot,new T.CylinderGeometry(r*.42,r*.42,w+.025,18),silver,[0,0,0],[0,0,Math.PI/2],[1,1,1],true,true);
      wheelMeshes.push(wheel);
      if(front && x<0) frontLeftPivot=pivot;
      if(front && x>0) frontRightPivot=pivot;
      return pivot;
    };
    makeWheel(-.78,.58,.43,.27,false); makeWheel(.78,.58,.43,.27,false);
    makeWheel(-.74,-.73,.31,.2,true); makeWheel(.74,-.73,.31,.2,true);
    makeWheel(-1.0,-.02,.13,.12,false); makeWheel(1.0,-.02,.13,.12,false);

    mower.position.set(0,0,8.1); mower.rotation.y=heading;
  }

  function buildParticles(){
    const g=new T.PlaneGeometry(.07,.22), m=new T.MeshBasicMaterial({color:0x659a35,side:T.DoubleSide,transparent:true,opacity:.92});
    for(let i=0;i<54;i++){
      const p=new T.Mesh(g,m.clone());p.visible=false;p.userData.life=0;p.userData.vel=new T.Vector3();scene.add(p);particles.push(p);
    }
  }

  function buildGameUI(){
    speedHud=document.createElement('div');speedHud.className='speed-hud hidden';speedHud.innerHTML='<b>0</b><span>MPH</span>';document.body.appendChild(speedHud);
    comboHud=document.createElement('div');comboHud.className='combo-hud hidden';comboHud.innerHTML='<small>STRIPE</small><b>x2</b>';document.body.appendChild(comboHud);
    jobBanner=document.createElement('div');jobBanner.className='job-banner hidden';jobBanner.innerHTML='<small>ROSSENDALE • JOB 01</small><strong>Oak View Garden</strong><span>Cut 90% of the lawn • £85 base pay</span>';document.body.appendChild(jobBanner);
  }

  function countTotal(){
    totalCuttable=0;
    for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){
      const wx=(x+.5)/GW*LW-LW/2, wz=(y+.5)/GH*LH-LH/2;
      if(!blocked(wx,wz,.03)) totalCuttable++;
    }
  }

  function blocked(x,z,pad=0){
    if(x<-LW/2+.6||x>LW/2-.6||z<-LH/2+.55||z>LH/2-.55)return true;
    return obstacles.some(o=>(x-o.x)**2+(z-o.z)**2<(o.r+pad)**2);
  }

  function drawLawn(force=false){
    const W=lawnCanvas.width,H=lawnCanvas.height,cw=W/GW,ch=H/GH;
    lawnCtx.fillStyle='#3c7838';lawnCtx.fillRect(0,0,W,H);
    for(let y=0;y<GH;y++){
      for(let x=0;x<GW;x++){
        const i=y*GW+x,s=lawnState[i];
        const grain=((x*31+y*17)%13)-6;
        let c;
        if(s===0)c=[57+grain,119+grain,50+grain/2];
        else if(s===1)c=[69+grain,139+grain,58+grain/2];
        else c=[45+grain,105+grain,44+grain/2];
        lawnCtx.fillStyle=`rgb(${c[0]},${c[1]},${c[2]})`;
        lawnCtx.fillRect(x*cw,y*ch,Math.ceil(cw)+1,Math.ceil(ch)+1);
        if((x+y)%4===0){lawnCtx.fillStyle='rgba(255,255,255,.025)';lawnCtx.fillRect(x*cw,y*ch,cw*.18,ch);}
      }
    }
    lawnTexture.needsUpdate=true;
  }

  function setCellCut(cell, axis){
    if(lawnState[cell]) return false;
    lawnState[cell]=axis; cutCount++;
    const ids=cellBlades[cell];
    for(const id of ids){
      const b=bladeMeta[id]; if(b.cut)continue;b.cut=true;
      tmp.position.set(b.x,.012,b.z);tmp.rotation.set(0,b.rot,0);tmp.scale.set(1,.13,1);tmp.updateMatrix();grassMesh.setMatrixAt(id,tmp.matrix);
    }
    return true;
  }

  function cutGrass(dt){
    const width=1.55+save.deck*.22, r=width*.55;
    const gx=Math.floor((mower.position.x/LW+.5)*GW), gy=Math.floor((mower.position.z/LH+.5)*GH);
    const rx=Math.ceil(r/(LW/GW))+1, ry=Math.ceil(r/(LH/GH))+1;
    const axis=Math.abs(Math.cos(heading))>.707?1:2;
    let fresh=0;
    for(let y=Math.max(0,gy-ry);y<=Math.min(GH-1,gy+ry);y++)for(let x=Math.max(0,gx-rx);x<=Math.min(GW-1,gx+rx);x++){
      const wx=(x+.5)/GW*LW-LW/2,wz=(y+.5)/GH*LH-LH/2;
      if((wx-mower.position.x)**2+(wz-mower.position.z)**2<=r*r&&!blocked(wx,wz,.02)) if(setCellCut(y*GW+x,axis))fresh++;
    }
    if(fresh){
      grassMesh.instanceMatrix.needsUpdate=true;
      if(Math.abs(steer)<.19&&Math.abs(speed)>2.05){
        if(lastStripeAxis===axis) straightTime+=dt; else {lastStripeAxis=axis;straightTime=.15;}
        combo=Math.min(8,1+Math.floor(straightTime/1.15));
        if(combo>=2){bonus+=fresh*.045*combo;showCombo(combo);}
      }else{straightTime=Math.max(0,straightTime-dt*1.7);combo=0;}
      if(performance.now()-lastCutDraw>40){drawLawn();lastCutDraw=performance.now();}
      spray(Math.min(9,2+Math.floor(fresh/3)));
      updateHud();
    }
  }

  function spray(n){
    const side=new T.Vector3(Math.cos(heading),0,-Math.sin(heading));
    const back=new T.Vector3(Math.sin(heading),0,Math.cos(heading));
    for(let j=0;j<n;j++){
      const p=particles[particleCursor++%particles.length];p.visible=true;p.userData.life=.45+Math.random()*.45;
      p.position.copy(mower.position).addScaledVector(side,1.02).add(new T.Vector3(0,.35,0));
      p.userData.vel.copy(side).multiplyScalar(1.7+Math.random()*2.5).addScaledVector(back,(Math.random()-.5)*1.6);p.userData.vel.y=.8+Math.random()*1.7;
      p.rotation.set(Math.random()*3,Math.random()*3,Math.random()*3);p.scale.setScalar(.7+Math.random()*.7);
    }
  }

  let comboTimer;
  function showCombo(c){
    comboHud.querySelector('b').textContent=`x${c}`;comboHud.classList.remove('hidden');
    clearTimeout(comboTimer);comboTimer=setTimeout(()=>comboHud.classList.add('hidden'),650);
  }

  function updateHud(){
    const p=Math.min(100,cutCount/Math.max(1,totalCuttable)*100);
    $('progressFill').style.width=`${p}%`; $('progressText').textContent=`${Math.floor(p)}%`;
    if(p>=90&&running) finish();
  }

  function resetGrass(){
    lawnState.fill(0);cutCount=0;bonus=0;straightTime=0;combo=0;lastStripeAxis=0;
    bladeMeta.forEach((b,id)=>{b.cut=false;tmp.position.set(b.x,.015,b.z);tmp.rotation.set(0,b.rot,0);tmp.scale.set(1,b.height,1);tmp.updateMatrix();grassMesh.setMatrixAt(id,tmp.matrix);});
    grassMesh.instanceMatrix.needsUpdate=true;drawLawn(true);updateHud();
  }

  function startJob(){
    hideScreens();$('topbar').classList.remove('hidden');$('touchControls').classList.remove('hidden');speedHud.classList.remove('hidden');
    resetGrass();speed=0;steer=0;heading=Math.PI;mower.position.set(0,0,8.1);mower.rotation.y=heading;
    running=true;paused=false;startEngine();
    jobBanner.classList.remove('hidden');setTimeout(()=>jobBanner.classList.add('hidden'),2600);
  }

  function finish(){
    if(!running)return;running=false;speed=0;stopEngine();drawLawn(true);
    const p=Math.round(cutCount/totalCuttable*100),b=Math.min(95,Math.round(bonus)),t=85+b;
    save.balance+=t;persist();$('resultProgress').textContent=`${p}%`;$('resultBonus').textContent=`£${b}`;$('resultTotal').textContent=`£${t}`;
    $('topbar').classList.add('hidden');$('touchControls').classList.add('hidden');speedHud.classList.add('hidden');comboHud.classList.add('hidden');show('completeScreen');
  }

  function quit(){
    running=false;paused=false;speed=0;stopEngine();$('topbar').classList.add('hidden');$('touchControls').classList.add('hidden');speedHud.classList.add('hidden');comboHud.classList.add('hidden');show('homeScreen');
  }

  function togglePause(){
    if(!running)return;paused=!paused;if(paused){speed=0;stopEngine();show('pauseScreen');}else{hideScreens();startEngine();}
  }

  function startEngine(){
    try{
      if(!audioCtx)audioCtx=new (window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume();if(engineOsc)return;
      engineOsc=audioCtx.createOscillator();engineOsc2=audioCtx.createOscillator();engineGain=audioCtx.createGain();engineGain2=audioCtx.createGain();
      engineOsc.type='sawtooth';engineOsc2.type='square';engineOsc.frequency.value=48;engineOsc2.frequency.value=24;engineGain.gain.value=.014;engineGain2.gain.value=.006;
      engineOsc.connect(engineGain).connect(audioCtx.destination);engineOsc2.connect(engineGain2).connect(audioCtx.destination);engineOsc.start();engineOsc2.start();
    }catch{}
  }
  function stopEngine(){
    [engineOsc,engineOsc2].forEach(o=>{if(o)try{o.stop()}catch{}});engineOsc=engineOsc2=engineGain=engineGain2=null;
  }

  function updateMower(dt){
    const max=5.4+save.engine*.75, reverse=2.45+save.engine*.25, accel=4.8+save.engine*.42, brake=7.5, turn=1.65+save.handling*.18;
    if(keys.forward) speed+=accel*dt;
    else if(keys.back){ if(speed>.25)speed-=brake*dt; else speed-=accel*.72*dt; }
    else speed*=Math.pow(.13,dt);
    speed=T.MathUtils.clamp(speed,-reverse,max);

    const target=(keys.left?1:0)-(keys.right?1:0);
    steer=T.MathUtils.lerp(steer,target,1-Math.pow(.003,dt));if(!keys.left&&!keys.right)steer=T.MathUtils.lerp(steer,0,1-Math.pow(.01,dt));
    const speedNorm=Math.min(1,Math.abs(speed)/max);
    heading+=steer*turn*dt*(.28+speedNorm*.72)*(speed>=0?1:-1);
    mower.rotation.y=heading;

    const nx=mower.position.x-Math.sin(heading)*speed*dt,nz=mower.position.z-Math.cos(heading)*speed*dt;
    if(!blocked(nx,nz,.82)){mower.position.x=nx;mower.position.z=nz;}else speed*=-.1;

    const wheelSpin=speed*dt*2.4;wheelMeshes.forEach(w=>w.rotation.x-=wheelSpin);
    if(frontLeftPivot)frontLeftPivot.rotation.y=steer*.42;if(frontRightPivot)frontRightPivot.rotation.y=steer*.42;
    mowerBody.rotation.z=T.MathUtils.lerp(mowerBody.rotation.z,-steer*speedNorm*.055,1-Math.pow(.02,dt));
    mowerBody.rotation.x=T.MathUtils.lerp(mowerBody.rotation.x,keys.forward?-.012:keys.back?.018:0,1-Math.pow(.02,dt));
    mowerBody.position.y=.012+Math.sin(performance.now()*.018)*.009*speedNorm;

    if(Math.abs(speed)>.28)cutGrass(dt);
    const mph=Math.abs(speed)*2.237;speedHud.querySelector('b').textContent=mph<1?'0':mph.toFixed(0);
    if(engineOsc&&audioCtx){engineOsc.frequency.setTargetAtTime(47+Math.abs(speed)*12,audioCtx.currentTime,.04);engineOsc2.frequency.setTargetAtTime(23+Math.abs(speed)*5,audioCtx.currentTime,.04);}
  }

  function updateCamera(dt){
    const f=tmpV.set(-Math.sin(heading),0,-Math.cos(heading));
    const speedNorm=Math.min(1,Math.abs(speed)/(5.4+save.engine*.75));
    const side=new T.Vector3(Math.cos(heading),0,-Math.sin(heading));
    const desired=mower.position.clone().addScaledVector(f,-6.0-speedNorm*.75).addScaledVector(side,steer*.38).add(new T.Vector3(0,3.25+speedNorm*.28,0));
    camera.position.lerp(desired,1-Math.pow(.0026,dt));
    camTarget.copy(mower.position).addScaledVector(f,2.25+speedNorm*.8).add(new T.Vector3(0,.72,0));
    camera.lookAt(camTarget);
    camera.rotation.z=T.MathUtils.lerp(camera.rotation.z,steer*speedNorm*.012,1-Math.pow(.05,dt));
    camera.fov=T.MathUtils.lerp(camera.fov,52+speedNorm*5,1-Math.pow(.025,dt));camera.updateProjectionMatrix();
    sun.target.position.copy(mower.position);sun.target.updateMatrixWorld();
  }

  function updateParticles(dt){
    particles.forEach(p=>{if(!p.visible)return;p.userData.life-=dt;if(p.userData.life<=0){p.visible=false;return;}p.userData.vel.y-=4.2*dt;p.position.addScaledVector(p.userData.vel,dt);p.rotation.x+=dt*8;p.rotation.z+=dt*5;p.material.opacity=Math.min(.9,p.userData.life*2);});
  }

  function animate(){
    requestAnimationFrame(animate);const dt=Math.min(.04,clock.getDelta());
    if(running&&!paused){updateMower(dt);updateCamera(dt);}else if(mower)updateCamera(dt);
    updateParticles(dt);renderer.render(scene,camera);
  }

  function bind(){
    const map={ArrowUp:'forward',KeyW:'forward',ArrowDown:'back',KeyS:'back',ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right'};
    addEventListener('keydown',e=>{if(map[e.code]){keys[map[e.code]]=true;e.preventDefault();}if(e.code==='Escape')togglePause();},{passive:false});
    addEventListener('keyup',e=>{if(map[e.code]){keys[map[e.code]]=false;e.preventDefault();}},{passive:false});
    document.querySelectorAll('[data-key]').forEach(btn=>{
      const k=btn.dataset.key;
      btn.addEventListener('pointerdown',e=>{e.preventDefault();keys[k]=true;startEngine();});
      ['pointerup','pointercancel','pointerleave'].forEach(ev=>btn.addEventListener(ev,e=>{e.preventDefault();keys[k]=false;}));
    });
    $('startBtn').onclick=startJob;$('garageBtn').onclick=()=>{refreshMoney();show('garageScreen');};$('howBtn').onclick=()=>show('howScreen');
    document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>show('homeScreen'));
    $('pauseBtn').onclick=togglePause;$('resumeBtn').onclick=togglePause;$('quitBtn').onclick=quit;$('homeBtn').onclick=quit;$('playAgainBtn').onclick=startJob;
    document.querySelectorAll('.upgrade').forEach(btn=>btn.onclick=()=>{const k=btn.dataset.upgrade,base=+btn.dataset.cost,lvl=save[k]||0,cost=base*(lvl+1);if(lvl>=3)return;if(save.balance<cost){const b=btn.querySelector('b'),old=b.textContent;b.textContent='NEED MORE £';setTimeout(()=>b.textContent=old,850);return;}save.balance-=cost;save[k]=lvl+1;persist();});
    addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.55));});
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&running&&!paused)togglePause();});
  }

  init();
  setTimeout(()=>{if($('boot'))$('boot').remove();show('homeScreen');},800);
})();