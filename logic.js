'use strict';
/* ================= Utilitas ================= */
const $=(s,el=document)=>el.querySelector(s);
const nf0=new Intl.NumberFormat('id-ID',{maximumFractionDigits:0});
const nf1=new Intl.NumberFormat('id-ID',{minimumFractionDigits:1,maximumFractionDigits:1});
const nf2=new Intl.NumberFormat('id-ID',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmt=n=>nf0.format(n),f1=n=>nf1.format(n),f2=n=>nf2.format(n);
const rp=n=>'Rp '+nf0.format(Math.round(n));
const rpShort=n=>{const a=Math.abs(n);return a>=1e9?'Rp '+nf1.format(n/1e9)+' M':a>=1e6?'Rp '+nf1.format(n/1e6)+' jt':'Rp '+nf0.format(n)};
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const sum=a=>a.reduce((x,y)=>x+y,0);
const avg=a=>a.length?sum(a)/a.length:0;
const stdev=a=>{if(a.length<2)return 0;const m=avg(a);return Math.sqrt(sum(a.map(v=>(v-m)**2))/(a.length-1))};
const pad=(n,w)=>String(n).padStart(w,'0');
function hash01(str){let h=2166136261;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619)}return((h>>>0)%10000)/10000}
function rng(seed){let a=seed>>>0;return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const TODAY='2026-11-03';
const addDays=(iso,n)=>{const d=new Date(iso+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const dFmt=iso=>new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(iso+'T00:00:00Z'));
const dFmtY=iso=>new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(iso+'T00:00:00Z'));

/* ================= Rumus teknik industri (fungsi murni) ================= */
const Z_TABLE={90:1.28,95:1.65,97.5:1.96,99:2.33,99.5:2.58};
const eoqF=(D,S,H)=>(D>0&&H>0&&S>0)?Math.sqrt(2*D*S/H):0;
const ssF=(z,sd,L)=>z*sd*Math.sqrt(L);
const ropF=(d,L,ss)=>d*L+ss;
function classifyABC(vals){ // vals: [{id,val}] -> Map id->'A'|'B'|'C'
  const sorted=vals.slice().sort((a,b)=>b.val-a.val),tot=sum(sorted.map(v=>v.val)),m=new Map();let cum=0;
  sorted.forEach((v,i)=>{cum+=v.val;const sh=tot?cum/tot:1;m.set(v.id,i===0||sh<=0.80?'A':sh<=0.95?'B':'C')});return m}
const classifyXYZ=cv=>cv<0.5?'X':cv<=1.0?'Y':'Z';
function tripLen(pts,dock){let cx=dock.x,cy=dock.y,len=0;const rest=pts.slice();
  while(rest.length){let bi=0,bd=1e9;rest.forEach((p,i)=>{const d=Math.abs(p.x-cx)+Math.abs(p.y-cy);if(d<bd){bd=d;bi=i}});const p=rest.splice(bi,1)[0];len+=bd;cx=p.x;cy=p.y}
  return len+Math.abs(cx-dock.x)+Math.abs(cy-dock.y)}

/* ================= Geometri gudang ================= */
const G={ZW:24,ZH:16,CW:2.4,CH:2,GAP:4,COLS:10,ROWS:8,DOCK:{x:-3,y:18}};
const ZONES=['A','B','C','D','E','F'];
function buildLocs(){const locs=[];
  ZONES.forEach((z,zi)=>{const zc=zi%3,zr=Math.floor(zi/3);
    for(let r=1;r<=G.ROWS;r++)for(let c=1;c<=G.COLS;c++){
      const level=((r-1)%4)+1,side=r<=4?1:2;
      const x=zc*(G.ZW+G.GAP)+(c-0.5)*G.CW,y=zr*(G.ZH+G.GAP)+(r-0.5)*G.CH;
      locs.push({id:`${z}${side}-${pad(c,2)}-${level}`,zone:z,zc,zr,r,c,level,x,y,dist:Math.abs(x-G.DOCK.x)+Math.abs(y-G.DOCK.y),skuId:null,units:0,cap:0})}});
  const mx=Math.max(...locs.map(l=>l.dist));
  locs.forEach(l=>{l.dn=l.dist/mx;l.ergo=l.level===1?0.5:(l.level===4?1:0);l.cost=0.7*l.dn+0.3*l.ergo});
  return locs}

/* ================= State data ================= */
const VERSION='wms-ti-demo-v2',KEY='wms-ti-demo-db',THEME_KEY='wms-ti-theme';
const DEF_SET={sl:95,S:150000,hr:0.25};
let DB=null,IDX=null,STORAGE_OK=true;
function reindex(){IDX={sku:new Map(DB.skus.map(s=>[s.id,s])),loc:new Map(DB.locs.map(l=>[l.id,l])),sup:new Map(DB.suppliers.map(s=>[s.id,s]))}}

function recompute(){
  const t0=performance.now(),{sl,S,hr}=DB.settings,z=Z_TABLE[sl]||1.65;
  const items=DB.skus.map(s=>{const D=sum(s.monthly),m=D/12,sd=stdev(s.monthly);return{s,D,m,sd,val:D*s.price}});
  const abc=classifyABC(items.map(i=>({id:i.s.id,val:i.val})));
  items.forEach(i=>{const s=i.s,L=IDX.sup.get(s.supplierId).L,cv=i.m>0?i.sd/i.m:0,d=i.D/365,sdd=i.sd/Math.sqrt(30),H=s.price*hr;
    const ssx=ssF(z,sdd,L),eo=Math.max(1,Math.ceil(eoqF(i.D,S,H))),rp0=ropF(d,L,ssx);
    s.dv={D:i.D,d,sd:i.sd,sdd,cv,val:i.val,abc:abc.get(s.id),xyz:classifyXYZ(cv),L,H,z,ssx,ss:Math.ceil(ssx),eoq:eo,rop:Math.ceil(rp0),freq:i.D/s.lq}});
  return performance.now()-t0}

/* ----- Seed ----- */
function seedDb(){
  const R=rng(20261103);
  const gauss=()=>{let u=0;while(u===0)u=R();const v=R();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)};
  const rnd=(a,b)=>a+(b-a)*R(),pick=a=>a[Math.floor(R()*a.length)];
  const shuffle=a=>{a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(R()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
  const suppliers=[['S01','PT Sinar Bearing Nusantara',7],['S02','PT Bautindo Mandiri',4],['S03','CV Lubrindo Jaya',5],['S04','PT Filtra Karya',10],['S05','PT Kabelindo Perkasa',14],['S06','PT Safety Prima',6],['S07','PT Global Bearing Import',21],['S08','PT Mitra Fastener',3],['S09','PT Pelumas Utama',9],['S10','PT Kabel Metal Sejahtera',18],['S11','CV Teknik Filtrasi',12],['S12','PT Pelindung Kerja Abadi',8]].map(a=>({id:a[0],name:a[1],L:a[2]}));
  const CATSUP={'Bearing':['S01','S07'],'Baut & Mur':['S02','S08'],'Pelumas':['S03','S09'],'Filter':['S04','S11'],'Kabel':['S05','S10'],'APD':['S06','S12']};
  const items=[];
  const add=(cat,code,name,price,uom,base,lq)=>items.push({cat,code,name,price:Math.max(100,Math.round(price/100)*100),uom,base,lq});
  /* Bearing 70 */
  ['6000','6001','6002','6003','6004','6005','6200','6201','6202','6203','6204','6205','6206','6207','6208','6209','6300','6301','6302','6303','6304','6305','6306','6307'].forEach(t=>['2RS','ZZ'].forEach(s=>{const n=+t.slice(-2),k=t[1]==='3'?1.6:t[1]==='2'?1.2:1;add('Bearing',`BRG-${t}-${s}`,`Bearing bola ${t}-${s}`,(22000+n*6500)*k*(s==='2RS'?1.12:1),'pcs',90,3)}));
  ['NU204','NU205','NU206','NU207','NU208','NU209','NU210','NU212'].forEach(t=>add('Bearing',`BRG-${t}-E`,`Bearing rol silinder ${t}E`,95000+(+t.slice(-2))*16000,'pcs',40,2));
  ['22208','22209','22210','22211','22212','22214'].forEach(t=>add('Bearing',`BRG-${t}-E`,`Bearing rol bola ${t}E`,230000+(+t.slice(-2))*32000,'pcs',25,1));
  ['30204','30205','30206','30207','30208','30209'].forEach(t=>add('Bearing',`BRG-${t}-J2`,`Bearing rol tirus ${t} J2`,80000+(+t.slice(-2))*11000,'pcs',35,2));
  ['51104','51105'].forEach(t=>add('Bearing',`BRG-${t}`,`Bearing aksial ${t}`,60000+(+t.slice(-2))*5000,'pcs',20,2));
  /* Baut & Mur 70 */
  {const L={6:[16,25,40],8:[20,30,50],10:[25,40,60,80],12:[30,50,60,80],14:[40,60,80],16:[40,60,80,100],20:[60,80,100],24:[80,100]};
   Object.keys(L).forEach(sz=>L[sz].forEach(len=>['8.8','10.9'].forEach(g=>add('Baut & Mur',`BMR-M${sz}x${len}-${g}`,`Baut hex M${sz}×${len} kelas ${g}`,300+sz*len*7.5*(g==='10.9'?1.5:1),'pcs',2500,50))));
   [6,8,10,12,14,16,20,24].forEach(sz=>{add('Baut & Mur',`BMR-NUT-M${sz}`,`Mur hex M${sz} kelas 8`,150+sz*sz*10,'pcs',3000,60);add('Baut & Mur',`BMR-WSH-M${sz}`,`Ring pir M${sz} galvanis`,60+sz*sz*4,'pcs',3500,80)});
   add('Baut & Mur','BMR-ANC-M12x120','Baut angkur M12×120',9000,'pcs',400,20);add('Baut & Mur','BMR-ANC-M16x150','Baut angkur M16×150',18000,'pcs',250,10)}
  /* Pelumas 30 */
  [['GRS-EP2','Grease EP2 lithium',78000,'kg'],['HYD46','Oli hidrolik ISO VG 46',38000,'L'],['HYD68','Oli hidrolik ISO VG 68',40000,'L'],['GER150','Oli gear ISO VG 150',42000,'L'],['GER220','Oli gear ISO VG 220',44000,'L'],['CMP68','Oli kompresor ISO VG 68',52000,'L'],['ENG15W40','Oli mesin 15W-40',46000,'L'],['CUTSOL','Cairan pemotong larut air',36000,'L'],['TRF32','Oli trafo ISO VG 32',55000,'L'],['CHNLUB','Pelumas rantai tahan panas',85000,'L']].forEach(p=>
    [[5,'05',0,60,2],[20,'20',0.06,90,2],[200,'200',0.12,12,1]].forEach(k=>add('Pelumas',`PLM-${p[0]}-${k[1]}${p[3]==='kg'?'K':'L'}`,`${p[1]} ${k[0]} ${p[3]}`,p[2]*k[0]*(1-k[2]),k[0]===200?'drum':'pail',k[3],k[4])));
  /* Filter 45 */
  {const used=new Set();[['OIL','Filter oli spin-on',70000,8],['HYD','Filter hidrolik return line',210000,8],['AIR','Filter udara primer',180000,8],['FUL','Filter solar & separator air',95000,8],['CMP','Elemen separator kompresor',650000,7],['PNL','Elemen filter udara panel',45000,6]].forEach(t=>{let n=0;while(n<t[3]){const num=1000+Math.floor(R()*9000);if(used.has(num))continue;used.add(num);n++;add('Filter',`FLT-${t[0]}-${num}`,`${t[1]} tipe ${num}`,t[2]*rnd(.7,1.6),'pcs',60,2)}})}
  /* Kabel 35 */
  {const cb=[['NYY',2,2.5],['NYY',4,10],['NYY',4,16],['NYY',4,25],['NYY',4,50],['NYM',3,1.5],['NYM',3,2.5],['NYM',3,4],['NYAF',1,1.5],['NYAF',1,2.5],['NYAF',1,6],['NYAF',1,10],['NYAF',1,16],['NYYHY',4,1.5],['NYYHY',7,1.5],['NYYHY',12,1.5],['NYCY',4,16],['NYCY',4,25],['NYA',1,2.5],['NYA',1,4],['NYFGbY',4,16]];
   const pm=c=>4000+c[1]*c[2]*2200;
   cb.forEach(c=>add('Kabel',`KBL-${c[0]}-${c[1]}x${c[2]}-R100`,`Kabel ${c[0]} ${c[1]}×${c[2]} mm² (roll 100 m)`,pm(c)*100,'roll',14,1));
   cb.slice(0,14).forEach(c=>add('Kabel',`KBL-${c[0]}-${c[1]}x${c[2]}-R500`,`Kabel ${c[0]} ${c[1]}×${c[2]} mm² (drum 500 m)`,pm(c)*500*.95,'drum',3,1))}
  /* APD 50 */
  ['Putih','Kuning','Biru','Merah'].forEach(c=>add('APD',`APD-HLM-${c.slice(0,3).toUpperCase()}`,`Helm safety HDPE ${c}`,68000,'pcs',160,4));
  [['Katun',9000,'KTN'],['Kulit',38000,'KLT'],['Nitril',22000,'NTR'],['Anti-potong',85000,'ATP']].forEach(g=>['L','XL'].forEach(sz=>add('APD',`APD-GLV-${g[2]}-${sz}`,`Sarung tangan ${g[0]} ${sz}`,g[1],'pasang',700,12)));
  [['Bening',28000],['Gelap',30000],['Anti-kabut',45000]].forEach(g=>add('APD',`APD-GGL-${g[0].slice(0,3).toUpperCase()}`,`Kacamata safety ${g[0]}`,g[1],'pcs',300,6));
  [['N95 (box 20)',185000,'N95'],['Respirator half-face',320000,'RSP'],['Katup karbon (box 10)',140000,'KRB'],['Cartridge filter',95000,'CRT']].forEach(g=>add('APD',`APD-MSK-${g[2]}`,`Masker ${g[0]}`,g[1],'pcs',90,3));
  [['Earplug (box 100)',90000,'EPL'],['Earmuff SNR 27',145000,'EM27'],['Earmuff SNR 31',210000,'EM31']].forEach(g=>add('APD',`APD-EAR-${g[2]}`,g[0],g[1],'pcs',60,2));
  ['M','L','XL'].forEach(sz=>add('APD',`APD-VST-${sz}`,`Rompi reflektif ${sz}`,52000,'pcs',120,4));
  [39,40,41,42,43,44,45].forEach(sz=>{add('APD',`APD-SHO-L${sz}`,`Sepatu safety rendah no. ${sz}`,395000,'pasang',40,1);add('APD',`APD-SHO-B${sz}`,`Sepatu safety boot no. ${sz}`,520000,'pasang',40,1)});
  ['M','L','XL','XXL'].forEach(sz=>add('APD',`APD-CVR-${sz}`,`Coverall kerja ${sz}`,165000,'pcs',90,2));
  ['S','M','L'].forEach(sz=>add('APD',`APD-HRN-${sz}`,`Full body harness ${sz}`,680000,'pcs',20,1));
  ['M','L','XL','XXL'].forEach(sz=>add('APD',`APD-RAN-${sz}`,`Jas hujan ${sz}`,78000,'pcs',80,3));

  const skus=items.map((it,i)=>{
    const D0=it.base*Math.exp(gauss()*0.85-0.3),m=D0/12,r=R(),noise=r<.45?rnd(.12,.38):r<.75?rnd(.45,.85):rnd(1,1.9),amp=rnd(.05,.25),ph=rnd(0,12);
    const monthly=Array.from({length:12},(_,k)=>Math.max(0,Math.round(m*(1+amp*Math.sin(2*Math.PI*(k+ph)/12)+noise*gauss()))));
    if(sum(monthly)===0)monthly[11]=1;
    return{id:'K'+pad(i+1,3),code:it.code,name:it.name,cat:it.cat,uom:it.uom,price:it.price,monthly,lq:Math.max(1,Math.round(it.lq*Math.exp(gauss()*.3))),supplierId:pick(CATSUP[it.cat]),staging:0,locIds:[],cap:0,ageD:Math.round(rnd(3,190))}});

  DB={v:VERSION,settings:{...DEF_SET},suppliers,skus,locs:buildLocs(),pos:[],orders:[],tasks:[],moves:[],variances:[],wave:null,kpi:{},cycle:{counted:600,matched:590,batch:0,ptr:{A:0,B:0,C:0}},d2s:[],pickLog:[],layout0:{},seq:{po:420,pt:4,wv:1,so:1261}};
  reindex();recompute();

  /* anomali sengaja */
  const A=skus.filter(s=>s.dv.abc==='A').sort((a,b)=>b.dv.val-a.dv.val),B=shuffle(skus.filter(s=>s.dv.abc==='B'));
  const crit=new Set([A[3],A[8],A[14]].filter(Boolean).map(s=>s.id).concat(B.slice(0,5).map(s=>s.id)));
  const nonCrit=shuffle(skus.filter(s=>!crit.has(s.id)));
  const over=new Set(nonCrit.slice(0,3).map(s=>s.id));
  const overstock=new Set(nonCrit.filter(s=>!over.has(s.id)&&s.dv.abc==='C').slice(0,12).map(s=>s.id));
  const twoSet=new Set([...overstock,...nonCrit.filter(s=>!over.has(s.id)&&!overstock.has(s.id)).slice(0,84-overstock.size).map(s=>s.id)]);
  skus.forEach(s=>{const v=s.dv;let stock;
    if(crit.has(s.id))stock=Math.max(1,Math.round(v.rop*rnd(.3,.8)));
    else if(overstock.has(s.id))stock=Math.round((v.rop+v.eoq)*rnd(1.3,2));
    else stock=Math.max(v.rop+1,Math.ceil(v.rop+v.eoq*rnd(.05,.55)));
    const nLoc=twoSet.has(s.id)?2:1;let cap=Math.ceil(Math.max(v.rop+v.eoq,stock)*1.1/nLoc);
    if(over.has(s.id))cap=Math.max(stock,Math.floor(stock/0.97));
    s.cap=Math.max(1,cap);s._stock=stock;s._n=nLoc});
  /* penempatan awal (semi-acak, agar slotting punya ruang perbaikan) */
  const rank=new Map(skus.slice().sort((a,b)=>b.dv.freq-a.dv.freq).map((s,i)=>[s.id,i/skus.length]));
  const jit=new Map(skus.map(s=>[s.id,rank.get(s.id)+gauss()*.55])),order=skus.slice().sort((a,b)=>jit.get(a.id)-jit.get(b.id)); /* noise dihitung sekali per SKU: hasil sama di semua browser */
  const byCost=DB.locs.slice().sort((a,b)=>a.cost-b.cost);
  order.forEach((s,i)=>{const l=byCost[i],u1=Math.min(s.cap,Math.ceil(s._stock/s._n));l.skuId=s.id;l.units=u1;l.cap=s.cap;s.locIds=[l.id];s._u2=s._stock-u1;DB.layout0[s.id]=l.id});
  const free=shuffle(DB.locs.filter(l=>!l.skuId));
  skus.forEach(s=>{if(s._n===2){const l=free.pop();l.skuId=s.id;l.units=Math.min(s.cap,s._u2);l.cap=s.cap;s.locIds.push(l.id)}delete s._stock;delete s._n;delete s._u2});

  /* PO 40 */
  const supSk=id=>skus.filter(s=>s.supplierId===id&&!crit.has(s.id));
  let sts=shuffle([...Array(12).fill('selesai'),...Array(8).fill('sebagian'),...Array(5).fill('terlambat'),...Array(15).fill('terbuka')]);
  const fi=sts.indexOf('terbuka');[sts[fi],sts[32]]=[sts[32],sts[fi]];
  for(let i=0;i<40;i++){const sup=pick(suppliers),st=sts[i],list=supSk(sup.id);
    const n=Math.min(list.length,i===32?3:2+Math.floor(R()*3)),ch=shuffle(list).slice(0,n);
    const lines=ch.map(s=>({skuId:s.id,qty:Math.max(2,Math.ceil(s.dv.eoq*rnd(.6,1.2))),recv:0}));
    let eta;
    if(st==='selesai'){eta=addDays(TODAY,-Math.round(rnd(3,60)));lines.forEach(l=>l.recv=l.qty)}
    else if(st==='terlambat'){eta=addDays(TODAY,-Math.round(rnd(1,12)));if(i%2)lines[0].recv=Math.floor(lines[0].qty*.3)}
    else if(st==='sebagian'){eta=addDays(TODAY,Math.round(rnd(0,5)));lines[0].recv=Math.max(1,Math.floor(lines[0].qty*rnd(.4,.7)))}
    else eta=i===32?TODAY:addDays(TODAY,Math.round(rnd(0,14)));
    DB.pos.push({id:'PO-26-'+pad(380+i,4),supplierId:sup.id,date:addDays(eta,-sup.L),eta,lines})}
  DB.pos.sort((a,b)=>b.id<a.id?-1:1);
  /* Pesanan 60 */
  const cust=['PT Tirta Manufaktur','CV Mitra Teknik','PT Baja Kencana','PT Nusa Plastindo','PT Agro Mulia Pangan','PT Semen Citra Lestari','CV Prima Otomotif','PT Garmen Surya','PT Logam Perkasa','PT Kertas Nusantara','PT Es Dingin Sejahtera','PT Tekstil Raya','CV Bengkel Maju Jaya','PT Pelayaran Samudra'];
  const cum=[];let acc=0;skus.forEach(s=>{acc+=s.dv.freq;cum.push(acc)});
  const wpick=()=>{const x=R()*acc;let lo=0,hi=cum.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(cum[mid]<x)lo=mid+1;else hi=mid}return skus[lo]};
  const ost=shuffle([...Array(33).fill('Dikirim'),...Array(3).fill('Siap kirim'),...Array(24).fill('Baru')]);
  const badIdx=ost.indexOf('Dikirim');
  for(let i=0;i<60;i++){const nl=2+Math.floor(R()*5),seen=new Set(),lines=[];let g=0;
    while(lines.length<nl&&g++<50){const s=wpick();if(seen.has(s.id))continue;seen.add(s.id);lines.push({skuId:s.id,qty:Math.max(1,Math.round(s.lq*(.6+.8*R())))})}
    const o={id:'SO-26-'+(1201+i),customer:pick(cust),lines,status:ost[i],ageH:Math.round(rnd(1,20))};
    if(o.status==='Dikirim'){o.cycleH=+rnd(10,28).toFixed(1);o.perfect=i!==badIdx}
    DB.orders.push(o)}
  DB.orders.sort((a,b)=>a.id<b.id?-1:1);
  DB.d2s=Array.from({length:30},()=>+rnd(2.4,4.2).toFixed(1));
  {const shp=DB.orders.filter(o=>o.status==='Dikirim');
   for(let i=0;i<shp.length;i+=3){const grp=shp.slice(i,i+3),seen=new Set(),pts=[];let lines=0;
     grp.forEach(o=>{lines+=o.lines.length;o.lines.forEach(l=>{const loc=IDX.loc.get(IDX.sku.get(l.skuId).locIds[0]);if(!seen.has(loc.id)){seen.add(loc.id);pts.push(loc)}})});
     const dist=tripLen(pts,G.DOCK);DB.pickLog.push({lines,dist,min:tripMin(dist,lines)})}}
  /* putaway tertunda (3) */
  const done=DB.pos.filter(p=>poStatus(p)==='Selesai');
  shuffle(skus.filter(s=>!crit.has(s.id)&&s.dv.abc!=='C')).slice(0,3).forEach((s,i)=>{const q=Math.max(2,Math.ceil(s.dv.eoq*.4));s.staging+=q;DB.tasks.push({id:'PT-'+pad(i+1,4),poId:done[i%done.length].id,skuId:s.id,qty:q})});
  /* KPI 30 hari */
  const now=kpiNow(),ser=(cur,start,nz)=>Array.from({length:30},(_,i)=>{const t=i/29;return +(start+(cur-start)*t+gauss()*nz*(1-.3*t)).toFixed(2)});
  DB.kpi={acc:ser(now.acc,96.4,.25),turn:ser(now.turn,now.turn*.96,now.turn*.015),util:ser(now.util,now.util-3,.6),oct:ser(now.oct,now.oct+1.6,.7),d2s:ser(now.d2s,now.d2s+.6,.25),por:ser(now.por,now.por-1.5,.6),pph:ser(now.pph,55.2,.9)};
  return DB}

/* ================= Selektor ================= */
const poStatus=p=>{const done=p.lines.every(l=>l.recv>=l.qty);if(done)return'Selesai';if(p.eta<TODAY)return'Terlambat';return p.lines.some(l=>l.recv>0)?'Sebagian':'Terbuka'};
const poOut=l=>Math.max(0,l.qty-l.recv);
function onOrderMap(){const m=new Map();DB.pos.forEach(p=>{if(poStatus(p)!=='Selesai')p.lines.forEach(l=>{const o=poOut(l);if(o>0)m.set(l.skuId,(m.get(l.skuId)||0)+o)})});return m}
const skuLocs=s=>s.locIds.map(id=>IDX.loc.get(id));
const onHand=s=>sum(skuLocs(s).map(l=>l.units))+(s.staging||0);
function stockStatus(s,oo){const v=s.dv,h=onHand(s),o=(oo?oo.get(s.id):0)||0;
  if(h+o<=v.rop)return'Kritis';if(h<=v.rop)return'Menunggu PO';if(h<v.rop+0.2*v.eoq)return'Rendah';if(h>(v.rop+v.eoq)*1.15)return'Berlebih';return'Normal'}
const criticalSkus=()=>{const oo=onOrderMap();return DB.skus.filter(s=>stockStatus(s,oo)==='Kritis').sort((a,b)=>b.dv.val-a.dv.val)};
const recQty=s=>Math.ceil(Math.max(s.dv.eoq,s.dv.rop+s.dv.eoq-(onHand(s)+(onOrderMap().get(s.id)||0))));
/* Model waktu picking: jalan + ambil per baris + persiapan per trip (menit) */
const PK={walk:72,line:0.63,setup:2};
const tripMin=(dist,lines)=>dist/PK.walk+lines*PK.line+PK.setup;
const pphNow=()=>{const m=sum(DB.pickLog.map(p=>p.min));return m?60*sum(DB.pickLog.map(p=>p.lines))/m:0};
/* Cycle count: kelas A dihitung lebih sering (4 A : 3 B : 1 C per sesi) */
const CC_MIX={A:4,B:3,C:1};
function ccBatch(){const cl={A:[],B:[],C:[]};DB.locs.forEach(l=>{if(l.skuId)cl[IDX.sku.get(l.skuId).dv.abc].push(l)});
  const rows=[];['A','B','C'].forEach(k=>{const arr=cl[k].sort((a,b)=>a.id<b.id?-1:1);if(!arr.length)return;for(let j=0;j<CC_MIX[k];j++)rows.push(arr[(DB.cycle.ptr[k]+j)%arr.length])});
  let mis=-1;if(DB.cycle.batch===0)mis=rows.findIndex((l,i)=>i<CC_MIX.A&&l.units>=2);
  return rows.map((l,i)=>({locId:l.id,skuId:l.skuId,sys:l.units,phys:i===mis?l.units-1:l.units}))}
function ccApply(entries){let matched=0,fixed=0;
  entries.forEach(e=>{const l=IDX.loc.get(e.locId),sys=l.units,s=IDX.sku.get(l.skuId);
    if(e.phys===sys)matched++;else{l.units=e.phys;if(e.phys>l.cap)l.cap=e.phys;fixed++;DB.moves.unshift({d:TODAY,type:'Koreksi',skuId:s.id,qty:e.phys-sys,ref:'Cycle count '+e.locId})}});
  const cnt={A:0,B:0,C:0};entries.forEach(e=>{cnt[IDX.sku.get(IDX.loc.get(e.locId).skuId).dv.abc]++});['A','B','C'].forEach(k=>DB.cycle.ptr[k]+=cnt[k]);
  DB.cycle.counted+=entries.length;DB.cycle.matched+=matched;DB.cycle.batch++;
  return{counted:entries.length,matched,fixed,acc:DB.cycle.matched/DB.cycle.counted*100}}
/* Analisis persediaan: komposisi nilai stok dan dampak service level (estimasi) */
function invInsight(){let tot=0,ssv=0,zi=0,zc=0,xi=0,xc=0,zn=0;
  DB.skus.forEach(s=>{const h=onHand(s)*s.price,c=s.dv.D*s.price;tot+=h;ssv+=s.dv.ss*s.price;if(s.dv.xyz==='Z'){zi+=h;zc+=c;zn++}if(s.dv.xyz==='X'){xi+=h;xc+=c}});
  return{tot,ssShare:tot?ssv/tot:0,zShare:tot?zi/tot:0,zTurn:zi?zc/zi:0,xTurn:xi?xc/xi:0,zN:zn}}
function slScenarios(){const cogs=sum(DB.skus.map(s=>s.dv.D*s.price)),inv=sum(DB.skus.map(s=>onHand(s)*s.price));
  return[90,95,97.5,99,99.5].map(sl=>{const z=Z_TABLE[sl];let ssVal=0,d=0;
    DB.skus.forEach(s=>{const v=s.dv,ss=Math.ceil(ssF(z,v.sdd,v.L));ssVal+=ss*s.price;d+=(ss-v.ss)*s.price});
    return{sl,ssVal,dInv:d,turn:cogs/Math.max(1,inv+d),cur:sl===DB.settings.sl}})}
/* Verifikasi rumus: kasus dengan jawaban hitung manual */
const VERIFY_CASES=[
 {g:'EOQ',n:'EOQ dasar',inp:'D = 1.200 · S = 100.000 · H = 6.000',hand:'√(2·1200·100000 ÷ 6000) = √40000',exp:200,run:()=>eoqF(1200,100000,6000)},
 {g:'EOQ',n:'EOQ kedua',inp:'D = 5.000 · S = 50.000 · H = 2.000',hand:'√(2·5000·50000 ÷ 2000) = √250000',exp:500,run:()=>eoqF(5000,50000,2000)},
 {g:'EOQ',n:'Permintaan nol tidak error',inp:'D = 0',hand:'tidak ada kebutuhan, EOQ = 0',exp:0,run:()=>eoqF(0,100000,6000)},
 {g:'SS',n:'Safety stock 95%',inp:'Z = 1,65 · σd = 4 · L = 9',hand:'1,65 × 4 × √9 = 1,65 × 4 × 3',exp:19.8,run:()=>ssF(1.65,4,9),tol:1e-9},
 {g:'SS',n:'Safety stock 99%',inp:'Z = 2,33 · σd = 10 · L = 4',hand:'2,33 × 10 × √4 = 2,33 × 10 × 2',exp:46.6,run:()=>ssF(2.33,10,4),tol:1e-9},
 {g:'ROP',n:'ROP dasar',inp:'d = 10 · L = 9 · SS = 19,8',hand:'10 × 9 + 19,8',exp:109.8,run:()=>ropF(10,9,19.8),tol:1e-9},
 {g:'ROP',n:'ROP kedua',inp:'d = 2,5 · L = 4 · SS = 5',hand:'2,5 × 4 + 5',exp:15,run:()=>ropF(2.5,4,5),tol:1e-9},
 {g:'Z',n:'Faktor Z untuk 90 / 95 / 99%',inp:'tabel service level',hand:'1,28 · 1,65 · 2,33',exp:'1,28 / 1,65 / 2,33',run:()=>[90,95,99].map(k=>f2(Z_TABLE[k])).join(' / ')},
 {g:'ABC',n:'Batas 80% / 95% kumulatif',inp:'nilai pemakaian 50, 30, 10, 5, 3, 2',hand:'kumulatif 50, 80, 90, 95, 98, 100% → A sampai 80%, B sampai 95%',exp:'A A B B C C',run:()=>{const m=classifyABC([50,30,10,5,3,2].map((v,i)=>({id:i,val:v})));return[0,1,2,3,4,5].map(i=>m.get(i)).join(' ')}},
 {g:'XYZ',n:'Batas CV 0,5 dan 1,0',inp:'CV = 0,49 · 0,50 · 1,00 · 1,01',hand:'<0,5 → X · 0,5 sampai 1,0 → Y · >1,0 → Z',exp:'X Y Y Z',run:()=>[0.49,0.5,1.0,1.01].map(classifyXYZ).join(' ')},
 {g:'XYZ',n:'Koefisien variasi (simpangan baku sampel)',inp:'12 bulan: enam kali 8 dan enam kali 12',hand:'μ = 10 · s = √(12×4 ÷ 11) = 2,0889 → CV = 0,2089',exp:0.2089,run:()=>{const a=[8,8,8,8,8,8,12,12,12,12,12,12];return+(stdev(a)/avg(a)).toFixed(4)}},
 {g:'Rute',n:'Jarak rute nearest-neighbor',inp:'dock (−3, 18) · titik (−3, 10) dan (5, 10)',hand:'dock→(−3,10) = 8 · →(5,10) = 8 · kembali ke dock = 16 · total 32 m',exp:32,run:()=>tripLen([{x:-3,y:10},{x:5,y:10}],{x:-3,y:18}),tol:1e-9}];
function verifyRun(){const rows=VERIFY_CASES.map(c=>{const act=c.run(),pass=typeof c.exp==='number'?Math.abs(act-c.exp)<=(c.tol||1e-9):act===c.exp;return{...c,act,pass}});
  return{rows,pass:rows.filter(r=>r.pass).length,total:rows.length}}
/* Cek silang data nyata: hitung ulang dari data mentah tanpa memakai fungsi rumus di atas */
function verifySkus(){const{S,hr,sl}=DB.settings,z=Z_TABLE[sl];
  const out=[0,70,140,210,280].map(i=>DB.skus[Math.min(i,DB.skus.length-1)]).map(s=>{
    let tot=0;for(const x of s.monthly)tot+=x;const mean=tot/12;let q=0;for(const x of s.monthly)q+=(x-mean)*(x-mean);
    const sd=Math.sqrt(q/11),L=IDX.sup.get(s.supplierId).L,H=s.price*hr,sdd=sd/Math.sqrt(30),ssx=z*sdd*Math.sqrt(L),cv=sd/mean;
    const ref={eoq:Math.max(1,Math.ceil(Math.sqrt(2*tot*S/H))),ss:Math.ceil(ssx),rop:Math.ceil(tot/365*L+ssx),xyz:cv<0.5?'X':cv<=1?'Y':'Z',cv},app={eoq:s.dv.eoq,ss:s.dv.ss,rop:s.dv.rop,xyz:s.dv.xyz};
    return{s,D:tot,L,ref,app,pass:ref.eoq===app.eoq&&ref.ss===app.ss&&ref.rop===app.rop&&ref.xyz===app.xyz}});
  return{rows:out,pass:out.filter(r=>r.pass).length,total:out.length}}
/* Baris CSV untuk cek silang di spreadsheet (kolom selisih harus 0) */
function verifyCsvRows(){const{S,hr,sl}=DB.settings,z=Z_TABLE[sl];
  const head=['Kode SKU','M1','M2','M3','M4','M5','M6','M7','M8','M9','M10','M11','M12','Harga','Lead time (hari)','S biaya pesan','H fraksi harga/tahun','Z','EOQ app','SS app','ROP app','D (sheet)','Simpangan baku bulanan (sheet)','EOQ (sheet)','SS (sheet)','ROP (sheet)','Selisih EOQ','Selisih SS','Selisih ROP'];
  return[head,...DB.skus.map((s,i)=>{const r=i+2;return[s.code,...s.monthly,s.price,s.dv.L,S,hr,z,s.dv.eoq,s.dv.ss,s.dv.rop,
    `=SUM(B${r}:M${r})`,`=STDEV(B${r}:M${r})`,`=MAX(1,ROUNDUP(SQRT(2*V${r}*P${r}/(N${r}*Q${r})),0))`,
    `=ROUNDUP(R${r}*(W${r}/SQRT(30))*SQRT(O${r}),0)`,`=ROUNDUP(V${r}/365*O${r}+R${r}*(W${r}/SQRT(30))*SQRT(O${r}),0)`,`=X${r}-S${r}`,`=Y${r}-T${r}`,`=Z${r}-U${r}`]})]}
function kpiNow(){
  const sh=DB.orders.filter(o=>o.status==='Dikirim'),occ=DB.locs.filter(l=>l.skuId).length;
  const cogs=sum(DB.skus.map(s=>s.dv.D*s.price)),inv=sum(DB.skus.map(s=>onHand(s)*s.price));
  return{acc:DB.cycle.matched/DB.cycle.counted*100,turn:inv?cogs/inv:0,util:occ/DB.locs.length*100,oct:avg(sh.map(o=>o.cycleH)),d2s:avg(DB.d2s),por:sh.length?sh.filter(o=>o.perfect).length/sh.length*100:0,pph:pphNow()}}

/* ================= Aksi data ================= */
function suggestLocations(s,qty){
  const desired={A:0.05,B:0.45,C:0.85}[s.dv.abc],c=[];
  DB.locs.forEach(l=>{let free=0,cons=false;
    if(l.skuId===s.id){free=l.cap-l.units;cons=true}else if(!l.skuId)free=s.cap;
    if(free<=0)return;
    const score=Math.abs(l.cost-desired)+(free>=qty?0:0.25)+(cons?-0.12:0);
    c.push({l,free,cons,score})});
  c.sort((a,b)=>a.score-b.score);return c.slice(0,3)}
function placeTask(taskId,locId){
  const t=DB.tasks.find(x=>x.id===taskId),s=t&&IDX.sku.get(t.skuId),l=IDX.loc.get(locId);
  if(!t||!l)return{error:'Tugas atau lokasi tidak ditemukan'};
  if(l.skuId&&l.skuId!==s.id)return{error:'Lokasi sudah dipakai SKU lain'};
  if(!l.skuId){l.skuId=s.id;l.cap=s.cap;l.units=0;s.locIds.push(l.id)}
  const free=l.cap-l.units,q=Math.min(t.qty,free);if(q<=0)return{error:'Lokasi sudah penuh'};
  l.units+=q;t.qty-=q;s.staging=Math.max(0,s.staging-q);
  DB.moves.unshift({d:TODAY,type:'Putaway',skuId:s.id,qty:q,ref:locId});
  let done=false;
  if(t.qty<=0){DB.tasks=DB.tasks.filter(x=>x.id!==t.id);done=true;DB.d2s.push(+(1.8+hash01(t.id)*2.8).toFixed(1));if(DB.d2s.length>30)DB.d2s.shift()}
  return{placed:q,left:t.qty,done,loc:l}}
function receivePO(poId,entries){
  const po=DB.pos.find(p=>p.id===poId);let tasks=0,units=0,vars=0;
  entries.forEach(e=>{const ln=po.lines[e.idx],s=IDX.sku.get(ln.skuId),exp=poOut(ln);
    if(e.qty>0){ln.recv+=e.qty;s.staging+=e.qty;units+=e.qty;DB.tasks.push({id:'PT-'+pad(DB.seq.pt++,4),poId,skuId:s.id,qty:e.qty});tasks++;DB.moves.unshift({d:TODAY,type:'Masuk',skuId:s.id,qty:e.qty,ref:poId})}
    if(e.qty!==exp){vars++;DB.variances.unshift({poId,skuId:s.id,expected:exp,got:e.qty,reason:e.reason})}});
  return{tasks,units,vars}}
function approvePO(rows){
  const g=new Map();rows.forEach(r=>{const s=IDX.sku.get(r.skuId);if(!g.has(s.supplierId))g.set(s.supplierId,[]);g.get(s.supplierId).push({skuId:r.skuId,qty:r.qty,recv:0})});
  const out=[];g.forEach((lines,sid)=>{const sup=IDX.sup.get(sid),po={id:'PO-26-'+pad(DB.seq.po++,4),supplierId:sid,date:TODAY,eta:addDays(TODAY,sup.L),lines,approved:true};DB.pos.unshift(po);out.push(po)});
  return out}
function createWave(orderIds){
  const orders=orderIds.map(id=>DB.orders.find(o=>o.id===id)),need=new Map(),who=new Map();
  orders.forEach(o=>o.lines.forEach(l=>{need.set(l.skuId,(need.get(l.skuId)||0)+l.qty);if(!who.has(l.skuId))who.set(l.skuId,[]);who.get(l.skuId).push(o.id)}));
  const stops=[];
  need.forEach((qty,sid)=>{const s=IDX.sku.get(sid);let rest=qty;
    for(const l of skuLocs(s)){if(rest<=0)break;const q=Math.min(l.units,rest);if(q>0){stops.push({locId:l.id,skuId:sid,qty:q,orders:who.get(sid),done:false});rest-=q}}
    if(rest>0){const l0=skuLocs(s)[0];stops.push({locId:l0.id,skuId:sid,qty:0,short:rest,orders:who.get(sid),done:false})}});
  const dock=G.DOCK,P=st=>IDX.loc.get(st.locId);
  const naive=tripLen(stops.map(P),dock); // dihitung sebagai rute urutan dokumen
  let naiveLen=0,cx=dock.x,cy=dock.y;stops.forEach(st=>{const p=P(st);naiveLen+=Math.abs(p.x-cx)+Math.abs(p.y-cy);cx=p.x;cy=p.y});naiveLen+=Math.abs(cx-dock.x)+Math.abs(cy-dock.y);
  const rest=stops.slice(),route=[];cx=dock.x;cy=dock.y;let dist=0;
  while(rest.length){let bi=0,bd=1e9;rest.forEach((st,i)=>{const p=P(st),d=Math.abs(p.x-cx)+Math.abs(p.y-cy);if(d<bd){bd=d;bi=i}});const st=rest.splice(bi,1)[0],p=P(st);dist+=bd;cx=p.x;cy=p.y;route.push(st)}
  dist+=Math.abs(cx-dock.x)+Math.abs(cy-dock.y);
  orders.forEach(o=>o.status='Dalam wave');
  DB.wave={id:'WV-'+pad(DB.seq.wv++,3),orderIds:orderIds.slice(),stops:route,dist,naiveDist:naiveLen,state:'aktif',lines:sum(orders.map(o=>o.lines.length))};
  return DB.wave}
function confirmStop(i){
  const w=DB.wave,st=w&&w.stops[i];if(!st||st.done)return null;
  const s=IDX.sku.get(st.skuId),l=IDX.loc.get(st.locId);l.units=Math.max(0,l.units-st.qty);st.done=true;
  if(st.qty>0)DB.moves.unshift({d:TODAY,type:'Keluar',skuId:s.id,qty:st.qty,ref:w.id});
  if(w.stops.every(x=>x.done)){w.state='selesai';DB.pickLog.push({lines:w.lines,dist:w.dist,min:tripMin(w.dist,w.lines)});w.orderIds.forEach(id=>{const o=DB.orders.find(x=>x.id===id);o.status='Siap kirim';o.short=w.stops.some(x=>x.short&&x.orders.includes(id))})}
  return{wave:w,finished:w.state==='selesai'}}
function shipOrder(id){const o=DB.orders.find(x=>x.id===id);if(!o||o.status!=='Siap kirim')return false;
  o.status='Dikirim';o.cycleH=+(o.ageH+2+hash01(id)*2).toFixed(1);o.perfect=!o.short&&o.cycleH<=24;return true}
function proposeLayout(){
  const prim=DB.skus.map(s=>({s,l:IDX.loc.get(s.locIds[0])})),locs=prim.map(p=>p.l).sort((a,b)=>a.cost-b.cost),sk=prim.map(p=>p.s).sort((a,b)=>b.dv.freq-a.dv.freq),m=new Map();
  sk.forEach((s,i)=>m.set(s.id,locs[i]));return m}
function proposeLayoutLimited(maxSkus){
  if(!maxSkus)return proposeLayout();
  const m=currentLayout(),sk=DB.skus,fq=sk.map(s=>s.dv.freq),loc=sk.map(s=>m.get(s.id)),used=new Set(),swaps=Math.floor(maxSkus/2);
  for(let k=0;k<swaps;k++){let bi=-1,bj=-1,bg=0;
    for(let i=0;i<sk.length;i++){if(used.has(i))continue;for(let j=0;j<sk.length;j++){if(i===j||used.has(j))continue;const g=(fq[i]-fq[j])*(loc[i].cost-loc[j].cost);if(g>bg){bg=g;bi=i;bj=j}}}
    if(bi<0)break;const t=loc[bi];loc[bi]=loc[bj];loc[bj]=t;used.add(bi);used.add(bj)}
  const out=new Map();sk.forEach((s,i)=>out.set(s.id,loc[i]));return out}
const currentLayout=()=>{const m=new Map();DB.skus.forEach(s=>m.set(s.id,IDX.loc.get(s.locIds[0])));return m};
function simDistance(map){let tot=0;DB.orders.forEach(o=>{const seen=new Set(),pts=[];o.lines.forEach(l=>{const loc=map.get(l.skuId);if(loc&&!seen.has(loc.id)){seen.add(loc.id);pts.push(loc)}});tot+=tripLen(pts,G.DOCK)});return tot}
function applyLayout(map){
  const cont=DB.skus.map(s=>{const l=IDX.loc.get(s.locIds[0]);return{s,units:l.units,cap:l.cap}});
  cont.forEach(c=>{const l=IDX.loc.get(c.s.locIds[0]);l.skuId=null;l.units=0;l.cap=0});
  cont.forEach(c=>{const l=map.get(c.s.id);l.skuId=c.s.id;l.units=c.units;l.cap=c.cap;c.s.locIds[0]=l.id})}
const layout0Map=()=>{const m=new Map();DB.skus.forEach(s=>m.set(s.id,IDX.loc.get(DB.layout0[s.id])));return m};

/* ================= Before/after slotting ================= */
function tripOrder(pts,dock){let cx=dock.x,cy=dock.y;const rest=pts.slice(),out=[];
  while(rest.length){let bi=0,bd=1e9;rest.forEach((p,i)=>{const d=Math.abs(p.x-cx)+Math.abs(p.y-cy);if(d<bd){bd=d;bi=i}});const p=rest.splice(bi,1)[0];out.push(p);cx=p.x;cy=p.y}
  return out}
function orderTrips(map){return DB.orders.map(o=>{const seen=new Set(),pts=[];o.lines.forEach(l=>{const loc=map.get(l.skuId);if(loc&&!seen.has(loc.id)){seen.add(loc.id);pts.push(loc)}});return{id:o.id,nl:o.lines.length,pts,dist:tripLen(pts,G.DOCK)}})}
function zoneLoad(map){const z={};ZONES.forEach(k=>z[k]=0);let t=0;DB.skus.forEach(s=>{const l=map.get(s.id);z[l.zone]+=s.dv.freq;t+=s.dv.freq});ZONES.forEach(k=>z[k]=t?z[k]/t*100:0);return z}
function beforeAfter(prop){
  const cm=currentLayout(),cur=orderTrips(cm),aft=orderTrips(prop),n=Math.max(1,cur.length),
    lines=sum(cur.map(t=>t.nl))/n,dC=sum(cur.map(t=>t.dist))/n,dA=sum(aft.map(t=>t.dist))/n,mC=tripMin(dC,lines),mA=tripMin(dA,lines);
  let bi=-1,bg=0;cur.forEach((t,i)=>{const g=t.dist-aft[i].dist;if(t.pts.length>=3&&g>bg){bg=g;bi=i}});
  return{n:cur.length,lines,dC,dA,mC,mA,pC:60/mC,pA:60/mA,zC:zoneLoad(cm),zA:zoneLoad(prop),ex:bi<0?null:{c:cur[bi],a:aft[bi]}}}

/* ================= Analisis sensitivitas persediaan ================= */
const tcF=(D,S,H,Q)=>Q>0?D/Q*S+Q/2*H:0; // biaya pesan + simpan stok siklus per tahun
const SENS_PARAMS=[['D','Level permintaan (CV tetap)'],['sd','Variabilitas permintaan (σ)'],['S','Biaya pesan (S)'],['H','Biaya simpan (H)'],['L','Lead time (L)']];
function sensSku(s,m,z){const v=s.dv,set=DB.settings,mD=m.D||1,D=v.D*mD,sdd=v.sdd*mD*(m.sd||1),S=set.S*(m.S||1),H=v.H*(m.H||1),L=v.L*(m.L||1),zz=z||v.z;
  const eoq=eoqF(D,S,H),ss=ssF(zz,sdd,L),rop=ropF(D/365,L,ss),cyc=tcF(D,S,H,eoq);
  return{eoq,ss,rop,cyc,cost:cyc+ss*H,ssVal:ss*s.price,cycVal:eoq/2*s.price}}
function sensPortfolio(m,z){const r={cost:0,ssVal:0,cycVal:0};DB.skus.forEach(s=>{const x=sensSku(s,m||{},z);r.cost+=x.cost;r.ssVal+=x.ssVal;r.cycVal+=x.cycVal});return r}
function sensTornado(pct){const base=sensPortfolio({}),SL=[90,95,97.5,99,99.5],i=SL.indexOf(DB.settings.sl),lab=k=>String(k).replace('.',',')+'%';
  const rows=SENS_PARAMS.map(([k,l])=>({k,l,lo:sensPortfolio({[k]:1-pct}),hi:sensPortfolio({[k]:1+pct}),lol:'−'+Math.round(pct*100)+'%',hil:'+'+Math.round(pct*100)+'%'}));
  if(i>=0)rows.push({k:'sl',l:'Service level (satu tingkat)',lo:i>0?sensPortfolio({},Z_TABLE[SL[i-1]]):base,hi:i<SL.length-1?sensPortfolio({},Z_TABLE[SL[i+1]]):base,lol:i>0?lab(SL[i-1]):'—',hil:i<SL.length-1?lab(SL[i+1]):'—'});
  rows.sort((a,b)=>Math.abs(b.hi.cost-b.lo.cost)-Math.abs(a.hi.cost-a.lo.cost));return{base,rows}}

/* ================= Persistensi ================= */
let _st=null;
function saveNow(){try{localStorage.setItem(KEY,JSON.stringify(DB,(k,v)=>k==='dv'?undefined:v))}catch(e){STORAGE_OK=false}}
function save(){clearTimeout(_st);_st=setTimeout(saveNow,150)}
function loadDb(){try{const raw=localStorage.getItem(KEY);if(raw){const d=JSON.parse(raw);if(d&&d.v===VERSION&&d.skus&&d.locs){DB=d;reindex();recompute();return DB}}}catch(e){}
  seedDb();return DB}
function resetAll(){try{localStorage.removeItem(KEY)}catch(e){}seedDb()}
if(typeof window!=='undefined')window.__wms={eoqF,ssF,ropF,classifyABC,classifyXYZ,Z_TABLE,tripLen,G,get DB(){return DB}};
