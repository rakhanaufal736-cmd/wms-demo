'use strict';
/* Uji otomatis logika WMS-TI. Jalankan:  node --test
   Membaca logic.js di folder yang sama (tanpa dependensi eksternal, Node 18+). */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const src=fs.readFileSync(path.join(__dirname,'logic.js'),'utf8');
const ctx=vm.createContext({console,performance,Intl,Math,Map,Set,Date,JSON,Number,String,Array,Object});
vm.runInContext(src+`
;globalThis.T={eoqF,ssF,ropF,classifyABC,classifyXYZ,tripLen,stdev,avg,Z_TABLE,seedDb,resetAll,kpiNow,verifyRun,verifySkus,verifyCsvRows,slScenarios,invInsight,
 ccBatch,ccApply,createWave,confirmStop,shipOrder,receivePO,placeTask,suggestLocations,poOut,poStatus,approvePO,criticalSkus,recQty,onHand,skuLocs,
 tripOrder,orderTrips,beforeAfter,zoneLoad,tcF,sensSku,sensPortfolio,sensTornado,simDistance,currentLayout,proposeLayout,proposeLayoutLimited,applyLayout,layout0Map,pphNow,tripMin,recompute,stockStatus,onOrderMap,
 get DB(){return DB},get IDX(){return IDX}};`,ctx);
const T=ctx.T;

/* ---- invarian data: dipakai setelah setiap rangkaian aksi ---- */
function invariants(){const D=T.DB,errs=[],idx=new Map(D.skus.map(s=>[s.id,s])),li=new Map(D.locs.map(l=>[l.id,l]));
  D.locs.forEach(l=>{if(l.skuId){const s=idx.get(l.skuId);if(!s||!s.locIds.includes(l.id))errs.push('rak tanpa SKU induk '+l.id);if(l.units<0)errs.push('stok negatif '+l.id);if(l.units>l.cap)errs.push('melebihi kapasitas '+l.id)}else if(l.units)errs.push('unit tanpa SKU '+l.id)});
  D.skus.forEach(s=>{if(new Set(s.locIds).size!==s.locIds.length)errs.push('lokasi ganda '+s.code);s.locIds.forEach(id=>{const l=li.get(id);if(!l||l.skuId!==s.id)errs.push('SKU menunjuk rak lain '+s.code)});if(s.staging<0)errs.push('staging negatif '+s.code)});
  const ids=D.skus.flatMap(s=>s.locIds);if(new Set(ids).size!==ids.length)errs.push('satu rak dipakai dua SKU');return errs}

test('kasus hitung manual: semua lulus',()=>{const v=T.verifyRun();v.rows.forEach(r=>assert.ok(r.pass,`${r.g} · ${r.n}: harapan ${r.exp}, hasil ${r.act}`));assert.equal(v.pass,v.total)});
test('rumus inti: nilai hitung tangan',()=>{
  assert.equal(T.eoqF(1200,100000,6000),200);assert.equal(T.eoqF(0,1,1),0);
  assert.ok(Math.abs(T.ssF(1.65,4,9)-19.8)<1e-9);assert.ok(Math.abs(T.ropF(10,9,19.8)-109.8)<1e-9);
  assert.deepEqual([90,95,97.5,99,99.5].map(k=>T.Z_TABLE[k]),[1.28,1.65,1.96,2.33,2.58])});
test('ABC: batas 80% dan 95% kumulatif; XYZ: batas CV 0,5 dan 1,0',()=>{
  const m=T.classifyABC([50,30,10,5,3,2].map((v,i)=>({id:i,val:v})));assert.equal([0,1,2,3,4,5].map(i=>m.get(i)).join(''),'AABBCC');
  assert.deepEqual([0.49,0.5,1.0,1.01].map(T.classifyXYZ),['X','Y','Y','Z'])});
test('rute: jarak nearest-neighbor dihitung tangan = 32 m',()=>assert.equal(T.tripLen([{x:-3,y:10},{x:5,y:10}],{x:-3,y:18}),32));

