'use strict';
const $=s=>document.querySelector(s);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const chf=n=>'CHF '+Math.round(n).toLocaleString('de-CH');
const lv=n=>Math.round(n).toLocaleString('de-CH');
function rng(seed){let s=(seed>>>0)||1;return()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;};}
const store={get(k){try{return JSON.parse(localStorage.getItem(k));}catch(e){return null;}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}};
const SAVE_KEY='laendle-leben-save-v2';
let DATA=null;
const CAT_COL=['#2c52b4','#5d78d6','#8b61c8','#a2aab4','#c41f3a','#d8a221'];
const CAT_SHORT=['Wohnhaus','Wohnhaus mit Nebennutzung','Teilweise Wohnnutzung','Ohne Wohnnutzung','Sonderbau','Provisorische Unterkunft'];
const isRes=c=>c<=2;
const addr=b=>b[5]&&b[5]!=='NULL'?`${DATA.streets[b[4]]} ${b[5]}`:DATA.streets[b[4]];
const place=b=>`${b[6]} ${DATA.gems[b[3]]}`;

function toast(msg){const t=document.createElement('div');t.className='toast';t.textContent=msg;$('#toasts').appendChild(t);setTimeout(()=>t.remove(),4200);while($('#toasts').children.length>4)$('#toasts').firstChild.remove();}

/* =====================================================================
   LANDESKARTE
   ===================================================================== */
const MapV={
  mode:'house',s:.03,cx:0,cy:0,W:0,H:0,dpr:1,sel:-1,hover:-1,dirty:true,home:-1,anim:null,
  init(){
    const c=this.c=$('#mapc');this.ctx=c.getContext('2d');
    const B=DATA.b;let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;
    const gs=DATA.gems.map(()=>({x:0,y:0,n:0}));this.buckets=new Map();this.byCat=[[],[],[],[],[],[]];
    const catN=[0,0,0,0,0,0];
    B.forEach((b,i)=>{x0=Math.min(x0,b[0]);x1=Math.max(x1,b[0]);y0=Math.min(y0,b[1]);y1=Math.max(y1,b[1]);
      const g=gs[b[3]];g.x+=b[0];g.y+=b[1];g.n++;catN[b[2]]++;this.byCat[b[2]].push(i);
      const k=Math.floor(b[0]/100)+','+Math.floor(b[1]/100);let a=this.buckets.get(k);if(!a)this.buckets.set(k,a=[]);a.push(i);});
    this.bounds=[x0,x1,y0,y1];this.gc=gs.map((g,i)=>[g.x/g.n,g.y/g.n,g.n,DATA.gems[i]]);
    $('#legend').innerHTML=DATA.cats.map((c,i)=>`<div><i style="background:${CAT_COL[i]}"></i>${esc(CAT_SHORT[i])}<span>${lv(catN[i])}</span></div>`).join('');
    $('#attr').textContent=`Daten: Gebäude- und Wohnungsregister, Amt für Statistik (Stand ${DATA.stand}) · Amtliche Vermessung und Reliefkarte, Amt für Tiefbau und Geoinformation · swissALTI3D © swisstopo · © OpenStreetMap-Mitwirkende (ODbL) · Fahrplan opentransportdata.swiss · Wetter Open-Meteo.com (CC BY 4.0), Föhnindex MeteoSchweiz · Copernicus DEM.`;
    $('#tstats').innerHTML=`<div><strong>${lv(B.length)}</strong><span>Gebäude</span></div><div><strong>${DATA.gems.length}</strong><span>Gemeinden</span></div><div><strong>${lv(DATA.streets.length)}</strong><span>Strassen</span></div>`;
    this.relief=new Image();this.relief.onload=()=>{this.dirty=true;};this.relief.src='data/relief.png';this.foot=Tiles.foot;
    Tiles.listeners.push(()=>{this.dirty=true;});
    this.layers={oev:true,wander:true,velo:true,kultur:true,pers:false,jobs:false};[['lyOev','oev'],['lyWander','wander'],['lyVelo','velo'],['lyKultur','kultur'],['lyPers','pers'],['lyJobs','jobs']].forEach(([id,k])=>{const el=$('#'+id);if(el)el.onchange=()=>{this.layers[k]=el.checked;this.dirty=true;};});
    this.bindInput();addEventListener('resize',()=>this.resize());this.resize();this.fit(true);
    const loop=t=>{this.tick(t);requestAnimationFrame(loop);};requestAnimationFrame(loop);
  },
  visibleTiles(){const[wx0,wy1]=this.s2w(0,0),[wx1,wy0]=this.s2w(this.W,this.H);const out=[];let req=0;
    for(let E=Math.floor((wx0+O0[0])/1000);E<=Math.floor((wx1+O0[0])/1000);E++)for(let N=Math.floor((wy0+O0[1])/1000);N<=Math.floor((wy1+O0[1])/1000);N++){const id=E+'-'+N;if(!Tiles.ids.has(id))continue;
      const t=Tiles.cache.get(id);if(t)out.push(t);else if(!Tiles.loading.has(id)&&req<8&&Tiles.loading.size<8){Tiles.get(id);req++;}}
    return out;},
  polyR(rings){const g=this.ctx;g.beginPath();for(const p of rings)for(let k=0;k<p.length;k+=2){const sx=(p[k]-this.cx)*this.s+this.W/2,sy=(this.cy-p[k+1])*this.s+this.H/2;k?g.lineTo(sx,sy):g.moveTo(sx,sy);}},
  line(p){const g=this.ctx;g.beginPath();for(let k=0;k<p.length;k+=2){const sx=(p[k]-this.cx)*this.s+this.W/2,sy=(this.cy-p[k+1])*this.s+this.H/2;k?g.lineTo(sx,sy):g.moveTo(sx,sy);}},
  vis(bb){const[a,b]=this.w2s(bb[0],bb[3]),[c,d]=this.w2s(bb[2],bb[1]);return c>0&&a<this.W&&d>0&&b<this.H;},
  poly(p){const g=this.ctx;g.beginPath();for(let k=0;k<p.length;k+=2){const sx=(p[k]-this.cx)*this.s+this.W/2,sy=(this.cy-p[k+1])*this.s+this.H/2;k?g.lineTo(sx,sy):g.moveTo(sx,sy);}g.closePath();},
  resize(){const r=this.c.getBoundingClientRect();this.dpr=Math.min(devicePixelRatio||1,2);this.W=r.width;this.H=r.height;this.c.width=r.width*this.dpr;this.c.height=r.height*this.dpr;this.dirty=true;},
  viewRect(){ // freier Bereich neben dem Panel
    const p=$('#panel').getBoundingClientRect();const narrow=innerWidth<=760;
    return narrow?{x:0,y:0,w:this.W,h:Math.max(200,p.top)}:{x:0,y:0,w:Math.max(200,p.left),h:this.H};
  },
  fit(instant){const[x0,x1,y0,y1]=this.bounds;const v=this.viewRect();const s=Math.min(v.w/((x1-x0)*1.12),v.h/((y1-y0)*1.08));
    const cx=(x0+x1)/2+(this.W/2-(v.x+v.w/2))/s, cy=(y0+y1)/2-(this.H/2-(v.y+v.h/2))/s;this.go(cx,cy,s,instant);},
  go(cx,cy,s,instant){if(instant||matchMedia('(prefers-reduced-motion: reduce)').matches){this.cx=cx;this.cy=cy;this.s=s;this.anim=null;this.dirty=true;return;}
    this.anim={t0:performance.now(),d:700,from:[this.cx,this.cy,Math.log(this.s)],to:[cx,cy,Math.log(s)]};},
  flyTo(i,s){const b=DATA.b[i];const v=this.viewRect();s=s||Math.max(this.s,1.6);
    this.go(b[0]+(this.W/2-(v.x+v.w/2))/s,b[1]-(this.H/2-(v.y+v.h/2))/s,s);},
  w2s(x,y){return[(x-this.cx)*this.s+this.W/2,(this.cy-y)*this.s+this.H/2];},
  s2w(sx,sy){return[(sx-this.W/2)/this.s+this.cx,this.cy-(sy-this.H/2)/this.s];},
  nearest(sx,sy,px){const[wx,wy]=this.s2w(sx,sy);const r=px/this.s;let best=-1,bd=r*r;
    for(let gx=Math.floor((wx-r)/100);gx<=Math.floor((wx+r)/100);gx++)for(let gy=Math.floor((wy-r)/100);gy<=Math.floor((wy+r)/100);gy++){
      const a=this.buckets.get(gx+','+gy);if(!a)continue;for(const i of a){const b=DATA.b[i];const d=(b[0]-wx)**2+(b[1]-wy)**2;if(d<bd){bd=d;best=i;}}}
    return best;},
  zoomAt(f,sx,sy){const[wx,wy]=this.s2w(sx,sy);this.s=clamp(this.s*f,.012,14);this.cx=wx-(sx-this.W/2)/this.s;this.cy=wy+(sy-this.H/2)/this.s;this.anim=null;this.dirty=true;},
  bindInput(){
    const c=this.c,pts=new Map();let down=null,moved=0,pinch=null;
    c.addEventListener('pointerdown',e=>{c.setPointerCapture(e.pointerId);pts.set(e.pointerId,[e.clientX,e.clientY]);moved=0;down=[e.clientX,e.clientY];this.anim=null;
      if(pts.size===2){const p=[...pts.values()];pinch={d:Math.hypot(p[0][0]-p[1][0],p[0][1]-p[1][1])};}});
    c.addEventListener('pointermove',e=>{const r=c.getBoundingClientRect();const sx=e.clientX-r.left,sy=e.clientY-r.top;
      const[wx,wy]=this.s2w(sx,sy);$('#coord').textContent=`LV95  E ${lv(wx+DATA.origin[0])}  N ${lv(wy+DATA.origin[1])}`;
      if(pts.has(e.pointerId)){const prev=pts.get(e.pointerId);pts.set(e.pointerId,[e.clientX,e.clientY]);
        if(pts.size===2&&pinch){const p=[...pts.values()];const d=Math.hypot(p[0][0]-p[1][0],p[0][1]-p[1][1]);const mx=(p[0][0]+p[1][0])/2-r.left,my=(p[0][1]+p[1][1])/2-r.top;this.zoomAt(d/pinch.d,mx,my);pinch.d=d;moved=99;return;}
        const dx=e.clientX-prev[0],dy=e.clientY-prev[1];moved+=Math.abs(dx)+Math.abs(dy);if(moved>4){this.cx-=dx/this.s;this.cy+=dy/this.s;this.dirty=true;}
      }else if(e.pointerType==='mouse'){const h=this.nearest(sx,sy,9);if(h!==this.hover){this.hover=h;this.dirty=true;}
        const tip=$('#mapTip');if(h>=0){const b=DATA.b[h];tip.hidden=false;tip.textContent=`${addr(b)}, ${DATA.gems[b[3]]} · ${CAT_SHORT[b[2]]}`;tip.style.left=sx+'px';tip.style.top=sy+'px';}else tip.hidden=true;}
    });
    const up=e=>{if(!pts.has(e.pointerId))return;pts.delete(e.pointerId);if(pts.size<2)pinch=null;
      if(moved<=4&&pts.size===0){const r=c.getBoundingClientRect();const h=this.nearest(e.clientX-r.left,e.clientY-r.top,e.pointerType==='mouse'?9:18);if(h>=0)this.select(h,false);}};
    c.addEventListener('pointerup',up);c.addEventListener('pointercancel',up);
    c.addEventListener('pointerleave',()=>{$('#mapTip').hidden=true;if(this.hover>=0){this.hover=-1;this.dirty=true;}});
    c.addEventListener('wheel',e=>{e.preventDefault();const r=c.getBoundingClientRect();this.zoomAt(Math.exp(-e.deltaY*.0015),e.clientX-r.left,e.clientY-r.top);},{passive:false});
    $('#zin').onclick=()=>this.zoomAt(1.6,this.W/2,this.H/2);$('#zout').onclick=()=>this.zoomAt(1/1.6,this.W/2,this.H/2);$('#zfit').onclick=()=>this.fit();
    // Suche
    let hay=null;const norm=s=>s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
    $('#q').addEventListener('input',()=>{const q=norm($('#q').value.trim());const ul=$('#results');if(q.length<2){ul.innerHTML='';return;}
      if(!hay)hay=DATA.b.map(b=>norm(`${addr(b)} ${b[6]} ${DATA.gems[b[3]]}`));
      const toks=q.split(/\s+/);const out=[];for(let i=0;i<hay.length&&out.length<60;i++){if(toks.every(t=>hay[i].includes(t)))out.push(i);}
      out.sort((a,b)=>(isRes(DATA.b[b][2])-isRes(DATA.b[a][2])));
      ul.innerHTML=out.slice(0,7).map(i=>{const b=DATA.b[i];return`<li><button data-i="${i}"><span>${esc(addr(b))}</span><small>${esc(DATA.gems[b[3]])}</small></button></li>`;}).join('')||'<li class="hint">Keine Adresse gefunden.</li>';});
    $('#results').addEventListener('click',e=>{const b=e.target.closest('button[data-i]');if(b){this.select(+b.dataset.i,true);$('#results').innerHTML='';}});
    $('#randBtn').onclick=()=>{const a=this.byCat[0];this.select(a[Math.floor(Math.random()*a.length)],true);};
  },
  select(i,fly){this.sel=i;this.dirty=true;const b=DATA.b[i];const res=isRes(b[2]);const card=$('#selCard');card.hidden=false;
    card.innerHTML=`<div class="lbl">${esc(DATA.gems[b[3]])}</div><h3>${esc(addr(b))}</h3>
      <dl class="meta"><dt>Ort</dt><dd>${esc(place(b))}</dd><dt>Kategorie</dt><dd>${esc(DATA.cats[b[2]])}</dd><dt>Gebäude-ID</dt><dd>GEID ${b[7]}</dd><dt>Parzelle</dt><dd>${esc(b[8]||'k. A.')}</dd><dt>LV95</dt><dd>${lv(b[0]+DATA.origin[0])} / ${lv(b[1]+DATA.origin[1])}</dd>${(()=>{if(!Tiles.ok)return '';const id=Tiles.idAt(b[0],b[1]);const f=Tiles.buildingByEgid(b[7]);
        if(!Tiles.cache.has(id)||!Tiles.terr.has(id)){Promise.all([Tiles.get(id),Tiles.terrain(id)]).then(()=>{if(this.sel===i)this.select(i,false);});return '<dt>Vermessung</dt><dd>wird geladen …</dd>';}
        const hh=Tiles.hAt(b[0],b[1]);return (f?`<dt>Grundfläche</dt><dd>${lv(f.area)} m²</dd><dt>Höhe</dt><dd>ca. ${Math.round(f.h)} m${f.hsrc==='estimate'?', geschätzt':''}</dd>`:'')+(isNaN(hh)?'':`<dt>Gelände</dt><dd>${Math.round(hh)} m ü. M.</dd>`);})()}</dl>
      ${(()=>{const c=Density.at(b[0],b[1]);return c?`<div class="hint">In diesem Hektar: ${esc(c.pc||'keine')} Einwohner, ${esc(c.jc||'keine')} Arbeitsplätze (Amt für Statistik, Stand ${esc(Density.stand||'')})</div>`:'';})()}
      ${(()=>{const vs=Vereine.of(DATA.gems[b[3]]).filter(v=>v.gemeinde!=='Liechtenstein');if(!vs.length)return '';return `<details class="vereine"><summary>${vs.length} Vereine in ${esc(DATA.gems[b[3]])}</summary><ul>${vs.map(v=>`<li>${esc(v.name)} <small>${esc(v.kategorie||'')}</small></li>`).join('')}</ul></details>`;})()}
      ${this.mode==='drive'?`<button class="btn red" id="driveHere">Hier losfahren</button><div class="hint">Du startest auf der nächsten Strasse bei dieser Adresse.</div>`:`<button class="btn" id="moveIn" ${res?'':'disabled'}>Hier einziehen</button>${res?'':'<div class="hint">Kein Wohngebäude. Wähle eine Adresse mit Wohnnutzung.</div>'}`}`;
    if(this.mode==='drive')$('#driveHere').onclick=()=>Drive.start(i);else $('#moveIn').onclick=()=>FamilyDlg.open(i);
    if(fly)this.flyTo(i);},
  tick(t){if($('#mapScreen').hidden)return;
    if(this.anim){const a=this.anim;let k=clamp((t-a.t0)/a.d,0,1);k=k<.5?2*k*k:1-(-2*k+2)**2/2;this.cx=lerp(a.from[0],a.to[0],k);this.cy=lerp(a.from[1],a.to[1],k);this.s=Math.exp(lerp(a.from[2],a.to[2],k));this.dirty=true;if(k>=1)this.anim=null;}
    if(this.dirty){this.dirty=false;this.draw();}},
  draw(){const g=this.ctx,W=this.W,H=this.H,s=this.s;g.setTransform(this.dpr,0,0,this.dpr,0,0);
    g.fillStyle='#e9eef1';g.fillRect(0,0,W,H);
    if(this.relief.complete&&this.relief.naturalWidth){const[rx,ry]=this.w2s(-622.276,26477.241);g.globalCompositeOperation='multiply';g.globalAlpha=.55;g.imageSmoothingEnabled=true;g.drawImage(this.relief,rx,ry,this.relief.naturalWidth*20.01346*s,this.relief.naturalHeight*20.01346*s);g.globalAlpha=1;g.globalCompositeOperation='source-over';}
    // LV95-Gitter
    const step=s>.6?100:1000;const[wx0,wy1]=this.s2w(0,0),[wx1,wy0]=this.s2w(W,H);g.lineWidth=1;g.font='11px "Atkinson Hyperlegible",sans-serif';
    for(let x=Math.ceil((wx0+DATA.origin[0])/step)*step-DATA.origin[0];x<wx1;x+=step){const[sx]=this.w2s(x,0);g.strokeStyle=((x+DATA.origin[0])%1000===0)?'#cfd8df':'#dde4e9';g.beginPath();g.moveTo(sx+.5,0);g.lineTo(sx+.5,H);g.stroke();
      if((x+DATA.origin[0])%1000===0&&step*s>=60){g.fillStyle='#8c98a8';g.fillText(`${lv((x+DATA.origin[0])/1000)}`,sx+4,H-30);}}
    for(let y=Math.ceil((wy0+DATA.origin[1])/step)*step-DATA.origin[1];y<wy1;y+=step){const[,sy]=this.w2s(0,y);g.strokeStyle=((y+DATA.origin[1])%1000===0)?'#cfd8df':'#dde4e9';g.beginPath();g.moveTo(0,sy+.5);g.lineTo(W,sy+.5);g.stroke();
      if((y+DATA.origin[1])%1000===0&&step*s>=40){g.fillStyle='#8c98a8';g.fillText(`${lv((y+DATA.origin[1])/1000)}`,4,sy-4);}}
    // Bodenbedeckung der amtlichen Vermessung
    const detail=s>.45&&Tiles.ok;const vt=detail?this.visibleTiles():[];
    if(detail){g.globalAlpha=.9;for(const t of vt)for(const o of t.lc){if(!this.vis(o.bb))continue;g.fillStyle=LC_MAP[o.k]||'#ddd';this.polyR(o.rings);g.fill('evenodd');}g.globalAlpha=1;}
    // Bus- und Bahnlinien
    if(detail){g.setLineDash([6,4]);for(const t of vt)for(const r of t.trails){const hike=r.kind==='hiking'||r.kind==='foot';if(hike?!this.layers.wander:!this.layers.velo)continue;g.strokeStyle=hike?'#d9a400':'#2a7fd4';g.lineWidth=hike?2.2:2.6;for(const l of r.lines){this.line(l);g.stroke();}}g.setLineDash([]);}
    if(Transit.data&&s>.06&&this.layers.oev){g.lineCap='round';g.lineJoin='round';for(const r of Transit.data.routes){if(!r.pieces.length)continue;g.strokeStyle=r.color||(Transit.isTrain(r)?'#39404f':'#c41f3a');g.globalAlpha=.55;g.lineWidth=Transit.isTrain(r)?3:2;for(const pc of r.pieces){this.line(pc.p);g.stroke();}}g.globalAlpha=1;
      if(s>.35){g.fillStyle='#fff';g.strokeStyle='#18223a';g.lineWidth=1.5;for(const st of Transit.data.stops){const[sx,sy]=this.w2s(st.x,st.y);if(sx<-5||sy<-5||sx>W+5||sy>H+5)continue;g.beginPath();g.arc(sx,sy,s>1.5?5:3.2,0,7);g.fill();g.stroke();}}}
    // Dichte je Hektar
    if(Density.cells&&(this.layers.pers||this.layers.jobs)){const pal=['#fde4a5','#f9c46b','#f08a3e','#d6452c','#8f1d2c'];const cs=100*s;
      for(const c of Density.cells){const v=this.layers.pers?c.p:c.j;if(!v)continue;const[sx,sy]=this.w2s(c.hx*100-O0[0],c.hy*100+100-O0[1]);if(sx>W||sy>H||sx+cs<0||sy+cs<0)continue;
        const k=this.layers.pers?(v<5?0:v<9?1:v<30?2:v<50?3:4):(v<10?0:v<30?1:v<50?2:v<250?3:4);g.fillStyle=pal[k];g.globalAlpha=.6;g.fillRect(sx,sy,Math.max(1,cs-.5),Math.max(1,cs-.5));}g.globalAlpha=1;}
    // Gebäude
    const sz=clamp(11*s,1.5,60),h=sz/2,B=DATA.b;
    for(let c=5;c>=0;c--){g.fillStyle=CAT_COL[c];const L=this.byCat[c];
      for(let k=0;k<L.length;k++){if(detail&&this.foot.has(L[k]))continue;const b=B[L[k]];const sx=(b[0]-this.cx)*s+W/2,sy=(this.cy-b[1])*s+H/2;if(sx<-h||sy<-h||sx>W+h||sy>H+h)continue;g.fillRect(sx-h,sy-h,sz,sz);}}
    if(detail){for(const t of vt)for(const o of t.bld){if(!this.vis(o.bb))continue;g.fillStyle=o.bi>=0?CAT_COL[B[o.bi][2]]:(o.catIdx>=0?CAT_COL[o.catIdx]:'#a2aab4');for(const rings of o.polys){this.polyR(rings);g.fill('evenodd');if(o.bi>=0&&o.bi===this.sel){g.strokeStyle='#c41f3a';g.lineWidth=3;g.stroke();}}}}
    if(detail&&this.layers.kultur){g.font='700 12px "Atkinson Hyperlegible",sans-serif';g.lineJoin='round';for(const t of vt)for(const h of t.heritage){const[sx,sy]=this.w2s(h.x,h.y);if(sx<-6||sy<-6||sx>W+6||sy>H+6)continue;g.fillStyle='#c48a00';g.strokeStyle='#fff';g.lineWidth=1.5;g.beginPath();g.moveTo(sx,sy-6);g.lineTo(sx+6,sy);g.lineTo(sx,sy+6);g.lineTo(sx-6,sy);g.closePath();g.fill();g.stroke();
      if(s>1.2&&h.name){g.lineWidth=4;g.strokeStyle='rgba(255,255,255,.9)';g.strokeText(h.name,sx+9,sy+4);g.fillStyle='#7a5600';g.fillText(h.name,sx+9,sy+4);}}}
    if(s>1.6&&Transit.data&&this.layers.oev){g.font='700 12px "Atkinson Hyperlegible",sans-serif';g.textAlign='left';g.lineJoin='round';for(const st of Transit.data.stops){const[sx,sy]=this.w2s(st.x,st.y);if(sx<0||sy<0||sx>W||sy>H)continue;g.lineWidth=4;g.strokeStyle='rgba(255,255,255,.9)';g.strokeText(st.name,sx+8,sy+4);g.fillStyle='#18223a';g.fillText(st.name,sx+8,sy+4);}}
    // Hausnummern bei starkem Zoom
    if(s>2.2){g.fillStyle='#fff';g.font=`700 ${Math.min(13,sz*.45)}px "Atkinson Hyperlegible",sans-serif`;g.textAlign='center';g.textBaseline='middle';
      for(const b of B){const[sx,sy]=this.w2s(b[0],b[1]);if(sx<0||sy<0||sx>W||sy>H||b[5]==='NULL')continue;g.fillText(b[5],sx,sy);}g.textAlign='left';g.textBaseline='alphabetic';}
    // Gemeindenamen
    if(s<1.2){g.textAlign='center';g.font=`700 ${clamp(13+s*14,13,22)}px "Bricolage Grotesque",sans-serif`;g.lineJoin='round';
      for(const[x,y,,n] of this.gc){const[sx,sy]=this.w2s(x,y);g.lineWidth=5;g.strokeStyle='rgba(238,242,245,.92)';g.strokeText(n,sx,sy);g.fillStyle='#18223a';g.fillText(n,sx,sy);}g.textAlign='left';}
    const ring=(i,col,r)=>{if(i<0)return;const b=B[i];const[sx,sy]=this.w2s(b[0],b[1]);g.strokeStyle=col;g.lineWidth=3;g.beginPath();g.arc(sx,sy,Math.max(r,sz*.9),0,7);g.stroke();};
    if(this.home>=0){const b=B[this.home];const[sx,sy]=this.w2s(b[0],b[1]);g.fillStyle='#c41f3a';g.beginPath();g.arc(sx,sy-14,7,0,7);g.fill();g.beginPath();g.moveTo(sx-5,sy-10);g.lineTo(sx+5,sy-10);g.lineTo(sx,sy-2);g.fill();}
    ring(this.hover,'#18223a',7);ring(this.sel,'#c41f3a',10);
  }
};

