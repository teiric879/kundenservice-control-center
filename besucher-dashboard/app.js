/* e-regio Kundencenter Analytics – Dashboard live aus SQLite */
(function(){
"use strict";
var V=[];   /* [{ymd,standort,kategorie,stunde,dow}, …] – geladen via GET /api/besucher */
var ACC='#bf9200';
/* CD-harmonisierte Serienfarben (Grün-verankert, kein wahlloses Lila/Pink) – Spiegel von shared/tokens.css --c0…--c9 */
var PAL=['#004442','#dea600','#1f9bb0','#1d9e75','#3a7ca5','#c97b3f','#5dae8b','#6b8f8a','#8a6a00','#2c6e6a','#7ca6b8','#a98b3c'];
var WD=['Mo','Di','Mi','Do','Fr','Sa','So'], WDF=['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'];
var MON=['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
var tip=document.getElementById('tip');
var RM=window.matchMedia&&window.matchMedia('(prefers-reduced-motion:reduce)').matches;
var ICON={
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  week:'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01"/>',
  month:'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  year:'<path d="M22 7 13.5 15.5l-5-5L2 17"/><path d="M16 7h6v6"/>',
  pin:'<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>'
};
function svg(p){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+p+'</svg>';}
// HTML/SVG-Escaping für aus der DB stammende Labels (Standort/Kategorie), die
// in innerHTML bzw. SVG-<text> eingesetzt werden. Schutz gegen XSS.
function esc(s){return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');}
function stripPfx(s){return String(s||'').replace(/^\d+\s+/,'');}
// Test-/Junk-Standorte (z.B. "__TESTBOT__") aus Erfassungstests – gehören nie ins Dashboard
// (würden sonst als Dropdown-/Erfass-Button + Donut-/KPI-Anteil erscheinen). Echte Standorte
// sind Euskirchen/Kall; "(ohne Angabe)" bleibt erhalten.
function isTestStandort(s){return /test/i.test(s||'');}
function raf(fn){requestAnimationFrame(function(){requestAnimationFrame(fn);});}

/* ---------- date helpers (ymd = y*10000+m*100+d) ---------- */
function parseISO(s){var p=s.split('-');return p[0]*10000+(+p[1])*100+(+p[2]);}
function ymdToDate(y){return new Date(Math.floor(y/10000),Math.floor(y/100)%100-1,y%100);}
function dateToYmd(d){return d.getFullYear()*10000+(d.getMonth()+1)*100+d.getDate();}
function addDays(d,n){var x=new Date(d);x.setDate(x.getDate()+n);return x;}
function addMonths(d,n){var x=new Date(d);x.setMonth(x.getMonth()+n);return x;}
function fmtDE(y){return (''+(y%100)).padStart(2,'0')+'.'+(''+(Math.floor(y/100)%100)).padStart(2,'0')+'.'+Math.floor(y/10000);}
function nf(n){return n.toLocaleString('de-DE');}
function ymdToISO(y){return Math.floor(y/10000)+'-'+(''+(Math.floor(y/100)%100)).padStart(2,'0')+'-'+(''+(y%100)).padStart(2,'0');}

/* ---------- state ---------- */
var minYmd=20160101, maxYmd=20260101, dataMaxYmd=20260101;
var nowYmd=dateToYmd(new Date()), nowDate=ymdToDate(nowYmd);
var state={standort:'all',period:'heute',from:null,to:null};

/* ---------- Memoisierung schwerer Aggregationen ----------
   weekdayMonthAvg / hourlyCum / Monats-Buckets / Kategorie-Trend scannen das komplette V und
   hängen NUR von den Rohdaten + Standort (+ heutigem Datum) ab, NICHT vom gewählten Zeitraum.
   Bisher liefen sie bei JEDEM Filter-/Resize-/Tab-Wechsel neu – Prognose + Prognose-Analyse
   riefen weekdayMonthAvg/hourlyCum sogar doppelt pro render() auf. _dataVer wird bei jeder
   V-Änderung erhöht und invalidiert dadurch alle Caches (gleiches Ergebnis wie vorher, nur
   ohne Wiederholung). */
var _dataVer=0;
function bumpData(){_dataVer++;}
function memo(fn,keyFn){var k,v;return function(a){var nk=keyFn(a);if(nk!==k){k=nk;v=fn(a);}return v;};}

/* ---------- filter ---------- */
function matchStand(s){return state.standort==='all'||s===state.standort;}
function countRange(a,b){
  var n=0;
  for(var i=0;i<V.length;i++){var r=V[i];if(r.ymd>=a&&r.ymd<=b&&matchStand(r.standort))n++;}
  return n;
}
function rowsIn(a,b){
  var out=[];
  for(var i=0;i<V.length;i++){var r=V[i];if(r.ymd>=a&&r.ymd<=b&&matchStand(r.standort))out.push(r);}
  return out;
}
function currentRange(){
  if(state.period==='heute')return [nowYmd,nowYmd];
  if(state.period==='month')return [dateToYmd(new Date(nowDate.getFullYear(),nowDate.getMonth(),1)),nowYmd];
  if(state.period==='ytd')return [nowDate.getFullYear()*10000+101,nowYmd];
  if(state.period==='gestern'){var g=dateToYmd(addDays(nowDate,-1));return [g,g];}
  if(state.period==='woche'){var dow=(nowDate.getDay()+6)%7;var mon=addDays(nowDate,-dow);return [dateToYmd(mon),dateToYmd(addDays(mon,4))];}
  if(state.period==='custom')return [state.from||minYmd,state.to||maxYmd];
  return [minYmd,maxYmd];
}

/* ---------- Period-Deskriptor: zentrale, filterabhängige Steuerung ----------
   Liefert EIN Objekt, das alle Widgets steuert: aktueller Range, vergleichbarer
   Vorzeitraum (+Label), Verlaufs-Granularität, laufend/abgeschlossen. Ersetzt die
   verstreute Filter-Logik in renderKPIs/renderForecast etc. */
function shiftDaysYmd(ymd,n){return dateToYmd(addDays(ymdToDate(ymd),n));}
function spanDaysOf(a,b){return Math.round((ymdToDate(b)-ymdToDate(a))/864e5);}
function isoWeek(d){var dt=new Date(d);dt.setHours(0,0,0,0);dt.setDate(dt.getDate()+3-((dt.getDay()+6)%7));var w1=new Date(dt.getFullYear(),0,4);return 1+Math.round(((dt-w1)/864e5-3+((w1.getDay()+6)%7))/7);}
function businessDays(a,b){var n=0,t=ymdToDate(a),end=ymdToDate(b);for(;t<=end;t=addDays(t,1)){if(((t.getDay()+6)%7)<5)n++;}return n;}
// Erwartete Besucher im Range = Summe der histor. Ø(Monat×Wochentag) je Tag. Nutzt das
// memoisierte weekdayMonthAvg (hängt an Rohdaten+Standort, nicht am Filter).
function expectedForRange(a,b){var wdm=weekdayMonthAvg(),sum=0,t=ymdToDate(a),end=ymdToDate(b);for(;t<=end;t=addDays(t,1)){sum+=wdm[t.getMonth()][(t.getDay()+6)%7];}return sum;}
function periodInfo(){
  var r=currentRange(),a=r[0],b=r[1],p=state.period,span=spanDaysOf(a,b);
  var info={a:a,b:b,spanDays:span,prevA:null,prevB:null,cmpLabel:'',altCmp:'',grain:'day',
            isClosed:b<nowYmd,isRunning:(a<=nowYmd&&nowYmd<=b),isAll:p==='all',period:p,label:''};
  if(p==='heute'){info.grain='hour';info.prevA=info.prevB=shiftDaysYmd(a,-1);info.cmpLabel='vs. gestern';info.label='Heute';}
  else if(p==='gestern'){info.grain='hour';info.prevA=info.prevB=shiftDaysYmd(a,-1);info.cmpLabel='vs. vorgestern';info.label='Gestern';}
  else if(p==='woche'){info.grain='day';info.prevA=shiftDaysYmd(a,-7);info.prevB=shiftDaysYmd(b,-7);info.cmpLabel='vs. Vorwoche';info.label='Diese Woche';}
  else if(p==='month'){info.grain='day';
    var ad=ymdToDate(a),pmEnd=addDays(new Date(ad.getFullYear(),ad.getMonth(),1),-1),pmStart=new Date(pmEnd.getFullYear(),pmEnd.getMonth(),1);
    var dayCount=ymdToDate(b).getDate(),pmLast=new Date(pmEnd.getFullYear(),pmEnd.getMonth()+1,0).getDate(),pmDay=Math.min(dayCount,pmLast);
    info.prevA=dateToYmd(pmStart);info.prevB=dateToYmd(new Date(pmEnd.getFullYear(),pmEnd.getMonth(),pmDay));info.cmpLabel='vs. Vormonat';info.label='Dieser Monat';}
  else if(p==='ytd'){info.grain='month';
    var ya=ymdToDate(a),yb=ymdToDate(b);
    info.prevA=dateToYmd(new Date(ya.getFullYear()-1,ya.getMonth(),ya.getDate()));
    info.prevB=dateToYmd(new Date(yb.getFullYear()-1,yb.getMonth(),yb.getDate()));info.cmpLabel='vs. Vorjahr';info.label='Dieses Jahr';}
  else if(p==='custom'){
    info.grain=span<=1?'hour':span<=14?'day':span<=90?'week':span<=730?'month':'year';
    var len=span+1;info.prevB=shiftDaysYmd(a,-1);info.prevA=shiftDaysYmd(info.prevB,-(len-1));info.cmpLabel='vs. vorheriger Zeitraum';info.label='Zeitraum';}
  else{info.grain=span>730?'year':'month';info.cmpLabel='';info.label='Gesamt';}
  return info;
}

/* ---------- Empty-State: schlanke Hinweis-Karte statt leerer Riesen-Diagramme ---------- */
function emptyCard(boxId,text){var box=document.getElementById(boxId);if(box)box.innerHTML='<p class="sub" style="text-align:center;padding:32px 0">'+esc(text)+'</p>';}

/* ---------- gemeinsame Aggregat-Helfer (Top-Anliegen, Spitzentag/-stunde/-monat/-jahr) ---------- */
function topKatOf(rows,n){
  var c={};rows.forEach(function(r){if(!r.kategorie)return;var k=stripPfx(r.kategorie);c[k]=(c[k]||0)+1;});
  var total=rows.length||1;
  return Object.keys(c).map(function(k){return {label:k,v:c[k],pct:Math.round(c[k]/total*100)};})
    .sort(function(a,b){return b.v-a.v;}).slice(0,n||1);
}
function peakDayOf(rows){var c={},best=null;rows.forEach(function(r){c[r.ymd]=(c[r.ymd]||0)+1;});
  Object.keys(c).forEach(function(k){if(!best||c[k]>best.v)best={ymd:+k,v:c[k]};});return best;}
function peakHourOf(rows){var c={},best=null;rows.forEach(function(r){if(r.stunde>0&&r.stunde<=23)c[r.stunde]=(c[r.stunde]||0)+1;});
  Object.keys(c).forEach(function(h){if(!best||c[h]>best.v)best={h:+h,v:c[h]};});return best;}
function peakMonthOf(rows){var c={},best=null;rows.forEach(function(r){var k=Math.floor(r.ymd/100);c[k]=(c[k]||0)+1;});
  Object.keys(c).forEach(function(k){if(!best||c[k]>best.v)best={ym:+k,v:c[k]};});return best;}
function peakYearOf(rows){var c={},best=null;rows.forEach(function(r){var y=Math.floor(r.ymd/10000);c[y]=(c[y]||0)+1;});
  Object.keys(c).forEach(function(y){if(!best||c[y]>best.v)best={y:+y,v:c[y]};});return best;}
function ymdShort(ymd){return WD[(ymdToDate(ymd).getDay()+6)%7]+' '+fmtDE(ymd).slice(0,5);}
function ymLabel(ym){return MON[(ym%100)-1]+' '+(''+Math.floor(ym/100)).slice(2);}

/* ---------- tooltip ---------- */
function showTip(e,h){tip.innerHTML=h;tip.style.opacity=1;moveTip(e);}
function moveTip(e){tip.style.left=(e.clientX+14)+'px';tip.style.top=(e.clientY-12)+'px';}
function hideTip(){tip.style.opacity=0;}

/* ---------- count-up ---------- */
function countUp(el,to,anim){
  if(!anim||RM){el.textContent=nf(to);return;}
  var dur=320,st=performance.now();
  function step(t){var p=Math.min(1,(t-st)/dur);var e=1-Math.pow(1-p,3);el.textContent=nf(Math.round(to*e));if(p<1)requestAnimationFrame(step);}
  requestAnimationFrame(step);
}

/* ---------- trend area chart ---------- */
function renderTrend(rows,a,b,anim){
  var box=document.getElementById('chartTrend');
  var W=Math.max(360,Math.round(box.clientWidth)||760),H=248,pad={l:44,r:14,t:16,b:30};
  if(!rows.length){document.getElementById('trendSub').textContent='keine Besuche im Zeitraum';emptyCard('chartTrend','Für den gewählten Zeitraum liegen keine Besuche vor.');return;}
  var da=ymdToDate(a),db=ymdToDate(b),spanDays=Math.round((db-da)/864e5);
  // Granularität zentral aus periodInfo (Heute/Gestern=Stunde, Woche/Monat=Tag, Jahr=Monat,
  // Zeitraum dynamisch inkl. KW-Stufe, Gesamt=Jahr/Monat).
  var mode=periodInfo().grain,buckets=[],idx={};
  function mondayYmd(ymd){var d=ymdToDate(ymd);return dateToYmd(addDays(d,-((d.getDay()+6)%7)));}
  function keyOf(ymd){var Y=Math.floor(ymd/10000),m=Math.floor(ymd/100)%100;
    return mode==='day'?ymd:mode==='week'?mondayYmd(ymd):mode==='month'?Y*100+m:Y;}
  if(mode==='hour'){
    // Stundenfenster dynamisch aus den Daten (Rand ±1 h), Fallback Öffnungszeiten 7–18.
    var hrs=[];for(var hi=0;hi<rows.length;hi++){var sh=rows[hi].stunde;if(sh>0&&sh<=23)hrs.push(sh);}
    var hmn=hrs.length?Math.max(0,Math.min.apply(null,hrs)-1):7,
        hmx=hrs.length?Math.min(23,Math.max.apply(null,hrs)+1):18;
    for(var hh=hmn;hh<=hmx;hh++){idx[hh]=buckets.length;buckets.push({label:(''+hh).padStart(2,'0'),tip:(''+hh).padStart(2,'0')+':00 Uhr',v:0});}
  }
  else if(mode==='day'){for(var t=new Date(da);t<=db;t=addDays(t,1)){var k=dateToYmd(t);idx[k]=buckets.length;buckets.push({label:fmtDE(k).slice(0,5),v:0});}}
  else if(mode==='week'){var mon0=addDays(da,-((da.getDay()+6)%7));for(var tw=new Date(mon0);tw<=db;tw=addDays(tw,7)){var km=dateToYmd(tw);idx[km]=buckets.length;buckets.push({label:'KW'+isoWeek(tw),tip:'KW '+isoWeek(tw)+' (ab '+fmtDE(km).slice(0,5)+')',v:0});}}
  else if(mode==='month'){for(var t2=new Date(da.getFullYear(),da.getMonth(),1);t2<=db;t2=addMonths(t2,1)){var k2=t2.getFullYear()*100+(t2.getMonth()+1);idx[k2]=buckets.length;buckets.push({label:MON[t2.getMonth()]+' '+(''+t2.getFullYear()).slice(2),v:0});}}
  else{for(var y=da.getFullYear();y<=db.getFullYear();y++){idx[y]=buckets.length;buckets.push({label:''+y,v:0});}}
  if(mode==='hour'){for(var i=0;i<rows.length;i++){var st=rows[i].stunde,jh=(st>0?idx[st]:null);if(jh!=null)buckets[jh].v++;}}
  else{for(var i=0;i<rows.length;i++){var j=idx[keyOf(rows[i].ymd)];if(j!=null)buckets[j].v++;}}
  var grainLbl={hour:'stündlich',day:'täglich',week:'wöchentlich (KW)',month:'monatlich',year:'jährlich'}[mode];
  document.getElementById('trendSub').textContent=grainLbl+' · '+nf(rows.length)+' Besuche';
  var max=Math.max(1,Math.max.apply(null,buckets.map(function(x){return x.v;})));
  var n=buckets.length,iw=W-pad.l-pad.r,ih=H-pad.t-pad.b;
  function X(i){return pad.l+(n<=1?iw/2:iw*i/(n-1));}
  function Y(v){return pad.t+ih-ih*v/max;}
  var s='<svg viewBox="0 0 '+W+' '+H+'" width="100%" style="height:248px">';
  s+='<defs><linearGradient id="tg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="'+ACC+'" stop-opacity=".34"/><stop offset="1" stop-color="'+ACC+'" stop-opacity="0"/></linearGradient>';
  s+='<filter id="glow" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="3.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>';
  for(var g=0;g<=4;g++){var gv=Math.round(max*g/4),gy=Y(gv);
    s+='<line class="gridline" x1="'+pad.l+'" y1="'+gy+'" x2="'+(W-pad.r)+'" y2="'+gy+'"/>';
    s+='<text class="axis" x="'+(pad.l-9)+'" y="'+(gy+4)+'" text-anchor="end">'+nf(gv)+'</text>';}
  var line='';buckets.forEach(function(d,i){line+=(i?'L':'M')+X(i).toFixed(1)+' '+Y(d.v).toFixed(1)+' ';});
  var area=line+'L'+X(n-1).toFixed(1)+' '+Y(0)+' L'+X(0).toFixed(1)+' '+Y(0)+' Z';
  s+='<path class="t-area" d="'+area+'" fill="url(#tg)" opacity="0"/>';
  s+='<path class="t-line" d="'+line+'" fill="none" stroke="'+ACC+'" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>';
  var lblEvery=Math.ceil(n/8);
  buckets.forEach(function(d,i){var x=X(i),y=Y(d.v);
    if(mode!=='day')s+='<circle cx="'+x+'" cy="'+y+'" r="3.2" fill="'+ACC+'" stroke="#022" stroke-width="1.5"/>';
    s+='<rect x="'+(x-Math.max(7,iw/n/2))+'" y="'+pad.t+'" width="'+Math.max(14,iw/n)+'" height="'+ih+'" fill="transparent" data-i="'+i+'"/>';
    if(i%lblEvery===0||i===n-1)s+='<text class="axis" x="'+x+'" y="'+(H-9)+'" text-anchor="middle">'+esc(d.label)+'</text>';});
  s+='</svg>';box.innerHTML=s;
  var lp=box.querySelector('.t-line'),ar=box.querySelector('.t-area');
  if(anim&&!RM&&lp){var len=lp.getTotalLength();lp.style.strokeDasharray=len;lp.style.strokeDashoffset=len;
    raf(function(){lp.style.transition='stroke-dashoffset .5s cubic-bezier(.22,.61,.36,1)';lp.style.strokeDashoffset=0;ar.style.transition='opacity .35s ease .1s';ar.style.opacity=1;});}
  else{ar.style.opacity=1;}
  box.querySelectorAll('rect[data-i]').forEach(function(rc){rc.addEventListener('mousemove',function(e){var d=buckets[+rc.dataset.i];showTip(e,esc(d.tip||d.label)+': <b>'+nf(d.v)+'</b>');});rc.addEventListener('mouseleave',hideTip);});
}

/* ---------- donut ---------- */
function renderDonut(rows,anim){
  var counts={};rows.forEach(function(r){var s=r.standort||'?';counts[s]=(counts[s]||0)+1;});
  var items=Object.keys(counts).map(function(s){return {label:s,v:counts[s]};}).sort(function(a,b){return b.v-a.v;});
  var total=items.reduce(function(s,x){return s+x.v;},0)||1,r=72,C=2*Math.PI*r,off=0;
  var s='<svg viewBox="0 0 184 192" width="100%" style="height:196px"><g transform="rotate(-90 92 96)">';
  s+='<circle cx="92" cy="96" r="'+r+'" fill="none" stroke="rgba(6,59,55,.06)" stroke-width="22"/>';
  items.forEach(function(it,i){var len=C*it.v/total,col=PAL[i%PAL.length];
    s+='<circle class="d-seg" cx="92" cy="96" r="'+r+'" fill="none" stroke="'+col+'" stroke-width="22" stroke-linecap="butt" stroke-dasharray="'+(anim&&!RM?0:len)+' '+(anim&&!RM?C:C-len)+'" data-len="'+len+'" data-c="'+C+'" stroke-dashoffset="'+(-off)+'" data-i="'+i+'"/>';
    off+=len;});
  s+='</g><text x="92" y="90" text-anchor="middle" font-family="Hanken Grotesk" font-size="27" font-weight="600" fill="#063b37">'+nf(total)+'</text>';
  s+='<text x="92" y="110" text-anchor="middle" font-size="12" fill="#5d7d77">Besuche</text></svg>';
  var box=document.getElementById('chartStandort');box.innerHTML=s;
  if(anim&&!RM){raf(function(){box.querySelectorAll('.d-seg').forEach(function(c,i){c.style.transition='stroke-dasharray .45s cubic-bezier(.22,.61,.36,1) '+(i*.04)+'s';c.style.strokeDasharray=c.dataset.len+' '+(c.dataset.c-c.dataset.len);});});}
  var leg='';items.forEach(function(it,i){leg+='<span><i style="background:'+PAL[i%PAL.length]+'"></i>'+esc(it.label)+' · '+Math.round(it.v/total*100)+'% ('+nf(it.v)+')</span>';});
  document.getElementById('legendStandort').innerHTML=leg;
  box.querySelectorAll('.d-seg').forEach(function(c){c.addEventListener('mousemove',function(e){var it=items[+c.dataset.i];showTip(e,esc(it.label)+': <b>'+nf(it.v)+'</b> ('+Math.round(it.v/total*100)+'%)');});c.addEventListener('mouseleave',hideTip);});
}

/* ---------- top categories (hbars) ---------- */
function renderKat(rows,anim){
  var counts={};rows.forEach(function(r){if(!r.kategorie)return;counts[r.kategorie]=(counts[r.kategorie]||0)+1;});
  var items=Object.keys(counts).map(function(k){return {label:stripPfx(k),v:counts[k]};}).sort(function(a,b){return b.v-a.v;}).slice(0,9);
  var max=Math.max(1,Math.max.apply(null,items.map(function(x){return x.v;})));
  var h='';items.forEach(function(it,i){var col=PAL[i%PAL.length];
    h+='<div class="hbar"><div class="row"><b>'+esc(it.label)+'</b><span>'+nf(it.v)+'</span></div>'+
       '<div class="track"><i data-w="'+(it.v/max*100)+'" style="background:linear-gradient(90deg,'+col+',#ffffff22);'+(anim&&!RM?'':'width:'+(it.v/max*100)+'%')+'"></i></div></div>';});
  var box=document.getElementById('chartKat');box.innerHTML=h||'<p class="sub">Keine Daten</p>';
  if(anim&&!RM)raf(function(){box.querySelectorAll('.track i').forEach(function(el){el.style.width=el.dataset.w+'%';});});
}

/* ---------- kategorie donut ---------- */
function renderKatDonut(rows,anim){
  var box=document.getElementById('chartKatDonut');if(!box)return;
  var leg=document.getElementById('legendKatDonut');
  var counts={};rows.forEach(function(r){if(!r.kategorie)return;var k=stripPfx(r.kategorie);counts[k]=(counts[k]||0)+1;});
  var items=Object.keys(counts).map(function(k){return {label:k,v:counts[k]};}).sort(function(a,b){return b.v-a.v;}).slice(0,8);
  if(!items.length){box.innerHTML='<p class="sub" style="text-align:center;padding:24px 0">Keine Daten</p>';if(leg)leg.innerHTML='';return;}
  var total=items.reduce(function(s,x){return s+x.v;},0)||1;
  var r=70,C=2*Math.PI*r,sw=20,off=0;
  var gap=items.length>1?sw+4:0;   // Lücke = Strichbreite (für runde Kappen) + 4px Spalt
  var s='<svg viewBox="0 0 192 192" width="100%" style="height:206px;overflow:visible">';
  s+='<defs><filter id="dGlow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="2" stdDeviation="3.5" flood-color="#000" flood-opacity=".4"/></filter></defs>';
  s+='<g transform="rotate(-90 96 96)">';
  s+='<circle cx="96" cy="96" r="'+r+'" fill="none" stroke="rgba(6,59,55,.06)" stroke-width="'+sw+'"/>';
  items.forEach(function(it,i){var full=C*it.v/total,len=Math.max(2,full-gap),col=PAL[i%PAL.length];
    s+='<circle class="d-seg" cx="96" cy="96" r="'+r+'" fill="none" stroke="'+col+'" stroke-width="'+sw+'" stroke-linecap="round" stroke-dasharray="'+(anim&&!RM?0:len)+' '+(anim&&!RM?C:C-len)+'" data-len="'+len+'" data-c="'+C+'" stroke-dashoffset="'+(-off)+'" data-i="'+i+'" style="filter:url(#dGlow);cursor:pointer"/>';off+=full;});
  s+='</g>';
  s+='<text x="96" y="90" text-anchor="middle" font-family="Hanken Grotesk" font-size="30" font-weight="700" letter-spacing="-.5" fill="#063b37">'+nf(total)+'</text>';
  s+='<text x="96" y="108" text-anchor="middle" font-size="10.5" font-weight="600" letter-spacing=".5" fill="#5d7d77">BESUCHE</text></svg>';
  box.innerHTML=s;
  if(anim&&!RM){raf(function(){box.querySelectorAll('.d-seg').forEach(function(c,i){c.style.transition='stroke-dasharray .5s cubic-bezier(.22,.61,.36,1) '+(i*.05)+'s';c.style.strokeDasharray=c.dataset.len+' '+(c.dataset.c-c.dataset.len);});});}
  if(leg){var l='';items.forEach(function(it,i){var p=Math.round(it.v/total*100);
    l+='<div class="lg-item" data-i="'+i+'"><span class="lg-dot" style="background:'+PAL[i%PAL.length]+'"></span><span class="lg-name">'+esc(it.label)+'</span><span class="lg-pct">'+p+'%</span><span class="lg-val">'+nf(it.v)+'</span></div>';});
    leg.innerHTML=l;
    leg.querySelectorAll('.lg-item').forEach(function(el){var i=+el.dataset.i;
      el.addEventListener('mouseenter',function(){box.querySelectorAll('.d-seg').forEach(function(c){c.style.opacity=(+c.dataset.i===i?'1':'.3');});});
      el.addEventListener('mouseleave',function(){box.querySelectorAll('.d-seg').forEach(function(c){c.style.opacity='1';});});});}
  box.querySelectorAll('.d-seg').forEach(function(c){c.addEventListener('mousemove',function(e){var it=items[+c.dataset.i];showTip(e,esc(it.label)+': <b>'+nf(it.v)+'</b> ('+Math.round(it.v/total*100)+'%)');});c.addEventListener('mouseleave',hideTip);});
}

/* ---------- Themen nach Wochentag & Uhrzeit (interaktiver Explorer) ----------
   Arbeitet auf zeitgestempelten Besuchen (stunde>0; 0 Uhr = Platzhalter alter
   Bulk-Importe ohne Uhrzeit). Filter (Tage + Stundenfenster) liegen im
   Modulstatus, damit sie globale Re-Renders überleben. */
var teFilter={days:[0,1,2,3,4],h0:null,h1:null,hMin:7,hMax:18,wired:false};
var TE_DAYS=[0,1,2,3,4]; // nur Mo–Fr (Kundencenter geschlossen am Wochenende)
function teTimed(rows){return rows.filter(function(r){return r.stunde>0&&r.stunde!=null&&r.stunde<=23;});}
function teHourLbl(h){return (''+h).padStart(2,'0')+':00';}
function teUpdateSlider(){
  var f0=document.getElementById('teH0'),f1=document.getElementById('teH1'),
      fill=document.getElementById('teFill'),lbl=document.getElementById('teRangeLbl');
  if(!f0||!f1)return;
  var span=Math.max(1,teFilter.hMax-teFilter.hMin);
  var l=(teFilter.h0-teFilter.hMin)/span*100, r=(teFilter.h1-teFilter.hMin)/span*100;
  fill.style.left=l+'%';fill.style.width=Math.max(0,r-l)+'%';
  f0.value=teFilter.h0;f1.value=teFilter.h1;
  lbl.textContent=teHourLbl(teFilter.h0)+' – '+teHourLbl(teFilter.h1+1)+' Uhr';
}
function teDrawDays(){
  var box=document.getElementById('teDays');if(!box)return;
  var all=teFilter.days.length===TE_DAYS.length;
  var h='<button type="button" class="te-chip te-chip-all'+(all?' active':'')+'" data-all="1">Alle</button>';
  TE_DAYS.forEach(function(i){h+='<button type="button" class="te-chip'+(teFilter.days.indexOf(i)!==-1?' active':'')+'" data-d="'+i+'">'+WD[i]+'</button>';});
  box.innerHTML=h;
}
function initThemeExplorer(){
  if(teFilter.wired)return;
  var slider=document.getElementById('teSlider'),daysBox=document.getElementById('teDays');
  if(!slider||!daysBox)return;
  // Stundenspanne aus den Daten ableiten (alle zeitgestempelten Besuche)
  var timed=teTimed(V),mn=23,mx=0;
  timed.forEach(function(r){if(r.stunde<mn)mn=r.stunde;if(r.stunde>mx)mx=r.stunde;});
  if(mx<mn){mn=7;mx=18;}
  teFilter.hMin=mn;teFilter.hMax=mx;teFilter.h0=mn;teFilter.h1=mx;
  var f0=document.getElementById('teH0'),f1=document.getElementById('teH1');
  [f0,f1].forEach(function(f){f.min=mn;f.max=mx;f.step=1;});
  function onSlide(which){
    var v0=+f0.value,v1=+f1.value;
    if(which===0){if(v0>v1){v0=v1;}teFilter.h0=v0;}
    else{if(v1<v0){v1=v0;}teFilter.h1=v1;}
    // oberer Thumb soll erreichbar bleiben, wenn beide am selben Punkt liegen
    f0.style.zIndex=(teFilter.h0>=teFilter.hMax-((teFilter.hMax-teFilter.hMin)*0.15))?'4':'3';
    teUpdateSlider();renderThemeResults(false);
  }
  f0.addEventListener('input',function(){onSlide(0);});
  f1.addEventListener('input',function(){onSlide(1);});
  daysBox.addEventListener('click',function(e){
    var b=e.target.closest('.te-chip');if(!b)return;
    if(b.dataset.all){teFilter.days=teFilter.days.length===TE_DAYS.length?[]:TE_DAYS.slice();}
    else{var d=+b.dataset.d,i=teFilter.days.indexOf(d);
      if(i!==-1)teFilter.days.splice(i,1);else teFilter.days.push(d);}
    teDrawDays();renderThemeResults(true);
  });
  teFilter.wired=true;
  teDrawDays();teUpdateSlider();
}
function renderThemeResults(anim){
  var sumBox=document.getElementById('teSummary'),resBox=document.getElementById('teResults');
  if(!sumBox||!resBox)return;
  var base=teTimed(rowsIn.apply(null,currentRange()));
  var rows=base.filter(function(r){return teFilter.days.indexOf(r.dow)!==-1&&r.stunde>=teFilter.h0&&r.stunde<=teFilter.h1;});
  var dayTxt=teFilter.days.length===TE_DAYS.length?'Mo–Fr':teFilter.days.slice().sort(function(a,b){return a-b;}).map(function(d){return WD[d];}).join(', ');
  var hourTxt=teHourLbl(teFilter.h0)+'–'+teHourLbl(teFilter.h1+1);

  if(!teFilter.days.length){
    sumBox.innerHTML='';
    resBox.innerHTML='<p class="te-empty">Keinen Wochentag gewählt – bitte mindestens einen Tag aktivieren.</p>';
    return;
  }
  // Summary-Kacheln
  var withKat=rows.filter(function(r){return r.kategorie;});
  var counts={};withKat.forEach(function(r){var k=stripPfx(r.kategorie);counts[k]=(counts[k]||0)+1;});
  var items=Object.keys(counts).map(function(k){return {label:k,v:counts[k]};}).sort(function(a,b){return b.v-a.v;});
  var total=withKat.length;
  sumBox.innerHTML=
    '<div class="te-stat"><span class="te-stat-n">'+nf(total)+'</span><span class="te-stat-l">Besuche im Filter</span></div>'+
    '<div class="te-stat"><span class="te-stat-n">'+nf(items.length)+'</span><span class="te-stat-l">Themen</span></div>'+
    '<div class="te-stat te-stat-wide"><span class="te-stat-when">'+hourTxt+' Uhr</span><span class="te-stat-l">'+dayTxt+'</span></div>';

  if(!items.length){
    resBox.innerHTML='<p class="te-empty">Keine zeitgestempelten Besuche in diesem Fenster.</p>';
    return;
  }
  var shown=items.slice(0,10),max=shown[0].v||1;
  var h='';
  shown.forEach(function(it,i){
    var pct=Math.round(it.v/total*100),col=PAL[i%PAL.length];
    h+='<div class="te-item">'+
       '<span class="te-rank">'+(i+1)+'</span>'+
       '<div class="te-body"><div class="te-line"><span class="te-name">'+esc(it.label)+'</span>'+
       '<span class="te-vals"><b class="te-sum">'+nf(it.v)+'</b><span class="te-pct">'+pct+'%</span></span></div>'+
       '<div class="te-bar"><i data-w="'+(it.v/max*100)+'" style="background:linear-gradient(90deg,'+col+','+col+'33);'+(anim&&!RM?'':'width:'+(it.v/max*100)+'%')+'"></i></div></div>'+
       '</div>';
  });
  if(items.length>shown.length){
    var rest=items.slice(shown.length).reduce(function(s,x){return s+x.v;},0);
    h+='<div class="te-more">+ '+nf(items.length-shown.length)+' weitere Themen · '+nf(rest)+' Besuche ('+Math.round(rest/total*100)+'%)</div>';
  }
  resBox.innerHTML=h;
  if(anim&&!RM)raf(function(){resBox.querySelectorAll('.te-bar i').forEach(function(el){el.style.width=el.dataset.w+'%';});});
}

/* ---------- vertical bars (wday/hour) ---------- */
function vbars(boxId,labels,values,full,anim){
  var box=document.getElementById(boxId);
  var W=Math.max(280,Math.round(box.clientWidth)||400),H=214,pad={l:34,r:8,t:18,b:26};
  var max=Math.max(1,Math.max.apply(null,values)),n=values.length,iw=W-pad.l-pad.r,ih=H-pad.t-pad.b;
  var gap=iw/n,bw=Math.min(42,gap*0.6);
  var s='<svg viewBox="0 0 '+W+' '+H+'" width="100%" style="height:214px"><defs>'+
    '<linearGradient id="bg-'+boxId+'" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="'+ACC+'"/><stop offset="1" stop-color="#8c6b00"/></linearGradient></defs>';
  for(var g=0;g<=3;g++){var gv=Math.round(max*g/3),gy=pad.t+ih-ih*g/3;
    s+='<line class="gridline" x1="'+pad.l+'" y1="'+gy+'" x2="'+(W-pad.r)+'" y2="'+gy+'"/>';
    s+='<text class="axis" x="'+(pad.l-6)+'" y="'+(gy+4)+'" text-anchor="end">'+nf(gv)+'</text>';}
  values.forEach(function(v,i){var x=pad.l+gap*i+(gap-bw)/2,bh=Math.max(0,ih*v/max),y=pad.t+ih-bh;
    s+='<rect class="bar" x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+bh.toFixed(1)+'" rx="6" fill="url(#bg-'+boxId+')" data-i="'+i+'" style="transform-box:fill-box;transform-origin:center bottom;'+(anim&&!RM?'transform:scaleY(0)':'')+'"/>';
    s+='<text class="axis" x="'+(x+bw/2).toFixed(1)+'" y="'+(H-8)+'" text-anchor="middle">'+esc(labels[i])+'</text>';});
  s+='</svg>';box.innerHTML=s;
  if(anim&&!RM)raf(function(){box.querySelectorAll('.bar').forEach(function(el,i){el.style.transition='transform .4s cubic-bezier(.22,.61,.36,1) '+(i*.02)+'s';el.style.transform='scaleY(1)';});});
  box.querySelectorAll('.bar').forEach(function(rc){rc.addEventListener('mousemove',function(e){showTip(e,(full?esc(full[+rc.dataset.i]):esc(labels[+rc.dataset.i]))+': <b>'+nf(values[+rc.dataset.i])+'</b>');});rc.addEventListener('mouseleave',hideTip);});
}
function renderWday(rows,anim){if(!rows.length){emptyCard('chartWday','Keine Besuche im Zeitraum.');return;}var c=[0,0,0,0,0,0,0];rows.forEach(function(r){if(r.dow>=0&&r.dow<=6)c[r.dow]++;});vbars('chartWday',WD,c,WDF,anim);}
function renderHour(rows,anim){
  if(!rows.length){emptyCard('chartHour','Keine Besuche im Zeitraum.');return;}
  var c={},mn=23,mx=0;
  rows.forEach(function(r){if(r.stunde<0||r.stunde==null)return;c[r.stunde]=(c[r.stunde]||0)+1;if(r.stunde<mn)mn=r.stunde;if(r.stunde>mx)mx=r.stunde;});
  if(mx<mn){mn=8;mx=18;}
  var L=[],Vv=[],F=[];
  for(var h=mn;h<=mx;h++){L.push(h);Vv.push(c[h]||0);F.push(h+':00–'+(h+1)+':00 Uhr');}
  vbars('chartHour',L,Vv,F,anim);
}

/* ---------- KPIs ---------- */
function spark(weeks){var W=120,H=36,max=Math.max(1,Math.max.apply(null,weeks)),n=weeks.length;
  var d='';weeks.forEach(function(v,i){d+=(i?'L':'M')+(W*i/(n-1)).toFixed(1)+' '+(H-3-(H-6)*v/max).toFixed(1)+' ';});
  return '<svg viewBox="0 0 '+W+' '+H+'" width="100%" style="height:36px" preserveAspectRatio="none"><defs><linearGradient id="sp" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="'+ACC+'" stop-opacity=".3"/><stop offset="1" stop-color="'+ACC+'" stop-opacity="0"/></linearGradient></defs>'+
    '<path d="'+d+'L'+W+' '+H+' L0 '+H+' Z" fill="url(#sp)"/><path d="'+d+'" fill="none" stroke="'+ACC+'" stroke-width="2"/></svg>';}
function delta(c,p){if(p===0)return c>0?{t:'+'+c,c:'up',a:'▲'}:{t:'±0',c:'flat',a:'•'};var x=Math.round((c-p)/p*100);return {t:(x>0?'+':'')+x+'%',c:x>0?'up':x<0?'down':'flat',a:x>0?'▲':x<0?'▼':'•'};}
function last12w(){var a=[];for(var i=11;i>=0;i--){var e=addDays(nowDate,-7*i),s=addDays(e,-6);a.push(countRange(dateToYmd(s),dateToYmd(e)));}return a;}
// Adaptive KPI-Karten: Hauptzahl = gewählter Zeitraum, Vergleich + Treiber passend zum Filter.
function renderKPIs(anim){
  var info=periodInfo(),rows=rowsIn(info.a,info.b),cur=rows.length,sp=spark(last12w());
  var cards=[];
  // 1) Besucher im Zeitraum (+ Vergleich zur passenden Vorperiode)
  var prev=info.prevA!=null?countRange(info.prevA,info.prevB):null;
  cards.push({l:'Besucher',i:'week',v:cur,d:prev==null?null:delta(cur,prev),s:prev==null?'Gesamtzeitraum':info.cmpLabel});
  // 2) Nachfrage-Index (Ist vs. statistische Erwartung) – bei Gesamt: stärkstes Jahr
  if(info.isAll){var py=peakYearOf(rows);cards.push({l:'Stärkstes Jahr',i:'year',v:py?py.v:0,d:null,s:py?(''+py.y):'—'});}
  else{
    var expEnd=Math.min(info.b,nowYmd);if(expEnd<info.a)expEnd=info.b;
    var exp=expectedForRange(info.a,expEnd),idx=exp>0?Math.round(cur/exp*100):100,diff=idx-100;
    cards.push({l:'Nachfrage-Index',i:'year',v:idx,
      d:{t:(diff>0?'+':'')+diff+'%',c:diff>0?'up':diff<0?'down':'flat',a:diff>0?'▲':diff<0?'▼':'•'},
      s:'Ø-Niveau = 100 · erwartet '+nf(Math.round(exp))});
  }
  // 3) Spitzenwert: Stunde (Tagesfilter) / Monat (Gesamt) / Tag
  if(info.grain==='hour'){var ph=peakHourOf(rows);cards.push({l:'Stärkste Besuchszeit',i:'sun',v:ph?ph.v:0,d:null,s:ph?(ph.h+'–'+(ph.h+1)+' Uhr'):'—'});}
  else if(info.isAll){var pm=peakMonthOf(rows);cards.push({l:'Stärkster Monat',i:'sun',v:pm?pm.v:0,d:null,s:pm?ymLabel(pm.ym):'—'});}
  else{var pd=peakDayOf(rows);cards.push({l:'Stärkster Tag',i:'sun',v:pd?pd.v:0,d:null,s:pd?ymdShort(pd.ymd):'—'});}
  // 4) Top-Anliegen im Zeitraum
  var tk=topKatOf(rows,1);cards.push({l:'Top-Anliegen',i:'month',v:tk.length?tk[0].v:0,d:null,s:tk.length?(esc(tk[0].label)+' · '+tk[0].pct+'%'):'—'});
  var h='';cards.forEach(function(c,idx){h+=
    '<div class="card kpi reveal" style="animation-delay:'+(idx*.03)+'s"><div class="k-top">'+esc(c.l)+'<span class="chip">'+svg(ICON[c.i])+'</span></div>'+
    '<div class="num" data-v="'+c.v+'">0</div>'+
    '<div>'+(c.d?'<span class="k-delta '+c.d.c+'">'+c.d.a+' '+c.d.t+'</span>':'')+'<span class="k-sub">'+c.s+'</span></div>'+
    '<div class="k-spark">'+sp+'</div></div>';});
  var box=document.getElementById('kpis');box.innerHTML=h;
  box.querySelectorAll('.num').forEach(function(el){countUp(el,+el.dataset.v,anim);});
}

/* ---------- Standort-KPIs ---------- */
function renderLocKPIs(anim){
  var r=currentRange(),a=r[0],b=r[1];
  var total=0,eC=0,kC=0;
  for(var i=0;i<V.length;i++){var row=V[i];if(row.ymd>=a&&row.ymd<=b){total++;if(row.standort==='Euskirchen')eC++;else if(row.standort==='Kall')kC++;}}
  var locIc='<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>';
  var globeIc='<circle cx="12" cy="12" r="9"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20A15.3 15.3 0 0 1 12 2"/>';
  var items=[{l:'Besucher Gesamt',v:total,ic:globeIc},{l:'Euskirchen',v:eC,ic:locIc},{l:'Kall',v:kC,ic:locIc}];
  var h='';items.forEach(function(it,idx){h+=
    '<div class="card kpi reveal" style="animation-delay:'+(idx*.03)+'s"><div class="k-top">'+it.l+'<span class="chip">'+svg(it.ic)+'</span></div>'+
    '<div class="num" data-v="'+it.v+'">0</div></div>';});
  var box=document.getElementById('kpis-loc');if(!box)return;
  box.innerHTML=h;
  box.querySelectorAll('.num').forEach(function(el){countUp(el,+el.dataset.v,anim);});
}

/* ---------- Besucherprognose ---------- */
var weekdayMonthAvg=memo(function(){
  // Bezugsgröße „üblich" = gleitendes 2-Jahres-Fenster bis zum letzten Datentag. Die Historie
  // ist stark instationär (frühe Jahre dünn, zuletzt ~10× so viel) – ein Voll-Historie-Schnitt
  // würde Erwartung/Index/Prognose massiv verzerren. 2 Jahre liefern 2 Stichproben je
  // (Monat × Wochentag) und bilden das aktuelle Aufkommen realistisch ab.
  var endDate=ymdToDate(dataMaxYmd);
  var winStartYmd=Math.max(minYmd,dateToYmd(addDays(endDate,-730)));
  var startDate=ymdToDate(winStartYmd);
  var perDay={};
  for(var i=0;i<V.length;i++){
    var r=V[i];if(r.ymd>dataMaxYmd)break;
    if(!matchStand(r.standort))continue;
    perDay[r.ymd]=(perDay[r.ymd]||0)+1;
  }
  var sum=[],cnt=[];
  for(var mo=0;mo<12;mo++){sum[mo]=[0,0,0,0,0,0,0];cnt[mo]=[0,0,0,0,0,0,0];}
  for(var t=new Date(startDate);t<=endDate;t=addDays(t,1)){var mo2=t.getMonth(),wd=(t.getDay()+6)%7,yy=dateToYmd(t);sum[mo2][wd]+=perDay[yy]||0;cnt[mo2][wd]++;}
  return sum.map(function(s,mo){return s.map(function(v,w){return cnt[mo][w]?v/cnt[mo][w]:0;});});
}, function(){return _dataVer+'|'+state.standort;});
var hourlyCum=memo(function(wd){
  var byHour=new Array(24).fill(0),total=0;
  for(var i=0;i<V.length;i++){
    var r=V[i];if(r.ymd>dataMaxYmd)break;
    if(!matchStand(r.standort)||r.dow!==wd)continue;
    if(r.stunde<0||r.stunde>23)continue;
    byHour[r.stunde]++;total++;
  }
  var cum=[],acc=0;for(var h=0;h<24;h++){acc+=byHour[h];cum[h]=total?acc/total:0;}
  return cum;
}, function(wd){return _dataVer+'|'+state.standort+'|'+wd;});
// Prognose-Karte adaptiv: laufender Zeitraum → Hochrechnung; abgeschlossen → Soll/Ist
// (tatsächlich vs. statistische Erwartung); Gesamt → Langzeit-Überblick.
function renderForecast(anim){
  var box=document.getElementById('fcGrid');if(!box)return;
  var info=periodInfo(),wdm=weekdayMonthAvg();
  var y=nowDate.getFullYear(),m=nowDate.getMonth(),todayWd=(nowDate.getDay()+6)%7;
  var rows=rowsIn(info.a,info.b),cur=rows.length;
  var subEl=document.querySelector('#forecastCard .sub');
  function wdBars(){var w=wdm[m].slice(0,5),mx=Math.max.apply(null,w)||1;
    return w.map(function(a,i){var hh=Math.round(a/mx*100);
      return '<div class="fc-wd'+(i===todayWd?' is-today':'')+'"><div class="fc-wd-track"><i data-h="'+hh+'" style="height:'+(anim&&!RM?0:hh)+'%"></i></div><span>'+WD[i]+'</span><b>'+nf(Math.round(a))+'</b></div>';}).join('');}
  var cells,bars='',sub='';
  if(info.isClosed){
    var exp=expectedForRange(info.a,info.b),diff=exp>0?Math.round((cur-exp)/exp*100):0,col=diff>0?'#1d9e75':diff<0?'#c0492a':'#5d7d77';
    cells=[{l:'Tatsächlich',v:cur,s:info.label},
           {l:'Erwartet',v:Math.round(exp),s:'statistischer Ø'},
           {l:'Abweichung',raw:'<span style="color:'+col+'">'+(diff>0?'+':'')+diff+'%</span>',s:diff>0?'über Erwartung':diff<0?'unter Erwartung':'wie erwartet'}];
    sub='Tatsächlich vs. statistische Erwartung (Ø Wochentag × Monat)';
  } else if(info.isAll){
    var py=peakYearOf(rows),yrs={};rows.forEach(function(r){yrs[Math.floor(r.ymd/10000)]=true;});var nY=Object.keys(yrs).length||1;
    cells=[{l:'Besucher gesamt',v:cur,s:fmtDE(info.a).slice(6)+'–'+fmtDE(info.b).slice(6)},
           {l:'Stärkstes Jahr',v:py?py.v:0,s:py?(''+py.y):'—'},
           {l:'Ø pro Jahr',v:Math.round(cur/nY),s:nf(nY)+' Jahre'}];
    sub='Langzeit-Überblick';
  } else {
    var avgToday=wdm[m][todayWd],actualToday=countRange(nowYmd,nowYmd);
    var cum=hourlyCum(todayWd),curHour=new Date().getHours(),frac=cum[Math.min(23,Math.max(0,curHour))]||0;
    var projToday=(frac>=0.15&&actualToday>0)?Math.round(actualToday/frac):Math.round(avgToday);projToday=Math.max(projToday,actualToday);
    var restToday=Math.max(0,avgToday-actualToday);
    if(info.period==='woche'){
      var remWeek=0;for(var tw=addDays(nowDate,1);tw<=ymdToDate(info.b);tw=addDays(tw,1))remWeek+=wdm[tw.getMonth()][(tw.getDay()+6)%7];
      var projWeek=Math.round(cur+restToday+remWeek),avgWeek=wdm[m].slice(0,5).reduce(function(s,v){return s+v;},0);
      cells=[{l:'Prognose Woche',v:projWeek,s:'bislang '+nf(cur)},{l:'Heute',v:projToday,s:'aktuell '+nf(actualToday)},{l:'Ø Woche',v:Math.round(avgWeek),s:'Mo–Fr Schnitt'}];
      bars=wdBars();sub='Wochen-Hochrechnung aus Ø Wochentag × Monat & laufendem Tag';
    } else if(info.period==='ytd'){
      var yEnd=new Date(y,11,31),remYear=0;for(var ty=addDays(nowDate,1);ty<=yEnd;ty=addDays(ty,1))remYear+=wdm[ty.getMonth()][(ty.getDay()+6)%7];
      var projYear=Math.round(cur+restToday+remYear),pvYear=countRange((y-1)*10000+101,(y-1)*10000+1231);
      var yd=pvYear>0?Math.round((projYear-pvYear)/pvYear*100):0,ycol=yd>0?'#1d9e75':yd<0?'#c0492a':'#5d7d77';
      cells=[{l:'Prognose '+y,v:projYear,s:'bislang '+nf(cur)},{l:'Vorjahr gesamt',v:pvYear,s:''+(y-1)},{l:'ggü. Vorjahr',raw:'<span style="color:'+ycol+'">'+(yd>0?'+':'')+yd+'%</span>',s:'erwartet'}];
      sub='Jahres-Hochrechnung aus historischem Ø';
    } else if(info.period==='custom'){
      var remC=0;for(var tc=addDays(nowDate,1);tc<=ymdToDate(info.b);tc=addDays(tc,1))remC+=wdm[tc.getMonth()][(tc.getDay()+6)%7];
      var projC=Math.round(cur+restToday+remC),expC=expectedForRange(info.a,info.b);
      cells=[{l:'Prognose Zeitraum',v:projC,s:'bislang '+nf(cur)},{l:'Heute',v:projToday,s:'aktuell '+nf(actualToday)},{l:'Erwartet gesamt',v:Math.round(expC),s:'statistisch'}];
      sub='Hochrechnung bis Zeitraumende';
    } else {
      var mEnd=new Date(y,m+1,0),actualMonth=countRange(dateToYmd(new Date(y,m,1)),nowYmd),remMonth=0;
      for(var t=addDays(nowDate,1);t<=mEnd;t=addDays(t,1))remMonth+=wdm[t.getMonth()][(t.getDay()+6)%7];
      var projMonth=Math.round(actualMonth+restToday+remMonth);
      var next7=restToday;for(var t2=addDays(nowDate,1);t2<=addDays(nowDate,7);t2=addDays(t2,1))next7+=wdm[t2.getMonth()][(t2.getDay()+6)%7];next7=Math.round(next7);
      cells=[{l:'Prognose heute',v:projToday,s:'aktuell '+nf(actualToday)+' · Ø '+WD[todayWd]+' '+nf(Math.round(avgToday))},
             {l:'Prognose '+MON[m]+'.',v:projMonth,s:'bislang '+nf(actualMonth)},
             {l:'Nächste 7 Tage',v:next7,s:'voraussichtlich'}];
      bars=wdBars();sub='Hochrechnung aus historischem Ø Wochentag × Monat (12 Monate) & laufendem Tag';
    }
  }
  if(subEl&&sub)subEl.innerHTML=sub;
  box.innerHTML='<div class="fc-stats">'+cells.map(function(c){
    return '<div class="fc-cell"><div class="fc-l">'+c.l+'</div><div class="num fc-num"'+(c.raw!=null?'':' data-v="'+c.v+'"')+'>'+(c.raw!=null?c.raw:'0')+'</div><div class="fc-s">'+c.s+'</div></div>';
  }).join('')+'</div>'+(bars?'<div class="fc-wdbars">'+bars+'</div>':'');
  box.querySelectorAll('.fc-num[data-v]').forEach(function(el){countUp(el,+el.dataset.v,anim);});
  if(bars&&anim&&!RM)raf(function(){box.querySelectorAll('.fc-wd-track i').forEach(function(el){el.style.transition='height .45s var(--ease)';el.style.height=el.dataset.h+'%';});});
}

/* ---------- Tab 2: Standorte ---------- */
// Zählt Besuche eines Standorts in einem Range direkt aus V (unabhängig vom Standort-Dropdown),
// damit der Standort-Tab IMMER beide Standorte vergleicht.
function cntStand(name,a,b){var n=0;for(var i=0;i<V.length;i++){var r=V[i];if(r.ymd>=a&&r.ymd<=b&&r.standort===name)n++;}return n;}
function scorecardFor(name,dateRows,info){
  var sRows=dateRows.filter(function(r){return r.standort===name;});
  var count=sRows.length,total=dateRows.length||1;
  var bd=Math.max(1,businessDays(info.a,info.b));
  var katItems=topKatOf(sRows,1),topKat=katItems.length?katItems[0].label:'–';
  var wd=[0,0,0,0,0,0,0];sRows.forEach(function(r){if(r.dow>=0&&r.dow<=6)wd[r.dow]++;});
  var topWday=count?WDF[wd.indexOf(Math.max.apply(null,wd))]:'–';
  var ph=peakHourOf(sRows),spitzenzeit=ph?(ph.h+':00–'+(ph.h+1)+':00 Uhr'):'–';
  var prev=info.prevA!=null?cntStand(name,info.prevA,info.prevB):null;
  return {name:name,count:count,avgPerDay:(count/bd).toFixed(1),anteil:Math.round(count/total*100),
          topKat:topKat,topWdayName:topWday,spitzenzeit:spitzenzeit,prev:prev,
          dlt:(prev==null||prev===0)?null:delta(count,prev),sRows:sRows};
}
function renderStandortTab(rows,anim){
  var info=periodInfo();
  var dateRows=[];for(var i=0;i<V.length;i++){var r=V[i];if(r.ymd>=info.a&&r.ymd<=info.b)dateRows.push(r);}
  renderDonut(dateRows,anim);
  var standorte=['Euskirchen','Kall'];
  var cards=standorte.map(function(name){return scorecardFor(name,dateRows,info);});
  var cBox=document.getElementById('standortCards');if(!cBox)return;
  if(!dateRows.length){cBox.innerHTML='<p class="sub" style="text-align:center;padding:32px 0;grid-column:1/-1">Keine Besuche im gewählten Zeitraum.</p>';
    var t0=document.getElementById('standortInsightText');if(t0)t0.innerHTML='';
    var r0=document.getElementById('standortInsightRight');if(r0)r0.innerHTML='';return;}
  cBox.innerHTML=cards.map(function(c){
    var auff=c.dlt?'<span class="k-delta '+c.dlt.c+'">'+c.dlt.a+' '+c.dlt.t+'</span>':'<span class="si-val">–</span>';
    return '<div class="si-card reveal">'+
      '<div class="si-title"><h3>'+c.name+'</h3><span class="si-badge">'+c.anteil+'% im Zeitraum</span></div>'+
      '<div class="si-rows">'+
        '<div class="si-row"><span class="si-label">Besucher gesamt</span><span class="si-val accent">'+nf(c.count)+'</span></div>'+
        '<div class="si-row"><span class="si-label">&#216; pro Öffnungstag (Mo–Fr)</span><span class="si-val">'+c.avgPerDay+'</span></div>'+
        '<div class="si-row"><span class="si-label">Häufigstes Anliegen</span><span class="si-val">'+esc(c.topKat)+'</span></div>'+
        '<div class="si-row"><span class="si-label">Stärkster Wochentag</span><span class="si-val">'+c.topWdayName+'</span></div>'+
        '<div class="si-row"><span class="si-label">Stärkste Besuchszeit</span><span class="si-val">'+c.spitzenzeit+'</span></div>'+
        '<div class="si-row"><span class="si-label">'+(info.cmpLabel||'ggü. Vorperiode')+'</span>'+auff+'</div>'+
      '</div>'+
      '<div class="si-pct-bar"><i data-w="'+c.anteil+'" style="width:'+(anim&&!RM?'0':c.anteil)+'%"></i></div>'+
    '</div>';
  }).join('');
  if(anim&&!RM)raf(function(){cBox.querySelectorAll('.si-pct-bar i').forEach(function(el){el.style.width=el.dataset.w+'%';});});
  var tBox=document.getElementById('standortInsightText');
  if(tBox&&cards.length>=2&&cards[0].count&&cards[1].count){
    var e=cards[0],k=cards[1];
    var lines=[
      '<b>'+e.name+'</b> generiert '+e.anteil+'% der Besuche · Peak '+e.spitzenzeit+' · Top: <b>'+esc(e.topKat)+'</b>.',
      '<b>'+k.name+'</b> generiert '+k.anteil+'% der Besuche · Peak '+k.spitzenzeit+' · Top: <b>'+esc(k.topKat)+'</b>.'];
    function katShare(sR){var mm={},t=0;sR.forEach(function(r){if(r.kategorie){var kk=stripPfx(r.kategorie);mm[kk]=(mm[kk]||0)+1;t++;}});var o={};Object.keys(mm).forEach(function(kk){o[kk]=mm[kk]/(t||1);});return o;}
    var eS=katShare(e.sRows),kS=katShare(k.sRows),allK={};Object.keys(eS).concat(Object.keys(kS)).forEach(function(kk){allK[kk]=1;});
    var bestK=null;Object.keys(allK).forEach(function(kk){var g=(kS[kk]||0)-(eS[kk]||0);if(!bestK||Math.abs(g)>Math.abs(bestK.g))bestK={k:kk,g:g};});
    if(bestK&&Math.abs(bestK.g)>=0.05)lines.push('<b>'+(bestK.g>0?k.name:e.name)+'</b> hat einen überdurchschnittlich hohen Anteil an <b>'+esc(bestK.k)+'</b> (+'+Math.round(Math.abs(bestK.g)*100)+' %-Punkte).');
    var ePk=peakHourOf(e.sRows),kPk=peakHourOf(k.sRows);
    if(ePk&&kPk&&ePk.h!==kPk.h)lines.push('<b>'+(kPk.h>ePk.h?k.name:e.name)+'</b> erreicht seine Abschluss-Spitze später am Tag.');
    tBox.innerHTML='<h3 style="margin:0 0 14px;font-size:17px;font-weight:600">Automatische Insights</h3><div class="si-text-box">'+
      lines.slice(0,5).map(function(t,i){return '<div class="si-text-item"><div class="si-text-dot" style="background:'+PAL[i%PAL.length]+'"></div><p>'+t+'</p></div>';}).join('')+'</div>';
  }
  var rBox=document.getElementById('standortInsightRight');
  if(rBox){
    rBox.innerHTML=cards.map(function(c){
      return '<div class="card" style="flex:1">'+
        '<div style="font-size:11.5px;font-weight:700;color:var(--muted);letter-spacing:.06em;margin-bottom:6px">'+c.name.toUpperCase()+'</div>'+
        '<div style="font-family:Hanken Grotesk,sans-serif;font-size:32px;font-weight:700;color:var(--acc-ink);letter-spacing:-.5px">'+nf(c.count)+'</div>'+
        '<div style="font-size:12px;color:var(--muted-2);margin-top:4px;font-weight:600">Besuche &nbsp;·&nbsp; <b style="color:var(--ink)">'+c.anteil+'%</b></div>'+
      '</div>';
    }).join('');
  }
  // Vergleichstabelle
  var cmpBox=document.getElementById('standortCompare');
  if(cmpBox&&cards.length>=2){var e2=cards[0],k2=cards[1];
    function crow(l,a,b){return '<tr><td>'+l+'</td><td>'+a+'</td><td>'+b+'</td></tr>';}
    cmpBox.innerHTML='<table class="cmp-table"><thead><tr><th>Kennzahl</th><th>'+e2.name+'</th><th>'+k2.name+'</th></tr></thead><tbody>'+
      crow('Besucher',nf(e2.count),nf(k2.count))+crow('Anteil',e2.anteil+'%',k2.anteil+'%')+
      crow('Ø pro Öffnungstag',e2.avgPerDay,k2.avgPerDay)+crow('Stärkster Tag',e2.topWdayName,k2.topWdayName)+
      crow('Abschluss-Peak',e2.spitzenzeit,k2.spitzenzeit)+crow('Top-Anliegen',esc(e2.topKat),esc(k2.topKat))+'</tbody></table>';
  }
  // Themenprofil je Standort (relative Anteile)
  var thBox=document.getElementById('standortThemen');
  if(thBox){thBox.innerHTML=cards.map(function(c,ci){
    var tk=topKatOf(c.sRows,6),max=tk.length?tk[0].v:1;
    var bars=tk.length?tk.map(function(it,i){var col=PAL[(ci===0?0:3)+(i%3)];
      return '<div class="hbar"><div class="row"><b>'+esc(it.label)+'</b><span>'+it.pct+'%</span></div><div class="track"><i style="width:'+(it.v/max*100)+'%;background:linear-gradient(90deg,'+col+',#ffffff22)"></i></div></div>';}).join(''):'<p class="sub">Keine Daten</p>';
    return '<div class="th-col"><h4>'+esc(c.name)+'</h4>'+bars+'</div>';
  }).join('');}
}

/* ---------- Tab 3: Heatmap ---------- */
function renderHeatmap(rows,anim){
  var box=document.getElementById('chartHeatmap');if(!box)return;
  var timed=rows.filter(function(r){return r.stunde>0&&r.stunde<=23&&r.dow>=0&&r.dow<=4;});
  if(!timed.length){box.innerHTML='<p class="sub" style="text-align:center;padding:32px 0">Keine zeitgestempelten Daten im gewählten Zeitraum.</p>';return;}
  var mnH=23,mxH=0;
  timed.forEach(function(r){if(r.stunde<mnH)mnH=r.stunde;if(r.stunde>mxH)mxH=r.stunde;});
  var grid={},maxVal=0;
  timed.forEach(function(r){var key=r.dow+'_'+r.stunde;grid[key]=(grid[key]||0)+1;if(grid[key]>maxVal)maxVal=grid[key];});
  var days=[0,1,2,3,4],hours=[];
  for(var h=mnH;h<=mxH;h++)hours.push(h);
  var cellW=44,cellH=36,padL=46,padT=28,padB=18;
  var W=padL+hours.length*cellW+16,H=padT+days.length*cellH+padB;
  var s='<svg viewBox="0 0 '+W+' '+H+'" width="100%" style="height:'+H+'px">';
  hours.forEach(function(h,i){var x=padL+i*cellW+cellW/2;s+='<text class="axis" x="'+x.toFixed(1)+'" y="18" text-anchor="middle">'+h+'</text>';});
  days.forEach(function(d,di){
    var y=padT+di*cellH;
    s+='<text class="axis" x="'+(padL-8)+'" y="'+(y+cellH/2+4)+'" text-anchor="end">'+WD[d]+'</text>';
    hours.forEach(function(h,hi){
      var v=grid[d+'_'+h]||0,ratio=maxVal>0?v/maxVal:0;
      var r2=Math.round(200-(200-0)*ratio),g2=Math.round(230-(230-68)*ratio),b2=Math.round(225-(225-66)*ratio);
      var fill=v===0?'rgba(6,59,55,.05)':'rgb('+r2+','+g2+','+b2+')';
      var x=padL+hi*cellW;
      s+='<rect x="'+(x+2)+'" y="'+(y+2)+'" width="'+(cellW-4)+'" height="'+(cellH-4)+'" rx="6" fill="'+fill+'" data-d="'+d+'" data-h="'+h+'" data-v="'+v+'" style="cursor:default"/>';
      if(v>0){var tf=ratio>0.5?'#EAF6F2':'var(--ink)';s+='<text x="'+(x+cellW/2)+'" y="'+(y+cellH/2+4)+'" text-anchor="middle" font-size="11" font-weight="600" fill="'+tf+'">'+v+'</text>';}
    });
  });
  s+='</svg>';
  // Legende: Farbskala (wenig → viel) + Spitzenwert. Verlauf identisch zur Zellfärbung
  // oben (hell rgb(200,230,225) → e-regio-Grün rgb(0,68,66)).
  var legend='<div class="hm-legend">'+
    '<span class="hm-leg-item"><span class="hm-sw zero"></span>keine</span>'+
    '<span class="hm-leg-scale"><span class="hm-leg-lbl">wenig</span>'+
    '<span class="hm-leg-bar"></span>'+
    '<span class="hm-leg-lbl">viel</span></span>'+
    '<span class="hm-leg-max">Spitze <b>'+nf(maxVal)+'</b>/Std.</span>'+
  '</div>';
  box.innerHTML='<div class="heatmap-wrap">'+s+'</div>'+legend;
  box.querySelectorAll('rect[data-v]').forEach(function(rc){
    rc.addEventListener('mousemove',function(e){showTip(e,WDF[+rc.dataset.d]+' · '+rc.dataset.h+':00 Uhr: <b>'+nf(+rc.dataset.v)+'</b>');});
    rc.addEventListener('mouseleave',hideTip);
  });
}

/* ---------- Tab 3: Monatsvergleich ---------- */
var _monthlyBuckets=memo(function(){
  var buckets=[];
  for(var i=11;i>=0;i--){
    var d=addMonths(new Date(nowDate.getFullYear(),nowDate.getMonth(),1),-i);
    var y2=d.getFullYear(),mo=d.getMonth();
    var from=y2*10000+(mo+1)*100+1,to=dateToYmd(new Date(y2,mo+1,0));
    var count=0;
    for(var j=0;j<V.length;j++){var r=V[j];if(r.ymd>=from&&r.ymd<=to&&matchStand(r.standort))count++;}
    buckets.push({label:MON[mo]+' '+(''+y2).slice(2),v:count,isCurrent:i===0});
  }
  return buckets;
}, function(){return _dataVer+'|'+state.standort+'|'+nowYmd;});
function renderMonthlyComparison(anim){
  var box=document.getElementById('chartMonthly');if(!box)return;
  var buckets=_monthlyBuckets();
  var W=Math.max(360,Math.round(box.clientWidth)||640),H=220,pad={l:44,r:14,t:16,b:30};
  var n=buckets.length,max=Math.max(1,Math.max.apply(null,buckets.map(function(x){return x.v;})));
  var iw=W-pad.l-pad.r,ih=H-pad.t-pad.b,gap=iw/n,bw=Math.min(42,gap*0.65);
  var s='<svg viewBox="0 0 '+W+' '+H+'" width="100%" style="height:220px"><defs>'+
    '<linearGradient id="mg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="'+ACC+'"/><stop offset="1" stop-color="#8c6b00"/></linearGradient>'+
    '<linearGradient id="mg2" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#0f7a5a"/><stop offset="1" stop-color="#0a4d39"/></linearGradient></defs>';
  for(var g=0;g<=4;g++){var gv=Math.round(max*g/4),gy=pad.t+ih-ih*g/4;
    s+='<line class="gridline" x1="'+pad.l+'" y1="'+gy+'" x2="'+(W-pad.r)+'" y2="'+gy+'"/>';
    s+='<text class="axis" x="'+(pad.l-6)+'" y="'+(gy+4)+'" text-anchor="end">'+nf(gv)+'</text>';}
  buckets.forEach(function(d,i){
    var x=pad.l+gap*i+(gap-bw)/2,bh=Math.max(0,ih*d.v/max),y=pad.t+ih-bh;
    s+='<rect class="bar" x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+bh.toFixed(1)+'" rx="5" fill="'+(d.isCurrent?'url(#mg2)':'url(#mg)')+'" data-i="'+i+'" style="transform-box:fill-box;transform-origin:center bottom;'+(anim&&!RM?'transform:scaleY(0)':'')+'" />';
    s+='<text class="axis" x="'+(x+bw/2).toFixed(1)+'" y="'+(H-8)+'" text-anchor="middle">'+esc(d.label)+'</text>';
  });
  s+='</svg>';box.innerHTML=s;
  if(anim&&!RM)raf(function(){box.querySelectorAll('.bar').forEach(function(el,i){el.style.transition='transform .4s cubic-bezier(.22,.61,.36,1) '+(i*.02)+'s';el.style.transform='scaleY(1)';});});
  box.querySelectorAll('.bar').forEach(function(rc){rc.addEventListener('mousemove',function(e){var d=buckets[+rc.dataset.i];showTip(e,esc(d.label)+': <b>'+nf(d.v)+'</b>');});rc.addEventListener('mouseleave',hideTip);});
}

/* ---------- Tab 3: Forecast-Analyse ---------- */
// Vorperiodenvergleich: aktueller Zeitraum vs. vergleichbarer Vorzeitraum (absolut + %).
function renderForecastAnalysis(anim){
  var box=document.getElementById('fcAnalysis');if(!box)return;
  var info=periodInfo(),cur=countRange(info.a,info.b);
  if(info.prevA==null){
    box.innerHTML='<div class="fca-grid"><div class="fca-row"><div style="flex:1"><div class="fca-label">Gesamtzeitraum</div><div class="fca-sub">'+fmtDE(info.a)+' – '+fmtDE(info.b)+'</div></div><div class="fca-val">'+nf(cur)+'</div></div></div>';return;}
  var prev=countRange(info.prevA,info.prevB);
  var d=prev>0?Math.round((cur-prev)/prev*100):0,dc=d>0?'up':d<0?'down':'flat',ds=d>0?'+':'';
  var diff=cur-prev;
  box.innerHTML='<div class="fca-grid">'+
    '<div class="fca-row"><div style="flex:1"><div class="fca-label">Aktueller Zeitraum</div><div class="fca-sub">'+fmtDE(info.a)+' – '+fmtDE(info.b)+'</div></div><div class="fca-val">'+nf(cur)+'</div></div>'+
    '<div class="fca-row"><div style="flex:1"><div class="fca-label">Vorzeitraum</div><div class="fca-sub">'+fmtDE(info.prevA)+' – '+fmtDE(info.prevB)+'</div></div><div class="fca-val">'+nf(prev)+'</div><span class="fca-delta '+dc+'">'+ds+d+'%</span></div>'+
    '<div class="fca-row"><div style="flex:1"><div class="fca-label">Differenz</div><div class="fca-sub">'+info.cmpLabel+'</div></div><div class="fca-val">'+(diff>=0?'+':'')+nf(diff)+'</div></div>'+
  '</div>';
}

/* ---------- Tab 3: Kategorie-Trend ---------- */
var _katTrendData=memo(function(){
  var months=[];
  for(var i=11;i>=0;i--){
    var d=addMonths(new Date(nowDate.getFullYear(),nowDate.getMonth(),1),-i);
    var y2=d.getFullYear(),mo=d.getMonth();
    months.push({label:MON[mo]+' '+(''+y2).slice(2),from:y2*10000+(mo+1)*100+1,to:dateToYmd(new Date(y2,mo+1,0))});
  }
  var katTotals={};
  for(var j=0;j<V.length;j++){var r=V[j];if(r.kategorie&&matchStand(r.standort)){var k=stripPfx(r.kategorie);katTotals[k]=(katTotals[k]||0)+1;}}
  var topKats=Object.keys(katTotals).sort(function(a,b){return katTotals[b]-katTotals[a];}).slice(0,5);
  var series=topKats.map(function(kat){
    var vals=months.map(function(mo){
      var c=0;
      for(var ii=0;ii<V.length;ii++){var rr=V[ii];if(rr.ymd>=mo.from&&rr.ymd<=mo.to&&matchStand(rr.standort)&&rr.kategorie&&stripPfx(rr.kategorie)===kat)c++;}
      return c;
    });
    return {label:kat,vals:vals};
  });
  return {months:months,series:series};
}, function(){return _dataVer+'|'+state.standort+'|'+nowYmd;});
function renderKatTrend(anim){
  var box=document.getElementById('chartKatTrend');if(!box)return;
  var _kt=_katTrendData(),months=_kt.months,series=_kt.series;
  if(!series.length){box.innerHTML='<p class="sub" style="text-align:center;padding:32px 0">Keine Kategoriedaten vorhanden.</p>';return;}
  var KATPAL=['#004442','#dea600','#1f9bb0','#1d9e75','#3a7ca5'];
  var W=Math.max(360,Math.round(box.clientWidth)||760),H=260,pad={l:44,r:14,t:18,b:30};
  var n=months.length,iw=W-pad.l-pad.r,ih=H-pad.t-pad.b;
  var allVals=series.reduce(function(acc,s){return acc.concat(s.vals);},[]);
  var max=Math.max(1,Math.max.apply(null,allVals));
  function X(i){return pad.l+(n<=1?iw/2:iw*i/(n-1));}
  function Y(v){return pad.t+ih-ih*v/max;}
  var s='<svg viewBox="0 0 '+W+' '+H+'" width="100%" style="height:260px"><defs>';
  series.forEach(function(sr,si){s+='<linearGradient id="ktg'+si+'" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="'+KATPAL[si]+'" stop-opacity=".2"/><stop offset="1" stop-color="'+KATPAL[si]+'" stop-opacity="0"/></linearGradient>';});
  s+='</defs>';
  for(var g=0;g<=4;g++){var gv=Math.round(max*g/4),gy=Y(gv);
    s+='<line class="gridline" x1="'+pad.l+'" y1="'+gy+'" x2="'+(W-pad.r)+'" y2="'+gy+'"/>';
    s+='<text class="axis" x="'+(pad.l-6)+'" y="'+(gy+4)+'" text-anchor="end">'+nf(gv)+'</text>';}
  var lblEvery=Math.ceil(n/8);
  months.forEach(function(mo,i){if(i%lblEvery===0||i===n-1)s+='<text class="axis" x="'+X(i).toFixed(1)+'" y="'+(H-8)+'" text-anchor="middle">'+mo.label+'</text>';});
  series.forEach(function(sr,si){
    var col=KATPAL[si],line='';
    sr.vals.forEach(function(v,i){line+=(i?'L':'M')+X(i).toFixed(1)+' '+Y(v).toFixed(1)+' ';});
    var area=line+'L'+X(n-1).toFixed(1)+' '+Y(0)+' L'+X(0).toFixed(1)+' '+Y(0)+' Z';
    s+='<path d="'+area+'" fill="url(#ktg'+si+')" opacity="'+(anim&&!RM?'0':'1')+'" class="kt-area" data-si="'+si+'"/>';
    s+='<path class="kt-line" d="'+line+'" fill="none" stroke="'+col+'" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" data-si="'+si+'"'+(anim&&!RM?' style="stroke-dasharray:3000;stroke-dashoffset:3000"':'')+'/>';
    sr.vals.forEach(function(v,i){s+='<circle cx="'+X(i).toFixed(1)+'" cy="'+Y(v).toFixed(1)+'" r="3" fill="'+col+'" stroke="#fff" stroke-width="1.5" data-si="'+si+'" data-i="'+i+'" data-v="'+v+'" style="cursor:default"/>';});
  });
  s+='</svg>';
  var legH='<div class="kattrend-legend">'+series.map(function(sr,si){return '<span><i style="background:'+KATPAL[si]+'"></i>'+sr.label+'</span>';}).join('')+'</div>';
  box.innerHTML=legH+s;
  if(anim&&!RM){raf(function(){
    box.querySelectorAll('.kt-line').forEach(function(l){var len=l.getTotalLength?l.getTotalLength():3000;l.style.strokeDasharray=len;l.style.strokeDashoffset=len;l.style.transition='stroke-dashoffset .6s cubic-bezier(.22,.61,.36,1) '+(+l.dataset.si*.08)+'s';l.style.strokeDashoffset=0;});
    box.querySelectorAll('.kt-area').forEach(function(a){a.style.transition='opacity .4s ease '+(+a.dataset.si*.08)+'s';a.style.opacity=1;});
  });}
  box.querySelectorAll('circle[data-v]').forEach(function(c){c.addEventListener('mousemove',function(e){var si=+c.dataset.si,i=+c.dataset.i;showTip(e,series[si].label+' · '+months[i].label+': <b>'+nf(+c.dataset.v)+'</b>');});c.addEventListener('mouseleave',hideTip);});
}

/* ══════════════════════════════════════════════════════
   Phase 3/4: neue Analyse-Widgets + automatische Insights
   ══════════════════════════════════════════════════════ */

/* Generische zeilen-normalisierte Heatmap (Anliegen × Spalte). Zelltext = Zeilenanteil %. */
function matrixHeat(boxId,rowLabels,colLabels,grid,fmtCol,anim){
  var box=document.getElementById(boxId);if(!box)return;
  if(!rowLabels.length){emptyCard(boxId,'Keine Daten im Zeitraum.');return;}
  var cw=Math.max(30,Math.min(56,Math.round(((box.clientWidth||640)-160)/Math.max(1,colLabels.length)))),ch=30,padL=150,padT=24,padB=8;
  var W=padL+colLabels.length*cw+8,H=padT+rowLabels.length*ch+padB;
  var s='<svg viewBox="0 0 '+W+' '+H+'" width="100%" style="height:'+H+'px">';
  colLabels.forEach(function(c,ci){var x=padL+ci*cw+cw/2;s+='<text class="axis" x="'+x.toFixed(1)+'" y="16" text-anchor="middle">'+esc(fmtCol(c))+'</text>';});
  rowLabels.forEach(function(rl,ri){
    var y=padT+ri*ch,rowMax=Math.max.apply(null,grid[ri])||1,rowSum=grid[ri].reduce(function(a,b){return a+b;},0)||1;
    s+='<text class="axis" x="'+(padL-8)+'" y="'+(y+ch/2+4)+'" text-anchor="end">'+esc(rl.length>21?rl.slice(0,20)+'…':rl)+'</text>';
    colLabels.forEach(function(c,ci){
      var v=grid[ri][ci],ratio=v/rowMax;
      var r2=Math.round(200-200*ratio),g2=Math.round(230-162*ratio),b2=Math.round(225-159*ratio);
      var fill=v===0?'rgba(6,59,55,.05)':'rgb('+r2+','+g2+','+b2+')',x=padL+ci*cw;
      s+='<rect x="'+(x+2)+'" y="'+(y+2)+'" width="'+(cw-4)+'" height="'+(ch-4)+'" rx="5" fill="'+fill+'" data-r="'+ri+'" data-c="'+ci+'" data-v="'+v+'"/>';
      if(v>0&&ratio>0.16){var tf=ratio>0.5?'#EAF6F2':'var(--ink)';s+='<text x="'+(x+cw/2)+'" y="'+(y+ch/2+4)+'" text-anchor="middle" font-size="10" font-weight="600" fill="'+tf+'">'+Math.round(v/rowSum*100)+'%</text>';}
    });
  });
  s+='</svg>';box.innerHTML=s;
  box.querySelectorAll('rect[data-v]').forEach(function(rc){rc.addEventListener('mousemove',function(e){var ri=+rc.dataset.r,ci=+rc.dataset.c;showTip(e,esc(rowLabels[ri])+' · '+esc(fmtCol(colLabels[ci]))+': <b>'+nf(+rc.dataset.v)+'</b>');});rc.addEventListener('mouseleave',hideTip);});
}

/* Anliegen × Abschlusszeit – welche Themen treten zu welchen Uhrzeiten gehäuft auf? */
function renderAnliegenHour(rows,anim){
  var box=document.getElementById('chartAnliegenHour');if(!box)return;
  var timed=rows.filter(function(r){return r.stunde>0&&r.stunde<=23&&r.kategorie;});
  if(!timed.length){emptyCard('chartAnliegenHour','Keine zeitgestempelten Anliegen im Zeitraum.');return;}
  var top=topKatOf(timed,6).map(function(x){return x.label;});
  var mn=23,mx=0;timed.forEach(function(r){if(r.stunde<mn)mn=r.stunde;if(r.stunde>mx)mx=r.stunde;});
  var hours=[];for(var h=mn;h<=mx;h++)hours.push(h);
  var ri={};top.forEach(function(k,i){ri[k]=i;});var ci={};hours.forEach(function(h,i){ci[h]=i;});
  var grid=top.map(function(){return hours.map(function(){return 0;});});
  timed.forEach(function(r){var k=stripPfx(r.kategorie);if(ri[k]==null||ci[r.stunde]==null)return;grid[ri[k]][ci[r.stunde]]++;});
  matrixHeat('chartAnliegenHour',top,hours,grid,function(h){return h+'h';},anim);
}

/* Anliegen × Wochentag – welche Themen kommen an welchen Tagen gehäuft vor? */
function renderAnliegenWday(rows,anim){
  var box=document.getElementById('chartAnliegenWday');if(!box)return;
  var withK=rows.filter(function(r){return r.kategorie&&r.dow>=0&&r.dow<=4;});
  if(!withK.length){emptyCard('chartAnliegenWday','Keine Anliegen-Daten im Zeitraum.');return;}
  var top=topKatOf(withK,6).map(function(x){return x.label;});
  var days=[0,1,2,3,4],ri={};top.forEach(function(k,i){ri[k]=i;});
  var grid=top.map(function(){return days.map(function(){return 0;});});
  withK.forEach(function(r){var k=stripPfx(r.kategorie);if(ri[k]==null)return;grid[ri[k]][r.dow]++;});
  matrixHeat('chartAnliegenWday',top,days,grid,function(d){return WD[d];},anim);
}

/* Monatsphasen – Top-Anliegen je Anfang/Mitte/Ende (energieversorger-typische Häufungen). */
function renderMonthPhases(rows,anim){
  var box=document.getElementById('chartMonthPhases');if(!box)return;
  var withK=rows.filter(function(r){return r.kategorie;});
  if(!withK.length){emptyCard('chartMonthPhases','Keine Anliegen-Daten im Zeitraum.');return;}
  var phases=[{l:'Monatsanfang',sub:'1.–10.',rows:[]},{l:'Monatsmitte',sub:'11.–20.',rows:[]},{l:'Monatsende',sub:'21.–31.',rows:[]}];
  withK.forEach(function(r){var d=r.ymd%100,pi=d<=10?0:d<=20?1:2;phases[pi].rows.push(r);});
  box.innerHTML='<div class="mp-grid">'+phases.map(function(p){
    var tk=topKatOf(p.rows,3),tot=p.rows.length;
    var items=tk.length?tk.map(function(it){return '<div class="mp-item"><span class="mp-name">'+esc(it.label)+'</span><span class="mp-pct">'+it.pct+'%</span></div>';}).join(''):'<div class="mp-item mp-empty">–</div>';
    return '<div class="mp-col"><div class="mp-head"><b>'+p.l+'</b><span>'+p.sub+' · '+nf(tot)+'</span></div>'+items+'</div>';
  }).join('')+'</div>';
}

/* Pareto – wenige Anliegen verursachen den Großteil der Besuche (kumulierter Anteil). */
function renderPareto(rows,anim){
  var box=document.getElementById('chartPareto');if(!box)return;
  var items=topKatOf(rows,999),total=rows.filter(function(r){return r.kategorie;}).length;
  if(!total){emptyCard('chartPareto','Keine Anliegen-Daten im Zeitraum.');return;}
  var cum=0,data=items.map(function(it){cum+=it.v;return {label:it.label,v:it.v,cumPct:Math.round(cum/total*100)};});
  var n80=0;for(var i=0;i<data.length;i++){if(data[i].cumPct>=80){n80=i+1;break;}}if(!n80)n80=data.length;
  var top3=Math.round(items.slice(0,3).reduce(function(s,x){return s+x.v;},0)/total*100);
  var show=data.slice(0,10),max=show[0].v||1;
  var h='<div class="pareto-head">Top 3 Anliegen = <b>'+top3+'%</b> aller Besuche · 80% erreicht bei <b>'+n80+'</b> Anliegen</div>';
  h+=show.map(function(d,i){var col=PAL[i%PAL.length];
    return '<div class="hbar"><div class="row"><b>'+esc(d.label)+'</b><span>'+nf(d.v)+' · kum. '+d.cumPct+'%</span></div>'+
           '<div class="track"><i data-w="'+(d.v/max*100)+'" style="background:linear-gradient(90deg,'+col+',#ffffff22);'+(anim&&!RM?'':'width:'+(d.v/max*100)+'%')+'"></i></div></div>';}).join('');
  box.innerHTML=h;
  if(anim&&!RM)raf(function(){box.querySelectorAll('.track i').forEach(function(el){el.style.width=el.dataset.w+'%';});});
}

/* Ausreißer-Tage – Tage, die stark vom Ø des gleichen Wochentags abweichen. */
function renderOutliers(rows,info,anim){
  var box=document.getElementById('chartOutliers');if(!box)return;
  if(info.grain==='hour'){box.innerHTML='<p class="sub" style="padding:18px 0">Für Tagesfilter nicht sinnvoll – bitte Woche/Monat/Jahr/Zeitraum wählen.</p>';return;}
  var perDay={};rows.forEach(function(r){perDay[r.ymd]=(perDay[r.ymd]||0)+1;});
  var days=Object.keys(perDay).map(Number);
  if(days.length<5){box.innerHTML='<p class="sub" style="padding:18px 0">Zu wenige Tage für eine Ausreißer-Analyse.</p>';return;}
  var wsum=[0,0,0,0,0,0,0],wcnt=[0,0,0,0,0,0,0];
  days.forEach(function(ymd){var wd=(ymdToDate(ymd).getDay()+6)%7;wsum[wd]+=perDay[ymd];wcnt[wd]++;});
  var wmean=wsum.map(function(s,i){return wcnt[i]?s/wcnt[i]:0;});
  var flagged=days.map(function(ymd){var wd=(ymdToDate(ymd).getDay()+6)%7,mean=wmean[wd]||1,v=perDay[ymd],diff=mean>0?Math.round((v-mean)/mean*100):0;return {ymd:ymd,v:v,wd:wd,diff:diff,abs:Math.abs(diff)};})
    .filter(function(d){return d.abs>=25;}).sort(function(a,b){return b.abs-a.abs;}).slice(0,8);
  if(!flagged.length){box.innerHTML='<p class="sub" style="padding:18px 0">Keine auffälligen Tage – alles im üblichen Rahmen.</p>';return;}
  box.innerHTML='<div class="ol-list">'+flagged.map(function(d){var up=d.diff>0;
    return '<div class="ol-item"><span class="ol-date">'+ymdShort(d.ymd)+'</span><span class="ol-val">'+nf(d.v)+' Besuche</span>'+
      '<span class="k-delta '+(up?'up':'down')+'">'+(up?'▲ +':'▼ ')+d.diff+'%</span><span class="ol-ref">vs. Ø-'+WDF[d.wd]+'</span></div>';
  }).join('')+'</div>';
}

/* Datenqualität (nur Analyse-Tab) – Hinweis auf fehlende Standorte/Anliegen/Uhrzeiten. */
function renderDataQuality(rows,info){
  var box=document.getElementById('dqBox');if(!box)return;
  var total=rows.length;if(!total){box.innerHTML='<p class="sub">Keine Daten im Zeitraum.</p>';return;}
  var noStd=0,noKat=0,noHour=0;
  rows.forEach(function(r){if(!r.standort||r.standort==='(ohne Angabe)')noStd++;if(!r.kategorie)noKat++;if(!(r.stunde>0&&r.stunde<=23))noHour++;});
  function pct(x){return Math.round(x/total*100);}
  box.innerHTML='<div class="dq-row"><span>Besuche ohne Standort</span><b>'+nf(noStd)+' ('+pct(noStd)+'%)</b></div>'+
    '<div class="dq-row"><span>Besuche ohne Anliegen</span><b>'+nf(noKat)+' ('+pct(noKat)+'%)</b></div>'+
    '<div class="dq-row"><span>Besuche ohne Uhrzeit</span><b>'+nf(noHour)+' ('+pct(noHour)+'%)</b></div>';
}

/* Automatische Erkenntnisse (Übersicht) – 3–5 regelbasierte Sätze aus dem Zeitraum. */
function renderInsights(rows,info,anim){
  var box=document.getElementById('insightsBox');if(!box)return;
  if(!rows.length){box.innerHTML='<p class="sub" style="padding:8px 0">Für den gewählten Zeitraum liegen keine Besuche vor.</p>';return;}
  var out=[];
  // 1) Vergleich zur Vorperiode
  if(info.prevA!=null){var prev=countRange(info.prevA,info.prevB);if(prev>0){var d=Math.round((rows.length-prev)/prev*100);
    out.push('Der Zeitraum liegt <b>'+(d>0?'+':'')+d+'%</b> '+(d>=0?'über':'unter')+' dem vergleichbaren Vorzeitraum ('+nf(rows.length)+' vs. '+nf(prev)+').');}}
  // 2) Stärkste Abschlusszeit
  var ph=peakHourOf(rows);if(ph)out.push('Die stärkste Besuchszeit war <b>'+ph.h+':00–'+(ph.h+1)+':00 Uhr</b> ('+nf(ph.v)+' Abschlüsse).');
  // 3) Top-Anliegen
  var tk=topKatOf(rows,1);if(tk.length)out.push('<b>'+esc(tk[0].label)+'</b> macht <b>'+tk[0].pct+'%</b> aller Besuche aus.');
  // 4) Standortvergleich Ø/Öffnungstag
  var bd=Math.max(1,businessDays(info.a,info.b));
  var eC=cntStand('Euskirchen',info.a,info.b),kC=cntStand('Kall',info.a,info.b);
  if(eC>0&&kC>0){var eAvg=eC/bd,kAvg=kC/bd;var hi=eAvg>=kAvg?'Euskirchen':'Kall',lo=eAvg>=kAvg?'Kall':'Euskirchen';
    var ph2=Math.round(Math.abs(eAvg-kAvg)/Math.min(eAvg,kAvg)*100);
    if(ph2>=5)out.push('<b>'+hi+'</b> hatte '+ph2+'% mehr Besucher pro Öffnungstag als '+lo+'.');}
  // 5) Stärkster Wochentag (nicht bei Tagesfilter)
  if(info.grain!=='hour'){var wd=[0,0,0,0,0,0,0];rows.forEach(function(r){if(r.dow>=0&&r.dow<=4)wd[r.dow]++;});
    var mx=Math.max.apply(null,wd);if(mx>0)out.push('Stärkster Wochentag im Zeitraum: <b>'+WDF[wd.indexOf(mx)]+'</b>.');}
  out=out.slice(0,5);
  box.innerHTML='<div class="si-text-box">'+out.map(function(t,i){
    return '<div class="si-text-item"><div class="si-text-dot" style="background:'+PAL[i%PAL.length]+'"></div><p>'+t+'</p></div>';
  }).join('')+'</div>';
}

/* ---------- Tab switching ---------- */
function initDashTabs(){
  var tabs=document.getElementById('dashTabs');if(!tabs)return;
  tabs.addEventListener('click',function(e){
    var btn=e.target.closest('.dash-tab');if(!btn)return;
    document.querySelectorAll('.dash-tab').forEach(function(b){b.classList.remove('active');b.setAttribute('aria-selected','false');});
    document.querySelectorAll('.dash-tab-panel').forEach(function(p){p.classList.remove('active');});
    btn.classList.add('active');btn.setAttribute('aria-selected','true');
    document.getElementById('tab-'+btn.dataset.tab).classList.add('active');
    render(true);
  });
}

/* ---------- render (tab-bewusst: nur der aktive Tab wird gezeichnet → korrekte Chart-Breiten
   auf zuvor versteckten Panels + weniger Recompute) ---------- */
function activeTab(){var el=document.querySelector('.dash-tab.active');return el?el.dataset.tab:'uebersicht';}
function render(anim){
  var info=periodInfo(),rows=rowsIn(info.a,info.b),tab=activeTab();
  document.getElementById('rangeInfo').textContent=fmtDE(info.a)+' – '+fmtDE(info.b)+' · '+nf(rows.length)+' Besuche'+(state.standort!=='all'?' · '+state.standort:'');
  if(tab==='uebersicht'){
    renderKPIs(anim);renderForecast(anim);renderTrend(rows,info.a,info.b,anim);
    renderKat(rows,anim);renderWday(rows,anim);renderHour(rows,anim);renderKatDonut(rows,anim);renderThemeResults(anim);
    renderInsights(rows,info,anim);
  } else if(tab==='standorte'){
    renderLocKPIs(anim);renderStandortTab(rows,anim);
  } else {
    renderHeatmap(rows,anim);renderMonthlyComparison(anim);renderForecastAnalysis(anim);renderKatTrend(anim);
    renderAnliegenHour(rows,anim);renderAnliegenWday(rows,anim);renderMonthPhases(rows,anim);
    renderPareto(rows,anim);renderOutliers(rows,info,anim);renderDataQuality(rows,info);
  }
}

/* ---------- controls ---------- */
function initControls(){
  var stFreq={};V.forEach(function(r){if(r.standort&&r.standort!=='(ohne Angabe)')stFreq[r.standort]=(stFreq[r.standort]||0)+1;});
  var standorte=Object.keys(stFreq).sort(function(a,b){return stFreq[b]-stFreq[a];});
  var sel=document.getElementById('standortSel');
  sel.innerHTML='<option value="all">Alle Standorte</option>'+standorte.map(function(s){return '<option value="'+s+'">'+s+'</option>';}).join('');
  sel.value='all';
  sel.addEventListener('change',function(){state.standort=sel.value;render(true);});
  document.querySelectorAll('#periodSeg button').forEach(function(b){b.addEventListener('click',function(){
    document.querySelectorAll('#periodSeg button').forEach(function(x){x.classList.remove('active');});b.classList.add('active');
    state.period=b.dataset.p;document.getElementById('customRange').classList.toggle('show',state.period==='custom');render(true);});});
  var minISO=ymdToISO(minYmd),todayISO=ymdToISO(nowYmd);
  var fi=document.getElementById('fromDate'),ti=document.getElementById('toDate');
  fi.value=minISO;ti.value=todayISO;fi.min=ti.min=minISO;fi.max=ti.max=todayISO;
  function upd(){if(fi.value)state.from=parseISO(fi.value);if(ti.value)state.to=parseISO(ti.value);if(state.period==='custom')render(true);}
  fi.addEventListener('change',upd);ti.addEventListener('change',upd);
  document.addEventListener('mousemove',function(e){if(tip.style.opacity==1)moveTip(e);});
  document.querySelectorAll('.mod-item[data-view]').forEach(function(a){a.addEventListener('click',function(){
    document.querySelectorAll('.mod-item[data-view]').forEach(function(x){x.classList.remove('active');x.removeAttribute('aria-current');});
    a.classList.add('active');a.setAttribute('aria-current','page');
    var v=a.dataset.view;document.querySelectorAll('.view').forEach(function(s){s.classList.remove('active');});
    document.getElementById('view-'+v).classList.add('active');});});
  document.getElementById('footMeta').innerHTML=nf(V.length)+' Besuche<br>'+fmtDE(minYmd)+' – '+fmtDE(maxYmd);
}

/* ---------- Erfassen ---------- */
// Das Tracking je Standort/Kategorie zeigt ausschließlich die Besuche des HEUTIGEN Tages.
// Quelle ist V (live aus SQLite, inkl. Datei-Import) – nicht localStorage. Dadurch rollt es
// um 0 Uhr automatisch auf den neuen Tag um (frisches Datum bei jedem Aufruf) und enthält
// auch importierte Besuche, nicht nur die in der App angetippten.
function todayCounts(){
  var t=dateToYmd(new Date()),m={};
  for(var i=0;i<V.length;i++){var r=V[i];if(r.ymd!==t||!r.kategorie)continue;var k=r.standort+'|'+r.kategorie;m[k]=(m[k]||0)+1;}
  return m;
}
var redrawErfassGrid=null;   // von initErfassen gesetzt – erlaubt Grid-Refresh nach Live-Reload
var _erfassenSelfFired=false;
function initErfassen(){
  var locBox=document.getElementById('capLoc'),grid=document.getElementById('capGrid');
  var locFreq={};V.forEach(function(r){if(r.standort&&r.standort!=='(ohne Angabe)')locFreq[r.standort]=(locFreq[r.standort]||0)+1;});
  var locs=Object.keys(locFreq).sort(function(a,b){return locFreq[b]-locFreq[a];});
  if(!locs.length)locs=['Euskirchen','Kall'];
  var sel=locs[0];
  var LEGACY=['(ohne)','-','PV','sonstiges'];
  var katSet={};
  V.forEach(function(r){
    if(!r.kategorie)return;
    var disp=stripPfx(r.kategorie);
    if(LEGACY.indexOf(r.kategorie)!==-1||LEGACY.indexOf(disp)!==-1)return;
    katSet[r.kategorie]=true;
  });
  var allKats=Object.keys(katSet).sort(function(a,b){return stripPfx(a).localeCompare(stripPfx(b),'de');});

  function drawLoc(){
    locBox.innerHTML=locs.map(function(s){return '<button class="'+(s===sel?'active':'')+'" data-s="'+s+'">'+svg(ICON.pin)+s+'</button>';}).join('');
    locBox.querySelectorAll('button').forEach(function(b){b.onclick=function(){sel=b.dataset.s;drawLoc();drawGrid();};});
  }
  function drawGrid(){
    var tc=todayCounts();
    grid.innerHTML=allKats.map(function(kat){
      var locsHtml=locs.map(function(s){var c=tc[s+'|'+kat]||0;return '<span class="cn-loc'+(c>0?' has-c':'')+'"><span class="cn-nm">'+s+'</span><b>'+c+'</b></span>';}).join('');
      return '<button class="cat" data-k="'+encodeURIComponent(kat)+'"><span class="pop"></span><span class="ct">'+stripPfx(kat)+'</span><div class="cn-split">'+locsHtml+'</div></button>';
    }).join('');
    grid.querySelectorAll('.cat').forEach(function(b){
      b.onclick=function(){
        var kat=decodeURIComponent(b.dataset.k);
        var now=new Date();
        var entry={ymd:dateToYmd(now),standort:sel,kategorie:kat,stunde:now.getHours(),dow:(now.getDay()+6)%7};
        V.push(entry);bumpData();   // optimistisch – Live-Reload (POST→Event) gleicht V danach mit der DB ab
        if(window.erfassBesuch){_erfassenSelfFired=true;window.erfassBesuch(sel,kat).catch(function(){});}
        render(false);
        b.classList.add('bump');
        toast('✓ '+stripPfx(kat)+' · '+sel+' erfasst');
        var tc2=todayCounts(),cnLocs=b.querySelectorAll('.cn-loc');
        locs.forEach(function(s,li){
          var c=tc2[s+'|'+kat]||0,row=cnLocs[li];if(!row)return;
          var bEl=row.querySelector('b');
          bEl.textContent=c;row.classList.toggle('has-c',c>0);
          if(s===sel){bEl.classList.remove('num-pop');void bEl.offsetWidth;bEl.classList.add('num-pop');}
        });
        setTimeout(function(){b.classList.remove('bump');},600);
      };
    });
  }
  drawLoc();drawGrid();
  redrawErfassGrid=drawGrid;   // Live-Refresh (refreshToday) zeichnet das Grid aus frischem V neu
}

var toastT;function toast(m){var t=document.getElementById('toast');t.textContent=m;t.classList.add('show');clearTimeout(toastT);toastT=setTimeout(function(){t.classList.remove('show');},1800);}

/* ---------- bootstrap: Daten aus SQLite laden ---------- */
function parseApiRow(r){
  var ymd=parseInt(r.datum,10)|0;
  return {ymd:ymd,standort:r.standort||'(ohne Angabe)',kategorie:r.kategorie||'',stunde:r.stunde!=null?+r.stunde:-1,dow:(ymdToDate(ymd).getDay()+6)%7};
}

var kpisBox=document.getElementById('kpis');
kpisBox.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:32px 0;opacity:.5;font-size:15px">Lade Besuchsdaten …</div>';

var API_BESUCHER=(location.hostname === '127.0.0.1' ? 'http://127.0.0.1:3001' : '') + '/api/besucher';
var _booted=false;

function _applyMaxima(){
  if(V.length){V.sort(function(a,b){return a.ymd-b.ymd;});minYmd=V[0].ymd;dataMaxYmd=V[V.length-1].ymd;maxYmd=Math.max(dataMaxYmd,nowYmd);}
}

// Erst-Last: komplette Historie. Der Endpunkt ist am Vercel-Edge gecacht, daher kommen
// Folgeaufrufe (Reload/andere Nutzer) blitzschnell aus dem CDN statt aus Funktion+Turso.
// Initialisiert zusätzlich die UI.
function bootLoad(){
  return fetch(API_BESUCHER, { cache:'default' })
    .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
    .then(function(rows){
      nowYmd=dateToYmd(new Date());nowDate=ymdToDate(nowYmd);
      V.length=0;rows.forEach(function(r){if(isTestStandort(r.standort))return;V.push(parseApiRow(r));});
      _applyMaxima();
      bumpData();
      _booted=true;
      initControls();
      initDashTabs();
      initThemeExplorer();
      render(true);
      initErfassen();
      var rz;window.addEventListener('resize',function(){clearTimeout(rz);rz=setTimeout(function(){render(false);},160);});
      var vparam=new URLSearchParams(location.search).get('view');
      if(vparam){var vnavEl=document.querySelector('.mod-item[data-view="'+vparam+'"]');if(vnavEl)vnavEl.click();}
      refreshToday(); // heutige Zeilen sofort frisch nachladen (korrigiert evtl. gecachten Verlauf)
    });
}

// Live-Refresh: lädt NUR die Besuche ab heute (winziger, ungecachter Request) und ersetzt den
// Heute-Teil von V. Dadurch bleibt das Dashboard live, ohne die ~4,7-MB-Historie neu zu ziehen.
// „Heute" wird dabei frisch bestimmt → KPIs + Tracking rollen um 0 Uhr automatisch um.
var _refreshing=false;
function refreshToday(){
  if(!_booted||_refreshing)return Promise.resolve();
  _refreshing=true;
  nowYmd=dateToYmd(new Date());nowDate=ymdToDate(nowYmd);
  return fetch(API_BESUCHER+'?von='+nowYmd, { cache:'no-store' })
    .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
    .then(function(rows){
      for(var i=V.length-1;i>=0;i--){if(V[i].ymd>=nowYmd)V.splice(i,1);} // alten Heute-Teil entfernen
      rows.forEach(function(r){if(isTestStandort(r.standort))return;V.push(parseApiRow(r));});  // frischen Heute-Teil anhängen (bleibt sortiert)
      dataMaxYmd=V.length?V[V.length-1].ymd:nowYmd;maxYmd=Math.max(dataMaxYmd,nowYmd);
      bumpData();
      render(false);
      if(redrawErfassGrid)redrawErfassGrid();
    })
    ['catch'](function(){})
    ['finally'](function(){_refreshing=false;});
}

bootLoad().catch(function(err){
  kpisBox.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:32px 0;color:#c0492a">'+
    'Fehler beim Laden ('+err.message+'). Ist der API-Server (Port 3001) gestartet?</div>';
});

// Neu erfasste Besuche zeitnah ins Dashboard holen – ohne manuelles Neuladen. Es wird nur der
// heutige Tag nachgeladen (günstig), daher unproblematisch häufig:
//  • wenn der Tab wieder sichtbar/fokussiert wird (z.B. Rückkehr vom Produkt-ID Tool)
//  • per Event direkt nach einer Schnellerfassung (erfass-bar.js)
//  • als Fallback alle 20s, solange das Dashboard sichtbar ist
function refreshVisits(){ if(_booted && document.visibilityState==='visible') refreshToday(); }
document.addEventListener('visibilitychange', refreshVisits);
window.addEventListener('focus', refreshVisits);
window.addEventListener('eregio:besuch-erfasst', function(){ refreshToday(); });
setInterval(refreshVisits, 20000);

/* ══════════════════════════════════════════════════════
   MARKTLAGE – Mitbewerber-Preise (Heizstrom + SteuVE Variants)
   ══════════════════════════════════════════════════════ */
(function(){
  // Mitbewerber-Preis-Ansicht verworfen (Schnittstelle zu teuer) → ersetzt durch die NB/GV-Suche (IIFE unten).
  return;
  var API_ML=(location.hostname==='127.0.0.1'?'http://127.0.0.1:3001':'')+'/api/mitbewerber';
  var mlLoaded=false, mlCache={}, mlCurrentAnbieter=[], plzOrtCache={};
  // zaehlerart: gemeinsam für WP und NS. nsMessung nur bei heizstromTyp='ns'.
  var mlState={ sparte: 'strom', heizstromTyp: 'wp', zaehlerart: 'einzeltarif', nsMessung: 'getrennt', steuveMod: 'modul1' };

  function fmtAP(v){ return v!=null ? (v*100).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})+' ct/kWh' : '–'; }
  function fmtGP(v){ return v!=null ? v.toFixed(2)+' €/Jahr' : '–'; }
  function fmtBonus(v){ return (v&&v>0) ? v.toFixed(0)+' €' : '–'; }

  function srcBadge(q){
    var cls=q==='check24'?'ml-src-badge--check24':q==='verivox'?'ml-src-badge--verivox':'ml-src-badge--test';
    return '<span class="ml-src-badge '+cls+'">'+q+'</span>';
  }

  function providerColor(name){
    var colors=['#004442','#3a7ca5','#c97b3f','#6b8f8a','#1f9bb0','#1d9e75','#8a6a00'];
    var h=0; for(var i=0;i<name.length;i++) h=(h*31+name.charCodeAt(i))%colors.length;
    return colors[Math.abs(h)];
  }
  function providerAvatar(name){
    var parts=name.trim().split(/\s+/);
    var ini=(parts[0][0]+(parts[1]?parts[1][0]:parts[0][1]||'')).toUpperCase();
    var c=providerColor(name);
    return '<span class="ml-avatar" style="background:'+c+'">'+ini+'</span>';
  }

  function renderKpis(stats, anbieterCount){
    var box=document.getElementById('marktlage-kpis');
    if(!box) return;
    var g=stats.guentigster, t=stats.teuerster;
    var count=anbieterCount!=null?anbieterCount:(stats.anzahl_anbieter||0);
    box.innerHTML=[
      '<div class="kpi-card card reveal ml-kpi ml-kpi--best"><div class="kpi-lbl">Günstigster</div><div class="kpi-val">'+(g?g.anbieter:'–')+'</div><div class="kpi-sub">'+(g?fmtAP(g.arbeitspreis):'–')+'</div>'+(g&&g.grundpreis?'<div class="kpi-sub2">GP '+fmtGP(g.grundpreis)+'</div>':'')+'</div>',
      '<div class="kpi-card card reveal ml-kpi"><div class="kpi-lbl">Teuerster</div><div class="kpi-val">'+(t?t.anbieter:'–')+'</div><div class="kpi-sub">'+(t?fmtAP(t.arbeitspreis):'–')+'</div>'+(t&&t.grundpreis?'<div class="kpi-sub2">GP '+fmtGP(t.grundpreis)+'</div>':'')+'</div>',
      '<div class="kpi-card card reveal ml-kpi"><div class="kpi-lbl">Ø Arbeitspreis</div><div class="kpi-val kpi-val--mono">'+(stats.avg_arbeitspreis?fmtAP(stats.avg_arbeitspreis):'–')+'</div><div class="kpi-sub">Marktdurchschnitt</div>'+(stats.avg_grundpreis?'<div class="kpi-sub2">Ø GP '+fmtGP(stats.avg_grundpreis)+'</div>':'')+'</div>',
      '<div class="kpi-card card reveal ml-kpi"><div class="kpi-lbl">Anbieter im Markt</div><div class="kpi-val">'+count+'</div><div class="kpi-sub">Tarife verglichen</div></div>'
    ].join('');
  }

  function renderTable(anbieter, showBonus, searchTerm){
    var box=document.getElementById('marktlage-table-body');
    if(!box) return;
    var filtered=anbieter;
    if(searchTerm){
      var term=searchTerm.toLowerCase();
      filtered=anbieter.filter(function(a){ return a.anbieter.toLowerCase().includes(term)||(a.bonus_bedingung&&a.bonus_bedingung.toLowerCase().includes(term)); });
    }
    if(!filtered||!filtered.length){ box.innerHTML='<p style="text-align:center;padding:24px;opacity:.5">'+(searchTerm?'Keine Anbieter gefunden':'Keine Daten.')+'</p>'; return; }
    var cols=['<th>Anbieter</th><th>Arbeitspreis</th><th>Grundpreis</th>'];
    if(showBonus) cols.push('<th>Bonus</th><th>Bedingung</th>');
    cols.push('<th>Quelle</th>');
    var rows=filtered.map(function(a){
      var icon=a.logo_url?'<img src="'+a.logo_url+'" class="ml-provider-logo" alt="" onerror="this.style.display=\'none\'">':providerAvatar(a.anbieter);
      var tr='<td class="ml-anbieter-cell">'+icon+a.anbieter+'</td><td class="ml-price">'+fmtAP(a.arbeitspreis)+'</td><td>'+fmtGP(a.grundpreis)+'</td>';
      if(showBonus) tr+='<td>'+(a.bonus&&a.bonus>0?'<span class="ml-bonus-badge">'+fmtBonus(a.bonus)+'</span>':'–')+'</td><td class="ml-cond">'+(a.bonus_bedingung||'–')+'</td>';
      tr+='<td>'+srcBadge(a.quelle)+'</td>';
      return '<tr>'+tr+'</tr>';
    });
    box.innerHTML='<table class="ml-table"><thead><tr>'+cols.join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table>';
  }

  function getCacheKey(sparte, heizstromTyp, zaehlerart, nsMessung, steuveMod){
    var plzEl=document.getElementById('marktlagePlzInput');
    var plz=(plzEl&&plzEl.value.trim())||'';
    var key=sparte+'|'+(plz?plz.substring(0,3):'*');
    if(sparte==='heizstrom' && heizstromTyp){
      key+='|'+heizstromTyp;
      if(zaehlerart) key+='|'+zaehlerart;
      if(heizstromTyp==='ns' && nsMessung) key+='|'+nsMessung;
    } else if(sparte==='steuve' && steuveMod) key+='|'+steuveMod;
    return key;
  }

  function buildApiUrl(sparte, plz, heizstromTyp, zaehlerart, nsMessung, steuveMod){
    var url=API_ML+'/marktlage?sparte='+sparte+'&plz='+(plz||'10000');
    if(sparte==='heizstrom' && heizstromTyp){
      url+='&heizstrom_typ='+heizstromTyp;
      if(zaehlerart) url+='&zaehlerart='+zaehlerart;
      if(heizstromTyp==='ns' && nsMessung) url+='&ns_messung='+nsMessung;
    } else if(sparte==='steuve' && steuveMod) url+='&steuve_modul='+steuveMod;
    return url;
  }

  function loadMarktlage(){
    var sparte=mlState.sparte, heizstromTyp=mlState.heizstromTyp, zaehlerart=mlState.zaehlerart, nsMessung=mlState.nsMessung, steuveMod=mlState.steuveMod;
    var cacheKey=getCacheKey(sparte, heizstromTyp, zaehlerart, nsMessung, steuveMod);
    var showBonus=document.getElementById('marktlageBonusCheck').checked;
    var kpisBox=document.getElementById('marktlage-kpis');
    var infoEl=document.getElementById('marktlage-update-info');
    var plzEl=document.getElementById('marktlagePlzInput');
    var plz=(plzEl&&plzEl.value.trim())||'';

    if(mlCache[cacheKey]){
      mlCurrentAnbieter=mlCache[cacheKey].anbieter;
      renderKpis(mlCache[cacheKey].stats, mlCurrentAnbieter.length);
      renderTable(mlCurrentAnbieter, showBonus, '');
      if(infoEl) infoEl.innerHTML='<span class="ml-update-chip">↻ '+mlCache[cacheKey].ts+'</span>';
      return;
    }

    if(kpisBox) kpisBox.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:20px;opacity:.5">Lade Marktdaten …</div>';

    // Statistik auch mit Varianten filtern (für korrekte "Anbieter im Markt" Zahl)
    var statsUrl=API_ML+'/statistik?sparte='+sparte;
    if(sparte==='heizstrom' && heizstromTyp){
      statsUrl+='&heizstrom_typ='+heizstromTyp;
      if(zaehlerart) statsUrl+='&zaehlerart='+zaehlerart;
      if(heizstromTyp==='ns' && nsMessung) statsUrl+='&ns_messung='+nsMessung;
    } else if(sparte==='steuve' && steuveMod) statsUrl+='&steuve_modul='+steuveMod;

    var urls=[statsUrl, buildApiUrl(sparte, plz, heizstromTyp, zaehlerart, nsMessung, steuveMod)];
    // SteuVE: beide Module parallel vorladen für schnellen Modul-Wechsel
    if(sparte==='steuve'){
      var otherMod=steuveMod==='modul1'?'modul2':'modul1';
      var modul2Url=buildApiUrl(sparte, plz, heizstromTyp, zaehlerart, nsMessung, otherMod);
      urls.push(fetch(modul2Url).then(function(r){return r.json();}));
    }

    Promise.all(urls.map(function(u){return typeof u==='string'?fetch(u).then(function(r){return r.json();}):u;})).then(function(res){
      var stats=res[0], ml=res[1];
      var ts=ml.aktualisiert_am?new Date(ml.aktualisiert_am).toLocaleString('de-DE'):'unbekannt';

      mlCurrentAnbieter=ml.anbieter||[];
      mlCache[cacheKey]={stats:stats, anbieter:mlCurrentAnbieter, ts:ts};

      // SteuVE anderen Modul auch cachen
      if(sparte==='steuve' && res[2]){
        var otherKey=getCacheKey(sparte, null, null, null, otherMod);
        mlCache[otherKey]={stats:res[2].stats||stats, anbieter:res[2].anbieter||[], ts:ts};
      }

      renderKpis(stats, mlCurrentAnbieter.length);
      renderTable(mlCurrentAnbieter, showBonus, '');
      if(infoEl) infoEl.innerHTML='<span class="ml-update-chip">↻ '+ts+(plz?' · PLZ '+plz:'')+'</span>';
      mlLoaded=true;
    })['catch'](function(err){
      if(kpisBox) kpisBox.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:20px;color:#c55">Fehler: '+err.message+'</div>';
    });
  }

  // View activation
  document.querySelectorAll('.mod-item[data-view]').forEach(function(a){
    if(a.dataset.view==='marktlage'){
      a.addEventListener('click', function(){
        loadMarktlage();
        updateControlsVisibility();
      });
    }
  });

  // DOM-Refs
  var sparteSel=document.getElementById('marktlageSparteSel');
  var heizstromTypSel=document.getElementById('marktlageHeizstromTyp');
  var heizstromTypGroup=document.getElementById('heizstromTypGroup');
  var wpZaehlerartGroup=document.getElementById('wpZaehlerartGroup');
  var nsZaehlerartGroup=document.getElementById('nsZaehlerartGroup');
  var nsMessungGroup=document.getElementById('nsMessungGroup');
  var steuvModulGroup=document.getElementById('steuvModulGroup');

  function syncZaehlerartButtons(){
    // Beide Zählerart-Gruppen auf aktuellen State synchronisieren
    document.querySelectorAll('[data-zaehlerart]').forEach(function(b){
      b.classList.toggle('ml-toggle-btn--active', b.getAttribute('data-zaehlerart')===mlState.zaehlerart);
    });
  }

  function updateControlsVisibility(){
    var sparte=sparteSel.value;
    var isWP=sparte==='heizstrom'&&mlState.heizstromTyp==='wp';
    var isNS=sparte==='heizstrom'&&mlState.heizstromTyp==='ns';
    heizstromTypGroup.style.display=(sparte==='heizstrom'?'flex':'none');
    wpZaehlerartGroup.style.display=(isWP?'flex':'none');
    nsZaehlerartGroup.style.display=(isNS?'flex':'none');
    nsMessungGroup.style.display=(isNS?'flex':'none');
    steuvModulGroup.style.display=(sparte==='steuve'?'flex':'none');
  }

  if(sparteSel) sparteSel.addEventListener('change', function(){
    mlState.sparte=sparteSel.value;
    updateControlsVisibility();
    mlLoaded=false;
    loadMarktlage();
  });

  if(heizstromTypSel) heizstromTypSel.addEventListener('change', function(){
    mlState.heizstromTyp=heizstromTypSel.value;
    updateControlsVisibility();
    mlLoaded=false;
    loadMarktlage();
  });

  // Zählerart-Toggle (WP und NS teilen dieselbe mlState.zaehlerart)
  document.querySelectorAll('[data-zaehlerart]').forEach(function(btn){
    btn.addEventListener('click', function(){
      mlState.zaehlerart=this.getAttribute('data-zaehlerart');
      syncZaehlerartButtons();
      mlLoaded=false;
      loadMarktlage();
    });
  });

  // NS Messung-Toggle
  document.querySelectorAll('[data-ns-messung]').forEach(function(btn){
    btn.addEventListener('click', function(){
      document.querySelectorAll('[data-ns-messung]').forEach(function(b){ b.classList.remove('ml-toggle-btn--active'); });
      this.classList.add('ml-toggle-btn--active');
      mlState.nsMessung=this.getAttribute('data-ns-messung');
      mlLoaded=false;
      loadMarktlage();
    });
  });

  // SteuVE Modul-Toggle
  document.querySelectorAll('[data-modul]').forEach(function(btn){
    btn.addEventListener('click', function(){
      document.querySelectorAll('[data-modul]').forEach(function(b){ b.classList.remove('ml-toggle-btn--active'); });
      this.classList.add('ml-toggle-btn--active');
      mlState.steuveMod=this.dataset.modul;
      mlLoaded=false;
      loadMarktlage();
    });
  });

  // Bonus toggle
  var bonusCheck=document.getElementById('marktlageBonusCheck');
  if(bonusCheck) bonusCheck.addEventListener('change', function(){
    var suchInput=document.getElementById('marktlageSuchInput');
    renderTable(mlCurrentAnbieter, bonusCheck.checked, suchInput?suchInput.value:'');
  });

  // PLZ → Stadt Lookup
  function lookupPlzOrt(plz){
    var ortEl=document.getElementById('marktlagePlzOrt');
    if(!ortEl) return;
    if(plzOrtCache[plz]!==undefined){ ortEl.textContent=plzOrtCache[plz]; return; }
    var baseUrl=API_ML.replace('/api/mitbewerber','');
    fetch(baseUrl+'/api/plzpreise?plz='+plz)
      .then(function(r){ return r.json(); })
      .then(function(d){ var ort=(d.ok&&d.ort)?d.ort:''; plzOrtCache[plz]=ort; ortEl.textContent=ort; })
      .catch(function(){ plzOrtCache[plz]=''; ortEl.textContent=''; });
  }

  // PLZ input
  var plzInput=document.getElementById('marktlagePlzInput');
  var plzOrtEl=document.getElementById('marktlagePlzOrt');
  var plzOrtTimeout;
  if(plzInput){
    plzInput.addEventListener('input', function(){
      var val=this.value.trim();
      clearTimeout(plzOrtTimeout);
      if(plzOrtEl && val.length<5) plzOrtEl.textContent='';
      if(val.length===5) plzOrtTimeout=setTimeout(function(){ lookupPlzOrt(val); }, 300);
    });
    plzInput.addEventListener('change', function(){
      var val=this.value.trim();
      if(val.length===5) lookupPlzOrt(val);
      mlLoaded=false; loadMarktlage();
    });
    plzInput.addEventListener('keydown', function(e){ if(e.key==='Enter'){ mlLoaded=false; loadMarktlage(); } });
  }

  // Search input
  var suchInput=document.getElementById('marktlageSuchInput');
  var suchTimeout;
  if(suchInput){
    suchInput.addEventListener('input', function(){
      clearTimeout(suchTimeout);
      suchTimeout=setTimeout(function(){
        renderTable(mlCurrentAnbieter, bonusCheck.checked, suchInput.value);
      }, 300);
    });
  }

  // Refresh button
  var refreshBtn=document.getElementById('marktlageRefreshBtn');
  if(refreshBtn) refreshBtn.addEventListener('click', function(){
    var cacheKey=getCacheKey(mlState.sparte, mlState.heizstromTyp, mlState.zaehlerart, mlState.nsMessung, mlState.steuveMod);
    delete mlCache[cacheKey];
    mlLoaded=false;
    loadMarktlage();
  });

  updateControlsVisibility();
}());

})();

/* ══════════════════════════════════════════════════════
   NB & GV-SUCHE (bundesweit) – Netzbetreiber & Grundversorger je PLZ/Ort
   ══════════════════════════════════════════════════════ */
(function(){
  var API=(location.hostname==='127.0.0.1'||location.hostname==='localhost'?'http://'+location.hostname+':3001':'')+'/api/enet';
  var input=document.getElementById('enetSearchInput');
  var btn=document.getElementById('enetSearchBtn');
  var box=document.getElementById('enetResults');
  if(!input||!btn||!box) return;

  var IC_TEL='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
  var IC_WEB='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
  var IC_MAIL='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg>';

  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function op(o){
    if(!o||!o.name) return '<span style="color:#9bb0ab">–</span>';
    var m='';
    if(o.tel) m+='<a href="tel:'+esc(o.tel.replace(/\s/g,''))+'">'+IC_TEL+esc(o.tel)+'</a>';
    if(o.url) m+='<a href="'+esc(o.url)+'" target="_blank" rel="noopener noreferrer">'+IC_WEB+'Website</a>';
    if(o.email) m+='<a href="mailto:'+esc(o.email)+'">'+IC_MAIL+esc(o.email)+'</a>';
    return '<span class="nm">'+esc(o.name)+'</span>'+(m?'<span class="enet-meta">'+m+'</span>':'');
  }
  function grp(label,r){ if(!r) return '';
    return '<div class="enet-grp"><div class="enet-sp">'+label+'</div>'+
      '<div class="enet-line"><span class="role">Netzbetreiber</span>'+op(r.nb)+'</div>'+
      '<div class="enet-line"><span class="role">Grundversorger</span>'+op(r.gv)+'</div></div>';
  }
  function run(){
    var q=(input.value||'').trim();
    if(q.length<2){ box.innerHTML='<div class="enet-hint">Bitte mindestens 2 Zeichen eingeben.</div>'; return; }
    box.innerHTML='<div class="enet-hint">Suche …</div>';
    fetch(API+'/search?q='+encodeURIComponent(q)).then(function(r){return r.json();}).then(function(j){
      if(!j.treffer||!j.treffer.length){ box.innerHTML='<div class="enet-hint">Keine Treffer.</div>'; return; }
      box.innerHTML=j.treffer.map(function(t){
        return '<div class="enet-card"><h4>'+esc(t.plz)+' · '+esc(t.ort||'')+'</h4>'+grp('Strom',t.strom)+grp('Gas',t.gas)+'</div>';
      }).join('');
    }).catch(function(){ box.innerHTML='<div class="enet-hint">Fehler bei der Suche.</div>'; });
  }
  btn.addEventListener('click',run);
  input.addEventListener('keydown',function(e){ if(e.key==='Enter') run(); });
})();

/* ══════════════════════════════════════════════════════
   PDF-EXPORT – aktuelle Dashboard-Ansicht (inkl. Filter + Tab) drucken/als PDF
   Nutzt window.print() + das @media-print-Layout (vektor-scharfe SVG-Charts,
   automatische Seitenumbrüche). Der Dokumentkopf wird aus dem aktuellen
   Filter-/Tab-Zustand des DOM befüllt – keine Abhängigkeit von internem State.
   ══════════════════════════════════════════════════════ */
(function(){
  var btn=document.getElementById('pdfExportBtn');
  if(!btn)return;

  function esc(s){var d=document.createElement('div');d.textContent=(s==null?'':s);return d.innerHTML;}
  function clean(el){return el?el.textContent.replace(/\s+/g,' ').trim():'';}
  function slug(s){return (s||'').replace(/[^\wÀ-ɏ]+/g,'-').replace(/^-+|-+$/g,'')||'alle';}

  function fillHead(){
    var stSel=document.getElementById('standortSel');
    var standort=(stSel&&stSel.selectedOptions&&stSel.selectedOptions[0])
      ? stSel.selectedOptions[0].textContent.trim() : 'Alle Standorte';
    // Zeitraum ausgeschrieben (CD) statt nur „Woche"/„Monat"
    var PMAP={heute:'Heute',gestern:'Gestern',woche:'Diese Woche',month:'Dieser Monat',ytd:'Dieses Jahr',custom:'Zeitraum',all:'Gesamter Zeitraum'};
    var pbtn=document.querySelector('#periodSeg button.active');
    var pkey=pbtn?(pbtn.getAttribute('data-p')||''):'';
    var period=PMAP[pkey]||clean(pbtn)||'–';
    // rangeInfo enthält „<von> – <bis> · N Besuche [· Standort]" → nur das Datumsfenster behalten
    var range=clean(document.getElementById('rangeInfo')).split(' · ')[0];
    var tab=clean(document.querySelector('.dash-tab.active'));

    // „Übersicht · Diese Woche" – aktiver Tab + ausgeschriebener Zeitraum
    var scope=document.getElementById('printScope');
    if(scope){ scope.textContent=tab+' · '+period; }

    var pf=document.getElementById('printFilters');
    if(pf){
      pf.innerHTML='<b>Standort:</b> '+esc(standort)+
        ((range&&range!=='–')?' &nbsp;·&nbsp; <b>Zeitraum:</b> '+esc(range):'');
    }
    var stamp=document.getElementById('printStamp');
    if(stamp){
      var d=new Date();
      stamp.innerHTML='Erstellt am<br>'+
        d.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'})+' · '+
        d.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})+' Uhr';
    }
    return {standort:standort,period:period,tab:tab};
  }

  var prevTitle=null;
  btn.addEventListener('click',function(){
    var info=fillHead();
    // Dateiname-Vorschlag des Browsers = document.title
    prevTitle=document.title;
    document.title='Besucher-Dashboard_'+slug(info.tab)+'_'+slug(info.period)+'_'+slug(info.standort)+
      '_'+new Date().toISOString().slice(0,10);
    window.print();
  });
  window.addEventListener('afterprint',function(){
    if(prevTitle!=null){document.title=prevTitle;prevTitle=null;}
  });
})();
