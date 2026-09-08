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
return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#eef6ff"><title>Live Gold Rates</title>
<style>:root{--blue:#176fd1;--blue2:#4ba9ef;--navy:#0d3f78;--pale:#edf7ff;--gold:#d2a62a;--ink:#173f68;--muted:#6b86a0;--line:#d8e8f6;--up:#18a96b;--down:#e04444}*{box-sizing:border-box}html,body{margin:0}body{min-height:100vh;padding:20px 14px 30px;font-family:"Trebuchet MS","Segoe UI",Arial,sans-serif;color:var(--ink);background:linear-gradient(135deg,#fafdff,#edf6fd)}.wrap{width:min(1040px,100%);margin:auto}.top{background:#fff;border:1px solid #cfe3f4;border-radius:24px;padding:22px 24px;box-shadow:0 12px 32px rgba(31,91,139,.11);position:relative;overflow:hidden}.top:after{content:"";position:absolute;width:280px;height:280px;border-radius:50%;right:-120px;top:-170px;border:32px solid #edf7ff}.topin{position:relative;z-index:1;display:flex;justify-content:space-between;align-items:center;gap:22px}.brand{display:flex;align-items:center;gap:17px}.goldmark{width:74px;height:64px;position:relative}.goldmark i{position:absolute;display:block;width:48px;height:16px;border-radius:4px;background:linear-gradient(#ffe7a0,#c99922);box-shadow:0 4px 8px rgba(190,145,29,.2);transform:skewY(-7deg)}.goldmark i:nth-child(1){left:2px;top:35px}.goldmark i:nth-child(2){left:13px;top:24px}.goldmark i:nth-child(3){left:25px;top:13px}.kicker{font-size:11px;letter-spacing:2px;font-weight:900;color:#5c84a9}.title{font-family:Georgia,serif;font-size:clamp(30px,5vw,44px);font-weight:700;color:#0c4d8e;line-height:1.05;margin:4px 0}.sub{font-size:13px;color:#7891a9}.clock{min-width:210px;background:linear-gradient(145deg,#f7fbff,#eef7ff);border:1px solid #d1e5f5;border-radius:17px;padding:13px 16px}.date{font-weight:900;font-size:18px;color:#123f70}.tm{display:flex;align-items:center;gap:8px;margin-top:7px;font-size:13px;font-weight:900}.flag{width:22px;height:15px}.flag svg{width:22px;height:15px;display:block}.grid{display:grid;grid-template-columns:1.45fr 1fr;gap:16px;margin-top:16px}.card{background:#fff;border:1px solid #d3e5f3;border-radius:20px;box-shadow:0 10px 28px rgba(34,83,126,.10);overflow:hidden}.cardhead{padding:14px 17px;background:linear-gradient(110deg,#126ed0,#57b0ec);color:#fff;display:flex;align-items:center;gap:10px;font-size:18px;font-weight:900}.coin{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.5);color:#ffe18a;font-size:20px}.rates{padding:14px}.thead,.row{display:grid;grid-template-columns:1.1fr .9fr;align-items:center}.thead{background:#eef7ff;color:#24567f;border:1px solid #d8e8f4;padding:11px 14px;font-size:12px;font-weight:900}.thead div:last-child{text-align:right}.tbody{border:1px solid #dceaf5;border-top:0;border-radius:0 0 12px 12px;overflow:hidden}.row{min-height:72px;padding:11px 14px;background:#fff}.row:nth-child(even){background:#f9fcff}.row+.row{border-top:1px solid #e5eef6}.product{font-size:16px;font-weight:900;color:#174876;padding-left:9px}.prices{display:flex;justify-content:flex-end;align-items:center;gap:8px;color:#1272d2;font-size:27px;font-weight:900}.rate-arrow{font-size:16px}.up{color:var(--up)}.down{color:var(--down)}.rules{padding:13px 15px}.rule{display:grid;grid-template-columns:38px 1fr;gap:10px;padding:11px 2px;border-bottom:1px solid #e2edf6}.rule:last-child{border-bottom:0}.num{width:36px;height:36px;border-radius:11px;background:#eaf5ff;color:#1773d2;display:grid;place-items:center;font-weight:900;font-size:11px;border:1px solid #cfe6f8}.rule p{margin:0;font-size:12px;line-height:1.55;color:#536f89}.rule b{color:#164673}.foot{text-align:center;margin-top:13px;font-size:11px;color:#7890a7}.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#d2a62a;margin-right:6px}@media(max-width:760px){body{padding:10px 7px 20px}.top{padding:16px;border-radius:18px}.topin{flex-direction:column;align-items:stretch}.brand{justify-content:center}.clock{text-align:center}.tm{justify-content:center}.grid{grid-template-columns:1fr;gap:12px;margin-top:12px}.cardhead{font-size:16px}.row{min-height:62px}.product{font-size:14px}.prices{font-size:22px}.title{font-size:32px}}@media(max-width:430px){.brand{gap:11px}.goldmark{width:58px;transform:scale(.82);transform-origin:left center}.title{font-size:27px}.sub{font-size:11px}.thead,.row{grid-template-columns:1fr 1fr}.product{padding-left:2px;font-size:13px}.prices{font-size:19px;gap:5px}.rule{grid-template-columns:34px 1fr}.num{width:32px;height:32px}.rule p{font-size:11.5px}}</style></head><body><main class="wrap"><section class="top"><div class="topin"><div class="brand"><div class="goldmark"><i></i><i></i><i></i></div><div><div class="kicker">PRECIOUS METAL PRICING</div><div class="title">Live Gold Rates</div><div class="sub">Live market rates • Hong Kong</div></div></div><div class="clock"><div id="date" class="date">--</div><div class="tm"><span class="flag"><svg viewBox="0 0 24 17"><rect width="24" height="17" rx="2" fill="#DE2910"/><path d="M8.2 5.1c-1.8-1.2-4 .1-3.3 2.2.4 1.4 2.2 2.1 3.3 1-1.4.4-2.5-.8-2.2-1.9.3-.8 1.4-1.2 2.2-1.3Z" fill="#fff"/><circle cx="8.4" cy="6.9" r=".75" fill="#DE2910"/><path d="m10.4 4.1.9.7-.35 1.1-.9-.7.35-1.1Zm2.2 1.15 1.05-.1.35 1.05-1.05.1-.35-1.05Zm-.15 2.55.95-.55.75.8-.95.55-.75-.8Zm-1.8 1.05.25-1.02 1.05-.15-.25 1.02-1.05.15Z" fill="#fff"/></svg></span><span id="time">--:--:-- -- HKT</span></div></div></div></section><section class="grid"><section class="card"><div class="cardhead"><span class="coin">✦</span>Gold (999.9)</div><div class="rates"><div class="thead"><div>Product</div><div>Rate / Gram</div></div><div id="rows" class="tbody"></div></div></section><section class="card"><div class="cardhead"><span class="coin">✓</span>Booking Rules</div><div class="rules"><div class="rule"><span class="num">01</span><p>After checking the live rate, whenever you're ready to confirm a booking, you must write down the <b>required grams</b>.</p></div>
<div class="rule"><span class="num">02</span><p>Once you send the grams, we will reply with <b>"OK"</b> at that same time, confirming your booking is being processed at that exact moment.</p></div>
<div class="rule"><span class="num">03</span><p>Right after confirmation, we will send you a <b>screenshot of the rate</b>.</p></div>
<div class="rule"><span class="num">04</span><p>If your booking is urgent, please <b>call us directly</b> to alert us at the time of booking — WhatsApp messages may sometimes be missed or delayed, so a call ensures immediate confirmation.</p></div></div></section></section><div class="foot"><span class="dot"></span>Live market • HKT</div></main><script>(()=>{let previousRates=[];function hk(){const p=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Hong_Kong",year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"2-digit",second:"2-digit",hour12:true}).formatToParts(new Date());const g=t=>p.find(x=>x.type===t)?.value||"";return{year:+g("year"),month:+g("month"),day:+g("day"),hour:g("hour"),minute:g("minute"),second:g("second"),dp:g("dayPeriod")}}function clock(){const h=hk(),m=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];document.getElementById("date").textContent=h.day+"-"+m[h.month-1]+"-"+String(h.year).slice(-2);document.getElementById("time").textContent=h.hour+":"+h.minute+":"+h.second+" "+h.dp+" HKT"}async function price(){try{const r=await fetch("/api/price?_="+Date.now(),{cache:"no-store"}),d=await r.json();if(!d.ok)return;const rows=d.rows||[];document.getElementById("rows").innerHTML=rows.map((x,i)=>{if(!x.label)return "";const value=x.rate===null?null:Number(x.rate);const old=previousRates[i];let arrow="";let cls="same";if(value!==null&&old!==undefined&&Number.isFinite(old)){if(value>old){arrow="▲";cls="up"}else if(value<old){arrow="▼";cls="down"}}return '<div class="quote-row"><div class="product">'+escapeHtml(x.label)+'</div><div class="prices">'+(arrow?'<span class="rate-arrow '+cls+'">'+arrow+'</span>':"")+(value===null?"---":value.toFixed(2))+'</div></div>'}).join("");previousRates=rows.map(x=>x.rate===null?null:Number(x.rate))}catch(e){}}function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}clock();price();setInterval(clock,1000);setInterval(price,1000)})();</script></body></html>`;
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