test('seed: deterministik dan memenuhi spesifikasi PRD',()=>{
  T.seedDb();const a=JSON.stringify(T.DB,(k,v)=>k==='dv'?undefined:v);T.seedDb();const b=JSON.stringify(T.DB,(k,v)=>k==='dv'?undefined:v);assert.equal(a,b,'seed harus selalu sama');
  const D=T.DB;assert.equal(D.skus.length,300);assert.equal(D.locs.length,480);assert.equal(D.pos.length,40);assert.equal(D.orders.length,60);assert.equal(D.suppliers.length,12);
  assert.equal(new Set(D.skus.map(s=>s.code)).size,300,'kode SKU unik');assert.ok(D.skus.every(s=>s.monthly.length===12));
  assert.deepEqual(invariants(),[]);
  assert.ok(T.criticalSkus().length>=3,'ada SKU di bawah ROP');assert.ok(D.pos.some(p=>T.poStatus(p)==='Terlambat'),'ada PO terlambat');
  assert.ok(D.locs.some(l=>l.skuId&&l.units/l.cap>=.95),'ada rak >95%');
  const cells=new Set(D.skus.map(s=>s.dv.abc+s.dv.xyz));assert.equal(cells.size,9,'matriks ABC-XYZ terisi 9 sel')});
test('seed identik di semua mesin: sidik jari data terkunci (ubah seed = perbarui nilai ini)',()=>{T.seedDb();const j=JSON.stringify(T.DB,(k,v)=>k==='dv'?undefined:v);let h=2166136261;for(let i=0;i<j.length;i++){h^=j.charCodeAt(i);h=Math.imul(h,16777619)}
  assert.equal((h>>>0).toString(16),'3543cc31','data seed berubah; periksa juga cerita anomali dashboard')});
test('ABC pada data nyata: kelas A menguasai ±80% nilai pemakaian',()=>{T.seedDb();const tot=T.DB.skus.reduce((x,s)=>x+s.dv.val,0),a=T.DB.skus.filter(s=>s.dv.abc==='A').reduce((x,s)=>x+s.dv.val,0);assert.ok(a/tot>=0.78&&a/tot<=0.86,'A='+(a/tot))});
test('cek silang 5 SKU nyata cocok dengan hitung ulang terpisah',()=>{T.seedDb();const k=T.verifySkus();k.rows.forEach(r=>assert.ok(r.pass,r.s.code));assert.equal(k.pass,k.total)});
test('service level 99% menaikkan SS dan ROP, tidak pernah menurunkan',()=>{T.seedDb();const lo=T.DB.skus.map(s=>[s.dv.ss,s.dv.rop]);T.DB.settings.sl=99;T.recompute();T.DB.skus.forEach((s,i)=>{assert.ok(s.dv.ss>=lo[i][0]);assert.ok(s.dv.rop>=lo[i][1])});T.DB.settings.sl=95;T.recompute()});
test('skenario service level: nilai SS naik monoton, baris saat ini sama dengan KPI',()=>{T.seedDb();const sc=T.slScenarios();for(let i=1;i<sc.length;i++)assert.ok(sc[i].ssVal>sc[i-1].ssVal);
  const cur=sc.find(r=>r.cur);assert.ok(Math.abs(cur.turn-T.kpiNow().turn)<1e-9);assert.equal(cur.dInv,0)});

test('alur penuh: terima semua PO, putaway, wave, kirim — invarian tetap terjaga',()=>{
  T.seedDb();
  T.DB.pos.filter(p=>T.poStatus(p)!=='Selesai').forEach(p=>T.receivePO(p.id,p.lines.map((l,i)=>({idx:i,qty:T.poOut(l),reason:''}))));
  let g=0;while(T.DB.tasks.length&&g++<500){const t=T.DB.tasks[0],s=T.IDX.sku.get(t.skuId),sg=T.suggestLocations(s,t.qty);assert.ok(sg.length,'selalu ada saran lokasi');const r=T.placeTask(t.id,sg[0].l.id);assert.ok(!r.error,r.error)}
  assert.equal(T.DB.tasks.length,0);assert.deepEqual(invariants(),[]);
  g=0;while(T.DB.orders.some(o=>o.status==='Baru')&&g++<20){const ids=T.DB.orders.filter(o=>o.status==='Baru').slice(0,5).map(o=>o.id);const w=T.createWave(ids);w.stops.forEach((s,i)=>T.confirmStop(i))}
  T.DB.orders.filter(o=>o.status==='Siap kirim').forEach(o=>T.shipOrder(o.id));
  assert.ok(T.DB.orders.every(o=>o.status==='Dikirim'));assert.deepEqual(invariants(),[])});
