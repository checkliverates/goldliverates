const http = require("http");
const io = require("socket.io-client");

const PORT = process.env.PORT || 10000;
const WF_SERVER = "https://quote.wfgroup.com.hk:8083";
const TOKEN = process.env.WFBULLION_TOKEN || "";

// ============================================================
// PRODUCT / MARKUP SETTINGS
// Change these values when you want to change daily markups.
// Markup is NEVER sent to the browser.
// ============================================================
const PRODUCTS = [
  { label: "75 - 199 Grams",  markup: 17.00 },
  { label: "200 - 399 Grams", markup: 12.00 },
  { label: "400 - 999 Grams", markup:  9.00 },
  { label: "1000 Grams",      markup:  5.00 },
  { label: "",                markup:  0.00 }
];

const ADMIN_KEY = process.env.ADMIN_KEY || "";
const ADMIN_STATE = PRODUCTS.map(p => ({ label: p.label, markup: p.markup }));

let latest = {
  bid: null,
  gramSourceAsk: null,
  updatedAt: null,
  connected: false
};

function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(data));
}

function truncate2(n) {
  return Math.trunc((n + Number.EPSILON) * 100) / 100;
}

function calculateRows() {
  if (latest.bid === null) return [];
  return ADMIN_STATE.map((p, i) => {
    if (!p.label) return { index: i, label: "", rate: null };
    const rate = truncate2((latest.bid + Number(p.markup)) / 31.1035);
    return { index: i, label: p.label, rate };
  });
}

function adminPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Markup Settings</title>
<style>@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;800;900&display=swap');body{font-family:"Roboto",Arial,sans-serif;background:#f5f5f5;margin:0;padding:30px}.box{max-width:650px;margin:auto;background:#fff;border:1px solid #c59a22;border-radius:18px;padding:25px;box-shadow:0 10px 28px rgba(0,0,0,.08)}h1{margin-top:0}.row{display:grid;grid-template-columns:1fr 150px;gap:12px;margin:12px 0}.row input{padding:12px;border:1px solid #ccc;border-radius:8px;font-size:16px}button{margin-top:15px;padding:12px 22px;border:0;border-radius:9px;background:#c59a22;color:#fff;font-weight:700;font-size:16px;cursor:pointer}.msg{margin-top:15px;font-weight:700}.lightning,.bolt,.zap,.lightning-symbol{display:none!important}
</style></head><body><div class="box"><h1>Daily Markup Settings</h1><p>These values stay on the server and are not displayed on the client price page.</p><div id="rows"></div><button onclick="save()">Save Markup</button><div id="msg" class="msg"></div></div>
<script>async function load(){const r=await fetch('/admin/data');const d=await r.json();document.getElementById('rows').innerHTML=d.products.map((p,i)=>'<div class="row"><input id="l'+i+'" value="'+String(p.label).replaceAll('"','&quot;')+'"><input id="m'+i+'" type="number" step="0.01" value="'+p.markup+'"></div>').join('')}async function save(){const products=Array.from({length:5},(_,i)=>({label:document.getElementById('l'+i).value,markup:Number(document.getElementById('m'+i).value)}));const key=prompt('Enter ADMIN_KEY');if(key===null)return;const r=await fetch('/admin/save',{method:'POST',headers:{'Content-Type':'application/json','x-admin-key':key},body:JSON.stringify({products})});const d=await r.json();document.getElementById('msg').textContent=d.message||'Saved';}load();</script></body></html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/health") {
    return sendJson(res, { ok:true, upstreamConnected:latest.connected, tokenPresent:Boolean(TOKEN), bidAvailable:latest.bid !== null });
  }

  if (url.pathname === "/api/price") {
    if (latest.bid === null || latest.gramSourceAsk === null) {
      return sendJson(res, { ok:false, connected:latest.connected });
    }

    const rows = calculateRows();
    return sendJson(res, {
      ok:true,
      connected:latest.connected,
      bid:latest.bid,
      rows,
      updatedAt:latest.updatedAt
    });
  }

  if (url.pathname === "/admin") {
    if (!ADMIN_KEY) {
      res.writeHead(503, {"Content-Type":"text/plain; charset=utf-8"});
      return res.end("Admin is disabled. Set ADMIN_KEY in Render Environment Variables.");
    }
    res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});
    return res.end(adminPage());
  }

  if (url.pathname === "/admin/data") {
    if (!ADMIN_KEY) return sendJson(res,{ok:false},503);
    return sendJson(res,{ok:true,products:ADMIN_STATE});
  }

  if (url.pathname === "/admin/save" && req.method === "POST") {
    if (!ADMIN_KEY || req.headers["x-admin-key"] !== ADMIN_KEY) return sendJson(res,{ok:false,message:"Unauthorized"},401);
    let body="";
    req.on("data", chunk => { body += chunk; if(body.length > 100000) req.destroy(); });
    req.on("end", () => {
      try {
        const parsed=JSON.parse(body);
        if(!Array.isArray(parsed.products) || parsed.products.length !== 5) throw new Error("Invalid products");
        parsed.products.forEach((p,i)=>{
          const label=String(p.label || "").trim().slice(0,60);
          const markup=Number(p.markup);
          if(!Number.isFinite(markup) || markup < -10000 || markup > 10000) throw new Error("Invalid markup at row "+(i+1));
          ADMIN_STATE[i].label=label;
          ADMIN_STATE[i].markup=markup;
        });
        return sendJson(res,{ok:true,message:"Saved. Markups are active now. Note: Render restarts reset in-memory changes; for permanent daily settings update PRODUCTS in server.js or Render Environment Variables."});
      } catch(e) { return sendJson(res,{ok:false,message:e.message},400); }
    });
    return;
  }

  if (url.pathname === "/") {
    res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});
    return res.end(page());
  }

  res.writeHead(404,{"Content-Type":"text/plain; charset=utf-8"});
  res.end("Not found");
});

