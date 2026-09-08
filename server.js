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
<style>body{font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:30px}.box{max-width:650px;margin:auto;background:#fff;border:1px solid #c59a22;border-radius:18px;padding:25px;box-shadow:0 10px 28px rgba(0,0,0,.08)}h1{margin-top:0}.row{display:grid;grid-template-columns:1fr 150px;gap:12px;margin:12px 0}.row input{padding:12px;border:1px solid #ccc;border-radius:8px;font-size:16px}button{margin-top:15px;padding:12px 22px;border:0;border-radius:9px;background:#c59a22;color:#fff;font-weight:700;font-size:16px;cursor:pointer}.msg{margin-top:15px;font-weight:700}</style></head><body><div class="box"><h1>Daily Markup Settings</h1><p>These values stay on the server and are not displayed on the client price page.</p><div id="rows"></div><button onclick="save()">Save Markup</button><div id="msg" class="msg"></div></div>
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
return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#eef7ff"><title>Live Gold Rates</title>
<style>
:root{--navy:#103d73;--blue:#1879dc;--sky:#4eb6f4;--pale:#eef7ff;--line:#d9eafa;--gold:#c99b20;--gold2:#e6bd58;--up:#14ad73;--down:#ed4248;--white:#fff;--muted:#6783a1;--shadow:0 12px 30px rgba(26,87,137,.11)}
*{box-sizing:border-box}html,body{margin:0;padding:0}body{min-height:100vh;background:linear-gradient(180deg,#f8fbfe 0%,#edf5fb 100%);font-family:"Trebuchet MS","Segoe UI",Arial,sans-serif;color:var(--navy);padding:12px}.wrap{width:min(1120px,100%);margin:auto}
.hero{position:relative;overflow:hidden;border:1px solid #cfe5f7;border-radius:18px;background:linear-gradient(118deg,#fff 0%,#f8fcff 53%,#e6f3ff 100%);box-shadow:var(--shadow);padding:15px 18px}.hero:after{content:"";position:absolute;right:-35px;bottom:-115px;width:560px;height:235px;border:1px solid rgba(43,143,224,.18);border-radius:50%;transform:rotate(-8deg);box-shadow:-70px -12px 0 0 rgba(68,166,235,.08),-150px -24px 0 0 rgba(68,166,235,.06)}.hero:before{content:"";position:absolute;right:8%;top:-125px;width:350px;height:220px;border:1px solid rgba(45,142,224,.18);border-radius:50%;transform:rotate(-19deg);box-shadow:85px 25px 0 rgba(45,142,224,.06),155px 54px 0 rgba(201,155,32,.12)}.hero-in{position:relative;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{display:flex;align-items:center;gap:15px}.gold-logo{width:100px;height:78px;display:grid;place-items:center;filter:drop-shadow(0 9px 8px rgba(201,155,32,.22))}.gold-logo svg{width:92px;height:72px}.kicker{font-size:12px;letter-spacing:2px;font-weight:900;color:#6d8aa8}.title{font-size:clamp(29px,4.2vw,43px);line-height:1;font-weight:900;letter-spacing:-1.4px;color:#0d447f;margin:4px 0 7px}.subtitle{font-size:14px;color:#6482a2}.clock-card{min-width:225px;background:rgba(255,255,255,.82);border:1px solid #cfe4f5;border-radius:14px;padding:11px 15px;box-shadow:0 7px 18px rgba(32,89,134,.08)}.clock-top{display:flex;align-items:center;gap:10px}.flag{width:27px;height:19px;flex:0 0 auto}.flag svg{width:27px;height:19px;display:block}.date{font-weight:900;font-size:17px}.clock-time{display:flex;align-items:center;gap:7px;margin-top:8px;font-weight:900;font-size:13px;color:#244c76}.clock-icon{font-size:17px;color:#137ce0}
.grid{display:grid;grid-template-columns:minmax(0,1.62fr) minmax(330px,1fr);gap:14px;margin-top:14px}.card{background:rgba(255,255,255,.95);border:1px solid #d5e7f7;border-radius:17px;box-shadow:var(--shadow);overflow:hidden}.card-head{display:flex;align-items:center;gap:11px;padding:11px 15px;background:linear-gradient(110deg,#1375da,#4db2ed);color:#fff}.head-icon{width:39px;height:39px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);font-size:21px}.head-title{font-size:20px;font-weight:900;letter-spacing:-.2px}.head-badge{margin-left:auto;padding:6px 10px;border-radius:20px;background:rgba(255,255,255,.17);font-size:11px;font-weight:900}.rate-wrap{padding:12px}.rate-head{display:grid;grid-template-columns:1.1fr .9fr;align-items:center;padding:11px 14px;background:linear-gradient(90deg,#edf7ff,#e7f3fd);border-radius:10px;color:#174b7c;font-size:13px;font-weight:900}.rate-head .right{text-align:right}.rows{margin-top:3px}.quote{display:grid;grid-template-columns:1.1fr .9fr;align-items:center;min-height:72px;padding:10px 14px;border-bottom:1px solid #e3eef8}.quote:last-child{border-bottom:0}.quote:hover{background:#fbfdff}.product{display:flex;align-items:center;gap:12px;font-size:16px;font-weight:900;color:#123f72}.product-icon{width:42px;height:42px;flex:0 0 auto;border-radius:10px;display:grid;place-items:center;background:linear-gradient(145deg,#fff8e9,#fff1d6);border:1px solid #f0dfbe;box-shadow:inset 0 1px #fff}.product-icon svg{width:31px;height:28px}.value{display:flex;justify-content:flex-end;align-items:center;gap:10px;color:#0878df;font-size:25px;font-weight:900;letter-spacing:-.7px;white-space:nowrap}.arrow{font-size:17px;line-height:1}.up{color:var(--up)}.down{color:var(--down)}
.rules{padding:11px 13px 12px}.rule{display:grid;grid-template-columns:43px 1fr;gap:11px;align-items:start;padding:12px 5px;border-bottom:1px solid #dfedf8}.rule:last-child{border-bottom:0}.num{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:13px;font-weight:900;background:linear-gradient(145deg,#3a9bf0,#1274d8);box-shadow:0 5px 11px rgba(24,121,220,.18)}.rule p{margin:1px 0 0;font-size:12.5px;line-height:1.48;color:#466b90}.rule b{color:#153f6d}.rule-card .card-head{background:linear-gradient(110deg,#f1f8ff,#e4f1fc);color:#123f72;border-bottom:1px solid #d9eafa}.rule-card .head-icon{background:linear-gradient(145deg,#46a9ed,#1475d5);color:#fff;border:0}.footer{height:52px;display:flex;align-items:center;justify-content:center;gap:9px;color:#6c849d;font-size:12px}.pulse{width:9px;height:9px;border-radius:50%;background:var(--up);box-shadow:0 0 0 5px rgba(20,173,115,.10)}
@media(max-width:800px){body{padding:9px}.hero-in{gap:12px}.gold-logo{width:76px;height:65px}.gold-logo svg{width:72px;height:60px}.title{font-size:31px}.grid{grid-template-columns:1fr}.clock-card{min-width:205px}.head-title{font-size:18px}}
@media(max-width:540px){.hero{padding:13px}.hero-in{flex-direction:column;align-items:stretch}.brand{justify-content:center}.clock-card{width:100%;text-align:center}.clock-top,.clock-time{justify-content:center}.title{text-align:center;font-size:28px}.subtitle{text-align:center}.kicker{text-align:center}.grid{margin-top:10px;gap:10px}.card-head{padding:10px 12px}.head-badge{display:none}.rate-wrap{padding:8px}.rate-head{padding:10px 11px;font-size:11px}.quote{grid-template-columns:1fr .86fr;min-height:64px;padding:8px 7px}.product{font-size:13px;gap:8px}.product-icon{width:38px;height:38px}.product-icon svg{width:28px;height:25px}.value{font-size:21px;gap:7px}.arrow{font-size:15px}.rules{padding:7px 9px}.rule{grid-template-columns:38px 1fr;padding:10px 3px;gap:9px}.num{width:36px;height:36px}.rule p{font-size:11.5px}.footer{height:42px}}
@media(max-width:370px){.title{font-size:25px}.date{font-size:15px}.clock-time{font-size:12px}.product{font-size:12px}.value{font-size:19px}.quote{grid-template-columns:1fr .82fr}.rule p{font-size:11px}}
</style></head><body><main class="wrap">
<section class="hero"><div class="hero-in"><div class="brand"><div class="gold-logo"><svg viewBox="0 0 100 78" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe48b"/><stop offset=".45" stop-color="#e6ad20"/><stop offset="1" stop-color="#a86b00"/></linearGradient></defs><path d="M8 57l25-17 26 8-24 18z" fill="url(#g1)"/><path d="M33 40l7-22 26 8-7 22z" fill="#f1c43e"/><path d="M40 18l18-10 26 8-18 10z" fill="#ffd96b"/><path d="M37 57l25-17 26 8-24 18z" fill="url(#g1)"/><path d="M62 40l7-22 26 8-7 22z" fill="#efc13a"/><path d="M69 18l18-10 13 5-18 10z" fill="#ffe07c"/><path d="M23 37l18-10 25 8-18 11z" fill="#f7cf55"/></svg></div><div><div class="kicker">LIVE MARKET</div><div class="title">Live Gold Rates</div><div class="subtitle">Market rates&nbsp;&nbsp;•&nbsp;&nbsp;Your trusted source</div></div></div><div class="clock-card"><div class="clock-top"><span class="flag"><svg viewBox="0 0 24 17" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="17" rx="2" fill="#DE2910"/><path d="M8.4 3.9c-1.8.5-2.8 2.3-2 3.9.7 1.4 2.5 1.8 3.8.9-1.6.2-2.6-.9-2.3-2 .2-.9 1.1-1.5 2-1.4-.4-.7-.8-1.1-1.5-1.4Z" fill="#fff"/><path d="M11.3 4.2l1 .5-.2 1.1-1-.5.2-1.1Zm2.2 1.1 1-.2.4 1-.9.4-.5-1.2Zm-.1 2.4.9-.5.7.8-.8.7-.8-1Zm-1.7 1.3.1-1 1-.2.2 1-1.3.2Z" fill="#fff"/></svg></span><span id="date" class="date">--</span></div><div class="clock-time"><span class="clock-icon">◷</span><span id="time">--:--:-- -- HKT</span></div></div></div></section>
<section class="grid"><section class="card"><div class="card-head"><span class="head-icon">▥</span><span class="head-title">Gold (999.9)</span><span class="head-badge">LIVE BID</span></div><div class="rate-wrap"><div class="rate-head"><div>Product</div><div class="right">USD Rate / Gram</div></div><div id="rows" class="rows"></div></div></section>
<section class="card rule-card"><div class="card-head"><span class="head-icon">i</span><span class="head-title">Booking Rules / Notes</span></div><div class="rules">
<div class="rule"><span class="num">01</span><p>After checking the live rate, whenever you're ready to confirm a booking, you must write down the <b>required grams</b>.</p></div>
<div class="rule"><span class="num">02</span><p>Once you send the grams, we will reply with <b>"OK"</b> at that same time, confirming your booking is being processed at that exact moment.</p></div>
<div class="rule"><span class="num">03</span><p>Right after confirmation, we will send you a <b>screenshot of the rate</b>.</p></div>
<div class="rule"><span class="num">04</span><p>If your booking is urgent, please <b>call us directly</b> to alert us at the time of booking — WhatsApp messages may sometimes be missed or delayed, so a call ensures immediate confirmation.</p></div>
</div></section></section><div class="footer"><span class="pulse"></span><span>Live market • HKT</span></div></main>
<script>(()=>{let previousRates=[];function hk(){const p=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Hong_Kong",year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"2-digit",second:"2-digit",hour12:true}).formatToParts(new Date());const g=t=>p.find(x=>x.type===t)?.value||"";return{year:+g("year"),month:+g("month"),day:+g("day"),hour:g("hour"),minute:g("minute"),second:g("second"),dp:g("dayPeriod")}}function clock(){const h=hk(),m=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];document.getElementById("date").textContent=h.day+"-"+m[h.month-1]+"-"+String(h.year).slice(-2);document.getElementById("time").textContent=h.hour+":"+h.minute+":"+h.second+" "+h.dp+" HKT"}async function price(){try{const r=await fetch("/api/price?_="+Date.now(),{cache:"no-store"}),d=await r.json();if(!d.ok)return;const rows=d.rows||[];document.getElementById("rows").innerHTML=rows.map((x,i)=>{if(!x.label)return "";const value=x.rate===null?null:Number(x.rate);const old=previousRates[i];let arrow="",cls="";if(value!==null&&old!==undefined&&Number.isFinite(old)){if(value>old){arrow="▲";cls="up"}else if(value<old){arrow="▼";cls="down"}}return '<div class="quote"><div class="product"><span class="product-icon"><svg viewBox="0 0 40 32" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="bar'+i+'" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe69a"/><stop offset=".5" stop-color="#e9ad1f"/><stop offset="1" stop-color="#a76b00"/></linearGradient></defs><path d="M2 24l11-8 12 4-11 9z" fill="url(#bar'+i+')"/><path d="M13 16l3-11 12 4-3 11z" fill="#f3c443"/><path d="M16 5l8-4 12 4-8 5z" fill="#ffe080"/><path d="M15 26l11-8 12 4-11 9z" fill="url(#bar'+i+')"/></svg></span><span>'+escapeHtml(x.label)+'</span></div><div class="value">'+(arrow?'<span class="arrow '+cls+'">'+arrow+'</span>':"")+(value===null?"---":value.toFixed(2))+'</div></div>'}).join("");previousRates=rows.map(x=>x.rate===null?null:Number(x.rate))}catch(e){}}function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}clock();price();setInterval(clock,1000);setInterval(price,1000)})();</script></body></html>`;
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
