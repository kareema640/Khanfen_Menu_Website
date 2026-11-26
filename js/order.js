(function () {
  const tabsEl = document.getElementById('orderTabs');
  const searchBarEl = document.getElementById('ordSearchBar');
  const gridEl = document.getElementById('orderGrid');
  const modal = document.getElementById('productModal');
  const backdrop = document.getElementById('productModalBackdrop');
  const modalBody = document.getElementById('productModalBody');
  const closeBtn = document.getElementById('closeProductModal');
  if (!tabsEl || !gridEl || !window.MENU || !window.KEHNFAN_CART) return;

  const { products, currency } = window.MENU;
  const CART = window.KEHNFAN_CART;
  const byId = Object.fromEntries(products.map(p => [p.id, p]));
  const isDrink = p => p.category === 'hot-drinks' || p.category === 'cold-drinks';
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  const SIGNATURE_IDS = new Set([
    'smoked-salmon-cream-cheese-avocado-croissant',
    'scrambled-egg-bacon-croissant',
    'ham-egg-cheese-croissant',
    'cheese-sausage-croissant',
    'warm-ham-cheese-croissant',
    'egg-turkey-sandwich',
    'breakfast-grilled-cheese-sandwich',
    'almond-croissant',
    'pistachio-croissant',
    'buttery-molten-croissant'
  ]);

  const ORDER_CATEGORIES = [
    { id: 'sandwiches', label: 'Sandwiches' },
    { id: 'signature-breakfast', label: 'Signature Breakfast' },
    { id: 'bakery', label: 'Bakery' },
    { id: 'hot-drinks', label: 'Hot Drinks' },
    { id: 'cold-drinks', label: 'Cold Drinks' },
    { id: 'desserts', label: 'Desserts' },
    { id: 'all', label: 'All' }
  ];

  const ADDONS_BY_GROUP = {
    savory: [
      { id: 'bacon', label: 'Crispy turkey bacon', price: 2 },
      { id: 'avocado', label: 'Avocado', price: 1.5 },
      { id: 'hashbrown', label: 'Hash brown', price: 1 }
    ],
    sweet: [
      { id: 'nutella', label: 'Extra Nutella drizzle', price: 1.5 },
      { id: 'strawberries', label: 'Fresh strawberries', price: 2 },
      { id: 'icecream', label: 'Vanilla ice cream scoop', price: 2.5 }
    ],
    drink: [
      { id: 'espresso', label: 'Extra espresso shot', price: 1.5 },
      { id: 'oatmilk', label: 'Oat / Almond milk', price: 1 },
      { id: 'syrup', label: 'Caramel / Vanilla syrup', price: 1 }
    ]
  };

  function getAddonsForProduct(p) {
    if (isDrink(p)) return ADDONS_BY_GROUP.drink;
    if (p.category === 'desserts' || p.category === 'bakery') return ADDONS_BY_GROUP.sweet;
    return ADDONS_BY_GROUP.savory;
  }

  function filterProducts(catId) {
    if (catId === 'all') return products.filter(p => Boolean(p.image));
    if (catId === 'sandwiches') return products.filter(p => p.category === 'sandwiches');
    if (catId === 'signature-breakfast') return products.filter(p => SIGNATURE_IDS.has(p.id));
    return products.filter(p => p.category === catId);
  }

  const params = new URLSearchParams(window.location.search);
  const initialCat = params.get('cat');
  let activeCat = ORDER_CATEGORIES.some(c => c.id === initialCat) ? initialCat : 'sandwiches';
  let searchQuery = (params.get('q') || '').trim();

  let modalState = {
    productId: null,
    size: 'Regular',
    addons: new Set(),
    qty: 1,
    lastTrigger: null
  };

  function inCartCount(id) {
    return CART.loadCart().reduce((sum, item) => item.id === id ? sum + item.qty : sum, 0);
  }

  function renderTabs() {
    tabsEl.innerHTML = ORDER_CATEGORIES.map(c => {
      const active = !searchQuery && c.id === activeCat;
      return `<button type="button" class="ord-tab${active ? ' is-active' : ''}" data-ord-cat="${c.id}" aria-pressed="${active}">${esc(c.label)}</button>`;
    }).join('');
  }

  function getDisplayedProducts() {
    if (searchQuery) {
      if (window.KEHNFAN_SEARCH && typeof window.KEHNFAN_SEARCH.searchProducts === 'function') {
        return window.KEHNFAN_SEARCH.searchProducts(searchQuery);
      }
      const q = searchQuery.toLowerCase();
      return products.filter(p => p.name.toLowerCase().includes(q));
    }
    return filterProducts(activeCat);
  }

  function clearSearchFilter() {
    searchQuery = '';
    const url = new URL(window.location.href);
    url.searchParams.delete('q');
    window.history.replaceState({}, '', url.toString());
    const navInput = document.getElementById('navSearchInput');
    const navClear = document.getElementById('navSearchClear');
    if (navInput) navInput.value = '';
    if (navClear) navClear.hidden = true;
    renderTabs();
    renderGrid();
  }

  function renderGrid() {
    const items = getDisplayedProducts();
    const drinksView = !searchQuery && (activeCat === 'hot-drinks' || activeCat === 'cold-drinks');
    gridEl.classList.toggle('ord-grid--drinks', drinksView);

    if (searchBarEl) {
      if (searchQuery) {
        searchBarEl.innerHTML = `<span class="ord-search-bar__text">Showing <strong>${items.length}</strong> ${items.length === 1 ? 'result' : 'results'} for &ldquo;<strong>${esc(searchQuery)}</strong>&rdquo;</span>
          <button type="button" class="ord-search-clear" id="ordSearchClear">Clear search</button>`;
        searchBarEl.hidden = false;
      } else {
        searchBarEl.hidden = true;
        searchBarEl.innerHTML = '';
      }
    }

    if (!items.length) {
      gridEl.innerHTML = `<div class="ord-empty">
        <p>No items matched &ldquo;<strong>${esc(searchQuery)}</strong>&rdquo;. Try another keyword or browse our categories above.</p>
        <button type="button" class="btn btn--olive" id="ordEmptyReset">View All Menu Items</button>
      </div>`;
      return;
    }

    gridEl.innerHTML = items.map(p => {
      const qtyInCart = inCartCount(p.id);
      const drink = isDrink(p);
      const mediaHTML = p.image
        ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">`
        : `<div class="ph">${esc(p.name)}</div>`;
      return `<article class="ord-card${drink ? ' ord-card--drink' : ''}">
        <div class="ord-card__media">
          <button type="button" class="ord-card__open" data-open-product="${esc(p.id)}" aria-label="Customize and add ${esc(p.name)}">
            ${mediaHTML}
          </button>
        </div>
        <div class="ord-card__foot">
          <button type="button" class="ord-card__info" data-open-product="${esc(p.id)}">
            <h3>${esc(p.name)}</h3>
            <span>${esc(currency)}${p.price}</span>
          </button>
          <button type="button" class="ord-card__add${qtyInCart > 0 ? ' is-added' : ''}" data-quick-add="${esc(p.id)}" aria-label="Add ${esc(p.name)} to cart">
            ${qtyInCart > 0 ? '✓' : '+'}
          </button>
        </div>
      </article>`;
    }).join('');
  }

  function calcModalUnitTotal(p) {
    const sizeDelta = modalState.size === 'Large' ? 2 : 0;
    const availableAddons = getAddonsForProduct(p);
    let addonsDelta = 0;
    for (const a of availableAddons) {
      if (modalState.addons.has(a.id)) addonsDelta += a.price;
    }
    return Number((p.price + sizeDelta + addonsDelta).toFixed(2));
  }

  function renderProductModal() {
    const p = byId[modalState.productId];
    if (!p || !modalBody) return;

    const addonsList = getAddonsForProduct(p);
    const unitTotal = calcModalUnitTotal(p);
    const lineTotal = Number((unitTotal * modalState.qty).toFixed(2));
    const description = p.description || 'Prepared fresh to order at Kehnfan using quality ingredients.';
    const mediaHTML = p.image
      ? `<img src="${esc(p.image)}" alt="${esc(p.name)}">`
      : `<div class="ph">${esc(p.name)}</div>`;

    modalBody.innerHTML = `<div class="prod-modal__media${isDrink(p) ? ' prod-modal__media--drink' : ''}">
        ${mediaHTML}
      </div>
      <div class="prod-modal__content">
        <div class="prod-modal__head">
          <h2 id="prodModalTitle">${esc(p.name)}</h2>
          <span class="prod-modal__base-price">${CART.fmtMoney(p.price)}</span>
        </div>
        <p class="prod-modal__desc">${esc(description)}</p>

        <div class="prod-modal__section">
          <p class="res-label">Size</p>
          <div class="prod-size-row" role="group" aria-label="Size selection">
            <button type="button" class="prod-size-pill${modalState.size === 'Regular' ? ' is-selected' : ''}" data-prod-size="Regular" aria-pressed="${modalState.size === 'Regular'}">Regular</button>
            <button type="button" class="prod-size-pill${modalState.size === 'Large' ? ' is-selected' : ''}" data-prod-size="Large" aria-pressed="${modalState.size === 'Large'}">Large +${esc(currency)}2</button>
          </div>
        </div>

        <div class="prod-modal__section">
          <p class="res-label">Add-ons</p>
          <div class="prod-addons-list">
            ${addonsList.map(a => {
              const checked = modalState.addons.has(a.id);
              return `<label class="prod-addon-row${checked ? ' is-checked' : ''}">
                <span class="prod-addon-left">
                  <input type="checkbox" data-prod-addon="${esc(a.id)}" ${checked ? 'checked' : ''}>
                  <span>${esc(a.label)}</span>
                </span>
                <span class="prod-addon-price">+${CART.fmtMoney(a.price)}</span>
              </label>`;
            }).join('')}
          </div>
        </div>

        <div class="prod-modal__footer">
          <div class="prod-qty-pill" aria-label="Quantity selector">
            <button type="button" id="prodModalDec" aria-label="Decrease quantity" ${modalState.qty <= 1 ? 'disabled' : ''}>−</button>
            <span id="prodModalQty">${modalState.qty}</span>
            <button type="button" id="prodModalInc" aria-label="Increase quantity">+</button>
          </div>
          <button type="button" class="btn btn--olive prod-modal__submit" id="prodModalAdd">
            Add to Cart &middot; ${CART.fmtMoney(lineTotal)}
          </button>
        </div>
      </div>`;
  }

  function openProductModal(productId, triggerEl) {
    const p = byId[productId];
    if (!p || !modal || !backdrop) return;
    modalState = {
      productId,
      size: 'Regular',
      addons: new Set(),
      qty: 1,
      lastTrigger: triggerEl || document.activeElement
    };
    renderProductModal();
    backdrop.hidden = false;
    modal.hidden = false;
    document.body.classList.add('lock');
    modal.scrollTop = 0;
    if (closeBtn) closeBtn.focus();
  }

  function closeProductModal() {
    if (!modal || !backdrop) return;
    modal.hidden = true;
    backdrop.hidden = true;
    const otherOpen = ['fullMenu', 'cartDrawer', 'reviewModal', 'reservationModal'].some(id => {
      const el = document.getElementById(id);
      return el && !el.hidden;
    });
    if (!otherOpen) document.body.classList.remove('lock');
    if (modalState.lastTrigger && typeof modalState.lastTrigger.focus === 'function' && document.contains(modalState.lastTrigger)) {
      modalState.lastTrigger.focus();
    }
  }

  tabsEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-ord-cat]');
    if (!btn) return;
    activeCat = btn.dataset.ordCat;
    clearSearchFilter();
  });

  if (searchBarEl) {
    searchBarEl.addEventListener('click', e => {
      if (e.target.closest('#ordSearchClear')) {
        clearSearchFilter();
      }
    });
  }

  gridEl.addEventListener('click', e => {
    if (e.target.closest('#ordEmptyReset')) {
      activeCat = 'all';
      clearSearchFilter();
      return;
    }
    const quickBtn = e.target.closest('[data-quick-add]');
    if (quickBtn) {
      e.stopPropagation();
      CART.addToCart(quickBtn.dataset.quickAdd, 1, { size: 'Regular', sizeDelta: 0, addons: [] });
      return;
    }

    const openBtn = e.target.closest('[data-open-product]');
    if (openBtn) {
      openProductModal(openBtn.dataset.openProduct, openBtn);
    }
  });

  if (modalBody) {
    modalBody.addEventListener('click', e => {
      const sizeBtn = e.target.closest('[data-prod-size]');
      if (sizeBtn) {
        modalState.size = sizeBtn.dataset.prodSize;
        renderProductModal();
        return;
      }

      if (e.target.closest('#prodModalDec')) {
        modalState.qty = Math.max(1, modalState.qty - 1);
        renderProductModal();
        return;
      }

      if (e.target.closest('#prodModalInc')) {
        modalState.qty = Math.min(99, modalState.qty + 1);
        renderProductModal();
        return;
      }

      if (e.target.closest('#prodModalAdd')) {
        const p = byId[modalState.productId];
        if (!p) return;
        const availableAddons = getAddonsForProduct(p);
        const chosenAddons = availableAddons
          .filter(a => modalState.addons.has(a.id))
          .map(a => ({ id: a.id, label: a.label, price: a.price }));
        CART.addToCart(p.id, modalState.qty, {
          size: modalState.size,
          sizeDelta: modalState.size === 'Large' ? 2 : 0,
          addons: chosenAddons
        });
        closeProductModal();
      }
    });

    modalBody.addEventListener('change', e => {
      const cb = e.target.closest('[data-prod-addon]');
      if (!cb) return;
      const addonId = cb.dataset.prodAddon;
      if (cb.checked) modalState.addons.add(addonId);
      else modalState.addons.delete(addonId);
      renderProductModal();
    });
  }

  if (closeBtn) closeBtn.addEventListener('click', closeProductModal);
  if (backdrop) backdrop.addEventListener('click', closeProductModal);
  if (modal) {
    modal.addEventListener('click', e => {
      if (e.target === modal) closeProductModal();
    });
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal && !modal.hidden) closeProductModal();
  });

  window.addEventListener('kehnfan:search', e => {
    searchQuery = String((e.detail && e.detail.query) || '').trim();
    renderTabs();
    renderGrid();
    if (searchQuery) {
      gridEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  window.addEventListener('kehnfan:cart-updated', renderGrid);
  window.addEventListener('storage', renderGrid);

  renderTabs();
  renderGrid();
})();