function page() {
return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#eef8ff"><title>Live Gold Rates</title><link rel="icon" href="data:,">
<style>
@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;800;900&display=swap');
:root{--navy:#073d7a;--blue:#087cf0;--blue2:#55b7f4;--sky:#eaf6ff;--line:#dcecf9;--gold:#f0a800;--green:#12b879;--red:#ff3d49}
*{box-sizing:border-box}html,body{margin:0;padding:0}body{min-height:100vh;background:#f5fbff;color:var(--navy);font-family:"Roboto",Arial,Helvetica,sans-serif;padding:18px 10px;overflow-x:hidden}.page{width:min(1000px,100%);margin:0 auto;position:relative}.shell{position:relative;border:1px solid #dce7ef;background:linear-gradient(180deg,#ffffff 0%,#f7fcff 100%);min-height:650px;overflow:hidden;box-shadow:0 1px 0 rgba(0,60,120,.05)}
/* HEADER */
.header{margin:18px 14px 12px;border:1px solid #d2e8f8;border-radius:14px;background:linear-gradient(108deg,#ffffff 0%,#f5fbff 47%,#e4f3ff 100%);height:104px;display:flex;align-items:center;justify-content:space-between;padding:10px 16px 10px 20px;position:relative;overflow:hidden;box-shadow:0 4px 14px rgba(30,120,190,.08)}.header:before{content:"";position:absolute;width:55%;height:180px;right:13%;top:-90px;border-radius:50%;background:linear-gradient(145deg,rgba(150,213,250,.30),rgba(255,255,255,0));transform:rotate(-18deg)}.header:after{content:"";position:absolute;width:47%;height:110px;right:12%;bottom:-70px;border-radius:50%;border-top:2px solid rgba(241,190,55,.55);transform:rotate(-13deg)}.brand{display:flex;align-items:center;gap:17px;position:relative;z-index:2}.brand-icon{width:88px;height:76px;display:grid;place-items:center;flex:none}.gold-mark{position:relative;width:38px;height:34px;display:block;flex:none}.gold-mark-large{width:88px;height:76px}.gold-mark .bar{position:absolute;display:block;background:linear-gradient(135deg,#fff4a6 0%,#f8c52b 28%,#d98b00 68%,#ffe56b 100%);border:1px solid rgba(183,119,0,.45);box-shadow:0 2px 3px rgba(155,91,0,.18);border-radius:3px;transform:skewX(-16deg)}.gold-mark .bar-a{width:24px;height:11px;left:1px;top:15px}.gold-mark .bar-b{width:24px;height:11px;left:10px;top:8px}.gold-mark .bar-c{width:20px;height:10px;left:18px;top:18px}.gold-mark .purity{position:absolute;left:5px;top:18px;font-size:5.5px;line-height:1;color:#805000;font-weight:900;letter-spacing:-.15px;z-index:4;white-space:nowrap}.gold-mark-large .bar-a{width:51px;height:24px;left:3px;top:34px}.gold-mark-large .bar-b{width:51px;height:24px;left:22px;top:18px}.gold-mark-large .bar-c{width:43px;height:21px;left:39px;top:39px}.gold-mark-large .purity{left:10px;top:40px;font-size:9px;letter-spacing:-.25px}.brand-title{font-size:31px;line-height:1.02;font-weight:900;letter-spacing:-.7px;color:#0a3f80}.brand-sub{font-size:14px;color:#416a95;margin-top:7px}.dot{display:inline-block;width:4px;height:4px;border-radius:50%;background:#2f8be0;margin:0 9px 2px}.datetime{position:relative;z-index:3;width:222px;background:rgba(255,255,255,.72);border:1px solid #d5e9f8;border-radius:12px;padding:12px 15px;box-shadow:0 3px 12px rgba(55,125,180,.08)}.date{font-size:16px;font-weight:900;text-align:center}.time{font-size:12px;font-weight:800;text-align:center;margin-top:8px;white-space:nowrap}.hkflag{width:22px;height:16px;vertical-align:-3px;margin-right:7px}
/* MAIN */
.main{display:grid;grid-template-columns:1.58fr 1fr;gap:14px;margin:0 14px;position:relative;z-index:2}.card{background:rgba(255,255,255,.92);border:1px solid #d9eaf7;border-radius:13px;box-shadow:0 5px 15px rgba(45,112,160,.09);overflow:hidden}.cardbar{height:62px;padding:0 18px;display:flex;align-items:center;justify-content:space-between;color:white;background:linear-gradient(100deg,#0874e5 0%,#2e9af1 58%,#65c2f4 100%);position:relative}.cardbar:after{content:"";position:absolute;right:19px;bottom:13px;width:65px;height:31px;border-top:2px solid rgba(255,255,255,.9);border-radius:50%;transform:rotate(-28deg)}.gold-heading{display:flex;align-items:center;gap:11px;font-size:20px;font-weight:900}.small-gold{width:48px;height:43px;display:grid;place-items:center}.trend{font-size:30px;font-weight:300;opacity:.9;z-index:1;margin-right:0}.rates-inner{padding:12px 14px 10px}.thead{height:42px;border-radius:9px;background:linear-gradient(180deg,#eaf6ff,#e2f1fc);display:grid;grid-template-columns:1fr 140px;align-items:center;padding:0 15px;font-size:13px;font-weight:900;color:#174a80}.thead div:last-child{text-align:right}.quote-row{min-height:74px;display:grid;grid-template-columns:1fr 140px;align-items:center;padding:9px 15px;border-bottom:1px solid #e4eff7}.quote-row:last-child{border-bottom:0}.product-wrap{display:flex;align-items:center;gap:13px}.product-icon{width:42px;height:42px;border-radius:50%;background:radial-gradient(circle at 32% 27%,#fff9c9 0%,#ffe477 23%,#f5be29 50%,#d98905 76%,#b86b00 100%);border:2px solid #dfa019;display:grid;place-items:center;flex:none;position:relative;box-shadow:inset 1px 1px 3px rgba(255,255,255,.9),inset -2px -2px 4px rgba(111,64,0,.2),0 2px 5px rgba(121,78,0,.18)}.product-icon:before{content:"";position:absolute;width:10px;height:6px;border-radius:50%;background:rgba(255,255,255,.62);top:7px;left:8px;transform:rotate(-25deg)}.product-icon .gold-mark{display:none}.product{font-size:15px;font-weight:900;color:#123f78;white-space:nowrap}.prices{display:flex;justify-content:flex-end;align-items:center;gap:10px;font-size:25px;font-weight:900;color:#087bea}.rate-arrow{font-size:17px;font-weight:900}.up{color:var(--green)}.down{color:var(--red)}
/* RULES */
.rules-title{height:62px;background:linear-gradient(180deg,#eef8ff,#e5f3fc);display:flex;align-items:center;gap:11px;padding:0 16px;font-size:19px;font-weight:900;color:#103f77;border-bottom:1px solid #dcecf8}.info{width:39px;height:39px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(145deg,#1c94f1,#0571df);color:#fff;font-size:22px;font-weight:900;box-shadow:0 4px 10px rgba(15,118,225,.18)}.rules-body{padding:6px 14px 8px}.rule{display:grid;grid-template-columns:46px 1fr;gap:10px;padding:13px 0;border-bottom:1px solid #e1edf6}.rule:last-child{border-bottom:0}.rule-num{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(145deg,#2395f3,#0876e5);color:#fff;font-size:14px;font-weight:900}.rule p{margin:3px 0 0;font-size:12px;line-height:1.48;color:#264f7d}.rule b{color:#0b3f78}
/* BOTTOM WAVE */
.bottom-art{height:110px;margin-top:10px;position:relative;overflow:hidden}.wave1,.wave2{position:absolute;left:-5%;width:110%;height:90px;border-radius:50% 50% 0 0/100% 100% 0 0;bottom:-52px;transform:rotate(3deg)}.wave1{background:linear-gradient(180deg,rgba(116,195,244,.23),rgba(116,195,244,.34))}.wave2{bottom:-67px;transform:rotate(-4deg);background:linear-gradient(180deg,rgba(190,227,249,.32),rgba(190,227,249,.46))}.skyline{position:absolute;bottom:2px;left:50%;transform:translateX(-50%);width:min(430px,62%);height:78px;opacity:.42}.foot{display:none}
@media(max-width:820px){body{padding:10px}.header{height:auto;min-height:112px}.brand-title{font-size:28px}.main{grid-template-columns:1fr}.datetime{width:210px}.bottom-art{height:85px}}
@media(max-width:600px){.header{margin:10px 8px 10px;padding:12px;flex-direction:column;align-items:stretch;gap:10px}.brand{justify-content:center}.brand-icon{width:65px;height:60px}.gold-mark-large{width:65px;height:60px}.gold-mark-large .bar-a{width:38px;height:19px;left:2px;top:27px}.gold-mark-large .bar-b{width:38px;height:19px;left:16px;top:14px}.gold-mark-large .bar-c{width:32px;height:17px;left:29px;top:31px}.gold-mark-large .purity{left:7px;top:32px;font-size:7px}.brand-title{font-size:24px}.brand-sub{font-size:11px;margin-top:5px}.datetime{width:100%;padding:9px}.date{font-size:15px}.time{font-size:12px}.main{margin:0 8px;gap:10px}.cardbar{height:56px;padding:0 13px}.gold-heading{font-size:18px}.small-gold{width:43px;height:39px}.rates-inner{padding:10px}.thead{grid-template-columns:1fr 125px;padding:0 12px;font-size:12px}.quote-row{grid-template-columns:1fr 125px;min-height:68px;padding:8px 11px}.product-wrap{gap:9px}.product-icon{width:37px;height:37px}.product-icon:before{width:9px;height:5px;top:6px;left:7px}.gold-mark{width:36px;height:32px}.gold-mark .bar-a{width:23px;height:10px}.gold-mark .bar-b{width:23px;height:10px;left:9px;top:7px}.gold-mark .bar-c{width:19px;height:9px;left:17px;top:17px}.gold-mark .purity{font-size:5px;left:5px;top:17px}.product{font-size:13px}.prices{font-size:21px;gap:7px}.rules-title{height:56px;font-size:17px;padding:0 13px}.info{width:35px;height:35px;font-size:20px}.rule{grid-template-columns:39px 1fr;gap:8px;padding:11px 0}.rule-num{width:36px;height:36px;font-size:12px}.rule p{font-size:11.5px;line-height:1.45}.bottom-art{height:68px}.skyline{width:75%;height:58px}}
@media(max-width:390px){.brand{gap:9px}.brand-title{font-size:21px}.brand-sub{font-size:10px}.product{font-size:12px}.prices{font-size:19px}.thead,.quote-row{grid-template-columns:1fr 112px}.prices{gap:5px}}
.lightning,.bolt,.zap,.lightning-symbol{display:none!important}

/* DESIGN VARIANT 02 — Premium Soft */
.brand-title{font-family:"Roboto",Arial,sans-serif;font-size:32px;font-weight:800;letter-spacing:-1px}
.brand-sub,.datetime,.product,.thead,.rules-title,.rule p,.prices{font-family:"Roboto",Arial,sans-serif}
.gold-mark .bar{background:linear-gradient(135deg,#fffbe0 0%,#f6d65a 24%,#e9ad19 50%,#c77d00 78%,#fff0a0 100%);border:1px solid rgba(176,113,0,.38);box-shadow:0 2px 6px rgba(120,75,0,.17)}
.gold-mark .bar-a{border-radius:4px}
.gold-mark .bar-b{border-radius:4px}
.gold-mark .bar-c{border-radius:4px}
.gold-mark .purity{font-family:"Roboto",Arial,sans-serif;font-weight:900;color:#754700}

</style></head><body><div class="page"><div class="shell">
<header class="header"><div class="brand"><div class="brand-icon"><div class="gold-mark gold-mark-large" aria-hidden="true"><span class="bar bar-a"></span><span class="bar bar-b"></span><span class="bar bar-c"></span><span class="purity">999.9</span></div></div><div><div class="brand-title">Live Gold Rates</div><div class="brand-sub">Market Rates <span class="dot"></span> Your Trusted Source</div></div></div><div class="datetime"><div id="date" class="date">--</div><div class="time"><svg class="hkflag" viewBox="0 0 24 17"><rect width="24" height="17" rx="2" fill="#DE2910"/><path d="M8.4 4.7c-1.9-1-3.7.5-3 2.2.45 1.1 1.7 1.5 2.8.8-1.15.15-1.85-.7-1.55-1.45.28-.67 1.08-.94 1.75-.86Z" fill="#fff"/><circle cx="9.2" cy="5.5" r=".6" fill="#fff"/><circle cx="7.4" cy="4.2" r=".6" fill="#fff"/><circle cx="6.2" cy="6.7" r=".6" fill="#fff"/><circle cx="8.8" cy="7.8" r=".6" fill="#fff"/></svg><span id="time">--:--:-- -- HKT</span></div></div></header>
<main class="main"><section class="card"><div class="cardbar"><div class="gold-heading"><div class="small-gold"><div class="gold-mark" aria-hidden="true"><span class="bar bar-a"></span><span class="bar bar-b"></span><span class="bar bar-c"></span><span class="purity">999.9</span></div></div><span>Gold (999.9)</span></div><div class="trend">⌁</div></div><div class="rates-inner"><div class="thead"><div>Product</div><div>USD Rate / Gram</div></div><div id="rows"></div></div></section>
<section class="card"><div class="rules-title"><span class="info">i</span><span>Booking Rules / Notes</span></div><div class="rules-body"><div class="rule"><span class="rule-num">01</span><p>After checking the live rate, whenever you're ready to confirm a booking, you must write down the <b>required grams</b>.</p></div><div class="rule"><span class="rule-num">02</span><p>Once you send the grams, we will reply with <b>"OK"</b> at that same time, confirming your booking is being processed at that exact moment.</p></div><div class="rule"><span class="rule-num">03</span><p>Right after confirmation, we will send you a <b>screenshot of the rate</b>.</p></div><div class="rule"><span class="rule-num">04</span><p>If your booking is urgent, please <b>call us directly</b> to alert us at the time of booking — WhatsApp messages may sometimes be missed or delayed, so a call ensures immediate confirmation.</p></div></div></section></main>
<div class="bottom-art"><div class="wave1"></div><div class="wave2"></div><svg class="skyline" viewBox="0 0 500 100" preserveAspectRatio="none" aria-hidden="true"><g fill="#72b9e9"><rect x="25" y="64" width="25" height="34"/><rect x="54" y="53" width="23" height="45"/><rect x="82" y="69" width="18" height="29"/><rect x="104" y="42" width="25" height="56"/><rect x="133" y="60" width="22" height="38"/><rect x="160" y="31" width="25" height="67"/><rect x="191" y="52" width="31" height="46"/><rect x="228" y="65" width="18" height="33"/><rect x="252" y="17" width="27" height="81"/><rect x="284" y="57" width="20" height="41"/><rect x="309" y="46" width="31" height="52"/><rect x="346" y="65" width="21" height="33"/><rect x="372" y="36" width="26" height="62"/><rect x="403" y="57" width="24" height="41"/><rect x="433" y="68" width="24" height="30"/><path d="M258 17 266 5l8 12z"/></g></svg></div>
</div></div><script>(()=>{let previousRates=[];function hk(){const p=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Hong_Kong",year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"2-digit",second:"2-digit",hour12:true}).formatToParts(new Date());const g=t=>p.find(x=>x.type===t)?.value||"";return{year:+g("year"),month:+g("month"),day:+g("day"),hour:g("hour"),minute:g("minute"),second:g("second"),dp:g("dayPeriod")}}function clock(){const h=hk(),m=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];document.getElementById("date").textContent=h.day+"-"+m[h.month-1]+"-"+String(h.year).slice(-2);document.getElementById("time").textContent=h.hour+":"+h.minute+":"+h.second+" "+h.dp+" HKT"}async function price(){try{const r=await fetch("/api/price?_="+Date.now(),{cache:"no-store"}),d=await r.json();if(!d.ok)return;const rows=d.rows||[];document.getElementById("rows").innerHTML=rows.map((x,i)=>{if(!x.label)return "";const value=x.rate===null?null:Number(x.rate);const old=previousRates[i];let arrow="";let cls="same";if(value!==null&&old!==undefined&&Number.isFinite(old)){if(value>old){arrow="▲";cls="up"}else if(value<old){arrow="▼";cls="down"}}return '<div class="quote-row"><div class="product-wrap"><div class="product-icon"><div class="gold-mark" aria-hidden="true"><span class="bar bar-a"></span><span class="bar bar-b"></span><span class="bar bar-c"></span><span class="purity">999.9</span></div></div><div class="product">'+escapeHtml(x.label)+'</div></div><div class="prices">'+(arrow?'<span class="rate-arrow '+cls+'">'+arrow+'</span>':"")+(value===null?"---":value.toFixed(2))+'</div></div>'}).join("");previousRates=rows.map(x=>x.rate===null?null:Number(x.rate))}catch(e){}}function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}clock();price();setInterval(clock,1000);setInterval(price,1000)})();</script></body></html>`;
}

function startUpstream(){
  if(!TOKEN){console.log("[RELAY] WFBULLION_TOKEN is missing.");return;}
  console.log("[RELAY] Starting WFBullion connection...");
  console.log("[RELAY] Token present: YES");
  const socket=io(WF_SERVER+"/bquote",{transports:["polling","websocket"],query:{token:TOKEN},reconnection:true,reconnectionAttempts:Infinity,reconnectionDelay:1000,reconnectionDelayMax:5000,timeout:15000,rejectUnauthorized:false,extraHeaders:{Origin:"https://www.wfbullion.com",Referer:"https://www.wfbullion.com/en-us"}});
  socket.on("connect",()=>{latest.connected=true;console.log("[RELAY] WFBullion CONNECTED");console.log("[RELAY] Socket ID: "+socket.id)});
  socket.on("quote.realtime",data=>{const products=data&&data.products;if(!products)return;const xau=products["XAU="];let gramProduct=null;for(const [key,p] of Object.entries(products)){const vals=[key,p&&p.id,p&&p.mf_id,p&&p.prod_code,p&&p.name&&p.name.enUS];if(vals.some(v=>v!=null&&String(v).toLowerCase().replace(/[^a-z0-9]/g,"")==="p1kkgg")){gramProduct=p;break}}if(xau){const bid=parseFloat(xau.buy);if(Number.isFinite(bid))latest.bid=bid}if(gramProduct){const ask=parseFloat(gramProduct.sell);if(Number.isFinite(ask))latest.gramSourceAsk=ask}if(latest.bid!==null)latest.updatedAt=new Date().toISOString()});
  socket.on("disconnect",reason=>{latest.connected=false;console.log("[RELAY] WFBullion DISCONNECTED: "+reason)});
  socket.on("connect_error",e=>{latest.connected=false;console.log("[RELAY] WFBullion CONNECT_ERROR: "+e.message)});
}
server.listen(PORT,"0.0.0.0",()=>{console.log("[RELAY] Server listening on port "+PORT);startUpstream()});

