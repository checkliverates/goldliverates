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
<style>body{font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:30px}.box{max-width:650px;margin:auto;background:#fff;border:1px solid #c59a22;border-radius:18px;padding:25px;box-shadow:0 10px 28px rgba(0,0,0,.08)}h1{margin-top:0}.row{display:grid;grid-template-columns:1fr 150px;gap:12px;margin:12px 0}.row input{padding:12px;border:1px solid #ccc;border-radius:8px;font-size:16px}button{margin-top:15px;padding:12px 22px;border:0;border-radius:9px;background:#c59a22;color:#fff;font-weight:700;font-size:16px;cursor:pointer}.msg{margin-top:15px;font-weight:700}.lightning,.bolt,.zap,.lightning-symbol{display:none!important}
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
return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#eef8ff"><title>Live Gold Rates</title><link rel="icon" href="data:,"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
:root{--navy:#073d7a;--blue:#0878e8;--blue2:#58baf4;--sky:#edf8ff;--line:#d9ebfa;--green:#16b878;--red:#ff3e49}
*{box-sizing:border-box}html,body{margin:0;padding:0}body{min-height:100vh;background:#f3faff;color:var(--navy);font-family:Arial,Helvetica,sans-serif;padding:18px 8px;overflow-x:hidden}.page{width:min(1000px,100%);margin:0 auto}.shell{position:relative;border:1px solid #dbe8f1;background:linear-gradient(180deg,#fff 0%,#f8fcff 100%);min-height:650px;overflow:hidden;box-shadow:0 1px 0 rgba(0,60,120,.04)}
.header{margin:14px 14px 13px;border:1px solid #cfe7fa;border-radius:13px;background:linear-gradient(106deg,#0a4d9a 0%,#0875df 48%,#35a8ef 100%);height:108px;display:flex;align-items:center;justify-content:space-between;padding:14px 15px 14px 25px;position:relative;overflow:hidden;box-shadow:0 5px 16px rgba(20,104,176,.12)}.header:before{content:"";position:absolute;width:58%;height:190px;right:7%;top:-112px;border-radius:50%;background:linear-gradient(145deg,rgba(88,190,247,.24),rgba(255,255,255,0));transform:rotate(-16deg)}.header:after{content:"";position:absolute;width:46%;height:100px;right:11%;bottom:-65px;border-radius:50%;border-top:2px solid rgba(255,224,128,.62);transform:rotate(-10deg)}.brand{display:flex;align-items:center;gap:14px;position:relative;z-index:2}.brand-icon{width:100px;height:92px;display:grid;place-items:center;flex:none}.gold-mark{position:relative;width:45px;height:40px;display:block;flex:none}.gold-mark-large{width:112px;height:92px}.gold-mark{position:relative;width:45px;height:45px;display:block;flex:none;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff8a8 0%,#ffd84d 24%,#d99608 62%,#9b5c00 100%);border:2px solid #f5c43a;box-shadow:inset 0 0 0 2px rgba(255,245,170,.45),0 3px 7px rgba(93,55,0,.25)}.gold-mark:before{content:"";position:absolute;inset:5px;border:1px solid rgba(122,72,0,.55);border-radius:50%}.gold-mark:after{content:"999.9";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:8px;line-height:1;color:#744900;font-weight:900;white-space:nowrap}.gold-mark .bar,.gold-mark .purity{display:none}.gold-mark-large{width:92px;height:92px}.gold-mark-large:before{inset:8px}.gold-mark-large:after{font-size:13px}.gold-mark-large .bar,.gold-mark-large .purity{display:none}.brand-title{font-size:38px;line-height:1.02;font-weight:700;letter-spacing:-1.2px;color:#fff}.brand-sub{display:none}.dot{display:none}.datetime{position:relative;z-index:3;width:205px;background:rgba(255,255,255,.97);border:1px solid #d4e9f9;border-radius:8px;padding:11px 13px;box-shadow:0 3px 12px rgba(0,55,110,.14)}.date{font-size:17px;font-weight:800;text-align:center;color:#0c3d79}.time{font-size:13px;font-weight:700;text-align:center;margin-top:9px;white-space:nowrap;color:#173f70}.hkflag{width:22px;height:16px;vertical-align:-3px;margin-right:7px}
.main{display:grid;grid-template-columns:1.7fr 1fr;gap:13px;margin:0 14px;position:relative;z-index:2}.card{background:rgba(255,255,255,.97);border:1px solid #cfe6f7;border-radius:10px;box-shadow:0 4px 13px rgba(45,112,160,.08);overflow:hidden}.cardbar{height:55px;padding:0 20px;display:flex;align-items:center;justify-content:space-between;color:white;background:linear-gradient(100deg,#0b65c7 0%,#157fe2 58%,#38a7ef 100%);position:relative}.gold-heading{display:flex;align-items:center;gap:12px;font-size:21px;font-weight:800}.small-gold{width:48px;height:43px;display:grid;place-items:center}.trend{font-size:38px;font-weight:300;line-height:1;opacity:.92;z-index:1;transform:rotate(-8deg)}.rates-inner{padding:13px 15px 9px}.thead{height:42px;border-radius:8px;background:linear-gradient(180deg,#eaf6ff,#e2f1fc);display:grid;grid-template-columns:1fr 145px;align-items:center;padding:0 16px;font-size:13px;font-weight:800;color:#123f78}.thead div:last-child{text-align:right}.quote-row{min-height:79px;display:grid;grid-template-columns:1fr 145px;align-items:center;padding:9px 16px;border-bottom:1px solid #dfedf7}.quote-row:last-child{border-bottom:0}.product-wrap{display:flex;align-items:center;gap:14px}.product-icon{width:49px;height:49px;border-radius:9px;background:linear-gradient(145deg,#fffaf0,#fff0d7);border:1px solid #f0e2cc;display:grid;place-items:center;flex:none}.product{font-size:16px;font-weight:800;color:#123e79;white-space:nowrap}.prices{display:flex;justify-content:flex-end;align-items:center;gap:9px;font-size:25px;font-weight:800;color:#0879e8}.rate-arrow{font-size:18px;font-weight:900}.up{color:var(--green)}.down{color:var(--red)}
.rules-title{height:55px;background:linear-gradient(180deg,#edf8ff,#e4f3fc);display:flex;align-items:center;gap:11px;padding:0 15px;font-size:20px;font-weight:800;color:#0d3d76;border-bottom:1px solid #d9ebf8}.info{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(145deg,#2295f2,#0675e1);color:#fff;font-size:21px;font-weight:800}.rules-body{padding:6px 14px 8px}.rule{display:grid;grid-template-columns:44px 1fr;gap:10px;padding:14px 0;border-bottom:1px solid #dcebf6}.rule:last-child{border-bottom:0}.rule-num{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(145deg,#2294f0,#0674df);color:#fff;font-size:14px;font-weight:800}.rule p{margin:2px 0 0;font-size:12px;line-height:1.52;color:#244e7c}.rule b{color:#0b3d76}
.bottom-art{height:105px;margin-top:8px;position:relative;overflow:hidden}.wave1,.wave2{position:absolute;left:-5%;width:110%;height:88px;border-radius:50% 50% 0 0/100% 100% 0 0;bottom:-52px;transform:rotate(3deg)}.wave1{background:linear-gradient(180deg,rgba(91,183,240,.18),rgba(91,183,240,.33))}.wave2{bottom:-67px;transform:rotate(-4deg);background:linear-gradient(180deg,rgba(183,225,249,.28),rgba(183,225,249,.44))}.skyline{position:absolute;bottom:1px;left:50%;transform:translateX(-50%);width:min(430px,62%);height:75px;opacity:.4}
@media(max-width:820px){body{padding:10px 7px}.header{height:auto;min-height:126px}.brand-title{font-size:34px}.main{grid-template-columns:1fr}.datetime{width:210px}}
@media(max-width:600px){.header{margin:10px 7px;padding:11px;min-height:150px;flex-direction:column;align-items:stretch;gap:8px}.brand{justify-content:center;gap:10px}.brand-icon{width:62px;height:62px}.gold-mark-large{width:62px;height:62px}.gold-mark-large:before{inset:6px}.gold-mark-large:after{font-size:9px}.gold-mark-large .bar,.gold-mark-large .purity{display:none}.brand-title{font-size:25px;letter-spacing:-.5px}.brand-sub{display:none}.datetime{width:100%;padding:8px}.date{font-size:15px}.time{font-size:12px}.main{margin:0 7px;gap:10px}.cardbar{height:55px;padding:0 12px}.gold-heading{font-size:18px}.small-gold{width:43px;height:43px}.rates-inner{padding:10px}.thead{grid-template-columns:1fr 125px;padding:0 12px;font-size:12px}.quote-row{grid-template-columns:1fr 125px;min-height:69px;padding:8px 11px}.product-wrap{gap:9px}.product-icon{width:42px;height:42px}.gold-mark{width:34px;height:34px}.gold-mark:before{inset:4px}.gold-mark:after{font-size:6px}.gold-mark .bar,.gold-mark .purity{display:none}.product{font-size:13px}.prices{font-size:20px;gap:6px}.rate-arrow{font-size:16px}.rules-title{height:55px;font-size:17px;padding:0 12px}.info{width:34px;height:34px;font-size:19px}.rule{grid-template-columns:38px 1fr;gap:8px;padding:11px 0}.rule-num{width:35px;height:35px;font-size:12px}.rule p{font-size:11px;line-height:1.48}.bottom-art{height:70px}.skyline{width:75%;height:56px}}
@media(max-width:390px){.brand-title{font-size:23px}.brand-sub{font-size:10px}.product{font-size:12px}.prices{font-size:18px}.thead,.quote-row{grid-template-columns:1fr 112px}}
</style></style></head><body><div class="page"><div class="shell">
<header class="header"><div class="brand"><div class="brand-icon"><div class="gold-mark gold-mark-large" aria-hidden="true"><span class="bar bar-a"></span><span class="bar bar-b"></span><span class="bar bar-c"></span><span class="purity">999.9</span></div></div><div><div class="brand-title">Gold (999.9)</div></div></div><div class="datetime"><div id="date" class="date">--</div><div class="time"><svg class="hkflag" viewBox="0 0 24 17"><rect width="24" height="17" rx="2" fill="#DE2910"/><path d="M8.4 4.7c-1.9-1-3.7.5-3 2.2.45 1.1 1.7 1.5 2.8.8-1.15.15-1.85-.7-1.55-1.45.28-.67 1.08-.94 1.75-.86Z" fill="#fff"/><circle cx="9.2" cy="5.5" r=".6" fill="#fff"/><circle cx="7.4" cy="4.2" r=".6" fill="#fff"/><circle cx="6.2" cy="6.7" r=".6" fill="#fff"/><circle cx="8.8" cy="7.8" r=".6" fill="#fff"/></svg><span id="time">--:--:-- -- HKT</span></div></div></header>
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

