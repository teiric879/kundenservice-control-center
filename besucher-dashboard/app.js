/* e-regio Kundencenter Analytics – Dashboard live aus SQLite */
(function(){
"use strict";
var V=[];   /* [{ymd,standort,kategorie,stunde,dow}, …] – geladen via GET /api/besucher */
var ACC='#bf9200';
var PAL=['#bf9200','#E9C682','#8c6b00','#39A0D6','#7A8BF0','#F08AB0','#5FD6A0','#B69CF5','#56C8E8','#E8A06A','#e0ad1f','#22C3B6'];
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
function stripPfx(s){return String(s||'').replace(/^\d+\s+/,'');}
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
  if(state.period==='custom')return [state.from||minYmd,state.to||maxYmd];
  return [minYmd,maxYmd];
}

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
  var da=ymdToDate(a),db=ymdToDate(b),spanDays=Math.round((db-da)/864e5);
  var mode=spanDays<=62?'day':(spanDays<=1100?'month':'year'),buckets=[],idx={};
  function keyOf(ymd){var Y=Math.floor(ymd/10000),m=Math.floor(ymd/100)%100;return mode==='day'?ymd:mode==='month'?Y*100+m:Y;}
  if(mode==='day'){for(var t=new Date(da);t<=db;t=addDays(t,1)){var k=dateToYmd(t);idx[k]=buckets.length;buckets.push({label:fmtDE(k).slice(0,5),v:0});}}
  else if(mode==='month'){for(var t2=new Date(da.getFullYear(),da.getMonth(),1);t2<=db;t2=addMonths(t2,1)){var k2=t2.getFullYear()*100+(t2.getMonth()+1);idx[k2]=buckets.length;buckets.push({label:MON[t2.getMonth()]+' '+(''+t2.getFullYear()).slice(2),v:0});}}
  else{for(var y=da.getFullYear();y<=db.getFullYear();y++){idx[y]=buckets.length;buckets.push({label:''+y,v:0});}}
  for(var i=0;i<rows.length;i++){var j=idx[keyOf(rows[i].ymd)];if(j!=null)buckets[j].v++;}
  document.getElementById('trendSub').textContent=(mode==='day'?'täglich':mode==='month'?'monatlich':'jährlich')+' · '+nf(rows.length)+' Besuche';
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
    if(i%lblEvery===0||i===n-1)s+='<text class="axis" x="'+x+'" y="'+(H-9)+'" text-anchor="middle">'+d.label+'</text>';});
  s+='</svg>';box.innerHTML=s;
  var lp=box.querySelector('.t-line'),ar=box.querySelector('.t-area');
  if(anim&&!RM&&lp){var len=lp.getTotalLength();lp.style.strokeDasharray=len;lp.style.strokeDashoffset=len;
    raf(function(){lp.style.transition='stroke-dashoffset .5s cubic-bezier(.22,.61,.36,1)';lp.style.strokeDashoffset=0;ar.style.transition='opacity .35s ease .1s';ar.style.opacity=1;});}
  else{ar.style.opacity=1;}
  box.querySelectorAll('rect[data-i]').forEach(function(rc){rc.addEventListener('mousemove',function(e){var d=buckets[+rc.dataset.i];showTip(e,d.label+': <b>'+nf(d.v)+'</b>');});rc.addEventListener('mouseleave',hideTip);});
}

