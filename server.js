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
<style>body{font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:30px}.box{max-width:650px;margin:auto;background:#fff;border:1px solid #c59a22;border-radius:18px;padding:25px;box-shadow:0 10px 28px rgba(0,0,0,.08)}h1{margin-top:0}.row{display:grid;grid-template-columns:1fr 150px;gap:12px;margin:12px 0}.row input{padding:12px;border:1px solid #ccc;border-radius:8px;font-size:16px}button{margin-top:15px;padding:12px 22px;border:0;border-radius:9px;background:#c59a22;color:#fff;font-weight:700;font-size:16px;cursor:pointer}.msg{margin-top:15px;font-weight:700}
/* DESIGN 03 - Icy Premium */
:root{--blue:#0d72d6;--blue2:#65c4ff;--ink:#143f70;--gold:#cda12c;--line:#d8eaf8}
body{font-family:"Verdana","Segoe UI",Arial,sans-serif;background:#eef7fd;padding:20px 14px 30px}
.dashboard{width:min(1080px,100%)}
.hero{border:1px solid #cfe7f8;border-radius:28px;padding:19px 23px;background:linear-gradient(135deg,#fff 0%,#f7fcff 48%,#e4f4ff 100%);box-shadow:0 18px 38px rgba(21,104,162,.12)}.hero:before{right:12%;top:-145px;width:420px;height:250px;border:2px solid rgba(73,170,235,.12);box-shadow:90px 25px 0 -1px rgba(73,170,235,.08),180px 55px 0 -1px rgba(205,161,44,.12)}
.brand{gap:19px}.brand-mark{width:92px;height:78px;border-radius:50%;background:radial-gradient(circle,#fff9df 0,#f2d27c 55%,#d9a51e 100%);font-size:0;box-shadow:0 10px 20px rgba(201,156,33,.20)}.brand-mark:after{content:"🪙";font-size:47px}.hero-title{font-family:Georgia,"Times New Roman",serif;font-size:clamp(30px,4.2vw,44px);font-weight:900;color:#0b427e}.tagline{font-size:14px;letter-spacing:.2px}.hero-right{min-width:230px;border-radius:19px;background:#fff;border:1px solid #c9e5f8;box-shadow:0 8px 22px rgba(26,103,155,.08)}
.content-grid{grid-template-columns:minmax(0,1.65fr) minmax(315px,1fr);gap:20px;margin-top:20px}.panel{border-radius:23px;border:1px solid #d4e9f8;box-shadow:0 14px 34px rgba(24,91,137,.10)}.panel-head{padding:14px 18px;background:linear-gradient(105deg,#0870da,#5bc1fa);font-size:20px;border-radius:23px 23px 12px 12px}.panel-icon{background:rgba(255,255,255,.30);border:1px solid rgba(255,255,255,.55);font-size:20px}.panel:first-child .panel-icon{font-size:0}.panel:first-child .panel-icon:after{content:"🪙";font-size:21px}.rate-head{border:0;border-radius:12px;background:linear-gradient(90deg,#e7f5ff,#f4fbff);padding:12px 15px;font-size:13px}.rate-body{border:0}.quote-row{min-height:74px;padding:11px 15px;border-bottom:1px solid #e4eff8!important}.quote-row:nth-child(even){background:#fcfeff}.product{font-size:16px;padding-left:35px}.prices{font-size:27px;color:#0878df}.rule{padding:13px 5px}.rule-num{background:linear-gradient(145deg,#4abaff,#0870dc);width:39px;height:39px}.rule p{font-size:12.5px;line-height:1.55}.footer{margin-top:16px}
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
return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f4f8fc"><title>Live Gold Rates</title>
<style>
:root{--blue:#176fd1;--blue2:#43a7ee;--blue3:#eaf5ff;--gold:#c69a1d;--gold2:#e0b33d;--ink:#12345b;--muted:#67809d;--line:#dbeaf7;--up:#18a96b;--down:#e64545;--paper:#f5f9fd;--white:#fff}
*{box-sizing:border-box}html,body{margin:0;padding:0}body{min-height:100vh;background:linear-gradient(180deg,#f8fbff 0,#eef5fb 100%);font-family:"Segoe UI",Arial,sans-serif;color:var(--ink);padding:14px 12px 26px}.dashboard{width:min(1040px,100%);margin:auto}
/* HEADER */
.hero{position:relative;overflow:hidden;background:linear-gradient(120deg,#fff 0%,#f7fbff 62%,#e9f5ff 100%);border:1px solid #cfe5f7;border-radius:16px;padding:14px 18px;box-shadow:0 8px 24px rgba(34,91,140,.10)}.hero:before{content:"";position:absolute;right:18%;top:-120px;width:330px;height:230px;border-radius:50%;border:1px solid rgba(57,155,235,.20);transform:rotate(-17deg);box-shadow:80px 25px 0 -1px rgba(57,155,235,.08),150px 55px 0 -1px rgba(198,154,29,.15);pointer-events:none}.hero-inner{position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:22px}.brand{display:flex;align-items:center;gap:15px}.brand-mark{width:92px;height:70px;display:grid;place-items:center;font-size:50px;filter:drop-shadow(0 8px 9px rgba(198,154,29,.25));color:#d6a51e;text-shadow:12px -7px 0 #f3c957,24px -14px 0 #ffe08a}.eyebrow{font-size:12px;letter-spacing:.8px;color:#55779c;font-weight:700}.hero-title{font-size:clamp(26px,4vw,38px);font-weight:900;letter-spacing:-1.1px;color:#0b4179;margin:2px 0}.tagline{font-size:14px;color:#5d7fa4}.hero-right{min-width:215px;text-align:left;background:rgba(255,255,255,.72);border:1px solid #cfe4f5;border-radius:12px;padding:11px 16px;box-shadow:0 5px 14px rgba(40,95,140,.07)}.date{font-size:18px;font-weight:900}.time-row{display:flex;align-items:center;gap:8px;margin-top:7px;font-size:14px;font-weight:800;color:#183e67}.hk-flag{width:20px;height:14px;display:inline-flex;flex:0 0 auto}.hk-flag svg{width:20px;height:14px;display:block}
/* TWO COLUMN AREA */
.content-grid{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(310px,1fr);gap:14px;margin-top:14px;align-items:start}.panel{background:rgba(255,255,255,.94);border:1px solid #d8e8f6;border-radius:14px;box-shadow:0 9px 25px rgba(35,80,120,.10);overflow:hidden}.panel-head{display:flex;align-items:center;gap:10px;background:linear-gradient(120deg,#1671d5,#53afe9);color:#fff;padding:11px 15px;font-size:17px;font-weight:900}.panel-icon{width:35px;height:35px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.25);border:1px solid rgba(255,255,255,.42);font-size:19px}.rates-inner{padding:10px 12px 12px}.rate-head{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(170px,.85fr);background:linear-gradient(90deg,#edf7ff,#f5faff);border:1px solid #dbeaf6;border-radius:8px 8px 0 0;color:#174a7d;padding:10px 13px;font-size:12px;font-weight:900}.rate-head .right{text-align:right}.rate-body{border:1px solid #e1edf7;border-top:0;border-radius:0 0 8px 8px;overflow:hidden}.quote-row{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(170px,.85fr);align-items:center;min-height:66px;padding:10px 13px;background:#fff}.quote-row+.quote-row{border-top:1px solid #e5eef6}.quote-row:nth-child(even){background:#fbfdff}.product{font-size:15px;font-weight:800;color:#123f6e;padding-left:34px}.prices{text-align:right;font-size:clamp(20px,3vw,25px);font-weight:900;white-space:nowrap;letter-spacing:-.5px;color:#1878d9;display:flex;align-items:center;justify-content:flex-end;gap:8px}.rate-arrow{font-size:15px;font-weight:900;line-height:1}.rate-arrow.up{color:var(--up)}.rate-arrow.down{color:var(--down)}.rate-arrow.same{color:#a3aab4}
/* BOOKING RULES */
.rules-body{padding:10px 12px 12px}.rule{display:grid;grid-template-columns:40px 1fr;gap:10px;padding:10px 4px;border-bottom:1px solid #dfedf7}.rule:last-child{border-bottom:0}.rule-num{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(145deg,#3c9bea,#1874d6);color:#fff;font-size:13px;font-weight:900;box-shadow:0 4px 10px rgba(31,122,211,.18)}.rule p{margin:0;color:#466786;font-size:12px;line-height:1.5}.rule b{color:#173e66}
/* FOOTER */
.footer{margin-top:12px;display:flex;justify-content:center;align-items:center;gap:8px;color:#72869b;font-size:12px}.footer-dot{width:8px;height:8px;border-radius:50%;background:var(--gold);box-shadow:0 0 0 4px rgba(198,154,29,.10)}
@media(max-width:780px){body{padding:9px 7px 20px}.hero{padding:12px}.hero-inner{gap:12px}.brand-mark{width:62px;height:54px;font-size:35px}.hero-title{font-size:27px}.tagline{font-size:12px}.hero-right{min-width:195px;padding:9px 12px}.date{font-size:16px}.time-row{font-size:13px}.content-grid{grid-template-columns:1fr;gap:12px}.panel-head{padding:10px 12px}.rates-inner,.rules-body{padding:9px}.quote-row{min-height:62px}.product{padding-left:26px;font-size:14px}.prices{font-size:22px}.rule{padding:9px 2px}}
@media(max-width:520px){.hero-inner{flex-direction:column;align-items:stretch}.brand{justify-content:center}.hero-right{width:100%;text-align:center}.time-row{justify-content:center}.content-grid{margin-top:10px}.rate-head,.quote-row{grid-template-columns:minmax(0,1fr) minmax(130px,.9fr)}.rate-head{font-size:11px;padding:9px}.quote-row{padding:9px;min-height:58px}.product{font-size:13px;padding-left:8px}.prices{font-size:19px;gap:6px}.panel-head{font-size:15px}.rule{grid-template-columns:36px 1fr}.rule-num{width:34px;height:34px;font-size:12px}.rule p{font-size:12px}.brand-mark{width:54px;font-size:31px}.hero-title{font-size:25px}}
@media(max-width:360px){.hero-title{font-size:22px}.tagline{font-size:11px}.date{font-size:15px}.rate-head,.quote-row{grid-template-columns:minmax(0,1fr) minmax(112px,.9fr)}.prices{font-size:18px}.product{font-size:12px}}
</style></head><body><main class="dashboard">
<section class="hero"><div class="hero-inner"><div class="brand"><div class="brand-mark"></div><div><div class="eyebrow">MARKET RATES</div><div class="hero-title">Live Gold Rates</div><div class="tagline">Your trusted source for live gold pricing</div></div></div><div class="hero-right"><div id="date" class="date">--</div><div class="time-row"><span class="hk-flag" aria-label="Hong Kong"><svg viewBox="0 0 24 17" xmlns="http://www.w3.org/2000/svg" role="img"><rect width="24" height="17" rx="2" fill="#DE2910"/><path d="M8.25 5.1c-1.8-1.2-4 .1-3.35 2.2.45 1.45 2.2 2.05 3.35 1.02-1.5.4-2.55-.85-2.2-1.9.3-.85 1.35-1.25 2.2-1.32Z" fill="#fff"/><circle cx="8.45" cy="6.9" r=".75" fill="#DE2910"/><path d="M10.4 4.1l.9.7-.35 1.1-.9-.7.35-1.1Zm2.2 1.15l1.05-.1.35 1.05-1.05.1-.35-1.05Zm-.15 2.55l.95-.55.75.8-.95.55-.75-.8Zm-1.8 1.05l.25-1.02 1.05-.15-.25 1.02-1.05.15Z" fill="#fff"/></svg></span><span id="time">--:--:-- -- HKT</span></div></div></div></section>
<section class="content-grid"><section class="panel"><div class="panel-head"><span class="panel-icon"></span><span>Gold (999.9)</span></div><div class="rates-inner"><div class="rate-head"><div>Product</div><div class="right">USD Rate / Gram</div></div><div id="rows" class="rate-body"></div></div></section>
<section class="panel"><div class="panel-head"><span class="panel-icon">i</span><span>Booking Rules</span></div><div class="rules-body">
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
