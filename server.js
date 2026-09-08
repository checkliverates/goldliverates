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
:root{--blue:#0878df;--blue2:#38a4f4;--blue3:#eaf6ff;--navy:#0c3f78;--gold:#d3a21b;--gold2:#f1c84a;--ink:#123d70;--muted:#6683a4;--line:#dcebf8;--up:#16ad73;--down:#ef3e4a;--white:#fff}
*{box-sizing:border-box}html,body{margin:0;padding:0}body{min-height:100vh;background:linear-gradient(180deg,#fafdff 0%,#eef7ff 58%,#f7fbff 100%);font-family:"Trebuchet MS","Segoe UI",Arial,sans-serif;color:var(--ink);padding:14px 10px 24px}.dashboard{width:min(1080px,100%);margin:auto}
/* PREMIUM HEADER */
.hero{position:relative;overflow:hidden;background:linear-gradient(115deg,#fff 0%,#f7fbff 52%,#e5f3ff 100%);border:1px solid #cfe6f8;border-radius:18px;padding:13px 18px;box-shadow:0 10px 28px rgba(30,103,165,.12)}
.hero:before,.hero:after{content:"";position:absolute;pointer-events:none;border-radius:50%;transform:rotate(-18deg)}.hero:before{width:470px;height:210px;right:14%;top:-125px;border:1px solid rgba(34,145,231,.20);box-shadow:105px 25px 0 -1px rgba(34,145,231,.10),190px 48px 0 -1px rgba(211,162,27,.16)}.hero:after{width:360px;height:180px;right:-40px;bottom:-125px;border:1px solid rgba(52,163,239,.14)}
.hero-inner{position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:18px}.brand{display:flex;align-items:center;gap:14px;min-width:0}.gold-logo{width:78px;height:72px;position:relative;display:grid;place-items:center;flex:0 0 auto;filter:drop-shadow(0 8px 9px rgba(205,156,25,.20))}.gold-logo .bar{position:absolute;width:31px;height:20px;border-radius:3px 3px 5px 5px;background:linear-gradient(145deg,#ffe88a 0%,#e4af24 45%,#a86e00 100%);border:1px solid rgba(151,99,0,.25);transform:skewY(-9deg) rotate(-1deg);box-shadow:inset 0 2px 3px rgba(255,255,255,.55)}.gold-logo .b1{left:8px;top:35px}.gold-logo .b2{left:28px;top:24px}.gold-logo .b3{left:47px;top:35px}.gold-logo .b4{left:28px;top:43px}.gold-logo .b5{left:28px;top:7px}.gold-logo .b6{left:9px;top:49px;width:26px}.gold-logo .b7{left:43px;top:49px;width:26px}
.hero-copy{min-width:0}.eyebrow{font-size:11px;letter-spacing:2px;color:#5b83a9;font-weight:900;margin-bottom:1px}.hero-title{display:flex;align-items:center;gap:8px;font-family:"Arial Rounded MT Bold","Trebuchet MS",sans-serif;font-size:clamp(27px,4vw,40px);line-height:1;font-weight:900;letter-spacing:-1.4px;color:#0b4179;margin:3px 0 6px}.title-gold{font-size:.7em;filter:drop-shadow(0 3px 3px rgba(201,151,19,.2))}.tagline{font-size:13px;color:#6682a2;font-weight:600}.hero-right{min-width:222px;background:rgba(255,255,255,.80);border:1px solid #cfe5f7;border-radius:14px;padding:11px 15px;box-shadow:0 6px 16px rgba(44,101,146,.08)}.date{font-size:17px;font-weight:900;color:#153f72}.time-row{display:flex;align-items:center;gap:8px;margin-top:7px;font-size:13px;font-weight:900;color:#17477a}.hk-flag{width:22px;height:15px;display:inline-flex;flex:0 0 auto}.hk-flag svg{width:22px;height:15px;display:block}
/* CONTENT */
.content-grid{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(315px,1fr);gap:14px;margin-top:14px;align-items:start}.panel{background:rgba(255,255,255,.95);border:1px solid #d6e8f7;border-radius:17px;box-shadow:0 10px 27px rgba(31,91,135,.10);overflow:hidden}.panel-head{position:relative;display:flex;align-items:center;gap:11px;background:linear-gradient(110deg,#0875dc 0%,#2997eb 56%,#66baf1 100%);color:#fff;padding:11px 15px;font-size:18px;font-weight:900;letter-spacing:.1px}.panel-head:after{content:"";position:absolute;right:18px;top:8px;width:74px;height:31px;border-top:2px solid rgba(255,255,255,.85);border-right:2px solid transparent;transform:skewX(-25deg) rotate(-9deg);opacity:.85}.panel-icon{width:39px;height:39px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.20);border:1px solid rgba(255,255,255,.42);box-shadow:inset 0 1px 4px rgba(255,255,255,.25);flex:0 0 auto}.mini-gold{width:29px;height:25px;position:relative}.mini-gold i{position:absolute;width:14px;height:9px;border-radius:2px;background:linear-gradient(145deg,#ffe88a,#d89e16,#a86c00);transform:skewY(-10deg)}.mini-gold i:nth-child(1){left:1px;top:11px}.mini-gold i:nth-child(2){left:8px;top:7px}.mini-gold i:nth-child(3){left:15px;top:11px}.mini-gold i:nth-child(4){left:8px;top:1px}.rates-inner{padding:10px 12px 12px}.rate-head{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(170px,.85fr);background:linear-gradient(90deg,#eaf6ff,#f3faff);border:1px solid #d9eaf7;border-radius:10px;color:#174574;padding:10px 13px;font-size:13px;font-weight:900}.rate-head .right{text-align:right}.rate-body{margin-top:2px;border:1px solid #e0edf7;border-radius:10px;overflow:hidden}.quote-row{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(170px,.85fr);align-items:center;min-height:69px;padding:9px 13px;background:linear-gradient(90deg,#fff,#fbfdff)}.quote-row+.quote-row{border-top:1px solid #e4eef7}.quote-row:nth-child(even){background:#fafdff}.product{font-family:"Arial Rounded MT Bold","Trebuchet MS",sans-serif;font-size:15px;font-weight:900;color:#123f73;padding-left:8px}.prices{text-align:right;font-size:clamp(21px,3vw,27px);font-family:"Arial Rounded MT Bold","Trebuchet MS",sans-serif;font-weight:900;white-space:nowrap;letter-spacing:-.6px;color:#0879df;display:flex;align-items:center;justify-content:flex-end;gap:9px}.rate-arrow{font-family:Arial,sans-serif;font-size:17px;font-weight:900;line-height:1}.rate-arrow.up{color:var(--up)}.rate-arrow.down{color:var(--down)}
/* RULES */
.rules-body{padding:9px 12px 12px}.rule{display:grid;grid-template-columns:42px 1fr;gap:11px;padding:11px 3px;border-bottom:1px solid #dfedf8}.rule:last-child{border-bottom:0}.rule-num{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(145deg,#39a3f0,#0874d8);color:#fff;font-size:13px;font-weight:900;box-shadow:0 5px 12px rgba(16,121,215,.18)}.rule p{margin:0;padding-top:2px;color:#4c6c8d;font-size:12.5px;line-height:1.48}.rule b{color:#123f70}
.footer{margin-top:12px;display:flex;justify-content:center;align-items:center;gap:8px;color:#7288a0;font-size:11px;font-weight:700}.footer-dot{width:7px;height:7px;border-radius:50%;background:var(--gold);box-shadow:0 0 0 4px rgba(211,162,27,.10)}
@media(max-width:780px){body{padding:9px 7px 18px}.hero{padding:11px}.hero-inner{gap:12px}.gold-logo{width:65px;height:62px;transform:scale(.88)}.hero-title{font-size:28px}.tagline{font-size:12px}.hero-right{min-width:195px;padding:9px 12px}.date{font-size:16px}.time-row{font-size:12px}.content-grid{grid-template-columns:1fr;gap:11px}.panel-head{padding:10px 13px}.rates-inner,.rules-body{padding:9px}.quote-row{min-height:64px}.product{font-size:14px}.prices{font-size:23px}}
@media(max-width:520px){.hero-inner{flex-direction:column;align-items:stretch}.brand{justify-content:center}.gold-logo{width:60px}.hero-right{width:100%;text-align:center}.time-row{justify-content:center}.content-grid{margin-top:10px}.panel-head{font-size:16px}.rate-head,.quote-row{grid-template-columns:minmax(0,1fr) minmax(130px,.9fr)}.rate-head{font-size:11px;padding:9px 10px}.quote-row{padding:8px 10px;min-height:61px}.product{font-size:13px;padding-left:3px}.prices{font-size:20px;gap:7px}.rule{grid-template-columns:36px 1fr;padding:9px 2px}.rule-num{width:34px;height:34px;font-size:12px}.rule p{font-size:12px}.hero-title{font-size:25px}.eyebrow{font-size:10px}.tagline{font-size:11px}}
@media(max-width:360px){.hero-title{font-size:22px}.date{font-size:15px}.rate-head,.quote-row{grid-template-columns:minmax(0,1fr) minmax(112px,.9fr)}.prices{font-size:18px}.product{font-size:12px}.rule p{font-size:11.5px}}
</style></head><body><main class="dashboard">
<section class="hero"><div class="hero-inner"><div class="brand"><div class="gold-logo" aria-hidden="true"><span class="bar b1"></span><span class="bar b2"></span><span class="bar b3"></span><span class="bar b4"></span><span class="bar b5"></span><span class="bar b6"></span><span class="bar b7"></span></div><div class="hero-copy"><div class="eyebrow">PRECIOUS METAL MARKET</div><div class="hero-title"><span class="title-gold">◆</span>Live Gold Rates</div><div class="tagline">Market Rates&nbsp;&nbsp;•&nbsp;&nbsp;Your Trusted Source</div></div></div><div class="hero-right"><div id="date" class="date">--</div><div class="time-row"><span class="hk-flag" aria-label="Hong Kong"><svg viewBox="0 0 24 17" xmlns="http://www.w3.org/2000/svg" role="img"><rect width="24" height="17" rx="2" fill="#DE2910"/><path d="M8.25 5.1c-1.8-1.2-4 .1-3.35 2.2.45 1.45 2.2 2.05 3.35 1.02-1.5.4-2.55-.85-2.2-1.9.3-.85 1.35-1.25 2.2-1.32Z" fill="#fff"/><circle cx="8.45" cy="6.9" r=".75" fill="#DE2910"/><path d="M10.4 4.1l.9.7-.35 1.1-.9-.7.35-1.1Zm2.2 1.15l1.05-.1.35 1.05-1.05.1-.35-1.05Zm-.15 2.55l.95-.55.75.8-.95.55-.75-.8Zm-1.8 1.05l.25-1.02 1.05-.15-.25 1.02-1.05.15Z" fill="#fff"/></svg></span><span id="time">--:--:-- -- HKT</span></div></div></div></section>
<section class="content-grid"><section class="panel"><div class="panel-head"><span class="panel-icon"><span class="mini-gold"><i></i><i></i><i></i><i></i></span></span><span>Gold (999.9)</span></div><div class="rates-inner"><div class="rate-head"><div>Product</div><div class="right">USD Rate / Gram</div></div><div id="rows" class="rate-body"></div></div></section>
<section class="panel"><div class="panel-head"><span class="panel-icon" style="font-size:22px;font-family:Georgia,serif">i</span><span>Booking Rules / Notes</span></div><div class="rules-body">
<div class="rule"><span class="rule-num">01</span><p>After checking the live rate, whenever you're ready to confirm a booking, you must write down the <b>required grams</b>.</p></div>
<div class="rule"><span class="rule-num">02</span><p>Once you send the grams, we will reply with <b>"OK"</b> at that same time, confirming your booking is being processed at that exact moment.</p></div>
<div class="rule"><span class="rule-num">03</span><p>Right after confirmation, we will send you a <b>screenshot of the rate</b>.</p></div>
<div class="rule"><span class="rule-num">04</span><p>If your booking is urgent, please <b>call us directly</b> to alert us at the time of booking — WhatsApp messages may sometimes be missed or delayed, so a call ensures immediate confirmation.</p></div>
</div></section></section>
<div class="footer"><span class="footer-dot"></span><span>Live market • HKT</span></div>
</main>
<script>(()=>{let previousRates=[];function hk(){const p=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Hong_Kong",year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"2-digit",second:"2-digit",hour12:true}).formatToParts(new Date());const g=t=>p.find(x=>x.type===t)?.value||"";return{year:+g("year"),month:+g("month"),day:+g("day"),hour:g("hour"),minute:g("minute"),second:g("second"),dp:g("dayPeriod")}}function clock(){const h=hk(),m=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];document.getElementById("date").textContent=h.day+"-"+m[h.month-1]+"-"+String(h.year).slice(-2);document.getElementById("time").textContent=h.hour+":"+h.minute+":"+h.second+" "+h.dp+" HKT"}async function price(){try{const r=await fetch("/api/price?_="+Date.now(),{cache:"no-store"}),d=await r.json();if(!d.ok)return;const rows=d.rows||[];document.getElementById("rows").innerHTML=rows.map((x,i)=>{if(!x.label)return "";const value=x.rate===null?null:Number(x.rate);const old=previousRates[i];let arrow="";let cls="same";if(value!==null&&old!==undefined&&Number.isFinite(old)){if(value>old){arrow="▲";cls="up"}else if(value<old){arrow="▼";cls="down"}}return '<div class="quote-row"><div class="product">'+escapeHtml(x.label)+'</div><div class="prices">'+(arrow?'<span class="rate-arrow '+cls+'">'+arrow+'</span>':"")+(value===null?"---":value.toFixed(2))+'</div></div>'}).join("");previousRates=rows.map(x=>x.rate===null?null:Number(x.rate))}catch(e){}}function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}clock();price();setInterval(clock,1000);setInterval(price,1000)})();</script></body></html>`;
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
