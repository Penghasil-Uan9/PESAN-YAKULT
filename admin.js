// admin.js (updated)
const txList = document.getElementById('txList');
const deductList = document.getElementById('deductList');
const orderHistoryEl = document.getElementById('orderHistory');

let ORDERS = {};
let SELECTED_CASH_TX = null;

/* Start realtime listeners and button bindings */
function startAdmin(){
  // listen orders
  DB.ref('orders').on('child_added', snap => { ORDERS[snap.key] = snap.val(); ORDERS[snap.key].txid = snap.key; renderOrders(); });
  DB.ref('orders').on('child_changed', snap => { ORDERS[snap.key] = snap.val(); ORDERS[snap.key].txid = snap.key; renderOrders(); });
  DB.ref('orders').on('child_removed', snap => { delete ORDERS[snap.key]; renderOrders(); });

  // deductions & history & totals
  DB.ref('deductions').on('value', snap => renderDeductions(snap.val()||{}));
  DB.ref('history').on('value', snap => renderHistory(snap.val()||{}));
  DB.ref('orders').on('value', ()=> renderTotals());

  // buttons
  document.getElementById('btnDeduct').addEventListener('click', async ()=>{
    const amt = Number(document.getElementById('deductAmount').value) || 0;
    const reason = document.getElementById('deductReason').value || 'Alasan';
    if(amt <= 0){ alert('Masukkan jumlah'); return; }
    const id = 'D' + Date.now();

    // Simpan ke deductions
    await DB.ref('deductions/'+id).set({ 
      id, 
      amount: amt, 
      reason, 
      created_at: Date.now() 
    });

    // masuk ke history sebagai kerugian
    await DB.ref('history/'+id).set({
      id,
      amount: amt,
      reason,
      type: 'kerugian',
      time: Date.now()
    });

    document.getElementById('deductAmount').value='';
    document.getElementById('deductReason').value='';
    alert('Pengurangan dicatat.');
  });

  document.getElementById('btnDownloadAll').addEventListener('click', async ()=>{
    const snap = await DB.ref('orders').once('value'); const orders = snap.val() || {};
    let content = '';
    Object.keys(orders).forEach(k=>{
      const t = orders[k];
      content += `===== STRUK =====\nID: ${k}\nWaktu: ${new Date(t.created_at).toLocaleString()}\nJumlah: ${formatRp(t.amount)}\nStatus: ${t.status}\nMethod chosen: ${t.method_choice || '-'}\nItems:\n`;
      (t.items||[]).forEach(i=> content += ` - ${i.name} x${i.qty} = ${formatRp(i.qty * i.packPrice)}\n`);
      content += `-----------------\n\n`;
    });
    downloadTxt('struk_all_'+Date.now()+'.txt', content);
  });

  document.getElementById('btnResetAll').addEventListener('click', async ()=>{
    if(!confirm('Reset semua data?')) return;
    await DB.ref('orders').remove(); await DB.ref('deductions').remove(); await DB.ref('history').remove();
    ORDERS = {}; renderOrders(); renderDeductions({}); renderHistory({});
    alert('Data direset.');
  });

  // cash modal controls
  document.getElementById('cashCancel').addEventListener('click', ()=> closeCashModal());
  document.getElementById('cashConfirm').addEventListener('click', ()=> handleCashConfirm());

  startClockAdmin();
}
startAdmin();

