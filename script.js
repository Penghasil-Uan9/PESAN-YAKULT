// script.js (user page) — FINAL EMV-ONLY (no external QR API dependency)
// Products (fixed)
const PRODUCTS = [
  { id:'yklt_ori', name:'Yakult Original', pack:10000, pallet:100000, img:'img/yklt-ori.png' },
  { id:'yklt_mango', name:'Yakult Mangga', pack:10000, pallet:100000, img:'img/yklt-mangga.png' },
  { id:'yklt_light', name:'Yakult Light', pack:12500, pallet:125000, img:'img/yklt-light.png' },
  { id:'open_Donasi', name:'Open Donasi', pack:1000, pallet:1000, img:'img/open-Donasu.png' }
];

// QRIS static string (statis; EMV akan dibangun ulang dengan amount)
const QRIS_STATIS = "00020101021126570011ID.DANA.WWW011893600915380003780002098000378000303UMI51440014ID.CO.QRIS.WWW0215ID10243620012490303UMI5204549953033605802ID5910Warr2 Shop6015Kab. Bandung Ba6105402936304BF4C";

let CART = {};
let lastTx = null;

/* ---------------- UI: products & cart ---------------- */
function renderProducts(){
  const grid = document.getElementById('productGrid');
  if(!grid) return;
  grid.innerHTML = '';
  PRODUCTS.forEach(p=>{
    const node = document.createElement('div'); node.className='product';
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

/* ---------------- helper: convert image URL -> base64 (returns base64 string without data: prefix) ---------------- */
async function urlToBase64(url){
  // Try to fetch image and convert to base64. If it fails due to CORS, the caller should fallback to using qris_url only.
  try {
    const res = await fetch(url);
    if(!res.ok) throw new Error('fetch failed');
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
  } catch(e){
    // rethrow so caller can decide fallback
    throw e;
  }
}

/* ---------------- startOrder: EMV-only workflow ---------------- */
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
    if(typeof DB !== 'undefined' && DB.ref) await DB.ref('orders/'+txid).set(orderTemplate);

    if(method === 'qris'){
      // Build EMV final with amount (this ensures QRIS is valid for scanners)
      const emv = buildEmvWithAmount(QRIS_STATIS, String(total));

      // Use QR Server (no proxy) to render EMV into image
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(emv)}`;

      // Try to fetch the QR image and convert to base64 for stable display & download
      try {
        const base64 = await urlToBase64(qrUrl);

        // save to DB (so admin can later display)
        if(typeof DB !== 'undefined' && DB.ref) {
          await DB.ref('orders/'+txid).update({ emv_string: emv, qris_url: qrUrl, qris_base64: base64, via:'emv-qrserver' });
        }

        if(qrImage) qrImage.innerHTML = `<img src="data:image/png;base64,${base64}" alt="QR">`;
        if(document.getElementById('qrInfo')) document.getElementById('qrInfo').textContent = `Kode: ${txid}`;

        if(document.getElementById('downloadQR')) document.getElementById('downloadQR').onclick = ()=>{
          const a = document.createElement('a');
          a.href = "data:image/png;base64," + base64;
          a.download = txid + ".png";
          a.click();
        };
      } catch(fetchErr){
        // If converting to base64 fails (possible CORS), still show remote image and save qris_url
        if(typeof DB !== 'undefined' && DB.ref) {
          await DB.ref('orders/'+txid).update({ emv_string: emv, qris_url: qrUrl, via:'emv-qrserver-url' });
        }
        if(qrImage) qrImage.innerHTML = `<img src="${qrUrl}" alt="QR">`;
        if(document.getElementById('qrInfo')) document.getElementById('qrInfo').textContent = `Kode: ${txid} (gunakan fitur download jika tersedia)`;

        // Download fallback: try fetch blob and download (may fail due to CORS)
        if(document.getElementById('downloadQR')) document.getElementById('downloadQR').onclick = ()=> {
          fetch(qrUrl).then(r=>r.blob()).then(blob=>{
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = txid + '.png';
            a.click();
          }).catch(()=> alert('Download gagal (CORS) — silakan screenshot'));
        };
      }
    } else {
      // Cash flow
      if(document.getElementById('qrImage')) document.getElementById('qrImage').innerHTML = `<div class="small muted">Transaksi cash dicatat. Bayar tunai ke admin.</div>`;
      if(typeof DB !== 'undefined' && DB.ref) {
        await DB.ref('orders/'+txid).update({ via:'cash' });
      }
      if(document.getElementById('qrInfo')) document.getElementById('qrInfo').textContent = `Kode: ${txid} (CASH)`;
    }

    // clear cart visually
    CART={}; document.querySelectorAll('[class^="qty-"]').forEach(el=>el.textContent='0'); updateCart();
    alert('Order dibuat. Kode: ' + txid + '. Tunggu proses di admin.');

    // Listen for status changes for this tx (the user will be notified when admin updates)
    if(typeof DB !== 'undefined' && DB.ref) {
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
    }

  } catch(err){
    console.error(err);
    if(document.getElementById('qrImage')) document.getElementById('qrImage').innerHTML = `<div class="small muted">Gagal membuat transaksi</div>`;
    if(document.getElementById('qrInfo')) document.getElementById('qrInfo').textContent = '';
    alert('Gagal membuat transaksi: ' + (err.message || err));
  }
}

/* ---------------- utilities & EMV helpers ---------------- */
function buildEmvWithAmount(qrisStatis, amountStr){
  // Adds tag 54 (amount) and recalculates CRC (6304)
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

/* ---------------- utilities general ---------------- */
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
