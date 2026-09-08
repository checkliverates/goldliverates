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
<style>body{font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:30px}.box{max-width:650px;margin:auto;background:#fff;border:1px solid #c59a22;border-radius:18px;padding:25px;box-shadow:0 10px 28px rgba(0,0,0,.08)}h1{margin-top:0}.row{display:grid;grid-template-columns:1fr 150px;gap:12px;margin:12px 0}.row input{padding:12px;border:1px solid #ccc;border-radius:8px;font-size:16px}button{margin-top:15px;padding:12px 22px;border:0;border-radius:9px;background:#c59a22;color:#fff;font-weight:700;font-size:16px;cursor:pointer}.msg{margin-top:15px;font-weight:700}.brand-title,.card-head>span:last-of-type,.product{font-family:"Trebuchet MS","Segoe UI",Arial,sans-serif}
.date-card{font-family:"Trebuchet MS","Segoe UI",Arial,sans-serif}
.card-head>span:last-of-type{letter-spacing:-.25px}
.product{display:flex;align-items:center;gap:9px}
.product::before{content:"Au";flex:0 0 28px;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:radial-gradient(circle at 32% 28%,#fff6a8 0%,#ffd84a 25%,#e9a90b 58%,#b86b00 100%);border:1px solid #c88a08;box-shadow:inset 0 1px 2px rgba(255,255,255,.75),0 2px 5px rgba(135,83,0,.20);color:#7a4700;font:900 10px/1 "Trebuchet MS","Segoe UI",Arial,sans-serif;text-shadow:0 1px rgba(255,239,139,.55)}
.card-head .gold-icon{display:none}
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
return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0d74d5"><title>Live Gold Rates</title>
<style>
:root{--blue:#0b73d1;--blue2:#2196ee;--blue3:#eaf6ff;--blue4:#d9edff;--navy:#103d73;--muted:#6483a3;--line:#dcecf9;--up:#16aa70;--down:#ef3e4d;--gold:#c99818;--paper:#f6fbff;--white:#fff}
*{box-sizing:border-box}html,body{margin:0;padding:0}body{min-height:100vh;background:linear-gradient(180deg,#f8fbff 0%,#eef7ff 100%);font-family:"Trebuchet MS","Segoe UI",Arial,sans-serif;color:var(--navy);padding:10px 8px 22px}.dashboard{width:min(980px,100%);margin:0 auto}
/* compact date + time header */
.top{text-align:center;margin-bottom:10px}.date-card{display:flex;align-items:center;justify-content:center;min-height:58px;background:linear-gradient(180deg,#fff,#f9fcff);border:1px solid #d8a72a;border-radius:12px;box-shadow:0 6px 18px rgba(31,91,140,.09);font-size:clamp(27px,5vw,39px);font-weight:900;letter-spacing:-1.4px;color:#151515}.time-line{height:31px;display:flex;align-items:center;justify-content:center;gap:7px;font-size:14px;font-weight:800;color:#173d67}.hk-flag{width:17px;height:12px;display:inline-flex}.hk-flag svg{width:17px;height:12px;display:block}
/* main panels */
.main-grid{display:grid;grid-template-columns:minmax(0,1.38fr) minmax(280px,.9fr);gap:10px;align-items:start}.card{background:rgba(255,255,255,.97);border:1px solid #d6e8f8;border-radius:13px;box-shadow:0 8px 22px rgba(31,91,140,.10);overflow:hidden}.card-head{display:flex;align-items:center;gap:9px;height:47px;padding:0 12px;background:linear-gradient(110deg,#086ed0 0%,#218de5 55%,#55b0ed 100%);color:#fff;font-size:17px;font-weight:900}.gold-icon{position:relative;width:38px;height:34px;flex:0 0 38px}.gold-icon span{position:absolute;display:block;width:20px;height:13px;border-radius:3px 3px 2px 2px;background:linear-gradient(145deg,#fff2a0,#ffd12d 45%,#d58a00);border:1px solid rgba(123,76,0,.32);box-shadow:0 2px 4px rgba(95,59,0,.18);transform:skew(-14deg)}.gold-icon span:nth-child(1){left:2px;top:15px}.gold-icon span:nth-child(2){left:11px;top:8px}.gold-icon span:nth-child(3){left:19px;top:2px}.head-spark{margin-left:auto;font-size:27px;line-height:1;opacity:.92;transform:rotate(-8deg)}
/* rates table */
.rate-wrap{padding:9px 10px 10px}.rate-head,.quote-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(135px,.72fr);align-items:center}.rate-head{min-height:39px;padding:0 12px;background:linear-gradient(90deg,#edf7ff,#e7f3fc);border-radius:8px;color:#174779;font-size:13px;font-weight:900}.rate-head .right{text-align:right}.rate-body{border:1px solid #e4eff8;border-top:0;border-radius:0 0 8px 8px;overflow:hidden}.quote-row{min-height:59px;padding:7px 12px;background:#fff}.quote-row+.quote-row{border-top:1px solid #e3eef7}.quote-row:nth-child(even){background:#fbfdff}.product{display:flex;align-items:center;gap:9px;font-size:15px;font-weight:800;color:#123e72}
.product::before{content:"";width:30px;height:30px;flex:0 0 30px;border-radius:50%;background:radial-gradient(circle at 32% 28%,#fff8c7 0%,#ffe06a 22%,#f5b51b 52%,#c87900 100%);border:1px solid #d0910b;box-shadow:inset 1px 1px 2px rgba(255,255,255,.85),inset -2px -2px 3px rgba(130,75,0,.22),0 2px 5px rgba(99,65,0,.16);position:relative}
.product::after{content:"Au";width:30px;height:30px;flex:0 0 30px;display:grid;place-items:center;margin-left:-39px;color:#7d4b00;font:900 9px/1 "Trebuchet MS","Segoe UI",Arial,sans-serif;text-shadow:0 1px rgba(255,244,170,.7)}.prices{display:flex;justify-content:flex-end;align-items:center;gap:8px;color:#1376d8;font-size:clamp(20px,3vw,24px);font-weight:900;letter-spacing:-.6px;white-space:nowrap}.rate-arrow{font-size:15px;line-height:1}.rate-arrow.up{color:var(--up)}.rate-arrow.down{color:var(--down)}
/* rules */
.rules{padding:7px 10px 9px}.rule{display:grid;grid-template-columns:37px 1fr;gap:9px;align-items:start;padding:9px 3px;border-bottom:1px solid #e1edf7}.rule:last-child{border-bottom:0}.num{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(145deg,#3aa1f1,#0871d3);color:#fff;font-size:12px;font-weight:900;box-shadow:0 3px 8px rgba(17,113,207,.17)}.rule p{margin:1px 0 0;color:#456987;font-size:12px;line-height:1.48}.rule b{color:#173f69}
.footer{margin-top:8px;text-align:center;color:#7890a8;font-size:11px}.footer-dot{display:inline-block;width:7px;height:7px;margin-right:5px;border-radius:50%;background:var(--gold);vertical-align:1px}
@media(max-width:720px){body{padding:8px 7px 18px}.main-grid{grid-template-columns:1fr}.card-head{height:45px}.quote-row{min-height:58px}.rules{padding-bottom:7px}}
@media(max-width:480px){.date-card{min-height:54px;font-size:29px}.time-line{font-size:13px;height:29px}.main-grid{gap:9px}.rate-wrap{padding:8px}.rate-head,.quote-row{grid-template-columns:minmax(0,1fr) minmax(120px,.78fr)}.rate-head{min-height:36px;font-size:11px;padding:0 9px}.quote-row{min-height:55px;padding:6px 9px}.product{font-size:13px}.product::before,.product::after{width:27px;height:27px;flex-basis:27px}.product::after{margin-left:-36px}.prices{font-size:20px;gap:6px}.rule{grid-template-columns:34px 1fr;gap:8px;padding:8px 2px}.num{width:32px;height:32px;font-size:11px}.rule p{font-size:11.5px;line-height:1.46}}
@media(max-width:340px){.product{font-size:12px}.prices{font-size:18px}.rate-head{font-size:10.5px}}
</style></head><body><main class="dashboard">
<div class="top"><div id="date" class="date-card">--</div><div class="time-line"><span class="hk-flag" aria-label="Hong Kong"><svg viewBox="0 0 24 17" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="17" rx="2" fill="#DE2910"/><path d="M8.25 5.1c-1.8-1.2-4 .1-3.35 2.2.45 1.45 2.2 2.05 3.35 1.02-1.5.4-2.55-.85-2.2-1.9.3-.85 1.35-1.25 2.2-1.32Z" fill="#fff"/><circle cx="8.45" cy="6.9" r=".75" fill="#DE2910"/><path d="M10.4 4.1l.9.7-.35 1.1-.9-.7.35-1.1Zm2.2 1.15 1.05-.1.35 1.05-1.05.1-.35-1.05Zm-.15 2.55.95-.55.75.8-.95.55-.75-.8Zm-1.8 1.05.25-1.02 1.05-.15-.25 1.02-1.05.15Z" fill="#fff"/></svg></span><span id="time">--:--:-- -- HKT</span></div></div>
<section class="main-grid"><section class="card"><div class="card-head"><span class="gold-icon"><span></span><span></span><span></span></span><span>Gold (999.9)</span><span class="head-spark">⌁</span></div><div class="rate-wrap"><div class="rate-head"><div>Product</div><div class="right">USD Rate / Gram</div></div><div id="rows" class="rate-body"></div></div></section>
<section class="card"><div class="card-head"><span class="num" style="background:rgba(255,255,255,.2);box-shadow:none;width:32px;height:32px">i</span><span>Booking Rules</span></div><div class="rules">
<div class="rule"><span class="num">01</span><p>After checking the live rate, whenever you're ready to confirm a booking, you must write down the <b>required grams</b>.</p></div>
<div class="rule"><span class="num">02</span><p>Once you send the grams, we will reply with <b>"OK"</b> at that same time, confirming your booking is being processed at that exact moment.</p></div>
<div class="rule"><span class="num">03</span><p>Right after confirmation, we will send you a <b>screenshot of the rate</b>.</p></div>
<div class="rule"><span class="num">04</span><p>If your booking is urgent, please <b>call us directly</b> to alert us at the time of booking — WhatsApp messages may sometimes be missed or delayed, so a call ensures immediate confirmation.</p></div>
</div></section></section><div class="footer"><span class="footer-dot"></span>Live market • HKT</div></main>
<script>(()=>{let previousRates=[];function hk(){const p=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Hong_Kong",year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"2-digit",second:"2-digit",hour12:true}).formatToParts(new Date());const g=t=>p.find(x=>x.type===t)?.value||"";return{year:+g("year"),month:+g("month"),day:+g("day"),hour:g("hour"),minute:g("minute"),second:g("second"),dp:g("dayPeriod")}}function clock(){const h=hk(),m=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];document.getElementById("date").textContent=h.day+"-"+m[h.month-1]+"-"+String(h.year).slice(-2);document.getElementById("time").textContent=h.hour+":"+h.minute+":"+h.second+" "+h.dp+" HKT"}async function price(){try{const r=await fetch("/api/price?_="+Date.now(),{cache:"no-store"}),d=await r.json();if(!d.ok)return;const rows=d.rows||[];document.getElementById("rows").innerHTML=rows.map((x,i)=>{if(!x.label)return "";const value=x.rate===null?null:Number(x.rate);const old=previousRates[i];let arrow="";let cls="";if(value!==null&&old!==undefined&&Number.isFinite(old)){if(value>old){arrow="▲";cls="up"}else if(value<old){arrow="▼";cls="down"}}return '<div class="quote-row"><div class="product">'+escapeHtml(x.label)+'</div><div class="prices">'+(arrow?'<span class="rate-arrow '+cls+'">'+arrow+'</span>':"")+(value===null?"---":value.toFixed(2))+'</div></div>'}).join("");previousRates=rows.map(x=>x.rate===null?null:Number(x.rate))}catch(e){}}function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}clock();price();setInterval(clock,1000);setInterval(price,1000)})();</script></body></html>`;
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