function renderOrders(){
  txList.innerHTML = '';
  const keys = Object.keys(ORDERS).sort().reverse();
  if(keys.length===0){ txList.innerHTML = '<div class="muted">Belum ada transaksi</div>'; return; }
  keys.forEach(k=>{
    const v = ORDERS[k];
    const row = document.createElement('div'); row.className='tx-row';
    const left = document.createElement('div');
    left.innerHTML = `<strong>${k}</strong><div class="small">${new Date(v.created_at).toLocaleString()}</div><div class="small">Jumlah: ${formatRp(v.amount)}</div>`;
    const right = document.createElement('div'); right.style.display='flex'; right.style.gap='8px'; right.style.alignItems='center';

    const badge = document.createElement('div'); badge.className='badge ' + (v.status==='pending'?'badge-pending':v.status==='paid'?'badge-paid':'badge-cancel'); badge.textContent = (v.status || 'pending').toUpperCase();

    const btnView = document.createElement('button'); btnView.className='btn ghost'; btnView.textContent='VIEW'; btnView.onclick = ()=> viewOrder(v,k);
    const btnScan = document.createElement('button'); btnScan.className='btn ghost'; btnScan.textContent='SCAN QRIS'; btnScan.onclick = ()=> scanQris(v,k);
    const btnConfirm = document.createElement('button'); btnConfirm.className='btn accent'; btnConfirm.textContent='KONFIRMASI'; btnConfirm.onclick = ()=> confirmOrder(k);
    const btnCash = document.createElement('button'); btnCash.className='btn primary'; btnCash.textContent='CASH'; btnCash.onclick = ()=> openCashModal(k);
    const btnCancel = document.createElement('button'); btnCancel.className='btn ghost'; btnCancel.textContent='BATALKAN'; btnCancel.onclick = ()=> cancelOrder(k);

    right.appendChild(badge); right.appendChild(btnView); right.appendChild(btnScan); right.appendChild(btnConfirm); right.appendChild(btnCash); right.appendChild(btnCancel);

    row.appendChild(left); row.appendChild(right);
    txList.appendChild(row);
  });
}

function viewOrder(v,k){
  const items = (v.items||[]).map(i=> `${i.name} x ${i.qty} = ${formatRp(i.qty * i.packPrice)}`).join('\n');
  alert(`${k}\nWaktu: ${new Date(v.created_at).toLocaleString()}\nJumlah: ${formatRp(v.amount)}\n\nItems:\n${items}`);
}

function scanQris(v,k){
  const w = window.open('','_blank','width=420,height=600');
  if(v.qris_base64){
    w.document.write(`<h3>${k}</h3><img src="data:image/png;base64,${v.qris_base64}" style="max-width:360px;border-radius:8px">`);
  } else if(v.qris_url){
    w.document.write(`<h3>${k}</h3><img src="${v.qris_url}" style="max-width:360px;border-radius:8px">`);
  } else {
    w.document.write(`<h3>${k}</h3><div class="small muted">Tidak ada QR.</div>`);
  }
}

async function confirmOrder(k){
  if(!confirm('Konfirmasi sebagai LUNAS?')) return;
  await DB.ref('orders/'+k).update({ status:'paid', paid_at: Date.now(), payment_method:'admin' });
  // tulis ke history (jika belum)
  const ord = ORDERS[k] || {};
  await DB.ref('history/'+k).set({ id:k, amount: ord.amount || 0, items: ord.items||[], type:'income', time: Date.now() });
  alert('Dikonfirmasi lunas.');
}

async function cancelOrder(k){
  if(!confirm('Batalkan transaksi?')) return;
  await DB.ref('orders/'+k).update({ status:'cancelled', cancelled_at: Date.now() });
  await DB.ref('history/'+k).set({ id:k, amount: ORDERS[k].amount, type:'cancel', time: Date.now() });
  alert('Dibatalkan.');
}

/* CASH modal functions */
function openCashModal(txid){
  SELECTED_CASH_TX = txid;
  const tx = ORDERS[txid];
  document.getElementById('cashModalInfo').textContent = `${txid} — Total: ${formatRp(tx.amount)}`;
  document.getElementById('cashInput').value = tx.amount;
  document.getElementById('cashResult').innerHTML = '';
  document.getElementById('cashModal').classList.remove('hidden');
}
function closeCashModal(){
  SELECTED_CASH_TX = null;
  document.getElementById('cashModal').classList.add('hidden');
}
async function handleCashConfirm(){
  if(!SELECTED_CASH_TX) return;
  const txid = SELECTED_CASH_TX;
  const tx = ORDERS[txid];
  const paid = Number(document.getElementById('cashInput').value) || 0;
  if(paid < tx.amount){
    // Uang kurang
    document.getElementById('cashResult').innerHTML = `<div class="cash-box danger">Uang kurang: ${formatRp(tx.amount - paid)}</div>`;
    // do not set paid; keep pending
    return;
  }
  const change = paid - tx.amount;
  // update order
  await DB.ref('orders/'+txid).update({ status:'paid', paid_at: Date.now(), payment_method:'cash', paid_amount: paid, change: change });
  await DB.ref('history/'+txid).set({ id:txid, amount: tx.amount, type:'income', time: Date.now(), items: tx.items || [] });
  document.getElementById('cashResult').innerHTML = change === 0 ? `<div class="cash-box success">Tunai PAS</div>` : `<div class="cash-box warn">Kembalian: ${formatRp(change)}</div>`;
  // close after small delay
  setTimeout(()=> closeCashModal(), 900);
}

