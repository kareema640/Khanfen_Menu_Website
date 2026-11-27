(function () {
  const root = document.getElementById('confirmationRoot');
  if (!root || !window.MENU) return;

  const CART = window.KEHNFAN_CART;
  const { currency } = window.MENU;
  function formatPaymentLabel(payment) {
    if (!payment) return 'Cash on Delivery';
    if (payment.method === 'cash-delivery') return 'Cash on Delivery';
    if (payment.method === 'cash-pickup') return 'Cash on Pickup';
    if (payment.method === 'card') return `${payment.brand || 'Card'} ·••• ${payment.last4 || ''}`.trim();
    if (payment.method === 'online') return `Online · ${payment.wallet || 'Digital Wallet'}`;
    return payment.method;
  }

  function formatEtaDisplay(order) {
    const isDelivery = order.fulfillment !== 'pickup';
    const createdMs = Date.parse(order.createdAt) || Date.now();
    const etaMax = Number(order.etaMaxMinutes) || (isDelivery ? 35 : 20);
    const etaMin = Number(order.etaMinMinutes) || (isDelivery ? 25 : 15);
    const arrivalIso = order.estimatedArrivalAt || new Date(createdMs + etaMax * 60 * 1000).toISOString();
    const arrivalTime = new Date(arrivalIso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    if (!isDelivery) {
      if (order.pickupTime && order.pickupTime !== 'ASAP · 15 min') {
        return `${order.pickupTime} · Nasr City`;
      }
      return `15–20 min · ${arrivalTime}`;
    }
    return `${etaMin}–${etaMax} min · ${arrivalTime}`;
  }

  function renderMissingOrder(lookupError) {
    root.innerHTML = `<div class="res-card ord-conf-card ord-conf-empty">
      <p class="eyebrow">ORDER CONFIRMATION</p>
      <h1 class="res-title res-title--center">Find your <em>order</em></h1>
      <p class="ord-conf-empty__desc">Enter your order ID to view your confirmation receipt and live status, or place a new order from our menu.</p>
      <form class="ord-lookup-form" id="confLookupForm" novalidate>
        <input id="confLookupInput" type="text" placeholder="e.g. KF-ORD-12345" aria-label="Order ID" required>
        <button type="submit" class="btn btn--olive">Find Order</button>
      </form>
      ${lookupError ? `<p class="res-error" role="alert">${esc(lookupError)}</p>` : ''}
      <div class="ord-conf-empty__actions">
        <a class="btn res-btn-outline" href="order.html">Order Online &rarr;</a>
        <a class="btn res-btn-outline" href="index.html#home">Back to Home</a>
      </div>
    </div>`;
  }

  function renderOrder(order) {
    const firstName = (order.fullName || 'friend').trim().split(/\s+/)[0] || 'friend';
    const isDelivery = order.fulfillment !== 'pickup';
    const feeLabel = isDelivery ? 'Delivery' : 'Pickup';
    const etaLabel = isDelivery ? 'ARRIVING IN' : 'READY IN';
    const locationLabel = isDelivery ? 'DELIVERING TO' : 'PICKUP LOCATION';
    const locationValue = isDelivery
      ? order.address
      : `${order.pickupLocation || 'Khanfem · Nasr City, Cairo'}${order.pickupTime ? ` (${order.pickupTime})` : ''}`;

    document.title = `Order #${order.orderNumber} Confirmed – Khanfem`;

    root.innerHTML = `<div class="res-card ord-conf-card">
      <div class="ord-conf-hero">
        <div class="ord-conf-badge" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <p class="eyebrow ord-conf-thanks">THANK YOU, ${esc(firstName.toUpperCase())}</p>
        <h1 class="ord-conf-title">Your order is <em>${isDelivery ? 'on its way' : 'being prepared'}</em></h1>
        <p class="ord-conf-id">Order #${esc(order.orderNumber)}</p>
      </div>

      <section class="ord-conf-ticket" aria-label="Order summary">
        <div class="ord-conf-items">
          ${(order.items || []).map(item => {
            const extras = [];
            if (item.size && item.size !== 'Regular') extras.push(item.size);
            if (Array.isArray(item.addons) && item.addons.length) {
              extras.push(...item.addons.map(a => `+ ${a.label}`));
            }
            const extraText = extras.length ? ` (${extras.join(', ')})` : '';
            return `<div class="ord-conf-row">
              <span class="ord-conf-row__item">
                <span>${item.qty} &times; ${esc(item.name)}${esc(extraText)}</span>
                <small class="ord-conf-row__unit">${fmtMoney(item.unitPrice)} each</small>
              </span>
              <strong class="ord-conf-row__price">${fmtMoney(item.lineTotal)}</strong>
            </div>`;
          }).join('')}
          ${order.discount > 0 ? `<div class="ord-conf-row ord-conf-row--discount">
            <span>Promo (${esc(order.promoCode)})</span>
            <strong>&minus;${fmtMoney(order.discount)}</strong>
          </div>` : ''}
          <div class="ord-conf-row">
            <span>${feeLabel}</span>
            <strong>${fmtMoney(order.fee)}</strong>
          </div>
        </div>

        <div class="ord-conf-ticket__divider"></div>

        <div class="ord-conf-total">
          <span>Total</span>
          <strong>${fmtMoney(order.total)}</strong>
        </div>
      </section>

      <div class="ord-conf-meta-grid">
        <div class="ord-conf-meta-card">
          <p class="ord-conf-meta-card__label">PAYMENT</p>
          <strong class="ord-conf-meta-card__val">${esc(formatPaymentLabel(order.payment))}</strong>
        </div>
        <div class="ord-conf-meta-card">
          <p class="ord-conf-meta-card__label">${etaLabel}</p>
          <strong class="ord-conf-meta-card__val">${esc(formatEtaDisplay(order))}</strong>
        </div>
      </div>

      <div class="ord-conf-meta-card ord-conf-meta-card--full">
        <p class="ord-conf-meta-card__label">${locationLabel}</p>
        <strong class="ord-conf-meta-card__val">${esc(locationValue)}</strong>
        ${isDelivery && order.instructions ? `<span class="ord-conf-meta-card__note">Note: ${esc(order.instructions)}</span>` : ''}
      </div>

      <div class="ord-conf-actions">
        <a class="btn btn--olive ord-conf-track-btn" href="tracking.html?order=${encodeURIComponent(order.orderNumber)}&token=${encodeURIComponent(new URLSearchParams(window.location.search).get('token') || '')}">Track Order &rarr;</a>
        <a class="btn res-btn-outline ord-conf-secondary-btn" href="order.html">Order More</a>
      </div>
    </div>`;
  }

  async function init() {
    const params = new URLSearchParams(window.location.search);
    const orderNumber = (params.get('order') || '').trim().replace(/^#/, '');
    const token = params.get('token') || '';
    if (!orderNumber || !token) { renderMissingOrder('A secure order tracking link is required.'); return; }
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}?token=${encodeURIComponent(token)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.order) { renderMissingOrder(data.error || 'We could not find that order.'); return; }
      renderOrder(data.order);
    } catch { renderMissingOrder('Unable to load order details right now.'); }
  }
  root.addEventListener('submit', async e => {
    if (e.target && e.target.id === 'confLookupForm') {
      e.preventDefault();
      const input = document.getElementById('confLookupInput');
      const code = input ? input.value.trim().replace(/^#/, '') : '';
      if (!code) return;
      window.location.href = `confirmation.html?order=${encodeURIComponent(code.toUpperCase())}`;
    }
  });

  init();
})();
