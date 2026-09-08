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
return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f3f8fd"><title>Live Gold Rates</title>
<style>
:root{--blue:#1674d8;--blue2:#55b5ef;--blue3:#eaf5ff;--ink:#0b3970;--muted:#55779b;--line:#d8e8f6;--up:#18b878;--down:#f0444d;--gold:#c89c1f;--paper:#f4f9fd;--white:#fff}
*{box-sizing:border-box}html,body{margin:0;padding:0}body{min-height:100vh;background:linear-gradient(180deg,#f8fbfe 0%,#edf5fb 100%);font-family:"Trebuchet MS","Segoe UI",Arial,sans-serif;color:var(--ink);padding:10px 9px 18px}.dashboard{width:min(1000px,100%);margin:auto}
.hero{position:relative;overflow:hidden;background:linear-gradient(115deg,#fff 0%,#f9fcff 55%,#e6f4ff 100%);border:1px solid #d4e7f7;border-radius:14px;padding:10px 18px;box-shadow:0 7px 20px rgba(30,83,132,.09)}.hero:before{content:"";position:absolute;right:16%;top:-112px;width:370px;height:235px;border-radius:50%;border:1px solid rgba(48,147,232,.18);transform:rotate(-14deg);box-shadow:82px 27px 0 -1px rgba(48,147,232,.10),158px 57px 0 -1px rgba(200,156,31,.16);pointer-events:none}.hero:after{content:"";position:absolute;left:43%;bottom:-92px;width:330px;height:155px;border-radius:50%;border-top:1px solid rgba(51,151,235,.16);transform:rotate(-13deg);pointer-events:none}.hero-inner{position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{display:flex;align-items:center;gap:14px}.gold-bars{position:relative;width:106px;height:70px;flex:0 0 106px}.gold-bars i{position:absolute;display:block;width:43px;height:22px;border-radius:3px 3px 8px 8px;background:linear-gradient(135deg,#ffe58b 0%,#e0a51b 55%,#a87300 100%);transform:skew(-17deg);box-shadow:0 5px 7px rgba(182,128,0,.22)}.gold-bars i:nth-child(1){left:13px;top:38px}.gold-bars i:nth-child(2){left:39px;top:27px}.gold-bars i:nth-child(3){left:64px;top:38px}.gold-bars i:nth-child(4){left:25px;top:20px}.gold-bars i:nth-child(5){left:51px;top:9px}.gold-bars i:nth-child(6){left:38px;top:45px;opacity:.9}.hero-title{font-size:clamp(28px,4vw,38px);font-weight:900;letter-spacing:-1px;color:#0c3f78;margin:0}.tagline{font-size:14px;color:#5c7da0;margin-top:2px}.hero-right{min-width:224px;background:rgba(255,255,255,.72);border:1px solid #cfe4f5;border-radius:11px;padding:9px 14px;box-shadow:0 5px 14px rgba(40,95,140,.06)}.date{font-size:17px;font-weight:900}.time-row{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:13px;font-weight:800;color:#173f68}.hk-flag{width:20px;height:14px;display:inline-flex;flex:0 0 auto}.hk-flag svg{width:20px;height:14px;display:block}
.content-grid{display:grid;grid-template-columns:minmax(0,1.62fr) minmax(310px,1fr);gap:12px;margin-top:12px;align-items:start}.panel{background:rgba(255,255,255,.95);border:1px solid #d6e7f5;border-radius:13px;box-shadow:0 8px 22px rgba(35,80,120,.09);overflow:hidden}.panel-head{display:flex;align-items:center;gap:10px;background:linear-gradient(115deg,#1373d7,#56b6ee);color:#fff;padding:9px 13px;font-size:19px;font-weight:900;min-height:58px}.panel-icon{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.38);font-size:20px}.rates-inner{padding:10px 11px 11px}.rate-head{display:grid;grid-template-columns:minmax(0,1.12fr) minmax(165px,.88fr);background:linear-gradient(90deg,#edf7ff,#f5faff);border:1px solid #dceaf6;border-radius:8px;color:#174575;padding:10px 14px;font-size:13px;font-weight:900}.rate-head .right{text-align:right}.rate-body{border:1px solid #e1edf7;border-top:0;border-radius:0 0 8px 8px;overflow:hidden}.quote-row{display:grid;grid-template-columns:minmax(0,1.12fr) minmax(165px,.88fr);align-items:center;min-height:73px;padding:9px 14px;background:#fff}.quote-row+.quote-row{border-top:1px solid #e2edf6}.quote-row:nth-child(even){background:#fbfdff}.product{font-size:15px;font-weight:900;color:#123f70;padding-left:30px}.prices{text-align:right;font-size:clamp(22px,3vw,27px);font-weight:900;white-space:nowrap;color:#1679dd;display:flex;align-items:center;justify-content:flex-end;gap:10px}.rate-arrow{font-size:18px;font-weight:900;line-height:1}.rate-arrow.up{color:var(--up)}.rate-arrow.down{color:var(--down)}
.rules-body{padding:8px 11px 10px}.rule{display:grid;grid-template-columns:42px 1fr;gap:10px;padding:10px 4px;border-bottom:1px solid #dfedf7}.rule:last-child{border-bottom:0}.rule-num{width:39px;height:39px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(145deg,#3b9cf0,#1773d5);color:#fff;font-size:13px;font-weight:900;box-shadow:0 4px 10px rgba(31,122,211,.16)}.rule p{margin:0;color:#3d6387;font-size:12.5px;line-height:1.48}.rule b{color:#143e68}
.footer{height:92px;margin-top:7px;position:relative;overflow:hidden;border-radius:0 0 13px 13px;background:linear-gradient(180deg,transparent 0%,rgba(225,241,253,.35) 100%)}.footer:before{content:"";position:absolute;left:-8%;right:-8%;bottom:10px;height:75px;border-radius:50% 50% 0 0/55% 55% 0 0;background:linear-gradient(175deg,rgba(110,190,242,.16),rgba(110,190,242,.05));transform:rotate(-2deg)}.footer:after{content:"";position:absolute;left:28%;right:28%;bottom:4px;height:48px;background:linear-gradient(90deg,transparent 0 5%,rgba(90,173,232,.18) 5% 9%,transparent 9% 12%,rgba(90,173,232,.16) 12% 17%,transparent 17% 20%,rgba(90,173,232,.2) 20% 25%,transparent 25% 28%,rgba(90,173,232,.15) 28% 34%,transparent 34% 38%,rgba(90,173,232,.2) 38% 43%,transparent 43% 47%,rgba(90,173,232,.17) 47% 53%,transparent 53% 57%,rgba(90,173,232,.2) 57% 62%,transparent 62% 67%,rgba(90,173,232,.16) 67% 72%,transparent 72% 76%,rgba(90,173,232,.18) 76% 83%,transparent 83% 100%);clip-path:polygon(0 100%,0 70%,5% 70%,5% 45%,9% 45%,9% 65%,15% 65%,15% 28%,20% 28%,20% 60%,26% 60%,26% 40%,32% 40%,32% 70%,38% 70%,38% 25%,43% 25%,43% 55%,49% 55%,49% 35%,54% 35%,54% 62%,61% 62%,61% 18%,66% 18%,66% 52%,72% 52%,72% 30%,78% 30%,78% 64%,84% 64%,84% 42%,90% 42%,90% 70%,100% 70%,100% 100%)}
@media(max-width:780px){body{padding:8px 7px 14px}.hero{padding:10px 12px}.brand{gap:9px}.gold-bars{width:70px;flex-basis:70px;transform:scale(.72);transform-origin:left center;margin-right:-17px}.hero-title{font-size:28px}.tagline{font-size:12px}.hero-right{min-width:198px;padding:8px 11px}.content-grid{grid-template-columns:1fr;gap:10px}.panel-head{min-height:53px;padding:8px 12px;font-size:18px}.quote-row{min-height:68px}.prices{font-size:24px}.rule{padding:9px 3px}}
@media(max-width:520px){.hero-inner{flex-direction:column;align-items:stretch}.brand{justify-content:center}.hero-right{width:100%;text-align:center}.time-row{justify-content:center}.content-grid{margin-top:9px}.rate-head,.quote-row{grid-template-columns:minmax(0,1fr) minmax(125px,.85fr)}.rate-head{font-size:11px;padding:9px}.quote-row{padding:8px 9px;min-height:61px}.product{font-size:13px;padding-left:7px}.prices{font-size:20px;gap:7px}.panel-head{font-size:16px}.rule{grid-template-columns:36px 1fr}.rule-num{width:34px;height:34px}.rule p{font-size:11.8px}.footer{height:45px}.gold-bars{width:54px;flex-basis:54px;transform:scale(.58);margin-right:-22px}.hero-title{font-size:25px}}
@media(max-width:360px){.hero-title{font-size:22px}.tagline{font-size:11px}.date{font-size:15px}.rate-head,.quote-row{grid-template-columns:minmax(0,1fr) minmax(112px,.82fr)}.prices{font-size:18px}.product{font-size:12px}}
</style></head><body><main class="dashboard">
<section class="hero"><div class="hero-inner"><div class="brand"><div class="gold-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div><div><div class="hero-title">Live Gold Rates</div><div class="tagline">Market Rates &nbsp;•&nbsp; Your Trusted Source</div></div></div><div class="hero-right"><div id="date" class="date">--</div><div class="time-row"><span class="hk-flag" aria-label="Hong Kong"><svg viewBox="0 0 24 17" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="17" rx="2" fill="#DE2910"/><path d="M8.25 5.1c-1.8-1.2-4 .1-3.35 2.2.45 1.45 2.2 2.05 3.35 1.02-1.5.4-2.55-.85-2.2-1.9.3-.85 1.35-1.25 2.2-1.32Z" fill="#fff"/><circle cx="8.45" cy="6.9" r=".75" fill="#DE2910"/><path d="M10.4 4.1l.9.7-.35 1.1-.9-.7.35-1.1Zm2.2 1.15l1.05-.1.35 1.05-1.05.1-.35-1.05Zm-.15 2.55l.95-.55.75.8-.95.55-.75-.8Zm-1.8 1.05l.25-1.02 1.05-.15-.25 1.02-1.05.15Z" fill="#fff"/></svg></span><span id="time">--:--:-- -- HKT</span></div></div></div></section>
<section class="content-grid"><section class="panel"><div class="panel-head"><span class="panel-icon">▥</span><span>Gold (999.9)</span></div><div class="rates-inner"><div class="rate-head"><div>Product</div><div class="right">USD Rate / Gram</div></div><div id="rows" class="rate-body"></div></div></section>
<section class="panel"><div class="panel-head"><span class="panel-icon">i</span><span>Booking Rules / Notes</span></div><div class="rules-body">
<div class="rule"><span class="rule-num">01</span><p>Offers above <b>30,000</b> are welcome. We will review the daily flow and decide.</p></div>
<div class="rule"><span class="rule-num">02</span><p>This is our buying rate.</p></div>
<div class="rule"><span class="rule-num">03</span><p>Prices are subject to availability. Please confirm stock availability with us before locking the deal.</p></div>
<div class="rule"><span class="rule-num">04</span><p>After 7:30 PM HKT, prices are not live — please confirm and block before proceeding.</p></div>
</div></section></section>
<div class="footer" aria-hidden="true"></div>
</main>
<script>(()=>{let previousRates=[];function hk(){const p=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Hong_Kong",year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"2-digit",second:"2-digit",hour12:true}).formatToParts(new Date());const g=t=>p.find(x=>x.type===t)?.value||"";return{year:+g("year"),month:+g("month"),day:+g("day"),hour:g("hour"),minute:g("minute"),second:g("second"),dp:g("dayPeriod")}}function clock(){const h=hk(),m=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];document.getElementById("date").textContent=h.day+" "+m[h.month-1]+" "+String(h.year);document.getElementById("time").textContent=h.hour+":"+h.minute+":"+h.second+" "+h.dp+" HKT"}async function price(){try{const r=await fetch("/api/price?_="+Date.now(),{cache:"no-store"}),d=await r.json();if(!d.ok)return;const rows=d.rows||[];document.getElementById("rows").innerHTML=rows.map((x,i)=>{if(!x.label)return "";const value=x.rate===null?null:Number(x.rate);const old=previousRates[i];let arrow="",cls="";if(value!==null&&old!==undefined&&Number.isFinite(old)){if(value>old){arrow="▲";cls="up"}else if(value<old){arrow="▼";cls="down"}}return '<div class="quote-row"><div class="product">'+escapeHtml(x.label)+'</div><div class="prices">'+(arrow?'<span class="rate-arrow '+cls+'">'+arrow+'</span>':"")+(value===null?"---":value.toFixed(2))+'</div></div>'}).join("");previousRates=rows.map(x=>x.rate===null?null:Number(x.rate))}catch(e){}}function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}clock();price();setInterval(clock,1000);setInterval(price,1000)})();</script></body></html>`;
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