/* Deductions rendering */
function renderDeductions(items){
  deductList.innerHTML = '';
  const arr = Object.values(items || {}).sort((a,b)=> b.created_at - a.created_at);
  if(arr.length===0){ deductList.innerHTML = '<div class="muted">Belum ada pengurangan</div>'; return; }
  arr.forEach(d=>{
    const n = document.createElement('div'); n.style.padding='8px'; n.innerHTML = `<div style="font-weight:800">${formatRp(d.amount)}</div><div class="small muted">${d.reason} • ${new Date(d.created_at).toLocaleString()}</div>`;
    deductList.appendChild(n);
  });
}

/* History rendering: show items from 'history' node */
/* historyNode can contain many entries (paid, cancel, kerugian). We'll render recent paid/income first */
function renderHistory(historyNode){
  orderHistoryEl.innerHTML = '';
  const arr = Object.values(historyNode || {}).map(h=>{
    // ensure structure normalization
    return {
      id: h.id || (h.txid || ''),
      amount: h.amount || 0,
      type: h.type || (h.payment_method? 'income' : 'info'),
      time: h.time || h.paid_at || Date.now(),
      items: h.items || (h.items) || []
    };
  }).sort((a,b)=> b.time - a.time);

  if(arr.length === 0){
    orderHistoryEl.innerHTML = '<div class="muted">Belum ada riwayat</div>';
    return;
  }

  arr.slice(0,12).forEach(h=>{
    const n = document.createElement('div'); n.style.padding='8px'; n.style.marginBottom='8px'; n.style.borderBottom='1px solid #f1f1f1';
    const timeStr = new Date(h.time).toLocaleString();
    const itemsHtml = (h.items||[]).map(i=> `<div style="display:flex;justify-content:space-between"><div>${i.name} x${i.qty || ''}</div><div>${formatRp((i.qty||1) * (i.packPrice || 0))}</div></div>`).join('');
    n.innerHTML = `<div style="display:flex;justify-content:space-between"><div style="font-weight:800">${h.id}</div><div class="small">${timeStr}</div></div>
                   <div style="margin-top:6px">${itemsHtml}</div>
                   <div style="margin-top:6px;display:flex;justify-content:space-between"><div class="small">${h.type}</div><div style="font-weight:900">${formatRp(h.amount)}</div></div>`;
    orderHistoryEl.appendChild(n);
  });
}

/* totals */
function renderTotals(){
  DB.ref('orders').once('value').then(snap=>{
    const txs = snap.val() || {};
    const totalPaid = Object.values(txs).filter(t=>t.status==='paid').reduce((s,a)=>s + (a.amount || 0), 0);
    document.getElementById('totalPendapatan').textContent = formatRp(totalPaid);
    DB.ref('deductions').once('value').then(snap2=>{
      const ded = snap2.val() || {}; const totalDed = Object.values(ded).reduce((s,a)=>s + (a.amount || 0), 0);
      document.getElementById('totalKerugian').textContent = formatRp(totalDed);
    });
  });
}

/* helpers */
function formatRp(n){ return 'Rp' + Number(n||0).toLocaleString('id-ID'); }
function downloadTxt(filename, content){ const blob = new Blob([content], { type: 'text/plain' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); }

/* clock */
function startClockAdmin(){ const el = document.getElementById('clockAdmin'); setInterval(()=>{ const d=new Date(); el.textContent = `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; },1000); }
function pad2(n){ return String(n).padStart(2,'0'); }