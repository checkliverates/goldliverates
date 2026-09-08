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

/* FINAL POLISH — premium bullion mark + refined typography */
body,.brand-sub,.datetime,.product,.thead,.rules-title,.rule p,.prices,.status{font-family:"Aptos","Segoe UI",Inter,Arial,sans-serif}
.brand-title{font-family:"Trebuchet MS","Segoe UI",Arial,sans-serif;font-weight:800;letter-spacing:-1.25px}
.head-title{font-family:"Trebuchet MS","Segoe UI",Arial,sans-serif;font-weight:800;letter-spacing:-.35px}
.prices{font-weight:850;font-variant-numeric:tabular-nums;letter-spacing:-.7px}
.bullion-mark{width:50px;height:42px;display:block;filter:drop-shadow(0 3px 3px rgba(139,88,0,.18))}
.brand-icon .bullion-mark{width:58px;height:50px}
.head-icon .bullion-mark{width:42px;height:36px}
.product-icon .bullion-mark{width:34px;height:30px}
.gold-logo-legacy,.purity-legacy{display:none!important}</style></head><body><div class="box"><h1>Daily Markup Settings</h1><p>These values stay on the server and are not displayed on the client price page.</p><div id="rows"></div><button onclick="save()">Save Markup</button><div id="msg" class="msg"></div></div>
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
return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f4f7fb"><meta name="color-scheme" content="light"><title>Live Gold Rates</title><link rel="icon" href="data:,"><style>
:root{--ink:#102a43;--ink2:#274c6b;--blue:#1677e8;--blue2:#48a4f5;--blue3:#eaf5ff;--gold:#c99219;--gold2:#f4c84a;--gold-soft:#fff8e7;--green:#0ba875;--red:#ef4a55;--line:#dce8f2;--surface:#fff;--bg:#f3f7fb;--shadow:0 18px 45px rgba(24,65,105,.10)}
*{box-sizing:border-box}html,body{margin:0;padding:0}body{min-height:100vh;background:radial-gradient(circle at 12% 0%,#fff 0,#f7fafc 35%,#eef4f8 100%);color:var(--ink);font-family:"Aptos","Segoe UI",Inter,Arial,sans-serif;padding:20px 12px 28px;-webkit-font-smoothing:antialiased}.page{width:min(1120px,100%);margin:auto}.shell{position:relative;overflow:hidden;background:rgba(255,255,255,.82);border:1px solid #dce6ee;border-radius:24px;box-shadow:0 22px 70px rgba(35,69,100,.10);padding:14px}.shell:before{content:"";position:absolute;inset:0;background:linear-gradient(125deg,rgba(255,255,255,.72),rgba(231,243,252,.36) 54%,rgba(255,255,255,.7));pointer-events:none}
/* header */
.header{position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:20px;min-height:118px;padding:20px 22px;border-radius:19px;border:1px solid #cfe4f4;background:linear-gradient(120deg,#ffffff 0%,#f7fbff 46%,#e7f4ff 100%);box-shadow:0 9px 26px rgba(27,111,178,.08);overflow:hidden}.header:after{content:"";position:absolute;right:-7%;top:-72px;width:62%;height:210px;border-radius:50%;border:1px solid rgba(91,171,232,.25);box-shadow:-38px 28px 0 -1px rgba(255,255,255,.75),-78px 57px 0 -1px rgba(111,185,238,.18);transform:rotate(-8deg)}.brand{position:relative;z-index:2;display:flex;align-items:center;gap:18px;min-width:0}.brand-icon{width:74px;height:74px;border-radius:20px;display:grid;place-items:center;background:linear-gradient(145deg,#fff9df,#fff2c5);border:1px solid #f0d88e;box-shadow:inset 0 1px #fff,0 8px 18px rgba(188,133,20,.12);flex:none}.gold-logo-legacy{position:relative;width:50px;height:43px}.gold-logo-legacy .bar{position:absolute;display:block;border:1px solid rgba(132,83,0,.45);background:linear-gradient(145deg,#fff7b4 0%,#f9cf42 28%,#db9409 66%,#a96700 100%);box-shadow:0 3px 4px rgba(121,75,0,.18);border-radius:4px;transform:skewX(-14deg)}.gold-logo-legacy .a{width:34px;height:18px;left:1px;top:22px}.gold-logo-legacy .b{width:34px;height:18px;left:14px;top:10px}.gold-logo-legacy .c{width:27px;height:15px;left:25px;top:27px}.gold-logo-legacy .purity-legacy{position:absolute;z-index:4;left:7px;top:24px;font-size:6px;font-weight:900;letter-spacing:.2px;color:#6e4300;text-shadow:0 1px rgba(255,240,150,.5)}.brand-title{margin:0;color:#0b3f79;font-size:clamp(27px,3.6vw,40px);line-height:1;font-weight:850;letter-spacing:-1.4px}.brand-sub{margin-top:9px;color:#55748f;font-size:13px;font-weight:650;letter-spacing:.15px}.brand-sub .dot{display:inline-block;width:4px;height:4px;margin:0 8px 2px;border-radius:50%;background:var(--gold)}
.datetime{position:relative;z-index:3;min-width:235px;padding:13px 17px;border:1px solid #cfe3f4;border-radius:15px;background:rgba(255,255,255,.78);box-shadow:0 8px 22px rgba(20,105,170,.07);text-align:right}.date{font-size:17px;font-weight:850;color:#0d427d}.time{margin-top:6px;display:flex;justify-content:flex-end;align-items:center;gap:8px;color:#244f78;font-size:13px;font-weight:750}.hkflag{width:24px;height:17px;display:block;filter:drop-shadow(0 1px 1px rgba(0,0,0,.08))}
/* main */
.main{position:relative;z-index:1;display:grid;grid-template-columns:minmax(0,1.42fr) minmax(310px,.86fr);gap:14px;margin-top:14px}.card{min-width:0;background:rgba(255,255,255,.93);border:1px solid #d8e6f0;border-radius:18px;box-shadow:var(--shadow);overflow:hidden}.rate-card{padding:0 10px 10px}.card-head{height:68px;margin:0 -1px 0;display:flex;align-items:center;justify-content:space-between;padding:0 17px;border-radius:17px 17px 12px 12px;background:linear-gradient(110deg,#0f70df,#2c91ec 58%,#62baf3);color:#fff;box-shadow:inset 0 1px rgba(255,255,255,.28)}.head-left{display:flex;align-items:center;gap:12px}.head-icon{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.28);box-shadow:inset 0 1px rgba(255,255,255,.25)}.head-icon .gold-logo-legacy{transform:scale(.72)}.head-title{font-size:19px;font-weight:850;letter-spacing:-.25px}.live-pill{padding:6px 10px;border-radius:999px;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.28);font-size:10px;font-weight:850;letter-spacing:.6px;text-transform:uppercase}.live-dot{display:inline-block;width:6px;height:6px;margin-right:6px;border-radius:50%;background:#b9ffd8;box-shadow:0 0 0 3px rgba(185,255,216,.14)}.trend{width:64px;height:32px;opacity:.9}.trend svg{width:100%;height:100%}
.rates{padding:11px 8px 0}.thead,.quote-row{display:grid;grid-template-columns:minmax(0,1fr) 185px;align-items:center}.thead{min-height:43px;padding:0 14px;border:1px solid #e0edf6;border-radius:11px;background:linear-gradient(180deg,#f2f8fd,#e9f4fc);color:#345a78;font-size:11px;font-weight:850;letter-spacing:.6px;text-transform:uppercase}.thead div:last-child{text-align:right}.quote-row{min-height:78px;padding:8px 14px;border-bottom:1px solid #e6eef4;transition:background .18s ease}.quote-row:last-child{border-bottom:0}.quote-row:hover{background:#fbfdff}.product-wrap{display:flex;align-items:center;gap:13px;min-width:0}.product-icon{width:47px;height:47px;display:grid;place-items:center;flex:none;border-radius:13px;background:linear-gradient(145deg,#fffdf4,#fff4d7);border:1px solid #f0dfb9;box-shadow:inset 0 1px #fff}.product{min-width:0;color:#123e6d;font-size:15px;font-weight:780;letter-spacing:-.15px}.prices{display:flex;align-items:center;justify-content:flex-end;gap:10px;color:#0b77e8;font-size:24px;font-weight:850;letter-spacing:-.8px;font-variant-numeric:tabular-nums}.rate-arrow{font-size:17px;line-height:1}.rate-arrow.up{color:var(--green)}.rate-arrow.down{color:var(--red)}
/* rules */
.rules-card{padding:0 10px 10px}.rules-head{height:68px;display:flex;align-items:center;gap:11px;padding:0 15px;border-radius:17px 17px 12px 12px;background:linear-gradient(110deg,#f7fbff,#e8f4fd);border:1px solid #dcebf5;color:#0c477f}.info{width:39px;height:39px;border-radius:50%;display:grid;place-items:center;flex:none;background:linear-gradient(145deg,#218cf1,#096fdd);color:#fff;font-size:21px;font-weight:900;font-family:Georgia,serif;box-shadow:0 7px 15px rgba(10,116,224,.18)}.rules-title{font-size:17px;font-weight:850;letter-spacing:-.2px}.rules-body{padding:4px 7px}.rule{display:grid;grid-template-columns:43px 1fr;gap:11px;padding:14px 7px;border-bottom:1px solid #e4edf4}.rule:last-child{border-bottom:0}.rule-num{width:39px;height:39px;border-radius:50%;display:grid;place-items:center;background:#eef6ff;border:1px solid #cfe4fa;color:#1179e7;font-size:12px;font-weight:900}.rule p{margin:1px 0 0;color:#385b76;font-size:11.5px;line-height:1.5}.rule b{color:#103f6b;font-weight:850}
/* footer */
.status{position:relative;z-index:1;display:flex;justify-content:center;align-items:center;gap:8px;margin:12px 0 2px;color:#678198;font-size:11px;font-weight:650}.status-dot{width:7px;height:7px;border-radius:50%;background:#18b27c;box-shadow:0 0 0 4px rgba(24,178,124,.10)}
@media(max-width:850px){.main{grid-template-columns:1fr}.rules-card{order:2}.rate-card{order:1}.datetime{min-width:215px}.shell{padding:10px}}
@media(max-width:600px){body{padding:9px}.shell{border-radius:18px;padding:8px}.header{min-height:auto;padding:15px;flex-direction:column;align-items:stretch;gap:12px}.brand{justify-content:center;gap:12px}.brand-icon{width:60px;height:60px;border-radius:17px}.brand-title{font-size:27px;letter-spacing:-1px}.brand-sub{font-size:11px;margin-top:7px}.datetime{width:100%;min-width:0;text-align:center;padding:10px}.time{justify-content:center}.main{gap:10px;margin-top:10px}.card-head,.rules-head{height:59px}.head-title{font-size:17px}.head-icon{width:38px;height:38px}.live-pill{font-size:9px;padding:5px 8px}.trend{width:51px}.rates{padding:9px 4px 0}.thead,.quote-row{grid-template-columns:minmax(0,1fr) 130px}.thead{min-height:39px;padding:0 11px;font-size:10px}.quote-row{min-height:70px;padding:7px 10px}.product-icon{width:42px;height:42px}.product{font-size:13px}.product-wrap{gap:9px}.prices{font-size:21px;gap:8px}.rate-arrow{font-size:15px}.rules-body{padding:2px 4px}.rule{grid-template-columns:39px 1fr;gap:9px;padding:11px 5px}.rule-num{width:35px;height:35px}.rule p{font-size:11px;line-height:1.45}.status{font-size:10px}}
@media(max-width:390px){.brand-title{font-size:23px}.brand-sub{font-size:10px}.thead,.quote-row{grid-template-columns:minmax(0,1fr) 116px}.product{font-size:12px}.prices{font-size:19px}.head-title{font-size:16px}}
</style></head><body><div class="page"><div class="shell">
<header class="header"><div class="brand"><div class="brand-icon"><svg class="bullion-mark" viewBox="0 0 96 72" aria-hidden="true"><defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3a6"/><stop offset=".28" stop-color="#f8c52f"/><stop offset=".62" stop-color="#d88a00"/><stop offset="1" stop-color="#a95b00"/></linearGradient><linearGradient id="g2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff8c8"/><stop offset=".35" stop-color="#ffd94a"/><stop offset=".75" stop-color="#e9a511"/><stop offset="1" stop-color="#b86b00"/></linearGradient></defs><g stroke="#b16a00" stroke-width="1.2" stroke-linejoin="round"><path fill="url(#g1)" d="M8 49 29 37l24 9-21 13Z"/><path fill="url(#g2)" d="M29 37 37 10l24 8-8 28Z"/><path fill="url(#g1)" d="M37 10 60 2l24 9-23 7Z"/><path fill="url(#g2)" d="M53 46 68 28l20 8-16 21Z"/><path fill="url(#g1)" d="M68 28 76 12l20 7-8 17Z"/></g><path d="M42 16 58 11" stroke="rgba(255,255,255,.75)" stroke-width="2.4" stroke-linecap="round"/></svg></div><div><div class="brand-title">Live Gold Rates</div><div class="brand-sub">Market Rates <span class="dot"></span> Your Trusted Source</div></div></div><div class="datetime"><div id="date" class="date">--</div><div class="time"><svg class="hkflag" viewBox="0 0 24 17" aria-label="Hong Kong"><rect width="24" height="17" rx="2" fill="#DE2910"/><path d="M8.4 4.7c-1.9-1-3.7.5-3 2.2.45 1.1 1.7 1.5 2.8.8-1.15.15-1.85-.7-1.55-1.45.28-.67 1.08-.94 1.75-.86Z" fill="#fff"/><circle cx="9.2" cy="5.5" r=".6" fill="#fff"/><circle cx="7.4" cy="4.2" r=".6" fill="#fff"/><circle cx="6.2" cy="6.7" r=".6" fill="#fff"/><circle cx="8.8" cy="7.8" r=".6" fill="#fff"/></svg><span id="time">--:--:-- -- HKT</span></div></div></header>
<main class="main"><section class="card rate-card"><div class="card-head"><div class="head-left"><div class="head-icon"><svg class="bullion-mark" viewBox="0 0 96 72" aria-hidden="true"><defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3a6"/><stop offset=".28" stop-color="#f8c52f"/><stop offset=".62" stop-color="#d88a00"/><stop offset="1" stop-color="#a95b00"/></linearGradient><linearGradient id="g2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff8c8"/><stop offset=".35" stop-color="#ffd94a"/><stop offset=".75" stop-color="#e9a511"/><stop offset="1" stop-color="#b86b00"/></linearGradient></defs><g stroke="#b16a00" stroke-width="1.2" stroke-linejoin="round"><path fill="url(#g1)" d="M8 49 29 37l24 9-21 13Z"/><path fill="url(#g2)" d="M29 37 37 10l24 8-8 28Z"/><path fill="url(#g1)" d="M37 10 60 2l24 9-23 7Z"/><path fill="url(#g2)" d="M53 46 68 28l20 8-16 21Z"/><path fill="url(#g1)" d="M68 28 76 12l20 7-8 17Z"/></g><path d="M42 16 58 11" stroke="rgba(255,255,255,.75)" stroke-width="2.4" stroke-linecap="round"/></svg></div><div class="head-title">Gold (999.9)</div><div class="live-pill"><span class="live-dot"></span>Live</div></div><div class="trend" aria-hidden="true"><svg viewBox="0 0 64 32" fill="none"><path d="M2 26 12 20 20 23 30 12 39 17 50 6 61 9" stroke="rgba(255,255,255,.92)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="61" cy="9" r="2.4" fill="#fff"/></svg></div></div><div class="rates"><div class="thead"><div>Product</div><div>USD Rate / Gram</div></div><div id="rows"></div></div></section>
<section class="card rules-card"><div class="rules-head"><span class="info">i</span><span class="rules-title">Booking Rules / Notes</span></div><div class="rules-body"><div class="rule"><span class="rule-num">01</span><p>After checking the live rate, whenever you're ready to confirm a booking, you must write down the <b>required grams</b>.</p></div><div class="rule"><span class="rule-num">02</span><p>Once you send the grams, we will reply with <b>"OK"</b> at that same time, confirming your booking is being processed at that exact moment.</p></div><div class="rule"><span class="rule-num">03</span><p>Right after confirmation, we will send you a <b>screenshot of the rate</b>.</p></div><div class="rule"><span class="rule-num">04</span><p>If your booking is urgent, please <b>call us directly</b> to alert us at the time of booking — WhatsApp messages may sometimes be missed or delayed, so a call ensures immediate confirmation.</p></div></div></section></main>
<div class="status"><span class="status-dot"></span><span>Prices update automatically</span></div>
</div></div><script>(()=>{let previousRates=[];function hk(){const p=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Hong_Kong",year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"2-digit",second:"2-digit",hour12:true}).formatToParts(new Date());const g=t=>p.find(x=>x.type===t)?.value||"";return{year:+g("year"),month:+g("month"),day:+g("day"),hour:g("hour"),minute:g("minute"),second:g("second"),dp:g("dayPeriod")}}function clock(){const h=hk(),m=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];document.getElementById("date").textContent=h.day+"-"+m[h.month-1]+"-"+String(h.year).slice(-2);document.getElementById("time").textContent=h.hour+":"+h.minute+":"+h.second+" "+h.dp+" HKT"}async function price(){try{const r=await fetch("/api/price?_="+Date.now(),{cache:"no-store"}),d=await r.json();if(!d.ok)return;const rows=d.rows||[];document.getElementById("rows").innerHTML=rows.map((x,i)=>{if(!x.label)return "";const value=x.rate===null?null:Number(x.rate);const old=previousRates[i];let arrow="",cls="same";if(value!==null&&old!==undefined&&Number.isFinite(old)){if(value>old){arrow="▲";cls="up"}else if(value<old){arrow="▼";cls="down"}}return '<div class="quote-row"><div class="product-wrap"><div class="product-icon"><div class="gold-logo" aria-hidden="true"><span class="bar a"></span><span class="bar b"></span><span class="bar c"></span><span class="purity">999.9</span></div></div><div class="product">'+escapeHtml(x.label)+'</div></div><div class="prices">'+(arrow?'<span class="rate-arrow '+cls+'">'+arrow+'</span>':"")+(value===null?"---":value.toFixed(2))+'</div></div>'}).join("");previousRates=rows.map(x=>x.rate===null?null:Number(x.rate))}catch(e){}}function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}clock();price();setInterval(clock,1000);setInterval(price,1000)})();</script></body></html>`;
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

