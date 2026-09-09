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

@media(max-width:600px){.header.header-datetime-only{margin:8px 5px 10px!important;padding:0 12px!important;height:82px!important;min-height:82px!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;border-radius:11px!important}.header.header-datetime-only .datetime{width:auto!important;min-width:0!important;padding:0!important;background:transparent!important;border:0!important;box-shadow:none!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important}.header.header-datetime-only .date{font-size:27px!important;line-height:1!important;font-weight:800!important;color:#fff!important}.header.header-datetime-only .time{font-size:12px!important;line-height:1!important;margin-top:6px!important;color:#fff!important}.header.header-datetime-only .hkflag{width:19px!important;height:13px!important;margin-right:5px!important}.main{margin:0 5px!important;gap:9px!important}.cardbar{height:52px!important}.small-gold{width:44px!important;height:42px!important}.gold-mark{width:39px!important;height:32px!important}.gold-mark:before{left:4px!important;top:6px!important;width:30px!important;height:18px!important}.gold-mark:after{left:19px!important;top:15px!important;font-size:5.5px!important}.gold-heading{font-size:17px!important;gap:8px!important}.product-icon{width:42px!important;height:42px!important}.product-icon:after{font-size:6.5px!important}.product-wrap{gap:9px!important}.product{font-size:13px!important}.prices{font-size:19px!important}.rate-arrow{font-size:15px!important}.thead,.quote-row{grid-template-columns:1fr 112px!important}}
@media(max-width:390px){.header.header-datetime-only{height:76px!important;min-height:76px!important}.header.header-datetime-only .date{font-size:25px!important}.header.header-datetime-only .time{font-size:11px!important}.product-icon{width:39px!important;height:39px!important}.product{font-size:12px!important}.prices{font-size:18px!important}.thead,.quote-row{grid-template-columns:1fr 105px!important}}
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
<style>:root{
  --navy:#0b2f57;--navy2:#123f70;--blue:#0878e8;--blue2:#36a9ef;
  --sky:#eef8ff;--sky2:#f7fbff;--line:#dcecf8;--line2:#c8e2f4;
  --gold:#e7a91d;--gold2:#ffd65b;--green:#13b779;--red:#ef4652;
  --shadow:0 16px 45px rgba(22,91,139,.10);--shadow2:0 7px 22px rgba(22,91,139,.10)
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  min-height:100vh;background:
  radial-gradient(circle at 8% 8%,rgba(83,183,240,.16),transparent 27%),
  radial-gradient(circle at 92% 10%,rgba(255,213,92,.13),transparent 24%),
  linear-gradient(180deg,#f4fbff 0%,#eaf6fd 100%);
  color:var(--navy);font-family:'Poppins',Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
  padding:24px 12px;overflow-x:hidden
}
.page{width:min(1080px,100%);margin:0 auto}
.shell{
  position:relative;border:1px solid rgba(185,218,239,.75);border-radius:24px;
  background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(247,252,255,.98));
  min-height:650px;overflow:hidden;box-shadow:var(--shadow)
}
.header{
  margin:16px;border:1px solid rgba(121,193,236,.45);border-radius:18px;
  background:linear-gradient(112deg,#083f80 0%,#086fce 50%,#35a9ef 100%);
  height:112px;display:flex;align-items:center;justify-content:space-between;padding:14px 18px 14px 28px;
  position:relative;overflow:hidden;box-shadow:0 10px 25px rgba(18,107,176,.18)
}
.header:before{content:"";position:absolute;width:62%;height:220px;right:-2%;top:-132px;border-radius:50%;background:linear-gradient(145deg,rgba(108,211,255,.30),rgba(255,255,255,0));transform:rotate(-14deg)}
.header:after{content:"";position:absolute;width:48%;height:110px;right:8%;bottom:-70px;border-radius:50%;border-top:2px solid rgba(255,224,128,.72);transform:rotate(-9deg)}
.brand{display:flex;align-items:center;gap:16px;position:relative;z-index:2}
.brand-icon{width:86px;height:80px;display:grid;place-items:center;flex:none}
.gold-mark{position:relative;width:42px;height:34px;display:block;flex:none}
.gold-mark:before{content:"";position:absolute;left:5px;top:7px;width:31px;height:19px;border-radius:4px;background:linear-gradient(145deg,#fff8bd 0%,#ffd95a 28%,#e9ae20 62%,#b97808 100%);border:1px solid #b87908;box-shadow:0 3px 5px rgba(72,43,0,.3),inset 0 1px 1px rgba(255,255,255,.8);transform:skewX(-9deg)}
.gold-mark:after{content:"999.9";position:absolute;left:21px;top:17px;transform:translate(-50%,-50%) skewX(-9deg);font-size:6px;line-height:1;color:#704600;font-weight:900;letter-spacing:.2px;z-index:2}
.gold-mark .bar,.gold-mark .purity{display:none}
.gold-mark-large{width:76px;height:58px}.gold-mark-large:before{left:8px;top:10px;width:57px;height:34px;border-radius:6px}.gold-mark-large:after{left:36px;top:27px;font-size:10px}.gold-mark-large .bar,.gold-mark-large .purity{display:none}
.brand-title{font-size:39px;line-height:1.02;font-weight:800;letter-spacing:-1.35px;color:#fff;text-shadow:0 2px 10px rgba(0,40,90,.16)}
.brand-sub{display:none}.dot{display:none}
.datetime{position:relative;z-index:3;width:215px;background:rgba(255,255,255,.97);border:1px solid #d4e9f9;border-radius:13px;padding:11px 14px;box-shadow:0 5px 18px rgba(0,55,110,.17)}
.date{font-size:17px;font-weight:800;text-align:center;color:#0c3d79}.time{font-size:13px;font-weight:700;text-align:center;margin-top:8px;white-space:nowrap;color:#173f70}.hkflag{width:22px;height:16px;vertical-align:-3px;margin-right:7px}
.header-datetime-only{justify-content:center;padding:8px 16px;height:84px}.header-datetime-only .datetime{width:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0;background:transparent;box-shadow:none;border:0}.header-datetime-only .date{font-size:24px;font-weight:800;text-align:center;color:#fff;line-height:1.05;letter-spacing:.1px}.header-datetime-only .time{font-size:12px;font-weight:600;margin-top:5px;text-align:center;white-space:nowrap;color:rgba(255,255,255,.92);line-height:1.05}.header-datetime-only .hkflag{width:22px;height:16px;vertical-align:-3px;margin-right:7px}.header-datetime-only .datetime{position:relative}
.main{display:grid;grid-template-columns:1.72fr 1fr;gap:16px;margin:0 16px;position:relative;z-index:2}
.card{background:rgba(255,255,255,.98);border:1px solid var(--line2);border-radius:17px;box-shadow:var(--shadow2);overflow:hidden}
.cardbar{height:64px;padding:0 19px;display:flex;align-items:center;justify-content:space-between;color:white;background:linear-gradient(100deg,#095fb9 0%,#0877dc 58%,#38a9ef 100%);position:relative;overflow:hidden}.cardbar:after{content:"";position:absolute;width:180px;height:180px;right:-60px;top:-125px;border-radius:50%;border:1px solid rgba(255,255,255,.17)}
.gold-heading{display:flex;align-items:center;gap:12px;font-size:20px;font-weight:800;position:relative;z-index:1}.small-gold{width:48px;height:43px;display:grid;place-items:center}.trend{font-size:37px;font-weight:300;line-height:1;opacity:.92;z-index:1;transform:rotate(-8deg)}
.rates-inner{padding:14px 14px 11px}.thead{height:43px;border-radius:11px;background:linear-gradient(180deg,#eef8ff,#e4f2fc);display:grid;grid-template-columns:1fr 160px;align-items:center;padding:0 16px;font-size:12px;font-weight:800;color:#164474;letter-spacing:.15px}.thead div:last-child{text-align:right}
.quote-row{min-height:80px;display:grid;grid-template-columns:1fr 160px;align-items:center;padding:9px 16px;border-bottom:1px solid #e2eff8;transition:background .2s ease,transform .2s ease}.quote-row:hover{background:#f8fcff}.quote-row:last-child{border-bottom:0}
.product-wrap{display:flex;align-items:center;gap:14px;min-width:0}.product-icon{width:51px;height:51px;border-radius:50%;background:radial-gradient(circle at 34% 28%,#fff7b7 0%,#ffd95a 20%,#e8a916 52%,#b87305 78%,#8b5400 100%);border:2px solid #e2a51a;display:grid;place-items:center;flex:none;box-shadow:inset 0 2px 3px rgba(255,255,255,.75),inset 0 -3px 5px rgba(91,50,0,.32),0 3px 7px rgba(75,48,0,.18);position:relative;overflow:hidden}.product-icon:before{content:"";position:absolute;inset:5px;border-radius:50%;border:1px solid rgba(255,247,183,.75);box-shadow:inset 0 0 0 2px rgba(168,102,0,.18)}.product-icon:after{content:"999.9";position:absolute;z-index:3;font-size:7px;font-weight:900;letter-spacing:.2px;color:#704500;text-shadow:0 1px 0 rgba(255,241,157,.7)}
.product{font-size:15px;font-weight:700;color:#123e79;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.prices{display:flex;justify-content:flex-end;align-items:center;gap:8px;font-size:25px;font-weight:800;color:#0879e8;font-variant-numeric:tabular-nums;letter-spacing:-.4px}.rate-arrow{font-size:17px;font-weight:900}.up{color:var(--green)}.down{color:var(--red)}
.rules-title{height:64px;background:linear-gradient(180deg,#f0f9ff,#e7f4fc);display:flex;align-items:center;gap:11px;padding:0 15px;font-size:18px;font-weight:800;color:#0d3d76;border-bottom:1px solid #d9ebf8}.info{width:37px;height:37px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(145deg,#2295f2,#0675e1);color:#fff;font-size:20px;font-weight:800;box-shadow:0 4px 10px rgba(8,117,225,.22)}
.rules-body{padding:7px 16px 10px}.rule{display:grid;grid-template-columns:44px 1fr;gap:11px;padding:14px 0;border-bottom:1px solid #e0edf6}.rule:last-child{border-bottom:0}.rule-num{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(145deg,#2294f0,#0674df);color:#fff;font-size:12px;font-weight:800;box-shadow:0 4px 9px rgba(8,117,225,.17)}.rule p{margin:2px 0 0;font-size:12px;line-height:1.55;color:#244e7c}.rule b{color:#0b3d76}
.bottom-art{height:112px;margin-top:9px;position:relative;overflow:hidden}.wave1,.wave2{position:absolute;left:-5%;width:110%;height:88px;border-radius:50% 50% 0 0/100% 100% 0 0;bottom:-52px;transform:rotate(3deg)}.wave1{background:linear-gradient(180deg,rgba(91,183,240,.16),rgba(91,183,240,.31))}.wave2{bottom:-67px;transform:rotate(-4deg);background:linear-gradient(180deg,rgba(183,225,249,.26),rgba(183,225,249,.44))}.skyline{position:absolute;bottom:1px;left:50%;transform:translateX(-50%);width:min(450px,62%);height:77px;opacity:.38}
@media(max-width:900px){body{padding:14px 9px}.shell{border-radius:20px}.header{height:auto;min-height:104px}.brand-title{font-size:34px}.main{grid-template-columns:1fr}.datetime{width:210px}}
@media(max-width:600px){body{padding:7px 5px}.shell{border-radius:16px}.header-datetime-only{min-height:74px;height:74px;flex-direction:row;align-items:center;justify-content:space-between;padding:8px 14px;margin:8px 6px 10px}.header-datetime-only .datetime{width:100%;min-width:0;padding:0}.header-datetime-only .date{font-size:20px;color:#fff}.header-datetime-only .time{font-size:10.5px;margin-top:4px;color:#fff}.header-datetime-only .hkflag{width:19px;height:13px;margin-right:5px}.header{margin:9px 6px;padding:10px;min-height:140px;flex-direction:column;align-items:stretch;gap:7px}.brand{justify-content:center;gap:10px}.brand-icon{width:58px;height:58px}.gold-mark-large{width:58px;height:58px}.gold-mark-large:before{inset:6px}.gold-mark-large:after{font-size:8.5px}.gold-mark-large .bar,.gold-mark-large .purity{display:none}.brand-title{font-size:24px;letter-spacing:-.6px}.brand-sub{display:none}.datetime{width:100%;padding:8px}.date{font-size:15px}.time{font-size:11px}.main{margin:0 6px;gap:11px}.card{border-radius:14px}.cardbar{height:57px;padding:0 12px}.gold-heading{font-size:17px;gap:8px}.small-gold{width:43px;height:42px}.trend{font-size:31px}.rates-inner{padding:10px}.thead{grid-template-columns:1fr 126px;padding:0 12px;font-size:11px;height:39px}.quote-row{grid-template-columns:1fr 126px;min-height:70px;padding:8px 11px}.product-wrap{gap:9px}.product-icon{width:42px;height:42px}.product-icon .gold-mark{display:none}.product{font-size:12.5px}.prices{font-size:20px;gap:5px}.rate-arrow{font-size:15px}.rules-title{height:57px;font-size:16px;padding:0 12px}.info{width:33px;height:33px;font-size:18px}.rule{grid-template-columns:36px 1fr;gap:8px;padding:11px 0}.rule-num{width:34px;height:34px;font-size:11px}.rule p{font-size:11px;line-height:1.5}.bottom-art{height:67px}.skyline{width:76%;height:54px}}
@media(max-width:390px){.header-datetime-only{height:68px;min-height:68px}.header-datetime-only .date{font-size:19px}.header-datetime-only .time{font-size:10px}.gold-heading{font-size:16px}.product{font-size:11.5px}.prices{font-size:18px}.thead,.quote-row{grid-template-columns:1fr 112px}.quote-row{min-height:66px}.product-icon{width:39px;height:39px}.rules-title{font-size:15px}}
</style></head><body><div class="page"><div class="shell">
<header class="header header-datetime-only"><div class="datetime"><div id="date" class="date">--</div><div class="time"><svg class="hkflag" viewBox="0 0 24 17"><rect width="24" height="17" rx="2" fill="#DE2910"/><path d="M8.4 4.7c-1.9-1-3.7.5-3 2.2.45 1.1 1.7 1.5 2.8.8-1.15.15-1.85-.7-1.55-1.45.28-.67 1.08-.94 1.75-.86Z" fill="#fff"/><circle cx="9.2" cy="5.5" r=".6" fill="#fff"/><circle cx="7.4" cy="4.2" r=".6" fill="#fff"/><circle cx="6.2" cy="6.7" r=".6" fill="#fff"/><circle cx="8.8" cy="7.8" r=".6" fill="#fff"/></svg><span id="time">--:--:-- -- HKT</span></div></div></header>
<main class="main"><section class="card"><div class="cardbar"><div class="gold-heading"><div class="small-gold"><div class="gold-mark" aria-hidden="true"><span class="bar bar-a"></span><span class="bar bar-b"></span><span class="bar bar-c"></span><span class="purity">999.9</span></div></div><span>Gold (999.9)</span></div><div class="trend">⌁</div></div><div class="rates-inner"><div class="thead"><div>Product</div><div>USD Rate / Gram</div></div><div id="rows"></div></div></section>
<section class="card"><div class="rules-title"><span class="info">i</span><span>Booking Rules / Notes</span></div><div class="rules-body"><div class="rule"><span class="rule-num">01</span><p>After checking the live rate, whenever you're ready to confirm a booking, you must write down the <b>required grams</b>.</p></div><div class="rule"><span class="rule-num">02</span><p>Once you send the grams, we will reply with <b>"OK"</b> at that same time, confirming your booking is being processed at that exact moment.</p></div><div class="rule"><span class="rule-num">03</span><p>Right after confirmation, we will send you a <b>screenshot of the rate</b>.</p></div><div class="rule"><span class="rule-num">04</span><p>If your booking is urgent, please <b>call us directly</b> to alert us at the time of booking — WhatsApp messages may sometimes be missed or delayed, so a call ensures immediate confirmation.</p></div></div></section></main>
<div class="bottom-art"><div class="wave1"></div><div class="wave2"></div><svg class="skyline" viewBox="0 0 500 100" preserveAspectRatio="none" aria-hidden="true"><g fill="#72b9e9"><rect x="25" y="64" width="25" height="34"/><rect x="54" y="53" width="23" height="45"/><rect x="82" y="69" width="18" height="29"/><rect x="104" y="42" width="25" height="56"/><rect x="133" y="60" width="22" height="38"/><rect x="160" y="31" width="25" height="67"/><rect x="191" y="52" width="31" height="46"/><rect x="228" y="65" width="18" height="33"/><rect x="252" y="17" width="27" height="81"/><rect x="284" y="57" width="20" height="41"/><rect x="309" y="46" width="31" height="52"/><rect x="346" y="65" width="21" height="33"/><rect x="372" y="36" width="26" height="62"/><rect x="403" y="57" width="24" height="41"/><rect x="433" y="68" width="24" height="30"/><path d="M258 17 266 5l8 12z"/></g></svg></div>
</div></div><script>(()=>{let previousBid=null;function hk(){const p=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Hong_Kong",year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"2-digit",second:"2-digit",hour12:true}).formatToParts(new Date());const g=t=>p.find(x=>x.type===t)?.value||"";return{year:+g("year"),month:+g("month"),day:+g("day"),hour:g("hour"),minute:g("minute"),second:g("second"),dp:g("dayPeriod")}}function clock(){const h=hk(),m=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];document.getElementById("date").textContent=h.day+"-"+m[h.month-1]+"-"+String(h.year).slice(-2);document.getElementById("time").textContent=h.hour+":"+h.minute+":"+h.second+" "+h.dp+" HKT"}async function price(){try{const r=await fetch("/api/price?_="+Date.now(),{cache:"no-store"}),d=await r.json();if(!d.ok)return;const rows=d.rows||[];const currentBid=Number(d.bid);let marketArrow="";let marketCls="same";if(Number.isFinite(currentBid)&&previousBid!==null&&Number.isFinite(previousBid)){if(currentBid>previousBid){marketArrow="▲";marketCls="up"}else if(currentBid<previousBid){marketArrow="▼";marketCls="down"}}document.getElementById("rows").innerHTML=rows.map((x,i)=>{if(!x.label)return "";const value=x.rate===null?null:Number(x.rate);const arrow=marketArrow;const cls=marketCls;return '<div class="quote-row"><div class="product-wrap"><div class="product-icon"><div class="gold-mark" aria-hidden="true"><span class="bar bar-a"></span><span class="bar bar-b"></span><span class="bar bar-c"></span><span class="purity">999.9</span></div></div><div class="product">'+escapeHtml(x.label)+'</div></div><div class="prices">'+(arrow?'<span class="rate-arrow '+cls+'">'+arrow+'</span>':"")+(value===null?"---":value.toFixed(2))+'</div></div>'}).join("");if(Number.isFinite(currentBid))previousBid=currentBid}catch(e){}}function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}clock();price();setInterval(clock,1000);setInterval(price,1000)})();</script></body></html>`;
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