/* =====================================================================
   FAMILIE GRÜNDEN
   ===================================================================== */
const SHIRTS=['#c41f3a','#1d3d8f','#3a9c55','#d8a221','#7a4bb3','#2b9aa8','#e07b39','#39404f'];
const HAIRS=['#2a1d14','#5b3a1e','#a0632b','#d9b45a','#8a8f96','#b23a1e'];
const SKINS=['#f1c9a5','#e0ac85','#c68863','#9b6545','#6f4630'];
const FamilyDlg={
  open(bIdx){const p=[{first:'Lena',shirt:0,hair:1,skin:0},{first:'Matthias',shirt:1,hair:0,skin:1}];let fam='Büchel';
    const m=$('#modal');m.hidden=false;
    const sw=(arr,key,k)=>`<div class="sw" data-k="${k}" data-key="${key}">${arr.map((c,i)=>`<button style="background:${c}" data-v="${i}" aria-label="Farbe ${i+1}" aria-pressed="${p[k][key]===i}"></button>`).join('')}</div>`;
    const render=()=>{m.innerHTML=`<div class="mcard" role="dialog" aria-labelledby="fh"><h2 id="fh">Familie gründen</h2>
      <div class="hint">Neues Zuhause: <b>${esc(addr(DATA.b[bIdx]))}, ${esc(place(DATA.b[bIdx]))}</b></div>
      <div class="field"><label class="lbl" for="famName">Familienname</label><input type="text" id="famName" value="${esc(fam)}" maxlength="24"></div>
      <div class="prow">${p.map((x,k)=>`<div class="person"><label class="lbl" for="fn${k}">Person ${k+1}</label><input type="text" id="fn${k}" value="${esc(x.first)}" maxlength="16">
        <div class="lbl">Oberteil</div>${sw(SHIRTS,'shirt',k)}<div class="lbl">Haare</div>${sw(HAIRS,'hair',k)}<div class="lbl">Haut</div>${sw(SKINS,'skin',k)}</div>`).join('')}</div>
      <div class="hint">Startkapital CHF 8’000. Einen Job findet ihr am Computer im Schlafzimmer.</div>
      <div class="trow"><button class="btn red" id="famGo">Einziehen</button><button class="btn ghost" id="famCancel">Abbrechen</button></div></div>`;
      m.querySelectorAll('.sw button').forEach(b=>b.onclick=()=>{const w=b.parentElement;sync();p[+w.dataset.k][w.dataset.key]=+b.dataset.v;render();});
      $('#famCancel').onclick=()=>{m.hidden=true;};
      $('#famGo').onclick=()=>{sync();m.hidden=true;Game.newGame(bIdx,fam||'Büchel',p.map(x=>({...x,first:x.first||'Sim'})));};};
    const sync=()=>{fam=$('#famName').value.trim();p.forEach((x,k)=>x.first=$('#fn'+k).value.trim());};
    render();}
};

/* =====================================================================
   SPIELWELT (Three.js)
   ===================================================================== */
const NEEDS=[['hunger','Hunger'],['energy','Energie'],['bladder','Blase'],['hygiene','Hygiene'],['fun','Spass'],['social','Soziales']];
const DECAY={awake:{hunger:6,energy:5,bladder:9,hygiene:4,fun:6,social:4},sleep:{hunger:2.5,energy:0,bladder:3,hygiene:1.5,fun:0,social:1.5},away:{hunger:5,energy:7,bladder:2,hygiene:4,fun:6,social:-3}};
const DAYS=['Mo','Di','Mi','Do','Fr','Sa','So'];
const JOBS=[
  {id:'bank',name:'Kundenberatung, Privatbank',place:'Vaduz',start:480,end:1020,pay:340},
  {id:'treuhand',name:'Assistenz, Treuhandbüro',place:'Vaduz',start:510,end:1050,pay:310},
  {id:'verwaltung',name:'Sachbearbeitung, Landesverwaltung',place:'Vaduz',start:480,end:1020,pay:300},
  {id:'industrie',name:'Produktion, Industriebetrieb',place:'Schaan',start:420,end:960,pay:285},
  {id:'gastro',name:'Service, Berggasthaus',place:'Malbun',start:600,end:1140,pay:215},
];
const hhmm=m=>{m=((m%1440)+1440)%1440;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(Math.floor(m%60)).padStart(2,'0');};

// Aktionen: Schritte mit Ziel-Objekttyp, Pose, Dauer (Spielminuten) und Zuwachs pro Minute
const ACTS={
  snack:{label:'Snack holen',steps:[{at:'fridge',pose:'stand',dur:10,gain:{hunger:2.6},bub:'Mmh'}]},
  cook:{label:'Rösti kochen & essen',steps:[{at:'stove',pose:'stand',dur:30,gain:{fun:.12},bub:'Rösti brutzeln',cost:12},{at:'chair',pose:'sit',dur:22,gain:{hunger:3.4,social:.2},bub:'En Guata!'}]},
  toilet:{label:'Toilette benutzen',steps:[{at:'toilet',pose:'sit',dur:7,gain:{bladder:15},bub:'…'},{at:'sink',pose:'stand',dur:2,gain:{hygiene:3}}]},
  shower:{label:'Duschen',steps:[{at:'shower',pose:'stand',dur:15,gain:{hygiene:6.5},bub:'Plätscher'}]},
  wash:{label:'Hände waschen',steps:[{at:'sink',pose:'stand',dur:3,gain:{hygiene:4}}]},
  sleep:{label:'Schlafen',steps:[{at:'bed',pose:'lie',dur:600,until:'energy',gain:{energy:.21},bub:'Zzz',sleep:true}]},
  nap:{label:'Nickerchen',steps:[{at:'bed',pose:'lie',dur:60,gain:{energy:.16},bub:'Zzz',sleep:true}]},
  sofanap:{label:'Auf dem Sofa dösen',steps:[{at:'sofa',pose:'sit',dur:45,gain:{energy:.12},bub:'Zzz'}]},
  tv:{label:'Fernsehen',steps:[{at:'sofa',pose:'sit',dur:60,gain:{fun:.85},bub:'Skirennen!',tv:true}]},
  read:{label:'Buch lesen',steps:[{at:'shelf',pose:'stand',dur:2,gain:{}},{at:'armchair',pose:'sit',dur:60,gain:{fun:.6},bub:'Spannend'}]},
  surf:{label:'Im Internet surfen',steps:[{at:'desk',pose:'sit',dur:50,gain:{fun:.7,social:.25},bub:'Klick'}]},
  jobs:{label:'Stellenanzeigen lesen',steps:[{at:'desk',pose:'sit',dur:8,gain:{fun:.1},bub:'Jobs…',then:'jobs'}]},
  grill:{label:'Cervelat grillieren',steps:[{at:'grill',pose:'stand',dur:35,gain:{hunger:2,fun:.45},bub:'Cervelat!',cost:8}]},
  view:{label:'Bergblick geniessen',steps:[{at:'bench',pose:'sit',dur:30,gain:{fun:.6,energy:.03},bub:'Drei Schwestern'}]},
  paper:{label:'Zeitung lesen',steps:[{at:'mailbox',pose:'stand',dur:15,gain:{fun:.45,social:.3},bub:'Neuigkeiten'}]},
  chat:{label:'Plaudern',social:true,steps:[{at:'target',pose:'talk',dur:20,gain:{social:2.2,fun:.2},tgain:{social:2.2,fun:.2},rel:.35,bub:'Bla bla'}]},
  joke:{label:'Witz erzählen',social:true,steps:[{at:'target',pose:'talk',dur:8,gain:{social:1.5,fun:1.6},tgain:{social:1.5,fun:1.8},rel:.6,bub:'Haha!'}]},
  foehn:{label:'Über den Föhn klagen',social:true,steps:[{at:'target',pose:'talk',dur:15,gain:{social:2,fun:.1},tgain:{social:2},rel:.25,bub:'Dä Föhn!'}]},
  hug:{label:'Umarmen',social:true,minRel:40,steps:[{at:'target',pose:'hug',dur:4,gain:{social:5,fun:1},tgain:{social:5,fun:1},rel:2,bub:'♥'}]},
  kiss:{label:'Küssen',social:true,minRel:70,steps:[{at:'target',pose:'hug',dur:3,gain:{social:6,fun:2},tgain:{social:6,fun:2},rel:2.5,bub:'♥♥'}]},
  go:{label:'Hierhin gehen',steps:[{at:'point',pose:'stand',dur:0,gain:{}}]},
  work:{label:'Zur Arbeit',auto:true,steps:[{at:'busstop',pose:'stand',dur:1,gain:{},bub:'Bus kommt',then:'leave'}]},
  wander:{label:'Wandern gehen',steps:[{at:'mailbox',pose:'stand',dur:2,gain:{},bub:'Los gehts',then:'hike'}]},
  velo:{label:'Velotour machen',steps:[{at:'mailbox',pose:'stand',dur:2,gain:{},bub:'Velo!',then:'bike'}]},
  vereine:{label:'Vereine in der Gemeinde',steps:[{at:'desk',pose:'sit',dur:6,gain:{fun:.1},bub:'Vereine …',then:'vereine'}]},
  club:{label:'Zum Vereinsabend',auto:true,steps:[{at:'busstop',pose:'stand',dur:1,gain:{},bub:'Training!',then:'leaveClub'}]},
};
const OBJ_ACTS={fridge:['snack','cook'],stove:['cook'],chair:['cook'],table:['cook'],toilet:['toilet'],shower:['shower'],sink:['wash','toilet'],bed:['sleep','nap'],sofa:['tv','sofanap'],tv:['tv'],shelf:['read'],armchair:['read'],desk:['surf','jobs','vereine'],grill:['grill'],bench:['view'],mailbox:['paper','wander','velo'],busstop:[]};
const OBJ_NAMES={fridge:'Kühlschrank',stove:'Herd',chair:'Stuhl',table:'Esstisch',toilet:'Toilette',shower:'Dusche',sink:'Lavabo',bed:'Doppelbett',sofa:'Sofa',tv:'Fernseher',shelf:'Bücherregal',armchair:'Lesesessel',desk:'Computer',grill:'Grill',bench:'Gartenbank',mailbox:'Briefkasten',busstop:'Bushaltestelle',counter:'Küchenzeile',wardrobe:'Kleiderschrank',plant:'Pflanze',coffee:'Salontisch'};

