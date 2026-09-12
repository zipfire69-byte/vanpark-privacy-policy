(() => {
  'use strict';

  const T = THREE;
  const $ = id => document.getElementById(id);
  const screens = ['homeScreen','garageScreen','howScreen','completeScreen','pauseScreen'];
  const keys = {forward:false,back:false,left:false,right:false};

  // V4: substantially larger lawn and wider driving envelope.
  const LW = 44, LH = 29, GW = 132, GH = 88;
  const DRIVE_X = 21.8, DRIVE_Z_MIN = -14.4, DRIVE_Z_MAX = 18.2;
  const BASE_PAY = 165;
  const SAVE_KEY = 'sm3d';

  const obstacles = [
    {x:-16.0,z:-6.0,r:2.25,type:'tree'},
    {x:16.0,z:6.0,r:2.35,type:'bed'},
    {x:18.0,z:-10.0,r:2.75,type:'shed'},
    {x:-16.0,z:9.3,r:2.85,type:'trampoline'},
    {x:10.8,z:13.0,r:1.15,type:'planters'},
    {x:-10.8,z:13.0,r:1.0,type:'bench'}
  ];

  let save;
  try {
    save = {...{balance:0,engine:0,deck:0,handling:0}, ...JSON.parse(localStorage.getItem(SAVE_KEY)||'{}')};
  } catch {
    save = {balance:0,engine:0,deck:0,handling:0};
  }

  let scene,camera,renderer,clock,sun;
  let mower,mowerBody,frontLeftPivot,frontRightPivot,wheelMeshes=[];
  let lawnState,cutCount=0,totalCuttable=0;
  let shortGrassTex,longGrassTex,grassNormalTex,grassRoughTex;
  let cutMaskCanvas,cutMaskCtx,cutMaskTex,stripeCanvas,stripeCtx,stripeTex;
  let grassMesh,bladeMeta=[],cellBlades=[];
  let particles=[],particleCursor=0;
  let npcs=[];
  let running=false,paused=false,finished=false,speed=0,heading=Math.PI,steer=0,bonus=0;
  let straightTime=0,combo=0,lastStripeAxis=0;
  let speedHud,jobBanner,comboHud;
  let audioCtx,engineOsc,engineOsc2,engineGain,engineGain2;
  let lastTextureUpdate=0;

  const tmp = new T.Object3D();
  const tmpV = new T.Vector3();
  const camTarget = new T.Vector3();

  function show(id){ screens.forEach(s=>$(s).classList.toggle('hidden',s!==id)); }
  function hideScreens(){ screens.forEach(s=>$(s).classList.add('hidden')); }
  function persist(){ localStorage.setItem(SAVE_KEY,JSON.stringify(save)); refreshMoney(); }

  function refreshMoney(){
    $('balanceText').textContent=`£${save.balance}`;
    $('garageBalance').textContent=`£${save.balance}`;
    document.querySelectorAll('.upgrade').forEach(btn=>{
      const key=btn.dataset.upgrade,base=+btn.dataset.cost,lvl=save[key]||0;
      btn.classList.toggle('maxed',lvl>=3);
      btn.querySelector('b').textContent=lvl>=3?'MAXED':`£${base*(lvl+1)}`;
    });
  }

  function mat(color,rough=.72,metal=.02,extra={}){
    return new T.MeshStandardMaterial({color,roughness:rough,metalness:metal,...extra});
  }

  function addMesh(parent,geo,material,pos=[0,0,0],rot=[0,0,0],scale=[1,1,1],cast=true,receive=true){
    const m=new T.Mesh(geo,material);
    m.position.set(...pos);m.rotation.set(...rot);m.scale.set(...scale);
    m.castShadow=cast;m.receiveShadow=receive;parent.add(m);return m;
  }

  function roundedRectTexture(text,bg='#0f4e2a',fg='#fff',w=512,h=192){
    const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');
    x.fillStyle=bg;x.fillRect(0,0,w,h);
    x.fillStyle='rgba(255,255,255,.08)';
    for(let i=0;i<180;i++)x.fillRect(Math.random()*w,Math.random()*h,Math.random()*3+1,Math.random()*2+1);
    x.fillStyle=fg;x.font=`900 ${Math.floor(h*.36)}px Arial`;x.textAlign='center';x.textBaseline='middle';x.fillText(text,w/2,h/2);
    const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;return t;
  }

  function fbm(x,y){
    const s=Math.sin(x*12.9898+y*78.233)*43758.5453;
    return s-Math.floor(s);
  }

  function makeGrassAlbedo(kind='short',size=512){
    const c=document.createElement('canvas');c.width=c.height=size;const x=c.getContext('2d');
    const img=x.createImageData(size,size);
    for(let yy=0;yy<size;yy++){
      for(let xx=0;xx<size;xx++){
        const i=(yy*size+xx)*4;
        const n1=fbm(xx*.11,yy*.11),n2=fbm(xx*.027+19,yy*.027+7),n3=fbm(xx*.006+5,yy*.006+33);
        const n=n1*.38+n2*.37+n3*.25;
        let r,g,b;
        if(kind==='long'){
          r=34+n*34;g=78+n*63;b=29+n*30;
          if(fbm(xx*.35,yy*.31)>.985){r+=22;g+=26;b+=7;}
          if(fbm(xx*.2+12,yy*.2+9)>.992){r+=34;g+=18;b-=2;}
        }else{
          r=45+n*45;g=95+n*70;b=39+n*36;
          const blade=Math.sin((xx+yy*.17)*.92)*.5+.5;
          r+=blade*7;g+=blade*9;b+=blade*3;
          if(fbm(xx*.5,yy*.48)>.994){r+=30;g+=24;b+=6;}
        }
        img.data[i]=Math.max(0,Math.min(255,r));
        img.data[i+1]=Math.max(0,Math.min(255,g));
        img.data[i+2]=Math.max(0,Math.min(255,b));
        img.data[i+3]=255;
      }
    }
    x.putImageData(img,0,0);
    x.globalAlpha=kind==='long'?.16:.09;
    for(let i=0;i<(kind==='long'?2400:1200);i++){
      const px=Math.random()*size,py=Math.random()*size,len=(kind==='long'?5:3)+Math.random()*9;
      x.strokeStyle=Math.random()>.5?'#b3ce75':'#153f20';x.lineWidth=Math.random()*.8+.25;
      x.beginPath();x.moveTo(px,py);x.lineTo(px+(Math.random()-.5)*2,py-len);x.stroke();
    }
    x.globalAlpha=1;
    const t=new T.CanvasTexture(c);t.wrapS=t.wrapT=T.RepeatWrapping;t.colorSpace=T.SRGBColorSpace;
    t.anisotropy=4;t.repeat.set(13,8.5);return t;
  }

  function makeGrassNormal(size=512){
    const c=document.createElement('canvas');c.width=c.height=size;const x=c.getContext('2d');
    const img=x.createImageData(size,size);
    for(let yy=0;yy<size;yy++)for(let xx=0;xx<size;xx++){
      const i=(yy*size+xx)*4;
      const nx=(fbm(xx*.21+2,yy*.17)-.5)*44;
      const ny=(fbm(xx*.18,yy*.22+7)-.5)*44;
      img.data[i]=128+nx;img.data[i+1]=128+ny;img.data[i+2]=232+fbm(xx*.07,yy*.07)*23;img.data[i+3]=255;
    }
    x.putImageData(img,0,0);
    const t=new T.CanvasTexture(c);t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(13,8.5);return t;
  }

  function makeRoughness(size=256){
    const c=document.createElement('canvas');c.width=c.height=size;const x=c.getContext('2d');
    const img=x.createImageData(size,size);
    for(let yy=0;yy<size;yy++)for(let xx=0;xx<size;xx++){
      const i=(yy*size+xx)*4;const v=196+fbm(xx*.13,yy*.13)*46;
      img.data[i]=img.data[i+1]=img.data[i+2]=v;img.data[i+3]=255;
    }
    x.putImageData(img,0,0);const t=new T.CanvasTexture(c);t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(13,8.5);return t;
  }

  function makePaintTexture(){
    const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d');
    const g=x.createLinearGradient(0,0,256,256);g.addColorStop(0,'#ef7c20');g.addColorStop(.55,'#d75d12');g.addColorStop(1,'#b8420c');
    x.fillStyle=g;x.fillRect(0,0,256,256);
    for(let i=0;i<2600;i++){
      const a=Math.random()*.08;x.fillStyle=Math.random()>.5?`rgba(255,255,255,${a})`:`rgba(0,0,0,${a})`;
      x.fillRect(Math.random()*256,Math.random()*256,Math.random()*2+1,Math.random()*2+1);
    }
    const t=new T.CanvasTexture(c);t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(2,2);t.colorSpace=T.SRGBColorSpace;return t;
  }

  function makeBladeAtlas(){
    const c=document.createElement('canvas');c.width=256;c.height=256;const x=c.getContext('2d');
    x.clearRect(0,0,256,256);
    const grad=x.createLinearGradient(0,256,0,10);grad.addColorStop(0,'rgba(25,78,30,.98)');grad.addColorStop(.5,'rgba(58,126,48,.95)');grad.addColorStop(1,'rgba(132,172,82,.82)');
    x.strokeStyle=grad;x.lineCap='round';
    for(let i=0;i<34;i++){
      const bx=128+(Math.random()-.5)*150,by=250,tx=bx+(Math.random()-.5)*48,ty=28+Math.random()*110;
      x.lineWidth=1.2+Math.random()*3.2;x.beginPath();x.moveTo(bx,by);
      const cx=bx+(Math.random()-.5)*22,cy=(by+ty)/2;
      x.quadraticCurveTo(cx,cy,tx,ty);x.stroke();
    }
    const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;return t;
  }

  function init(){
    scene=new T.Scene();
    scene.background=new T.Color(0xa9cbd7);
    scene.fog=new T.FogExp2(0xb2cbd0,.0088);

    camera=new T.PerspectiveCamera(50,innerWidth/innerHeight,.08,220);
    camera.position.set(0,4.6,8.2);

    renderer=new T.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
    renderer.setSize(innerWidth,innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio,1.45));
    renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=T.PCFSoftShadowMap;
    renderer.outputColorSpace=T.SRGBColorSpace;
    renderer.toneMapping=T.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.03;
    $('game').appendChild(renderer.domElement);
    clock=new T.Clock();

    buildSky();
    buildLighting();
    buildWorld();
    buildMower();
    buildParticles();
    buildGameUI();
    bind();
    refreshMoney();
    updateHomeCopy();
    animate();
  }

  function buildSky(){
    const geo=new T.SphereGeometry(150,36,20);
    const sky=new T.ShaderMaterial({
      side:T.BackSide,
      uniforms:{top:{value:new T.Color(0x5b9fc8)},bottom:{value:new T.Color(0xeaf1e9)},offset:{value:24},exponent:{value:.82}},
      vertexShader:'varying vec3 vWorldPosition;void main(){vec4 w=modelMatrix*vec4(position,1.0);vWorldPosition=w.xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:'uniform vec3 top;uniform vec3 bottom;uniform float offset;uniform float exponent;varying vec3 vWorldPosition;void main(){float h=normalize(vWorldPosition+vec3(0.0,offset,0.0)).y;gl_FragColor=vec4(mix(bottom,top,max(pow(max(h,0.0),exponent),0.0)),1.0);}'
    });
    scene.add(new T.Mesh(geo,sky));
    const cloudMat=new T.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.36,depthWrite:false});
    [[-30,22,-40,1.3],[18,25,-52,1.8],[42,19,9,1.2],[-52,23,14,1.55]].forEach(([x,y,z,s])=>{
      const g=new T.Group();g.position.set(x,y,z);scene.add(g);
      for(let i=0;i<6;i++)addMesh(g,new T.SphereGeometry((1.2+Math.random())*s,12,8),cloudMat,[i*s*1.2,(Math.random()-.5)*.9,(Math.random()-.5)*1.2],[0,0,0],[1.9,.65,1],false,false);
    });
  }

  function buildLighting(){
    scene.add(new T.HemisphereLight(0xe6f5ff,0x3e4b30,1.75));
    scene.add(new T.AmbientLight(0xffffff,.32));
    sun=new T.DirectionalLight(0xffecc5,3.45);
    sun.position.set(-22,31,14);sun.castShadow=true;
    sun.shadow.mapSize.set(2048,2048);
    sun.shadow.camera.left=-31;sun.shadow.camera.right=31;sun.shadow.camera.top=31;sun.shadow.camera.bottom=-31;
    sun.shadow.camera.near=2;sun.shadow.camera.far=85;sun.shadow.bias=-.00045;
    scene.add(sun);
  }

  function buildWorld(){
    const groundTex=makeGrassAlbedo('long',384);groundTex.repeat.set(24,18);
    addMesh(scene,new T.CircleGeometry(95,72),new T.MeshStandardMaterial({map:groundTex,roughness:1}),[0,-.21,0],[-Math.PI/2,0,0],[1,1,1],false,true);

    buildLawn();
    buildHouseAndDrive();
    buildFence();
    buildTree();
    buildFlowerBed();
    buildShed();
    buildTrampoline();
    buildPatioProps();
    buildNeighbourhood();
    buildRoadAndVehicles();
    buildTacoTruckAndCrew();
    buildGardenClutter();
  }

  function buildLawn(){
    shortGrassTex=makeGrassAlbedo('short');
    longGrassTex=makeGrassAlbedo('long');
    grassNormalTex=makeGrassNormal();
    grassRoughTex=makeRoughness();

    lawnState=new Uint8Array(GW*GH);
    cellBlades=Array.from({length:GW*GH},()=>[]);
    countTotal();

    const baseGeo=new T.PlaneGeometry(LW,LH,1,1);
    const shortMat=new T.MeshStandardMaterial({
      map:shortGrassTex,normalMap:grassNormalTex,roughnessMap:grassRoughTex,
      normalScale:new T.Vector2(.48,.48),roughness:.92,metalness:0
    });
    addMesh(scene,baseGeo,shortMat,[0,.002,0],[-Math.PI/2,0,0],[1,1,1],false,true);

    cutMaskCanvas=document.createElement('canvas');cutMaskCanvas.width=GW*4;cutMaskCanvas.height=GH*4;
    cutMaskCtx=cutMaskCanvas.getContext('2d');cutMaskCtx.fillStyle='#fff';cutMaskCtx.fillRect(0,0,cutMaskCanvas.width,cutMaskCanvas.height);
    cutMaskTex=new T.CanvasTexture(cutMaskCanvas);cutMaskTex.magFilter=T.LinearFilter;cutMaskTex.minFilter=T.LinearFilter;

    const longMat=new T.MeshStandardMaterial({
      map:longGrassTex,normalMap:grassNormalTex,roughnessMap:grassRoughTex,alphaMap:cutMaskTex,
      transparent:true,alphaTest:.035,normalScale:new T.Vector2(.75,.75),roughness:.98,metalness:0
    });
    addMesh(scene,baseGeo.clone(),longMat,[0,.008,0],[-Math.PI/2,0,0],[1,1,1],false,true);

    stripeCanvas=document.createElement('canvas');stripeCanvas.width=GW*4;stripeCanvas.height=GH*4;
    stripeCtx=stripeCanvas.getContext('2d');stripeCtx.clearRect(0,0,stripeCanvas.width,stripeCanvas.height);
    stripeTex=new T.CanvasTexture(stripeCanvas);stripeTex.magFilter=T.LinearFilter;stripeTex.minFilter=T.LinearFilter;
    addMesh(scene,baseGeo.clone(),new T.MeshBasicMaterial({map:stripeTex,transparent:true,depthWrite:false,opacity:.72}),[0,.014,0],[-Math.PI/2,0,0],[1,1,1],false,false);

    const bladeTex=makeBladeAtlas();
    const positions=[
      -.19,0,0, .19,0,0, .19,.92,0, -.19,.92,0,
      0,0,-.19, 0,0,.19, 0,.92,.19, 0,.92,-.19
    ];
    const uvs=[0,0,1,0,1,1,0,1, 0,0,1,0,1,1,0,1];
    const idx=[0,1,2,0,2,3, 4,5,6,4,6,7];
    const bladeGeo=new T.BufferGeometry();
    bladeGeo.setAttribute('position',new T.Float32BufferAttribute(positions,3));
    bladeGeo.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));
    bladeGeo.setIndex(idx);bladeGeo.computeVertexNormals();

    const bladeMat=new T.MeshStandardMaterial({
      map:bladeTex,transparent:true,alphaTest:.28,side:T.DoubleSide,roughness:1,metalness:0
    });

    const maxClusters=innerWidth<720?5200:7800;
    grassMesh=new T.InstancedMesh(bladeGeo,bladeMat,maxClusters);
    grassMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);grassMesh.castShadow=false;grassMesh.receiveShadow=true;
    scene.add(grassMesh);

    bladeMeta=[];
    let made=0,attempts=0;
    const color=new T.Color();
    while(made<maxClusters&&attempts<maxClusters*7){
      attempts++;
      const x=(Math.random()-.5)*(LW-.6),z=(Math.random()-.5)*(LH-.6);
      if(blockedCutCell(x,z,.08))continue;
      const gx=T.MathUtils.clamp(Math.floor((x/LW+.5)*GW),0,GW-1);
      const gy=T.MathUtils.clamp(Math.floor((z/LH+.5)*GH),0,GH-1);
      const cell=gy*GW+gx,height=.72+Math.random()*.7,rot=Math.random()*Math.PI;
      bladeMeta.push({x,z,height,rot,cell,cut:false});cellBlades[cell].push(made);
      tmp.position.set(x,.012,z);tmp.rotation.set(0,rot,0);tmp.scale.set(.85+Math.random()*.55,height,.85+Math.random()*.35);tmp.updateMatrix();
      grassMesh.setMatrixAt(made,tmp.matrix);
      color.setHSL(.29+Math.random()*.035,.45+Math.random()*.18,.31+Math.random()*.12);
      grassMesh.setColorAt(made,color);
      made++;
    }
    grassMesh.count=made;grassMesh.instanceMatrix.needsUpdate=true;if(grassMesh.instanceColor)grassMesh.instanceColor.needsUpdate=true;
  }

  function buildHouseAndDrive(){
    const brick=proceduralWallTexture('#aa8068','#7e5c4f');brick.repeat.set(7,2.8);
    const wallMat=new T.MeshStandardMaterial({map:brick,roughness:.92});
    addMesh(scene,new T.BoxGeometry(25,7.4,5.5),wallMat,[0,3.7,22],[0,0,0],[1,1,1],true,true);

    const roof=mat(0x383c3c,.95,0);
    addMesh(scene,new T.BoxGeometry(26.4,.26,5.6),roof,[0,7.8,20.6],[-.5,0,0],[1,1,1],true,true);
    addMesh(scene,new T.BoxGeometry(26.4,.26,5.6),roof,[0,7.8,23.4],[.5,0,0],[1,1,1],true,true);

    const white=mat(0xecebe4,.45,.02),glass=mat(0x6d99a7,.18,.18,{transparent:true,opacity:.76});
    const window=(x,y,w=3.4,h=2.35)=>{
      addMesh(scene,new T.BoxGeometry(w+.18,h+.18,.12),white,[x,y,19.23]);
      addMesh(scene,new T.BoxGeometry(w,h,.07),glass,[x,y,19.14],[0,0,0],[1,1,1],false,false);
      addMesh(scene,new T.BoxGeometry(.08,h,.09),white,[x,y,19.08],[0,0,0],[1,1,1],false,false);
      addMesh(scene,new T.BoxGeometry(w,.08,.09),white,[x,y,19.08],[0,0,0],[1,1,1],false,false);
    };
    window(-7.1,4.25);window(1.3,4.25);window(7.7,4.25,2.9,2.35);
    addMesh(scene,new T.BoxGeometry(2.25,4.2,.18),mat(0x20382c,.45,.08),[-2.9,2.35,19.12]);
    addMesh(scene,new T.BoxGeometry(5.2,3.35,.16),mat(0xe6e3da,.55,.05),[9.5,1.78,19.13]);
    for(let y=.5;y<3.1;y+=.55)addMesh(scene,new T.BoxGeometry(4.7,.08,.06),mat(0xb6b5ae,.7),[9.5,y,19.02],[0,0,0],[1,1,1],false,false);

    const paving=proceduralStoneTexture();paving.repeat.set(7,2.2);
    const patioMat=new T.MeshStandardMaterial({map:paving,roughness:.98});
    addMesh(scene,new T.BoxGeometry(20,.16,3.8),patioMat,[-2,.04,16.8],[0,0,0],[1,1,1],false,true);
    addMesh(scene,new T.BoxGeometry(9,.16,5.8),patioMat,[16.4,.04,17.8],[0,0,0],[1,1,1],false,true);
    addMesh(scene,new T.BoxGeometry(5.6,.09,2.3),patioMat,[-2.9,.12,18.1],[0,0,0],[1,1,1],false,true);
  }

  function proceduralWallTexture(a,b){
    const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d');
    x.fillStyle=a;x.fillRect(0,0,256,256);
    const rows=16,bh=256/rows,bw=32;
    for(let r=0;r<rows;r++){
      for(let col=-1;col<10;col++){
        const off=r%2?bw/2:0,xx=col*bw+off,yy=r*bh;
        const n=fbm(col*1.7,r*2.2);x.fillStyle=n>.5?a:b;x.globalAlpha=.26;x.fillRect(xx+1,yy+1,bw-2,bh-2);
      }
    }
    x.globalAlpha=1;x.strokeStyle='rgba(220,214,198,.42)';x.lineWidth=1;
    for(let r=0;r<=rows;r++){x.beginPath();x.moveTo(0,r*bh);x.lineTo(256,r*bh);x.stroke();}
    const t=new T.CanvasTexture(c);t.wrapS=t.wrapT=T.RepeatWrapping;t.colorSpace=T.SRGBColorSpace;return t;
  }

  function proceduralStoneTexture(){
    const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d');
    x.fillStyle='#b7ad99';x.fillRect(0,0,256,256);
    for(let yy=0;yy<256;yy+=32)for(let xx=0;xx<256;xx+=48){
      const n=fbm(xx*.1,yy*.1);x.fillStyle=`rgb(${170+n*30},${162+n*28},${144+n*26})`;x.fillRect(xx+2,yy+2,44,28);
    }
    x.strokeStyle='rgba(72,68,60,.42)';x.lineWidth=2;
    for(let yy=0;yy<256;yy+=32){x.beginPath();x.moveTo(0,yy);x.lineTo(256,yy);x.stroke();}
    for(let xx=0;xx<256;xx+=48){x.beginPath();x.moveTo(xx,0);x.lineTo(xx,256);x.stroke();}
    const t=new T.CanvasTexture(c);t.wrapS=t.wrapT=T.RepeatWrapping;t.colorSpace=T.SRGBColorSpace;return t;
  }

  function buildFence(){
    const woodTex=proceduralWoodTexture();woodTex.repeat.set(1.6,1);
    const wood=new T.MeshStandardMaterial({map:woodTex,roughness:.96});
    const post=mat(0x5d3b27,.95);
    for(let x=-21.7;x<=21.7;x+=1.5){
      addMesh(scene,new T.BoxGeometry(1.42,1.6,.11),wood,[x,.8,-15.0]);
      addMesh(scene,new T.BoxGeometry(.13,1.95,.14),post,[x-.72,.95,-14.94]);
    }
    for(let z=-14.25;z<=17.2;z+=1.5){
      addMesh(scene,new T.BoxGeometry(1.42,1.6,.11),wood,[-22.35,.8,z],[0,Math.PI/2,0]);
      addMesh(scene,new T.BoxGeometry(1.42,1.6,.11),wood,[22.35,.8,z],[0,Math.PI/2,0]);
    }

    const leaf1=mat(0x285c2d,1),leaf2=mat(0x38743b,1);
    const hgeo=new T.IcosahedronGeometry(.92,1);
    for(let x=-21.4;x<=21.4;x+=1.05){
      const m=(Math.floor(x*4)&1)?leaf1:leaf2;
      addMesh(scene,hgeo,m,[x,1.55,-14.38],[0,Math.random()*2,0],[1.2,1.05,.78],true,true);
    }
  }

  function proceduralWoodTexture(){
    const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d');
    x.fillStyle='#8b5e39';x.fillRect(0,0,256,256);
    for(let i=0;i<160;i++){
      const yy=Math.random()*256;x.strokeStyle=`rgba(${Math.random()>.5?'55,33,20':'230,180,110'},${.04+Math.random()*.13})`;
      x.lineWidth=.5+Math.random()*2;x.beginPath();x.moveTo(0,yy);x.bezierCurveTo(70,yy+Math.random()*8-4,180,yy+Math.random()*8-4,256,yy);x.stroke();
    }
    const t=new T.CanvasTexture(c);t.wrapS=t.wrapT=T.RepeatWrapping;t.colorSpace=T.SRGBColorSpace;return t;
  }

  function buildTree(){
    const trunk=mat(0x5b402d,1),leaf1=mat(0x2e6a35,1),leaf2=mat(0x417f3e,1);
    addMesh(scene,new T.CylinderGeometry(.42,.62,5.1,14),trunk,[-16,2.55,-6]);
    [[-16,6,-6,2.4],[-14.9,5.6,-6.2,1.75],[-17.2,5.5,-5.8,1.9],[-16,7,-6,1.6]].forEach(([x,y,z,r],i)=>
      addMesh(scene,new T.IcosahedronGeometry(r,2),i%2?leaf2:leaf1,[x,y,z],[0,Math.random()*3,0],[1,.85,1],true,true));
  }

  function buildFlowerBed(){
    addMesh(scene,new T.CylinderGeometry(2.38,2.38,.27,44),mat(0x7d7a70,1),[16,.1,6]);
    addMesh(scene,new T.CylinderGeometry(2.04,2.04,.31,44),mat(0x4a2f24,1),[16,.17,6]);
    const colors=[0xe65b70,0xf2c54d,0xb268d9,0xffffff,0xec8b36];
    for(let i=0;i<36;i++){
      const a=Math.random()*Math.PI*2,r=Math.sqrt(Math.random())*1.62,x=16+Math.cos(a)*r,z=6+Math.sin(a)*r;
      addMesh(scene,new T.CylinderGeometry(.018,.025,.4,5),mat(0x31723b,1),[x,.46,z],[0,0,0],[1,1,1],false,false);
      addMesh(scene,new T.SphereGeometry(.1,7,5),mat(colors[i%colors.length],.8),[x,.7,z],[0,0,0],[1,1,1],false,false);
    }
  }

  function buildShed(){
    const wood=proceduralWoodTexture();wood.repeat.set(3,2);
    const woodMat=new T.MeshStandardMaterial({map:wood,roughness:1});
    addMesh(scene,new T.BoxGeometry(5,3.6,4),woodMat,[18,1.8,-10]);
    addMesh(scene,new T.ConeGeometry(3.7,1.7,4),mat(0x383c3b,.92),[18,4.45,-10],[0,Math.PI/4,0]);
    addMesh(scene,new T.BoxGeometry(1.45,2.7,.09),mat(0x563624,.95),[18,1.45,-12.05]);
    addMesh(scene,new T.BoxGeometry(1,.7,.09),mat(0x668fa2,.24,.08,{transparent:true,opacity:.72}),[19.5,2.45,-12.06],[0,0,0],[1,1,1],false,false);
    addMesh(scene,new T.CylinderGeometry(.35,.4,2.2,18),mat(0x344c3c,.72),[20.4,1.1,-7.6]);
  }

  function buildTrampoline(){
    const g=new T.Group();g.position.set(-16,0,9.3);scene.add(g);
    const metal=mat(0x3d4547,.35,.45),dark=mat(0x101514,.75);
    addMesh(g,new T.CylinderGeometry(2.45,2.45,.12,40),dark,[0,1.0,0],[0,0,0],[1,1,.18],true,true);
    addMesh(g,new T.TorusGeometry(2.48,.08,10,48),metal,[0,1.0,0],[Math.PI/2,0,0]);
    for(let a=0;a<Math.PI*2;a+=Math.PI/3){
      addMesh(g,new T.CylinderGeometry(.04,.05,1.0,8),metal,[Math.cos(a)*2.0,.5,Math.sin(a)*2.0]);
    }
    const netMat=mat(0x202925,.7,.1,{transparent:true,opacity:.26,side:T.DoubleSide});
    addMesh(g,new T.CylinderGeometry(2.42,2.42,2.1,40,1,true),netMat,[0,2.0,0],[0,0,0],[1,1,1],false,false);
  }

  function buildPatioProps(){
    const metal=mat(0x282d2b,.38,.48),wood=mat(0x6b4b31,.75);
    addMesh(scene,new T.CylinderGeometry(.055,.055,1.08,9),metal,[-7.6,.66,16.6]);
    addMesh(scene,new T.CylinderGeometry(1.02,1.02,.09,30),wood,[-7.6,1.18,16.6]);
    [[-8.9,16.4],[-6.25,16.45]].forEach(([x,z])=>{
      addMesh(scene,new T.BoxGeometry(.95,.13,.84),metal,[x,.58,z]);
      addMesh(scene,new T.BoxGeometry(.95,1.05,.13),metal,[x,1.0,z+.38]);
      [[-.34,-.3],[.34,-.3],[-.34,.3],[.34,.3]].forEach(([dx,dz])=>addMesh(scene,new T.CylinderGeometry(.028,.028,.58,7),metal,[x+dx,.29,z+dz]));
    });
    addMesh(scene,new T.SphereGeometry(.62,20,12,0,Math.PI*2,0,Math.PI/2),mat(0x171b19,.35,.55),[4.7,1.1,16.6],[0,0,0],[1,1,1]);
    addMesh(scene,new T.CylinderGeometry(.05,.05,1.1,8),metal,[4.7,.55,16.6]);
    [[-11.8,16.3,.5],[10.8,15.8,.55],[12.0,15.8,.42]].forEach(([x,z,s])=>{
      addMesh(scene,new T.CylinderGeometry(s*.45,s*.58,s,16),mat(0x8d4d32,.9),[x,s*.5,z]);
      addMesh(scene,new T.IcosahedronGeometry(s*.72,1),mat(0x39733d,1),[x,s*1.25,z],[0,0,0],[1,1,1],true,true);
    });
  }

  function buildNeighbourhood(){
    const houseColors=[0xc7b39e,0xb8b5a5,0xd1c0ac];
    [[-38,4,30],[37,4,31],[-42,4,-2],[42,4,-4]].forEach(([x,y,z],i)=>{
      addMesh(scene,new T.BoxGeometry(18,7,7),mat(houseColors[i%houseColors.length],.95),[x,y,z],[0,0,0],[1,1,1],false,true);
      addMesh(scene,new T.ConeGeometry(14,4.8,4),mat(0x44494a,.95),[x,9,z],[0,Math.PI/4,0],[1,1,1],false,true);
    });
    for(let i=0;i<18;i++){
      const x=-40+Math.random()*80,z=-34+Math.random()*70;
      if(Math.abs(x)<26&&z>-18&&z<25)continue;
      const h=3+Math.random()*3;
      addMesh(scene,new T.CylinderGeometry(.18,.28,h,8),mat(0x59432e,1),[x,h/2,z],[0,0,0],[1,1,1],false,true);
      addMesh(scene,new T.IcosahedronGeometry(1.4+Math.random()*1.2,1),mat(0x365f35,1),[x,h+.7,z],[0,0,0],[1,.9,1],false,true);
    }
  }

  function buildRoadAndVehicles(){
    const asphalt=proceduralAsphaltTexture();asphalt.repeat.set(10,1.6);
    addMesh(scene,new T.BoxGeometry(70,.08,8),new T.MeshStandardMaterial({map:asphalt,roughness:1}),[0,-.03,-20.0],[0,0,0],[1,1,1],false,true);
    addMesh(scene,new T.BoxGeometry(70,.11,.22),mat(0xd9d0aa,.8),[0,.03,-20],[0,0,0],[1,1,1],false,false);
    addMesh(scene,new T.BoxGeometry(70,.11,.12),mat(0xd9d0aa,.8),[0,.03,-23.1],[0,0,0],[1,1,1],false,false);
    buildVan(11.5,-20.6,Math.PI,0xe7e8e3);
    buildCar(27,-20.3,Math.PI,0x324d66);
  }

  function proceduralAsphaltTexture(){
    const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d');x.fillStyle='#343535';x.fillRect(0,0,256,256);
    for(let i=0;i<8500;i++){const v=42+Math.random()*45;x.fillStyle=`rgba(${v},${v},${v},${.08+Math.random()*.14})`;x.fillRect(Math.random()*256,Math.random()*256,1,1);}
    const t=new T.CanvasTexture(c);t.wrapS=t.wrapT=T.RepeatWrapping;t.colorSpace=T.SRGBColorSpace;return t;
  }

  function buildVan(x,z,rot,color){
    const g=new T.Group();g.position.set(x,.2,z);g.rotation.y=rot;scene.add(g);
    const body=mat(color,.38,.12),black=mat(0x131715,.82),glass=mat(0x38525f,.18,.22,{transparent:true,opacity:.78});
    addMesh(g,new T.BoxGeometry(4.8,1.8,2.2),body,[0,1.25,0]);
    addMesh(g,new T.BoxGeometry(1.8,1.4,2.15),body,[-1.5,2.25,0],[0,0,0],[1,1,1]);
    addMesh(g,new T.BoxGeometry(.08,.75,1.65),glass,[-2.42,2.42,0],[0,0,0],[1,1,1],false,false);
    [[-1.5,-.9],[-1.5,.9],[1.55,-.9],[1.55,.9]].forEach(([xx,zz])=>{
      const wg=new T.CylinderGeometry(.46,.46,.26,18);wg.rotateZ(Math.PI/2);addMesh(g,wg,black,[xx,.55,zz],[0,0,0],[1,1,1]);
    });
  }

  function buildCar(x,z,rot,color){
    const g=new T.Group();g.position.set(x,.15,z);g.rotation.y=rot;scene.add(g);
    const body=mat(color,.35,.16),black=mat(0x121514,.85),glass=mat(0x38525f,.18,.2,{transparent:true,opacity:.75});
    addMesh(g,new T.BoxGeometry(4.2,.75,1.8),body,[0,.78,0]);
    addMesh(g,new T.BoxGeometry(2.25,.78,1.65),body,[.1,1.36,0]);
    addMesh(g,new T.BoxGeometry(1.65,.5,1.7),glass,[-.25,1.48,0]);
    [[-1.35,-.76],[-1.35,.76],[1.35,-.76],[1.35,.76]].forEach(([xx,zz])=>{const wg=new T.CylinderGeometry(.36,.36,.22,18);wg.rotateZ(Math.PI/2);addMesh(g,wg,black,[xx,.43,zz]);});
  }

  function buildTacoTruckAndCrew(){
    const g=new T.Group();g.position.set(-11.5,.18,-20.9);g.rotation.y=Math.PI;scene.add(g);
    const cream=mat(0xe9e3d2,.55,.05),green=mat(0x0c7a43,.52,.05),black=mat(0x121513,.85),metal=mat(0x9a9c98,.38,.45);
    addMesh(g,new T.BoxGeometry(5.8,2.5,2.5),cream,[0,1.55,0]);
    addMesh(g,new T.BoxGeometry(2.0,2.1,2.42),green,[-1.9,1.48,0]);
    addMesh(g,new T.BoxGeometry(2.65,1.05,.08),mat(0x141714,.75),[1.0,1.8,-1.3],[0,0,0],[1,1,1]);
    addMesh(g,new T.BoxGeometry(2.9,.1,1.0),green,[1.0,2.38,-1.65],[-.5,0,0],[1,1,1]);
    const sign=roundedRectTexture('EL JARDÍN TACOS','#0d7d42','#fff');
    addMesh(g,new T.PlaneGeometry(3.8,1.05),new T.MeshBasicMaterial({map:sign}),[.15,2.98,-1.27],[0,0,0],[1,1,1],false,false);
    const menu=roundedRectTexture('TACOS • TORTAS • AGUA FRESCA','#efe9d6','#283227',640,120);
    addMesh(g,new T.PlaneGeometry(4.1,.78),new T.MeshBasicMaterial({map:menu}),[.15,2.24,1.27],[0,Math.PI,0],[1,1,1],false,false);
    [[-1.9,-1.12],[-1.9,1.12],[1.65,-1.12],[1.65,1.12]].forEach(([xx,zz])=>{const wg=new T.CylinderGeometry(.5,.5,.28,20);wg.rotateZ(Math.PI/2);addMesh(g,wg,black,[xx,.52,zz]);addMesh(g,new T.CylinderGeometry(.2,.2,.3,16),metal,[xx,.52,zz],[0,0,Math.PI/2]);});

    npcs.push(makeNPC(-8.2,16.4,0x3b7b46,0x34475a,'hat'));
    npcs.push(makeNPC(6.7,16.3,0x9b512b,0x26374c,'cap'));
    npcs.push(makeNPC(-7.9,-17.0,0x71498d,0x2d363b,'hair'));
    npcs.push(makeNPC(-14.0,-17.0,0x2e6f65,0x38383c,'hat'));
  }

  function makeNPC(x,z,shirt,trousers,headwear){
    const root=new T.Group();root.position.set(x,0,z);scene.add(root);
    const skinChoices=[0xa56c46,0xbd8057,0x8f5d3f,0xcb8a5a],skin=mat(skinChoices[Math.floor(Math.random()*skinChoices.length)],.72);
    const cloth=mat(shirt,.88),pants=mat(trousers,.92),boots=mat(0x191b1a,.88),hair=mat(0x211c18,.92);
    const body=new T.Group();root.add(body);
    addMesh(body,new T.CapsuleGeometry(.28,.72,6,10),cloth,[0,1.62,0],[0,0,0],[1.05,1.05,.86],true,true);
    const head=addMesh(body,new T.SphereGeometry(.28,16,12),skin,[0,2.48,0],[0,0,0],[1,.98,.92],true,true);
    addMesh(body,new T.SphereGeometry(.045,7,6),skin,[0,2.45,-.265],[0,0,0],[.8,.75,1.1],true,true);
    addMesh(body,new T.SphereGeometry(.035,6,5),mat(0x222222,.6),[-.09,2.53,-.25],[0,0,0],[1,1,.5],false,false);
    addMesh(body,new T.SphereGeometry(.035,6,5),mat(0x222222,.6),[.09,2.53,-.25],[0,0,0],[1,1,.5],false,false);

    const lArm=new T.Group(),rArm=new T.Group();lArm.position.set(-.38,1.98,0);rArm.position.set(.38,1.98,0);body.add(lArm,rArm);
    addMesh(lArm,new T.CapsuleGeometry(.085,.58,4,8),skin,[0,-.35,0],[0,0,0],[1,1,1],true,true);
    addMesh(rArm,new T.CapsuleGeometry(.085,.58,4,8),skin,[0,-.35,0],[0,0,0],[1,1,1],true,true);
    const lLeg=new T.Group(),rLeg=new T.Group();lLeg.position.set(-.17,1.12,0);rLeg.position.set(.17,1.12,0);body.add(lLeg,rLeg);
    addMesh(lLeg,new T.CapsuleGeometry(.11,.74,4,8),pants,[0,-.45,0],[0,0,0],[1,1,1],true,true);
    addMesh(rLeg,new T.CapsuleGeometry(.11,.74,4,8),pants,[0,-.45,0],[0,0,0],[1,1,1],true,true);
    addMesh(body,new T.BoxGeometry(.22,.12,.42),boots,[-.17,.18,-.07],[0,0,0],[1,1,1],true,true);
    addMesh(body,new T.BoxGeometry(.22,.12,.42),boots,[.17,.18,-.07],[0,0,0],[1,1,1],true,true);

    if(headwear==='hat'){
      addMesh(body,new T.CylinderGeometry(.52,.52,.06,24),mat(0xc9a95f,.82),[0,2.71,0],[0,0,0],[1,1,.72],true,true);
      addMesh(body,new T.CylinderGeometry(.24,.31,.3,18),mat(0xd2b46a,.84),[0,2.85,0],[0,0,0],[1,1,.88],true,true);
    }else if(headwear==='cap'){
      addMesh(body,new T.SphereGeometry(.29,14,8,0,Math.PI*2,0,Math.PI/2),mat(0x294b77,.7),[0,2.65,0],[0,0,0],[1,1,1],true,true);
      addMesh(body,new T.BoxGeometry(.27,.045,.3),mat(0x294b77,.7),[0,2.64,-.27],[-.08,0,0],[1,1,1],true,true);
    }else{
      addMesh(body,new T.SphereGeometry(.29,14,8,0,Math.PI*2,0,Math.PI/2),hair,[0,2.65,0],[0,0,0],[1.03,.9,1.03],true,true);
    }
    const bottle=addMesh(rArm,new T.CylinderGeometry(.045,.045,.32,8),mat(0x5ea9b9,.35,.12,{transparent:true,opacity:.8}),[0,-.72,-.05],[0,0,0],[1,1,1],true,true);
    return {root,body,head,lArm,rArm,lLeg,rLeg,bottle,phase:Math.random()*Math.PI*2,home:new T.Vector3(x,0,z),react:0};
  }

  function buildGardenClutter(){
    const wb=new T.Group();wb.position.set(-11.2,.1,12.6);wb.rotation.y=.35;scene.add(wb);
    addMesh(wb,new T.BoxGeometry(1.3,.45,.75),mat(0x456844,.7,.08),[0,.55,0],[.2,0,0],[1,1,1],true,true);
    addMesh(wb,new T.CylinderGeometry(.27,.27,.18,16),mat(0x151817,.9),[-.68,.32,0],[0,0,Math.PI/2],[1,1,1],true,true);
    addMesh(wb,new T.CylinderGeometry(.035,.035,1.5,8),mat(0x4b4e4c,.55,.35),[.75,.48,-.28],[0,0,-1.2],[1,1,1],true,true);
    addMesh(wb,new T.CylinderGeometry(.035,.035,1.5,8),mat(0x4b4e4c,.55,.35),[.75,.48,.28],[0,0,-1.2],[1,1,1],true,true);

    const hose=mat(0x1a482e,.82),metal=mat(0x646966,.45,.35);
    addMesh(scene,new T.TorusGeometry(.42,.065,10,28),hose,[13.8,.55,13.4],[Math.PI/2,0,0],[1,1,1],true,true);
    addMesh(scene,new T.CylinderGeometry(.035,.035,1.15,8),metal,[13.8,.55,13.4],[Math.PI/2,0,0],[1,1,1],true,true);

    addMesh(scene,new T.CylinderGeometry(.035,.045,2.3,8),metal,[-6.3,1.15,12.8]);
    addMesh(scene,new T.ConeGeometry(.45,.45,12),mat(0x6c4a2e,.85),[-6.3,2.35,12.8]);
    const bench=new T.Group();bench.position.set(-10.7,.1,13.1);scene.add(bench);
    const bwood=mat(0x76513a,.8);
    for(let y=.4;y<1.3;y+=.3)addMesh(bench,new T.BoxGeometry(2.1,.16,.18),bwood,[0,y,.25]);
    addMesh(bench,new T.BoxGeometry(2.1,.18,.75),bwood,[0,.48,-.1]);
    addMesh(bench,new T.BoxGeometry(.12,1.0,.12),metal,[-.8,.48,0]);addMesh(bench,new T.BoxGeometry(.12,1.0,.12),metal,[.8,.48,0]);
  }

  function buildMower(){
    mower=new T.Group();scene.add(mower);
    mowerBody=new T.Group();mower.add(mowerBody);

    const paintTex=makePaintTexture(),paintNormal=makeGrassNormal(256);paintNormal.repeat.set(2,2);
    const orange=new T.MeshPhysicalMaterial({map:paintTex,normalMap:paintNormal,normalScale:new T.Vector2(.12,.12),roughness:.3,metalness:.16,clearcoat:.82,clearcoatRoughness:.2});
    const orangeDark=new T.MeshPhysicalMaterial({color:0xa9440d,roughness:.36,metalness:.2,clearcoat:.6,clearcoatRoughness:.25});
    const black=mat(0x151817,.7,.04),rubber=mat(0x111311,.96,0),metal=mat(0x4d5352,.26,.62),silver=mat(0xb9bdba,.24,.7);

    addMesh(mowerBody,new T.CylinderGeometry(1.18,1.24,.24,44),orangeDark,[0,.29,.03],[0,0,0],[1.12,1,1],true,true);
    addMesh(mowerBody,new T.CylinderGeometry(1.02,1.08,.08,44),black,[0,.41,.03],[0,0,0],[1.12,1,1],true,true);
    addMesh(mowerBody,new T.BoxGeometry(.78,.14,.54),black,[1.5,.31,.12],[0,0,-.12],[1,1,1],true,true);
    addMesh(mowerBody,new T.BoxGeometry(1.35,.3,1.75),metal,[0,.57,.25],[0,0,0],[1,1,1],true,true);

    const sh=new T.Shape();sh.moveTo(-.72,-.44);sh.lineTo(.72,-.44);sh.lineTo(.7,.35);sh.lineTo(.46,.62);sh.lineTo(-.44,.62);sh.lineTo(-.7,.36);sh.closePath();
    const hoodGeo=new T.ExtrudeGeometry(sh,{depth:1.2,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.07,bevelThickness:.07});hoodGeo.center();
    addMesh(mowerBody,hoodGeo,orange,[0,.96,-.74],[0,0,0],[1,1,1],true,true);
    addMesh(mowerBody,new T.BoxGeometry(.93,.04,1.18),black,[0,1.29,-.74],[0,0,0],[1,1,1],true,true);
    for(let i=-3;i<=3;i++)addMesh(mowerBody,new T.BoxGeometry(.055,.028,.48),black,[i*.125,1.33,-.8],[0,0,0],[1,1,1],false,false);

    const lamp=mat(0xffe7a3,.2,.2,{emissive:0xffd67a,emissiveIntensity:1.0});
    addMesh(mowerBody,new T.BoxGeometry(.28,.17,.06),lamp,[-.42,.94,-1.35],[0,0,0],[1,1,1],false,false);
    addMesh(mowerBody,new T.BoxGeometry(.28,.17,.06),lamp,[.42,.94,-1.35],[0,0,0],[1,1,1],false,false);

    addMesh(mowerBody,new T.CapsuleGeometry(.42,.18,6,12),black,[0,1.2,.55],[Math.PI/2,0,0],[1.15,.72,1.1],true,true);
    addMesh(mowerBody,new T.CapsuleGeometry(.43,.22,6,12),black,[0,1.56,.83],[-.2,0,0],[1.1,1.28,.72],true,true);

    addMesh(mowerBody,new T.CylinderGeometry(.038,.045,.86,10),metal,[0,1.29,-.12],[.58,0,0],[1,1,1],true,true);
    addMesh(mowerBody,new T.TorusGeometry(.31,.04,10,30),black,[0,1.63,-.39],[Math.PI/2-.58,0,0],[1,1,1],true,true);
    addMesh(mowerBody,new T.CylinderGeometry(.026,.026,.3,8),metal,[0,1.63,-.39],[Math.PI/2-.58,0,0],[1,1,1],true,true);
    addMesh(mowerBody,new T.CylinderGeometry(.055,.07,.72,12),metal,[.65,1.25,-.48],[0,0,0],[1,1,1],true,true);
    addMesh(mowerBody,new T.CylinderGeometry(.075,.075,.24,12),black,[.65,1.58,-.48],[0,0,0],[1,1,1],true,true);

    addMesh(mowerBody,new T.CylinderGeometry(.05,.06,.72,10),metal,[-.58,1.38,-.18],[0,0,0],[1,1,1],true,true);
    addMesh(mowerBody,new T.CylinderGeometry(.09,.07,.3,10),black,[-.58,1.78,-.18],[0,0,0],[1,1,1],true,true);

    const decal=roundedRectTexture('PRO 500','#1c211f','#f2f0e8',512,150);
    addMesh(mowerBody,new T.PlaneGeometry(.9,.26),new T.MeshBasicMaterial({map:decal,transparent:true}),[.73,.93,-.72],[0,-Math.PI/2,0],[1,1,1],false,false);

    wheelMeshes=[];
    const makeWheel=(x,z,r,w,front=false)=>{
      const pivot=new T.Group();pivot.position.set(x,r,z);mowerBody.add(pivot);
      const wg=new T.CylinderGeometry(r,r,w,26);wg.rotateZ(Math.PI/2);
      const wheel=addMesh(pivot,wg,rubber,[0,0,0],[0,0,0],[1,1,1],true,true);
      addMesh(pivot,new T.CylinderGeometry(r*.43,r*.43,w+.03,20),silver,[0,0,0],[0,0,Math.PI/2],[1,1,1],true,true);
      for(let a=0;a<Math.PI*2;a+=Math.PI/6){
        addMesh(pivot,new T.BoxGeometry(w+.06,.07,r*.2),rubber,[0,Math.sin(a)*r*.96,Math.cos(a)*r*.96],[a,0,0],[1,1,1],true,true);
      }
      wheelMeshes.push(wheel);
      if(front&&x<0)frontLeftPivot=pivot;if(front&&x>0)frontRightPivot=pivot;
    };
    makeWheel(-.9,.68,.48,.31,false);makeWheel(.9,.68,.48,.31,false);
    makeWheel(-.82,-.88,.34,.23,true);makeWheel(.82,-.88,.34,.23,true);
    makeWheel(-1.17,-.03,.14,.13,false);makeWheel(1.17,-.03,.14,.13,false);

    const shadowTex=(()=>{const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d'),g=x.createRadialGradient(64,64,8,64,64,60);g.addColorStop(0,'rgba(0,0,0,.38)');g.addColorStop(1,'rgba(0,0,0,0)');x.fillStyle=g;x.fillRect(0,0,128,128);const t=new T.CanvasTexture(c);return t;})();
    addMesh(mower,new T.PlaneGeometry(3.6,3.2),new T.MeshBasicMaterial({map:shadowTex,transparent:true,depthWrite:false}),[0,.022,.12],[-Math.PI/2,0,0],[1,1,1],false,false);

    mower.position.set(0,0,11.4);mower.rotation.y=heading;
  }

  function buildParticles(){
    const g=new T.PlaneGeometry(.06,.24),m=new T.MeshBasicMaterial({color:0x6d9c3a,side:T.DoubleSide,transparent:true,opacity:.9});
    for(let i=0;i<68;i++){const p=new T.Mesh(g,m.clone());p.visible=false;p.userData.life=0;p.userData.vel=new T.Vector3();scene.add(p);particles.push(p);}
  }

  function buildGameUI(){
    speedHud=document.createElement('div');speedHud.className='speed-hud hidden';speedHud.innerHTML='<b>0</b><span>MPH</span>';document.body.appendChild(speedHud);
    comboHud=document.createElement('div');comboHud.className='combo-hud hidden';comboHud.innerHTML='<small>STRIPE</small><b>x2</b>';document.body.appendChild(comboHud);
    jobBanner=document.createElement('div');jobBanner.className='job-banner hidden';jobBanner.innerHTML=`<small>ROSSENDALE • V4 LARGE LAWN</small><strong>Oak View Estate</strong><span>Cut 90% • £${BASE_PAY} base pay • long passes pay more</span>`;document.body.appendChild(jobBanner);
  }

  function updateHomeCopy(){
    const strong=document.querySelector('.customer-card strong');
    const span=document.querySelector('.customer-card span');
    const small=document.querySelector('.customer-card small');
    if(strong)strong.textContent='Oak View Estate';
    if(span)span.textContent=`Rossendale • Large lawn • £${BASE_PAY} base pay`;
    if(small)small.textContent='A BIGGER CUSTOMER GARDEN IS READY';
  }

  function countTotal(){
    totalCuttable=0;
    for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){
      const wx=(x+.5)/GW*LW-LW/2,wz=(y+.5)/GH*LH-LH/2;
      if(!blockedCutCell(wx,wz,.04))totalCuttable++;
    }
  }

  function blockedCutCell(x,z,pad=0){
    if(x<-LW/2+.35||x>LW/2-.35||z<-LH/2+.35||z>LH/2-.35)return true;
    return obstacles.some(o=>(x-o.x)**2+(z-o.z)**2<(o.r+pad)**2);
  }

  function blockedDrive(x,z,pad=.82){
    if(x<-DRIVE_X||x>DRIVE_X||z<DRIVE_Z_MIN||z>DRIVE_Z_MAX)return true;
    return obstacles.some(o=>(x-o.x)**2+(z-o.z)**2<(o.r+pad)**2);
  }

  function paintCell(x,y,axis){
    const px=x*4,py=y*4;
    cutMaskCtx.fillStyle='#000';cutMaskCtx.fillRect(px,py,4,4);
    const lane=axis===1?Math.floor(x/5):Math.floor(y/5);
    const light=lane%2===0;
    stripeCtx.fillStyle=light?'rgba(116,184,82,.31)':'rgba(14,73,32,.25)';
    stripeCtx.fillRect(px,py,4,4);
    if((axis===1&&x%5===0)||(axis===2&&y%5===0)){
      stripeCtx.fillStyle='rgba(255,255,255,.035)';stripeCtx.fillRect(px,py,axis===1?1:4,axis===2?1:4);
    }
  }

  function setCellCut(cell,axis){
    if(lawnState[cell])return false;
    lawnState[cell]=axis;cutCount++;
    const x=cell%GW,y=Math.floor(cell/GW);paintCell(x,y,axis);
    const ids=cellBlades[cell];
    for(const id of ids){
      const b=bladeMeta[id];if(b.cut)continue;b.cut=true;
      tmp.position.set(b.x,.01,b.z);tmp.rotation.set(0,b.rot,0);tmp.scale.set(1,.055,1);tmp.updateMatrix();grassMesh.setMatrixAt(id,tmp.matrix);
    }
    return true;
  }

  function cutGrass(dt){
    const deck=1.75+save.deck*.26,r=deck*.55;
    const gx=Math.floor((mower.position.x/LW+.5)*GW),gy=Math.floor((mower.position.z/LH+.5)*GH);
    if(gx<0||gx>=GW||gy<0||gy>=GH)return;
    const rx=Math.ceil(r/(LW/GW))+1,ry=Math.ceil(r/(LH/GH))+1;
    const axis=Math.abs(Math.cos(heading))>.707?1:2;
    let fresh=0;
    for(let y=Math.max(0,gy-ry);y<=Math.min(GH-1,gy+ry);y++){
      for(let x=Math.max(0,gx-rx);x<=Math.min(GW-1,gx+rx);x++){
        const wx=(x+.5)/GW*LW-LW/2,wz=(y+.5)/GH*LH-LH/2;
        if((wx-mower.position.x)**2+(wz-mower.position.z)**2<=r*r&&!blockedCutCell(wx,wz,.02)){
          if(setCellCut(y*GW+x,axis))fresh++;
        }
      }
    }
    if(fresh){
      grassMesh.instanceMatrix.needsUpdate=true;
      const straight=Math.abs(steer)<.18&&Math.abs(speed)>2.15;
      if(straight){
        if(lastStripeAxis===axis)straightTime+=dt;else{lastStripeAxis=axis;straightTime=.18;}
        combo=Math.min(10,1+Math.floor(straightTime/1.0));
        if(combo>=2){bonus+=fresh*.04*combo;showCombo(combo);}
      }else{straightTime=Math.max(0,straightTime-dt*1.6);combo=0;}
      if(performance.now()-lastTextureUpdate>34){
        cutMaskTex.needsUpdate=true;stripeTex.needsUpdate=true;lastTextureUpdate=performance.now();
      }
      spray(Math.min(10,2+Math.floor(fresh/3)));updateHud();
    }
  }

  function resetGrass(){
    lawnState.fill(0);cutCount=0;bonus=0;straightTime=0;combo=0;lastStripeAxis=0;
    cutMaskCtx.fillStyle='#fff';cutMaskCtx.fillRect(0,0,cutMaskCanvas.width,cutMaskCanvas.height);
    stripeCtx.clearRect(0,0,stripeCanvas.width,stripeCanvas.height);
    cutMaskTex.needsUpdate=true;stripeTex.needsUpdate=true;
    bladeMeta.forEach((b,id)=>{b.cut=false;tmp.position.set(b.x,.012,b.z);tmp.rotation.set(0,b.rot,0);tmp.scale.set(1,b.height,1);tmp.updateMatrix();grassMesh.setMatrixAt(id,tmp.matrix);});
    grassMesh.instanceMatrix.needsUpdate=true;updateHud();
  }

  function spray(n){
    const side=new T.Vector3(Math.cos(heading),0,-Math.sin(heading));
    const back=new T.Vector3(Math.sin(heading),0,Math.cos(heading));
    for(let j=0;j<n;j++){
      const p=particles[particleCursor++%particles.length];p.visible=true;p.userData.life=.48+Math.random()*.45;
      p.position.copy(mower.position).addScaledVector(side,1.2).add(new T.Vector3(0,.38,0));
      p.userData.vel.copy(side).multiplyScalar(1.9+Math.random()*2.7).addScaledVector(back,(Math.random()-.5)*1.8);p.userData.vel.y=.9+Math.random()*1.8;
      p.rotation.set(Math.random()*3,Math.random()*3,Math.random()*3);p.scale.setScalar(.7+Math.random()*.8);
    }
  }

  let comboTimer;
  function showCombo(c){
    comboHud.querySelector('b').textContent=`x${c}`;comboHud.classList.remove('hidden');
    clearTimeout(comboTimer);comboTimer=setTimeout(()=>comboHud.classList.add('hidden'),620);
  }

  function updateHud(){
    const p=Math.min(100,cutCount/Math.max(1,totalCuttable)*100);
    $('progressFill').style.width=`${p}%`;$('progressText').textContent=`${Math.floor(p)}%`;
    if(p>=90&&running&&!finished)finish();
  }

  function startJob(){
    hideScreens();$('topbar').classList.remove('hidden');$('touchControls').classList.remove('hidden');speedHud.classList.remove('hidden');
    resetGrass();speed=0;steer=0;heading=Math.PI;mower.position.set(0,0,11.4);mower.rotation.y=heading;finished=false;running=true;paused=false;startEngine();
    jobBanner.classList.remove('hidden');setTimeout(()=>jobBanner.classList.add('hidden'),3000);
  }

  function finish(){
    if(finished)return;finished=true;running=false;speed=0;stopEngine();
    cutMaskTex.needsUpdate=true;stripeTex.needsUpdate=true;
    const p=Math.round(cutCount/totalCuttable*100),b=Math.min(140,Math.round(bonus)),total=BASE_PAY+b;
    save.balance+=total;persist();
    $('resultProgress').textContent=`${p}%`;$('resultBonus').textContent=`£${b}`;$('resultTotal').textContent=`£${total}`;
    const baseRow=$('resultProgress')?.closest('.results')?.children?.[1]?.querySelector('strong');if(baseRow)baseRow.textContent=`£${BASE_PAY}`;
    $('topbar').classList.add('hidden');$('touchControls').classList.add('hidden');speedHud.classList.add('hidden');comboHud.classList.add('hidden');show('completeScreen');
  }

  function quit(){
    running=false;paused=false;speed=0;finished=false;stopEngine();$('topbar').classList.add('hidden');$('touchControls').classList.add('hidden');speedHud.classList.add('hidden');comboHud.classList.add('hidden');show('homeScreen');
  }

  function togglePause(){
    if(!running)return;paused=!paused;
    if(paused){speed=0;stopEngine();show('pauseScreen');}
    else{hideScreens();startEngine();}
  }

  function startEngine(){
    try{
      if(!audioCtx)audioCtx=new (window.AudioContext||window.webkitAudioContext)();
      if(audioCtx.state==='suspended')audioCtx.resume();if(engineOsc)return;
      engineOsc=audioCtx.createOscillator();engineOsc2=audioCtx.createOscillator();engineGain=audioCtx.createGain();engineGain2=audioCtx.createGain();
      engineOsc.type='sawtooth';engineOsc2.type='square';engineOsc.frequency.value=45;engineOsc2.frequency.value=22;engineGain.gain.value=.013;engineGain2.gain.value=.0055;
      engineOsc.connect(engineGain).connect(audioCtx.destination);engineOsc2.connect(engineGain2).connect(audioCtx.destination);engineOsc.start();engineOsc2.start();
    }catch{}
  }

  function stopEngine(){
    [engineOsc,engineOsc2].forEach(o=>{if(o)try{o.stop()}catch{}});
    engineOsc=engineOsc2=engineGain=engineGain2=null;
  }

  function updateMower(dt){
    const max=6.0+save.engine*.8,reverse=2.8+save.engine*.28,accel=5.0+save.engine*.45,brake=8.0,turn=1.55+save.handling*.19;
    if(keys.forward)speed+=accel*dt;
    else if(keys.back){if(speed>.3)speed-=brake*dt;else speed-=accel*.74*dt;}
    else speed*=Math.pow(.14,dt);
    speed=T.MathUtils.clamp(speed,-reverse,max);

    const target=(keys.left?1:0)-(keys.right?1:0);
    steer=T.MathUtils.lerp(steer,target,1-Math.pow(.003,dt));
    if(!keys.left&&!keys.right)steer=T.MathUtils.lerp(steer,0,1-Math.pow(.012,dt));
    const speedNorm=Math.min(1,Math.abs(speed)/max);
    heading+=steer*turn*dt*(.3+speedNorm*.7)*(speed>=0?1:-1);mower.rotation.y=heading;

    const nx=mower.position.x-Math.sin(heading)*speed*dt,nz=mower.position.z-Math.cos(heading)*speed*dt;
    if(!blockedDrive(nx,nz,.86)){mower.position.x=nx;mower.position.z=nz;}else speed*=-.1;

    const wheelSpin=speed*dt*2.2;wheelMeshes.forEach(w=>w.rotation.x-=wheelSpin);
    if(frontLeftPivot)frontLeftPivot.rotation.y=steer*.42;if(frontRightPivot)frontRightPivot.rotation.y=steer*.42;
    mowerBody.rotation.z=T.MathUtils.lerp(mowerBody.rotation.z,-steer*speedNorm*.045,1-Math.pow(.03,dt));
    mowerBody.rotation.x=T.MathUtils.lerp(mowerBody.rotation.x,keys.forward?-.01:keys.back?.016:0,1-Math.pow(.03,dt));
    mowerBody.position.y=.01+Math.sin(performance.now()*.017)*.007*speedNorm;

    if(Math.abs(speed)>.3)cutGrass(dt);
    speedHud.querySelector('b').textContent=(Math.abs(speed)*2.237)<1?'0':(Math.abs(speed)*2.237).toFixed(0);
    if(engineOsc&&audioCtx){engineOsc.frequency.setTargetAtTime(45+Math.abs(speed)*12,audioCtx.currentTime,.04);engineOsc2.frequency.setTargetAtTime(22+Math.abs(speed)*5,audioCtx.currentTime,.04);}
  }

  function updateCamera(dt){
    const f=tmpV.set(-Math.sin(heading),0,-Math.cos(heading));
    const speedNorm=Math.min(1,Math.abs(speed)/(6.0+save.engine*.8));
    const side=new T.Vector3(Math.cos(heading),0,-Math.sin(heading));
    const desired=mower.position.clone().addScaledVector(f,-6.7-speedNorm*.9).addScaledVector(side,steer*.34).add(new T.Vector3(0,3.65+speedNorm*.35,0));
    camera.position.lerp(desired,1-Math.pow(.0025,dt));
    camTarget.copy(mower.position).addScaledVector(f,2.7+speedNorm*1.0).add(new T.Vector3(0,.7,0));
    camera.lookAt(camTarget);
    camera.fov=T.MathUtils.lerp(camera.fov,50+speedNorm*5,1-Math.pow(.025,dt));camera.updateProjectionMatrix();
    sun.target.position.copy(mower.position);sun.target.updateMatrixWorld();
  }

  function updateNPCs(dt){
    const now=performance.now()*.001;
    npcs.forEach((n,i)=>{
      const dx=n.root.position.x-mower.position.x,dz=n.root.position.z-mower.position.z,dist=Math.hypot(dx,dz);
      n.react=T.MathUtils.lerp(n.react,dist<4.2?1:0,1-Math.pow(.04,dt));
      const t=now*1.25+n.phase;
      n.lArm.rotation.x=Math.sin(t)*.13-n.react*.5;
      n.rArm.rotation.x=-Math.sin(t)*.12+n.react*.8;
      n.rArm.rotation.z=-.08-n.react*.35;
      n.head.rotation.y=Math.sin(t*.45)*.12;
      n.body.position.y=Math.sin(t*1.1)*.012;
      if(i===0||i===3){
        const drink=Math.max(0,Math.sin(t*.55)-.75)*3.8;
        n.rArm.rotation.x-=drink*.7;n.rArm.rotation.z-=drink*.35;
      }
      if(dist<4.0){
        const away=new T.Vector3(dx,0,dz).normalize().multiplyScalar(dt*1.5);
        n.root.position.add(away);
      }else{
        n.root.position.lerp(n.home,1-Math.pow(.08,dt));
      }
    });
  }

  function updateParticles(dt){
    particles.forEach(p=>{
      if(!p.visible)return;p.userData.life-=dt;if(p.userData.life<=0){p.visible=false;return;}
      p.userData.vel.y-=4.4*dt;p.position.addScaledVector(p.userData.vel,dt);p.rotation.x+=dt*8;p.rotation.z+=dt*5;p.material.opacity=Math.min(.9,p.userData.life*2);
    });
  }

  function animate(){
    requestAnimationFrame(animate);const dt=Math.min(.04,clock.getDelta());
    if(running&&!paused){updateMower(dt);updateCamera(dt);}else if(mower)updateCamera(dt);
    updateNPCs(dt);updateParticles(dt);renderer.render(scene,camera);
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

    $('startBtn').onclick=startJob;
    $('garageBtn').onclick=()=>{refreshMoney();show('garageScreen');};
    $('howBtn').onclick=()=>show('howScreen');
    document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>show('homeScreen'));
    $('pauseBtn').onclick=togglePause;$('resumeBtn').onclick=togglePause;$('quitBtn').onclick=quit;$('homeBtn').onclick=quit;$('playAgainBtn').onclick=startJob;

    document.querySelectorAll('.upgrade').forEach(btn=>btn.onclick=()=>{
      const k=btn.dataset.upgrade,base=+btn.dataset.cost,lvl=save[k]||0,cost=base*(lvl+1);
      if(lvl>=3)return;
      if(save.balance<cost){const b=btn.querySelector('b'),old=b.textContent;b.textContent='NEED MORE £';setTimeout(()=>b.textContent=old,850);return;}
      save.balance-=cost;save[k]=lvl+1;persist();
    });

    addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.45));});
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&running&&!paused)togglePause();});
  }

  init();
  setTimeout(()=>{if($('boot'))$('boot').remove();show('homeScreen');},900);
})();