(function () {
  const { products, categories, allPreview, featured, currency } = window.MENU;
  const $ = (s, r = document) => r.querySelector(s);
  const byId = Object.fromEntries(products.map(p => [p.id, p]));
  const catLabel = Object.fromEntries(categories.map(c => [c.id, c.label]));
  const price = p => currency + p.price;
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const isDrink = p => p.category === 'hot-drinks' || p.category === 'cold-drinks';
  const productUrl = p => 'product.html?id=' + encodeURIComponent(p.id);

  const img = (p, cls = '') => p.image
    ? `<img class="${cls}" src="${p.image}" alt="${esc(p.name)}" loading="lazy">`
    : `<div class="ph ${cls}" role="img" aria-label="${esc(p.name)} – photo coming soon">Photo coming soon</div>`;

  /* Shared Cart, Preferences, Promo Codes & Favorites */
  const CART_KEY = 'kehnfan_cart_v1';
  const PREFS_KEY = 'kehnfan_order_prefs_v1';
  const FAV_KEY = 'kehnfan_favorites_v1';
  const DELIVERY_FEE = 5;

  const fmtMoney = n => {
    const val = Number(n || 0);
    return Number.isInteger(val) ? currency + val : currency + Number(val.toFixed(2));
  };

  function makeItemKey(id, size, addons) {
    const addonIds = (addons || []).map(a => a.id).sort().join(',');
    return `${id}::${size || 'Regular'}::${addonIds}`;
  }

  function normalizeCartItem(raw) {
    if (!raw || !byId[raw.id] || !(Number(raw.qty) > 0)) return null;
    const product = byId[raw.id];
    const size = raw.size === 'Large' ? 'Large' : 'Regular';
    const sizeDelta = size === 'Large' ? 2 : 0;
    const addons = Array.isArray(raw.addons)
      ? raw.addons
          .filter(a => a && a.id && a.label && Number(a.price) >= 0)
          .map(a => ({ id: String(a.id), label: String(a.label), price: Number(a.price) }))
      : [];
    const addonsDelta = addons.reduce((s, a) => s + a.price, 0);
    const qty = Math.floor(Number(raw.qty));
    const unitPrice = Number((product.price + sizeDelta + addonsDelta).toFixed(2));
    const lineTotal = Number((unitPrice * qty).toFixed(2));
    return {
      key: raw.key || makeItemKey(raw.id, size, addons),
      id: raw.id,
      qty,
      size,
      sizeDelta,
      addons,
      unitPrice,
      lineTotal
    };
  }

  function loadCart() {
    try {
      const raw = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      if (!Array.isArray(raw)) return [];
      return raw.map(normalizeCartItem).filter(Boolean);
    } catch {
      return [];
    }
  }

  function saveCart(cart) {
    const clean = cart.map(item => ({
      key: item.key,
      id: item.id,
      qty: item.qty,
      size: item.size,
      sizeDelta: item.sizeDelta,
      addons: item.addons
    }));
    try { localStorage.setItem(CART_KEY, JSON.stringify(clean)); } catch {}
    renderCart();
    window.dispatchEvent(new CustomEvent('kehnfan:cart-updated'));
  }

  function loadPrefs() {
    try {
      const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      return {
        fulfillment: raw.fulfillment === 'pickup' ? 'pickup' : 'delivery',
        promoCode: typeof raw.promoCode === 'string' ? raw.promoCode.trim().toUpperCase() : ''
      };
    } catch {
      return { fulfillment: 'delivery', promoCode: '' };
    }
  }

  function savePrefs(patch) {
    const next = { ...loadPrefs(), ...patch };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch {}
    renderCart();
    window.dispatchEvent(new CustomEvent('kehnfan:cart-updated'));
    return next;
  }

  function evaluatePromo(code, subtotal, fulfillment) {
    const clean = String(code || '').trim().toUpperCase();
    if (!clean) return { valid: false, code: '', discount: 0, waivedFee: false, message: 'Enter a promo code.' };
    if (clean === 'KHANFEM10') {
      return { valid: true, code: clean, discount: Number((subtotal * 0.1).toFixed(2)), waivedFee: false, message: 'KHANFEM10 applied · 10% off' };
    }
    if (clean === 'MORNING15') {
      return { valid: true, code: clean, discount: Number((subtotal * 0.15).toFixed(2)), waivedFee: false, message: 'MORNING15 applied · 15% off' };
    }
    if (clean === 'FREEDEL') {
      return {
        valid: true,
        code: clean,
        discount: 0,
        waivedFee: fulfillment === 'delivery',
        message: fulfillment === 'delivery' ? 'FREEDEL applied · Free delivery' : 'FREEDEL saved (active on Delivery)'
      };
    }
    if (clean === 'SAVE5') {
      if (subtotal < 20) {
        return { valid: false, code: '', discount: 0, waivedFee: false, message: 'SAVE5 requires a subtotal of $20 or more.' };
      }
      return { valid: true, code: clean, discount: 5, waivedFee: false, message: 'SAVE5 applied · $5 off' };
    }
    return { valid: false, code: '', discount: 0, waivedFee: false, message: 'Invalid code. Try KHANFEM10, MORNING15, or FREEDEL.' };
  }

  function calcTotals(cart, prefsOverride) {
    const prefs = prefsOverride || loadPrefs();
    const totalCount = cart.reduce((s, i) => s + i.qty, 0);
    const subtotal = Number(cart.reduce((s, i) => s + i.lineTotal, 0).toFixed(2));
    let fee = prefs.fulfillment === 'pickup' ? 0 : DELIVERY_FEE;
    let discount = 0;
    let promoMessage = '';
    let promoCode = '';

    if (prefs.promoCode) {
      const res = evaluatePromo(prefs.promoCode, subtotal, prefs.fulfillment);
      if (res.valid) {
        promoCode = res.code;
        discount = res.discount;
        if (res.waivedFee) fee = 0;
        promoMessage = res.message;
      }
    }

    const total = Number(Math.max(0, subtotal - discount + fee).toFixed(2));
    return { totalCount, subtotal, discount, fee, total, promoCode, promoMessage, fulfillment: prefs.fulfillment };
  }

  function formatItemMeta(item) {
    const parts = [];
    if (item.size && item.size !== 'Regular') parts.push(item.size);
    if (item.addons && item.addons.length) parts.push(...item.addons.map(a => `+ ${a.label}`));
    return parts.join(' · ');
  }

  function loadFavs() {
    try {
      const raw = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
      return Array.isArray(raw) ? raw.filter(id => byId[id]) : [];
    } catch {
      return [];
    }
  }

  function isFavorite(id) {
    return loadFavs().includes(id);
  }

  function toggleFavorite(id) {
    const favs = loadFavs();
    const idx = favs.indexOf(id);
    if (idx >= 0) favs.splice(idx, 1);
    else favs.push(id);
    try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); } catch {}
    return idx < 0;
  }

  let toastTimer = null;
  function showToast(titleText) {
    const toast = $('#cartToast');
    if (!toast) return;
    const cart = loadCart();
    const { totalCount, subtotal } = calcTotals(cart);
    toast.innerHTML = `<span class="cart-toast__check" aria-hidden="true">✓</span>
      <div class="cart-toast__copy">
        <strong>${esc(titleText)}</strong>
        <span>${totalCount} ${totalCount === 1 ? 'item' : 'items'} &middot; ${fmtMoney(subtotal)}</span>
      </div>
      <button class="cart-toast__btn" type="button" data-open-cart>View Cart</button>`;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4200);
  }

  function addToCart(id, qty = 1, opts = {}) {
    const p = byId[id];
    const amount = Math.max(1, Math.floor(Number(qty) || 1));
    if (!p) return;
    const size = opts.size === 'Large' ? 'Large' : 'Regular';
    const sizeDelta = size === 'Large' ? 2 : 0;
    const addons = Array.isArray(opts.addons) ? opts.addons : [];
    const key = makeItemKey(id, size, addons);

    const cart = loadCart();
    const existing = cart.find(item => item.key === key);
    if (existing) {
      existing.qty += amount;
    } else {
      cart.push(normalizeCartItem({ key, id, qty: amount, size, sizeDelta, addons }));
    }
    saveCart(cart);
    const statusEl = $('#cartStatus');
    if (statusEl) statusEl.hidden = true;
    const label = size === 'Large' ? `${p.name} (Large)` : p.name;
    showToast(`${amount} × ${label} added`);
  }

  function setCartQty(keyOrId, qty) {
    const cart = loadCart();
    const next = qty <= 0
      ? cart.filter(item => item.key !== keyOrId && item.id !== keyOrId)
      : cart.map(item => (item.key === keyOrId || item.id === keyOrId)
          ? normalizeCartItem({ ...item, qty: Math.floor(qty) })
          : item);
    saveCart(next.filter(Boolean));
  }

  function clearCart() {
    saveCart([]);
  }

  let promoStatusMsg = '';
  let promoStatusIsError = false;

  function ensureDrawerStructure() {
    const drawer = $('#cartDrawer');
    if (!drawer || drawer.dataset.enhanced === '1') return;
    drawer.dataset.enhanced = '1';

    const bodyEl = $('#cartItems');
    if (bodyEl && !$('#cartDrawerMode')) {
      const modeBar = document.createElement('div');
      modeBar.id = 'cartDrawerMode';
      modeBar.className = 'cart-drawer__mode';
      drawer.insertBefore(modeBar, bodyEl);
    }
  }

  function renderCart() {
    ensureDrawerStructure();
    const cart = loadCart();
    const prefs = loadPrefs();
    const totals = calcTotals(cart, prefs);

    const badge = $('#cartBadge');
    if (badge) {
      badge.textContent = totals.totalCount;
      badge.hidden = totals.totalCount === 0;
    }

    renderCartPage();

    const modeBar = $('#cartDrawerMode');
    if (modeBar) {
      const isDel = prefs.fulfillment === 'delivery';
      modeBar.hidden = !cart.length;
      modeBar.innerHTML = `<div class="cart-mode-toggle" role="tablist" aria-label="Fulfillment method">
        <button type="button" class="cart-mode-btn${isDel ? ' is-active' : ''}" role="tab" aria-selected="${isDel}" data-cart-fulfillment="delivery">Delivery</button>
        <button type="button" class="cart-mode-btn${!isDel ? ' is-active' : ''}" role="tab" aria-selected="${!isDel}" data-cart-fulfillment="pickup">Pickup</button>
      </div>`;
    }

    const itemsEl = $('#cartItems');
    const summaryEl = $('#cartSummary');
    if (!itemsEl || !summaryEl) return;

    if (!cart.length) {
      const menuHref = document.body.dataset.page === 'order'
        ? '#orderTabs'
        : (document.body.dataset.page ? 'order.html' : '#menu');
      itemsEl.innerHTML = `<div class="cart-empty">
        <p>Your cart is empty.</p>
        <div class="cart-empty__actions">
          <a class="btn btn--olive" href="${menuHref}" data-close-cart>Explore Menu</a>
          <a class="btn cart-view-btn" href="cart.html" data-view-cart>View Cart</a>
        </div>
      </div>`;
      summaryEl.hidden = true;
      return;
    }

    itemsEl.innerHTML = cart.map(item => {
      const p = byId[item.id];
      const metaText = formatItemMeta(item);
      return `<div class="cart-item">
        <a class="cart-item__img${isDrink(p) ? ' cart-item__img--drink' : ''}" href="${productUrl(p)}">${img(p)}</a>
        <div class="cart-item__meta">
          <a class="cart-item__name" href="${productUrl(p)}">${esc(p.name)}</a>
          ${metaText ? `<span class="cart-item__custom">${esc(metaText)}</span>` : ''}
          <span class="cart-item__price">${fmtMoney(item.unitPrice)} each</span>
          <div class="cart-item__qty">
            <button type="button" data-cart-dec="${esc(item.key)}" aria-label="Decrease quantity of ${esc(p.name)}">−</button>
            <span>${item.qty}</span>
            <button type="button" data-cart-inc="${esc(item.key)}" aria-label="Increase quantity of ${esc(p.name)}">+</button>
          </div>
        </div>
        <div class="cart-item__right">
          <strong class="cart-item__subtotal">${fmtMoney(item.lineTotal)}</strong>
          <button class="cart-item__remove-icon" type="button" data-cart-del="${esc(item.key)}" aria-label="Remove ${esc(p.name)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
              <path d="M10 11v6M14 11v6"></path>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
            </svg>
          </button>
        </div>
      </div>`;
    }).join('');

    const promoFeedback = totals.promoCode
      ? totals.promoMessage
      : (promoStatusMsg || '');
    const promoErrorClass = !totals.promoCode && promoStatusIsError ? ' is-error' : '';

    summaryEl.innerHTML = `<form class="cart-promo" id="cartPromoForm" novalidate>
        <div class="cart-promo__row">
          <input id="cartPromoInput" type="text" value="${esc(totals.promoCode)}" placeholder="Promo code (e.g. KHANFEM10)" aria-label="Promo code">
          <button class="cart-promo__apply" type="submit">Apply</button>
        </div>
        ${promoFeedback ? `<div class="cart-promo__msg${promoErrorClass}">
          <span>${esc(promoFeedback)}</span>
          ${totals.promoCode ? '<button type="button" class="cart-promo__clear" id="cartPromoClear">Remove</button>' : ''}
        </div>` : ''}
      </form>
      <div class="cart-summary__row"><span>Subtotal</span><strong>${fmtMoney(totals.subtotal)}</strong></div>
      ${totals.discount > 0 ? `<div class="cart-summary__row cart-summary__discount"><span>Promo (${esc(totals.promoCode)})</span><strong>−${fmtMoney(totals.discount)}</strong></div>` : ''}
      <div class="cart-summary__row"><span>${totals.fulfillment === 'pickup' ? 'Pickup fee' : 'Delivery fee'}</span><strong>${fmtMoney(totals.fee)}</strong></div>
      <div class="cart-summary__row cart-summary__total"><span>Total</span><strong>${fmtMoney(totals.total)}</strong></div>
      <div class="cart-drawer__actions">
        <a class="btn cart-view-btn" href="cart.html" id="cartViewBtn" data-view-cart>View Cart</a>
        <button class="btn btn--olive cart-checkout" id="cartCheckout" type="button">Checkout →</button>
      </div>
      <div class="cart-drawer__clear-row">
        <button class="cart-clear" id="cartClear" type="button">Clear cart</button>
      </div>`;
    summaryEl.hidden = false;
  }

  function renderCartPage() {
    const cartPageRoot = $('#cartPageRoot');
    if (!cartPageRoot) return;
    const cart = loadCart();
    const totals = calcTotals(cart);

    if (!cart.length) {
      cartPageRoot.innerHTML = `<div class="chk-empty">
        <p class="eyebrow">YOUR CART</p>
        <h1 class="res-title res-title--center">Your cart is <em>empty</em></h1>
        <p>Add freshly made sandwiches, coffee, or desserts from our menu to get started.</p>
        <a class="btn btn--olive" href="order.html">Order Online &rarr;</a>
      </div>`;
      return;
    }

    cartPageRoot.innerHTML = `<div class="cart-page__head">
        <div>
          <p class="eyebrow">YOUR CART</p>
          <h1>Review Your <em>Cart</em></h1>
        </div>
        <span class="cart-page__count">${totals.totalCount} ${totals.totalCount === 1 ? 'item' : 'items'}</span>
      </div>
      <div class="cart-layout">
        <div class="cart-list">
          ${cart.map(item => {
            const p = byId[item.id];
            const categoryName = catLabel[p.category] || p.category;
            const metaText = formatItemMeta(item);
            return `<article class="cart-page__item">
              <a class="cart-page__img${isDrink(p) ? ' cart-page__img--drink' : ''}" href="${productUrl(p)}">${img(p)}</a>
              <div class="cart-page__meta">
                <span class="cart-page__cat">${esc(categoryName)}</span>
                <a class="cart-page__name" href="${productUrl(p)}">${esc(p.name)}</a>
                ${metaText ? `<span class="cart-item__custom">${esc(metaText)}</span>` : ''}
                <span class="cart-page__unit">${fmtMoney(item.unitPrice)} each</span>
                <div class="cart-item__qty">
                  <button type="button" data-cart-dec="${esc(item.key)}" aria-label="Decrease quantity of ${esc(p.name)}">−</button>
                  <span>${item.qty}</span>
                  <button type="button" data-cart-inc="${esc(item.key)}" aria-label="Increase quantity of ${esc(p.name)}">+</button>
                </div>
              </div>
              <div class="cart-page__right">
                <strong class="cart-page__subtotal">${fmtMoney(item.lineTotal)}</strong>
                <button class="cart-item__remove" type="button" data-cart-del="${esc(item.key)}" aria-label="Remove ${esc(p.name)}">Remove</button>
              </div>
            </article>`;
          }).join('')}
          <div class="cart-page__foot">
            <button class="cart-clear" id="cartPageClear" type="button">Clear cart</button>
            <a class="cart-page__more" href="order.html">+ Add more items</a>
          </div>
        </div>

        <aside class="cart-summary-card" aria-label="Order summary">
          <h2>Order Summary</h2>
          <div class="cart-summary__row"><span>Items</span><strong>${totals.totalCount}</strong></div>
          <div class="cart-summary__row"><span>Subtotal</span><strong>${fmtMoney(totals.subtotal)}</strong></div>
          ${totals.discount > 0 ? `<div class="cart-summary__row cart-summary__discount"><span>Promo (${esc(totals.promoCode)})</span><strong>−${fmtMoney(totals.discount)}</strong></div>` : ''}
          <div class="cart-summary__row"><span>${totals.fulfillment === 'pickup' ? 'Pickup fee' : 'Delivery fee'}</span><strong>${fmtMoney(totals.fee)}</strong></div>
          <div class="cart-summary__row cart-summary__total"><span>Total</span><strong>${fmtMoney(totals.total)}</strong></div>
          <a class="btn btn--olive cart-summary-card__btn" href="checkout.html">Proceed to Checkout &rarr;</a>
          <a class="cart-summary-card__link" href="order.html">Continue Ordering</a>
        </aside>
      </div>`;
  }

  /* Cart Drawer controls */
  const cartDrawer = $('#cartDrawer');
  const cartBackdrop = $('#cartBackdrop');
  const cartToggle = $('#cartToggle');

  function openCart() {
    if (!cartDrawer || !cartBackdrop) {
      window.location.href = 'cart.html';
      return;
    }
    renderCart();
    cartDrawer.hidden = false;
    cartBackdrop.hidden = false;
    document.body.classList.add('lock');
    if (cartToggle) cartToggle.setAttribute('aria-expanded', 'true');
    const closeBtn = $('#cartClose');
    if (closeBtn) closeBtn.focus();
  }

  function closeCart() {
    if (!cartDrawer || !cartBackdrop) return;
    cartDrawer.hidden = true;
    cartBackdrop.hidden = true;
    const otherOpen = ['fullMenu', 'reviewModal', 'reservationModal', 'productModal'].some(id => {
      const el = document.getElementById(id);
      return el && !el.hidden;
    });
    if (!otherOpen) document.body.classList.remove('lock');
    if (cartToggle) cartToggle.setAttribute('aria-expanded', 'false');
  }

  if (cartToggle) cartToggle.addEventListener('click', openCart);
  if ($('#cartClose')) $('#cartClose').addEventListener('click', closeCart);
  if (cartBackdrop) cartBackdrop.addEventListener('click', closeCart);

  document.addEventListener('submit', e => {
    if (e.target && e.target.id === 'cartPromoForm') {
      e.preventDefault();
      const input = $('#cartPromoInput');
      const code = input ? input.value.trim().toUpperCase() : '';
      const cart = loadCart();
      const prefs = loadPrefs();
      const { subtotal } = calcTotals(cart, prefs);
      const res = evaluatePromo(code, subtotal, prefs.fulfillment);
      if (res.valid) {
        promoStatusMsg = '';
        promoStatusIsError = false;
        savePrefs({ promoCode: res.code });
      } else {
        promoStatusMsg = res.message;
        promoStatusIsError = true;
        savePrefs({ promoCode: '' });
      }
    }
  });

  document.addEventListener('click', e => {
    const addBtn = e.target.closest('[data-add-id]');
    if (addBtn) {
      e.preventDefault();
      e.stopPropagation();
      addToCart(addBtn.dataset.addId, 1);
      return;
    }

    const fulBtn = e.target.closest('[data-cart-fulfillment]');
    if (fulBtn) {
      savePrefs({ fulfillment: fulBtn.dataset.cartFulfillment });
      return;
    }

    if (e.target.closest('#cartPromoClear')) {
      promoStatusMsg = '';
      promoStatusIsError = false;
      savePrefs({ promoCode: '' });
      return;
    }

    if (e.target.closest('#cartClear') || e.target.closest('#cartPageClear')) {
      clearCart();
      return;
    }

    if (e.target.closest('#cartCheckout')) {
      const cart = loadCart();
      if (!cart.length) return;
      closeCart();
      window.location.href = 'checkout.html';
      return;
    }

    const decBtn = e.target.closest('[data-cart-dec]');
    if (decBtn) {
      const key = decBtn.dataset.cartDec;
      const item = loadCart().find(i => i.key === key || i.id === key);
      if (item) setCartQty(item.key, item.qty - 1);
      return;
    }

    const incBtn = e.target.closest('[data-cart-inc]');
    if (incBtn) {
      const key = incBtn.dataset.cartInc;
      const item = loadCart().find(i => i.key === key || i.id === key);
      if (item) setCartQty(item.key, item.qty + 1);
      return;
    }

    const delBtn = e.target.closest('[data-cart-del]');
    if (delBtn) {
      setCartQty(delBtn.dataset.cartDel, 0);
      return;
    }

    if (e.target.closest('[data-open-cart]')) {
      const toast = $('#cartToast');
      if (toast) toast.hidden = true;
      openCart();
      return;
    }

    if (e.target.closest('[data-view-cart]')) {
      closeCart();
      if (document.body.dataset.page === 'cart') {
        e.preventDefault();
      }
      return;
    }

    if (e.target.closest('[data-close-cart]')) {
      closeCart();
    }
  });

  window.addEventListener('storage', e => {
    if (e.key === CART_KEY || e.key === PREFS_KEY) renderCart();
  });

  window.KEHNFAN_CART = {
    loadCart,
    saveCart,
    addToCart,
    setCartQty,
    clearCart,
    loadPrefs,
    savePrefs,
    evaluatePromo,
    calcTotals,
    fmtMoney,
    formatItemMeta,
    openCart,
    closeCart
  };

  /* Homepage Menu & Favorites */
  const menuGrid = $('#menuGrid');
  if (menuGrid) {
    let current = 'all';

    const card = p => `<article class="card${isDrink(p) ? ' card--drink' : ''}">
      <div class="card__media">
        <a class="card__link" href="${productUrl(p)}" aria-label="View ${esc(p.name)} details">${img(p)}</a>
        <button class="card__add" type="button" data-add-id="${esc(p.id)}" aria-label="Add ${esc(p.name)} to cart">+</button>
      </div>
      <div class="card__info">
        <a href="${productUrl(p)}">
          <h3>${esc(p.name)}</h3>
          <span>${price(p)}</span>
        </a>
      </div>
    </article>`;

    const list = id => id === 'all' ? null : products.filter(p => p.category === id);

    function tabs(el) {
      el.innerHTML = categories.map(c =>
        `<button type="button" data-cat="${c.id}" aria-pressed="${c.id === current}">${c.label}</button>`).join('');
    }

    function renderGrid(el, isFull) {
      const drinksView = current === 'hot-drinks' || current === 'cold-drinks' || current === 'drinks';
      el.classList.toggle('grid--drinks', drinksView);
      if (current === 'drinks') {
        const hot = products.filter(p => p.category === 'hot-drinks');
        const cold = products.filter(p => p.category === 'cold-drinks');
        el.innerHTML = `<h3 class="grid__heading">Hot Drinks</h3>${hot.map(card).join('')}`
          + `<h3 class="grid__heading">Cold Drinks</h3>${cold.map(card).join('')}`;
        return;
      }
      const items = isFull
        ? (list(current) || products)
        : (list(current) || allPreview.map(i => byId[i]).filter(Boolean));
      el.innerHTML = items.map(card).join('');
    }

    function render() {
      tabs($('#menuTabs'));
      tabs($('#fullTabs'));
      renderGrid($('#menuGrid'), false);
      renderGrid($('#fullGrid'), true);
    }

    function setCategory(id) {
      current = id;
      render();
    }

    document.addEventListener('click', e => {
      const t = e.target.closest('#menuTabs button, #fullTabs button');
      if (t) return setCategory(t.dataset.cat);
      const c = e.target.closest('.cats button');
      if (c) {
        setCategory(c.dataset.cat);
        $('#menu').scrollIntoView({ behavior: 'smooth' });
      }
    });

    /* Full-menu overlay */
    const full = $('#fullMenu');
    function openFull() { full.hidden = false; document.body.classList.add('lock'); full.scrollTop = 0; $('#closeFull').focus(); }
    function closeFull() { full.hidden = true; document.body.classList.remove('lock'); $('#openFull').focus(); }
    $('#openFull').onclick = openFull;
    $('#closeFull').onclick = closeFull;
    full.addEventListener('click', e => { if (e.target.closest('[data-close]')) { e.preventDefault(); closeFull(); window.scrollTo({ top: 0 }); } });

    /* Favorites carousel */
    const track = $('#favTrack');
    track.innerHTML = featured.map(i => byId[i]).filter(Boolean).map(p => `<article class="fav__card">
      <a class="fav__media${isDrink(p) ? ' fav__media--drink' : ''}" href="${productUrl(p)}" aria-label="View ${esc(p.name)} details">${img(p)}</a>
      <a class="fav__title" href="${productUrl(p)}"><h3>${esc(p.name)}</h3></a>
      <div class="fav__foot"><strong>${price(p)}</strong><button type="button" data-add-id="${esc(p.id)}" aria-label="Add ${esc(p.name)} to cart">Add +</button></div>
    </article>`).join('');

    const prev = $('#favPrev'), next = $('#favNext');
    const step = () => track.firstElementChild.getBoundingClientRect().width + parseFloat(getComputedStyle(track).columnGap || 0);
    const sync = () => { prev.disabled = track.scrollLeft < 4; next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4; };
    prev.onclick = () => track.scrollBy({ left: -step(), behavior: 'smooth' });
    next.onclick = () => track.scrollBy({ left: step(), behavior: 'smooth' });
    track.addEventListener('scroll', sync, { passive: true });
    addEventListener('resize', sync);

    render();
    sync();
  }

  /* Product Details Page */
  const detailRoot = $('#productDetailRoot');
  if (detailRoot) {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    const p = id ? byId[id] : null;

    if (!p) {
      detailRoot.innerHTML = `<div class="product-not-found">
        <p class="eyebrow">NOT FOUND</p>
        <h1>Product not found</h1>
        <p class="product-detail__desc">We could not find that menu item. Explore our freshly made sandwiches, bakery, drinks, and desserts.</p>
        <a class="btn btn--olive" href="index.html#menu">Explore the Menu →</a>
      </div>`;
    } else {
      document.title = `${p.name} – Khanfem`;
      let qty = 1;
      const favActive = isFavorite(p.id);
      const categoryName = catLabel[p.category] || p.category;
      const description = p.description || 'Prepared fresh to order at Khanfem using quality ingredients.';

      detailRoot.innerHTML = `<div class="product-detail">
        <div class="product-detail__media${isDrink(p) ? ' product-detail__media--drink' : ''}">
          ${img(p)}
        </div>
        <div class="product-detail__info">
          <p class="eyebrow">${esc(categoryName.toUpperCase())}</p>
          <div class="product-detail__top">
            <h1>${esc(p.name)}</h1>
            <button class="product-fav" id="detailFavBtn" type="button" aria-pressed="${favActive}" aria-label="Save ${esc(p.name)} to favorites">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                <path d="M12 20.5s-7.5-4.7-9.4-9.2C1.2 8 3.2 4.5 6.8 4.5c2 0 3.7 1 5.2 2.8 1.5-1.8 3.2-2.8 5.2-2.8 3.6 0 5.6 3.5 4.2 6.8-1.9 4.5-9.4 9.2-9.4 9.2z"/>
              </svg>
            </button>
          </div>
          <p class="product-detail__price">${price(p)}</p>
          <p class="product-detail__desc">${esc(description)}</p>
          <div class="product-detail__divider"></div>
          <div class="product-detail__actions">
            <div class="qty-stepper" aria-label="Quantity selector">
              <button type="button" id="qtyDec" aria-label="Decrease quantity" disabled>−</button>
              <span id="qtyValue" aria-live="polite">1</span>
              <button type="button" id="qtyInc" aria-label="Increase quantity">+</button>
            </div>
            <button class="btn btn--olive product-detail__add" id="detailAddBtn" type="button">Add to Cart</button>
          </div>
          <div class="product-detail__feedback" id="detailFeedback" hidden>
            <span id="detailFeedbackText"></span>
            <button type="button" data-open-cart>View Cart →</button>
          </div>
        </div>
      </div>`;

      const qtyValEl = $('#qtyValue');
      const qtyDecBtn = $('#qtyDec');
      const qtyIncBtn = $('#qtyInc');
      const favBtn = $('#detailFavBtn');
      const addBtn = $('#detailAddBtn');
      const feedback = $('#detailFeedback');
      const feedbackText = $('#detailFeedbackText');

      const updateQty = next => {
        qty = Math.max(1, next);
        qtyValEl.textContent = qty;
        qtyDecBtn.disabled = qty <= 1;
      };

      qtyDecBtn.addEventListener('click', () => updateQty(qty - 1));
      qtyIncBtn.addEventListener('click', () => updateQty(qty + 1));

      favBtn.addEventListener('click', () => {
        const nextFav = toggleFavorite(p.id);
        favBtn.setAttribute('aria-pressed', String(nextFav));
      });

      addBtn.addEventListener('click', () => {
        addToCart(p.id, qty);
        feedbackText.textContent = `Added ${qty} × ${p.name} to your cart.`;
        feedback.hidden = false;
      });
    }
  }

  /* Nav & Escape key */
  const nav = $('#nav'), toggle = $('#navToggle');
  if (nav) {
    const alwaysSolid = Boolean(document.body.dataset.page);
    const onScroll = () => nav.classList.toggle('nav--solid', alwaysSolid || scrollY > 40);
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    if (toggle) {
      toggle.onclick = () => {
        const o = nav.classList.toggle('nav--open');
        toggle.setAttribute('aria-expanded', o);
      };
    }
    const navLinks = $('#navLinks');
    if (navLinks && toggle) {
      navLinks.addEventListener('click', () => {
        nav.classList.remove('nav--open');
        toggle.setAttribute('aria-expanded', false);
      });
    }
  }

  /* Menu Search Engine & Navbar Search */
  const SEARCH_ALIASES = {
    coffee: ['hot-drinks', 'cold-drinks', 'espresso', 'latte', 'americano', 'cappuccino', 'mocha', 'macchiato', 'cortado'],
    tea: ['chai', 'matcha', 'iced-tea'],
    breakfast: ['sandwiches', 'bakery', 'egg', 'croissant', 'pancakes', 'shakshuka', 'waffles'],
    sweet: ['desserts', 'bakery', 'chocolate', 'nutella', 'berry', 'pancakes', 'waffles', 'cake', 'crepe'],
    iced: ['cold-drinks', 'iced'],
    hot: ['hot-drinks'],
    cold: ['cold-drinks'],
    'قهوة': ['hot-drinks', 'cold-drinks', 'espresso', 'latte', 'americano', 'cappuccino', 'mocha'],
    'قهوه': ['hot-drinks', 'cold-drinks', 'espresso', 'latte', 'americano', 'cappuccino', 'mocha'],
    'لاتيه': ['latte', 'spanish', 'matcha'],
    'فطار': ['sandwiches', 'bakery', 'egg', 'croissant', 'pancakes', 'waffles'],
    'ساندويتش': ['sandwiches', 'sandwich', 'croissant', 'brioche'],
    'كرواسون': ['croissant'],
    'بان كيك': ['mini-pancakes', 'pancakes'],
    'وافل': ['waffles'],
    'شاي': ['chai', 'matcha', 'tea'],
    'عصير': ['smoothie', 'lemonade', 'juice', 'cold-drinks'],
    'حلو': ['desserts', 'chocolate', 'nutella', 'berry', 'waffles', 'pancakes'],
    'حلويات': ['desserts', 'chocolate', 'nutella', 'waffles', 'pancakes'],
    'كيك': ['cheesecake', 'brownies', 'molten', 'desserts']
  };

  function searchProducts(rawQuery) {
    const q = String(rawQuery || '').trim().toLowerCase();
    if (!q) return [];
    const tokens = q.split(/\s+/).filter(Boolean);
    const expandedTerms = new Set(tokens);
    for (const tok of tokens) {
      if (SEARCH_ALIASES[tok]) {
        for (const alias of SEARCH_ALIASES[tok]) expandedTerms.add(alias);
      }
    }
    if (SEARCH_ALIASES[q]) {
      for (const alias of SEARCH_ALIASES[q]) expandedTerms.add(alias);
    }

    const scored = [];
    for (const p of products) {
      const nameL = p.name.toLowerCase();
      const catL = (catLabel[p.category] || p.category || '').toLowerCase();
      const descL = (p.description || '').toLowerCase();
      const idL = p.id.toLowerCase();
      let score = 0;

      if (nameL === q) score += 80;
      else if (nameL.startsWith(q)) score += 45;
      else if (nameL.includes(q)) score += 25;

      let directTokenHits = 0;
      for (const tok of tokens) {
        const escaped = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`(^|\\s|-)${escaped}`, 'i').test(nameL)) {
          score += 22;
          directTokenHits++;
        } else if (nameL.includes(tok)) {
          score += 14;
          directTokenHits++;
        } else if (catL.includes(tok) || idL.includes(tok)) {
          score += 8;
          directTokenHits++;
        } else if (descL.includes(tok)) {
          score += 5;
          directTokenHits++;
        }
      }

      if (directTokenHits === 0) {
        for (const term of expandedTerms) {
          if (p.category === term || idL.includes(term) || nameL.includes(term) || descL.includes(term)) {
            score += 4;
          }
        }
      }

      if (score > 0) scored.push({ product: p, score });
    }

    scored.sort((a, b) => b.score - a.score || a.product.price - b.product.price || a.product.name.localeCompare(b.product.name));
    return scored.map(entry => entry.product);
  }

  window.KEHNFAN_SEARCH = { searchProducts };

  const searchWrap = $('#navSearchWrap');
  const searchForm = $('#navSearchForm');
  const searchInput = $('#navSearchInput');
  const searchClear = $('#navSearchClear');
  const searchBtn = $('#navSearchBtn');
  const searchResults = $('#navSearchResults');

  let activeSearchIdx = -1;

  function closeSearchDropdown(collapseMobile) {
    activeSearchIdx = -1;
    if (searchResults) searchResults.hidden = true;
    if (collapseMobile && searchWrap) searchWrap.classList.remove('is-open');
  }

  function renderSearchDropdown() {
    if (!searchInput || !searchResults) return;
    const q = searchInput.value.trim();
    if (searchClear) searchClear.hidden = q.length === 0;
    if (!q) {
      activeSearchIdx = -1;
      searchResults.hidden = true;
      searchResults.innerHTML = '';
      return;
    }

    const matches = searchProducts(q);
    activeSearchIdx = -1;
    if (!matches.length) {
      searchResults.innerHTML = `<div class="nav-search-empty">
        No items matched "<strong>${esc(q)}</strong>". Try Latte, Brioche, Croissant, or Waffles.
      </div>`;
      searchResults.hidden = false;
      return;
    }

    const topMatches = matches.slice(0, 7);
    const seeAllHref = `order.html?q=${encodeURIComponent(q)}`;
    searchResults.innerHTML = topMatches.map((p, idx) => {
      const categoryName = catLabel[p.category] || p.category;
      return `<div class="nav-search-item" role="option" aria-selected="false" data-search-idx="${idx}">
        <a class="nav-search-link" href="${productUrl(p)}">
          <span class="nav-search-thumb${isDrink(p) ? ' nav-search-thumb--drink' : ''}">${img(p)}</span>
          <span class="nav-search-copy">
            <strong>${esc(p.name)}</strong>
            <span>${esc(categoryName)} &middot; ${price(p)}</span>
          </span>
        </a>
        <button class="nav-search-add" type="button" data-add-id="${esc(p.id)}" aria-label="Add ${esc(p.name)} to cart">+</button>
      </div>`;
    }).join('') + `<a class="nav-search-all" href="${seeAllHref}" data-search-all="${esc(q)}">
      See all ${matches.length} ${matches.length === 1 ? 'result' : 'results'} in Order Online &rarr;
    </a>`;
    searchResults.hidden = false;
  }

  function updateHighlightedResult() {
    if (!searchResults) return;
    const rows = Array.from(searchResults.querySelectorAll('.nav-search-item'));
    rows.forEach((row, i) => {
      const selected = i === activeSearchIdx;
      row.classList.toggle('is-active', selected);
      row.setAttribute('aria-selected', String(selected));
    });
  }

  function applyOrderSearch(query) {
    const clean = String(query || '').trim();
    if (document.body.dataset.page === 'order') {
      const url = new URL(window.location.href);
      if (clean) url.searchParams.set('q', clean);
      else url.searchParams.delete('q');
      window.history.replaceState({}, '', url.toString());
      window.dispatchEvent(new CustomEvent('kehnfan:search', { detail: { query: clean } }));
      closeSearchDropdown(true);
      if (searchInput) searchInput.blur();
      return;
    }
    if (clean) {
      window.location.href = `order.html?q=${encodeURIComponent(clean)}`;
    }
  }

  if (searchInput && searchForm && searchWrap) {
    if (document.body.dataset.page === 'order') {
      const qParam = new URLSearchParams(window.location.search).get('q') || '';
      if (qParam) {
        searchInput.value = qParam;
        if (searchClear) searchClear.hidden = false;
      }
    }

    searchInput.addEventListener('input', () => {
      renderSearchDropdown();
    });

    searchInput.addEventListener('focus', () => {
      if (searchInput.value.trim()) renderSearchDropdown();
    });

    searchInput.addEventListener('keydown', e => {
      if (!searchResults || searchResults.hidden) return;
      const rows = searchResults.querySelectorAll('.nav-search-item');
      if (!rows.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeSearchIdx = (activeSearchIdx + 1) % rows.length;
        updateHighlightedResult();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeSearchIdx = activeSearchIdx <= 0 ? rows.length - 1 : activeSearchIdx - 1;
        updateHighlightedResult();
      }
    });

    if (searchClear) {
      searchClear.addEventListener('click', () => {
        searchInput.value = '';
        searchClear.hidden = true;
        renderSearchDropdown();
        searchInput.focus();
        if (document.body.dataset.page === 'order') {
          applyOrderSearch('');
        }
      });
    }

    if (searchBtn) {
      searchBtn.addEventListener('click', e => {
        const compactMode = window.innerWidth <= 1000;
        if (compactMode && !searchWrap.classList.contains('is-open')) {
          e.preventDefault();
          searchWrap.classList.add('is-open');
          searchInput.focus();
          if (searchInput.value.trim()) renderSearchDropdown();
        }
      });
    }

    searchForm.addEventListener('submit', e => {
      e.preventDefault();
      if (searchResults && !searchResults.hidden && activeSearchIdx >= 0) {
        const activeLink = searchResults.querySelector(`.nav-search-item[data-search-idx="${activeSearchIdx}"] .nav-search-link`);
        if (activeLink) {
          window.location.href = activeLink.getAttribute('href');
          return;
        }
      }
      const q = searchInput.value.trim();
      if (!q) {
        if (window.innerWidth <= 1000 && !searchWrap.classList.contains('is-open')) {
          searchWrap.classList.add('is-open');
        }
        searchInput.focus();
        return;
      }
      applyOrderSearch(q);
    });

    if (searchResults) {
      searchResults.addEventListener('click', e => {
        const allLink = e.target.closest('[data-search-all]');
        if (allLink && document.body.dataset.page === 'order') {
          e.preventDefault();
          applyOrderSearch(allLink.dataset.searchAll);
          return;
        }
        const itemLink = e.target.closest('.nav-search-link');
        if (itemLink) {
          closeSearchDropdown(true);
        }
      });
    }

    document.addEventListener('click', e => {
      if (!e.target.closest('#navSearchWrap')) {
        closeSearchDropdown(true);
      }
    });
  }

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if ((searchResults && !searchResults.hidden) || (searchWrap && searchWrap.classList.contains('is-open'))) {
      closeSearchDropdown(true);
      if (searchInput && document.activeElement === searchInput) searchInput.blur();
      return;
    }
    if (cartDrawer && !cartDrawer.hidden) {
      closeCart();
      return;
    }
    const full = $('#fullMenu');
    if (full && !full.hidden) {
      full.hidden = true;
      document.body.classList.remove('lock');
      const openFullBtn = $('#openFull');
      if (openFullBtn) openFullBtn.focus();
    }
  });

  /* Footer order tracking quick shortcut */
  document.querySelectorAll('.news').forEach(box => {
    const input = box.querySelector('input');
    const btn = box.querySelector('button');
    const goToTracking = () => {
      const code = input ? input.value.trim().replace(/^#/, '') : '';
      window.location.href = code
        ? `tracking.html?order=${encodeURIComponent(code.toUpperCase())}`
        : 'tracking.html';
    };
    if (btn) btn.addEventListener('click', goToTracking);
    if (input) {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          goToTracking();
        }
      });
    }
  });

  renderCart();
})();
