// script.js (user page) — final (proxy QRIS integrated)
// Products (fixed)
const PRODUCTS = [
  { id:'yklt_ori', name:'Yakult Original', pack:10000, pallet:100000, img:'img/yklt-ori.png' },
  { id:'yklt_mango', name:'Yakult Mangga', pack:10000, pallet:100000, img:'img/yklt-mangga.png' },
  { id:'yklt_light', name:'Yakult Light', pack:12500, pallet:125000, img:'img/yklt-light.png' },
  { id:'open_Donasi', name:'Open Donasi', pack:1000, pallet:1000, img:'img/open-Donasu.png' }
];

// QRIS static string
const QRIS_STATIS = "00020101021126570011ID.DANA.WWW011893600915380003780002098000378000303UMI51440014ID.CO.QRIS.WWW0215ID10243620012490303UMI5204549953033605802ID5910Warr2 Shop6015Kab. Bandung Ba6105402936304BF4C";

let CART = {};
let lastTx = null;

function renderProducts(){
  const grid = document.getElementById('productGrid');
  if(!grid) return;
  grid.innerHTML = '';
  PRODUCTS.forEach(p=>{
    const node = document.createElement('div'); 
    node.className='product';

    node.innerHTML = `
      <img src="${p.img}" alt="${p.name}">
      <h3>${p.name}</h3>
      <div class="small">Pack: ${formatRp(p.pack)} • Bal: ${formatRp(p.pallet)}</div>
      <div class="counter">
        <button class="btn ghost" data-id="${p.id}" data-op="dec">−</button>
        <div class="qty-box qty-${p.id}">0</div>
        <button class="btn primary" data-id="${p.id}" data-op="inc">+</button>
      </div>
    `;
    grid.appendChild(node);
  });
  grid.querySelectorAll('[data-op]').forEach(b=> b.addEventListener('click', e=>{
    const id = e.currentTarget.dataset.id; const op = e.currentTarget.dataset.op;
    changeQty(id, op==='inc'?1:-1);
  }));
}

function changeQty(id, delta){
  if(!CART[id]) CART[id]=0;
  CART[id] = Math.max(0, CART[id] + delta);
  const el = document.querySelector('.qty-'+id);
  if(el) el.textContent = CART[id];
  updateCart();
}

function updateCart(){
  const list = document.getElementById('cartList'); if(!list) return;
  list.innerHTML='';
  const keys = Object.keys(CART).filter(k=>CART[k]>0);
  if(keys.length===0){ list.innerHTML = '<div class="muted">Troli kosong</div>'; const ta = document.getElementById('totalAmount'); if(ta) ta.textContent = formatRp(0); return; }
  let total = 0;
  keys.forEach(k=>{
    const p = PRODUCTS.find(x=>x.id===k);
    const qty = CART[k];
    const sub = qty * p.pack;
    total += sub;
    const item = document.createElement('div'); item.className='cart-item';
    item.innerHTML = `<div><strong>${p.name}</strong><div class="small">${qty} x ${formatRp(p.pack)}</div></div>
                      <div style="display:flex;align-items:center;gap:8px"><div style="font-weight:900">${formatRp(sub)}</div><button class="btn ghost" data-rm="${k}">✕</button></div>`;
    list.appendChild(item);
  });
  const ta = document.getElementById('totalAmount'); if(ta) ta.textContent = formatRp(total);
  list.querySelectorAll('[data-rm]').forEach(b=> b.addEventListener('click', e=>{
    const id = e.currentTarget.dataset.rm; delete CART[id]; const qel = document.querySelector('.qty-'+id); if(qel) qel.textContent = 0; updateCart();
  }));
}

const resetBtn = document.getElementById('resetCart');
if(resetBtn) resetBtn.addEventListener('click', ()=> {
  if(!confirm('Reset troli?')) return;
  CART={}; document.querySelectorAll('[class^="qty-"]').forEach(el=>el.textContent='0'); updateCart();
});