const GR={ox:-13,oz:-11,c:.5,w:52,h:44,blk:null};
const Game={
  inited:false,speed:1,sel:0,walls:0,sims:[],objs:[],min:420,money:8000,rel:50,bIdx:-1,lastBill:-1,
  initThree(){
    if(this.inited)return;this.inited=true;
    const c=$('#gc');const R=this.R=new THREE.WebGLRenderer({canvas:c,antialias:true});R.setPixelRatio(Math.min(devicePixelRatio||1,2));R.shadowMap.enabled=true;R.shadowMap.type=THREE.PCFSoftShadowMap;
    this.scene=new THREE.Scene();this.cam=new THREE.PerspectiveCamera(38,1,.5,2500);
    this.view={tx:-1,tz:0,yaw:.55,pitch:.9,dist:30};
    this.hemi=new THREE.HemisphereLight(0xdfeeff,0x6b7a52,.75);this.scene.add(this.hemi);
    const sun=this.sun=new THREE.DirectionalLight(0xfff3dd,.9);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-34,right:34,top:34,bottom:-34,near:1,far:200});sun.shadow.bias=-.0006;this.scene.add(sun,sun.target);
    this.lamps=[[-4,-3.5],[-3,1.5],[4.5,-1],[.5,-3.5]].map(([x,z])=>{const l=new THREE.PointLight(0xffd59a,0,9,1.6);l.position.set(x,2.3,z);this.scene.add(l);return l;});
    this.scene.fog=new THREE.Fog(0xbcd3e3,140,900);
    addEventListener('resize',()=>this.resize());this.resize();this.bindInput();
    let last=performance.now();const loop=t=>{const dt=Math.min(.1,(t-last)/1000);last=t;if(!$('#gameScreen').hidden)this.frame(dt);requestAnimationFrame(loop);};requestAnimationFrame(loop);
    document.querySelectorAll('.speeds button').forEach(b=>b.onclick=()=>this.setSpeed(+b.dataset.sp));
    $('#wallBtn').onclick=()=>this.setWalls((this.walls+1)%3);
    $('#mapBtn').onclick=()=>this.toMap();
    addEventListener('keydown',e=>{if($('#gameScreen').hidden||e.target.tagName==='INPUT')return;
      if(e.key===' '){e.preventDefault();this.setSpeed(this.speed?0:1);}else if('0123'.includes(e.key))this.setSpeed(+e.key);
      else if(e.key==='q'||e.key==='Q')this.view.yaw+=.3;else if(e.key==='e'||e.key==='E')this.view.yaw-=.3;else if(e.key==='Escape')this.hideCtx();});
    setInterval(()=>{if(!$('#gameScreen').hidden)this.save();},20000);
  },
  resize(){if(!this.R)return;const w=innerWidth,h=innerHeight;this.R.setSize(w,h,false);this.cam.aspect=w/h;this.cam.updateProjectionMatrix();},

  /* ---------- Welt aufbauen ---------- */
  build(){
    const S=this.scene;if(this.world)S.remove(this.world);const W=this.world=new THREE.Group();S.add(W);
    const b=DATA.b[this.bIdx];const mat=c=>new THREE.MeshLambertMaterial({color:c});
    const box=(w,h,d,col,x,y,z,parent=W,cast=true)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),typeof col==='object'?col:mat(col));m.position.set(x,y,z);m.castShadow=cast;m.receiveShadow=true;parent.add(m);return m;};
    this.box=box;this.mat=mat;
    // Echte Vermessung vorhanden? Dann Haus am echten Grundriss ausrichten
    const TL=this.areaTiles||[];this.real=null;this.horizon=null;
    if(TL.length){const f=Tiles.buildingByEgid(b[7]);let ax=b[0],ay=b[1],th=0;
      if(f){const pts=[];for(let k=0;k<f.p.length;k+=2)pts.push([f.p[k],f.p[k+1]]);const o=obb(pts);ax=o.cx;ay=o.cz;th=o.ang;}
      // Vorderseite (Szenen +Z) zur nächsten Strasse drehen
      let best=null,bd=1e9;for(const t of TL)for(const o of t.lc){if(o.k!=='strasse')continue;if(o.bb[0]>ax+120||o.bb[2]<ax-120||o.bb[1]>ay+120||o.bb[3]<ay-120)continue;for(let k=0;k<o.p.length;k+=2){const d=(o.p[k]-ax)**2+(o.p[k+1]-ay)**2;if(d<bd){bd=d;best=[o.p[k],o.p[k+1]];}}}
      if(best){const dx=best[0]-ax,dy=best[1]-ay;const zf=-(-dx*Math.sin(th)+dy*Math.cos(th));if(zf<0)th+=Math.PI;}
      const h0=Tiles.hAt(ax,ay);const ht=TL.find(t=>t.id===Tiles.idAt(ax,ay));this.horizon=ht&&ht.horizon;
      this.real={TL,ax,ay,th,h0:isNaN(h0)?0:h0,hasTerr:!isNaN(h0),foot:f};}
    if(this.amb)for(const p of this.amb.peds)if(p)this.scene.remove(p.m.root);
    this.busPool=[];this.precip=null;
    // Boden
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(1600,1600),mat(0x93b46c));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;W.add(ground);ground.userData.ground=true;this.ground=ground;
    const lot=new THREE.Mesh(new THREE.PlaneGeometry(26,22),mat(0xa3c477));lot.rotation.x=-Math.PI/2;lot.position.set(0,.01,0);lot.receiveShadow=true;W.add(lot);lot.userData.ground=true;this.lot=lot;
    if(!this.real){
    // Strasse mit echtem Strassennamen
    const road=box(110,.04,5.2,0x6f747b,0,.02,13.8,W,false);road.userData.ground=true;
    box(110,.05,.12,0xe8e8e8,0,.03,11.3,W,false);box(110,.05,.12,0xe8e8e8,0,.03,16.3,W,false);
    for(let x=-52;x<54;x+=4)box(2,.05,.1,0xf2f2f2,x,.03,13.8,W,false);
    const lbl=this.textPlane(DATA.streets[b[4]],1024,128,'#ffffff','rgba(0,0,0,0)',72);lbl.scale.set(12,1.5,1);lbl.rotation.x=-Math.PI/2;lbl.position.set(-14,.06,13.85);W.add(lbl);
    const lbl2=lbl.clone();lbl2.position.x=24;W.add(lbl2);
    }
    // Hecke und Gartenweg
    const hedge=mat(0x4f7a3a);[[0,-10.8,26,.6],[-12.8,0,.6,22],[12.8,0,.6,22]].forEach(([x,z,w,d])=>box(w,1.1,d,hedge,x,.55,z));
    for(let z=4.6;z<11;z+=.9)box(1,.05,.7,0xcfc6b5,0,.03,z,W,false);
    // Berge als Kulisse: Osten hoch (Rätikon), Westen Schweizer Seite
    const r=rng(b[7]);for(let k=0;k<26;k++){const a=k/26*Math.PI*2;const east=Math.cos(a)>0;const d=520+r()*260;const h=(east?240:150)+r()*170;
      const m=new THREE.Mesh(new THREE.ConeGeometry(160+r()*120,h,5),mat(east?0x6f8a73:0x7c937a));m.position.set(Math.cos(a)*d,h/2-4,Math.sin(a)*d);m.rotation.y=r()*3;W.add(m);
      if(h>300){const cap=new THREE.Mesh(new THREE.ConeGeometry((160+60)*.24,h*.22,5),mat(0xf3f6f8));cap.position.set(m.position.x,h-4-h*.11+2,m.position.z);cap.rotation.y=m.rotation.y;W.add(cap);}}
    if(this.real)this.buildReal(W,b);else this.buildNeighbours(W,b);this.buildHouse(W);this.buildGrid();
  },
  buildReal(W,b){const R=this.real,{TL,ax,ay,th,h0}=R,c=Math.cos(th),sn=Math.sin(th);
    const LC=[].concat(...TL.map(t=>t.lc)),BLD=[].concat(...TL.map(t=>t.bld)),PARC=[].concat(...TL.map(t=>t.parcels));
    const hAt=(x,y)=>{const v=Tiles.hAt(x,y);return isNaN(v)?h0:v;};
    const toS=(x,y)=>{const dx=x-ax,dy=y-ay;return[dx*c+dy*sn,dx*sn-dy*c];};
    const toW=(X,Z)=>{const u=X,v=-Z;return[ax+u*c-v*sn,ay+u*sn+v*c];};
    R.toS=toS;R.toW=toW;R.toV=(dx,dy)=>[dx*c+dy*sn,dx*sn-dy*c];
    const S=440,N=110;const flat=(X,Z)=>{const d=Math.hypot(Math.max(Math.abs(X)-13.5,0),Math.max(Math.abs(Z)-11.5,0));const t=clamp(d/22,0,1);return t*t*(3-2*t);};
    const yAt=(X,Z)=>{const[wx,wy]=toW(X,Z);return(hAt(wx,wy)-h0)*flat(X,Z);};R.yAt=yAt;
    // Gelände
    const geo=new THREE.PlaneGeometry(S,S,N,N);geo.rotateX(-Math.PI/2);const pos=geo.attributes.position;let minY=1e9;
    for(let i=0;i<pos.count;i++){const y=yAt(pos.getX(i),pos.getZ(i))-.04;pos.setY(i,y);minY=Math.min(minY,y);}geo.computeVertexNormals();
    // Bodentextur aus der Bodenbedeckung
    const TS=2048,cv=document.createElement('canvas');cv.width=cv.height=TS;const g=cv.getContext('2d'),k=TS/S;
    g.fillStyle='#a6c47c';g.fillRect(0,0,TS,TS);
    const path=p=>{g.beginPath();for(let i=0;i<p.length;i+=2){const[X,Z]=toS(p[i],p[i+1]);const px=(X+S/2)*k,py=(Z+S/2)*k;i?g.lineTo(px,py):g.moveTo(px,py);}g.closePath();};
    const pathR=rings=>{g.beginPath();for(const p of rings){for(let i=0;i<p.length;i+=2){const[X,Z]=toS(p[i],p[i+1]);const px=(X+S/2)*k,py=(Z+S/2)*k;i?g.lineTo(px,py):g.moveTo(px,py);}g.closePath();}};
    const near=bb=>bb[2]>ax-S*.75&&bb[0]<ax+S*.75&&bb[3]>ay-S*.75&&bb[1]<ay+S*.75;
    for(const o of LC){if(!near(o.bb))continue;g.fillStyle=LC_GROUND[o.k]||'#a6c47c';pathR(o.rings);g.fill('evenodd');if(o.k==='strasse'||o.k==='trottoir'){g.strokeStyle='rgba(255,255,255,.25)';g.lineWidth=1.5;g.stroke();}}
    // Mittellinien auf grösseren Strassen (OSM)
    g.setLineDash([3*k,4*k]);g.strokeStyle='rgba(255,255,255,.7)';g.lineWidth=Math.max(1,.15*k);
    for(const t of TL)for(const r of t.roads){if(!['primary','secondary','tertiary','trunk'].includes(r.hw))continue;for(const l of r.lines){g.beginPath();for(let i=0;i<l.length;i+=2){const[X,Z]=toS(l[i],l[i+1]);const px=(X+S/2)*k,py=(Z+S/2)*k;i?g.lineTo(px,py):g.moveTo(px,py);}g.stroke();}}
    g.setLineDash([]);
    // Wander- und Velorouten
    for(const t of TL)for(const r of t.trails){const hike=r.kind==='hiking'||r.kind==='foot';g.strokeStyle=hike?'rgba(232,180,0,.9)':'rgba(42,127,212,.85)';g.lineWidth=Math.max(1.5,(hike?.5:.7)*k);g.setLineDash(hike?[2*k,1.5*k]:[4*k,2*k]);
      for(const l of r.lines){g.beginPath();for(let i=0;i<l.length;i+=2){const[X,Z]=toS(l[i],l[i+1]);const px=(X+S/2)*k,py=(Z+S/2)*k;i?g.lineTo(px,py):g.moveTo(px,py);}g.stroke();}}
    g.setLineDash([]);
    g.fillStyle='#8a8580';for(const o of BLD)if(near(o.bb))for(const rings of o.polys){pathR(rings);g.fill('evenodd');}
    g.strokeStyle='rgba(255,255,255,.28)';g.lineWidth=1.2;for(const o of PARC)if(near(o.bb)){path(o.p);g.stroke();}
    const own=PARC.find(o=>o.bb[0]<=ax&&o.bb[2]>=ax&&o.bb[1]<=ay&&o.bb[3]>=ay&&inPoly(o.p,ax,ay));
    if(own){R.parcel=own.n;g.strokeStyle='rgba(255,255,255,.95)';g.lineWidth=4;g.setLineDash([14,8]);path(own.p);g.stroke();g.setLineDash([]);}
    const tex=new THREE.CanvasTexture(cv);tex.anisotropy=Math.min(8,this.R.capabilities.getMaxAnisotropy());
    const terr=new THREE.Mesh(geo,new THREE.MeshLambertMaterial({map:tex}));terr.receiveShadow=true;terr.userData.ground=true;W.add(terr);
    this.ground.position.y=minY-.6;
    // Bäume in Wald, Gehölz und Gärten
    const rr=rng(b[7]),tp=[];
    for(const t of TL)for(const[x,y] of t.trees){const[X,Z]=toS(x,y);if(Math.abs(X)<S/2-4&&Math.abs(Z)<S/2-4&&!(Math.abs(X)<15&&Math.abs(Z)<13))tp.push([X,Z,'osm']);}
    for(const o of LC){if((o.k!=='wald'&&o.k!=='bestockt'&&o.k!=='garten')||!near(o.bb))continue;const dens=o.k==='wald'?1/40:o.k==='bestockt'?1/55:1/320;let n=Math.min(500,Math.round(polyArea(o.p)*dens));
      for(let t=0;t<n*4&&n>0;t++){const x=lerp(o.bb[0],o.bb[2],rr()),y=lerp(o.bb[1],o.bb[3],rr());if(!inPoly(o.p,x,y))continue;const[X,Z]=toS(x,y);
        if(Math.abs(X)>S/2-4||Math.abs(Z)>S/2-4||(Math.abs(X)<15&&Math.abs(Z)<13))continue;tp.push([X,Z,o.k]);n--;}if(tp.length>1800)break;}
    if(tp.length){const crown=new THREE.InstancedMesh(new THREE.ConeGeometry(1.7,5,7),this.mat(0xffffff),tp.length),trunk=new THREE.InstancedMesh(new THREE.CylinderGeometry(.18,.28,1.6,6),this.mat(0x6b4a33),tp.length);
      const m4=new THREE.Matrix4(),q=new THREE.Quaternion(),v=new THREE.Vector3(),sc=new THREE.Vector3();const dark=new THREE.Color(0x355c2f),light=new THREE.Color(0x5b8a45),col=new THREE.Color();
      tp.forEach(([X,Z,kk],i)=>{const s=(kk==='wald'?1.1:.8)+rr()*.6,y=yAt(X,Z);sc.set(s,s*(.9+rr()*.4),s);v.set(X,y+1.4*s+2.4*sc.y,Z);m4.compose(v,q,sc);crown.setMatrixAt(i,m4);v.set(X,y+.8*s,Z);m4.compose(v,q,sc);trunk.setMatrixAt(i,m4);crown.setColorAt(i,col.copy(dark).lerp(light,rr()));});
      crown.castShadow=true;trunk.castShadow=true;W.add(crown,trunk);}
    // Gebäude aus echten Grundrissen (Höhe geschätzt)
    const pick=[],walls=[0xf1ede4,0xe9e2d3,0xf4f1ea,0xe6ddd0,0xdfe3e2],roofs=[0x8e3d2c,0x6b4a3a,0x5b5f66,0x9a5236],cap=this.mat(0x8f949a);
    const inLot=(X,Z)=>Math.abs(X)<13.6&&Math.abs(Z)<11.6;
    for(const o of BLD){if(R.foot&&o===R.foot)continue;if(o.bb[2]<ax-230||o.bb[0]>ax+230||o.bb[3]<ay-230||o.bb[1]>ay+230)continue;
      const pts=[];let hit=false,gmin=1e9,gmax=-1e9;
      for(let i=0;i<o.p.length;i+=2){const[X,Z]=toS(o.p[i],o.p[i+1]);pts.push([X,Z]);}
      for(let i=0;i<pts.length&&!hit;i++){const a=pts[i],e=pts[(i+1)%pts.length],L=Math.hypot(e[0]-a[0],e[1]-a[1]),n=Math.max(1,Math.ceil(L));for(let t=0;t<=n;t++){const X=lerp(a[0],e[0],t/n),Z=lerp(a[1],e[1],t/n);if(inLot(X,Z)){hit=true;break;}const y=yAt(X,Z);gmin=Math.min(gmin,y);gmax=Math.max(gmax,y);}}
      if(hit||inPoly(pts.flat(),0,0))continue;
      const r=rng((o.eg||Math.round(o.area*100))*7+3),cat=o.bi>=0?DATA.b[o.bi][2]:(o.catIdx>=0?o.catIdx:3);const res=cat<=2;
      let fl,fh;if(o.area<30){fl=1;fh=2.7;}else if(res){fl=cat===2?3:(o.area>320?3:2);fh=2.9;}else if(cat===4){fl=1;fh=7;}else{fl=o.area>700?2:1;fh=4.4;}
      const hW=o.h>1?o.h:fl*fh,top=gmax+hW,D=top-gmin+.4;
      const shape=new THREE.Shape(pts.map(([X,Z])=>new THREE.Vector2(X,Z)));const eg=new THREE.ExtrudeGeometry(shape,{depth:D,bevelEnabled:false});eg.rotateX(Math.PI/2);
      const wcol=res?(r()<.15?0xb98b5e:walls[Math.floor(r()*5)]):[0xc9cdd1,0xb7bec4,0xd3d0c8][Math.floor(r()*3)];
      const m=new THREE.Mesh(eg,[cap,this.mat(wcol)]);m.position.y=top;m.castShadow=m.receiveShadow=true;W.add(m);m.userData.nb=o.bi;pick.push(m);
      const ob=obb(pts);if(o.roof?o.roof!=='flat'&&o.area/ob.A>.7:(o.area<650&&o.area/ob.A>.8&&cat!==3&&o.area>=30)){const rh=Math.min(4.2,ob.d*.42);const rf=new THREE.Mesh(this.gable(ob.w+.8,ob.d+.9,rh),new THREE.MeshLambertMaterial({color:roofs[Math.floor(r()*4)],side:THREE.DoubleSide}));
        rf.position.set(ob.cx,top,ob.cz);rf.rotation.y=-ob.ang;rf.castShadow=true;rf.userData.nb=o.bi;W.add(rf);pick.push(rf);}}
    this.nbPick=pick;
    this.buildSigns(W);this.buildPois(W);this.buildStops(W);this.buildAmbient();
  },
  /* ---------- Beschilderung, Orte, Haltestellen, Fahrzeuge ---------- */
  signTex(kind,value){this._st=this._st||new Map();const key=kind+'|'+(value||'');if(this._st.has(key))return this._st.get(key);
    const wide=kind==='ortstafel'||kind==='strassenname',W=wide?512:256,H=wide?(kind==='ortstafel'?176:112):256,cv=document.createElement('canvas');cv.width=W;cv.height=H;const g=cv.getContext('2d');
    const txt=(t,size,col,y)=>{g.fillStyle=col;g.textAlign='center';g.textBaseline='middle';let f=size;g.font=`700 ${f}px "Atkinson Hyperlegible",Arial,sans-serif`;while(g.measureText(t).width>W*.88&&f>12){f-=2;g.font=`700 ${f}px "Atkinson Hyperlegible",Arial,sans-serif`;}g.fillText(t,W/2,y);};
    if(kind==='tempo'){g.fillStyle='#fff';g.beginPath();g.arc(128,128,120,0,7);g.fill();g.lineWidth=30;g.strokeStyle='#d0202e';g.beginPath();g.arc(128,128,104,0,7);g.stroke();txt(String(value||''),value&&String(value).length>2?96:118,'#111',134);}
    else if(kind==='stop'){g.fillStyle='#d0202e';g.beginPath();for(let i=0;i<8;i++){const a=Math.PI/8+i*Math.PI/4;g.lineTo(128+120*Math.cos(a),128+120*Math.sin(a));}g.fill();g.strokeStyle='#fff';g.lineWidth=8;g.stroke();txt('STOP',70,'#fff',130);}
    else if(kind==='vortritt'){g.fillStyle='#fff';g.beginPath();g.moveTo(10,24);g.lineTo(246,24);g.lineTo(128,236);g.closePath();g.fill();g.strokeStyle='#d0202e';g.lineWidth=26;g.lineJoin='round';g.beginPath();g.moveTo(26,34);g.lineTo(230,34);g.lineTo(128,214);g.closePath();g.stroke();}
    else if(kind==='fussgaenger'){g.fillStyle='#1d5fb0';g.fillRect(8,8,240,240);g.fillStyle='#fff';g.beginPath();g.moveTo(128,26);g.lineTo(232,214);g.lineTo(24,214);g.closePath();g.fill();g.fillStyle='#111';g.beginPath();g.arc(132,88,14,0,7);g.fill();g.lineWidth=12;g.strokeStyle='#111';g.lineCap='round';g.beginPath();g.moveTo(128,106);g.lineTo(120,150);g.lineTo(100,190);g.moveTo(120,150);g.lineTo(146,188);g.moveTo(126,118);g.lineTo(152,140);g.moveTo(126,118);g.lineTo(104,138);g.stroke();g.fillStyle='#111';for(let i=0;i<4;i++)g.fillRect(50+i*42,198,26,8);}
    else if(kind==='ortstafel'){g.fillStyle='#1d4f9c';g.fillRect(0,0,W,H);g.strokeStyle='#fff';g.lineWidth=6;g.strokeRect(10,10,W-20,H-20);txt(value||'',78,'#fff',H/2+4);}
    else if(kind==='strassenname'){g.fillStyle='#1d4f9c';g.fillRect(0,0,W,H);g.strokeStyle='#fff';g.lineWidth=4;g.strokeRect(6,6,W-12,H-12);txt(value||'',56,'#fff',H/2+3);}
    else return null;
    const t=new THREE.CanvasTexture(cv);t.anisotropy=4;const r={t,w:wide?(kind==='ortstafel'?1.5:1.0):.7,h:wide?(kind==='ortstafel'?.52:.22):.7};this._st.set(key,r);return r;},
  buildSigns(W){const R=this.real;if(!R)return;const pole=this.mat(0x9aa1a8),back=this.mat(0xb7bcc2),sigs=[].concat(...R.TL.map(t=>t.signs));let n=0;
    for(const sg of sigs){const[X0,Z0]=R.toS(sg.x,sg.y);if(X0*X0+Z0*Z0>230*230||n>260)continue;const a=(sg.angle||0)*Math.PI/180,fE=Math.sin(a),fN=Math.cos(a);
      const off=sg.kind==='strassenname'?4.2:3.4,[X,Z]=R.toS(sg.x+Math.cos(a)*off,sg.y-Math.sin(a)*off);if(Math.abs(X)<14.5&&Math.abs(Z)<12.5)continue;
      const y=R.yAt(X,Z),grp=new THREE.Group();grp.position.set(X,y,Z);const[nx,nz]=R.toV(-fE,-fN);grp.rotation.y=Math.atan2(nx,nz);
      if(sg.kind==='ampel'){const p=new THREE.Mesh(new THREE.CylinderGeometry(.06,.06,3,8),pole);p.position.y=1.5;grp.add(p);const bx=new THREE.Mesh(new THREE.BoxGeometry(.32,.9,.25),this.mat(0x1d2126));bx.position.y=3.1;grp.add(bx);
        [[0xd0202e,3.38],[0xe7b416,3.1],[0x2fa84f,2.82]].forEach(([c,yy])=>{const l=new THREE.Mesh(new THREE.SphereGeometry(.09,10,8),new THREE.MeshBasicMaterial({color:c}));l.position.set(0,yy,.13);grp.add(l);});W.add(grp);n++;continue;}
      const tx=this.signTex(sg.kind,sg.value);if(!tx)continue;const ph=sg.kind==='ortstafel'?2.1:sg.kind==='strassenname'?2.6:2.2;
      const p=new THREE.Mesh(new THREE.CylinderGeometry(.04,.04,ph,6),pole);p.position.y=ph/2;grp.add(p);
      if(sg.kind==='ortstafel'){const p2=p.clone();p.position.x=-.6;p2.position.x=.6;p2.position.y=ph/2;grp.add(p2);}
      const front=new THREE.MeshBasicMaterial({map:tx.t,transparent:sg.kind!=='ortstafel'&&sg.kind!=='strassenname',alphaTest:.1}),plate=new THREE.Mesh(new THREE.PlaneGeometry(tx.w,tx.h),front);plate.position.set(0,ph+tx.h/2-.05,.03);grp.add(plate);
      const bk=new THREE.Mesh(new THREE.PlaneGeometry(tx.w*.96,tx.h*.96),back);bk.rotation.y=Math.PI;bk.position.set(0,ph+tx.h/2-.05,.02);grp.add(bk);grp.traverse(o=>{o.castShadow=true;});W.add(grp);n++;}},
  label(text,sub,col){const cv=document.createElement('canvas');cv.width=512;cv.height=sub?132:96;const g=cv.getContext('2d');g.font='700 44px "Atkinson Hyperlegible",Arial,sans-serif';const w=Math.min(500,Math.max(g.measureText(text).width,sub?g.measureText(sub).width*.7:0)+40);
    g.fillStyle='rgba(255,255,255,.92)';g.beginPath();if(g.roundRect)g.roundRect((512-w)/2,4,w,cv.height-8,18);else g.rect((512-w)/2,4,w,cv.height-8);g.fill();g.fillStyle=col||'#18223a';g.textAlign='center';g.textBaseline='middle';g.fillText(text,256,sub?44:50,480);
    if(sub){g.font='400 30px "Atkinson Hyperlegible",Arial,sans-serif';g.fillStyle='#5a6680';g.fillText(sub,256,98,480);}
    const t=new THREE.CanvasTexture(cv),sp=new THREE.Sprite(new THREE.SpriteMaterial({map:t,depthWrite:false,transparent:true}));sp.scale.set(8,8*cv.height/512,1);return sp;},
  buildPois(W){const R=this.real;if(!R)return;const TYPES={restaurant:'Restaurant',cafe:'Café',bar:'Bar',pub:'Beiz',fast_food:'Imbiss',bakery:'Bäckerei',supermarket:'Supermarkt',convenience:'Laden',butcher:'Metzgerei',school:'Schule',kindergarten:'Kindergarten',pharmacy:'Apotheke',doctors:'Arztpraxis',dentist:'Zahnarzt',bank:'Bank',post_office:'Post',townhall:'Gemeindehaus',place_of_worship:'Kirche',library:'Bibliothek',fire_station:'Feuerwehr',police:'Polizei',sports_centre:'Sportanlage',pitch:'Sportplatz',playground:'Spielplatz',hotel:'Hotel',museum:'Museum',fuel:'Tankstelle',hairdresser:'Coiffeur',kiosk:'Kiosk',clothes:'Kleider',company:'Firma',community_centre:'Gemeinschaftszentrum'};
    const ps=[].concat(...R.TL.map(t=>t.pois)).filter(p=>p.name).map(p=>{const[X,Z]=R.toS(p.x,p.y);return{...p,X,Z,d:X*X+Z*Z};}).filter(p=>p.d<240*240).sort((a,b)=>a.d-b.d).slice(0,28);
    const HT={castle:'Burg',ruins:'Ruine',wayside_shrine:'Bildstock',wayside_cross:'Wegkreuz',church:'Kirche',chapel:'Kapelle',monument:'Denkmal',memorial:'Gedenkstätte',archaeological_site:'Fundstelle',building:'Historisches Gebäude',boundary_stone:'Grenzstein',mine:'Bergwerk',bridge:'Historische Brücke'};
    const hs=[].concat(...R.TL.map(t=>t.heritage)).filter(h=>h.name).map(h=>{const[X,Z]=R.toS(h.x,h.y);return{...h,X,Z,d:X*X+Z*Z};}).filter(h=>h.d<300*300).sort((a,b)=>a.d-b.d).slice(0,15);
    for(const h of hs){const sp=this.label(h.name,'Kulturgut · '+(HT[h.historic]||h.historic||'geschützt'),'#8a6100');sp.position.set(h.X,R.yAt(h.X,h.Z)+9,h.Z);W.add(sp);}
    this.poiSprites=[];for(const p of ps){const sp=this.label(p.name,TYPES[p.type]||p.type);sp.position.set(p.X,R.yAt(p.X,p.Z)+7,p.Z);W.add(sp);this.poiSprites.push(sp);}},
  buildStops(W){const R=this.real;if(!R||!Transit.data)return;const pole=this.mat(0x8c939b);
    for(const st of Transit.data.stops){const[X,Z]=R.toS(st.x,st.y);if(X*X+Z*Z>300*300||(Math.abs(X)<14&&Math.abs(Z)<12))continue;const y=R.yAt(X,Z),g=new THREE.Group();g.position.set(X,y,Z);
      const p=new THREE.Mesh(new THREE.CylinderGeometry(.05,.05,2.6,6),pole);p.position.y=1.3;g.add(p);const s=this.textPlane('H',128,128,'#1d6b3a','#f2d230',96);s.scale.set(.55,.55,1);s.position.y=2.45;g.add(s);const s2=s.clone();s2.rotation.y=Math.PI;g.add(s2);
      const lb=this.label(st.name,'Haltestelle','#1d6b3a');lb.position.y=4.2;lb.scale.multiplyScalar(.7);g.add(lb);W.add(g);}},
  makeBus(train){const g=new THREE.Group(),L=train?24:12,body=new THREE.Mesh(new THREE.BoxGeometry(2.55,3,L),new THREE.MeshLambertMaterial({color:0xc41f3a}));body.position.y=1.75;body.castShadow=true;g.add(body);
    const win=new THREE.Mesh(new THREE.BoxGeometry(2.58,.9,L*.92),this.mat(0x26313d));win.position.y=2.3;g.add(win);
    [-1,1].forEach(sd=>[-.35,.35].forEach(f=>{const w=new THREE.Mesh(new THREE.CylinderGeometry(.5,.5,.3,12),this.mat(0x1b1d20));w.rotation.z=Math.PI/2;w.position.set(sd*1.2,.5,f*L);g.add(w);}));
    g.userData.body=body;g.userData.train=train;return g;},
  tickTransit(){const R=this.real;if(!R||!R.toS||!Transit.data)return;const now=performance.now();if(now-(this.lastTr||0)<120)return;this.lastTr=now;
    const day=Math.floor(this.min/1440),sec=(this.min%1440)*60,act=Transit.active(this.dowOf(day),sec),pool=this.busPool||(this.busPool=[]);let used=0;
    for(const a of act){const[x,y,ang]=Transit.position(a.route,a.a,a.b,a.f),[X,Z]=R.toS(x,y);if(X*X+Z*Z>330*330)continue;if(used>=16)break;const train=Transit.isTrain(a.route);
      let m=pool[used];if(!m||m.userData.train!==train){if(m)this.world.remove(m);m=this.makeBus(train);pool[used]=m;this.world.add(m);}
      m.visible=true;m.userData.body.material.color.set(a.route.color||(train?'#e9eef2':'#c41f3a'));const[vx,vz]=R.toV(Math.sin(ang),Math.cos(ang));
      m.position.set(X,R.yAt(X,Z),Z);m.rotation.y=Math.atan2(vx,vz);
      if(m.userData.ref!==a.route.short){if(m.userData.lbl)m.remove(m.userData.lbl);const lb=this.label((train?'Zug ':'Bus ')+(a.route.short||''),'nach '+(a.trip[1]||''),a.route.color||'#c41f3a');lb.position.y=5;lb.scale.multiplyScalar(.75);m.add(lb);m.userData.lbl=lb;m.userData.ref=a.route.short;}
      used++;}
    for(let k=used;k<pool.length;k++)if(pool[k])pool[k].visible=false;},
  nearTrail(kinds){const R=this.real;if(!R)return null;let best=null,bd=1e18;
    for(const t of R.TL)for(const r of t.trails){if(!kinds.includes(r.kind)||!r.name)continue;for(const l of r.lines)for(let i=0;i<l.length;i+=8){const d=(l[i]-R.ax)**2+(l[i+1]-R.ay)**2;if(d<bd){bd=d;best=r.name;}}}
    return best;},
  tickHikes(){for(const s of this.sims){if(!(s.away&&(s.awayKind==='hike'||s.awayKind==='bike')))continue;if(this.min<s.hikeUntil)continue;
      const hike=s.awayKind==='hike';s.away=false;s.awayKind=null;s.m.root.visible=true;s.x=-3.3;s.z=9;
      s.needs.fun=clamp(s.needs.fun+(hike?35:40),0,100);s.needs.energy=clamp(s.needs.energy-(hike?22:18),0,100);s.needs.hygiene=clamp(s.needs.hygiene-20,0,100);s.needs.hunger=clamp(s.needs.hunger-15,0,100);
      toast(`${s.first} ist zurück${s.hikeName?' vom '+s.hikeName:''}.`);this.renderPortraits();}},
  tickFireworks(dt){const day=Math.floor(this.min/1440),iso=this.isoOf(day),tod=this.min%1440;
    const on=(iso.slice(5)==='08-15'&&tod>=1320&&tod<1360)||(iso.slice(5)==='12-31'&&tod>=1430)||(iso.slice(5)==='01-01'&&tod<20);
    const F=this.fw||(this.fw={bursts:[],t:0});
    if(on&&!F.shown){F.shown=iso;const R=this.real;if(R&&R.toS){const[cx,cz]=R.toS(4060,10690);this.view.yaw=Math.atan2(-cx,-cz);}this.view.pitch=.2;this.view.dist=45;toast('Feuerwerk! Die Kamera schaut Richtung Schloss Vaduz.');}
    if(!on&&F.shown&&F.shown!==iso)F.shown=null;
    if(on&&this.speed>0){F.t-=dt;if(F.t<=0){F.t=.35+Math.random()*.6;this.spawnBurst();}}
    for(let i=F.bursts.length-1;i>=0;i--){const b=F.bursts[i];b.age+=dt;const a=b.pts.geometry.attributes.position;
      for(let k=0;k<b.n;k++){b.vel[k*3+1]-=9.8*dt*.35;a.array[k*3]+=b.vel[k*3]*dt;a.array[k*3+1]+=b.vel[k*3+1]*dt;a.array[k*3+2]+=b.vel[k*3+2]*dt;}
      a.needsUpdate=true;b.pts.material.opacity=Math.max(0,1-b.age/2.4);if(b.age>2.4){this.scene.remove(b.pts);b.pts.geometry.dispose();F.bursts.splice(i,1);}}},
  sparkTex(){if(this._spark)return this._spark;const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d'),gr=g.createRadialGradient(32,32,0,32,32,32);gr.addColorStop(0,'rgba(255,255,255,1)');gr.addColorStop(.35,'rgba(255,255,255,.8)');gr.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gr;g.fillRect(0,0,64,64);return this._spark=new THREE.CanvasTexture(c);},
  spawnBurst(){const R=this.real;let dx=-.5,dz=-.8;
    if(R&&R.toS){const[cx,cz]=R.toS(4060,10690);const d=Math.hypot(cx,cz)||1;const dist=Math.min(d,140);dx=cx/d*dist;dz=cz/d*dist;}else{dx*=300;dz*=300;}
    const n=140,pos=new Float32Array(n*3),vel=new Float32Array(n*3),cx=dx+(Math.random()-.5)*40,cy=22+Math.random()*16,cz=dz+(Math.random()-.5)*40;
    for(let k=0;k<n;k++){pos[k*3]=cx;pos[k*3+1]=cy;pos[k*3+2]=cz;const u=Math.random()*2-1,th=Math.random()*Math.PI*2,r=Math.sqrt(1-u*u),sp=11+Math.random()*6;vel[k*3]=r*Math.cos(th)*sp;vel[k*3+1]=u*sp;vel[k*3+2]=r*Math.sin(th)*sp;}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));
    const col=[0xff4d6d,0xffd166,0x06d6a0,0x4cc9f0,0xffffff,0xc77dff][Math.floor(Math.random()*6)];
    const pts=new THREE.Points(g,new THREE.PointsMaterial({color:col,size:4.5,map:this.sparkTex(),alphaTest:.02,transparent:true,opacity:1,depthWrite:false,fog:false,blending:THREE.AdditiveBlending}));this.scene.add(pts);this.fw.bursts.push({pts,vel,n,age:0});},
  /* ---------- Belebte Strassen: Autos und Fussgänger nach Dichte und Tageszeit ---------- */
  buildAmbient(){const R=this.real;this.amb={cars:[],peds:[],roads:[],walks:[],P:0,J:0};if(!R)return;
    const CAR=['motorway','trunk','primary','secondary','tertiary','unclassified','residential','living_street','service','primary_link','secondary_link','tertiary_link'],
          WALK=['residential','living_street','footway','pedestrian','path','service','unclassified','tertiary','secondary','primary','steps','track'];
    const mk=l=>{const p=[];for(let i=0;i<l.length;i+=2){const[X,Z]=R.toS(l[i],l[i+1]);p.push(X,Z);}const cum=[0];for(let k=2;k<p.length;k+=2)cum.push(cum[cum.length-1]+Math.hypot(p[k]-p[k-2],p[k+1]-p[k-1]));return{p,cum,len:cum[cum.length-1]};};
    for(const t of R.TL)for(const r of t.roads)for(const l of r.lines){const pl=mk(l);if(pl.len<25)continue;let near=false;for(let i=0;i<pl.p.length;i+=2)if(pl.p[i]**2+pl.p[i+1]**2<260*260){near=true;break;}if(!near)continue;
      pl.v=Math.min(parseFloat(r.maxspeed)||50,50)/3.6;if(CAR.includes(r.hw))this.amb.roads.push(pl);if(WALK.includes(r.hw))this.amb.walks.push(pl);}
    const d=Density.around(R.ax,R.ay,300);this.amb.P=d.p;this.amb.J=d.j;},
  ambTargets(){const tod=(this.min%1440)/60,dow=this.dowOf(Math.floor(this.min/1440)),hol=Cal.holidayOn(this.isoOf(Math.floor(this.min/1440)));
    const wk=dow<5&&!(hol&&hol.frei);const curve=(pts)=>{for(let i=1;i<pts.length;i++)if(tod<=pts[i][0]){const[a,va]=pts[i-1],[b,vb]=pts[i];return va+(vb-va)*(tod-a)/(b-a);}return pts[pts.length-1][1];};
    const traffic=wk?curve([[0,.05],[5,.15],[7,1.1],[8,1.2],[9,.7],[12,.65],[13,.7],[16,.9],[17.5,1.2],[19,.6],[22,.2],[24,.05]]):curve([[0,.05],[8,.2],[11,.6],[17,.6],[20,.3],[24,.05]]);
    const walk=curve([[0,.02],[6,.1],[8,.6],[12,.8],[17,1],[20,.5],[22,.15],[24,.02]]);const rain=this.wx&&this.wx.precip>.3?.4:1;
    const A=this.amb;return{cars:A.roads.length?clamp(Math.round((A.P+A.J)/90*traffic),traffic>.3?2:0,26):0,peds:A.walks.length?clamp(Math.round(A.P/60*walk*rain),0,22):0};},
  makeCar(){const g=new THREE.Group(),col=[0xe9ecef,0x1c1f24,0x6b7280,0xa61e2d,0x1d4f9c,0xd9d2c3,0x2f5d3a][Math.floor(Math.random()*7)];
    const b=new THREE.Mesh(new THREE.BoxGeometry(1.8,.75,4.3),new THREE.MeshLambertMaterial({color:col}));b.position.y=.6;b.castShadow=true;g.add(b);
    const c=new THREE.Mesh(new THREE.BoxGeometry(1.6,.6,2.2),this.mat(0x2a333d));c.position.set(0,1.25,-.2);g.add(c);
    const hl=new THREE.MeshBasicMaterial({color:0xfff2c0}),tl=new THREE.MeshBasicMaterial({color:0xd0202e});
    [-.6,.6].forEach(x=>{const h=new THREE.Mesh(new THREE.BoxGeometry(.3,.15,.05),hl);h.position.set(x,.65,2.16);g.add(h);const t=new THREE.Mesh(new THREE.BoxGeometry(.3,.15,.05),tl);t.position.set(x,.65,-2.16);g.add(t);});
    return g;},
  makePed(){const s={shirt:Math.floor(Math.random()*SHIRTS.length),hair:Math.floor(Math.random()*HAIRS.length),skin:Math.floor(Math.random()*SKINS.length)};const m=this.makeSim(s);m.ring.visible=false;return m;},
  spawnAgent(kind){const A=this.amb,list=kind==='car'?A.roads:A.walks;if(!list.length)return null;const pl=list[Math.floor(Math.random()*list.length)];
    const a={kind,pl,d:Math.random()*pl.len,dir:Math.random()<.5?1:-1,v:kind==='car'?pl.v*(.75+Math.random()*.35):1.1+Math.random()*.5,ph:Math.random()*6};
    a.m=kind==='car'?this.makeCar():this.makePed();(kind==='car'?this.world:this.scene).add(kind==='car'?a.m:a.m.root);return a;},
  tickAmbient(dt){const A=this.amb;if(!A||!this.real)return;const R=this.real;
    A.t=(A.t||0)-dt;if(A.t<=0){A.t=1.5;const T=this.ambTargets();
      if(A.cars.length<T.cars)A.cars.push(this.spawnAgent('car'));else if(A.cars.length>T.cars){const c=A.cars.pop();if(c)this.world.remove(c.m);}
      if(A.peds.length<T.peds)A.peds.push(this.spawnAgent('ped'));else if(A.peds.length>T.peds){const p=A.peds.pop();if(p)this.scene.remove(p.m.root);}
      A.cars=A.cars.filter(Boolean);A.peds=A.peds.filter(Boolean);}
    const k=this.speed>0?Math.min(2,[0,1,1.4,1.8][this.speed]):0,night=this.sunInfo&&this.sunInfo.sun.alt<-3;
    const move=(a)=>{const pl=a.pl;a.d+=a.dir*a.v*dt*k;if(a.d<0||a.d>pl.len){if(Math.random()<.5){a.dir*=-1;a.d=clamp(a.d,0,pl.len);}else{const list=a.kind==='car'?A.roads:A.walks;a.pl=list[Math.floor(Math.random()*list.length)];a.d=a.dir>0?0:a.pl.len;}}
      const c=a.pl.cum,p=a.pl.p;let lo=0,hi=c.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(c[m]<=a.d)lo=m;else hi=m;}const f=(a.d-c[lo])/((c[hi]-c[lo])||1);
      let x=p[lo*2]+(p[hi*2]-p[lo*2])*f,z=p[lo*2+1]+(p[hi*2+1]-p[lo*2+1])*f;let dx=(p[hi*2]-p[lo*2])*a.dir,dz=(p[hi*2+1]-p[lo*2+1])*a.dir;const L=Math.hypot(dx,dz)||1;dx/=L;dz/=L;
      const off=a.kind==='car'?1.7:3.6;x+=-dz*off;z+=dx*off;return[x,z,Math.atan2(dx,dz)];};
    for(const a of A.cars){const[x,z,ang]=move(a);const inLot=Math.abs(x)<13.5&&Math.abs(z)<11.5;a.m.visible=!inLot;a.m.position.set(x,R.yAt(x,z),z);a.m.rotation.y=ang;}
    for(const a of A.peds){const[x,z,ang]=move(a);const inLot=Math.abs(x)<13.5&&Math.abs(z)<11.5,m=a.m;m.root.visible=!inLot;m.root.position.set(x,R.yAt(x,z),z);m.root.rotation.y=ang;
      a.ph+=a.v*dt*k*3.2;const sw=Math.sin(a.ph)*.5*(k>0?1:0);m.L.rotation.x=sw;m.R.rotation.x=-sw;m.AL.rotation.x=-sw*.8;m.AR.rotation.x=sw*.8;}},
  clubPlan(kat){const k=(kat||'').toLowerCase();if(k.includes('sport'))return{days:[1,3],start:1140,end:1230,label:'Di und Do 19:00 bis 20:30'};if(k.includes('musik')||k.includes('kultur'))return{days:[2],start:1170,end:1290,label:'Mi 19:30 bis 21:30'};
    if(k.includes('feuerwehr')||k.includes('rettung'))return{days:[0],start:1170,end:1290,label:'Mo 19:30 bis 21:30'};return{days:[4],start:1140,end:1260,label:'Fr 19:00 bis 21:00'};},
  tickClubs(day,dow,tod){for(const s of this.sims){if(!s.verein)continue;const pl=this.clubPlan(s.verein.kategorie);s.clubDone=s.clubDone||{};
      if(!s.away&&pl.days.includes(dow)&&tod>=pl.start-20&&tod<pl.start+30&&!s.clubDone[day]&&!(s.cur&&(s.cur.id==='club'||s.cur.id==='work'))&&!s.flags.out){s.clubDone[day]=1;if(s.cur&&s.cur.seat)s.cur.seat.by=null;this.standUp(s);s.cur=null;s.queue=[];this.enqueue(s,'club');}
      if(s.away&&s.awayKind==='club'&&(tod>=pl.end+15||!pl.days.includes(dow))){s.away=false;s.awayKind=null;s.m.root.visible=true;s.x=9.5;s.z=9.8;s.needs.social=clamp(s.needs.social+45,0,100);s.needs.fun=clamp(s.needs.fun+30,0,100);s.needs.energy=clamp(s.needs.energy-12,0,100);s.needs.hygiene=clamp(s.needs.hygiene-15,0,100);toast(`${s.first} ist zurück vom ${s.verein.name}.`);this.renderPortraits();}}},
  openVereine(s){const gem=DATA.gems[DATA.b[this.bIdx][3]],m=$('#modal');let vs=Vereine.of(gem);m.hidden=false;
    const render=(q)=>{const f=q?vs.filter(v=>(v.name+' '+v.kategorie).toLowerCase().includes(q.toLowerCase())):vs;
      m.innerHTML=`<div class="mcard" role="dialog" aria-labelledby="vh"><h2 id="vh">Vereine in ${esc(gem)}</h2><div class="hint">${vs.length?`${vs.length} Vereine aus dem Vereinsverzeichnis der Gemeinde und landesweite Verbände. Mitglieder gehen einmal oder zweimal pro Woche abends hin, das hebt Soziales und Spass.`:'Das Vereinsverzeichnis ist noch nicht geladen.'}</div>
      ${s.verein?`<div class="card"><b>${esc(s.first)} ist Mitglied: ${esc(s.verein.name)}</b><div class="hint">${esc(this.clubPlan(s.verein.kategorie).label)}</div><button class="btn ghost" id="vQuit">Austreten</button></div>`:''}
      <input type="text" id="vq" placeholder="Suchen, z. B. Fussball, Musik, Feuerwehr" value="${esc(q||'')}"><div class="jobs">${f.slice(0,60).map((v,i)=>`<button class="job" data-i="${vs.indexOf(v)}"><span><b>${esc(v.name)}</b><small>${esc(v.kategorie||'')} · ${esc(v.gemeinde||'')} · ${esc(this.clubPlan(v.kategorie).label)}</small></span><span class="pay">Beitreten</span></button>`).join('')}</div>
      <div class="trow"><button class="btn ghost" id="vClose">Schliessen</button></div></div>`;
      m.querySelectorAll('.job').forEach(bn=>bn.onclick=()=>{const v=vs[+bn.dataset.i];s.verein={name:v.name,kategorie:v.kategorie};m.hidden=true;toast(`${s.first} ist jetzt Mitglied: ${v.name}.`);this.save();});
      $('#vClose').onclick=()=>m.hidden=true;if($('#vQuit'))$('#vQuit').onclick=()=>{s.verein=null;render(q);};const inp=$('#vq');inp.oninput=()=>{const pos=inp.selectionStart;render(inp.value);const i2=$('#vq');i2.focus();i2.setSelectionRange(pos,pos);};};
    render('');},
  textPlane(text,w,h,fg,bg,px){const cv=document.createElement('canvas');cv.width=w;cv.height=h;const g=cv.getContext('2d');g.fillStyle=bg;g.fillRect(0,0,w,h);g.fillStyle=fg;g.font=`700 ${px}px "Atkinson Hyperlegible",sans-serif`;g.textAlign='center';g.textBaseline='middle';g.fillText(text,w/2,h/2);
    const t=new THREE.CanvasTexture(cv);t.anisotropy=4;return new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:t,transparent:true,depthWrite:false}));},
  gable(w,d,h){const g=new THREE.BufferGeometry();const A=[-w/2,0,-d/2],B=[w/2,0,-d/2],C=[w/2,0,d/2],D=[-w/2,0,d/2],E=[-w/2,h,0],F=[w/2,h,0];
    const tri=[A,F,B,A,E,F,D,C,F,D,F,E,A,D,E,B,F,C];g.setAttribute('position',new THREE.Float32BufferAttribute(tri.flat(),3));g.computeVertexNormals();return g;},
  buildNeighbours(W,me){
    const B=DATA.b,R=170,near=[];for(let i=0;i<B.length;i++){const b=B[i];const dx=b[0]-me[0],dy=b[1]-me[1];if(i===this.bIdx||dx*dx+dy*dy>R*R)continue;near.push([i,dx,-dy]);}
    // Mindestabstand zum Nachbarn bestimmt die Hausgrösse (es gibt keine Grundrisse im Datensatz)
    const nn=near.map(([i,x,z])=>{let d=1e9;for(const[j,x2,z2] of near)if(j!==i){const q=(x-x2)**2+(z-z2)**2;if(q<d)d=q;}const q0=x*x+z*z;return Math.sqrt(Math.min(d,q0));});
    const mountain=['Triesenberg','Planken'].includes(DATA.gems[me[3]]);const pick=[];
    near.forEach(([i,x,z],k)=>{if(Math.abs(x)<16+3&&z>-14&&z<20)return;if(Math.abs(z-13.8)<6&&Math.abs(x)<60)return;
      const b=B[i],r=rng(b[7]*7+3);const res=isRes(b[2]);const gx=x,gz=z;
      let w=res?clamp(nn[k]*.62,6,13):clamp(nn[k]*.7,5,24),d=w*(res?.8+r()*.25:.6+r()*.5);const fl=res?(b[2]===2?3:2+(r()<.3?1:0)):(b[2]===4?2:1+(r()<.4?1:0));const hW=fl*2.8;
      const grp=new THREE.Group();grp.position.set(gx,0,gz);grp.rotation.y=(Math.floor(r()*4)*Math.PI/2)+(r()-.5)*.5;
      const wall=res?(mountain&&r()<.6?0xb98b5e:[0xf1ede4,0xe9e2d3,0xf4f1ea,0xe6ddd0,0xdfe3e2][Math.floor(r()*5)]):(b[2]===4?0xd9cdb8:[0xc9cdd1,0xb7bec4,0xd3d0c8][Math.floor(r()*3)]);
      const body=new THREE.Mesh(new THREE.BoxGeometry(w,hW,d),new THREE.MeshLambertMaterial({color:wall}));body.position.y=hW/2;body.castShadow=body.receiveShadow=true;grp.add(body);
      if(res||b[2]===4){const roof=new THREE.Mesh(this.gable(w+1,d+1.2,Math.min(4.5,d*.42)),new THREE.MeshLambertMaterial({color:[0x8e3d2c,0x6b4a3a,0x5b5f66,0x9a5236][Math.floor(r()*4)],side:THREE.DoubleSide}));roof.position.y=hW;roof.castShadow=true;grp.add(roof);}
      else{const p=new THREE.Mesh(new THREE.BoxGeometry(w+.2,.3,d+.2),new THREE.MeshLambertMaterial({color:0x8a9096}));p.position.y=hW+.15;grp.add(p);}
      // Fenster als dunkle Streifen
      if(res)for(let f=0;f<fl;f++){const s=new THREE.Mesh(new THREE.BoxGeometry(w*.7,.9,d+.04),new THREE.MeshLambertMaterial({color:0x3d4a5c}));s.position.y=f*2.8+1.6;grp.add(s);}
      grp.traverse(o=>o.userData.nb=i);W.add(grp);pick.push(grp);});
    this.nbPick=pick;
  },
  buildHouse(W){
    const box=this.box,mat=this.mat;const H=this.house=new THREE.Group();W.add(H);
    // Böden
    const floor=(x0,x1,z0,z1,c)=>{const m=box(x1-x0,.1,z1-z0,c,(x0+x1)/2,.05,(z0+z1)/2,H,false);m.userData.ground=true;};
    floor(-7,2,-1,4,0xc59a68);floor(-7,-1,-6,-1,0xe6e1d7);floor(-1,2,-6,-1,0xbfd6e2);floor(2,7,-6,4,0xa97c55);
    box(14.4,.08,10.4,0x9c9690,0,.0,-1,H,false);
    // Wände (mit Türöffnungen)
    this.wallSegs=[[-7,-6,7,-6],[-7,-6,-7,4],[7,-6,7,4],[-7,4,-.5,4],[.5,4,7,4],[-7,-1,-5,-1],[-4,-1,0,-1],[1,-1,2,-1],[-1,-6,-1,-1],[2,-6,2,1],[2,2,2,4]];
    const wm=mat(0xf3efe7),wo=mat(0xe7dfcf);this.wallMeshes=this.wallSegs.map(([x1,z1,x2,z2])=>{const outer=(z1===z2&&(z1===-6||z1===4))||(x1===x2&&Math.abs(x1)===7);
      const w=Math.abs(x2-x1)+.15,d=Math.abs(z2-z1)+.15;const m=box(w,1,d,outer?wo:wm,(x1+x2)/2,.5,(z1+z2)/2,H);return m;});
    this.roof=new THREE.Mesh(this.gable(15.4,11.4,3.6),new THREE.MeshLambertMaterial({color:0x7c3a2b,side:THREE.DoubleSide}));this.roof.position.set(0,2.7,-1);this.roof.castShadow=true;H.add(this.roof);
    // Möbel und Objekte
    this.objs=[];const O=(type,x,z,w,d,blockIt,seats,buildFn)=>{const g=new THREE.Group();g.position.set(x,0,z);H.add(g);buildFn(g);g.traverse(o=>{o.userData.obj=type;if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
      const ob={type,x,z,w,d,block:blockIt,seats:seats.map(s=>({...s,by:null})),g};g.userData.ref=ob;g.traverse(o=>o.userData.ref=ob);this.objs.push(ob);return ob;};
    const B=(g,w,h,d,c,x,y,z)=>box(w,h,d,c,x,y,z,g);
    const C=(g,r,h,c,x,y,z,seg=16)=>{const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,seg),mat(c));m.position.set(x,y,z);g.add(m);return m;};
    const yawTo=(fx,fz)=>Math.atan2(fx,fz);
    // Küche
    O('fridge',-6.5,-5.5,.8,.7,true,[{a:[-6.5,-4.6],yaw:Math.PI,pose:'stand'}],g=>{B(g,.8,1.85,.7,0xe8edf0,0,.93,0);B(g,.04,.5,.04,0x8a9199,.3,1.25,.37);B(g,.79,.02,.01,0xb8c0c7,0,1.15,.355);});
    O('stove',-5.5,-5.6,.8,.6,true,[{a:[-5.5,-4.7],yaw:Math.PI,pose:'stand'}],g=>{B(g,.8,.9,.6,0xdfe3e6,0,.45,0);B(g,.78,.03,.58,0x22262b,0,.915,0);[[-.2,-.13],[.2,-.13],[-.2,.13],[.2,.13]].forEach(([x,z])=>C(g,.1,.02,0x4a4f55,x,.94,z));B(g,.6,.4,.02,0x22262b,0,.45,.31);});
    O('counter',-4.2,-5.6,1.8,.6,true,[],g=>{B(g,1.8,.86,.6,0x6f8fa6,0,.43,0);B(g,1.84,.05,.64,0xd9cfbd,0,.885,0);B(g,.5,.06,.36,0xaeb6bd,.4,.9,0);});
    O('table',-3.6,-3.3,1.5,.9,true,[],g=>{B(g,1.5,.06,.9,0xb88a5a,0,.76,0);[[-.65,-.38],[.65,-.38],[-.65,.38],[.65,.38]].forEach(([x,z])=>B(g,.06,.74,.06,0x8a643f,x,.37,z));});
    const chair=(x,z,face)=>O('chair',x,z,.45,.45,false,[{a:[x,z+(face>0?-.55:.55)],p:[x,z],yaw:face>0?0:Math.PI,pose:'sit',y:.47}],g=>{B(g,.46,.05,.46,0xc25a3c,0,.46,0);B(g,.46,.5,.05,0xc25a3c,0,.72,face>0?-.21:.21);[[-.19,-.19],[.19,-.19],[-.19,.19],[.19,.19]].forEach(([a,b])=>B(g,.04,.45,.04,0x6b4a33,a,.22,b));});
    chair(-3.95,-4.15,1);chair(-3.25,-2.45,-1);
    // Bad
    O('shower',-.4,-5.4,1,1,false,[{a:[-.25,-5.25],p:[-.4,-5.4],yaw:0,pose:'stand'}],g=>{B(g,1,.08,1,0xf4f7f9,0,.04,0);const gl=new THREE.MeshLambertMaterial({color:0xbfe3f2,transparent:true,opacity:.35});const p1=new THREE.Mesh(new THREE.BoxGeometry(1,2,.03),gl);p1.position.set(0,1,.5);g.add(p1);const p2=new THREE.Mesh(new THREE.BoxGeometry(.03,2,1),gl);p2.position.set(.5,1,0);g.add(p2);C(g,.12,.03,0xa9b2ba,0,2.05,-.25);B(g,.03,.3,.03,0xa9b2ba,0,2.1,-.42);});
    O('toilet',1.45,-5.55,.45,.65,true,[{a:[1.25,-4.75],p:[1.45,-5.3],yaw:0,pose:'sit',y:.45}],g=>{C(g,.17,.4,0xffffff,0,.2,.05);C(g,.21,.06,0xf2f2f2,0,.43,.08);B(g,.45,.4,.18,0xffffff,0,.6,-.22);});
    O('sink',1.6,-2.6,.45,.7,true,[{a:[.75,-2.6],yaw:Math.PI/2,pose:'stand'}],g=>{B(g,.45,.8,.7,0xf1f1ee,0,.4,0);B(g,.35,.05,.5,0xdde6ec,-.02,.82,0);B(g,.02,.7,.6,0xcfe6f2,.21,1.5,0);});
    // Wohnzimmer
    O('tv',-1.9,-.65,1.6,.45,true,[],g=>{B(g,1.6,.45,.45,0x5b4636,0,.23,0);const scr=B(g,1.25,.72,.05,0x14181d,0,.86,.05);this.tvScreen=scr;});
    O('sofa',-1.9,2.95,2.3,.95,true,[{a:[-2.45,2.15],p:[-2.45,2.9],yaw:Math.PI,pose:'sit',y:.48},{a:[-1.35,2.15],p:[-1.35,2.9],yaw:Math.PI,pose:'sit',y:.48}],g=>{const c=0x3e5f8a;B(g,2.3,.42,.9,c,0,.21,0);B(g,2.3,.55,.22,c,0,.65,.36);B(g,.2,.62,.9,c,-1.05,.31,0);B(g,.2,.62,.9,c,1.05,.31,0);B(g,.9,.12,.6,0x5677a3,-.48,.48,-.05);B(g,.9,.12,.6,0x5677a3,.48,.48,-.05);});
    O('coffee',-1.9,1.45,1,.5,true,[],g=>{B(g,1,.06,.5,0xd8c3a0,0,.4,0);B(g,.9,.37,.4,0xb89e78,0,.19,0);});
    O('shelf',-6.7,1.5,.4,1.7,true,[{a:[-6.05,1.5],yaw:-Math.PI/2,pose:'stand'}],g=>{B(g,.4,2,1.7,0x8a643f,0,1,0);const rr=rng(9);for(let s=0;s<4;s++)for(let k=0;k<7;k++){const h=.25+rr()*.12;B(g,.28,h,.18,[0xc41f3a,0x1d3d8f,0xd8a221,0x3a9c55,0xece6da][Math.floor(rr()*5)],.05,.25+s*.46+h/2,-.65+k*.21);}});
    O('armchair',-5.6,3.15,.9,.9,true,[{a:[-5.6,2.3],p:[-5.6,3.05],yaw:Math.PI,pose:'sit',y:.46}],g=>{const c=0xa94e3a;B(g,.9,.42,.9,c,0,.21,0);B(g,.9,.6,.2,c,0,.6,.35);B(g,.16,.58,.9,c,-.37,.29,0);B(g,.16,.58,.9,c,.37,.29,0);});
    O('plant',.9,3.4,.5,.5,true,[],g=>{C(g,.2,.4,0xc87f4f,0,.2,0);const m=new THREE.Mesh(new THREE.SphereGeometry(.42,10,8),mat(0x3f7d3b));m.position.y=.85;g.add(m);});
    // Schlafzimmer
    O('bed',4.6,-4.75,1.8,2.3,true,[{a:[3.25,-4.2],p:[4.15,-4.75],yaw:0,pose:'lie',y:.62},{a:[5.95,-4.2],p:[5.05,-4.75],yaw:0,pose:'lie',y:.62}],g=>{B(g,1.9,.35,2.3,0x8a643f,0,.18,0);B(g,1.8,.22,2.15,0xf6f3ee,0,.46,0);B(g,1.82,.08,1.4,0x2f6f8f,0,.6,.35);B(g,.7,.14,.4,0xffffff,-.45,.64,-.82);B(g,.7,.14,.4,0xffffff,.45,.64,-.82);B(g,1.9,.9,.1,0x6b4a33,0,.6,-1.15);});
    O('wardrobe',6.6,-.9,.6,1.6,true,[],g=>{B(g,.6,2.1,1.6,0xd8c3a0,0,1.05,0);B(g,.02,1.9,.01,0x8a7a62,-.31,1.05,0);});
    O('desk',6.5,2.5,.7,1.4,true,[{a:[5.7,2.5],p:[5.95,2.5],yaw:Math.PI/2,pose:'sit',y:.47}],g=>{B(g,.7,.05,1.4,0xe8e2d6,0,.74,0);[[-.3,-.65],[.3,-.65],[-.3,.65],[.3,.65]].forEach(([x,z])=>B(g,.04,.72,.04,0x555b63,x,.36,z));B(g,.05,.42,.7,0x1c2026,.15,1.03,0);B(g,.2,.02,.5,0x2a2f36,-.1,.77,0);B(g,.46,.06,.46,0x39404f,-.55,.46,0);});
    // Garten
    O('grill',5,7.6,.7,.7,true,[{a:[5,6.75],yaw:0,pose:'stand'}],g=>{const k=new THREE.Mesh(new THREE.SphereGeometry(.35,14,8,0,Math.PI*2,Math.PI/2,Math.PI/2),mat(0x23272c));k.position.y=.95;g.add(k);C(g,.36,.03,0x777f88,0,.96,0);[[0,.22],[.2,-.12],[-.2,-.12]].forEach(([x,z])=>B(g,.04,.8,.04,0x2a2f36,x,.4,z));});
    O('bench',-6.5,7.9,1.7,.6,true,[{a:[-6.9,7.05],p:[-6.9,7.8],yaw:Math.PI,pose:'sit',y:.47},{a:[-6.1,7.05],p:[-6.1,7.8],yaw:Math.PI,pose:'sit',y:.47}],g=>{for(let k=0;k<3;k++)B(g,1.7,.05,.14,0x9a6b3e,0,.45,-.18+k*.17);for(let k=0;k<2;k++)B(g,1.7,.12,.04,0x9a6b3e,0,.68+k*.18,.26);[[-.75,0],[.75,0]].forEach(([x])=>B(g,.06,.45,.5,0x3a3f45,x,.22,0));});
    O('mailbox',-3.3,10.2,.35,.35,true,[{a:[-3.3,9.4],yaw:0,pose:'stand'}],g=>{B(g,.08,1.1,.08,0x5a6068,0,.55,0);B(g,.4,.3,.3,0x2e6b57,0,1.2,0);});
    O('busstop',9.5,10.6,.3,.3,true,[{a:[9.5,9.8],yaw:0,pose:'stand'}],g=>{B(g,.08,2.5,.08,0x8c939b,0,1.25,0);const s=this.textPlane('H',128,128,'#1d6b3a','#f2d230',96);s.scale.set(.5,.5,1);s.position.set(0,2.3,.05);g.add(s);const s2=s.clone();s2.rotation.y=Math.PI;s2.position.z=-.05;g.add(s2);});
    // Bäume im Garten
    [[9.5,-7.5],[-10,-7],[10,4]].forEach(([x,z],k)=>{const t=new THREE.Group();t.position.set(x,0,z);H.add(t);const s=new THREE.Mesh(new THREE.CylinderGeometry(.18,.25,2.2,8),mat(0x6b4a33));s.position.y=1.1;s.castShadow=true;t.add(s);const c=new THREE.Mesh(new THREE.ConeGeometry(1.6+k*.2,3.8,8),mat(0x3d6b35));c.position.y=3.6;c.castShadow=true;t.add(c);this.objs.push({type:'tree',x,z,w:.8,d:.8,block:true,seats:[],g:t});});
    this.setWalls(this.walls);
  },
  setWalls(m){this.walls=m;const h=m===0?.35:2.7;if(this.wallMeshes)this.wallMeshes.forEach(w=>{w.scale.y=h;w.position.y=h/2;});if(this.roof)this.roof.visible=m===2;$('#wallBtn').textContent='Wände: '+['unten','oben','mit Dach'][m];},
  buildGrid(){const blk=GR.blk=new Uint8Array(GR.w*GR.h);
    for(let j=0;j<GR.h;j++)for(let i=0;i<GR.w;i++){const x=GR.ox+(i+.5)*GR.c,z=GR.oz+(j+.5)*GR.c;let b=0;
      for(const[x1,z1,x2,z2] of this.wallSegs){const px=clamp(x,Math.min(x1,x2),Math.max(x1,x2)),pz=clamp(z,Math.min(z1,z2),Math.max(z1,z2));if(Math.hypot(x-px,z-pz)<.3){b=1;break;}}
      if(!b)for(const o of this.objs)if(o.block&&Math.abs(x-o.x)<o.w/2+.08&&Math.abs(z-o.z)<o.d/2+.08){b=1;break;}
      if(Math.abs(x)>12.3||Math.abs(z)>10.5&&z<0)b=1;blk[i+j*GR.w]=b;}},
  cellOf(x,z){return[clamp(Math.floor((x-GR.ox)/GR.c),0,GR.w-1),clamp(Math.floor((z-GR.oz)/GR.c),0,GR.h-1)];},
  cellPos(i,j){return[GR.ox+(i+.5)*GR.c,GR.oz+(j+.5)*GR.c];},
  free(i,j){return i>=0&&j>=0&&i<GR.w&&j<GR.h&&!GR.blk[i+j*GR.w];},
  nearestFree(x,z){const[ci,cj]=this.cellOf(x,z);let best=null,bd=1e9;for(let r=0;r<12&&!best;r++)for(let j=cj-r;j<=cj+r;j++)for(let i=ci-r;i<=ci+r;i++){if(!this.free(i,j))continue;const[px,pz]=this.cellPos(i,j);const d=(px-x)**2+(pz-z)**2;if(d<bd){bd=d;best=[i,j];}}return best;},
  los(ax,az,bx,bz){const d=Math.hypot(bx-ax,bz-az),n=Math.ceil(d/.15);for(let k=1;k<n;k++){const t=k/n;const[i,j]=this.cellOf(lerp(ax,bx,t),lerp(az,bz,t));if(!this.free(i,j))return false;}return true;},
  path(fx,fz,tx,tz){const s=this.nearestFree(fx,fz),t=this.nearestFree(tx,tz);if(!s||!t)return null;const W=GR.w,N=W*GR.h,S=s[0]+s[1]*W,T=t[0]+t[1]*W;
    const g=new Float32Array(N).fill(1e9),f=new Float32Array(N).fill(1e9),came=new Int32Array(N).fill(-1),cl=new Uint8Array(N);const hh=(i,j)=>Math.hypot(i-t[0],j-t[1]);
    g[S]=0;f[S]=hh(s[0],s[1]);const open=[S];
    while(open.length){let bi=0;for(let k=1;k<open.length;k++)if(f[open[k]]<f[open[bi]])bi=k;const cur=open[bi];open[bi]=open[open.length-1];open.pop();if(cur===T)break;if(cl[cur])continue;cl[cur]=1;
      const ci=cur%W,cj=(cur/W)|0;for(let dj=-1;dj<=1;dj++)for(let di=-1;di<=1;di++){if(!di&&!dj)continue;const ni=ci+di,nj=cj+dj;if(!this.free(ni,nj))continue;if(di&&dj&&(!this.free(ci+di,cj)||!this.free(ci,cj+dj)))continue;
        const n=ni+nj*W,ng=g[cur]+(di&&dj?1.414:1);if(ng<g[n]){g[n]=ng;f[n]=ng+hh(ni,nj);came[n]=cur;open.push(n);}}}
    if(S!==T&&came[T]<0)return null;const cells=[];for(let c=T;c>=0&&c!==S;c=came[c])cells.push(c);cells.reverse();
    const pts=cells.map(c=>this.cellPos(c%W,(c/W)|0));if(!pts.length)pts.push(this.cellPos(t[0],t[1]));
    // Wegglättung über Sichtlinie
    const out=[];let cx=fx,cz=fz,k=0;while(k<pts.length){let far=k;for(let m=pts.length-1;m>k;m--)if(this.los(cx,cz,pts[m][0],pts[m][1])){far=m;break;}out.push(pts[far]);[cx,cz]=pts[far];k=far+1;}return out;},

  /* ---------- Figuren ---------- */
  makeSim(p){const mat=c=>new THREE.MeshLambertMaterial({color:c});const root=new THREE.Group(),body=new THREE.Group();root.add(body);
    const shirt=mat(SHIRTS[p.shirt]),skin=mat(SKINS[p.skin]),hair=mat(HAIRS[p.hair]),pants=mat(0x2d3442);
    const part=(w,h,d,m,x,y,z,par)=>{const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x,y,z);o.castShadow=true;par.add(o);return o;};
    const leg=s=>{const g=new THREE.Group();g.position.set(s*.11,.86,0);body.add(g);part(.15,.82,.17,pants,0,-.41,0,g);part(.16,.08,.26,mat(0x3a2a20),0,-.82,.04,g);return g;};
    const arm=s=>{const g=new THREE.Group();g.position.set(s*.29,1.44,0);body.add(g);part(.11,.42,.13,shirt,0,-.2,0,g);part(.1,.24,.11,skin,0,-.52,0,g);return g;};
    const L=leg(-1),Rg=leg(1),AL=arm(-1),AR=arm(1);part(.46,.62,.26,shirt,0,1.17,0,body);part(.12,.1,.12,skin,0,1.52,0,body);
    const head=new THREE.Mesh(new THREE.SphereGeometry(.17,16,12),skin);head.position.y=1.72;head.castShadow=true;body.add(head);
    const hr=new THREE.Mesh(new THREE.SphereGeometry(.185,16,10,0,Math.PI*2,0,Math.PI*.55),hair);hr.position.y=1.74;hr.rotation.x=-.25;body.add(hr);
    part(.035,.04,.02,mat(0x1a1a1a),-.06,1.74,.16,body);part(.035,.04,.02,mat(0x1a1a1a),.06,1.74,.16,body);
    const ring=new THREE.Mesh(new THREE.RingGeometry(.36,.46,32),new THREE.MeshBasicMaterial({color:0x3a9c55,transparent:true,opacity:.95}));ring.rotation.x=-Math.PI/2;ring.position.y=.04;root.add(ring);
    root.traverse(o=>o.userData.sim=true);this.scene.add(root);return{root,body,L,R:Rg,AL,AR,ring};},
  newSim(p,k){const r=rng(Date.now()+k*99);const s={id:k,first:p.first,look:{shirt:p.shirt,hair:p.hair,skin:p.skin},needs:{},x:-.6+k*1.2,z:6.2+k*.4,yaw:Math.PI,queue:[],cur:null,path:null,pose:'stand',job:null,away:false,earned:false,idle:0,phase:0,flags:{}};
    NEEDS.forEach(([n])=>s.needs[n]=60+r()*30);return s;},
  attach(s){s.m=this.makeSim(s.look);const bub=document.createElement('div');bub.className='bub';$('#bubbles').appendChild(bub);s.bub=bub;},

  /* ---------- Spielstart ---------- */
  async prepareArea(bIdx){const b=DATA.b[bIdx];this.areaTiles=[];if(!Tiles.ok)return;$('#loadOverlay').hidden=false;
    try{this.areaTiles=await Tiles.loadArea(b[0],b[1],270);}catch(e){console.warn(e);}finally{$('#loadOverlay').hidden=true;}},
  async newGame(bIdx,fam,people){await this.prepareArea(bIdx);this.startDay=Astro.todayVaduz();this.bIdx=bIdx;this.family=fam;const nowMin=Math.floor(((Date.now()/60000+Astro.vaduzOffset(Date.now()))%1440)/15)*15;this.min=clamp(nowMin,420,1260);this.money=8000;this.rel=50;this.lastBill=0;this.speed=1;this.walls=0;
    this.enter();this.sims=people.map((p,k)=>this.newSim(p,k));this.sims.forEach(s=>this.attach(s));this.sel=0;this.afterEnter();
    toast(`Willkommen in ${DATA.gems[DATA.b[bIdx][3]]}, Familie ${fam}!`);setTimeout(()=>toast('Tipp: Klick auf Möbel für Aktionen, auf den Boden zum Hingehen.'),1600);this.save();},
  async load(sv){await this.prepareArea(sv.bIdx);this.startDay=sv.startDay||Astro.todayVaduz();this.bIdx=sv.bIdx;this.family=sv.family;this.min=sv.min;this.money=sv.money;this.rel=sv.rel;this.lastBill=sv.lastBill;this.walls=sv.walls||0;this.speed=1;
    this.enter();this.sims=sv.sims.map(x=>({...this.newSim({first:x.first,...x.look},x.id),...x,queue:[],cur:null,path:null,pose:'stand',flags:{}}));this.sims.forEach(s=>{this.attach(s);if(s.away)s.m.root.visible=false;});this.sel=0;this.afterEnter();toast(`Willkommen zurück, Familie ${this.family}.`);},
  enter(){$('#title').hidden=true;$('#mapScreen').hidden=true;$('#gameScreen').hidden=false;this.initThree();this.resize();
    (this.sims||[]).forEach(s=>{if(s.m)this.scene.remove(s.m.root);});$('#bubbles').innerHTML='';this.build();this.view={tx:-1,tz:1,yaw:.55,pi:0,pitch:.9,dist:30};
    const b=DATA.b[this.bIdx];$('#addrLbl').innerHTML=`${esc(addr(b))}<small>${esc(place(b))}${this.real&&this.real.parcel?' · Parzelle '+esc(this.real.parcel):''}${this.real?` · ${Math.round(this.real.h0)} m ü. M.`:''} · Familie ${esc(this.family)}</small>`;
    $('#gAttr').textContent=this.real?'Gebäude- und Wohnungsregister (Amt für Statistik) · Amtliche Vermessung (Amt für Tiefbau und Geoinformation) · swissALTI3D © swisstopo · © OpenStreetMap-Mitwirkende · Fahrplan opentransportdata.swiss · Wetter Open-Meteo.com, Föhnindex MeteoSchweiz · Gebäudehöhen teils geschätzt':'Gebäude- und Wohnungsregister (Amt für Statistik) · Vermessungsdaten nicht erreichbar, Umgebung generiert';
    this.wxKey=null;},
  afterEnter(){this.setSpeed(this.speed);this.setWalls(this.walls);this.renderPortraits();this.renderPanel();this.renderQueue();},
  toMap(){this.save();this.hideCtx();$('#gameScreen').hidden=true;$('#mapScreen').hidden=false;$('#title').hidden=true;MapV.home=this.bIdx;MapV.resize();MapV.select(this.bIdx,true);},
  serialize(){return{v:2,startDay:this.startDay,bIdx:this.bIdx,family:this.family,min:this.min,money:this.money,rel:this.rel,lastBill:this.lastBill,walls:this.walls,
    sims:this.sims.map(s=>({id:s.id,first:s.first,look:s.look,needs:s.needs,x:s.x,z:s.z,yaw:s.yaw,job:s.job,away:s.away,awayKind:s.awayKind,earned:s.earned,verein:s.verein||null}))};},
  save(){if(this.bIdx>=0&&this.sims.length)store.set(SAVE_KEY,this.serialize());},
  setSpeed(v){this.speed=v;document.querySelectorAll('.speeds button').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.sp===v)));},

  /* ---------- Aktionen ---------- */
  enqueue(s,id,extra){if(s.flags.out){toast(`${s.first} schläft vor Erschöpfung.`);return;}if(s.away){toast(`${s.first} ist gerade bei der Arbeit.`);return;}if(s.queue.length>=6){toast('Die Warteschlange ist voll.');return;}
    s.queue.push({id,def:ACTS[id],step:0,...extra});if(!s.cur)this.next(s);this.renderQueue();},
  next(s){s.cur=null;if(!s.queue.length){this.renderQueue();return;}s.cur=s.queue[0];s.cur.step=0;this.beginStep(s);this.renderQueue();},
  seatFree(seat,s){return!seat.by||seat.by===s.id;},
  beginStep(s){const c=s.cur,st=c.def.steps[c.step];this.standUp(s);let dest,seat=null;
    if(st.at==='point')dest=c.point;
    else if(st.at==='target'){const t=this.sims[c.target];if(!t||t.away||t.pose==='lie'){this.fail(s,t&&t.pose==='lie'?`${t.first} schläft.`:'Niemand da.');return;}
      const a=Math.atan2(s.x-t.x,s.z-t.z);const n=this.nearestFree(t.x+Math.sin(a)*.85,t.z+Math.cos(a)*.85);dest=this.cellPos(n[0],n[1]);}
    else{let best=null,bd=1e9;for(const o of this.objs){if(o.type!==st.at)continue;for(const se of o.seats){if(!this.seatFree(se,s))continue;const d=Math.hypot(se.a[0]-s.x,se.a[1]-s.z);if(d<bd){bd=d;best=se;}}}
      if(!best){this.fail(s,`${OBJ_NAMES[st.at]} ist besetzt.`);return;}seat=best;seat.by=s.id;dest=seat.a;}
    if(c.seat&&c.seat!==seat)c.seat.by=null;c.seat=seat;
    const p=this.path(s.x,s.z,dest[0],dest[1]);if(!p){this.fail(s,'Da komme ich nicht hin.');return;}
    s.path=p;c.phase='walk';c.t=0;},
  fail(s,msg){s.flags.say={t:3,txt:msg};if(s.cur&&s.cur.seat)s.cur.seat.by=null;s.queue.shift();this.next(s);},
  standUp(s){if(s.pose!=='stand'&&s.cur&&s.cur.seat){s.x=s.cur.seat.a[0];s.z=s.cur.seat.a[1];}else if(s.pose==='lie'){const n=this.nearestFree(s.x,s.z);if(n)[s.x,s.z]=this.cellPos(n[0],n[1]);}s.pose='stand';},
  cancel(s,idx){if(idx===0&&s.cur){if(s.cur.def.auto)return;if(s.cur.seat)s.cur.seat.by=null;this.standUp(s);s.queue.shift();this.next(s);}else s.queue.splice(idx,1);this.renderQueue();},
  finishStep(s){const c=s.cur,st=c.def.steps[c.step];
    if(st.then==='jobs'&&s.id===this.sel)this.openJobs(s);
    if(st.then==='vereine'&&s.id===this.sel)this.openVereine(s);
    if(st.then==='hike'||st.then==='bike'){const tr=this.nearTrail(st.then==='hike'?['hiking','foot']:['bicycle','mtb']);s.away=true;s.awayKind=st.then;s.hikeUntil=this.min+(st.then==='hike'?150:120);s.hikeName=tr;s.m.root.visible=false;
      toast(tr?`${s.first} ${st.then==='hike'?'wandert auf dem':'fährt die'} ${tr}.`:`${s.first} ${st.then==='hike'?'geht spazieren':'macht eine Velotour'}.`);if(c.seat)c.seat.by=null;s.queue=[];s.cur=null;this.renderQueue();this.renderPortraits();return;}
    if(st.then==='leaveClub'){s.away=true;s.awayKind='club';s.m.root.visible=false;toast(`${s.first} geht zum ${s.verein?s.verein.name:'Verein'}.`);if(c.seat)c.seat.by=null;s.queue=[];s.cur=null;this.renderQueue();this.renderPortraits();return;}
    if(st.then==='leave'){s.away=true;s.awayKind='work';s.earned=true;s.m.root.visible=false;toast(`${s.first} fährt mit dem Bus zur Arbeit.`);if(c.seat)c.seat.by=null;s.queue=[];s.cur=null;this.renderQueue();this.renderPortraits();return;}
    c.step++;if(c.step>=c.def.steps.length){if(c.seat)c.seat.by=null;this.standUp(s);s.queue.shift();this.next(s);}else this.beginStep(s);},

  autonomy(s){const best=[];const hasObj=t=>this.objs.some(o=>o.type===t&&o.seats.some(se=>this.seatFree(se,s)));
    const raining=this.wx&&this.wx.precip>.3,outdoor=['grill','view','paper'];
    for(const[id,d] of Object.entries(ACTS)){if(d.auto||id==='go'||id==='jobs'||id==='vereine'||id==='nap'||(d.minRel&&this.rel<d.minRel))continue;
      let tgt=null;if(d.social){tgt=this.sims.find(o=>o!==s&&!o.away&&o.pose!=='lie');if(!tgt)continue;}else if(!d.steps.every(st=>hasObj(st.at)))continue;
      let sc=0;for(const st of d.steps)for(const[k,v] of Object.entries(st.gain||{})){const gain=st.until?100-s.needs[k]:Math.min(100-s.needs[k],v*st.dur);const w=((100-s.needs[k])/100)**2*3+.04;sc+=Math.max(0,gain)*w;}
      if(id==='sleep'&&s.needs.energy>35)sc*=.1;if(raining&&outdoor.includes(id))sc*=.15;if(id==='foehn'&&!this.foehnActive)sc*=.3;if(id==='foehn'&&this.foehnActive)sc*=2.5;if(st0(d).cost&&this.money<50)sc=0;best.push([sc*(.8+Math.random()*.4),id,tgt]);}
    best.sort((a,b)=>b[0]-a[0]);const pick=best[0];if(pick&&pick[0]>8)this.enqueue(s,pick[1],pick[2]?{target:pick[2].id}:{});
    function st0(d){return d.steps[0];}},

  /* ---------- Simulation pro Frame ---------- */
  frame(dt){const gm=dt*[0,1,3,8][this.speed];
    if(gm>0)this.tickTime(gm);
    for(const s of this.sims)this.tickSim(s,gm,dt);
    this.updateCamera();this.updateLight();this.tickTransit();this.tickPrecip(dt);this.tickFireworks(dt);this.tickAmbient(dt);this.R.render(this.scene,this.cam);this.updateBubbles();
    this.uiT=(this.uiT||0)+dt;if(this.uiT>.25){this.uiT=0;this.renderPanel();this.renderClock();}},
  isoOf(day){const[y,m,d]=(this.startDay||Astro.todayVaduz()).split('-').map(Number);return new Date(Date.UTC(y,m-1,d)+day*864e5).toISOString().slice(0,10);},
  dowOf(day){return(new Date(this.isoOf(day)+'T12:00:00Z').getUTCDay()+6)%7;},
  tickTime(gm){const prevDay=Math.floor(this.min/1440);this.min+=gm;const day=Math.floor(this.min/1440),tod=this.min%1440,dow=this.dowOf(day);
    if(dow===0&&tod>=540&&this.lastBill<day+1&&day>0){this.lastBill=day+1;this.money-=520;toast('Wochenrechnungen bezahlt: CHF 520 (Krankenkasse, Strom, Lebensmittel).');}
    const hol=Cal.holidayOn(this.isoOf(day));
    for(const s of this.sims){if(!s.job)continue;const j=JOBS.find(x=>x.id===s.job);const work=dow<5&&!(hol&&(hol.frei||j.id==='bank'));
      if(!s.away&&work&&tod>=j.start-45&&tod<j.end-60&&!(s.cur&&s.cur.id==='work')){if(s.flags.out)continue;if(s.cur&&s.cur.seat)s.cur.seat.by=null;this.standUp(s);s.cur=null;s.queue=[];this.enqueue(s,'work');}
      if(s.away&&s.awayKind==='work'&&(!work||tod>=j.end+30||tod<j.start-60)){s.away=false;s.m.root.visible=true;s.x=9.5;s.z=9.8;if(s.earned){this.money+=j.pay;s.earned=false;toast(`${s.first} ist zurück von der Arbeit. Lohn: ${chf(j.pay)}.`);}this.renderPortraits();}}
    this.tickClubs(day,dow,tod);
    this.tickHikes();
    if(day!==prevDay){const iso=this.isoOf(day),[,mm,dd]=iso.split('-'),h=Cal.holidayOn(iso),f=Cal.ferienOn(iso),fp=Cal.ferienOn(this.isoOf(day-1));
      toast(`${['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'][dow]}, ${+dd}.${+mm}.${h?' · '+h.name+(h.frei?', arbeitsfrei':''):''}${f&&f!==fp?' · Beginn '+f:''}`);
      if(h&&h.name==='Staatsfeiertag')setTimeout(()=>toast('Heute Abend um 22 Uhr: Feuerwerk über dem Schloss Vaduz.'),1500);}},
  tickSim(s,gm,dt){const m=s.m,c=s.cur,st=c?c.def.steps[c.step]:null;
    // Bedürfnisse
    if(gm>0){const mode=s.away?'away':(st&&st.sleep&&c.phase==='do'||s.flags.out)?'sleep':'awake';const D=DECAY[mode];for(const[k] of NEEDS)s.needs[k]=clamp(s.needs[k]-D[k]/60*gm,0,100);
      if(!s.away){if(s.needs.bladder<=0){s.needs.bladder=100;s.needs.hygiene=0;s.needs.fun=Math.max(0,s.needs.fun-30);toast(`Oh nein, ${s.first} hat es nicht mehr zur Toilette geschafft.`);}
        if(s.needs.energy<=0&&!s.flags.out){s.flags.out=120;if(c&&c.seat)c.seat.by=null;s.queue=[];s.cur=null;s.pose='lie';toast(`${s.first} ist vor Erschöpfung eingeschlafen.`);this.renderQueue();}
        if(s.flags.out){s.needs.energy=clamp(s.needs.energy+.25*gm,0,100);s.flags.out-=gm;if(s.flags.out<=0){s.flags.out=0;this.standUp(s);}}}}
    if(s.away){return;}
    if(s.flags.say)s.flags.say.t-=dt;
    if(!s.flags.out){
      if(c&&c.phase==='walk'){const sp=1.7*Math.max(gm/dt||0,0);if(s.path&&s.path.length){const[tx,tz]=s.path[0];const dx=tx-s.x,dz=tz-s.z,d=Math.hypot(dx,dz);const mv=sp*dt;
          if(d<=mv||d<.01){s.x=tx;s.z=tz;s.path.shift();}else{s.x+=dx/d*mv;s.z+=dz/d*mv;s.yaw=Math.atan2(dx,dz);}s.phase+=mv*3.2;}
        if(!s.path||!s.path.length){if(c.seat&&c.seat.p){s.x=c.seat.p[0];s.z=c.seat.p[1];}if(c.seat)s.yaw=c.seat.yaw;
          if(st.at==='target'){const t=this.sims[c.target];if(!t||t.away){this.fail(s,'Weg.');return;}s.yaw=Math.atan2(t.x-s.x,t.z-s.z);if(!t.cur||t.cur.phase!=='walk'&&t.pose==='stand')t.yaw=Math.atan2(s.x-t.x,s.z-t.z);}
          if(st.cost){this.money-=st.cost;}
          s.pose=st.pose==='talk'||st.pose==='hug'?'stand':st.pose;c.phase='do';c.t=0;}}
      else if(c&&c.phase==='do'){c.t+=gm;for(const[k,v] of Object.entries(st.gain||{}))s.needs[k]=clamp(s.needs[k]+v*gm,0,100);
        if(st.at==='target'){const t=this.sims[c.target];if(!t||t.away||t.pose==='lie'){this.fail(s,'Gespräch beendet.');return;}for(const[k,v] of Object.entries(st.tgain||{}))t.needs[k]=clamp(t.needs[k]+v*gm,0,100);this.rel=clamp(this.rel+st.rel*gm,-100,100);if(!t.cur)t.flags.say={t:.3,txt:'…'};}
        const done=st.until?(s.needs[st.until]>=99.5||c.t>=st.dur):c.t>=st.dur;if(done)this.finishStep(s);}
      else if(!c){s.idle+=gm;if(s.idle>4&&gm>0){s.idle=0;this.autonomy(s);}}
      if(c)s.idle=0;}
    // Darstellung
    const walking=c&&c.phase==='walk'&&s.path&&s.path.length;const pose=s.flags.out?'lie':s.pose;
    m.root.position.set(s.x,0,s.z);m.root.rotation.y=pose==='lie'&&!s.flags.out?0:s.yaw;
    const sw=walking?Math.sin(s.phase)*.55:0;m.body.rotation.set(0,0,0);m.body.position.set(0,0,0);
    m.L.rotation.x=sw;m.R.rotation.x=-sw;m.AL.rotation.x=-sw*.8;m.AR.rotation.x=sw*.8;m.AL.rotation.z=0;m.AR.rotation.z=0;
    if(pose==='sit'){const y=(c&&c.seat&&c.seat.y)||.46;m.body.position.y=y-.86;m.L.rotation.x=-1.45;m.R.rotation.x=-1.45;m.AL.rotation.x=-.5;m.AR.rotation.x=-.5;}
    else if(pose==='lie'){const y=s.flags.out?.12:((c&&c.seat&&c.seat.y)||.62)+.1;m.body.rotation.x=-Math.PI/2;m.body.position.set(0,y,s.flags.out?0:.86);}
    if(c&&c.phase==='do'&&st.at==='target'){const t=performance.now()/180;m.AR.rotation.x=-.6+Math.sin(t)*.35;if(st.pose==='hug'){m.AL.rotation.x=-1.3;m.AR.rotation.x=-1.3;}}
    if(c&&c.phase==='do'&&(st.at==='stove'||st.at==='grill'||st.at==='sink')){const t=performance.now()/160;m.AL.rotation.x=-1.1+Math.sin(t)*.15;m.AR.rotation.x=-1.1-Math.sin(t)*.15;}
    if(c&&c.phase==='do'&&st.at==='desk'){const t=performance.now()/90;m.AL.rotation.x=-1.2+Math.sin(t)*.06;m.AR.rotation.x=-1.2-Math.sin(t)*.06;}
    const mood=this.mood(s);m.ring.material.color.set(mood>60?0x3a9c55:mood>35?0xde9d24:0xcf4237);m.ring.visible=s.id===this.sel;},
  mood(s){let v=0;for(const[k] of NEEDS)v+=s.needs[k];v/=NEEDS.length;for(const[k] of NEEDS)if(s.needs[k]<25)v-=(25-s.needs[k])*.5;return clamp(v,0,100);},

  /* ---------- Licht, Kamera ---------- */
  updateLight(){const day=Math.floor(this.min/1440),tod=this.min%1440,iso=this.isoOf(day),date=Astro.localToDate(iso,tod);
    const b=DATA.b[this.bIdx],R=this.real,px=R?R.ax:b[0],py=R?R.ay:b[1],[lat,lon]=localToWgs84(px,py);
    const sun=Astro.sun(date,lat,lon),moon=Astro.moon(date,lat,lon);
    const hk=iso+'T'+Math.floor(tod/60);if(this.wxKey!==hk){this.wxKey=hk;this.wx=Weather.at(px,py,iso,Math.floor(tod/60));this.fx=Weather.foehn(date);this.illum=Astro.moonIllum(date);this.renderWeather();}
    const wx=this.wx,cloud=wx?wx.cloud:.35,sm=(a,b2,x)=>{const t=clamp((x-a)/(b2-a),0,1);return t*t*(3-2*t);};
    const hz=this.horizon?this.horizon[Math.round(sun.az/2)%180]/10:0;
    const dayF=sm(-7,7,sun.alt),direct=sm(hz-.3,hz+2.2,sun.alt)*sm(-1,2,sun.alt);this.sunInfo={sun,moon,hz,direct};
    const toV=R&&R.toV?R.toV:(dx,dy)=>[dx,-dy];
    const useMoon=direct<.02&&moon.alt>Math.max(2,this.horizon?this.horizon[Math.round(moon.az/2)%180]/10:0);
    const body=useMoon?moon:sun,cb=Math.cos(body.alt*Math.PI/180),[vx,vz]=toV(Math.sin(body.az*Math.PI/180)*cb,Math.cos(body.az*Math.PI/180)*cb),vy=Math.max(.08,Math.sin(body.alt*Math.PI/180));
    this.sun.position.set(this.view.tx+vx*90,vy*90,this.view.tz+vz*90);this.sun.target.position.set(this.view.tx,0,this.view.tz);
    const moonLight=useMoon?.16*(this.illum?this.illum.fraction:.5)*(1-.8*cloud):0;
    this.sun.intensity=useMoon?moonLight:direct*(1-.78*cloud)*.78;this.sun.color.set(useMoon?0xaabbe0:(sun.alt<8?0xffc89a:0xfff3dd));this.sun.castShadow=this.sun.intensity>.05;
    this.hemi.intensity=.13+dayF*(.36-.14*cloud)+moonLight*.5;
    const night=new THREE.Color(0x0c1426),clear=new THREE.Color(0xa7cbe6),grey=new THREE.Color(0xaeb6bf),dusk=new THREE.Color(0xe9a37a);
    const sky=night.clone().lerp(clear.clone().lerp(grey,clamp(cloud*1.1,0,1)),dayF);
    if(sun.alt>-6&&sun.alt<9)sky.lerp(dusk,.32*(1-cloud)*(1-Math.abs(sun.alt-1)/9));
    if(wx&&wx.precip>.2)sky.lerp(new THREE.Color(0x7d858e),clamp(wx.precip/4,0,.5)*dayF);
    this.scene.background=sky;this.scene.fog.color.copy(sky);const vis=wx?clamp(wx.vis,180,2000):1500;this.scene.fog.far=Math.min(900,vis);this.scene.fog.near=this.scene.fog.far*.12;
    this.lamps.forEach(l=>l.intensity=dayF<.3?.9:0);
    if(this.tvScreen){const on=this.sims.some(s=>s.cur&&s.cur.id==='tv'&&s.cur.phase==='do');this.tvScreen.material.color.set(on?0x7fb6ff:0x14181d);}
    this.updatePrecip(wx);},
  renderWeather(){const el=$('#wx');if(!el)return;const wx=this.wx,fx=this.fx;
    if(!wx){el.textContent=Weather.data?'Wetter: keine Vorhersage für diesen Tag':'Wetter nicht verfügbar';el.title='';return;}
    el.innerHTML=`<b>${Math.round(wx.temp)}°</b> ${esc(wx.text)}${wx.gust>45?' · Böen '+Math.round(wx.gust)+' km/h':''}${fx&&fx.value>=1?` · <span class="foehn">${esc(fx.text||'Föhn')}</span>`:''}`;
    el.title=`Wetter ${wx.point} (Open-Meteo)${fx?`, Föhnindex ${fx.station} (MeteoSchweiz)`:''}`;this.foehnActive=!!(fx&&fx.value>=2);},
  updatePrecip(wx){const want=wx&&wx.precip>.1?(wx.snow>0||wx.temp<.8?'snow':'rain'):null;const P=this.precip;
    if(!want){if(P)P.pts.visible=false;return;}
    if(!P||P.kind!==want){if(P)this.scene.remove(P.pts);const n=want==='snow'?2500:4000,pos=new Float32Array(n*3);for(let i=0;i<n;i++){pos[i*3]=(Math.random()-.5)*90;pos[i*3+1]=Math.random()*45;pos[i*3+2]=(Math.random()-.5)*90;}
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));
      const pts=new THREE.Points(g,new THREE.PointsMaterial({color:want==='snow'?0xffffff:0xaec4dc,size:want==='snow'?.28:.12,transparent:true,opacity:want==='snow'?.9:.7,depthWrite:false}));
      this.scene.add(pts);this.precip={kind:want,pts,n};}
    const Q=this.precip;Q.pts.visible=true;Q.pts.position.set(this.view.tx,0,this.view.tz);Q.pts.geometry.setDrawRange(0,Math.floor(Q.n*clamp(wx.precip/3,.15,1)));},
  tickPrecip(dt){const Q=this.precip;if(!Q||!Q.pts.visible)return;const a=Q.pts.geometry.attributes.position,v=Q.kind==='snow'?1.4:16,mult=Math.max(.3,[0,1,1.6,2.2][this.speed]||.3);
    for(let i=0;i<a.count;i++){let y=a.array[i*3+1]-v*dt*mult;if(y<0)y+=45;a.array[i*3+1]=y;if(Q.kind==='snow')a.array[i*3]+=Math.sin(y+i)*.01;}a.needsUpdate=true;},
  updateCamera(){const v=this.view;v.pitch=clamp(v.pitch,.18,1.35);v.dist=clamp(v.dist,7,90);v.tx=clamp(v.tx,-80,80);v.tz=clamp(v.tz,-80,80);
    this.cam.position.set(v.tx+Math.sin(v.yaw)*Math.cos(v.pitch)*v.dist,Math.sin(v.pitch)*v.dist,v.tz+Math.cos(v.yaw)*Math.cos(v.pitch)*v.dist);this.cam.lookAt(v.tx,.8,v.tz);},
  bindInput(){const c=$('#gc'),pts=new Map();let moved=0,btn=0,pinch=null;const ray=new THREE.Raycaster(),nd=new THREE.Vector2();
    const cast=(e,list)=>{nd.set(e.clientX/innerWidth*2-1,-e.clientY/innerHeight*2+1);ray.setFromCamera(nd,this.cam);return ray.intersectObjects(list,true);};
    c.addEventListener('contextmenu',e=>e.preventDefault());
    c.addEventListener('pointerdown',e=>{c.setPointerCapture(e.pointerId);pts.set(e.pointerId,[e.clientX,e.clientY]);moved=0;btn=e.button;this.hideCtx();
      if(pts.size===2){const p=[...pts.values()];pinch={d:Math.hypot(p[0][0]-p[1][0],p[0][1]-p[1][1]),a:Math.atan2(p[1][1]-p[0][1],p[1][0]-p[0][0])};}});
    c.addEventListener('pointermove',e=>{if(pts.has(e.pointerId)){const prev=pts.get(e.pointerId);pts.set(e.pointerId,[e.clientX,e.clientY]);const dx=e.clientX-prev[0],dy=e.clientY-prev[1];moved+=Math.abs(dx)+Math.abs(dy);
        if(pts.size===2&&pinch){const p=[...pts.values()];const d=Math.hypot(p[0][0]-p[1][0],p[0][1]-p[1][1]),a=Math.atan2(p[1][1]-p[0][1],p[1][0]-p[0][0]);this.view.dist*=pinch.d/d;this.view.yaw-=(a-pinch.a);pinch.d=d;pinch.a=a;moved=99;return;}
        if(moved<5)return;const v=this.view;if(btn===2||e.shiftKey){v.yaw-=dx*.006;v.pitch+=dy*.004;}else{const k=v.dist/innerHeight*1.1;const cs=Math.cos(v.yaw),sn=Math.sin(v.yaw);v.tx-=(dx*cs+dy*sn/Math.max(.4,Math.sin(v.pitch)))*k;v.tz-=(-dx*sn+dy*cs/Math.max(.4,Math.sin(v.pitch)))*k;}}
      else if(e.pointerType==='mouse'&&this.nbPick){const now=performance.now();if(now-(this.lastHover||0)<60)return;this.lastHover=now;const h=cast(e,this.nbPick)[0];const tip=$('#gtip');
        if(h){const ni=h.object.userData.nb;const b=DATA.b[ni];tip.hidden=false;tip.textContent=ni>=0?`${addr(b)} · ${CAT_SHORT[b[2]]}`:'Nebengebäude ohne Registereintrag';tip.style.left=e.clientX+'px';tip.style.top=e.clientY+'px';}else tip.hidden=true;}});
    const up=e=>{if(!pts.has(e.pointerId))return;pts.delete(e.pointerId);if(pts.size<2)pinch=null;if(moved<5&&pts.size===0&&btn===0)this.click(e,cast);};
    c.addEventListener('pointerup',up);c.addEventListener('pointercancel',e=>pts.delete(e.pointerId));
    c.addEventListener('wheel',e=>{e.preventDefault();this.view.dist*=Math.exp(e.deltaY*.0012);},{passive:false});},
  click(e,cast){const s=this.sims[this.sel];
    const simMeshes=this.sims.filter(x=>!x.away).map(x=>x.m.root);const hs=cast(e,simMeshes)[0];
    if(hs){let o=hs.object;while(o.parent&&!simMeshes.includes(o))o=o.parent;const t=this.sims.find(x=>x.m.root===o);
      if(t===s){this.showCtx(e,`${s.first}`,[{label:'Kamera folgen',fn:()=>{this.view.tx=s.x;this.view.tz=s.z;}}]);return;}
      this.showCtx(e,t.first,[{label:`${t.first} auswählen`,fn:()=>this.select(t.id)},...['chat','joke','foehn','hug','kiss'].map(id=>{const d=ACTS[id];const ok=!d.minRel||this.rel>=d.minRel;return{label:d.label+(ok?'':` (Beziehung ${d.minRel}+)`),dis:!ok||t.pose==='lie',fn:()=>this.enqueue(s,id,{target:t.id})};})]);return;}
    const ho=cast(e,[this.house])[0];if(ho&&ho.object.userData.ref&&ho.object.userData.ref.type!=='tree'){const ob=ho.object.userData.ref;const acts=OBJ_ACTS[ob.type]||[];
      if(acts.length){this.showCtx(e,OBJ_NAMES[ob.type]||ob.type,acts.map(id=>({label:ACTS[id].label+(ACTS[id].steps[0].cost?` (CHF ${ACTS[id].steps.reduce((a,x)=>a+(x.cost||0),0)})`:''),fn:()=>this.enqueue(s,id)})));return;}}
    if(this.nbPick){const hn=cast(e,this.nbPick)[0];if(hn){const ni=hn.object.userData.nb;if(ni<0){toast('Nebengebäude ohne Eintrag im Gebäuderegister');return;}const b=DATA.b[ni];toast(`${addr(b)}, ${place(b)} · ${DATA.cats[b[2]]}`);return;}}
    const hg=cast(e,[this.world])[0];if(hg){const p=hg.point;if(Math.abs(p.x)<12.5&&Math.abs(p.z)<11){this.enqueue(s,'go',{point:[p.x,p.z]});}else toast('Das ist nicht euer Grundstück.');}},
  showCtx(e,title,items){const m=$('#ctx');m.innerHTML=`<div class="ch">${esc(title)}</div>`;items.forEach(it=>{const b=document.createElement('button');b.textContent=it.label;b.disabled=!!it.dis;b.onclick=()=>{this.hideCtx();it.fn();};m.appendChild(b);});
    m.hidden=false;const r=m.getBoundingClientRect();m.style.left=clamp(e.clientX+8,8,innerWidth-r.width-8)+'px';m.style.top=clamp(e.clientY-10,8,innerHeight-r.height-8)+'px';},
  hideCtx(){$('#ctx').hidden=true;},
  select(i){this.sel=i;const s=this.sims[i];if(!s.away){this.view.tx=s.x;this.view.tz=s.z;}this.renderPortraits();this.renderPanel();this.renderQueue();},

  /* ---------- UI ---------- */
  renderPortraits(){$('#portraits').innerHTML=this.sims.map(s=>`<button class="portrait" data-i="${s.id}" aria-pressed="${s.id===this.sel}" style="background:${SHIRTS[s.look.shirt]};border-color:${this.mood(s)>60?'var(--good)':this.mood(s)>35?'var(--warn)':'var(--bad)'}" aria-label="${esc(s.first)} auswählen">${esc(s.first[0])}${s.away?'<span class="away">Arbeit</span>':''}</button>`).join('');
    $('#portraits').querySelectorAll('button').forEach(b=>b.onclick=()=>this.select(+b.dataset.i));},
  renderPanel(){const s=this.sims[this.sel];if(!s)return;const j=s.job&&JOBS.find(x=>x.id===s.job);
    $('#simName').textContent=`${s.first} ${this.family}`;$('#simJob').textContent=j?`${j.name}, ${j.place} · ${hhmm(j.start)} bis ${hhmm(j.end)}${s.away?' · gerade bei der Arbeit':''}`:'Ohne Job. Stellenanzeigen am Computer.';
    $('#needs').innerHTML=NEEDS.map(([k,l])=>{const v=s.needs[k];return`<div class="need"><span>${l}</span><div class="bar"><i style="width:${v}%;background:${v>55?'var(--good)':v>25?'var(--warn)':'var(--bad)'}"></i></div></div>`;}).join('');
    const o=this.sims.find(x=>x!==s);if(o){const r=this.rel;$('#rel').innerHTML=`<span>Beziehung zu ${esc(o.first)}: <b>${Math.round(r)}</b></span><div class="need"><div class="bar"><i style="width:${(r+100)/2}%;background:${r>=0?'var(--blue)':'var(--bad)'}"></i></div></div>`;}
    const pp=$('#portraits').querySelectorAll('.portrait');this.sims.forEach((x,k)=>{if(pp[k]){const md=this.mood(x);pp[k].style.borderColor=md>60?'var(--good)':md>35?'var(--warn)':'var(--bad)';}});
    $('#money').textContent=chf(this.money);$('#money').style.color=this.money<0?'var(--bad)':'var(--good)';},
  renderClock(){const day=Math.floor(this.min/1440),iso=this.isoOf(day);const[,mm,dd]=iso.split('-');$('#clock').textContent=`${DAYS[this.dowOf(day)]} ${+dd}.${+mm}. ${hhmm(this.min)}`;
    if(this.calKey!==iso){this.calKey=iso;const h=Cal.holidayOn(iso),f=Cal.ferienOn(iso);$('#clockSub').textContent=[h?h.name+(h.frei?'':' (Bankfeiertag)'):null,f].filter(Boolean).join(' · ');}},
  renderQueue(){const s=this.sims[this.sel];const q=$('#queue');if(!s){q.innerHTML='';return;}
    q.innerHTML=s.queue.map((a,k)=>`<div class="qi"><span>${esc(a.def.label)}${a.target!=null&&this.sims[a.target]?' mit '+esc(this.sims[a.target].first):''}</span>${a.def.auto&&k===0?'':`<button data-k="${k}" aria-label="Abbrechen">×</button>`}</div>`).join('');
    q.querySelectorAll('button').forEach(b=>b.onclick=()=>this.cancel(s,+b.dataset.k));},
  updateBubbles(){const v=new THREE.Vector3();for(const s of this.sims){const b=s.bub;if(s.away){b.textContent='';continue;}
      let txt='',alert=false;const c=s.cur;if(s.flags.say&&s.flags.say.t>0)txt=s.flags.say.txt;else if(s.flags.out)txt='Zzz';else if(c&&c.phase==='do'){const st=c.def.steps[c.step];txt=st.bub||'';}
      else if(!c){const low=NEEDS.filter(([k])=>s.needs[k]<22).sort((a,b)=>s.needs[a[0]]-s.needs[b[0]])[0];if(low){txt=low[1]+'!';alert=true;}}
      if(b.textContent!==txt)b.textContent=txt;b.classList.toggle('alert',alert);if(!txt)continue;
      v.set(s.x,(s.pose==='lie'||s.flags.out)?1.3:s.pose==='sit'?1.75:2.25,s.z).project(this.cam);b.style.left=((v.x+1)/2*innerWidth)+'px';b.style.top=((1-v.y)/2*innerHeight)+'px';b.style.visibility=v.z<1?'visible':'hidden';}},
  openJobs(s){const m=$('#modal');m.hidden=false;
    m.innerHTML=`<div class="mcard" role="dialog" aria-labelledby="jh"><h2 id="jh">Stellenanzeigen</h2><div class="hint">Für ${esc(s.first)}. Montag bis Freitag, Abfahrt mit dem Bus 45 Minuten vor Arbeitsbeginn.</div>
      <div class="jobs">${JOBS.map(j=>`<button class="job" data-j="${j.id}"><span><b>${esc(j.name)}</b><small>${esc(j.place)} · ${hhmm(j.start)} bis ${hhmm(j.end)}${s.job===j.id?' · aktuell':''}</small></span><span class="pay">${chf(j.pay)}/Tag</span></button>`).join('')}</div>
      <div class="trow">${s.job?'<button class="btn ghost" id="quit">Job kündigen</button>':''}<button class="btn ghost" id="jclose">Schliessen</button></div></div>`;
    m.querySelectorAll('.job').forEach(b=>b.onclick=()=>{s.job=b.dataset.j;m.hidden=true;const j=JOBS.find(x=>x.id===s.job);toast(`${s.first} arbeitet jetzt als ${j.name} in ${j.place}.`);this.renderPanel();this.save();});
    $('#jclose').onclick=()=>m.hidden=true;if($('#quit'))$('#quit').onclick=()=>{s.job=null;m.hidden=true;this.renderPanel();};},
};