/* ---------- donut ---------- */
function renderDonut(rows,anim){
  var counts={};rows.forEach(function(r){var s=r.standort||'?';counts[s]=(counts[s]||0)+1;});
  var items=Object.keys(counts).map(function(s){return {label:s,v:counts[s]};}).sort(function(a,b){return b.v-a.v;});
  var total=items.reduce(function(s,x){return s+x.v;},0)||1,r=72,C=2*Math.PI*r,off=0;
  var s='<svg viewBox="0 0 184 192" width="100%" style="height:196px"><g transform="rotate(-90 92 96)">';
  s+='<circle cx="92" cy="96" r="'+r+'" fill="none" stroke="rgba(255,255,255,.05)" stroke-width="22"/>';
  items.forEach(function(it,i){var len=C*it.v/total,col=PAL[i%PAL.length];
    s+='<circle class="d-seg" cx="92" cy="96" r="'+r+'" fill="none" stroke="'+col+'" stroke-width="22" stroke-linecap="butt" stroke-dasharray="'+(anim&&!RM?0:len)+' '+(anim&&!RM?C:C-len)+'" data-len="'+len+'" data-c="'+C+'" stroke-dashoffset="'+(-off)+'" data-i="'+i+'"/>';
    off+=len;});
  s+='</g><text x="92" y="90" text-anchor="middle" font-family="Space Grotesk" font-size="27" font-weight="600" fill="#EAF6F2">'+nf(total)+'</text>';
  s+='<text x="92" y="110" text-anchor="middle" font-size="12" fill="#93B2AB">Besuche</text></svg>';
  var box=document.getElementById('chartStandort');box.innerHTML=s;
  if(anim&&!RM){raf(function(){box.querySelectorAll('.d-seg').forEach(function(c,i){c.style.transition='stroke-dasharray .45s cubic-bezier(.22,.61,.36,1) '+(i*.04)+'s';c.style.strokeDasharray=c.dataset.len+' '+(c.dataset.c-c.dataset.len);});});}
  var leg='';items.forEach(function(it,i){leg+='<span><i style="background:'+PAL[i%PAL.length]+'"></i>'+it.label+' · '+Math.round(it.v/total*100)+'% ('+nf(it.v)+')</span>';});
  document.getElementById('legendStandort').innerHTML=leg;
  box.querySelectorAll('.d-seg').forEach(function(c){c.addEventListener('mousemove',function(e){var it=items[+c.dataset.i];showTip(e,it.label+': <b>'+nf(it.v)+'</b> ('+Math.round(it.v/total*100)+'%)');});c.addEventListener('mouseleave',hideTip);});
}

