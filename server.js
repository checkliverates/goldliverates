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
return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f6fbff"><title>Live Gold Rates</title>
<style>
:root{--blue:#1476e8;--blue2:#51b4ef;--blue3:#eaf6ff;--ink:#0b3e79;--muted:#52739a;--line:#d9eaf8;--gold:#c79b1d;--up:#16ad72;--down:#f13b3b;--white:#fff}
*{box-sizing:border-box}html,body{margin:0;padding:0}body{min-height:100vh;background:#f8fbfe;color:var(--ink);font-family:"Segoe UI",Arial,sans-serif;padding:10px 8px 18px}.dashboard{width:min(1000px,100%);margin:0 auto;position:relative;overflow:hidden}
.hero{height:112px;position:relative;overflow:hidden;background:linear-gradient(100deg,#fff 0%,#f8fcff 55%,#e9f5ff 100%);border:1px solid #d6e8f7;border-radius:12px;box-shadow:0 5px 16px rgba(34,94,145,.09);display:flex;align-items:center;padding:12px 20px}.hero:after{content:"";position:absolute;right:-20px;top:-85px;width:580px;height:190px;border-radius:50%;border:1px solid rgba(54,150,232,.20);transform:rotate(-14deg);box-shadow:-35px 20px 0 0 rgba(54,150,232,.07),-110px 55px 0 0 rgba(54,150,232,.07),-185px 87px 0 0 rgba(199,155,29,.16);pointer-events:none}.hero-inner{position:relative;z-index:2;width:100%;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{display:flex;align-items:center;gap:17px}.gold-logo{width:102px;height:78px;display:grid;place-items:center;flex:0 0 auto}.gold-logo svg{width:100%;height:100%;filter:drop-shadow(0 7px 7px rgba(180,126,7,.18))}.hero-title{font-size:clamp(28px,4vw,35px);line-height:1;font-weight:900;letter-spacing:-1px;color:#0b3f79;margin:0 0 8px}.tagline{font-size:14px;color:#50739d}.tagline b{color:#2c5d91}.hero-right{min-width:236px;background:rgba(255,255,255,.80);border:1px solid #cfe3f5;border-radius:11px;padding:10px 16px;box-shadow:0 4px 12px rgba(45,97,140,.06);text-align:left}.date{font-size:16px;font-weight:900;color:#123f76}.time-row{display:flex;align-items:center;gap:9px;margin-top:7px;font-size:13px;font-weight:800;color:#183e67}.hk-flag{width:20px;height:14px;display:inline-flex;flex:0 0 auto}.hk-flag svg{width:20px;height:14px;display:block}
.content-grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(330px,1fr);gap:14px;margin-top:13px;position:relative;z-index:2}.panel{background:rgba(255,255,255,.97);border:1px solid #d9eaf8;border-radius:12px;box-shadow:0 6px 18px rgba(30,91,141,.09);overflow:hidden}.panel-head{height:62px;display:flex;align-items:center;gap:12px;background:linear-gradient(110deg,#0d73eb 0%,#3199ee 55%,#68c0ef 100%);color:#fff;padding:9px 16px;font-size:21px;font-weight:900}.panel-icon{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.20);border:1px solid rgba(255,255,255,.30);overflow:hidden}.panel-icon svg{width:31px;height:31px}.panel-title{white-space:nowrap}.trend{margin-left:auto;width:75px;height:40px}.trend svg{width:100%;height:100%}
.rates-inner{padding:11px 12px 12px}.rate-head{display:grid;grid-template-columns:minmax(0,1fr) 175px;background:linear-gradient(90deg,#eaf5fd,#f1f8fe);border-radius:8px;padding:11px 14px;color:#17487c;font-size:13px;font-weight:900}.rate-head .right{text-align:right}.rate-body{overflow:hidden}.quote-row{display:grid;grid-template-columns:minmax(0,1fr) 175px;align-items:center;min-height:74px;padding:10px 14px;border-bottom:1px solid #e4eef7;background:#fff}.quote-row:last-child{border-bottom:0}.product{font-size:15px;font-weight:800;color:#103e73;padding-left:70px;white-space:nowrap}.prices{text-align:right;font-size:24px;font-weight:900;color:#1779e5;white-space:nowrap;display:flex;align-items:center;justify-content:flex-end;gap:10px}.rate-arrow{font-size:17px;line-height:1;font-weight:900}.rate-arrow.up{color:var(--up)}.rate-arrow.down{color:var(--down)}
.product-icon{position:absolute;left:18px;width:52px;height:46px;border-radius:10px;background:linear-gradient(145deg,#fffaf0,#fff3de);border:1px solid #f1e5cf;display:grid;place-items:center;overflow:hidden}.product-wrap{position:relative;display:flex;align-items:center}.product-icon svg{width:40px;height:38px}
.rules-body{padding:10px 14px 12px}.rule{display:grid;grid-template-columns:48px 1fr;gap:12px;padding:9px 2px 13px;border-bottom:1px solid #e0edf7}.rule:last-child{border-bottom:0}.rule-num{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(145deg,#318fe9,#0d72df);color:#fff;font-size:14px;font-weight:900}.rule p{margin:0;padding-top:2px;color:#0f447e;font-size:12px;line-height:1.48}.rule b{color:#083b74}
.bottom-art{height:92px;margin-top:0;position:relative;overflow:hidden;z-index:1}.bottom-art:before{content:"";position:absolute;left:-8%;right:-8%;bottom:-46px;height:105px;border-radius:50%;background:rgba(117,196,244,.20);transform:rotate(2deg)}.bottom-art:after{content:"";position:absolute;left:-12%;right:45%;bottom:-63px;height:115px;border-radius:50%;background:rgba(117,196,244,.14);transform:rotate(-7deg)}.skyline{position:absolute;bottom:0;left:31%;width:42%;height:82px;opacity:.24}.skyline svg{width:100%;height:100%}
@media(max-width:780px){body{padding:8px 6px 14px}.hero{height:auto;min-height:116px;padding:12px}.hero-inner{gap:10px}.gold-logo{width:78px;height:64px}.hero-title{font-size:28px}.tagline{font-size:12px}.hero-right{min-width:210px;padding:9px 12px}.content-grid{grid-template-columns:1fr;gap:11px}.panel-head{height:58px;font-size:19px}.trend{width:66px}.product{padding-left:58px}.quote-row{min-height:68px}.prices{font-size:23px}.bottom-art{height:60px}.skyline{left:25%;width:50%;height:62px}}
@media(max-width:560px){.hero{padding:10px}.hero-inner{flex-direction:column;align-items:stretch}.brand{justify-content:center}.hero-right{width:100%;text-align:center}.time-row{justify-content:center}.content-grid{margin-top:10px}.rate-head,.quote-row{grid-template-columns:minmax(0,1fr) 135px}.rate-head{font-size:12px}.quote-row{min-height:64px;padding:8px 10px}.product{font-size:13px;padding-left:52px}.prices{font-size:20px;gap:7px}.product-icon{left:7px;width:42px;height:40px}.product-icon svg{width:32px;height:31px}.rule{grid-template-columns:43px 1fr;gap:9px}.rule-num{width:40px;height:40px}.rule p{font-size:11.5px}.bottom-art{display:none}}
@media(max-width:370px){.hero-title{font-size:24px}.tagline{font-size:11px}.date{font-size:15px}.rate-head,.quote-row{grid-template-columns:minmax(0,1fr) 116px}.product{font-size:12px}.prices{font-size:18px}.panel-head{font-size:17px}.trend{display:none}}
</style></head><body><main class="dashboard">
<section class="hero"><div class="hero-inner"><div class="brand"><div class="gold-logo"><svg viewBox="0 0 120 90" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe58a"/><stop offset=".35" stop-color="#f4b91f"/><stop offset="1" stop-color="#b87400"/></linearGradient><linearGradient id="g2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0a9"/><stop offset=".45" stop-color="#f5c331"/><stop offset="1" stop-color="#c17b00"/></linearGradient></defs><g stroke="#c88708" stroke-width="1"><path fill="url(#g1)" d="M7 61 36 47l28 14-29 16Z"/><path fill="url(#g2)" d="M36 47V67l28 14V61Z"/><path fill="url(#g1)" d="M7 61V42l29-14 28 14v19L36 75Z" opacity=".15"/><path fill="url(#g1)" d="M35 47 64 33l28 14-29 15Z"/><path fill="url(#g2)" d="M64 33v20l28 14V47Z"/><path fill="url(#g1)" d="M35 47V29L64 15l28 18v14L64 62Z" opacity=".15"/><path fill="url(#g1)" d="M47 30 67 20l21 10-21 11Z"/><path fill="url(#g2)" d="M67 20v15l21 10V30Z"/><path fill="url(#g1)" d="M47 30V15L67 5l21 10v15L67 40Z" opacity=".18"/></g></svg></div><div><div class="hero-title">Live Gold Rates</div><div class="tagline">Market Rates&nbsp;&nbsp;•&nbsp;&nbsp; Your Trusted Source</div></div></div><div class="hero-right"><div id="date" class="date">--</div><div class="time-row"><span class="hk-flag" aria-label="Hong Kong"><svg viewBox="0 0 24 17" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="17" rx="2" fill="#DE2910"/><path d="M8.25 5.1c-1.8-1.2-4 .1-3.35 2.2.45 1.45 2.2 2.05 3.35 1.02-1.5.4-2.55-.85-2.2-1.9.3-.85 1.35-1.25 2.2-1.32Z" fill="#fff"/><circle cx="8.45" cy="6.9" r=".75" fill="#DE2910"/><path d="M10.4 4.1l.9.7-.35 1.1-.9-.7.35-1.1Zm2.2 1.15l1.05-.1.35 1.05-1.05.1-.35-1.05Zm-.15 2.55l.95-.55.75.8-.95.55-.75-.8Zm-1.8 1.05l.25-1.02 1.05-.15-.25 1.02-1.05.15Z" fill="#fff"/></svg></span><span id="time">--:--:-- -- HKT</span></div></div></div></section>
<section class="content-grid"><section class="panel"><div class="panel-head"><span class="panel-icon"><svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="pg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffe58a"/><stop offset=".45" stop-color="#f4b91f"/><stop offset="1" stop-color="#b87400"/></linearGradient></defs><path fill="url(#pg)" d="M3 27 14 21l11 6-11 6Z"/><path fill="url(#pg)" d="M14 21v8l11 6v-8Z"/><path fill="url(#pg)" d="M13 21 25 15l11 6-11 6Z"/><path fill="url(#pg)" d="M25 15v8l11 6v-8Z"/><path fill="url(#pg)" d="M18 14 27 9l9 5-9 5Z"/><path fill="url(#pg)" d="M27 9v7l9 5v-6Z"/></svg></span><span class="panel-title">Gold (999.9)</span><span class="trend"><svg viewBox="0 0 80 45" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 39c8-2 11-15 18-12 7 3 8-12 15-10 7 2 9-12 16-8 5 3 8-8 13-7" stroke="white" stroke-width="2" stroke-linecap="round"/><path d="m62 3 3 0-1 5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="65" cy="5" r="2.2" fill="white"/></svg></span></div><div class="rates-inner"><div class="rate-head"><div>Product</div><div class="right">USD Rate / Gram</div></div><div id="rows" class="rate-body"></div></div></section>
<section class="panel"><div class="panel-head" style="background:linear-gradient(110deg,#f8fcff,#eaf5fd);color:#0b3e79;border-bottom:1px solid #d9eaf8"><span class="panel-icon" style="background:linear-gradient(145deg,#3c9ced,#0d72df);border:0;color:#fff;font-size:23px;font-weight:900">i</span><span class="panel-title">Booking Rules / Notes</span></div><div class="rules-body">
<div class="rule"><span class="rule-num">01</span><p>After checking the live rate, whenever you're ready to confirm a booking, you must write down the <b>required grams</b>.</p></div>
<div class="rule"><span class="rule-num">02</span><p>Once you send the grams, we will reply with <b>"OK"</b> at that same time, confirming your booking is being processed at that exact moment.</p></div>
<div class="rule"><span class="rule-num">03</span><p>Right after confirmation, we will send you a <b>screenshot of the rate</b>.</p></div>
<div class="rule"><span class="rule-num">04</span><p>If your booking is urgent, please <b>call us directly</b> to alert us at the time of booking — WhatsApp messages may sometimes be missed or delayed, so a call ensures immediate confirmation.</p></div>
</div></section></section>
<div class="bottom-art"><div class="skyline"><svg viewBox="0 0 500 100" xmlns="http://www.w3.org/2000/svg" fill="#6cbcf0"><path d="M0 94h500v6H0zM28 94V72h18v22H28Zm24 0V56h12v38H52Zm18 0V66h20v28H70Zm26 0V44h14v50H96Zm19 0V70h18v24h-18Zm23 0V60h13v34h-13Zm18 0V50h19v44h-19Zm25 0V34h15v60h-15Zm20 0V59h12v35h-12Zm18 0V25h18v69h-18Zm24 0V48h14v46h-14Zm19 0V68h20v26h-20Zm25 0V54h14v40h-14Zm19 0V38h17v56h-17Zm22 0V62h13v32h-13Zm18 0V52h20v42h-20Zm26 0V72h12v22h-12Zm18 0V61h14v33h-14Z"/><path d="M201 22h4v72h-4zM199 28h8l-4-10zM310 38h4v56h-4zM308 44h8l-4-10z"/></svg></div></div>
</main><script>(()=>{let previousRates=[];function hk(){const p=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Hong_Kong",year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"2-digit",second:"2-digit",hour12:true}).formatToParts(new Date());const g=t=>p.find(x=>x.type===t)?.value||"";return{year:+g("year"),month:+g("month"),day:+g("day"),hour:g("hour"),minute:g("minute"),second:g("second"),dp:g("dayPeriod")}}function clock(){const h=hk(),m=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];document.getElementById("date").textContent=h.day+"-"+m[h.month-1]+"-"+String(h.year).slice(-2);document.getElementById("time").textContent=h.hour+":"+h.minute+":"+h.second+" "+h.dp+" HKT"}async function price(){try{const r=await fetch("/api/price?_="+Date.now(),{cache:"no-store"}),d=await r.json();if(!d.ok)return;const rows=d.rows||[];document.getElementById("rows").innerHTML=rows.map((x,i)=>{if(!x.label)return "";const value=x.rate===null?null:Number(x.rate);const old=previousRates[i];let arrow="";let cls="same";if(value!==null&&old!==undefined&&Number.isFinite(old)){if(value>old){arrow="▲";cls="up"}else if(value<old){arrow="▼";cls="down"}}return '<div class="quote-row"><div class="product-wrap"><span class="product-icon"><svg viewBox="0 0 50 44" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="rowg'+i+'" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffe58a"/><stop offset=".45" stop-color="#f4b91f"/><stop offset="1" stop-color="#b87400"/></linearGradient></defs><path fill="url(#rowg'+i+')" d="M3 31 17 23l14 8-14 8Z"/><path fill="url(#rowg'+i+')" d="M17 23v10l14 8V31Z"/><path fill="url(#rowg'+i+')" d="M15 22 30 14l14 8-15 8Z"/><path fill="url(#rowg'+i+')" d="M30 14v10l14 8v-10Z"/><path fill="url(#rowg'+i+')" d="M21 14 31 8l10 6-10 6Z"/><path fill="url(#rowg'+i+')" d="M31 8v8l10 6v-8Z"/></svg></span><span class="product">'+escapeHtml(x.label)+'</span></div><div class="prices">'+(arrow?'<span class="rate-arrow '+cls+'">'+arrow+'</span>':"")+(value===null?"---":value.toFixed(2))+'</div></div>'}).join("");previousRates=rows.map(x=>x.rate===null?null:Number(x.rate))}catch(e){}}function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}clock();price();setInterval(clock,1000);setInterval(price,1000)})();</script></body></html>`;
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
