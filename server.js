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
return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#edf7ff"><title>Live Gold Rates</title>
<style>
*{box-sizing:border-box}html,body{margin:0;padding:0}body{min-height:100vh;background:radial-gradient(circle at 12% 0%,#fff 0,#f2f8ff 48%,#e7f3ff 100%);font-family:"Segoe UI",Arial,sans-serif;color:#123f70;padding:18px}.wrap{width:min(1080px,100%);margin:auto}.hero{position:relative;overflow:hidden;display:flex;align-items:center;justify-content:space-between;gap:24px;padding:18px 22px;border:1px solid #cfe5f8;border-radius:24px;background:linear-gradient(120deg,#fff 0%,#f8fcff 54%,#e3f2ff 100%);box-shadow:0 14px 35px rgba(25,91,145,.13)}.hero:after{content:"";position:absolute;right:-90px;top:-90px;width:430px;height:260px;border:2px solid rgba(44,145,226,.14);border-radius:50%;transform:rotate(-16deg);box-shadow:-35px 45px 0 rgba(75,166,235,.06),-70px 90px 0 rgba(198,154,29,.08)}.brand{display:flex;align-items:center;gap:18px;position:relative;z-index:1}.gold-icon{width:88px;height:72px;display:grid;place-items:center;font-size:48px;border-radius:22px;background:linear-gradient(145deg,#fff9e5,#e6b22f);box-shadow:0 9px 20px rgba(194,151,25,.22)}.title{font-family:Georgia,"Times New Roman",serif;font-size:clamp(30px,4vw,43px);font-weight:900;letter-spacing:-1.4px;color:#0a4380}.sub{margin-top:4px;font-size:14px;color:#6280a2;letter-spacing:.2px}.clock{position:relative;z-index:1;min-width:230px;padding:13px 17px;border:1px solid #cce3f6;border-radius:17px;background:rgba(255,255,255,.78);box-shadow:0 7px 20px rgba(32,100,151,.08)}.date{font-size:19px;font-weight:900;color:#123f70}.time{margin-top:7px;font-size:14px;font-weight:800;color:#195287}.hk-flag{width:21px;height:15px;vertical-align:-2px}.content{display:grid;grid-template-columns:1.55fr 1fr;gap:18px;margin-top:18px}.card{background:rgba(255,255,255,.9);border:1px solid #d1e6f7;border-radius:21px;box-shadow:0 12px 30px rgba(29,90,135,.11);overflow:hidden}.card-head{display:flex;align-items:center;gap:11px;padding:13px 17px;color:#fff;background:linear-gradient(100deg,#126ed5,#50b2f2);font-size:19px;font-weight:900}.coin{width:39px;height:39px;display:grid;place-items:center;border-radius:50%;background:linear-gradient(145deg,#fff3b6,#d9a323);font-size:22px}.rates{padding:13px}.thead,.quote-row{display:grid;grid-template-columns:1fr 170px;align-items:center}.thead{padding:11px 15px;border-radius:11px;background:linear-gradient(90deg,#e9f5ff,#f5fbff);font-size:13px;font-weight:900;color:#214e7d}.thead div:last-child{text-align:right}.quote-row{min-height:72px;padding:9px 15px;border-bottom:1px solid #e3eef7}.quote-row:last-child{border-bottom:0}.product{font-size:16px;font-weight:800;color:#163f6d}.prices{display:flex;align-items:center;justify-content:flex-end;gap:9px;font-size:27px;font-weight:900;color:#0877dc}.rate-arrow{font-size:16px}.up{color:#13a86c}.down{color:#e74646}.same{color:#a7b0ba}.rules{background:rgba(255,255,255,.9);border:1px solid #d1e6f7;border-radius:21px;box-shadow:0 12px 30px rgba(29,90,135,.11);overflow:hidden}.rules-head{display:flex;align-items:center;gap:11px;padding:13px 17px;background:linear-gradient(90deg,#eef8ff,#dff1ff);font-size:19px;font-weight:900;color:#123f70}.info{width:39px;height:39px;display:grid;place-items:center;border-radius:50%;background:linear-gradient(145deg,#49aaf2,#126dd5);color:#fff;font-weight:900;font-size:22px}.rules-body{padding:8px 16px}.rule{display:grid;grid-template-columns:42px 1fr;gap:12px;padding:14px 2px;border-bottom:1px solid #dfedf8}.rule:last-child{border-bottom:0}.rule-num{width:38px;height:38px;display:grid;place-items:center;border-radius:50%;background:linear-gradient(145deg,#46aaf3,#126fd8);color:#fff;font-size:13px;font-weight:900}.rule p{margin:0;font-size:12.5px;line-height:1.55;color:#496a8b}.rule b{color:#173f6b}.foot{text-align:center;margin-top:13px;color:#7891aa;font-size:11px}@media(max-width:780px){body{padding:10px}.content{grid-template-columns:1fr}.hero{padding:15px}.clock{min-width:210px}.gold-icon{width:70px;height:60px;font-size:38px}.title{font-size:31px}}@media(max-width:520px){.hero{flex-direction:column;align-items:stretch}.brand{justify-content:center}.clock{text-align:center}.content{gap:12px}.thead,.quote-row{grid-template-columns:1fr 145px}.product{font-size:14px}.prices{font-size:22px}.rules-head,.card-head{font-size:16px}.rule p{font-size:12px}}
</style>
</head><body><div class="wrap"><header class="hero"><div class="brand"><div class="gold-icon">🪙</div><div><div class="title">Live Gold Rates</div><div class="sub">Market Rates&nbsp;&nbsp;•&nbsp;&nbsp; Your Trusted Source</div></div></div><div class="clock"><div id="date" class="date">--</div><div class="time"><svg class="hk-flag" viewBox="0 0 24 17"><rect width="24" height="17" rx="2" fill="#DE2910"/><path d="M8.25 5.1c-1.8-1.2-4 .1-3.35 2.2.45 1.45 2.2 2.05 3.35 1.02-1.5.4-2.55-.85-2.2-1.9.3-.85 1.35-1.25 2.2-1.32Z" fill="#fff"/></svg> <span id="time">--:--:-- -- HKT</span></div></div></header><main class="content"><section class="card"><div class="card-head"><span class="coin">🪙</span><span>Gold (999.9)</span></div><div class="rates"><div class="thead"><div>Product</div><div>USD Rate / Gram</div></div><div id="rows"></div></div></section><section class="rules"><div class="rules-head"><span class="info">i</span><span>Booking Rules / Notes</span></div><div class="rules-body">
<div class="rule"><span class="rule-num">01</span><p>After checking the live rate, whenever you're ready to confirm a booking, you must write down the <b>required grams</b>.</p></div>
<div class="rule"><span class="rule-num">02</span><p>Once you send the grams, we will reply with <b>"OK"</b> at that same time, confirming your booking is being processed at that exact moment.</p></div>
<div class="rule"><span class="rule-num">03</span><p>Right after confirmation, we will send you a <b>screenshot of the rate</b>.</p></div>
<div class="rule"><span class="rule-num">04</span><p>If your booking is urgent, please <b>call us directly</b> to alert us at the time of booking — WhatsApp messages may sometimes be missed or delayed, so a call ensures immediate confirmation.</p></div>
</div></section></main><div class="foot">Live market • HKT</div></div><script>(()=>{let previousRates=[];function hk(){const p=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Hong_Kong",year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"2-digit",second:"2-digit",hour12:true}).formatToParts(new Date());const g=t=>p.find(x=>x.type===t)?.value||"";return{year:+g("year"),month:+g("month"),day:+g("day"),hour:g("hour"),minute:g("minute"),second:g("second"),dp:g("dayPeriod")}}function clock(){const h=hk(),m=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];document.getElementById("date").textContent=h.day+"-"+m[h.month-1]+"-"+String(h.year).slice(-2);document.getElementById("time").textContent=h.hour+":"+h.minute+":"+h.second+" "+h.dp+" HKT"}async function price(){try{const r=await fetch("/api/price?_="+Date.now(),{cache:"no-store"}),d=await r.json();if(!d.ok)return;const rows=d.rows||[];document.getElementById("rows").innerHTML=rows.map((x,i)=>{if(!x.label)return "";const value=x.rate===null?null:Number(x.rate);const old=previousRates[i];let arrow="";let cls="same";if(value!==null&&old!==undefined&&Number.isFinite(old)){if(value>old){arrow="▲";cls="up"}else if(value<old){arrow="▼";cls="down"}}return '<div class="quote-row"><div class="product">'+escapeHtml(x.label)+'</div><div class="prices">'+(arrow?'<span class="rate-arrow '+cls+'">'+arrow+'</span>':"")+(value===null?"---":value.toFixed(2))+'</div></div>'}).join("");previousRates=rows.map(x=>x.rate===null?null:Number(x.rate))}catch(e){}}function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}clock();price();setInterval(clock,1000);setInterval(price,1000)})();</script></body></html>`;
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