/* ---------- top categories (hbars) ---------- */
function renderKat(rows,anim){
  var counts={};rows.forEach(function(r){if(!r.kategorie)return;counts[r.kategorie]=(counts[r.kategorie]||0)+1;});
  var items=Object.keys(counts).map(function(k){return {label:stripPfx(k),v:counts[k]};}).sort(function(a,b){return b.v-a.v;}).slice(0,9);
  var max=Math.max(1,Math.max.apply(null,items.map(function(x){return x.v;})));
  var h='';items.forEach(function(it,i){var col=PAL[i%PAL.length];
    h+='<div class="hbar"><div class="row"><b>'+it.label+'</b><span>'+nf(it.v)+'</span></div>'+
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
  s+='<circle cx="96" cy="96" r="'+r+'" fill="none" stroke="rgba(255,255,255,.05)" stroke-width="'+sw+'"/>';
  items.forEach(function(it,i){var full=C*it.v/total,len=Math.max(2,full-gap),col=PAL[i%PAL.length];
    s+='<circle class="d-seg" cx="96" cy="96" r="'+r+'" fill="none" stroke="'+col+'" stroke-width="'+sw+'" stroke-linecap="round" stroke-dasharray="'+(anim&&!RM?0:len)+' '+(anim&&!RM?C:C-len)+'" data-len="'+len+'" data-c="'+C+'" stroke-dashoffset="'+(-off)+'" data-i="'+i+'" style="filter:url(#dGlow);cursor:pointer"/>';off+=full;});
  s+='</g>';
  s+='<text x="96" y="90" text-anchor="middle" font-family="Space Grotesk" font-size="30" font-weight="700" letter-spacing="-.5" fill="#EAF6F2">'+nf(total)+'</text>';
  s+='<text x="96" y="108" text-anchor="middle" font-size="10.5" font-weight="600" letter-spacing=".5" fill="#93B2AB">BESUCHE</text></svg>';
  box.innerHTML=s;
  if(anim&&!RM){raf(function(){box.querySelectorAll('.d-seg').forEach(function(c,i){c.style.transition='stroke-dasharray .5s cubic-bezier(.22,.61,.36,1) '+(i*.05)+'s';c.style.strokeDasharray=c.dataset.len+' '+(c.dataset.c-c.dataset.len);});});}
  if(leg){var l='';items.forEach(function(it,i){var p=Math.round(it.v/total*100);
    l+='<div class="lg-item" data-i="'+i+'"><span class="lg-dot" style="background:'+PAL[i%PAL.length]+'"></span><span class="lg-name">'+it.label+'</span><span class="lg-pct">'+p+'%</span><span class="lg-val">'+nf(it.v)+'</span></div>';});
    leg.innerHTML=l;
    leg.querySelectorAll('.lg-item').forEach(function(el){var i=+el.dataset.i;
      el.addEventListener('mouseenter',function(){box.querySelectorAll('.d-seg').forEach(function(c){c.style.opacity=(+c.dataset.i===i?'1':'.3');});});
      el.addEventListener('mouseleave',function(){box.querySelectorAll('.d-seg').forEach(function(c){c.style.opacity='1';});});});}
  box.querySelectorAll('.d-seg').forEach(function(c){c.addEventListener('mousemove',function(e){var it=items[+c.dataset.i];showTip(e,it.label+': <b>'+nf(it.v)+'</b> ('+Math.round(it.v/total*100)+'%)');});c.addEventListener('mouseleave',hideTip);});
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
       '<div class="te-body"><div class="te-line"><span class="te-name">'+it.label+'</span>'+
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
    s+='<text class="axis" x="'+(x+bw/2).toFixed(1)+'" y="'+(H-8)+'" text-anchor="middle">'+labels[i]+'</text>';});
  s+='</svg>';box.innerHTML=s;
  if(anim&&!RM)raf(function(){box.querySelectorAll('.bar').forEach(function(el,i){el.style.transition='transform .4s cubic-bezier(.22,.61,.36,1) '+(i*.02)+'s';el.style.transform='scaleY(1)';});});
  box.querySelectorAll('.bar').forEach(function(rc){rc.addEventListener('mousemove',function(e){showTip(e,(full?full[+rc.dataset.i]:labels[+rc.dataset.i])+': <b>'+nf(values[+rc.dataset.i])+'</b>');});rc.addEventListener('mouseleave',hideTip);});
}
function renderWday(rows,anim){var c=[0,0,0,0,0,0,0];rows.forEach(function(r){if(r.dow>=0&&r.dow<=6)c[r.dow]++;});vbars('chartWday',WD,c,WDF,anim);}
function renderHour(rows,anim){
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
function renderKPIs(anim){
  var y=nowDate.getFullYear(),m=nowDate.getMonth();
  var today=countRange(nowYmd,nowYmd),yest=countRange(dateToYmd(addDays(nowDate,-1)),dateToYmd(addDays(nowDate,-1)));
  var dow=(nowDate.getDay()+6)%7,mon=addDays(nowDate,-dow);
  var week=countRange(dateToYmd(mon),nowYmd),pw=countRange(dateToYmd(addDays(mon,-7)),dateToYmd(addDays(mon,-1)));
  var mStart=new Date(y,m,1),month=countRange(dateToYmd(mStart),nowYmd);
  var pmEnd=addDays(mStart,-1),pmStart=new Date(pmEnd.getFullYear(),pmEnd.getMonth(),1);
  var pmDay=Math.min(nowDate.getDate(),new Date(pmEnd.getFullYear(),pmEnd.getMonth()+1,0).getDate());
  var pmonth=countRange(dateToYmd(pmStart),pmEnd.getFullYear()*10000+(pmEnd.getMonth()+1)*100+pmDay);
  var ytd=countRange(y*10000+101,nowYmd),pytd=countRange((y-1)*10000+101,(y-1)*10000+(m+1)*100+nowDate.getDate());
  var sp=spark(last12w());
  var cards=[{l:'Heute',i:'sun',v:today,d:delta(today,yest),s:'vs. gestern'},
    {l:'Diese Woche',i:'week',v:week,d:delta(week,pw),s:'vs. Vorwoche'},
    {l:'Dieser Monat',i:'month',v:month,d:delta(month,pmonth),s:'vs. Vormonat'},
    {l:'Dieses Jahr',i:'year',v:ytd,d:delta(ytd,pytd),s:'vs. Vorjahr'}];
  var h='';cards.forEach(function(c,idx){h+=
    '<div class="card kpi reveal" style="animation-delay:'+(idx*.03)+'s"><div class="k-top">'+c.l+'<span class="chip">'+svg(ICON[c.i])+'</span></div>'+
    '<div class="num" data-v="'+c.v+'">0</div>'+
    '<div><span class="k-delta '+c.d.c+'">'+c.d.a+' '+c.d.t+'</span><span class="k-sub">'+c.s+'</span></div>'+
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
function weekdayMonthAvg(){
  var endDate=ymdToDate(dataMaxYmd),startDate=ymdToDate(minYmd);
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
}
function hourlyCum(wd){
  var byHour=new Array(24).fill(0),total=0;
  for(var i=0;i<V.length;i++){
    var r=V[i];if(r.ymd>dataMaxYmd)break;
    if(!matchStand(r.standort)||r.dow!==wd)continue;
    if(r.stunde<0||r.stunde>23)continue;
    byHour[r.stunde]++;total++;
  }
  var cum=[],acc=0;for(var h=0;h<24;h++){acc+=byHour[h];cum[h]=total?acc/total:0;}
  return cum;
}
function renderForecast(anim){
  var box=document.getElementById('fcGrid');if(!box)return;
  var wdm=weekdayMonthAvg(),y=nowDate.getFullYear(),m=nowDate.getMonth(),todayWd=(nowDate.getDay()+6)%7;
  var avgToday=wdm[m][todayWd];
  var actualToday=countRange(nowYmd,nowYmd);
  var cum=hourlyCum(todayWd),curHour=new Date().getHours(),frac=cum[Math.min(23,Math.max(0,curHour))]||0;
  var projToday=(frac>=0.15&&actualToday>0)?Math.round(actualToday/frac):Math.round(avgToday);
  projToday=Math.max(projToday,actualToday);
  var expToday=Math.round(avgToday);
  var restTodayAvg=Math.max(0,avgToday-actualToday);
  var mStart=new Date(y,m,1),mEnd=new Date(y,m+1,0),actualMonth=countRange(dateToYmd(mStart),nowYmd),remMonth=0;
  for(var t=addDays(nowDate,1);t<=mEnd;t=addDays(t,1))remMonth+=wdm[t.getMonth()][(t.getDay()+6)%7];
  var projMonth=Math.round(actualMonth+restTodayAvg+remMonth);
  var next7=restTodayAvg;for(var t2=addDays(nowDate,1);t2<=addDays(nowDate,7);t2=addDays(t2,1))next7+=wdm[t2.getMonth()][(t2.getDay()+6)%7];
  next7=Math.round(next7);
  var cells=[
    {l:'Prognose heute',v:projToday,s:'aktuell '+nf(actualToday)+' · &#216; '+WD[todayWd]+'. '+nf(expToday)},
    {l:'Prognose '+MON[m]+'.',v:projMonth,s:'bislang '+nf(actualMonth)+' Besuche'},
    {l:'N&auml;chste 7 Tage',v:next7,s:'voraussichtlich'}
  ];
  var wdAvgMoFr=wdm[m].slice(0,5);
  var mx=Math.max.apply(null,wdAvgMoFr)||1;
  var bars=wdAvgMoFr.map(function(a,i){var hh=Math.round(a/mx*100);
    return '<div class="fc-wd'+(i===todayWd?' is-today':'')+'"><div class="fc-wd-track"><i data-h="'+hh+'" style="height:'+(anim&&!RM?0:hh)+'%"></i></div><span>'+WD[i]+'</span><b>'+nf(Math.round(a))+'</b></div>';
  }).join('');
  box.innerHTML='<div class="fc-stats">'+cells.map(function(c){
    return '<div class="fc-cell"><div class="fc-l">'+c.l+'</div><div class="num fc-num" data-v="'+c.v+'">0</div><div class="fc-s">'+c.s+'</div></div>';
  }).join('')+'</div><div class="fc-wdbars">'+bars+'</div>';
  box.querySelectorAll('.fc-num').forEach(function(el){countUp(el,+el.dataset.v,anim);});
  if(anim&&!RM)raf(function(){box.querySelectorAll('.fc-wd-track i').forEach(function(el){el.style.transition='height .45s var(--ease)';el.style.height=el.dataset.h+'%';});});
}

/* ---------- Tab 2: Standorte ---------- */
function renderStandortTab(rows,anim){
  renderDonut(rows,anim);
  var total=rows.length||1;
  var standorte=['Euskirchen','Kall'];
  var cards=standorte.map(function(name){
    var sRows=rows.filter(function(r){return r.standort===name;});
    var count=sRows.length;
    var daySet={};sRows.forEach(function(r){daySet[r.ymd]=true;});
    var uniqueDays=Object.keys(daySet).length||1;
    var avgPerDay=count?(count/uniqueDays).toFixed(1):'0';
    var anteil=Math.round(count/total*100);
    var katCounts={};sRows.forEach(function(r){if(r.kategorie){var k=stripPfx(r.kategorie);katCounts[k]=(katCounts[k]||0)+1;}});
    var katItems=Object.keys(katCounts).map(function(k){return {k:k,v:katCounts[k]};}).sort(function(a,b){return b.v-a.v;});
    var topKat=katItems.length?katItems[0].k:'–';
    var wdayCounts=[0,0,0,0,0,0,0];sRows.forEach(function(r){if(r.dow>=0&&r.dow<=6)wdayCounts[r.dow]++;});
    var topWday=wdayCounts.indexOf(Math.max.apply(null,wdayCounts));
    var topWdayName=WDF[topWday]||'–';
    var hourCounts={};sRows.forEach(function(r){if(r.stunde>0&&r.stunde<=23)hourCounts[r.stunde]=(hourCounts[r.stunde]||0)+1;});
    var hourItems=Object.keys(hourCounts).map(function(h){return {h:+h,v:hourCounts[h]};}).sort(function(a,b){return b.v-a.v;});
    var topHour=hourItems.length?hourItems[0].h:null;
    var spitzenzeit=topHour!==null?(topHour+':00–'+(topHour+1)+':00 Uhr'):'–';
    return {name:name,count:count,avgPerDay:avgPerDay,anteil:anteil,topKat:topKat,topWdayName:topWdayName,spitzenzeit:spitzenzeit};
  });
  var cBox=document.getElementById('standortCards');if(!cBox)return;
  cBox.innerHTML=cards.map(function(c){
    return '<div class="si-card reveal">'+
      '<div class="si-title"><h3>'+c.name+'</h3><span class="si-badge">'+c.anteil+'% aller Besuche</span></div>'+
      '<div class="si-rows">'+
        '<div class="si-row"><span class="si-label">Besucher gesamt</span><span class="si-val accent">'+nf(c.count)+'</span></div>'+
        '<div class="si-row"><span class="si-label">&#216; pro Öffnungstag</span><span class="si-val">'+c.avgPerDay+'</span></div>'+
        '<div class="si-row"><span class="si-label">Häufigstes Anliegen</span><span class="si-val">'+c.topKat+'</span></div>'+
        '<div class="si-row"><span class="si-label">Stärkster Wochentag</span><span class="si-val">'+c.topWdayName+'</span></div>'+
        '<div class="si-row"><span class="si-label">Spitzenzeit</span><span class="si-val">'+c.spitzenzeit+'</span></div>'+
      '</div>'+
      '<div class="si-pct-bar"><i data-w="'+c.anteil+'" style="width:'+(anim&&!RM?'0':c.anteil)+'%"></i></div>'+
    '</div>';
  }).join('');
  if(anim&&!RM)raf(function(){cBox.querySelectorAll('.si-pct-bar i').forEach(function(el){el.style.width=el.dataset.w+'%';});});
  var tBox=document.getElementById('standortInsightText');
  if(tBox&&cards.length>=2){
    var e=cards[0],k=cards[1];
    tBox.innerHTML='<h3 style="margin:0 0 14px;font-size:17px;font-weight:600">Automatische Insights</h3>'+
      '<div class="si-text-box">'+
        '<div class="si-text-item"><div class="si-text-dot" style="background:'+PAL[0]+'"></div>'+
          '<p><b>'+e.name+'</b> generiert '+e.anteil+'% aller Besucher. Spitzenzeit ist '+e.spitzenzeit+'. Häufigstes Anliegen ist <b>'+e.topKat+'</b>.</p></div>'+
        '<div class="si-text-item"><div class="si-text-dot" style="background:'+PAL[3]+'"></div>'+
          '<p><b>'+k.name+'</b> generiert '+k.anteil+'% aller Besucher. Spitzenzeit ist '+k.spitzenzeit+'. Häufigstes Anliegen ist <b>'+k.topKat+'</b>.</p></div>'+
      '</div>';
  }
  var rBox=document.getElementById('standortInsightRight');
  if(rBox){
    rBox.innerHTML=cards.map(function(c){
      return '<div class="card" style="flex:1">'+
        '<div style="font-size:11.5px;font-weight:700;color:var(--muted);letter-spacing:.06em;margin-bottom:6px">'+c.name.toUpperCase()+'</div>'+
        '<div style="font-family:Space Grotesk,sans-serif;font-size:32px;font-weight:700;color:var(--acc-ink);letter-spacing:-.5px">'+nf(c.count)+'</div>'+
        '<div style="font-size:12px;color:var(--muted-2);margin-top:4px;font-weight:600">Besuche &nbsp;·&nbsp; <b style="color:var(--ink)">'+c.anteil+'%</b></div>'+
      '</div>';
    }).join('');
  }
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
  box.innerHTML='<div class="heatmap-wrap">'+s+'</div>';
  box.querySelectorAll('rect[data-v]').forEach(function(rc){
    rc.addEventListener('mousemove',function(e){showTip(e,WDF[+rc.dataset.d]+' · '+rc.dataset.h+':00 Uhr: <b>'+nf(+rc.dataset.v)+'</b>');});
    rc.addEventListener('mouseleave',hideTip);
  });
}

/* ---------- Tab 3: Monatsvergleich ---------- */
function renderMonthlyComparison(anim){
  var box=document.getElementById('chartMonthly');if(!box)return;
  var buckets=[];
  for(var i=11;i>=0;i--){
    var d=addMonths(new Date(nowDate.getFullYear(),nowDate.getMonth(),1),-i);
    var y2=d.getFullYear(),mo=d.getMonth();
    var from=y2*10000+(mo+1)*100+1,to=dateToYmd(new Date(y2,mo+1,0));
    var count=0;
    for(var j=0;j<V.length;j++){var r=V[j];if(r.ymd>=from&&r.ymd<=to&&matchStand(r.standort))count++;}
    buckets.push({label:MON[mo]+' '+(''+y2).slice(2),v:count,isCurrent:i===0});
  }
  var W=Math.max(360,Math.round(box.clientWidth)||640),H=220,pad={l:44,r:14,t:16,b:30};
  var n=buckets.length,max=Math.max(1,Math.max.apply(null,buckets.map(function(x){return x.v;})));
  var iw=W-pad.l-pad.r,ih=H-pad.t-pad.b,gap=iw/n,bw=Math.min(42,gap*0.65);
  var s='<svg viewBox="0 0 '+W+' '+H+'" width="100%" style="height:220px"><defs>'+
    '<linearGradient id="mg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="'+ACC+'"/><stop offset="1" stop-color="#8c6b00"/></linearGradient>'+
    '<linearGradient id="mg2" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#1d9e75"/><stop offset="1" stop-color="#0a5e42"/></linearGradient></defs>';
  for(var g=0;g<=4;g++){var gv=Math.round(max*g/4),gy=pad.t+ih-ih*g/4;
    s+='<line class="gridline" x1="'+pad.l+'" y1="'+gy+'" x2="'+(W-pad.r)+'" y2="'+gy+'"/>';
    s+='<text class="axis" x="'+(pad.l-6)+'" y="'+(gy+4)+'" text-anchor="end">'+nf(gv)+'</text>';}
  buckets.forEach(function(d,i){
    var x=pad.l+gap*i+(gap-bw)/2,bh=Math.max(0,ih*d.v/max),y=pad.t+ih-bh;
    s+='<rect class="bar" x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+bh.toFixed(1)+'" rx="5" fill="'+(d.isCurrent?'url(#mg2)':'url(#mg)')+'" data-i="'+i+'" style="transform-box:fill-box;transform-origin:center bottom;'+(anim&&!RM?'transform:scaleY(0)':'')+'" />';
    s+='<text class="axis" x="'+(x+bw/2).toFixed(1)+'" y="'+(H-8)+'" text-anchor="middle">'+d.label+'</text>';
  });
  s+='</svg>';box.innerHTML=s;
  if(anim&&!RM)raf(function(){box.querySelectorAll('.bar').forEach(function(el,i){el.style.transition='transform .4s cubic-bezier(.22,.61,.36,1) '+(i*.02)+'s';el.style.transform='scaleY(1)';});});
  box.querySelectorAll('.bar').forEach(function(rc){rc.addEventListener('mousemove',function(e){var d=buckets[+rc.dataset.i];showTip(e,d.label+': <b>'+nf(d.v)+'</b>');});rc.addEventListener('mouseleave',hideTip);});
}

/* ---------- Tab 3: Forecast-Analyse ---------- */
function renderForecastAnalysis(anim){
  var box=document.getElementById('fcAnalysis');if(!box)return;
  var wdm=weekdayMonthAvg(),y=nowDate.getFullYear(),m=nowDate.getMonth(),todayWd=(nowDate.getDay()+6)%7;
  var avgToday=wdm[m][todayWd],actualToday=countRange(nowYmd,nowYmd);
  var cum=hourlyCum(todayWd),curHour=new Date().getHours(),frac=cum[Math.min(23,Math.max(0,curHour))]||0;
  var projToday=(frac>=0.15&&actualToday>0)?Math.round(actualToday/frac):Math.round(avgToday);
  projToday=Math.max(projToday,actualToday);
  var restTodayAvg=Math.max(0,avgToday-actualToday);
  var mStart=new Date(y,m,1),mEnd=new Date(y,m+1,0);
  var actualMonth=countRange(dateToYmd(mStart),nowYmd);
  var remMonth=0;for(var t=addDays(nowDate,1);t<=mEnd;t=addDays(t,1))remMonth+=wdm[t.getMonth()][(t.getDay()+6)%7];
  var projMonth=Math.round(actualMonth+restTodayAvg+remMonth);
  var pmEnd=addDays(mStart,-1),pmStart=new Date(pmEnd.getFullYear(),pmEnd.getMonth(),1);
  var prevMonth=countRange(dateToYmd(pmStart),dateToYmd(pmEnd));
  var next7=restTodayAvg;for(var t2=addDays(nowDate,1);t2<=addDays(nowDate,7);t2=addDays(t2,1))next7+=wdm[t2.getMonth()][(t2.getDay()+6)%7];
  next7=Math.round(next7);
  var md=prevMonth>0?Math.round((projMonth-prevMonth)/prevMonth*100):0;
  var dc=md>0?'up':md<0?'down':'flat',ds=md>0?'+':'';
  box.innerHTML='<div class="fca-grid">'+
    '<div class="fca-row">'+
      '<div style="flex:1"><div class="fca-label">Prognose heute</div><div class="fca-sub">aktuell '+nf(actualToday)+' · Ø '+WD[todayWd]+' '+nf(Math.round(avgToday))+'</div></div>'+
      '<div class="fca-val">'+nf(projToday)+'</div>'+
    '</div>'+
    '<div class="fca-row">'+
      '<div style="flex:1"><div class="fca-label">Prognose '+MON[m]+'. gesamt</div><div class="fca-sub">bislang '+nf(actualMonth)+' · Vormonat '+nf(prevMonth)+'</div></div>'+
      '<div class="fca-val">'+nf(projMonth)+'</div>'+
      '<span class="fca-delta '+dc+'">'+ds+md+'%</span>'+
    '</div>'+
    '<div class="fca-row">'+
      '<div style="flex:1"><div class="fca-label">Nächste 7 Tage</div><div class="fca-sub">voraussichtlich</div></div>'+
      '<div class="fca-val">'+nf(next7)+'</div>'+
    '</div>'+
  '</div>';
}

/* ---------- Tab 3: Kategorie-Trend ---------- */
function renderKatTrend(anim){
  var box=document.getElementById('chartKatTrend');if(!box)return;
  var months=[];
  for(var i=11;i>=0;i--){
    var d=addMonths(new Date(nowDate.getFullYear(),nowDate.getMonth(),1),-i);
    var y2=d.getFullYear(),mo=d.getMonth();
    months.push({label:MON[mo]+' '+(''+y2).slice(2),from:y2*10000+(mo+1)*100+1,to:dateToYmd(new Date(y2,mo+1,0))});
  }
  var katTotals={};
  for(var j=0;j<V.length;j++){var r=V[j];if(r.kategorie&&matchStand(r.standort)){var k=stripPfx(r.kategorie);katTotals[k]=(katTotals[k]||0)+1;}}
  var topKats=Object.keys(katTotals).sort(function(a,b){return katTotals[b]-katTotals[a];}).slice(0,5);
  if(!topKats.length){box.innerHTML='<p class="sub" style="text-align:center;padding:32px 0">Keine Kategoriedaten vorhanden.</p>';return;}
  var KATPAL=['#004442','#1d9e75','#3a96c9','#dea600','#d4537e'];
  var series=topKats.map(function(kat){
    var vals=months.map(function(mo){
      var c=0;
      for(var ii=0;ii<V.length;ii++){var rr=V[ii];if(rr.ymd>=mo.from&&rr.ymd<=mo.to&&matchStand(rr.standort)&&rr.kategorie&&stripPfx(rr.kategorie)===kat)c++;}
      return c;
    });
    return {label:kat,vals:vals};
  });
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

/* ---------- render ---------- */
function render(anim){
  var r=currentRange(),rows=rowsIn(r[0],r[1]);
  document.getElementById('rangeInfo').textContent=fmtDE(r[0])+' – '+fmtDE(r[1])+' · '+nf(rows.length)+' Besuche'+(state.standort!=='all'?' · '+state.standort:'');
  renderKPIs(anim);renderLocKPIs(anim);renderForecast(anim);renderTrend(rows,r[0],r[1],anim);renderKat(rows,anim);renderWday(rows,anim);renderHour(rows,anim);renderKatDonut(rows,anim);renderThemeResults(anim);
  renderStandortTab(rows,anim);
  renderHeatmap(rows,anim);renderMonthlyComparison(anim);renderForecastAnalysis(anim);renderKatTrend(anim);
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
        V.push(entry);   // optimistisch – Live-Reload (POST→Event) gleicht V danach mit der DB ab
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
      V.length=0;rows.forEach(function(r){V.push(parseApiRow(r));});
      _applyMaxima();
      _booted=true;
      initControls();
      initDashTabs();
      initThemeExplorer();
      render(true);
      initErfassen();
      var rz;window.addEventListener('resize',function(){clearTimeout(rz);rz=setTimeout(function(){render(false);},160);});
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
      rows.forEach(function(r){V.push(parseApiRow(r));});               // frischen Heute-Teil anhängen (bleibt sortiert)
      dataMaxYmd=V.length?V[V.length-1].ymd:nowYmd;maxYmd=Math.max(dataMaxYmd,nowYmd);
      render(false);
      if(redrawErfassGrid)redrawErfassGrid();
    })
    ['catch'](function(){})
    ['finally'](function(){_refreshing=false;});
}

bootLoad().catch(function(err){
  kpisBox.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:32px 0;color:#ff8a78">'+
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
  var API_ML=(location.hostname==='127.0.0.1'?'http://127.0.0.1:3001':'')+'/api/mitbewerber';
  var mlLoaded=false, mlCache={}, mlCurrentAnbieter=[];
  // zaehlerart: gemeinsam für WP und NS. nsMessung nur bei heizstromTyp='ns'.
  var mlState={ sparte: 'strom', heizstromTyp: 'wp', zaehlerart: 'einzeltarif', nsMessung: 'getrennt', steuveMod: 'modul1' };

  function fmtAP(v){ return v!=null ? (v*100).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})+' ct/kWh' : '–'; }
  function fmtGP(v){ return v!=null ? v.toFixed(2)+' €/Jahr' : '–'; }
  function fmtBonus(v){ return (v&&v>0) ? v.toFixed(0)+' €' : '–'; }

  function renderKpis(stats){
    var box=document.getElementById('marktlage-kpis');
    if(!box) return;
    var g=stats.guentigster, t=stats.teuerster;
    box.innerHTML=[
      '<div class="kpi-card card reveal ml-kpi ml-kpi--best"><div class="kpi-lbl">Günstigster</div><div class="kpi-val">'+(g?g.anbieter:'–')+'</div><div class="kpi-sub">'+(g?fmtAP(g.arbeitspreis):'–')+'</div>'+(g&&g.grundpreis?'<div class="kpi-sub2">GP '+fmtGP(g.grundpreis)+'</div>':'')+'</div>',
      '<div class="kpi-card card reveal ml-kpi"><div class="kpi-lbl">Teuerster</div><div class="kpi-val">'+(t?t.anbieter:'–')+'</div><div class="kpi-sub">'+(t?fmtAP(t.arbeitspreis):'–')+'</div>'+(t&&t.grundpreis?'<div class="kpi-sub2">GP '+fmtGP(t.grundpreis)+'</div>':'')+'</div>',
      '<div class="kpi-card card reveal ml-kpi"><div class="kpi-lbl">Ø Arbeitspreis</div><div class="kpi-val kpi-val--mono">'+(stats.durchschnitt_arbeitspreis?fmtAP(stats.durchschnitt_arbeitspreis):'–')+'</div><div class="kpi-sub">Marktdurchschnitt</div></div>',
      '<div class="kpi-card card reveal ml-kpi"><div class="kpi-lbl">Anbieter im Markt</div><div class="kpi-val">'+(stats.anzahl_anbieter||0)+'</div><div class="kpi-sub">Tarife verglichen</div></div>'
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
      var tr='<td>'+a.anbieter+'</td><td class="ml-price">'+fmtAP(a.arbeitspreis)+'</td><td>'+fmtGP(a.grundpreis)+'</td>';
      if(showBonus) tr+='<td>'+(a.bonus&&a.bonus>0?'<span class="ml-bonus-badge">'+fmtBonus(a.bonus)+'</span>':'–')+'</td><td class="ml-cond">'+(a.bonus_bedingung||'–')+'</td>';
      tr+='<td class="ml-src">'+a.quelle+'</td>';
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
      renderKpis(mlCache[cacheKey].stats);
      renderTable(mlCurrentAnbieter, showBonus, '');
      if(infoEl) infoEl.textContent='Zuletzt aktualisiert: '+mlCache[cacheKey].ts;
      return;
    }

    if(kpisBox) kpisBox.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:20px;opacity:.5">Lade Marktdaten …</div>';

    var urls=[API_ML+'/statistik?sparte='+sparte, buildApiUrl(sparte, plz, heizstromTyp, zaehlerart, nsMessung, steuveMod)];
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

      renderKpis(stats);
      renderTable(mlCurrentAnbieter, showBonus, '');
      if(infoEl) infoEl.textContent='Zuletzt aktualisiert: '+ts+(plz?' (PLZ '+plz+')':'');
      mlLoaded=true;
    })['catch'](function(err){
      if(kpisBox) kpisBox.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:20px;color:#c55">Fehler: '+err.message+'</div>';
    });
  }

  // View activation
  document.querySelectorAll('.mod-item[data-view]').forEach(function(a){
    if(a.dataset.view==='marktlage'){
      a.addEventListener('click', function(){ if(!mlLoaded) loadMarktlage(); });
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

  // PLZ input
  var plzInput=document.getElementById('marktlagePlzInput');
  if(plzInput){
    plzInput.addEventListener('change', function(){ mlLoaded=false; loadMarktlage(); });
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
