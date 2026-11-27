'use strict';
(() => {
  const $ = selector => document.querySelector(selector);
  const login = $('#admLogin'), loginForm = $('#admLoginForm'), dashboard = $('#admDashboard'), panel = $('#admPanel');
  if (!login || !loginForm || !dashboard || !panel) return;
  let activeTab = 'orders';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money = value => `$${Number(value || 0).toFixed(2)}`;
  async function api(path, options = {}) {
    const response = await fetch(`/api${path}`, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
    return body;
  }
  function showLoggedOut(error = '') { login.classList.remove('adm-hidden'); dashboard.classList.add('adm-hidden'); $('#admLoginError').textContent = error; }
  async function loadOverview() {
    const { orders, revenue, bestSellers, reservationCount, rating } = await api('/admin/overview');
    $('#admStats').innerHTML = [
      ['Orders', orders.total], ['Paid revenue', money(revenue.total)], ['Today', money(revenue.today)],
      ['Upcoming reservations', reservationCount], ['Approved reviews', `${rating.average} / 5 · ${rating.count}`],
      ['Best sellers', bestSellers.slice(0, 3).map(item => `${esc(item.name)} (${item.quantity})`).join('<br>') || 'No sales yet']
    ].map(([label, value]) => `<div class="adm-stat"><small>${label}</small><strong>${value}</strong></div>`).join('');
  }
  const statusOptions = { delivery:['pending','confirmed','preparing','out_for_delivery','delivered','completed','cancelled'], pickup:['pending','confirmed','preparing','ready_for_pickup','completed','cancelled'] };
  async function loadOrders() {
    const data = await api('/admin/orders');
    panel.innerHTML = `<table class="adm-table"><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total / payment</th><th>Status</th></tr></thead><tbody>${data.orders.map(order => `<tr><td>${esc(order.orderNumber)}<br><small>${esc(order.fulfillment)} · ${esc(new Date(order.createdAt).toLocaleString())}</small></td><td>${esc(order.customerName)}<br>${esc(order.phone)}</td><td>${order.items.map(item => `${item.qty} × ${esc(item.name)}`).join('<br>')}</td><td>${money(order.total)}<br><small>Payment: ${esc(order.paymentStatus)}</small></td><td>${esc(order.status)}<div class="adm-row-actions"><select data-order-status="${esc(order.orderNumber)}">${statusOptions[order.fulfillment].map(s => `<option value="${s}" ${s===order.status?'selected':''}>${s.replaceAll('_',' ')}</option>`).join('')}</select><button class="adm-btn" data-save-order="${esc(order.orderNumber)}">Save</button></div></td></tr>`).join('') || '<tr><td colspan="5">No orders found.</td></tr>'}</tbody></table>`;
  }
  async function loadReservations() {
    const data = await api('/admin/reservations');
    panel.innerHTML = `<table class="adm-table"><thead><tr><th>Ref</th><th>Customer</th><th>Guests</th><th>Date/time</th><th>Status</th></tr></thead><tbody>${data.reservations.map(r => `<tr><td>${esc(r.reservationNumber)}</td><td>${esc(r.customerName)}<br>${esc(r.phone)}<br>${esc(r.email)}</td><td>${esc(r.guestsLabel)}</td><td>${esc(r.date)} ${esc(String(r.time).slice(0,5))}</td><td>${esc(r.status)}<div class="adm-row-actions"><select data-res-status="${esc(r.id)}">${['confirmed','rejected','cancelled','completed'].map(s=>`<option value="${s}">${s}</option>`).join('')}</select><button class="adm-btn" data-save-res="${esc(r.id)}">Save</button></div></td></tr>`).join('') || '<tr><td colspan="5">No reservations.</td></tr>'}</tbody></table>`;
  }
  async function loadReviews() {
    const data = await api('/admin/reviews?status=pending');
    panel.innerHTML = `<table class="adm-table"><thead><tr><th>Customer</th><th>Rating</th><th>Review</th><th>Moderation</th></tr></thead><tbody>${data.reviews.map(r=>`<tr><td>${esc(r.name)}<br><small>${esc(r.email)}</small></td><td>${r.rating}/5</td><td>${esc(r.review)}</td><td><div class="adm-row-actions"><button class="adm-btn" data-review="${esc(r.id)}" data-moderation="approved">Approve</button><button class="adm-btn" data-review="${esc(r.id)}" data-moderation="rejected">Reject</button></div></td></tr>`).join('') || '<tr><td colspan="4">No pending reviews.</td></tr>'}</tbody></table>`;
  }
  async function loadProducts() {
    const data = await api('/admin/products');
    panel.innerHTML = `<table class="adm-table"><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Availability</th></tr></thead><tbody>${data.products.map(p=>`<tr><td>${esc(p.name)}<br><small>${esc(p.id)}</small></td><td>${esc(p.category)}</td><td><input type="number" step="0.01" min="0" value="${Number(p.price)}" data-price="${esc(p.id)}" aria-label="Price for ${esc(p.name)}"></td><td><label><input type="checkbox" data-active="${esc(p.id)}" ${p.available?'checked':''}> Available</label><button class="adm-btn" data-save-product="${esc(p.id)}">Save</button></td></tr>`).join('')}</tbody></table>`;
  }
  async function loadTab() {
    $('#admPanelTitle').textContent = activeTab[0].toUpperCase()+activeTab.slice(1);
    $('#admError').textContent = '';
    try { if (activeTab==='orders') await loadOrders(); else if (activeTab==='reservations') await loadReservations(); else if(activeTab==='reviews') await loadReviews(); else await loadProducts(); }
    catch (error) { $('#admError').textContent = error.message; if (/owner access|sign in/i.test(error.message)) showLoggedOut(error.message); }
  }
  async function showDashboard(user) { login.classList.add('adm-hidden'); dashboard.classList.remove('adm-hidden'); $('#admWelcome').textContent = `Signed in as ${user.name} · Owner`; await loadOverview(); await loadTab(); }
  loginForm.addEventListener('submit', async event => { event.preventDefault(); const form = new FormData(event.currentTarget); try { const { user } = await api('/auth/login',{method:'POST',body:JSON.stringify({email:form.get('email'),password:form.get('password')})}); if(user.role!=='admin'){await api('/auth/logout',{method:'POST'});throw new Error('This account does not have owner access.');} await showDashboard(user); } catch(error) { showLoggedOut(error.message); } });
  $('#admLogout').addEventListener('click', async () => { try { await api('/auth/logout',{method:'POST'}); } finally { showLoggedOut(); } });
  $('#admRefresh').addEventListener('click', async () => { try { await loadOverview(); await loadTab(); } catch(error) { $('#admError').textContent=error.message; } });
  document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click',()=>{activeTab=button.dataset.tab;document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b===button)));loadTab();}));
  panel.addEventListener('click', async event => {
    const button=event.target.closest('button'); if(!button) return;
    try {
      if(button.dataset.saveOrder){const select=panel.querySelector(`[data-order-status="${CSS.escape(button.dataset.saveOrder)}"]`);await api(`/admin/orders/${encodeURIComponent(button.dataset.saveOrder)}/status`,{method:'PATCH',body:JSON.stringify({status:select.value})});}
      else if(button.dataset.saveRes){const select=panel.querySelector(`[data-res-status="${CSS.escape(button.dataset.saveRes)}"]`);await api(`/admin/reservations/${encodeURIComponent(button.dataset.saveRes)}/status`,{method:'PATCH',body:JSON.stringify({status:select.value})});}
      else if(button.dataset.review){await api(`/admin/reviews/${encodeURIComponent(button.dataset.review)}/moderation`,{method:'PATCH',body:JSON.stringify({status:button.dataset.moderation})});}
      else if(button.dataset.saveProduct){const id=button.dataset.saveProduct;const price=Number(panel.querySelector(`[data-price="${CSS.escape(id)}"]`).value);const available=panel.querySelector(`[data-active="${CSS.escape(id)}"]`).checked;await api(`/admin/products/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({price,available})});}
      await loadOverview(); await loadTab();
    } catch(error) { $('#admError').textContent=error.message; }
  });
  api('/auth/session').then(({user})=>user?.role==='admin'?showDashboard(user):showLoggedOut()).catch(()=>showLoggedOut());
})();