test('putaway sebagian: stok tidak hilang saat rak hampir penuh',()=>{T.seedDb();const D=T.DB,t=D.tasks[0],s=T.IDX.sku.get(t.skuId),before=T.onHand(s),q=t.qty;const loc=T.skuLocs(s)[0];loc.units=loc.cap-1;const b2=T.onHand(s);
  const r=T.placeTask(t.id,loc.id);assert.equal(r.placed,1);assert.equal(T.onHand(s),b2);assert.deepEqual(invariants(),[]);assert.ok(before>0&&q>0)});

test('slotting: relokasi terbatas tidak melebihi batas dan tidak memperburuk jarak',()=>{T.seedDb();const cur=T.simDistance(T.currentLayout());
  const m20=T.proposeLayoutLimited(20),m50=T.proposeLayoutLimited(50),all=T.proposeLayout();
  const moved=m=>T.DB.skus.filter(s=>m.get(s.id).id!==T.IDX.loc.get(s.locIds[0]).id).length;
  assert.ok(moved(m20)<=20);assert.ok(moved(m50)<=50);
  const d20=T.simDistance(m20),d50=T.simDistance(m50),dAll=T.simDistance(all);assert.ok(d20<=cur&&d50<=d20&&dAll<=d50,`${cur} ${d20} ${d50} ${dAll}`);
  T.applyLayout(m50);assert.deepEqual(invariants(),[]);T.applyLayout(T.layout0Map());assert.ok(Math.abs(T.simDistance(T.currentLayout())-cur)<1e-6,'layout awal dapat dipulihkan');assert.deepEqual(invariants(),[])});

test('KPI picks/jam dihitung dari log transaksi: wave baru memengaruhi nilai',()=>{T.seedDb();const p0=T.pphNow();assert.ok(p0>40&&p0<80,'nilai awal masuk akal '+p0);
  const w=T.createWave(T.DB.orders.filter(o=>o.status==='Baru').slice(0,5).map(o=>o.id));const n=T.DB.pickLog.length;w.stops.forEach((s,i)=>T.confirmStop(i));
  assert.equal(T.DB.pickLog.length,n+1);assert.notEqual(T.pphNow(),p0);
  const last=T.DB.pickLog[T.DB.pickLog.length-1];assert.ok(Math.abs(last.min-T.tripMin(w.dist,w.lines))<1e-9)});
test('KPI akurasi stok dari cycle count: selisih menurunkan, koreksi mengubah stok',()=>{T.seedDb();const a0=T.kpiNow().acc,b=T.ccBatch();assert.equal(b.length,8);assert.equal(b.filter(x=>x.phys!==x.sys).length,1,'batch pertama memuat satu selisih contoh');
  const bad=b.find(x=>x.phys!==x.sys),r=T.ccApply(b.map(x=>({locId:x.locId,phys:x.phys})));assert.equal(r.fixed,1);assert.ok(r.acc<a0);assert.equal(T.DB.locs.find(l=>l.id===bad.locId).units,bad.phys);
  const b2=T.ccBatch(),r2=T.ccApply(b2.map(x=>({locId:x.locId,phys:x.sys})));assert.equal(r2.fixed,0);assert.ok(r2.acc>r.acc);assert.deepEqual(invariants(),[])});
test('cycle count: kelas A diambil lebih sering (4A:3B:1C)',()=>{T.seedDb();const b=T.ccBatch(),cnt={A:0,B:0,C:0};b.forEach(x=>cnt[T.IDX.sku.get(x.skuId).dv.abc]++);assert.deepEqual(cnt,{A:4,B:3,C:1})});

test('CSV cek silang: 300 baris, 29 kolom, formula merujuk kolom yang benar',()=>{T.seedDb();const rows=T.verifyCsvRows();assert.equal(rows.length,301);rows.forEach(r=>assert.equal(r.length,29));
  const r=rows[1];assert.equal(r[21],'=SUM(B2:M2)');assert.ok(r[23].includes('V2')&&r[23].includes('P2')&&r[23].includes('N2')&&r[23].includes('Q2'));assert.equal(r[26],'=X2-S2');assert.equal(rows[300][26],'=X301-S301')});
test('performa: hitung ulang 300 SKU di bawah 300 ms (kebutuhan non-fungsional PRD)',()=>{T.seedDb();const t0=performance.now();for(let i=0;i<10;i++)T.recompute();assert.ok((performance.now()-t0)/10<300)});