/* Payment buttons: QR or Cash (user selects method only) */
const payQrBtn = document.getElementById('payQrBtn');
const payCashBtn = document.getElementById('payCashBtn');
if(payQrBtn) payQrBtn.addEventListener('click', ()=> startOrder('qris'));
if(payCashBtn) payCashBtn.addEventListener('click', ()=> startOrder('cash'));

/* hide QR button */
const hideQRBtn = document.getElementById('hideQR');
if(hideQRBtn) hideQRBtn.addEventListener('click', ()=> {
  const box = document.getElementById('qrBox'); if(box) box.classList.add('hidden');
});

/* helper: convert image URL -> base64 (returns base64 string without data: prefix) */
async function urlToBase64(url){
  const res = await fetch(url);
  const blob = await res.blob();
  return await new Promise((resolve, reject)=>{
    const fr = new FileReader();
    fr.onloadend = ()=> {
      const dataUrl = fr.result; // "data:image/png;base64,....."
      resolve(dataUrl.split(',')[1]);
    };
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

async function startOrder(method){
  const keys = Object.keys(CART).filter(k=>CART[k]>0);
  if(keys.length===0){ alert('Troli kosong'); return; }
  let total = 0; const items=[];
  keys.forEach(k=>{
    const p = PRODUCTS.find(x=>x.id===k);
    items.push({ id:p.id, name:p.name, qty:CART[k], packPrice:p.pack });
    total += CART[k] * p.pack;
  });

  const txid = createTxId();
  lastTx = txid;

  const qrBox = document.getElementById('qrBox'); 
  const qrImage = document.getElementById('qrImage'); 
  if(document.getElementById('qrInfo')) document.getElementById('qrInfo').textContent = 'Membuat transaksi...'; 
  if(qrBox) qrBox.classList.remove('hidden');

  // Save initial order (status pending) — include method chosen by user
  const orderTemplate = { txid, amount: total, items, status:'pending', method_choice: method, created_at: Date.now() };

  try {
    // save minimal order first so admin sees pending
    await DB.ref('orders/'+txid).set(orderTemplate);

    // If method is QRIS -> try generate QR (API first, local fallback)
    if(method === 'qris'){
      try {
        const api = await callQrisApiWithTimeout(String(total), QRIS_STATIS, 8000);
        if(api && api.status === 'success' && api.qris_base64){
          // API returned base64
          await DB.ref('orders/'+txid).update({ qris_base64: api.qris_base64, via:'api' });
          if(qrImage) qrImage.innerHTML = `<img src="data:image/png;base64,${api.qris_base64}" alt="QR">`;
          if(document.getElementById('qrInfo')) document.getElementById('qrInfo').textContent = `Kode: ${txid}`;
          if(document.getElementById('downloadQR')) document.getElementById('downloadQR').onclick = ()=> {
            const a = document.createElement('a'); a.href = 'data:image/png;base64,'+api.qris_base64; a.download = txid+'.png'; a.click();
          };
        } else {
          throw new Error(api?.message || 'API invalid');
        }
      } catch(eapi){
        // FALLBACK (PROXY) — build emv string + use Google chart URL via proxy -> convert to base64 -> save into DB as qris_base64
        const emv = buildEmvWithAmount(QRIS_STATIS, String(total));
        const googleURL = makeGoogleChartQrUrl(emv, 360);

        // PROXY supaya tidak diblokir oleh Vercel (AllOrigins raw)
        const proxyURL = "https://api.allorigins.win/raw?url=" + encodeURIComponent(googleURL);

        try {
          const res = await fetch(proxyURL);
          const blob = await res.blob();
          const reader = new FileReader();

          const b64 = await new Promise((resolve, reject) => {
            reader.onerror = reject;
            reader.onloadend = () => {
              const result = reader.result || '';
              const parts = String(result).split(',');
              resolve(parts[1] || '');
            };
            reader.readAsDataURL(blob);
          });

          // Simpan base64 ke Firebase
          await DB.ref('orders/'+txid).update({
            emv_string: emv,
            qris_base64: b64,
            via: 'local-proxy'
          });

          // Tampilkan QR
          if(qrImage) qrImage.innerHTML = `<img src="data:image/png;base64,${b64}" alt="QR">`;
          if(document.getElementById('qrInfo')) document.getElementById('qrInfo').textContent = `Kode: ${txid} (fallback)`;

          // Download
          if(document.getElementById('downloadQR')) document.getElementById('downloadQR').onclick = ()=> {
            const a = document.createElement('a');
            a.href = "data:image/png;base64," + b64;
            a.download = txid + ".png";
            a.click();
          };

        } catch(fetchErr){
          // Last-resort fallback: store url and show remote google url (may be blocked)
          await DB.ref('orders/'+txid).update({
            emv_string: emv,
            qris_url: googleURL,
            via: 'local-url'
          });

          if(qrImage) qrImage.innerHTML = `<img src="${googleURL}" alt="QR">`;
          if(document.getElementById('qrInfo')) document.getElementById('qrInfo').textContent = `Kode: ${txid} (fallback direct)`;

          if(document.getElementById('downloadQR')) document.getElementById('downloadQR').onclick = ()=> {
            fetch(googleURL).then(r=>r.blob()).then(blob=>{
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = txid + '.png';
              a.click();
            }).catch(()=> alert('Download gagal'));
          };
        }
      }
    } else {
      // method == 'cash' -> no QR generated; inform user to pay cash to admin
      if(document.getElementById('qrImage')) document.getElementById('qrImage').innerHTML = `<div class="small muted">Transaksi cash dicatat. Bayar tunai ke admin.</div>`;
      if(document.getElementById('qrInfo')) document.getElementById('qrInfo').textContent = `Kode: ${txid} (CASH)`;
    }

    // clear cart visually
    CART={}; document.querySelectorAll('[class^="qty-"]').forEach(el=>el.textContent='0'); updateCart();
    alert('Order dibuat. Kode: ' + txid + '. Tunggu proses di admin.');

    // Listen for status changes for this tx (the user will be notified when admin updates)
    DB.ref('orders/'+txid+'/status').on('value', snap=>{
      const s = snap.val();
      if(s === 'paid'){
        if(qrBox) qrBox.classList.add('hidden');
        alert('Pembayaran terkonfirmasi. Terima kasih!');
      } else if(s === 'cancelled'){
        if(qrBox) qrBox.classList.add('hidden');
        alert('Transaksi dibatalkan oleh admin.');
      } else {
        // still pending
      }
    });

  } catch(err){
    console.error(err);
    if(document.getElementById('qrImage')) document.getElementById('qrImage').innerHTML = `<div class="small muted">Gagal membuat transaksi</div>`;
    if(document.getElementById('qrInfo')) document.getElementById('qrInfo').textContent = '';
    alert('Gagal membuat transaksi: ' + (err.message || err));
  }
}

/* ---------------- API with timeout + fallback helpers (same as previous) ---------------- */
async function callQrisApiWithTimeout(amount, qrisStatis, timeoutMs = 8000){
  const controller = new AbortController();
  const id = setTimeout(()=> controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://qrisku.my.id/api', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ amount, qris_statis: qrisStatis }),
      signal: controller.signal
    });
    clearTimeout(id);
    const j = await res.json();
    return j;
  } catch(err){
    clearTimeout(id);
    throw err;
  }
}

function buildEmvWithAmount(qrisStatis, amountStr){
  const upper = qrisStatis.toUpperCase();
  const crcIndex = upper.indexOf('6304');
  if(crcIndex === -1) throw new Error('QRIS statis tidak memiliki tag CRC (6304)');
  const value54 = String(amountStr);
  const len54 = String(value54.length).padStart(2,'0');
  const tag54 = '54' + len54 + value54;
  const beforeCrc = qrisStatis.substring(0, crcIndex);
  const emvNoCrc = beforeCrc + tag54 + '6304';
  const crc = crc16ccitt(emvNoCrc).toUpperCase();
  const emvFull = emvNoCrc + crc;
  return emvFull;
}
function crc16ccitt(inputStr){
  const poly = 0x1021;
  let crc = 0xFFFF;
  for(let i=0;i<inputStr.length;i++){
    let byte = inputStr.charCodeAt(i) & 0xFF;
    crc ^= (byte << 8);
    for(let j=0;j<8;j++){
      if((crc & 0x8000) !== 0) crc = ((crc << 1) ^ poly) & 0xFFFF;
      else crc = (crc << 1) & 0xFFFF;
    }
  }
  return crc.toString(16).padStart(4,'0');
}
function makeGoogleChartQrUrl(dataStr, size=300){
  const encoded = encodeURIComponent(dataStr);
  return `https://chart.googleapis.com/chart?cht=qr&chs=${size}x${size}&chl=${encoded}&chld=L|1`;
}

/* ---------------- utilities ---------------- */
function createTxId(){
  const d = new Date();
  return 'YKLT' + d.getFullYear() + pad2(d.getMonth()+1) + pad2(d.getDate()) + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
}
function formatRp(n){ return 'Rp' + Number(n||0).toLocaleString('id-ID'); }
function pad2(n){ return String(n).padStart(2,'0'); }

/* ---------------- history for user ---------------- */
/* Show last paid orders (clean receipt-style) in #historyList */
function renderUserHistoryFromOrders(snapshotVal){
  const historyEl = document.getElementById('historyList');
  if(!historyEl) return;
  historyEl.innerHTML = '';
  if(!snapshotVal){
    historyEl.innerHTML = '<div class="muted">Belum ada riwayat</div>';
    return;
  }
  // snapshotVal is object of orders maybe; filter paid
  const arr = Object.values(snapshotVal).filter(o=>o.status === 'paid').sort((a,b)=> (b.paid_at || 0) - (a.paid_at || 0) || (b.created_at || 0) - (a.created_at || 0));
  if(arr.length === 0){
    historyEl.innerHTML = '<div class="muted">Belum ada riwayat</div>';
    return;
  }
  // show up to 8 recent
  arr.slice(0,8).forEach(o=>{
    const node = document.createElement('div'); node.className = 'card';
    const time = o.paid_at ? new Date(o.paid_at).toLocaleString() : (o.created_at? new Date(o.created_at).toLocaleString() : '-');
    const itemsHtml = (o.items||[]).map(i=> `<div style="display:flex;justify-content:space-between"><div>${i.name} x${i.qty}</div><div>${formatRp((i.qty||0) * (i.packPrice||0))}</div></div>`).join('');
    node.style.padding='10px';
    node.style.marginBottom='8px';
    node.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div><strong>${o.txid || o.txid}</strong><div class="small">${time}</div></div>
        <div style="text-align:right"><div style="font-weight:900">${formatRp(o.amount)}</div><div class="small">${(o.payment_method || o.method_choice || '').toUpperCase()}</div></div>
      </div>
      <div style="margin-top:8px">${itemsHtml}</div>
    `;
    historyEl.appendChild(node);
  });
}

/* listen orders to update history (realtime) */
if(typeof DB !== 'undefined' && DB.ref){
  DB.ref('orders').on('value', snap=>{
    const val = snap.val() || {};
    renderUserHistoryFromOrders(val);
  });
}

/* ---------------- init ---------------- */
renderProducts();
updateCart();
startClock();
function startClock(){
  const el = document.getElementById('clock');
  if(!el) return;
  setInterval(()=>{ const d=new Date(); el.textContent = `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; },1000);
}
