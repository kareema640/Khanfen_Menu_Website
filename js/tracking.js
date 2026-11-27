(function () {
  const root = document.getElementById('trackingRoot');
  if (!root || !window.MENU) return;

  const CART = window.KEHNFAN_CART;
  const { currency } = window.MENU;
  const LAST_ORDER_KEY = 'kehnfan_last_order_v1';
  const ORDERS_MAP_KEY = 'kehnfan_orders_v1';

  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const fmtMoney = n => {
    if (CART) return CART.fmtMoney(n);
    const val = Number(n || 0);
    return Number.isInteger(val) ? currency + val : currency + Number(val.toFixed(2));
  };

  let currentOrder = null;
  let pollTimer = null;
  let mapsConfig = null;
  let mapInitializedFor = '';
  let quotaExceeded = false;

  const quotaBanner = document.getElementById('gmpQuotaBanner');
  window.addEventListener('gmp-quota-exceeded', () => {
    quotaExceeded = true;
    if (quotaBanner) quotaBanner.hidden = false;
    if (currentOrder && currentOrder.fulfillment !== 'pickup') {
      renderMapFallback(currentOrder);
    }
  });

  function readSavedOrder(orderNumber) {
    try {
      const clean = String(orderNumber || '').trim().replace(/^#/, '').toUpperCase();
      if (clean) {
        const map = JSON.parse(localStorage.getItem(ORDERS_MAP_KEY) || '{}');
        if (map && typeof map === 'object') {
          const matchKey = Object.keys(map).find(k => k.toUpperCase() === clean);
          if (matchKey && map[matchKey]) return map[matchKey];
        }
      }
      const last = JSON.parse(localStorage.getItem(LAST_ORDER_KEY) || 'null');
      if (last && (!clean || String(last.orderNumber || '').toUpperCase() === clean)) {
        return last;
      }
    } catch {}
    return null;
  }

  function saveOrderToStorage(order) {
    if (!order || !order.orderNumber) return;
    try {
      localStorage.setItem(LAST_ORDER_KEY, JSON.stringify(order));
      const storedMap = JSON.parse(localStorage.getItem(ORDERS_MAP_KEY) || '{}');
      const map = storedMap && typeof storedMap === 'object' && !Array.isArray(storedMap) ? storedMap : {};
      map[order.orderNumber] = order;
      localStorage.setItem(ORDERS_MAP_KEY, JSON.stringify(map));
    } catch {}
  }

  function computeLocalTracking(order) {
    if (order && order.tracking && Array.isArray(order.tracking.timeline)) {
      return order.tracking;
    }
    const createdMs = Date.parse(order.createdAt) || Date.now();
    const elapsedSec = Math.max(0, Math.floor((Date.now() - createdMs) / 1000));
    const isDelivery = order.fulfillment !== 'pickup';

    let stageIndex = 0;
    if (elapsedSec >= 180) stageIndex = 3;
    else if (elapsedSec >= 60) stageIndex = 2;
    else if (elapsedSec >= 20) stageIndex = 1;

    const stageAt = offsetSec => new Date(createdMs + offsetSec * 1000).toISOString();
    const defs = isDelivery
      ? [
          { key: 'received', label: 'Order Received', description: 'Your order has been received by Kehnfan', offset: 0 },
          { key: 'preparing', label: 'Being Prepared', description: 'Fresh from our kitchen', offset: 20 },
          { key: 'on_the_way', label: 'On the Way', description: 'Dispatched for delivery to your address', offset: 60 },
          { key: 'delivered', label: 'Delivered', description: 'Enjoy your breakfast', offset: 180 }
        ]
      : [
          { key: 'received', label: 'Order Received', description: 'Your pickup order is confirmed', offset: 0 },
          { key: 'preparing', label: 'Being Prepared', description: 'Fresh from our kitchen', offset: 20 },
          { key: 'on_the_way', label: 'Ready for Pickup', description: 'Waiting at the Kehnfan Nasr City counter', offset: 60 },
          { key: 'delivered', label: 'Picked Up', description: 'Enjoy your breakfast', offset: 180 }
        ];

    const timeline = defs.map((d, idx) => ({
      key: d.key,
      label: d.label,
      description: d.description,
      timestamp: idx <= stageIndex ? stageAt(d.offset) : null,
      completed: idx <= stageIndex,
      current: idx === stageIndex
    }));

    return {
      status: defs[stageIndex].key,
      statusLabel: defs[stageIndex].label,
      stageIndex,
      timeline
    };
  }

  function formatClock(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function formatPaymentLabel(payment) {
    if (!payment) return 'Cash on Delivery';
    if (payment.method === 'cash-delivery') return 'Cash on Delivery';
    if (payment.method === 'cash-pickup') return 'Cash on Pickup';
    if (payment.method === 'card') return `${payment.brand || 'Card'} ·••• ${payment.last4 || ''}`.trim();
    if (payment.method === 'online') return `Online · ${payment.wallet || 'Digital Wallet'}`;
    return payment.method;
  }

  function getEtaTimeText(order) {
    const isDelivery = order.fulfillment !== 'pickup';
    const createdMs = Date.parse(order.createdAt) || Date.now();
    const etaMax = Number(order.etaMaxMinutes) || (isDelivery ? 35 : 20);
    const arrivalIso = order.estimatedArrivalAt || new Date(createdMs + etaMax * 60 * 1000).toISOString();
    return formatClock(arrivalIso);
  }

  function buildMapsExternalUrl(queryText) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(queryText || 'Nasr City, Cairo, Egypt')}`;
  }

  function loadGoogleMapsBootstrap(apiKey) {
    if (window.google && window.google.maps && typeof window.google.maps.importLibrary === 'function') {
      return Promise.resolve();
    }
    if (window.__kehnfanMapsLoaderPromise) {
      return window.__kehnfanMapsLoaderPromise;
    }
    window.__kehnfanMapsLoaderPromise = new Promise((resolve, reject) => {
      try {
        (g => {
          var h, a, k, p = 'The Google Maps JavaScript API', c = 'google', l = 'importLibrary', q = '__ib__', m = document, b = window;
          b = b[c] || (b[c] = {});
          var d = b.maps || (b.maps = {}), r = new Set(), e = new URLSearchParams(),
            u = () => h || (h = new Promise(async (f, n) => {
              await (a = m.createElement('script'));
              e.set('libraries', [...r] + '');
              for (k in g) e.set(k.replace(/[A-Z]/g, t => '_' + t[0].toLowerCase()), g[k]);
              e.set('callback', c + '.maps.' + q);
              a.src = `https://maps.${c}apis.com/maps/api/js?` + e;
              d[q] = f;
              a.onerror = () => h = n(Error(p + ' could not load.'));
              a.nonce = m.querySelector('script[nonce]')?.nonce || '';
              m.head.append(a);
            }));
          d[l] ? console.warn(p + ' only loads once. Ignoring:', g) : d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n));
        })({
          key: apiKey,
          v: 'weekly'
        });
        resolve();
      } catch (err) {
        reject(err);
      }
    });
    return window.__kehnfanMapsLoaderPromise;
  }

  function setMapOverlayVisible(canvas, visible) {
    const card = canvas && canvas.closest ? canvas.closest('.ord-trk-map-card') : null;
    const overlay = card ? card.querySelector('.ord-trk-map-overlay') : null;
    if (overlay) overlay.hidden = !visible;
  }

  function renderMapFallback(order) {
    const canvas = document.getElementById('deliveryMap');
    if (!canvas) return;
    setMapOverlayVisible(canvas, false);
    const address = order.address || 'Delivery address';
    const mapsHref = buildMapsExternalUrl(address);
    canvas.innerHTML = `<div class="ord-trk-map-fallback">
      <div class="ord-trk-map-pin" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 21s-6-5.4-6-10a6 6 0 1 1 12 0c0 4.6-6 10-6 10z"/>
          <circle cx="12" cy="11" r="2.2"/>
        </svg>
      </div>
      <strong>Delivery destination</strong>
      <span>${esc(address)}</span>
      <a class="btn btn--olive ord-trk-map-link" href="${mapsHref}" target="_blank" rel="noopener noreferrer">Open in Google Maps &rarr;</a>
    </div>`;
  }

  function renderEmbedMap(order, apiKey) {
    const canvas = document.getElementById('deliveryMap');
    if (!canvas || !apiKey) return false;
    setMapOverlayVisible(canvas, true);
    const query = order.address || 'Cairo, Egypt';
    const params = new URLSearchParams({
      key: apiKey,
      q: query,
      zoom: '15',
      solution_id: 'gmp_mcp_codeassist_v1_aistudio'
    });
    canvas.innerHTML = `<iframe
      class="ord-trk-map-iframe"
      title="Delivery location map"
      loading="lazy"
      referrerpolicy="strict-origin-when-cross-origin"
      src="https://www.google.com/maps/embed/v1/place?${params.toString()}"
      allowfullscreen></iframe>`;
    return true;
  }

  async function initDeliveryMap(order) {
    const canvas = document.getElementById('deliveryMap');
    if (!canvas) return;

    const renderKey = `${order.orderNumber}::${order.address}`;
    if (mapInitializedFor === renderKey && canvas.childElementCount > 0) return;

    if (quotaExceeded) {
      renderMapFallback(order);
      return;
    }

    if (!mapsConfig) {
      try {
        const res = await fetch('/api/maps-config');
        if (res.ok) mapsConfig = await res.json();
      } catch {
        mapsConfig = { apiKey: '' };
      }
    }

    const apiKey = mapsConfig && mapsConfig.apiKey ? mapsConfig.apiKey : '';
    if (!apiKey) {
      renderMapFallback(order);
      mapInitializedFor = renderKey;
      return;
    }

    let loc = order.deliveryLocation;
    if ((!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') && order.address) {
      try {
        const geoRes = await fetch(`/api/geocode?address=${encodeURIComponent(order.address)}`);
        if (geoRes.status === 429) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
          renderMapFallback(order);
          mapInitializedFor = renderKey;
          return;
        }
        if (geoRes.ok) {
          const geoData = await geoRes.json().catch(() => ({}));
          if (geoData.quotaExceeded) {
            window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
            renderMapFallback(order);
            mapInitializedFor = renderKey;
            return;
          }
          if (geoData.location && typeof geoData.location.lat === 'number' && typeof geoData.location.lng === 'number') {
            loc = geoData.location;
            order.deliveryLocation = loc;
            saveOrderToStorage(order);
          }
        }
      } catch {}
    }

    if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') {
      renderEmbedMap(order, apiKey);
      mapInitializedFor = renderKey;
      return;
    }

    try {
      await loadGoogleMapsBootstrap(apiKey);
      const { Map } = await google.maps.importLibrary('maps');
      const { AdvancedMarkerElement, PinElement } = await google.maps.importLibrary('marker');

      if (quotaExceeded) {
        renderMapFallback(order);
        return;
      }

      const targetPos = { lat: loc.lat, lng: loc.lng };
      const map = new Map(canvas, {
        center: targetPos,
        zoom: 15,
        mapId: 'DEMO_MAP_ID',
        gestureHandling: 'cooperative',
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio']
      });

      const pin = new PinElement({
        background: '#4a4421',
        borderColor: '#2a1710',
        glyphColor: '#faf0e6'
      });

      const marker = new AdvancedMarkerElement({
        map,
        position: targetPos,
        title: order.address || 'Delivery Location'
      });
      marker.append(pin);
      setMapOverlayVisible(canvas, true);

      mapInitializedFor = renderKey;
    } catch {
      if (!renderEmbedMap(order, apiKey)) {
        renderMapFallback(order);
      }
      mapInitializedFor = renderKey;
    }
  }

  function renderMissingOrder(lookupError) {
    root.innerHTML = `<div class="res-card ord-trk-card ord-conf-empty">
      <p class="eyebrow">ORDER TRACKING</p>
      <h1 class="res-title res-title--center">Track your <em>order</em></h1>
      <p class="ord-conf-empty__desc">Enter your order ID to check live kitchen and delivery progress.</p>
      <form class="ord-lookup-form" id="trkLookupForm" novalidate>
        <input id="trkLookupInput" type="text" placeholder="e.g. KF-ORD-12345" aria-label="Order ID" required>
        <button type="submit" class="btn btn--olive">Track Order</button>
      </form>
      ${lookupError ? `<p class="res-error" role="alert">${esc(lookupError)}</p>` : ''}
      <div class="ord-conf-empty__actions">
        <a class="btn res-btn-outline" href="order.html">Order Online &rarr;</a>
        <a class="btn res-btn-outline" href="index.html#home">Back to Home</a>
      </div>
    </div>`;
  }

  function renderTimeline(tracking, order) {
    const etaTime = getEtaTimeText(order);
    return `<ol class="ord-trk-timeline" aria-label="Order status timeline">
      ${tracking.timeline.map((step, idx) => {
        const stateCls = step.current ? ' is-current' : (step.completed ? ' is-done' : ' is-pending');
        let metaLine = '';
        if (step.timestamp) {
          metaLine = `${step.description} &middot; ${esc(formatClock(step.timestamp))}`;
        } else if (idx === 3 && order.fulfillment === 'delivery' && etaTime) {
          metaLine = `${step.description} &middot; Est. ${esc(etaTime)}`;
        } else {
          metaLine = step.description;
        }
        return `<li class="ord-trk-step${stateCls}">
          <span class="ord-trk-dot" aria-hidden="true">
            ${step.completed
              ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
              : ''}
          </span>
          <div class="ord-trk-step__body">
            <div class="ord-trk-step__head">
              <strong>${esc(step.label)}</strong>
              ${step.current ? '<span class="ord-trk-pill">Current</span>' : ''}
            </div>
            <p>${metaLine}</p>
          </div>
        </li>`;
      }).join('')}
    </ol>`;
  }

  function renderTracking(order) {
    const prevOrderNumber = currentOrder ? currentOrder.orderNumber : '';
    currentOrder = order;
    const tracking = computeLocalTracking(order);
    const isDelivery = order.fulfillment !== 'pickup';
    const etaTime = getEtaTimeText(order);
    const headerMeta = isDelivery
      ? `ORDER #${order.orderNumber} &middot; ${tracking.stageIndex === 3 ? 'DELIVERED' : `ARRIVING ${etaTime}`}`
      : `ORDER #${order.orderNumber} &middot; PICKUP ${order.pickupTime || 'SOON'}`;
    const itemCount = (order.items || []).reduce((sum, i) => sum + Number(i.qty || 0), 0);

    document.title = `Track Order #${order.orderNumber} – Kehnfan`;

    // If re-rendering the same delivery order, only update the header & timeline in place so the Google Map does not flicker!
    const existingTimeline = document.getElementById('trkTimelineMount');
    const existingHeaderMeta = document.getElementById('trkHeaderMeta');
    if (prevOrderNumber === order.orderNumber && existingTimeline && existingHeaderMeta) {
      existingHeaderMeta.innerHTML = headerMeta;
      existingTimeline.innerHTML = renderTimeline(tracking, order);
      return;
    }

    const mapsExternalHref = buildMapsExternalUrl(
      isDelivery ? order.address : 'Kehnfan Nasr City Cairo Egypt'
    );

    const rightPanel = isDelivery
      ? `<div class="ord-trk-map-card">
          <div id="deliveryMap" class="ord-trk-map" aria-label="Delivery location map"></div>
          <div class="ord-trk-map-overlay" hidden>
            <strong>Delivering to</strong>
            <span>${esc(order.address)}</span>
            <a href="${mapsExternalHref}" target="_blank" rel="noopener noreferrer">Open in Maps &nearr;</a>
          </div>
        </div>`
      : `<div class="ord-trk-pickup-card">
          <div class="ord-trk-pickup-top">
            <img class="ord-trk-pickup-img" src="assets/images/backgrounds/our-story.jpg" alt="Kehnfan Cafe Nasr City">
            <div>
              <p class="eyebrow">PICKUP BRANCH</p>
              <h2>Kehnfan &middot; Nasr City</h2>
              <p class="ord-trk-pickup-sub">Nasr City, Cairo, Egypt &middot; Open 15 hours daily</p>
            </div>
          </div>
          <div class="ord-trk-pickup-details">
            <div><span>Pickup window</span><strong>${esc(order.pickupTime || 'ASAP · 15 min')}</strong></div>
            <div><span>Order for</span><strong>${esc(order.fullName || 'Guest')}</strong></div>
            <div><span>Payment</span><strong>${esc(formatPaymentLabel(order.payment))}</strong></div>
          </div>
          <a class="btn res-btn-outline ord-trk-directions-btn" href="${mapsExternalHref}" target="_blank" rel="noopener noreferrer">Get Branch Directions &nearr;</a>
        </div>`;

    const courierBtnHtml = isDelivery
      ? (order.courierPhone
          ? `<a class="btn res-btn-outline ord-trk-call-btn" href="tel:${esc(order.courierPhone)}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.58 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              Call Courier
            </a>`
          : `<button type="button" class="btn res-btn-outline ord-trk-call-btn" id="trkCallCourierBtn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.58 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              Call Courier
            </button>`)
      : `<a class="btn res-btn-outline ord-trk-call-btn" href="tel:+201067182487">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.58 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          Call Café
        </a>`;

    root.innerHTML = `<div class="res-card ord-trk-card">
      <div class="ord-trk-head">
        <div>
          <h1 class="ord-trk-title">Track your <em>order</em></h1>
          <p class="eyebrow ord-trk-sub" id="trkHeaderMeta">${headerMeta}</p>
        </div>
        <a class="ord-trk-receipt-link" href="confirmation.html?order=${encodeURIComponent(order.orderNumber)}">View Order Receipt &rarr;</a>
      </div>

      <div class="ord-trk-grid">
        <div id="trkTimelineMount">
          ${renderTimeline(tracking, order)}
        </div>
        <div class="ord-trk-side">
          ${rightPanel}
        </div>
      </div>

      <div class="ord-trk-summary-strip">
        <span>${itemCount} ${itemCount === 1 ? 'item' : 'items'} &middot; Total <strong>${fmtMoney(order.total)}</strong> &middot; ${esc(formatPaymentLabel(order.payment))}</span>
      </div>

      <p class="ord-trk-courier-note" id="trkCourierNote" role="status" hidden>
        A direct courier phone number is not yet assigned for this order. Need help? Call Kehnfan at <a href="tel:+201067182487">01067182487</a>.
      </p>

      <div class="ord-trk-actions">
        ${courierBtnHtml}
        <a class="btn btn--olive ord-trk-home-btn" href="index.html#home">Back to Home</a>
      </div>
    </div>`;

    if (isDelivery) {
      initDeliveryMap(order);
    }
  }

  async function refreshOrder(orderNumber) {
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}`);
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data && data.order) {
          saveOrderToStorage(data.order);
          renderTracking(data.order);
          return data.order;
        }
      }
    } catch {}
    if (currentOrder) {
      currentOrder.tracking = computeLocalTracking({ ...currentOrder, tracking: null });
      renderTracking(currentOrder);
    }
    return currentOrder;
  }

  function startPolling(orderNumber) {
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      const updated = await refreshOrder(orderNumber);
      const stage = updated && updated.tracking ? updated.tracking.stageIndex : 0;
      if (stage >= 3) {
        clearInterval(pollTimer);
      }
    }, 10000);
  }

  async function init() {
    const params = new URLSearchParams(window.location.search);
    const paramOrder = (params.get('order') || '').trim().replace(/^#/, '');
    const saved = readSavedOrder(paramOrder);

    if (saved) {
      renderTracking(saved);
    }

    const targetNumber = paramOrder || (saved && saved.orderNumber) || '';
    if (!targetNumber) {
      renderMissingOrder('');
      return;
    }

    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(targetNumber)}`);
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data && data.order) {
          saveOrderToStorage(data.order);
          renderTracking(data.order);
          if (!data.order.tracking || data.order.tracking.stageIndex < 3) {
            startPolling(data.order.orderNumber);
          }
          return;
        }
      }
      if (saved) {
        startPolling(saved.orderNumber);
      } else {
        renderMissingOrder(`We could not find order #${targetNumber}.`);
      }
    } catch {
      if (saved) {
        startPolling(saved.orderNumber);
      } else {
        renderMissingOrder('Unable to load order tracking right now.');
      }
    }
  }

  root.addEventListener('click', e => {
    if (e.target.closest('#trkCallCourierBtn')) {
      const note = document.getElementById('trkCourierNote');
      if (note) note.hidden = false;
    }
  });

  root.addEventListener('submit', e => {
    if (e.target && e.target.id === 'trkLookupForm') {
      e.preventDefault();
      const input = document.getElementById('trkLookupInput');
      const code = input ? input.value.trim().replace(/^#/, '') : '';
      if (!code) return;
      window.location.href = `tracking.html?order=${encodeURIComponent(code.toUpperCase())}`;
    }
  });

  init();
})();