/* =====================================================================
   START
   ===================================================================== */
function start(){
  fetch('data/gwr.json').then(r=>{if(!r.ok)throw new Error(r.status);return r.json();}).then(d=>{DATA=d;MapV.init();$('#loadMsg').textContent='Lade Vermessung, Fahrplan und Wetter …';
    Tiles.init().then(ok=>{$('#loadMsg').textContent=ok?'':'Vermessungsdaten nicht erreichbar, Umgebung wird generiert.';if(ok){Transit.load().then(()=>MapV.dirty=true);Weather.load();Vereine.load().then(()=>{if(MapV.sel>=0)MapV.select(MapV.sel,false);});Density.load().then(()=>{MapV.dirty=true;});}showSave();MapV.dirty=true;});
    setInterval(()=>{Weather.load().then(()=>{Game.wxKey=null;});},30*60*1000);
    const showSave=()=>{const sv=store.get(SAVE_KEY);if(sv&&DATA.b[sv.bIdx]){$('#contBtn').hidden=false;const b=DATA.b[sv.bIdx];$('#contBtn').textContent=`Weiterspielen: Familie ${sv.family}`;$('#loadMsg').textContent=`Gespeichert: ${addr(b)}, ${DATA.gems[b[3]]}`;MapV.home=sv.bIdx;$('#contBtn').onclick=()=>Game.load(sv);}};
    const pick=m=>{MapV.mode=m;$('#title').hidden=true;$('#modeHint').textContent=m==='drive'?'Fahrmodus: Wähle die Startadresse.':'Lebensmodus: Wähle ein Wohnhaus.';$('#modeHint').hidden=false;if(MapV.sel!=null&&MapV.sel>=0)MapV.select(MapV.sel,false);$('#q').focus({preventScroll:true});};
    $('#newBtn').onclick=()=>pick('house');$('#warBtn').onclick=()=>War.open();$('#driveBtn').onclick=()=>pick('drive');$('#modeHint').onclick=()=>{$('#title').hidden=false;};
  }).catch(e=>{$('#loadMsg').textContent='Das Gebäuderegister konnte nicht geladen werden. Bitte Seite neu laden.';console.error(e);});
}
start();
