(() => {
  'use strict';
  const T = THREE, $ = id => document.getElementById(id);
  const screens = ['homeScreen','garageScreen','howScreen','completeScreen','pauseScreen'];
  const keys = {forward:false,back:false,left:false,right:false};
  const LW=44, LH=29, GW=132, GH=88, BASE_PAY=165, SAVE='stripeMowV5Live';
  const obstacles=[], particles=[], blades=[], npcs=[];
  let scene,camera,renderer,clock,mower,mowerBody,frontL,frontR,grassMesh;
  let lawnCanvas,lawnCtx,lawnTex,longCanvas,longCtx,longTex,lawnState,total=0,cut=0;
  let running=false,paused=false,finished=false,speed=0,steer=0,heading=Math.PI,bonus=0,straight=0,lastAxis=0;
  let audioCtx,osc,gain;
  let save={balance:0,engine:0,deck:0,handling:0,audio:true};
  try{save={...save,...JSON.parse(localStorage.getItem(SAVE)||'{}')}}catch{}

  const show=id=>screens.forEach(s=>$(s).classList.toggle('hidden',s!==id));
  const hide=()=>screens.forEach(s=>$(s).classList.add('hidden'));
  const persist=()=>{localStorage.setItem(SAVE,JSON.stringify(save));refreshMoney()};
  const refreshMoney=()=>{
    $('balanceText').textContent=`£${save.balance}`;$('garageBalance').textContent=`£${save.balance}`;
    $('speedBar').style.width=`${52+save.engine*16}%`;$('deckBar').style.width=`${48+save.deck*17}%`;$('handlingBar').style.width=`${55+save.handling*15}%`;
    document.querySelectorAll('.upgrade').forEach(b=>{const k=b.dataset.upgrade,l=save[k]||0,base=+b.dataset.cost;b.classList.toggle('maxed',l>=3);b.querySelector('b').textContent=l>=3?'MAXED':`£${base*(l+1)}`});
  };
  const mat=(c,r=.8,m=0)=>new T.MeshStandardMaterial({color:c,roughness:r,metalness:m});
  const phys=(c,o={})=>new T.MeshPhysicalMaterial({color:c,roughness:.45,metalness:.18,clearcoat:.65,clearcoatRoughness:.2,...o});
  const add=(g,m,p=[0,0,0],r=[0,0,0],s=[1,1,1],cast=true)=>{const x=new T.Mesh(g,m);x.position.set(...p);x.rotation.set(...r);x.scale.set(...s);x.castShadow=cast;x.receiveShadow=true;scene.add(x);return x};
  const noise=(x,y)=>{const n=Math.sin(x*127.1+y*311.7)*43758.5453;return n-Math.floor(n)};
  const blocked=(x,z,p=.15)=>obstacles.some(o=>(x-o.x)**2+(z-o.z)**2<(o.r+p)**2);
  const params=()=>({max:5.9+save.engine*.7,rev:2.6,acc:5.1+save.engine*.4,turn:1.7+save.handling*.2,deck:1.8+save.deck*.23});

  function tile(type){
    const c=document.createElement('canvas');c.width=c.height=512;const g=c.getContext('2d');
    if(type==='grass'){
      g.fillStyle='#4f8c38';g.fillRect(0,0,512,512);
      for(let y=0;y<512;y+=7)for(let x=0;x<512;x+=7){const n=noise(x,y);g.fillStyle=`hsl(${92+n*10} ${40+n*12}% ${27+n*12}%)`;g.fillRect(x,y,8,8)}
      for(let i=0;i<1600;i++){const x=Math.random()*512,y=Math.random()*512,h=4+Math.random()*16;g.strokeStyle=`rgba(210,255,185,${.025+Math.random()*.055})`;g.beginPath();g.moveTo(x,y);g.lineTo(x+Math.random()*4-2,y-h);g.stroke()}
    }else if(type==='brick'){
      g.fillStyle='#d2c9b9';g.fillRect(0,0,512,512);const bw=68,bh=30;
      for(let y=0;y<512;y+=bh){const off=((y/bh|0)%2)*bw/2;for(let x=-off;x<512;x+=bw){const n=noise(x,y);g.fillStyle=`rgb(${174+n*25|0},${84+n*18|0},${60+n*14|0})`;g.fillRect(x+2,y+2,bw-4,bh-4);g.fillStyle='rgba(255,255,255,.05)';g.fillRect(x+2,y+2,bw-4,3)}}
    }else if(type==='pave'){
      g.fillStyle='#bcb3a5';g.fillRect(0,0,512,512);for(let y=0;y<512;y+=86)for(let x=0;x<512;x+=86){const n=noise(x,y);g.fillStyle=`rgb(${184+n*22|0},${178+n*18|0},${165+n*18|0})`;g.fillRect(x+3,y+3,80,80);g.strokeStyle='rgba(70,66,60,.28)';g.strokeRect(x+3,y+3,80,80)}
    }else{
      g.fillStyle='#5b342e';g.fillRect(0,0,512,512);for(let y=0;y<512;y+=28)for(let x=((y/28|0)%2)*20;x<512;x+=40){const n=noise(x,y);g.fillStyle=`hsl(12 35% ${22+n*12}%)`;g.fillRect(x,y,37,26);g.strokeStyle='rgba(0,0,0,.2)';g.strokeRect(x,y,37,26)}
    }
    const t=new T.CanvasTexture(c);t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(type==='grass'?12:4,type==='grass'?8:2);t.anisotropy=8;t.colorSpace=T.SRGBColorSpace;return t;
  }

  function init(){
    scene=new T.Scene();scene.background=new T.Color(0xa9d0e6);scene.fog=new T.Fog(0xa9d0e6,45,105);
    camera=new T.PerspectiveCamera(56,innerWidth/innerHeight,.1,180);camera.position.set(0,6,10);
    renderer=new T.WebGLRenderer({antialias:true,powerPreference:'high-performance'});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.55));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;$('game').appendChild(renderer.domElement);
    clock=new T.Clock();scene.add(new T.HemisphereLight(0xe6f5ff,0x425c38,1.9));const sun=new T.DirectionalLight(0xffefd1,2.55);sun.position.set(-25,36,18);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-38;sun.shadow.camera.right=38;sun.shadow.camera.top=34;sun.shadow.camera.bottom=-34;sun.shadow.bias=-.00025;scene.add(sun);
    buildWorld();buildMower();buildNPCs();buildParticles();bind();refreshMoney();animate();
  }

  function buildWorld(){
    add(new T.BoxGeometry(68,1,56),mat(0x655f4c,1),[0,-.55,1],[],[],false);
    lawnCanvas=document.createElement('canvas');lawnCanvas.width=GW;lawnCanvas.height=GH;lawnCtx=lawnCanvas.getContext('2d',{alpha:false});lawnTex=new T.CanvasTexture(lawnCanvas);lawnTex.colorSpace=T.SRGBColorSpace;lawnTex.magFilter=T.LinearFilter;
    longCanvas=document.createElement('canvas');longCanvas.width=GW;longCanvas.height=GH;longCtx=longCanvas.getContext('2d',{alpha:false});longTex=new T.CanvasTexture(longCanvas);longTex.magFilter=T.LinearFilter;
    const ground=new T.Mesh(new T.PlaneGeometry(LW,LH),new T.MeshStandardMaterial({map:lawnTex,roughness:.92}));ground.rotation.x=-Math.PI/2;ground.position.y=.015;ground.receiveShadow=true;scene.add(ground);
    const overlay=new T.Mesh(new T.PlaneGeometry(LW,LH),new T.MeshStandardMaterial({map:tile('grass'),alphaMap:longTex,transparent:true,depthWrite:false,roughness:.96}));overlay.rotation.x=-Math.PI/2;overlay.position.y=.032;overlay.receiveShadow=true;scene.add(overlay);

    const pave=new T.MeshStandardMaterial({map:tile('pave'),roughness:.95});add(new T.BoxGeometry(18,.18,5.8),pave,[0,.05,17.2],[],[],false);add(new T.BoxGeometry(7.6,.13,18),pave,[-18,.03,5],[],[],false);
    const brick=new T.MeshStandardMaterial({map:tile('brick'),roughness:.9});const roof=new T.MeshStandardMaterial({map:tile('roof'),roughness:.9});const render=mat(0xd9d3c8,.95);
    add(new T.BoxGeometry(22,8.5,8.5),brick,[1,4.2,24]);add(new T.BoxGeometry(9,6.4,7.8),render,[-15,3.2,23.8]);
    add(new T.BoxGeometry(23.4,1,5.2),roof,[1,8.85,22.2],[-.56,0,0]);add(new T.BoxGeometry(23.4,1,5.2),roof,[1,8.85,25.8],[.56,0,0]);
    add(new T.BoxGeometry(10,.8,4.2),roof,[-15,6.75,22.5],[-.46,0,0]);add(new T.BoxGeometry(10,.8,4.2),roof,[-15,6.75,25.1],[.46,0,0]);
    const glass=phys(0x82b4d1,{roughness:.08,metalness:0,clearcoat:.7});for(const x of [-6,1,8])add(new T.BoxGeometry(3.2,2.5,.16),glass,[x,4.6,19.68],[],[],false);add(new T.BoxGeometry(2.3,4.2,.18),mat(0x274b31,.7),[12.3,2.15,19.68]);add(new T.BoxGeometry(5.6,4.7,.18),mat(0xf0efea,.8),[-15,2.45,19.86]);

    const wood=mat(0x8f613b,.96);for(let x=-23;x<=23;x+=1.7){add(new T.BoxGeometry(.2,2,.2),wood,[x,1,-15.4]);add(new T.BoxGeometry(.2,2,.2),wood,[x,1,15])}for(let z=-14.8;z<=14.8;z+=1.7){add(new T.BoxGeometry(.2,2,.2),wood,[-23,1,z]);add(new T.BoxGeometry(.2,2,.2),wood,[23,1,z])}
    add(new T.BoxGeometry(46,.15,.15),wood,[0,.7,-15.4]);add(new T.BoxGeometry(46,.15,.15),wood,[0,1.35,-15.4]);add(new T.BoxGeometry(46,.15,.15),wood,[0,.7,15]);add(new T.BoxGeometry(46,.15,.15),wood,[0,1.35,15]);
    const hedge=mat(0x2f642c,.98);for(let x=-22.4;x<=22.4;x+=1.5){const h=add(new T.SphereGeometry(.9,8,7),hedge,[x,.9,-14.8],[],[1.05,1.18,.92]);obstacles.push({x,z:-14.4,r:.78})}for(let z=-13.6;z<=13.8;z+=1.5){add(new T.SphereGeometry(.9,8,7),hedge,[-22.4,.9,z],[],[.92,1.18,1.04]);add(new T.SphereGeometry(.9,8,7),hedge,[22.4,.9,z],[],[.92,1.18,1.04]);obstacles.push({x:-22,z,r:.78},{x:22,z,r:.78})}

    function tree(x,z,s=1){add(new T.CylinderGeometry(.32*s,.5*s,4.6*s,10),mat(0x64442b,1),[x,2.2*s,z]);for(const [ox,oy,oz,r] of [[0,5,0,2],[1,4.8,.5,1.35],[-1,4.7,-.4,1.4],[.2,5.9,-.5,1.25]])add(new T.IcosahedronGeometry(r*s,1),mat(0x356f32,.98),[x+ox*s,oy*s,z+oz*s]);obstacles.push({x,z,r:2*s})}
    tree(-14,-7,1.05);tree(16,-8,.95);tree(-15,8,.9);
    add(new T.CylinderGeometry(2.7,2.7,.3,32),mat(0x887d6c,1),[10.8,.12,7]);add(new T.CylinderGeometry(2.35,2.35,.34,32),mat(0x4f3424,1),[10.8,.2,7]);obstacles.push({x:10.8,z:7,r:2.7});
    const flowers=[0xff6c89,0xffd45b,0xbf70ef,0xffffff];for(let i=0;i<36;i++){const a=Math.random()*Math.PI*2,r=Math.sqrt(Math.random())*1.9,x=10.8+Math.cos(a)*r,z=7+Math.sin(a)*r;add(new T.CylinderGeometry(.02,.025,.45,5),mat(0x3f7b38,1),[x,.55,z],[],[],false);add(new T.SphereGeometry(.1,6,5),mat(flowers[i%4],.85),[x,.8,z],[],[],false)}
    add(new T.BoxGeometry(5.6,3.9,4.2),wood,[16.5,1.95,-10]);add(new T.ConeGeometry(4,1.8,4),roof,[16.5,4.55,-10],[0,Math.PI/4,0]);obstacles.push({x:16.5,z:-10,r:3});

    const tramp=new T.Group();tramp.position.set(-9.5,0,8.7);scene.add(tramp);const ring=new T.Mesh(new T.TorusGeometry(2.1,.08,8,24),mat(0x4b5b67,.55,.3));ring.rotation.x=Math.PI/2;ring.position.y=.8;tramp.add(ring);const tm=new T.Mesh(new T.CylinderGeometry(2,2,.08,24),mat(0x14191e,.9));tm.position.y=.8;tramp.add(tm);for(let i=0;i<6;i++){const a=i/6*Math.PI*2,p=new T.Mesh(new T.CylinderGeometry(.035,.035,2.5,6),mat(0x596873,.55,.25));p.position.set(Math.cos(a)*2.05,2.05,Math.sin(a)*2.05);tramp.add(p)}obstacles.push({x:-9.5,z:8.7,r:2.4});

    const table=add(new T.CylinderGeometry(1.05,1.05,.08,22),mat(0x605042,.7),[4.4,.72,17.1]);add(new T.CylinderGeometry(.08,.1,.7,8),mat(0x343434,.5,.35),[4.4,.36,17.1]);for(const p of [[3,16.1],[5.8,16.1],[4.4,18.7]]){add(new T.BoxGeometry(.75,.1,.7),mat(0x6e7776,.9),[p[0],.52,p[1]]);add(new T.BoxGeometry(.75,.7,.1),mat(0x6e7776,.9),[p[0],.9,p[1]+.32])}

    add(new T.BoxGeometry(68,.14,7.5),mat(0x4b4e51,.97),[0,.03,-22.4],[],[],false);for(let x=-30;x<=30;x+=5)add(new T.BoxGeometry(2.4,.02,.14),mat(0xd9d6bc,1),[x,.12,-22.4],[],[],false);
    vehicle(-14,-22.2,0xf2f2f2,.95);vehicle(13,-22.2,0x249c55,1.1,true);
    buildBlades();resetLawn();
  }

  function vehicle(x,z,color,s=1,taco=false){const g=new T.Group();g.position.set(x,0,z);g.scale.setScalar(s);scene.add(g);const body=new T.Mesh(new T.BoxGeometry(4.8,1.35,2.2),phys(color));body.position.y=1.15;body.castShadow=true;g.add(body);const cab=new T.Mesh(new T.BoxGeometry(2,1.25,1.95),phys(color));cab.position.set(-.9,2.05,0);cab.castShadow=true;g.add(cab);const wind=new T.Mesh(new T.BoxGeometry(1.45,.72,1.86),phys(0x7ca8c8,{roughness:.08,metalness:0}));wind.position.set(-.85,2.12,0);g.add(wind);const wg=new T.CylinderGeometry(.5,.5,.4,16);wg.rotateZ(Math.PI/2);for(const [wx,wz] of [[-1.55,-1.12],[1.55,-1.12],[-1.55,1.12],[1.55,1.12]]){const w=new T.Mesh(wg,mat(0x181818,.95));w.position.set(wx,.5,wz);g.add(w)}if(taco){const hatch=new T.Mesh(new T.BoxGeometry(2.8,.9,.08),mat(0xf1ecdf,.95));hatch.position.set(.3,1.55,1.18);hatch.rotation.x=-1.05;g.add(hatch);const sign=new T.Mesh(new T.BoxGeometry(2.7,.55,.08),mat(0xe9b93a,.75));sign.position.set(.25,2.45,1.15);g.add(sign)}}

  function buildBlades(){
    const count=innerWidth<700?2100:3200,geo=new T.PlaneGeometry(.22,.72),c=document.createElement('canvas');c.width=32;c.height=128;const q=c.getContext('2d');const gr=q.createLinearGradient(0,0,0,128);gr.addColorStop(0,'rgba(210,255,180,0)');gr.addColorStop(.08,'rgba(210,255,180,.95)');gr.addColorStop(1,'rgba(45,103,31,.98)');q.fillStyle=gr;q.beginPath();q.moveTo(16,0);q.quadraticCurveTo(28,44,22,82);q.lineTo(17,128);q.lineTo(10,82);q.quadraticCurveTo(4,44,16,0);q.fill();const a=new T.CanvasTexture(c);grassMesh=new T.InstancedMesh(geo,new T.MeshStandardMaterial({color:0x5c9e3f,alphaMap:a,transparent:true,side:T.DoubleSide,depthWrite:false,roughness:.98}),count);scene.add(grassMesh);const d=new T.Object3D();for(let i=0;i<count;i++){let x,z,n=0;do{x=(Math.random()-.5)*(LW-2);z=(Math.random()-.5)*(LH-2);n++}while(blocked(x,z,.5)&&n<12);const s=.75+Math.random()*.9,r=Math.random()*Math.PI*2;blades.push({x,z,s,r,cut:false});d.position.set(x,.36,z);d.rotation.set(0,r,0);d.scale.set(s,s,s);d.updateMatrix();grassMesh.setMatrixAt(i,d.matrix)}grassMesh.instanceMatrix.needsUpdate=true;
  }
  function refreshBlades(){const d=new T.Object3D();for(let i=0;i<blades.length;i++){const b=blades[i];d.position.set(b.x,b.cut?.05:.36,b.z);d.rotation.set(0,b.r,0);d.scale.set(b.s,b.cut?.08:b.s,b.s);d.updateMatrix();grassMesh.setMatrixAt(i,d.matrix)}grassMesh.instanceMatrix.needsUpdate=true}

  function resetLawn(){lawnState=new Uint8Array(GW*GH);cut=0;total=0;for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){const wx=(x/(GW-1)-.5)*LW,wz=(y/(GH-1)-.5)*LH;if(!blocked(wx,wz,.12))total++}blades.forEach(b=>b.cut=false);drawLawn();refreshBlades()}
  function drawLawn(){const a=lawnCtx.createImageData(GW,GH),b=longCtx.createImageData(GW,GH);for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){const i=y*GW+x,p=i*4,wx=(x/(GW-1)-.5)*LW,wz=(y/(GH-1)-.5)*LH,st=lawnState[i],n=(noise(x*2.1,y*2.3)-.5)*18,blk=blocked(wx,wz,.12);let r=62+n,g=117+n,bb=48+n*.4;if(st===1){r=82+n;g=148+n;bb=63+n*.35}else if(st===2){r=51+n;g=108+n;bb=45+n*.3}if(blk){r=82;g=78;bb=65}a.data[p]=r;a.data[p+1]=g;a.data[p+2]=bb;a.data[p+3]=255;const alpha=!blk&&st===0?255:0;b.data[p]=b.data[p+1]=b.data[p+2]=alpha;b.data[p+3]=255}lawnCtx.putImageData(a,0,0);longCtx.putImageData(b,0,0);lawnTex.needsUpdate=true;longTex.needsUpdate=true}

  function buildMower(){
    mower=new T.Group();scene.add(mower);mowerBody=new T.Group();mower.add(mowerBody);const orange=phys(0xf37822),orange2=phys(0xc95b18),dark=mat(0x17191b,.86),metal=mat(0x484d52,.45,.45);
    const deck=new T.Mesh(new T.CylinderGeometry(1.32,1.46,.26,28),orange2);deck.scale.set(1.12,1,1);deck.position.set(0,.4,.12);deck.castShadow=true;mowerBody.add(deck);const body=new T.Mesh(new T.BoxGeometry(1.9,.28,1.5),orange);body.position.set(0,.68,.12);body.castShadow=true;mowerBody.add(body);const hood=new T.Mesh(new T.BoxGeometry(1.34,.72,1.16),orange);hood.position.set(0,1,-.48);hood.castShadow=true;mowerBody.add(hood);const grille=new T.Mesh(new T.BoxGeometry(.9,.32,.08),dark);grille.position.set(0,1,-1.07);mowerBody.add(grille);const seat=new T.Mesh(new T.BoxGeometry(.82,.22,.62),dark);seat.position.set(0,1.2,.62);mowerBody.add(seat);const back=new T.Mesh(new T.BoxGeometry(.82,.74,.15),dark);back.position.set(0,1.54,.9);back.rotation.x=-.13;mowerBody.add(back);const col=new T.Mesh(new T.CylinderGeometry(.035,.05,.78,10),metal);col.position.set(0,1.32,-.05);col.rotation.x=.5;mowerBody.add(col);const sw=new T.Mesh(new T.TorusGeometry(.23,.035,8,18),dark);sw.position.set(0,1.64,-.18);sw.rotation.x=1.08;mowerBody.add(sw);for(const x of [-.53,.53]){const bar=new T.Mesh(new T.CylinderGeometry(.045,.045,1.45,8),metal);bar.position.set(x,1.73,.98);mowerBody.add(bar)}const top=new T.Mesh(new T.CylinderGeometry(.045,.045,1.06,8),metal);top.position.set(0,2.4,.98);top.rotation.z=Math.PI/2;mowerBody.add(top);const chute=new T.Mesh(new T.BoxGeometry(.8,.15,.48),dark);chute.position.set(1.42,.43,.12);chute.rotation.z=-.16;mowerBody.add(chute);
    const wg=new T.CylinderGeometry(.36,.36,.26,20);wg.rotateZ(Math.PI/2);function wheel(x,z,r){const g=new T.Group();g.position.set(x,.42,z);mowerBody.add(g);const w=new T.Mesh(wg,dark);w.scale.set(r/.36,r/.36,r/.36);w.castShadow=true;g.add(w);return g}wheel(-.92,.64,.4);wheel(.92,.64,.4);frontL=wheel(-.86,-.68,.31);frontR=wheel(.86,-.68,.31);mower.position.set(0,0,10.2);mower.rotation.y=heading;
  }

  function buildNPCs(){function npc(x,z,c,hat=false){const g=new T.Group();g.position.set(x,0,z);scene.add(g);const skin=mat(0xb77752,.94),shirt=mat(c,.9),pants=mat(0x283343,.95);const body=new T.Mesh(new T.CapsuleGeometry(.32,.66,4,8),shirt);body.position.y=1.45;g.add(body);const head=new T.Mesh(new T.SphereGeometry(.24,12,10),skin);head.position.y=2.12;g.add(head);for(const [sx,side] of [[-.4,1],[.4,-1]]){const a=new T.Mesh(new T.CapsuleGeometry(.075,.52,4,6),skin);a.position.set(sx,1.4,0);a.rotation.z=.18*side;g.add(a)}for(const sx of [-.14,.14]){const l=new T.Mesh(new T.CapsuleGeometry(.09,.7,4,6),pants);l.position.set(sx,.46,0);g.add(l)}if(hat){const brim=new T.Mesh(new T.CylinderGeometry(.31,.31,.04,16),mat(0xd2b26c,1));brim.position.y=2.32;g.add(brim);const crown=new T.Mesh(new T.CylinderGeometry(.18,.2,.16,14),mat(0xd7ba75,1));crown.position.y=2.42;g.add(crown)}npcs.push({g,home:new T.Vector3(x,0,z),phase:Math.random()*6.2})}npc(14,-12,0x2c944a,true);npc(17,-12.2,0x7443b0,false);npc(20,-12,0xcf6d20,false)}
  function updateNPCs(t){for(const n of npcs){const d=n.g.position.distanceTo(mower.position);if(d<2.7){const dir=n.g.position.clone().sub(mower.position).setY(0).normalize();n.g.position.addScaledVector(dir,.035)}else{n.g.position.x=n.home.x+Math.sin(t*.001+n.phase)*.12;n.g.position.z=n.home.z+Math.cos(t*.0012+n.phase)*.08}n.g.rotation.y=Math.sin(t*.001+n.phase)*.2}}

  function buildParticles(){for(let i=0;i<42;i++){const p=new T.Mesh(new T.BoxGeometry(.06,.025,.16),mat(0x6ca83e,.9));p.visible=false;p.userData.vel=new T.Vector3();p.userData.life=0;scene.add(p);particles.push(p)}}
  let pc=0;function spray(n){const side=new T.Vector3(Math.cos(heading),0,-Math.sin(heading)),back=new T.Vector3(Math.sin(heading),0,Math.cos(heading));for(let i=0;i<n;i++){const p=particles[pc++%particles.length];p.visible=true;p.userData.life=.5+Math.random()*.4;p.position.copy(mower.position).addScaledVector(side,1.1).add(new T.Vector3(0,.45,0));p.userData.vel.copy(side).multiplyScalar(2+Math.random()*2).addScaledVector(back,(Math.random()-.5)*1.6);p.userData.vel.y=1+Math.random()*1.8}}

  function cutGrass(dt){const p=params(),r=p.deck*.54,mx=mower.position.x,mz=mower.position.z,gx=Math.round((mx/LW+.5)*(GW-1)),gy=Math.round((mz/LH+.5)*(GH-1)),rx=Math.ceil(r/(LW/GW))+1,ry=Math.ceil(r/(LH/GH))+1;const axis=Math.abs(Math.cos(heading))>.707?1:2;let fresh=0;for(let y=Math.max(0,gy-ry);y<=Math.min(GH-1,gy+ry);y++)for(let x=Math.max(0,gx-rx);x<=Math.min(GW-1,gx+rx);x++){const wx=(x/(GW-1)-.5)*LW,wz=(y/(GH-1)-.5)*LH;if((wx-mx)**2+(wz-mz)**2<=r*r&&!blocked(wx,wz,.08)){const i=y*GW+x;if(!lawnState[i]){lawnState[i]=axis;cut++;fresh++}}}let bc=0;for(const b of blades)if(!b.cut&&(b.x-mx)**2+(b.z-mz)**2<r*r){b.cut=true;bc++}if(fresh||bc){drawLawn();if(bc)refreshBlades();spray(Math.min(8,2+Math.floor((fresh+bc*.2)/5)));if(Math.abs(steer)<.19&&Math.abs(speed)>2.2){if(lastAxis===axis)straight+=dt;else{lastAxis=axis;straight=.2}const combo=Math.min(9,1+Math.floor(straight/1.2));if(combo>=2){bonus+=fresh*.02*combo;$('stripeToast').textContent=`STRIPE x${combo}`;$('stripeToast').classList.remove('hidden');clearTimeout(window.__stripe);window.__stripe=setTimeout(()=>$('stripeToast').classList.add('hidden'),500)}}else straight=Math.max(0,straight-dt);updateHUD()}}
  function updateHUD(){const p=Math.min(100,cut/Math.max(1,total)*100);$('progressFill').style.width=`${p}%`;$('progressText').textContent=`${p|0}%`;if(p>=90&&running)finish()}
  function collision(x,z){if(x<-LW/2+.9||x>LW/2-.9||z<-LH/2+.9||z>LH/2-.9)return true;return obstacles.some(o=>(x-o.x)**2+(z-o.z)**2<(o.r+.9)**2)}
  function updateMower(dt){const p=params();if(keys.forward)speed+=p.acc*dt;else if(keys.back)speed-=p.acc*dt;else{const d=2.9*dt;speed=Math.abs(speed)<=d?0:speed-Math.sign(speed)*d}speed=T.MathUtils.clamp(speed,-p.rev,p.max);const ts=(keys.left?1:0)-(keys.right?1:0);steer=T.MathUtils.lerp(steer,ts,1-Math.pow(.001,dt));if(!keys.left&&!keys.right)steer=T.MathUtils.lerp(steer,0,1-Math.pow(.005,dt));const sn=Math.min(1,Math.abs(speed)/p.max);heading+=steer*p.turn*dt*(.25+sn*.75)*(speed>=0?1:-1);mower.rotation.y=heading;const nx=mower.position.x-Math.sin(heading)*speed*dt,nz=mower.position.z-Math.cos(heading)*speed*dt;if(!collision(nx,nz)){mower.position.x=nx;mower.position.z=nz}else speed*=-.14;frontL.rotation.y=steer*.5;frontR.rotation.y=steer*.5;mowerBody.rotation.z=T.MathUtils.lerp(mowerBody.rotation.z,-steer*.04*sn,.08);mowerBody.position.y=Math.sin(performance.now()*.02)*.008*sn;if(Math.abs(speed)>.35)cutGrass(dt);if(osc&&gain){osc.frequency.setTargetAtTime(52+Math.abs(speed)*12,audioCtx.currentTime,.05);gain.gain.setTargetAtTime(save.audio?.018+.022*sn:0,audioCtx.currentTime,.05)}}
  function updateCam(dt){const f=new T.Vector3(-Math.sin(heading),0,-Math.cos(heading)),d=mower.position.clone().addScaledVector(f,-8.5).add(new T.Vector3(0,5.7,0));camera.position.lerp(d,1-Math.pow(.0025,dt));camera.lookAt(mower.position.clone().addScaledVector(f,2.4).add(new T.Vector3(0,1,0)))}
  function updateParticles(dt){for(const p of particles){if(!p.visible)continue;p.userData.life-=dt;if(p.userData.life<=0){p.visible=false;continue}p.userData.vel.y-=4.7*dt;p.position.addScaledVector(p.userData.vel,dt);p.rotation.x+=dt*7;p.rotation.z+=dt*5}}

  function resetJob(){lawnState.fill(0);cut=0;bonus=0;straight=0;lastAxis=0;blades.forEach(b=>b.cut=false);drawLawn();refreshBlades();mower.position.set(0,0,10.2);heading=Math.PI;mower.rotation.y=heading;speed=steer=0;finished=paused=false;running=true;updateHUD();startAudio()}
  function start(){hide();$('topbar').classList.remove('hidden');$('touchControls').classList.remove('hidden');resetJob()}
  function quit(){running=paused=false;speed=0;stopAudio();$('topbar').classList.add('hidden');$('touchControls').classList.add('hidden');show('homeScreen')}
  function finish(){if(finished)return;finished=true;running=false;speed=0;stopAudio();const pct=Math.round(cut/total*100),b=Math.min(140,Math.round(bonus)),sum=BASE_PAY+b;save.balance+=sum;persist();$('resultProgress').textContent=`${pct}%`;$('resultBonus').textContent=`£${b}`;$('resultTotal').textContent=`£${sum}`;$('topbar').classList.add('hidden');$('touchControls').classList.add('hidden');show('completeScreen')}
  function pause(){if(!running||finished)return;paused=!paused;if(paused){speed=0;stopAudio();show('pauseScreen')}else{hide();startAudio()}}
  function startAudio(){if(!save.audio)return;try{if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume();if(osc)return;osc=audioCtx.createOscillator();gain=audioCtx.createGain();osc.type='sawtooth';osc.frequency.value=52;gain.gain.value=.015;osc.connect(gain).connect(audioCtx.destination);osc.start()}catch{}}
  function stopAudio(){if(osc){try{osc.stop()}catch{}osc=gain=null}}

  function bind(){const map={ArrowUp:'forward',KeyW:'forward',ArrowDown:'back',KeyS:'back',ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right'};addEventListener('keydown',e=>{if(map[e.code]){keys[map[e.code]]=true;e.preventDefault()}if(e.code==='Escape')pause()},{passive:false});addEventListener('keyup',e=>{if(map[e.code]){keys[map[e.code]]=false;e.preventDefault()}},{passive:false});document.querySelectorAll('[data-key]').forEach(b=>{const k=b.dataset.key;b.addEventListener('pointerdown',e=>{e.preventDefault();keys[k]=true;startAudio()});for(const ev of ['pointerup','pointercancel','pointerleave'])b.addEventListener(ev,e=>{e.preventDefault();keys[k]=false})});$('startBtn').onclick=start;$('garageBtn').onclick=()=>{refreshMoney();show('garageScreen')};$('howBtn').onclick=()=>show('howScreen');document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>show('homeScreen'));$('pauseBtn').onclick=pause;$('resumeBtn').onclick=pause;$('quitBtn').onclick=quit;$('homeBtn').onclick=quit;$('playAgainBtn').onclick=start;$('audioToggle').checked=save.audio;$('audioToggle').onchange=e=>{save.audio=e.target.checked;persist();if(!save.audio)stopAudio()};document.querySelectorAll('.upgrade').forEach(b=>b.onclick=()=>{const k=b.dataset.upgrade,l=save[k]||0,c=+b.dataset.cost*(l+1);if(l>=3)return;if(save.balance<c){b.querySelector('b').textContent='NEED MORE £';setTimeout(refreshMoney,800);return}save.balance-=c;save[k]=l+1;persist()});addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.55))});document.addEventListener('visibilitychange',()=>{if(document.hidden&&running&&!paused)pause()})}
  function animate(){requestAnimationFrame(animate);const dt=Math.min(.04,clock.getDelta()),t=performance.now();if(running&&!paused&&!finished)updateMower(dt);if(mower)updateCam(dt);updateParticles(dt);updateNPCs(t);renderer.render(scene,camera)}

  init();
  setTimeout(()=>{if($('boot'))$('boot').remove();show('homeScreen')},700);
})();