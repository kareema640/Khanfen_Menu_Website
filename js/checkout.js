(function () {
  const root = document.getElementById('checkoutFlowRoot');
  if (!root || !window.MENU) return;

  const CART = window.KEHNFAN_CART;
  const { products, currency } = window.MENU;
  const byId = Object.fromEntries(products.map(p => [p.id, p]));
  const CART_KEY = 'kehnfan_cart_v1';
  const DELIVERY_FEE = 5;
  const PICKUP_FEE = 0;
  const PICKUP_TIMES = ['ASAP · 15 min', '9:15', '9:30', '9:45'];
  const WALLETS = ['Apple Pay', 'Google Pay', 'Meeza Digital'];

  const PAYMENT_METHODS = [
    {
      id: 'cash-delivery',
      title: 'Cash on Delivery',
      description: 'Pay the courier when your order arrives.',
      icon: '💵',
      fulfillment: 'delivery',
      group: 'cash'
    },
    {
      id: 'cash-pickup',
      title: 'Cash on Pickup',
      description: 'Pay at the counter when you collect.',
      icon: '🏪',
      fulfillment: 'pickup',
      group: 'cash'
    },
    {
      id: 'card',
      title: 'Credit / Debit Card',
      description: 'Visa, Mastercard, Meeza.',
      icon: '💳',
      fulfillment: 'both',
      group: 'card'
    },
    {
      id: 'online',
      title: 'Online Payment',
      description: 'Apple Pay, Google Pay, and supported digital wallets.',
      icon: '📱',
      fulfillment: 'both',
      group: 'online'
    }
  ];

  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const fmtMoney = n => CART ? CART.fmtMoney(n) : (currency + n);

  function getCartItems() {
    if (CART) {
      return CART.loadCart().map(item => ({
        ...item,
        name: byId[item.id].name
      }));
    }
    try {
      const raw = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      if (!Array.isArray(raw)) return [];
      return raw
        .filter(item => item && byId[item.id] && Number(item.qty) > 0)
        .map(item => {
          const product = byId[item.id];
          const qty = Math.floor(Number(item.qty));
          return {
            id: product.id,
            name: product.name,
            size: 'Regular',
            addons: [],
            unitPrice: product.price,
            qty,
            lineTotal: product.price * qty
          };
        });
    } catch {
      return [];
    }
  }

  function clearCartStorage() {
    if (CART) {
      CART.savePrefs({ promoCode: '' });
      CART.clearCart();
      return;
    }
    try { localStorage.removeItem(CART_KEY); } catch {}
    const badge = document.getElementById('cartBadge');
    if (badge) {
      badge.textContent = '0';
      badge.hidden = true;
    }
    window.dispatchEvent(new CustomEvent('kehnfan:cart-updated'));
  }

  const initialPrefs = CART ? CART.loadPrefs() : { fulfillment: 'delivery', promoCode: '' };
  const state = {
    step: 1,
    fulfillment: initialPrefs.fulfillment,
    promoCode: initialPrefs.promoCode,
    fullName: '',
    phone: '',
    address: '',
    instructions: '',
    pickupTime: 'ASAP · 15 min',
    paymentMethod: initialPrefs.fulfillment === 'pickup' ? 'cash-pickup' : 'cash-delivery',
    wallet: 'Apple Pay',
    cardholderName: '',
    cardNumber: '',
    expiry: '',
    cvv: '',
    step1Errors: {},
    step2Errors: {},
    submitError: '',
    submitting: false,
    confirmedOrder: null
  };

  function getCompatibleMethods() {
    return PAYMENT_METHODS.filter(
      m => m.fulfillment === 'both' || m.fulfillment === state.fulfillment
    );
  }

  function ensureCompatiblePaymentMethod() {
    const compatible = getCompatibleMethods();
    if (!compatible.some(m => m.id === state.paymentMethod)) {
      state.paymentMethod = state.fulfillment === 'delivery' ? 'cash-delivery' : 'cash-pickup';
    }
  }

  function getTotals(items) {
    if (CART) {
      return CART.calcTotals(items, { fulfillment: state.fulfillment, promoCode: state.promoCode });
    }
    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
    const fee = state.fulfillment === 'delivery' ? DELIVERY_FEE : PICKUP_FEE;
    return { subtotal, discount: 0, fee, total: subtotal + fee, promoCode: '' };
  }

  function formatCardNumberInput(val) {
    const digits = String(val || '').replace(/\D/g, '').slice(0, 19);
    return digits.replace(/(.{4})/g, '$1 ').trim();
  }

  function formatExpiryInput(val) {
    const digits = String(val || '').replace(/\D/g, '').slice(0, 4);
    if (digits.length <= 2) return digits;
    return `${digits.slice(0, 2)} / ${digits.slice(2)}`;
  }

  function detectCardBrand(digits) {
    if (/^4/.test(digits)) return 'VISA';
    if (/^(5[1-5]|2[2-7])/.test(digits)) return 'MASTERCARD';
    if (/^5078/.test(digits)) return 'MEEZA';
    return 'CARD';
  }

  function formatMaskedCardPreview(digits) {
    if (!digits) return '4242  &bull;&bull;&bull;&bull;  &bull;&bull;&bull;&bull;  4242';
    const padded = digits.padEnd(16, '•');
    const g1 = padded.slice(0, 4);
    const g4 = digits.length >= 12 ? padded.slice(12, 16) : '••••';
    return `${esc(g1)}  &bull;&bull;&bull;&bull;  &bull;&bull;&bull;&bull;  ${esc(g4)}`;
  }

  function luhnValid(digits) {
    let sum = 0;
    let alt = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let n = Number(digits[i]);
      if (alt) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      alt = !alt;
    }
    return sum % 10 === 0;
  }

  function isExpiryValid(expiry) {
    const m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(String(expiry || '').trim());
    if (!m) return false;
    const month = Number(m[1]);
    const year = 2000 + Number(m[2]);
    if (month < 1 || month > 12) return false;
    const now = new Date();
    const currentYm = now.getFullYear() * 12 + (now.getMonth() + 1);
    const expYm = year * 12 + month;
    return expYm >= currentYm;
  }

  function renderProgress() {
    const steps = [
      { num: 1, label: '1 DETAILS' },
      { num: 2, label: '2 PAYMENT' },
      { num: 3, label: '3 DONE' }
    ];
    return `<nav class="res-steps" aria-label="Checkout steps">
      ${steps.map(s => {
        const active = s.num <= state.step;
        const canJump = s.num < state.step && state.step !== 3;
        return `<button type="button" class="res-step-pill${active ? ' is-active' : ''}" data-chk-step="${s.num}" ${canJump ? '' : 'disabled'} aria-current="${s.num === state.step ? 'step' : 'false'}">${s.label}</button>`;
      }).join('')}
    </nav>`;
  }

  function renderOrderSummary(items) {
    const { subtotal, discount, fee, total, promoCode } = getTotals(items);
    const feeLabel = state.fulfillment === 'delivery' ? 'Delivery' : 'Pickup';

    return `<section class="chk-summary" aria-label="Order summary">
      <div class="chk-summary__head">
        <h2 class="chk-summary__title">Order Summary</h2>
        <a class="chk-edit-cart" href="order.html">Add items</a>
      </div>
      ${items.map(item => {
        const metaText = CART ? CART.formatItemMeta(item) : '';
        return `<div class="chk-summary__item">
          <span>
            ${item.qty} &times; ${esc(item.name)}
            ${metaText ? `<span class="chk-summary__unit">(${esc(metaText)})</span>` : ''}
            <span class="chk-summary__unit">${fmtMoney(item.unitPrice)} each</span>
          </span>
          <strong>${fmtMoney(item.lineTotal)}</strong>
        </div>`;
      }).join('')}
      <div class="chk-summary__divider"></div>
      <div class="chk-summary__row"><span>Subtotal</span><span>${fmtMoney(subtotal)}</span></div>
      ${discount > 0 ? `<div class="chk-summary__row cart-summary__discount"><span>Promo (${esc(promoCode)})</span><span>−${fmtMoney(discount)}</span></div>` : ''}
      <div class="chk-summary__row"><span>${feeLabel}</span><span>${fmtMoney(fee)}</span></div>
      <div class="chk-summary__divider"></div>
      <div class="chk-summary__total"><span>Total</span><strong>${fmtMoney(total)}</strong></div>
    </section>`;
  }

  function renderEmptyCart() {
    return `<div class="res-card">
      ${renderProgress()}
      <div class="chk-empty">
        <p class="eyebrow">YOUR CART</p>
        <h1 class="res-title res-title--center">Your cart is <em>empty</em></h1>
        <p>Add freshly made sandwiches, coffee, or desserts from our menu before checking out.</p>
        <a class="btn btn--olive" href="index.html#menu">Explore Menu &rarr;</a>
      </div>
    </div>`;
  }

  function renderStep1(items) {
    if (!items.length) return renderEmptyCart();
    const e = state.step1Errors;
    const isDelivery = state.fulfillment === 'delivery';

    return `<div class="res-card">
      <a class="product-back" href="cart.html">&larr; Back to Cart</a>
      ${renderProgress()}
      <h1 class="res-title">Almost <em>there</em></h1>

      <div class="chk-toggle" role="tablist" aria-label="Fulfillment method">
        <button type="button" class="chk-toggle__btn${isDelivery ? ' is-active' : ''}" role="tab" aria-selected="${isDelivery}" data-fulfillment="delivery">
          <span aria-hidden="true">🛵</span> Delivery
        </button>
        <button type="button" class="chk-toggle__btn${!isDelivery ? ' is-active' : ''}" role="tab" aria-selected="${!isDelivery}" data-fulfillment="pickup">
          <span aria-hidden="true">🛍️</span> Pickup
        </button>
      </div>

      <form class="res-form" id="checkoutStep1Form" novalidate>
        <div class="res-field${e.fullName ? ' is-invalid' : ''}">
          <label for="chkName">Full name</label>
          <input id="chkName" name="fullName" type="text" value="${esc(state.fullName)}" placeholder="Layla Hassan" autocomplete="name" required>
          <span class="res-field-err" ${e.fullName ? '' : 'hidden'}>${esc(e.fullName || '')}</span>
        </div>

        <div class="res-field${e.phone ? ' is-invalid' : ''}">
          <label for="chkPhone">Phone number</label>
          <input id="chkPhone" name="phone" type="tel" value="${esc(state.phone)}" placeholder="+20 100 123 4567" autocomplete="tel" required>
          <span class="res-field-err" ${e.phone ? '' : 'hidden'}>${esc(e.phone || '')}</span>
        </div>

        ${isDelivery ? `
          <div class="res-field${e.address ? ' is-invalid' : ''}">
            <label for="chkAddress">Delivery address</label>
            <input id="chkAddress" name="address" type="text" value="${esc(state.address)}" placeholder="12 Nile Corniche, Maadi, Cairo" autocomplete="street-address" required>
            <span class="res-field-err" ${e.address ? '' : 'hidden'}>${esc(e.address || '')}</span>
          </div>

          <div class="res-field">
            <label for="chkInstructions">Delivery instructions <span class="rev-opt">(optional)</span></label>
            <input id="chkInstructions" name="instructions" type="text" value="${esc(state.instructions)}" placeholder="Ring bell twice, leave at door">
          </div>
        ` : `
          <div class="res-section">
            <p class="res-label">Pickup time</p>
            <div class="chk-pickup-pills" role="group" aria-label="Pickup time">
              ${PICKUP_TIMES.map(slot => {
                const selected = state.pickupTime === slot;
                return `<button type="button" class="chk-pickup-pill${selected ? ' is-selected' : ''}" data-pickup-time="${esc(slot)}" aria-pressed="${selected}">${esc(slot)}</button>`;
              }).join('')}
            </div>
            <span class="res-field-err" ${e.pickupTime ? '' : 'hidden'}>${esc(e.pickupTime || '')}</span>
          </div>

          <div class="chk-branch-card">
            <img class="chk-branch-thumb" src="assets/images/backgrounds/our-story.jpg" alt="Kehnfan Cafe Nasr City">
            <div class="chk-branch-meta">
              <strong>Kehnfan &middot; Nasr City</strong>
              <span>Nasr City, Cairo &middot; Open 15 hours daily</span>
            </div>
          </div>
        `}

        ${renderOrderSummary(items)}

        <button type="submit" class="btn btn--olive res-continue">Continue to Payment &rarr;</button>
      </form>
    </div>`;
  }

  function renderCardDetailsForm(items) {
    const { total } = getTotals(items);
    const e = state.step2Errors;
    const digits = state.cardNumber.replace(/\D/g, '');
    const brand = detectCardBrand(digits);
    const cashMethodId = state.fulfillment === 'delivery' ? 'cash-delivery' : 'cash-pickup';

    return `<div class="res-card">
      ${renderProgress()}
      <h1 class="res-title">Card <em>details</em></h1>

      <div class="chk-mode-pills" role="group" aria-label="Switch payment mode">
        <button type="button" class="chk-mode-pill" data-pay-switch="${cashMethodId}">Cash</button>
        <button type="button" class="chk-mode-pill is-active" data-pay-switch="card" aria-pressed="true">Card</button>
        <button type="button" class="chk-mode-pill" data-pay-switch="online">Online</button>
      </div>

      <div class="chk-card-preview" aria-hidden="true">
        <div class="chk-card-preview__top">
          <span class="chk-card-preview__brand">Kehnfan</span>
          <span class="chk-card-preview__net">${esc(brand)}</span>
        </div>
        <div class="chk-card-preview__num" id="cardPreviewNum">${formatMaskedCardPreview(digits)}</div>
        <div class="chk-card-preview__foot">
          <div>
            <span>CARDHOLDER</span>
            <strong id="cardPreviewHolder">${esc((state.cardholderName || 'LAYLA HASSAN').toUpperCase())}</strong>
          </div>
          <div>
            <span>EXPIRES</span>
            <strong id="cardPreviewExp">${esc(state.expiry || 'MM / YY')}</strong>
          </div>
        </div>
      </div>

      <form class="res-form" id="checkoutCardForm" novalidate>
        <div class="res-field${e.cardholderName ? ' is-invalid' : ''}">
          <label for="cardHolder">Cardholder name</label>
          <input id="cardHolder" name="cardholderName" type="text" value="${esc(state.cardholderName)}" placeholder="Layla Hassan" autocomplete="cc-name" required>
          <span class="res-field-err" ${e.cardholderName ? '' : 'hidden'}>${esc(e.cardholderName || '')}</span>
        </div>

        <div class="res-field${e.cardNumber ? ' is-invalid' : ''}">
          <label for="cardNumber">Card number</label>
          <input id="cardNumber" name="cardNumber" type="text" inputmode="numeric" maxlength="23" value="${esc(state.cardNumber)}" placeholder="4242 4242 4242 4242" autocomplete="cc-number" required>
          <span class="res-field-err" ${e.cardNumber ? '' : 'hidden'}>${esc(e.cardNumber || '')}</span>
        </div>

        <div class="chk-card-grid2">
          <div class="res-field${e.expiry ? ' is-invalid' : ''}">
            <label for="cardExpiry">Expiry</label>
            <input id="cardExpiry" name="expiry" type="text" inputmode="numeric" maxlength="7" value="${esc(state.expiry)}" placeholder="08 / 28" autocomplete="cc-exp" required>
            <span class="res-field-err" ${e.expiry ? '' : 'hidden'}>${esc(e.expiry || '')}</span>
          </div>

          <div class="res-field${e.cvv ? ' is-invalid' : ''}">
            <label for="cardCvv">CVV</label>
            <input id="cardCvv" name="cvv" type="password" inputmode="numeric" maxlength="4" value="${esc(state.cvv)}" placeholder="&bull;&bull;&bull;" autocomplete="cc-csc" required>
            <span class="res-field-err" ${e.cvv ? '' : 'hidden'}>${esc(e.cvv || '')}</span>
          </div>
        </div>

        <p class="chk-secure-note">
          <span aria-hidden="true">🔒</span>
          <span>Encrypted and secure. We never store your card.</span>
        </p>

        ${renderOrderSummary(items)}

        <p class="res-error" role="alert" ${state.submitError ? '' : 'hidden'}>${esc(state.submitError)}</p>

        <div class="res-actions-row">
          <button type="button" class="btn res-btn-outline" id="chkBackToPayOptions">&larr; Back</button>
          <button type="submit" class="btn btn--olive res-btn-primary" ${state.submitting ? 'disabled' : ''}>
            ${state.submitting ? 'Processing...' : `Pay ${esc(currency)}${total}`}
          </button>
        </div>
      </form>
    </div>`;
  }

  function renderStep2(items) {
    if (!items.length) return renderEmptyCart();
    ensureCompatiblePaymentMethod();

    if (state.paymentMethod === 'card') {
      return renderCardDetailsForm(items);
    }

    const { total } = getTotals(items);
    const methods = getCompatibleMethods();

    return `<div class="res-card">
      ${renderProgress()}
      <h1 class="res-title">How would you <em>like to pay?</em></h1>

      <div class="chk-pay-list" role="radiogroup" aria-label="Payment method">
        ${methods.map(m => {
          const selected = state.paymentMethod === m.id;
          return `<button type="button" class="chk-pay-card${selected ? ' is-selected' : ''}" role="radio" aria-checked="${selected}" data-pay-method="${m.id}">
            <span class="chk-pay-icon" aria-hidden="true">${m.icon}</span>
            <span class="chk-pay-copy">
              <strong>${esc(m.title)}</strong>
              <span>${esc(m.description)}</span>
            </span>
            <span class="chk-pay-radio" aria-hidden="true"></span>
          </button>`;
        }).join('')}
      </div>

      ${state.paymentMethod === 'online' ? `
        <div class="chk-wallet-box">
          <p class="res-label">Select digital wallet</p>
          <div class="chk-wallet-pills" role="group" aria-label="Digital wallet options">
            ${WALLETS.map(w => {
              const selected = state.wallet === w;
              return `<button type="button" class="chk-wallet-pill${selected ? ' is-selected' : ''}" data-wallet="${esc(w)}" aria-pressed="${selected}">${esc(w)}</button>`;
            }).join('')}
          </div>
        </div>
      ` : ''}

      ${renderOrderSummary(items)}

      <p class="res-error" role="alert" ${state.submitError ? '' : 'hidden'}>${esc(state.submitError)}</p>

      <div class="res-actions-row">
        <button type="button" class="btn res-btn-outline" id="chkBackToDetails">&larr; Back</button>
        <button type="button" class="btn btn--olive res-btn-primary" id="chkPlaceOrder" ${state.submitting ? 'disabled' : ''}>
          ${state.submitting ? 'Placing Order...' : `Place Order &middot; ${esc(currency)}${total}`}
        </button>
      </div>
    </div>`;
  }

  function formatPaymentLabel(payment) {
    if (!payment) return '';
    if (payment.method === 'cash-delivery') return 'Cash on Delivery';
    if (payment.method === 'cash-pickup') return 'Cash on Pickup';
    if (payment.method === 'card') return `${payment.brand || 'Card'} ending in ${payment.last4}`;
    if (payment.method === 'online') return `Online Payment · ${payment.wallet}`;
    return payment.method;
  }

  function renderStep3() {
    const order = state.confirmedOrder;
    if (!order) return renderStep1(getCartItems());
    const firstName = order.fullName.split(/\s+/)[0] || 'friend';

    return `<div class="res-card res-confirmed">
      ${renderProgress()}
      <div class="res-check-badge" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </div>
      <p class="eyebrow">ORDER CONFIRMED</p>
      <h1 class="res-title res-title--center">Thank you, <em>${esc(firstName)}</em></h1>
      <p class="res-confirmed-msg">
        ${order.fulfillment === 'delivery'
          ? 'Your order is confirmed and our kitchen has started preparing it for delivery.'
          : `Your order is confirmed and will be ready for pickup (${esc(order.pickupTime)}) at Nasr City.`}
      </p>

      <div class="res-ticket">
        <p class="eyebrow">ORDER NO.</p>
        <strong class="res-ticket__code">${esc(order.orderNumber)}</strong>
        <div class="res-ticket__divider"></div>
        <div class="res-ticket__row">
          <span>Fulfillment</span>
          <strong>${order.fulfillment === 'delivery' ? 'Delivery' : `Pickup (${esc(order.pickupTime)})`}</strong>
        </div>
        <div class="res-ticket__row">
          <span>${order.fulfillment === 'delivery' ? 'Address' : 'Branch'}</span>
          <strong>${esc(order.fulfillment === 'delivery' ? order.address : order.pickupLocation)}</strong>
        </div>
        <div class="res-ticket__row">
          <span>Payment</span>
          <strong>${esc(formatPaymentLabel(order.payment))}</strong>
        </div>
        <div class="res-ticket__divider"></div>
        ${order.items.map(i => {
          const extras = [];
          if (i.size && i.size !== 'Regular') extras.push(i.size);
          if (Array.isArray(i.addons) && i.addons.length) extras.push(...i.addons.map(a => `+ ${a.label}`));
          const extraStr = extras.length ? ` (${extras.join(', ')})` : '';
          return `<div class="res-ticket__row">
            <span>${i.qty} &times; ${esc(i.name)}${esc(extraStr)}</span>
            <strong>${fmtMoney(i.lineTotal)}</strong>
          </div>`;
        }).join('')}
        ${order.discount > 0 ? `<div class="res-ticket__row">
          <span>Promo (${esc(order.promoCode)})</span>
          <strong>−${fmtMoney(order.discount)}</strong>
        </div>` : ''}
        <div class="res-ticket__divider"></div>
        <div class="res-ticket__row">
          <span>Total paid</span>
          <strong>${fmtMoney(order.total)}</strong>
        </div>
      </div>

      <div class="res-actions-row">
        <a class="btn res-btn-outline" href="index.html#menu">Order More</a>
        <a class="btn btn--olive res-btn-primary" href="index.html#home">Back to Home</a>
      </div>
    </div>`;
  }

  function syncStep1Inputs() {
    const form = document.getElementById('checkoutStep1Form');
    if (!form) return;
    if (form.fullName) state.fullName = form.fullName.value.trim();
    if (form.phone) state.phone = form.phone.value.trim();
    if (form.address) state.address = form.address.value.trim();
    if (form.instructions) state.instructions = form.instructions.value.trim();
  }

  function validateStep1() {
    syncStep1Inputs();
    const errors = {};
    if (state.fullName.length < 2) errors.fullName = 'Please enter your full name.';
    if (state.phone.replace(/\D/g, '').length < 7) errors.phone = 'Please enter a valid phone number.';
    if (state.fulfillment === 'delivery') {
      if (state.address.length < 5) errors.address = 'Please enter your delivery address.';
    } else if (!state.pickupTime) {
      errors.pickupTime = 'Please select a pickup time.';
    }
    state.step1Errors = errors;
    return Object.keys(errors).length === 0;
  }

  function syncCardInputs() {
    const form = document.getElementById('checkoutCardForm');
    if (!form) return;
    if (form.cardholderName) state.cardholderName = form.cardholderName.value.trim();
    if (form.cardNumber) state.cardNumber = formatCardNumberInput(form.cardNumber.value);
    if (form.expiry) state.expiry = formatExpiryInput(form.expiry.value);
    if (form.cvv) state.cvv = form.cvv.value.replace(/\D/g, '').slice(0, 4);
  }

  function validateCardForm() {
    syncCardInputs();
    const errors = {};
    const digits = state.cardNumber.replace(/\D/g, '');
    if (state.cardholderName.length < 2) errors.cardholderName = 'Please enter the cardholder name.';
    if (digits.length < 13 || digits.length > 19 || !luhnValid(digits)) {
      errors.cardNumber = 'Please enter a valid card number.';
    }
    if (!isExpiryValid(state.expiry)) {
      errors.expiry = 'Enter a valid future expiry (MM / YY).';
    }
    if (state.cvv.length < 3 || state.cvv.length > 4) {
      errors.cvv = 'Enter a 3 or 4 digit CVV.';
    }
    state.step2Errors = errors;
    return Object.keys(errors).length === 0;
  }

  async function submitOrder() {
    if (state.submitting) return;
    const items = getCartItems();
    if (!items.length) {
      state.step = 1;
      render();
      return;
    }

    if (state.paymentMethod === 'card' && !validateCardForm()) {
      render();
      const firstErr = root.querySelector('.is-invalid input');
      if (firstErr) firstErr.focus();
      return;
    }

    state.submitting = true;
    state.submitError = '';
    render();

    const payload = {
      items: items.map(i => ({
        id: i.id,
        qty: i.qty,
        size: i.size || 'Regular',
        addons: (i.addons || []).map(a => a.id)
      })),
      fulfillment: state.fulfillment,
      promoCode: state.promoCode || '',
      fullName: state.fullName,
      phone: state.phone,
      address: state.fulfillment === 'delivery' ? state.address : '',
      instructions: state.fulfillment === 'delivery' ? state.instructions : '',
      pickupTime: state.fulfillment === 'pickup' ? state.pickupTime : '',
      paymentMethod: state.paymentMethod,
      wallet: state.paymentMethod === 'online' ? state.wallet : undefined,
      card: state.paymentMethod === 'card'
        ? {
            cardholderName: state.cardholderName,
            cardNumber: state.cardNumber,
            expiry: state.expiry,
            cvv: state.cvv
          }
        : undefined
    };

    function buildLocalOrder() {
      const totals = getTotals(items);
      const createdAt = new Date().toISOString();
      const createdMs = Date.parse(createdAt);
      const isDelivery = state.fulfillment !== 'pickup';
      const etaMinMinutes = isDelivery ? 25 : 15;
      const etaMaxMinutes = isDelivery ? 35 : 20;
      const estimatedArrivalAt = new Date(createdMs + etaMaxMinutes * 60 * 1000).toISOString();
      const orderNumber = `KF-ORD-${Math.floor(10000 + Math.random() * 90000)}`;

      let paymentSummary = { method: state.paymentMethod };
      if (state.paymentMethod === 'card') {
        const digits = state.cardNumber.replace(/\D/g, '');
        paymentSummary = {
          method: 'card',
          brand: detectCardBrand(digits),
          last4: digits.slice(-4),
          cardholderName: state.cardholderName
        };
      } else if (state.paymentMethod === 'online') {
        paymentSummary = { method: 'online', wallet: state.wallet || 'Digital Wallet' };
      }

      return {
        orderNumber,
        fulfillment: state.fulfillment,
        fullName: state.fullName,
        phone: state.phone,
        address: isDelivery ? state.address : '',
        instructions: isDelivery ? state.instructions : '',
        pickupTime: !isDelivery ? state.pickupTime : '',
        pickupLocation: !isDelivery ? 'Kehnfan · Nasr City, Cairo' : '',
        items: items.map(i => ({
          id: i.id,
          name: i.name,
          size: i.size || 'Regular',
          addons: i.addons || [],
          unitPrice: i.unitPrice,
          qty: i.qty,
          lineTotal: i.lineTotal
        })),
        subtotal: totals.subtotal,
        promoCode: totals.promoCode || '',
        discount: totals.discount || 0,
        fee: totals.fee,
        total: totals.total,
        payment: paymentSummary,
        etaMinMinutes,
        etaMaxMinutes,
        estimatedArrivalAt,
        courierPhone: null,
        deliveryLocation: null,
        createdAt
      };
    }

    function completeWithOrder(order) {
      state.confirmedOrder = order;
      try {
        localStorage.setItem('kehnfan_last_order_v1', JSON.stringify(order));
        const storedMap = JSON.parse(localStorage.getItem('kehnfan_orders_v1') || '{}');
        const map = storedMap && typeof storedMap === 'object' && !Array.isArray(storedMap) ? storedMap : {};
        map[order.orderNumber] = order;
        localStorage.setItem('kehnfan_orders_v1', JSON.stringify(map));
      } catch {}
      // Clear sensitive card inputs from memory after completion
      state.cardNumber = '';
      state.expiry = '';
      state.cvv = '';
      clearCartStorage();
      window.location.href = `confirmation.html?order=${encodeURIComponent(order.orderNumber)}`;
    }

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.status === 404 || res.status === 405 || res.status === 501) {
        completeWithOrder(buildLocalOrder());
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.order) {
        state.submitError = data.error || 'Could not place your order. Please try again.';
        return;
      }
      completeWithOrder(data.order);
      return;
    } catch {
      completeWithOrder(buildLocalOrder());
      return;
    } finally {
      state.submitting = false;
      if (state.step !== 3) {
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  }

  function render() {
    const items = getCartItems();
    if (state.step === 1) root.innerHTML = renderStep1(items);
    else if (state.step === 2) root.innerHTML = renderStep2(items);
    else if (state.step === 3) root.innerHTML = renderStep3();
  }

  root.addEventListener('click', e => {
    const stepBtn = e.target.closest('[data-chk-step]');
    if (stepBtn && !stepBtn.disabled) {
      const target = Number(stepBtn.dataset.chkStep);
      if (target < state.step) {
        if (state.paymentMethod === 'card') syncCardInputs();
        state.step = target;
        state.submitError = '';
        render();
      }
      return;
    }

    const fulBtn = e.target.closest('[data-fulfillment]');
    if (fulBtn) {
      syncStep1Inputs();
      const nextFul = fulBtn.dataset.fulfillment;
      if (nextFul !== state.fulfillment) {
        state.fulfillment = nextFul;
        if (CART) CART.savePrefs({ fulfillment: nextFul });
        state.step1Errors = {};
        ensureCompatiblePaymentMethod();
        render();
      }
      return;
    }

    const pickupBtn = e.target.closest('[data-pickup-time]');
    if (pickupBtn) {
      syncStep1Inputs();
      state.pickupTime = pickupBtn.dataset.pickupTime;
      delete state.step1Errors.pickupTime;
      render();
      return;
    }

    const payCard = e.target.closest('[data-pay-method]');
    if (payCard) {
      state.paymentMethod = payCard.dataset.payMethod;
      state.step2Errors = {};
      state.submitError = '';
      render();
      return;
    }

    const switchBtn = e.target.closest('[data-pay-switch]');
    if (switchBtn) {
      syncCardInputs();
      state.paymentMethod = switchBtn.dataset.paySwitch;
      state.step2Errors = {};
      state.submitError = '';
      render();
      return;
    }

    const walletBtn = e.target.closest('[data-wallet]');
    if (walletBtn) {
      state.wallet = walletBtn.dataset.wallet;
      render();
      return;
    }

    if (e.target.closest('#chkBackToPayOptions')) {
      syncCardInputs();
      state.paymentMethod = state.fulfillment === 'delivery' ? 'cash-delivery' : 'cash-pickup';
      state.submitError = '';
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    if (e.target.closest('#chkBackToDetails')) {
      if (state.paymentMethod === 'card') syncCardInputs();
      state.submitError = '';
      state.step = 1;
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    if (e.target.closest('#chkPlaceOrder')) {
      submitOrder();
    }
  });

  root.addEventListener('input', e => {
    const target = e.target;
    if (!target) return;

    const fieldWrap = target.closest('.res-field');
    if (fieldWrap && fieldWrap.classList.contains('is-invalid')) {
      fieldWrap.classList.remove('is-invalid');
      const errEl = fieldWrap.querySelector('.res-field-err');
      if (errEl) errEl.hidden = true;
    }

    if (target.id === 'chkName') state.fullName = target.value;
    else if (target.id === 'chkPhone') state.phone = target.value;
    else if (target.id === 'chkAddress') state.address = target.value;
    else if (target.id === 'chkInstructions') state.instructions = target.value;
    else if (target.id === 'cardHolder') {
      state.cardholderName = target.value;
      const preview = document.getElementById('cardPreviewHolder');
      if (preview) preview.textContent = (target.value.trim() || 'LAYLA HASSAN').toUpperCase();
    } else if (target.id === 'cardNumber') {
      const formatted = formatCardNumberInput(target.value);
      target.value = formatted;
      state.cardNumber = formatted;
      const digits = formatted.replace(/\D/g, '');
      const numEl = document.getElementById('cardPreviewNum');
      const netEl = root.querySelector('.chk-card-preview__net');
      if (numEl) numEl.innerHTML = formatMaskedCardPreview(digits);
      if (netEl) netEl.textContent = detectCardBrand(digits);
    } else if (target.id === 'cardExpiry') {
      const formatted = formatExpiryInput(target.value);
      target.value = formatted;
      state.expiry = formatted;
      const expEl = document.getElementById('cardPreviewExp');
      if (expEl) expEl.textContent = formatted || 'MM / YY';
    } else if (target.id === 'cardCvv') {
      target.value = target.value.replace(/\D/g, '').slice(0, 4);
      state.cvv = target.value;
    }
  });

  root.addEventListener('submit', e => {
    if (e.target && e.target.id === 'checkoutStep1Form') {
      e.preventDefault();
      if (validateStep1()) {
        ensureCompatiblePaymentMethod();
        state.step = 2;
        state.submitError = '';
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        render();
        const firstErr = root.querySelector('.is-invalid input');
        if (firstErr) firstErr.focus();
      }
      return;
    }

    if (e.target && e.target.id === 'checkoutCardForm') {
      e.preventDefault();
      submitOrder();
    }
  });

  window.addEventListener('kehnfan:cart-updated', () => {
    if (state.step !== 3) render();
  });
  window.addEventListener('storage', e => {
    if (e.key === CART_KEY && state.step !== 3) render();
  });

  render();
})();