/* ---- before/after slotting ---- */
test('before/after: urutan rute konsisten dengan tripLen, jarak rata-rata sama dengan simDistance',()=>{
  T.seedDb();const o=T.orderTrips(T.currentLayout());
  o.slice(0,20).forEach(t=>{const ord=T.tripOrder(t.pts,{x:-3,y:18});assert.equal(ord.length,t.pts.length);
    let cx=-3,cy=18,len=0;ord.forEach(p=>{len+=Math.abs(p.x-cx)+Math.abs(p.y-cy);cx=p.x;cy=p.y});len+=Math.abs(cx+3)+Math.abs(cy-18);assert.ok(Math.abs(len-t.dist)<1e-9)});
  const prop=T.proposeLayoutLimited(50),b=T.beforeAfter(prop);
  assert.ok(Math.abs(b.dC*b.n-T.simDistance(T.currentLayout()))<1e-6);assert.ok(Math.abs(b.dA*b.n-T.simDistance(prop))<1e-6);
  assert.ok(b.dA<b.dC&&b.mA<b.mC&&b.pA>b.pC,'usulan harus lebih pendek, lebih cepat');
  assert.ok(Math.abs(Object.values(b.zC).reduce((x,y)=>x+y,0)-100)<1e-9&&Math.abs(Object.values(b.zA).reduce((x,y)=>x+y,0)-100)<1e-9);
  assert.ok(b.ex&&b.ex.c.dist>b.ex.a.dist&&b.ex.c.pts.length>=3)});
test('before/after: layout yang sama memberi selisih nol',()=>{T.seedDb();const b=T.beforeAfter(T.currentLayout());assert.equal(b.dA,b.dC);assert.equal(b.ex,null)});

/* ---- sensitivitas ---- */
test('sensitivitas: biaya di EOQ = akar(2DSH), kasus tangan 1.200.000',()=>{
  assert.equal(T.tcF(1200,100000,6000,200),1200000);assert.ok(Math.abs(T.tcF(1200,100000,6000,200)-Math.sqrt(2*1200*100000*6000))<1e-6);
  assert.ok(Math.abs(T.tcF(1200,100000,6000,240)/1200000-1.0166666667)<1e-9,'Q +20% hanya +1,67% biaya');
  assert.ok(Math.abs(T.tcF(1200,100000,6000,100)/1200000-1.25)<1e-9,'Q −50% = +25%')});
test('sensitivitas: elastisitas teoretis (EOQ∝√(S/H), SS∝√L, SS∝σ, SS∝Z)',()=>{
  T.seedDb();const s=T.DB.skus.find(x=>x.dv.D>0&&x.dv.sdd>0),b=T.sensSku(s,{});
  assert.ok(Math.abs(T.sensSku(s,{S:1.21}).eoq/b.eoq-1.1)<1e-9);assert.ok(Math.abs(T.sensSku(s,{H:4}).eoq/b.eoq-0.5)<1e-9);
  assert.ok(Math.abs(T.sensSku(s,{L:4}).ss/b.ss-2)<1e-9);assert.ok(Math.abs(T.sensSku(s,{sd:1.5}).ss/b.ss-1.5)<1e-9);
  assert.ok(Math.abs(T.sensSku(s,{},s.dv.z*2).ss/b.ss-2)<1e-9);
  assert.ok(Math.abs(T.sensSku(s,{D:4}).eoq/b.eoq-2)<1e-9&&Math.abs(T.sensSku(s,{D:4}).ss/b.ss-4)<1e-9,'D×4: EOQ×2, SS×4 (σ ikut naik)')});
test('sensitivitas: dasar = parameter aplikasi; tornado monoton dan terurut',()=>{
  T.seedDb();const t=T.sensTornado(0.2),base=t.base;
  const manual=T.DB.skus.reduce((x,s)=>{const v=s.dv,q=T.eoqF(v.D,T.DB.settings.S,v.H);return x+T.tcF(v.D,T.DB.settings.S,v.H,q)+T.ssF(v.z,v.sdd,v.L)*v.H},0);
  assert.ok(Math.abs(base.cost-manual)<1e-3*manual*1e-6+1e-3);
  t.rows.forEach(r=>{assert.ok(r.hi.cost>=r.lo.cost-1e-6,r.l);assert.ok(r.lo.cost<=base.cost+1e-6&&r.hi.cost>=base.cost-1e-6)});
  const sw=t.rows.map(r=>Math.abs(r.hi.cost-r.lo.cost));assert.deepEqual(sw.slice().sort((a,b)=>b-a),sw,'urut dari paling peka')});
