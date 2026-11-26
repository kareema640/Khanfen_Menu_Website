(function () {
  const root = document.getElementById('reservationFlowRoot');
  if (!root) return;

  const modal = document.getElementById('reservationModal');
  const backdrop = document.getElementById('reservationModalBackdrop');
  const closeBtn = document.getElementById('closeReservationModal');
  const isModalMode = Boolean(modal && backdrop);
  let lastTrigger = null;

  const GUEST_OPTIONS = ['1', '2', '3', '4', '5', '6', '7', '8+'];
  const DEFAULT_SLOTS = ['8:00', '8:30', '9:00', '9:30', '10:00', '10:30', '11:00', '11:30', '12:00'];
  const OCCASIONS = ['Birthday', 'Anniversary', 'Family', 'Business'];
  const MENU_DATA = window.MENU || { products: [], categories: [], currency: '$' };
  const CURRENCY = MENU_DATA.currency || '$';
  const MENU_PRODUCTS = Array.isArray(MENU_DATA.products) ? MENU_DATA.products : [];
  const MENU_CATEGORIES = Array.isArray(MENU_DATA.categories) ? MENU_DATA.categories : [];
  const isDrink = p => p.category === 'hot-drinks' || p.category === 'cold-drinks';
  const WEEKDAYS_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const WEEKDAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const WEEKDAYS_3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS_FULL = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const MONTHS_3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  function toIsoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function parseIsoDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function formatTime12(slot) {
    const [hStr, mStr] = slot.split(':');
    const h = Number(hStr);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const h12 = h > 12 ? h - 12 : h;
    return `${h12}:${mStr} ${suffix}`;
  }

  function formatGuestLabel(g) {
    if (!g) return '';
    return g === '1' ? '1 person' : `${g} people`;
  }

  function formatSummaryDate(iso) {
    const d = parseIsoDate(iso);
    return `${WEEKDAYS_3[d.getDay()]}, ${d.getDate()} ${MONTHS_3[d.getMonth()]} ${d.getFullYear()}`;
  }

  function formatShortDate(iso) {
    const d = parseIsoDate(iso);
    return `${WEEKDAYS_3[d.getDay()]} ${d.getDate()} ${MONTHS_3[d.getMonth()]}`;
  }

  function formatAvailableHeading(iso) {
    const d = parseIsoDate(iso);
    return `${WEEKDAYS_FULL[d.getDay()]} ${d.getDate()}`;
  }

  function isSlotPastToday(iso, slot) {
    const now = new Date();
    if (iso !== toIsoDate(now)) return false;
    const [h, m] = slot.split(':').map(Number);
    const slotMinutes = h * 60 + m;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    return slotMinutes <= nowMinutes;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = toIsoDate(today);

  const hasRemainingToday = DEFAULT_SLOTS.some(s => s !== '12:00' && !isSlotPastToday(todayIso, s));
  const initialDateObj = new Date(today);
  if (!hasRemainingToday) initialDateObj.setDate(initialDateObj.getDate() + 1);
  const initialDateIso = toIsoDate(initialDateObj);

  const state = {
    step: 1,
    guests: null,
    date: initialDateIso,
    viewYear: initialDateObj.getFullYear(),
    viewMonth: initialDateObj.getMonth(),
    time: null,
    slots: [...DEFAULT_SLOTS],
    unavailableSlots: ['12:00'],
    loadingSlots: false,
    fullName: '',
    phone: '',
    email: '',
    specialRequests: '',
    occasion: '',
    preOrder: {},
    menuCat: 'all',
    menuSearch: '',
    step1Error: '',
    fieldErrors: {},
    submitError: '',
    submitting: false,
    confirmedReservation: null
  };

  function getPreOrderItems() {
    const items = [];
    for (const p of MENU_PRODUCTS) {
      const qty = Math.floor(Number(state.preOrder[p.id] || 0));
      if (qty > 0) {
        items.push({
          id: p.id,
          name: p.name,
          unitPrice: p.price,
          qty,
          lineTotal: p.price * qty
        });
      }
    }
    return items;
  }

  function getPreOrderSummary() {
    const items = getPreOrderItems();
    const count = items.reduce((sum, i) => sum + i.qty, 0);
    const total = items.reduce((sum, i) => sum + i.lineTotal, 0);
    return { items, count, total };
  }

  function resetFlowState() {
    state.step = 1;
    state.guests = null;
    state.date = initialDateIso;
    state.viewYear = initialDateObj.getFullYear();
    state.viewMonth = initialDateObj.getMonth();
    state.time = null;
    state.fullName = '';
    state.phone = '';
    state.email = '';
    state.specialRequests = '';
    state.occasion = '';
    state.preOrder = {};
    state.menuCat = 'all';
    state.menuSearch = '';
    state.step1Error = '';
    state.fieldErrors = {};
    state.submitError = '';
    state.submitting = false;
    state.confirmedReservation = null;
  }

  function scrollTopForFlow() {
    if (isModalMode && modal) {
      modal.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function openModal(triggerEl) {
    if (!isModalMode) return;
    lastTrigger = triggerEl || document.activeElement;

    const nav = document.getElementById('nav');
    const navToggle = document.getElementById('navToggle');
    if (nav && nav.classList.contains('nav--open')) {
      nav.classList.remove('nav--open');
      if (navToggle) navToggle.setAttribute('aria-expanded', 'false');
    }

    if (state.step === 4) {
      resetFlowState();
    }

    backdrop.hidden = false;
    modal.hidden = false;
    document.body.classList.add('lock');
    modal.scrollTop = 0;

    render();
    fetchAvailability(state.date);
    if (closeBtn) closeBtn.focus();
  }

  function closeModal() {
    if (!isModalMode) return;
    modal.hidden = true;
    backdrop.hidden = true;

    const otherOpen = ['fullMenu', 'cartDrawer', 'reviewModal'].some(id => {
      const el = document.getElementById(id);
      return el && !el.hidden;
    });
    if (!otherOpen) document.body.classList.remove('lock');

    if (lastTrigger && typeof lastTrigger.focus === 'function' && document.contains(lastTrigger)) {
      lastTrigger.focus();
    }
  }

  async function fetchAvailability(isoDate) {
    state.loadingSlots = true;
    renderSlotsSection();
    try {
      const res = await fetch(`/api/reservations/availability?date=${encodeURIComponent(isoDate)}`);
      if (res.ok) {
        const data = await res.json();
        if (state.date === isoDate) {
          state.slots = Array.isArray(data.slots) ? data.slots : [...DEFAULT_SLOTS];
          state.unavailableSlots = Array.isArray(data.unavailableSlots) ? data.unavailableSlots : ['12:00'];
        }
      }
    } catch {
      // Fallback to default availability if offline
    } finally {
      state.loadingSlots = false;
      if (state.time && isSlotUnavailable(state.date, state.time)) {
        state.time = null;
      }
      if (state.step === 1) renderSlotsSection();
    }
  }

  function isSlotUnavailable(isoDate, slot) {
    return state.unavailableSlots.includes(slot) || isSlotPastToday(isoDate, slot);
  }

  function renderProgress() {
    const steps = [
      { num: 1, label: '1 PARTY' },
      { num: 2, label: '2 DETAILS' },
      { num: 3, label: '3 REVIEW' }
    ];
    return `<nav class="res-steps" aria-label="Reservation steps">
      ${steps.map(s => {
        const active = s.num <= state.step;
        const canJump = s.num < state.step;
        return `<button type="button" class="res-step-pill${active ? ' is-active' : ''}" data-jump-step="${s.num}" ${canJump ? '' : 'disabled'} aria-current="${s.num === state.step ? 'step' : 'false'}">${s.label}</button>`;
      }).join('')}
    </nav>`;
  }

  function buildCalendarCells(year, month) {
    const firstOfMonth = new Date(year, month, 1);
    // Monday = 0 ... Sunday = 6
    const startOffset = (firstOfMonth.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrev = new Date(year, month, 0).getDate();

    const cells = [];
    for (let i = startOffset - 1; i >= 0; i--) {
      const dayNum = daysInPrev - i;
      const d = new Date(year, month - 1, dayNum);
      cells.push({ dateObj: d, iso: toIsoDate(d), dayNum, outside: true });
    }
    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      const d = new Date(year, month, dayNum);
      cells.push({ dateObj: d, iso: toIsoDate(d), dayNum, outside: false });
    }
    const remainder = cells.length % 7;
    if (remainder !== 0) {
      const needed = 7 - remainder;
      for (let dayNum = 1; dayNum <= needed; dayNum++) {
        const d = new Date(year, month + 1, dayNum);
        cells.push({ dateObj: d, iso: toIsoDate(d), dayNum, outside: true });
      }
    }
    return cells;
  }

  function renderCalendarHTML() {
    const canPrevMonth =
      state.viewYear > today.getFullYear() ||
      (state.viewYear === today.getFullYear() && state.viewMonth > today.getMonth());
    const cells = buildCalendarCells(state.viewYear, state.viewMonth);

    return `<div class="res-section">
      <div class="res-cal-head">
        <span class="res-label">Date &middot; ${MONTHS_FULL[state.viewMonth]} ${state.viewYear}</span>
        <div class="res-cal-nav">
          <button type="button" id="calPrevMonth" aria-label="Previous month" ${canPrevMonth ? '' : 'disabled'}>&lsaquo;</button>
          <button type="button" id="calNextMonth" aria-label="Next month">&rsaquo;</button>
        </div>
      </div>
      <div class="res-cal-card">
        <div class="res-cal-weekdays">
          ${WEEKDAYS_SHORT.map(w => `<span>${w}</span>`).join('')}
        </div>
        <div class="res-cal-grid">
          ${cells.map(c => {
            const isPast = c.iso < todayIso;
            const isSelected = c.iso === state.date;
            const isToday = c.iso === todayIso;
            const classes = [
              'res-day',
              c.outside ? 'is-outside' : '',
              isPast ? 'is-past' : '',
              isToday ? 'is-today' : '',
              isSelected ? 'is-selected' : ''
            ].filter(Boolean).join(' ');
            return `<button type="button" class="${classes}" data-date="${c.iso}" ${isPast ? 'disabled' : ''} aria-label="${formatSummaryDate(c.iso)}" aria-pressed="${isSelected}">${c.dayNum}</button>`;
          }).join('')}
        </div>
      </div>
      <p class="res-selected-note">Selected date: <strong>${formatSummaryDate(state.date)}</strong></p>
    </div>`;
  }

  function renderSlotsHTML() {
    const heading = state.date ? formatAvailableHeading(state.date) : 'Select a date';
    return `<div class="res-section" id="resSlotsWrap">
      <p class="res-label">Available times &middot; ${esc(heading)}</p>
      <div class="res-slots">
        ${state.slots.map(slot => {
          const unavail = isSlotUnavailable(state.date, slot);
          const selected = state.time === slot && !unavail;
          return `<button type="button" class="res-slot${selected ? ' is-selected' : ''}${unavail ? ' is-unavailable' : ''}" data-time="${slot}" ${unavail ? 'disabled aria-disabled="true"' : ''} aria-pressed="${selected}">${slot}</button>`;
        }).join('')}
      </div>
    </div>`;
  }

  function renderSlotsSection() {
    const wrap = document.getElementById('resSlotsWrap');
    if (wrap) wrap.outerHTML = renderSlotsHTML();
  }

  function renderStep1() {
    return `<div class="res-card">
      ${renderProgress()}
      <h1 class="res-title">Book Your <em>Table</em></h1>

      <div class="res-section">
        <p class="res-label">Number of guests</p>
        <div class="res-guests" role="group" aria-label="Number of guests">
          ${GUEST_OPTIONS.map(g => {
            const selected = state.guests === g;
            return `<button type="button" class="res-guest-btn${selected ? ' is-selected' : ''}" data-guests="${g}" aria-pressed="${selected}">${g}</button>`;
          }).join('')}
        </div>
      </div>

      ${renderCalendarHTML()}
      ${renderSlotsHTML()}

      <p class="res-error" id="step1Error" role="alert" ${state.step1Error ? '' : 'hidden'}>${esc(state.step1Error)}</p>

      <button type="button" class="btn btn--olive res-continue" id="step1Continue">Continue &rarr;</button>
    </div>`;
  }

  function getFilteredMenu() {
    const q = state.menuSearch.trim().toLowerCase();
    return MENU_PRODUCTS.filter(p => {
      const catOk = state.menuCat === 'all' || p.category === state.menuCat;
      const searchOk = !q || p.name.toLowerCase().includes(q);
      return catOk && searchOk;
    });
  }

  function renderPreOrderTabsHTML() {
    return MENU_CATEGORIES.map(c => {
      const active = c.id === state.menuCat;
      return `<button type="button" class="res-preorder-tab${active ? ' is-active' : ''}" data-res-cat="${esc(c.id)}" aria-pressed="${active}">${esc(c.label)}</button>`;
    }).join('');
  }

  function renderPreOrderListHTML() {
    const list = getFilteredMenu();
    if (!list.length) {
      return '<p class="res-preorder-empty">No menu items match your search.</p>';
    }
    return list.map(p => {
      const qty = Math.floor(Number(state.preOrder[p.id] || 0));
      const thumbHTML = p.image
        ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">`
        : '<div class="ph">Soon</div>';
      const controlHTML = qty > 0
        ? `<div class="res-preorder-qty">
            <button type="button" data-pre-dec="${esc(p.id)}" aria-label="Decrease ${esc(p.name)}">−</button>
            <span>${qty}</span>
            <button type="button" data-pre-inc="${esc(p.id)}" aria-label="Increase ${esc(p.name)}">+</button>
          </div>`
        : `<button type="button" class="res-preorder-add" data-pre-add="${esc(p.id)}" aria-label="Add ${esc(p.name)}">+ Add</button>`;

      return `<div class="res-preorder-item">
        <div class="res-preorder-thumb${isDrink(p) ? ' res-preorder-thumb--drink' : ''}">${thumbHTML}</div>
        <div class="res-preorder-info">
          <strong>${esc(p.name)}</strong>
          <span>${esc(CURRENCY)}${p.price}</span>
        </div>
        ${controlHTML}
      </div>`;
    }).join('');
  }

  function renderPreOrderBarHTML() {
    const { count, total } = getPreOrderSummary();
    if (!count) return '';
    return `<div class="res-preorder-bar">
      <span><strong>${count} ${count === 1 ? 'item' : 'items'}</strong> selected &middot; Total <strong>${esc(CURRENCY)}${total}</strong></span>
      <button type="button" class="res-preorder-clear" id="resPreOrderClear">Clear food</button>
    </div>`;
  }

  function renderPreOrderHTML() {
    if (!MENU_PRODUCTS.length) return '';
    const { count, total } = getPreOrderSummary();
    return `<div class="res-section" id="resPreOrderWrap">
      <p class="res-label">Pre-order food &amp; drinks <span class="rev-opt">(optional)</span></p>
      <div class="res-preorder-card">
        <div class="res-preorder-top">
          <input id="resMenuSearch" class="res-preorder-search" type="search" value="${esc(state.menuSearch)}" placeholder="Search sandwiches, coffee, desserts..." aria-label="Search menu items for reservation">
          <span class="res-preorder-badge${count ? ' has-items' : ''}" id="resPreOrderBadge">
            ${count ? `${count} selected · ${esc(CURRENCY)}${total}` : 'None selected'}
          </span>
        </div>
        <div class="res-preorder-tabs" id="resPreOrderTabs" role="group" aria-label="Filter menu categories">
          ${renderPreOrderTabsHTML()}
        </div>
        <div class="res-preorder-list" id="resPreOrderList">
          ${renderPreOrderListHTML()}
        </div>
        <div id="resPreOrderBar">${renderPreOrderBarHTML()}</div>
      </div>
    </div>`;
  }

  function refreshPreOrderUI() {
    const listEl = document.getElementById('resPreOrderList');
    const tabsEl = document.getElementById('resPreOrderTabs');
    const badgeEl = document.getElementById('resPreOrderBadge');
    const barEl = document.getElementById('resPreOrderBar');
    if (!listEl) return;

    const prevScroll = listEl.scrollTop;
    if (tabsEl) tabsEl.innerHTML = renderPreOrderTabsHTML();
    listEl.innerHTML = renderPreOrderListHTML();
    listEl.scrollTop = prevScroll;

    const { count, total } = getPreOrderSummary();
    if (badgeEl) {
      badgeEl.className = `res-preorder-badge${count ? ' has-items' : ''}`;
      badgeEl.textContent = count ? `${count} selected · ${CURRENCY}${total}` : 'None selected';
    }
    if (barEl) barEl.innerHTML = renderPreOrderBarHTML();
  }

  function renderStep2() {
    const e = state.fieldErrors;
    return `<div class="res-card">
      ${renderProgress()}
      <h1 class="res-title">Tell us <em>about you</em></h1>

      <form class="res-form" id="step2Form" novalidate>
        <div class="res-field">
          <label for="resName">Full name</label>
          <input id="resName" name="fullName" type="text" value="${esc(state.fullName)}" placeholder="Layla Hassan" autocomplete="name" required>
          <span class="res-field-err" ${e.fullName ? '' : 'hidden'}>${esc(e.fullName || '')}</span>
        </div>

        <div class="res-field">
          <label for="resPhone">Phone number</label>
          <input id="resPhone" name="phone" type="tel" value="${esc(state.phone)}" placeholder="+20 100 123 4567" autocomplete="tel" required>
          <span class="res-field-err" ${e.phone ? '' : 'hidden'}>${esc(e.phone || '')}</span>
        </div>

        <div class="res-field">
          <label for="resEmail">Email</label>
          <input id="resEmail" name="email" type="email" value="${esc(state.email)}" placeholder="layla@email.com" autocomplete="email" required>
          <span class="res-field-err" ${e.email ? '' : 'hidden'}>${esc(e.email || '')}</span>
        </div>

        <div class="res-field">
          <label for="resRequests">Special requests (optional)</label>
          <textarea id="resRequests" name="specialRequests" rows="3" placeholder="Window seat, please. A small birthday candle for dessert...">${esc(state.specialRequests)}</textarea>
        </div>

        <div class="res-section">
          <p class="res-label">Occasion</p>
          <div class="res-occasions" role="group" aria-label="Occasion">
            ${OCCASIONS.map(occ => {
              const selected = state.occasion === occ;
              return `<button type="button" class="res-occasion-btn${selected ? ' is-selected' : ''}" data-occasion="${occ}" aria-pressed="${selected}">${occ}</button>`;
            }).join('')}
          </div>
        </div>

        ${renderPreOrderHTML()}

        <div class="res-actions-row">
          <button type="button" class="btn res-btn-outline" id="step2Back">&larr; Back</button>
          <button type="submit" class="btn btn--olive res-btn-primary">Review Booking &rarr;</button>
        </div>
      </form>
    </div>`;
  }

  function renderStep3() {
    const { items: preItems, total: preTotal } = getPreOrderSummary();

    return `<div class="res-card">
      ${renderProgress()}
      <h1 class="res-title">Review &amp; <em>Confirm</em></h1>

      <div class="res-summary-box">
        <div class="res-summary-row"><span>Date</span><strong>${esc(formatSummaryDate(state.date))}</strong></div>
        <div class="res-summary-row"><span>Time</span><strong>${esc(formatTime12(state.time))}</strong></div>
        <div class="res-summary-row"><span>Guests</span><strong>${esc(formatGuestLabel(state.guests))}</strong></div>
        <div class="res-summary-divider"></div>
        <div class="res-summary-row"><span>Name</span><strong>${esc(state.fullName)}</strong></div>
        <div class="res-summary-row"><span>Phone</span><strong>${esc(state.phone)}</strong></div>
        <div class="res-summary-row"><span>Email</span><strong>${esc(state.email)}</strong></div>
        <div class="res-summary-row"><span>Occasion</span><strong>${esc(state.occasion || 'None')}</strong></div>
        <div class="res-summary-row"><span>Special Requests</span><strong>${esc(state.specialRequests || 'None')}</strong></div>
        ${preItems.length ? `
          <div class="res-summary-divider"></div>
          <div class="res-summary-row"><span>Pre-ordered Food</span><strong>${esc(CURRENCY)}${preTotal}</strong></div>
          <div class="res-summary-sublist">
            ${preItems.map(i => `<div class="res-summary-subrow">
              <span>${i.qty} &times; ${esc(i.name)}</span>
              <strong>${esc(CURRENCY)}${i.lineTotal}</strong>
            </div>`).join('')}
          </div>
        ` : `<div class="res-summary-row"><span>Pre-ordered Food</span><strong>None</strong></div>`}
      </div>

      <p class="res-notice">Tables are held for 15 minutes. Free changes up to 2 hours before.</p>
      <p class="res-error" id="step3Error" role="alert" ${state.submitError ? '' : 'hidden'}>${esc(state.submitError)}</p>

      <div class="res-actions-row">
        <button type="button" class="btn res-btn-outline" id="step3Edit">Edit</button>
        <button type="button" class="btn btn--olive res-btn-primary" id="step3Confirm" ${state.submitting ? 'disabled' : ''}>
          ${state.submitting ? 'Confirming...' : 'Confirm Reservation'}
        </button>
      </div>
    </div>`;
  }

  function renderStep4() {
    const r = state.confirmedReservation;
    const dateObj = parseIsoDate(r.date);
    const weekday = WEEKDAYS_FULL[dateObj.getDay()];
    const preItems = Array.isArray(r.preOrder) ? r.preOrder : [];

    return `<div class="res-card res-confirmed">
      <div class="res-check-badge" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </div>
      <p class="eyebrow">RESERVATION CONFIRMED</p>
      <h1 class="res-title res-title--center">See you <em>${esc(weekday)}</em></h1>
      <p class="res-confirmed-msg">Your table reservation has been successfully completed.</p>

      <div class="res-ticket">
        <p class="eyebrow">RESERVATION NO.</p>
        <strong class="res-ticket__code">${esc(r.reservationNumber)}</strong>
        <div class="res-ticket__divider"></div>
        <div class="res-ticket__row"><span>Date &amp; time</span><strong>${esc(formatShortDate(r.date))} &middot; ${esc(formatTime12(r.time))}</strong></div>
        <div class="res-ticket__row"><span>Guests</span><strong>${esc(formatGuestLabel(r.guests))}</strong></div>
        <div class="res-ticket__row"><span>Name</span><strong>${esc(r.fullName)}</strong></div>
        ${preItems.length ? `
          <div class="res-ticket__divider"></div>
          ${preItems.map(i => `<div class="res-ticket__row">
            <span>${i.qty} &times; ${esc(i.name)}</span>
            <strong>${esc(CURRENCY)}${i.lineTotal}</strong>
          </div>`).join('')}
          <div class="res-ticket__row"><span>Pre-ordered Food</span><strong>${esc(CURRENCY)}${r.preOrderTotal || 0}</strong></div>
        ` : ''}
      </div>

      <div class="res-actions-row">
        <button type="button" class="btn res-btn-outline" id="addToCalendarBtn">Add to Calendar</button>
        ${isModalMode
          ? '<button type="button" class="btn btn--olive res-btn-primary" id="resBackHomeBtn">Back to Home</button>'
          : '<a class="btn btn--olive res-btn-primary" href="index.html#home">Back to Home</a>'}
      </div>
      <p class="res-calendar-note" id="calendarNote" role="status" aria-live="polite">A confirmation for ${esc(r.email)} is saved under ${esc(r.reservationNumber)}.</p>
    </div>`;
  }

  function downloadCalendarInvite(r) {
    const [y, m, d] = r.date.split('-').map(Number);
    const [hr, min] = r.time.split(':').map(Number);
    const start = new Date(y, m - 1, d, hr, min, 0);
    const end = new Date(start.getTime() + 90 * 60 * 1000);

    const preOrderLines = Array.isArray(r.preOrder) && r.preOrder.length
      ? [`Pre-ordered Food: ${r.preOrder.map(i => `${i.qty}x ${i.name}`).join(', ')}`]
      : [];

    const fmtUtc = dt => dt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const details = [
      `Reservation Number: ${r.reservationNumber}`,
      `Party Size: ${formatGuestLabel(r.guests)}`,
      `Guest Name: ${r.fullName}`,
      r.occasion ? `Occasion: ${r.occasion}` : '',
      ...preOrderLines,
      r.specialRequests ? `Special Requests: ${r.specialRequests}` : ''
    ].filter(Boolean).join('\\n');

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Kehnfan//Table Reservation//EN',
      'BEGIN:VEVENT',
      `UID:${r.reservationNumber}@kehnfan`,
      `DTSTAMP:${fmtUtc(new Date())}`,
      `DTSTART:${fmtUtc(start)}`,
      `DTEND:${fmtUtc(end)}`,
      `SUMMARY:Kehnfan Table Reservation (${r.reservationNumber})`,
      `DESCRIPTION:${details}`,
      'LOCATION:Kehnfan Cafe\\, Nasr City\\, Egypt',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');

    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `kehnfan-reservation-${r.reservationNumber}.ics`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    const note = document.getElementById('calendarNote');
    if (note) note.textContent = `Calendar invite downloaded for ${r.reservationNumber}.`;
  }

  function syncStep2Inputs() {
    const form = document.getElementById('step2Form');
    if (!form) return;
    state.fullName = form.fullName.value.trim();
    state.phone = form.phone.value.trim();
    state.email = form.email.value.trim();
    state.specialRequests = form.specialRequests.value.trim();
  }

  function validateStep2() {
    syncStep2Inputs();
    const errors = {};
    if (state.fullName.length < 2) {
      errors.fullName = 'Please enter your full name.';
    }
    if (state.phone.replace(/\D/g, '').length < 7) {
      errors.phone = 'Please enter a valid phone number.';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.email)) {
      errors.email = 'Please enter a valid email address.';
    }
    state.fieldErrors = errors;
    return Object.keys(errors).length === 0;
  }

  async function submitReservation() {
    if (state.submitting) return;
    if (!state.guests || !state.date || !state.time || !state.fullName || !state.phone || !state.email) {
      state.submitError = 'Please complete all required reservation details before confirming.';
      render();
      return;
    }

    state.submitting = true;
    state.submitError = '';
    render();

    try {
      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guests: state.guests,
          date: state.date,
          time: state.time,
          fullName: state.fullName,
          phone: state.phone,
          email: state.email,
          specialRequests: state.specialRequests,
          occasion: state.occasion,
          preOrder: getPreOrderItems().map(i => ({ id: i.id, qty: i.qty }))
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.reservation) {
        state.submitError = data.error || 'Could not save your reservation. Please review your details and try again.';
        if (res.status === 409) {
          fetchAvailability(state.date);
        }
        return;
      }

      state.confirmedReservation = data.reservation;
      try {
        const saved = JSON.parse(localStorage.getItem('kehnfan_reservations_v1') || '[]');
        saved.push(data.reservation);
        localStorage.setItem('kehnfan_reservations_v1', JSON.stringify(saved));
      } catch {}

      state.step = 4;
    } catch {
      state.submitError = 'Unable to connect to the reservation service. Please try again.';
    } finally {
      state.submitting = false;
      render();
      scrollTopForFlow();
    }
  }

  function render() {
    if (state.step === 1) root.innerHTML = renderStep1();
    else if (state.step === 2) root.innerHTML = renderStep2();
    else if (state.step === 3) root.innerHTML = renderStep3();
    else if (state.step === 4) root.innerHTML = renderStep4();
  }

  root.addEventListener('click', e => {
    const jumpBtn = e.target.closest('[data-jump-step]');
    if (jumpBtn && !jumpBtn.disabled) {
      const target = Number(jumpBtn.dataset.jumpStep);
      if (state.step === 2) syncStep2Inputs();
      if (target < state.step) {
        state.step = target;
        state.submitError = '';
        render();
      }
      return;
    }

    const guestBtn = e.target.closest('[data-guests]');
    if (guestBtn) {
      state.guests = guestBtn.dataset.guests;
      state.step1Error = '';
      render();
      return;
    }

    if (e.target.closest('#calPrevMonth')) {
      const d = new Date(state.viewYear, state.viewMonth - 1, 1);
      state.viewYear = d.getFullYear();
      state.viewMonth = d.getMonth();
      render();
      return;
    }

    if (e.target.closest('#calNextMonth')) {
      const d = new Date(state.viewYear, state.viewMonth + 1, 1);
      state.viewYear = d.getFullYear();
      state.viewMonth = d.getMonth();
      render();
      return;
    }

    const dayBtn = e.target.closest('[data-date]');
    if (dayBtn && !dayBtn.disabled) {
      const chosen = dayBtn.dataset.date;
      const d = parseIsoDate(chosen);
      state.date = chosen;
      state.viewYear = d.getFullYear();
      state.viewMonth = d.getMonth();
      state.step1Error = '';
      render();
      fetchAvailability(chosen);
      return;
    }

    const slotBtn = e.target.closest('[data-time]');
    if (slotBtn && !slotBtn.disabled) {
      state.time = slotBtn.dataset.time;
      state.step1Error = '';
      render();
      return;
    }

    if (e.target.closest('#step1Continue')) {
      if (!state.guests) {
        state.step1Error = 'Please select the number of guests.';
      } else if (!state.date) {
        state.step1Error = 'Please select a reservation date.';
      } else if (!state.time || isSlotUnavailable(state.date, state.time)) {
        state.step1Error = 'Please select an available time slot.';
      } else {
        state.step1Error = '';
        state.step = 2;
      }
      render();
      if (state.step === 2) scrollTopForFlow();
      return;
    }

    const occBtn = e.target.closest('[data-occasion]');
    if (occBtn) {
      syncStep2Inputs();
      const val = occBtn.dataset.occasion;
      state.occasion = state.occasion === val ? '' : val;
      render();
      return;
    }

    const catBtn = e.target.closest('[data-res-cat]');
    if (catBtn) {
      state.menuCat = catBtn.dataset.resCat;
      refreshPreOrderUI();
      return;
    }

    const preAddBtn = e.target.closest('[data-pre-add]');
    if (preAddBtn) {
      const id = preAddBtn.dataset.preAdd;
      state.preOrder[id] = (state.preOrder[id] || 0) + 1;
      refreshPreOrderUI();
      return;
    }

    const preIncBtn = e.target.closest('[data-pre-inc]');
    if (preIncBtn) {
      const id = preIncBtn.dataset.preInc;
      state.preOrder[id] = Math.min(50, (state.preOrder[id] || 0) + 1);
      refreshPreOrderUI();
      return;
    }

    const preDecBtn = e.target.closest('[data-pre-dec]');
    if (preDecBtn) {
      const id = preDecBtn.dataset.preDec;
      const next = (state.preOrder[id] || 0) - 1;
      if (next <= 0) delete state.preOrder[id];
      else state.preOrder[id] = next;
      refreshPreOrderUI();
      return;
    }

    if (e.target.closest('#resPreOrderClear')) {
      state.preOrder = {};
      refreshPreOrderUI();
      return;
    }

    if (e.target.closest('#step2Back')) {
      syncStep2Inputs();
      state.fieldErrors = {};
      state.step = 1;
      render();
      scrollTopForFlow();
      return;
    }

    if (e.target.closest('#step3Edit')) {
      state.submitError = '';
      state.step = 2;
      render();
      scrollTopForFlow();
      return;
    }

    if (e.target.closest('#step3Confirm')) {
      submitReservation();
      return;
    }

    if (e.target.closest('#addToCalendarBtn') && state.confirmedReservation) {
      downloadCalendarInvite(state.confirmedReservation);
      return;
    }

    if (e.target.closest('#resBackHomeBtn')) {
      closeModal();
      if (document.body.dataset.page === 'product') {
        window.location.href = 'index.html#home';
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  });

  root.addEventListener('input', e => {
    if (e.target && e.target.id === 'resMenuSearch') {
      state.menuSearch = e.target.value;
      refreshPreOrderUI();
    }
  });

  root.addEventListener('submit', e => {
    if (e.target && e.target.id === 'step2Form') {
      e.preventDefault();
      if (validateStep2()) {
        state.step = 3;
        render();
        scrollTopForFlow();
      } else {
        render();
        const firstErr = root.querySelector('.res-field-err:not([hidden])');
        if (firstErr && firstErr.previousElementSibling) {
          firstErr.previousElementSibling.focus();
        }
      }
    }
  });

  if (isModalMode) {
    document.addEventListener('click', e => {
      const trigger = e.target.closest('[data-open-reservation]');
      if (!trigger) return;
      e.preventDefault();
      openModal(trigger);
    });

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    backdrop.addEventListener('click', closeModal);
    modal.addEventListener('click', e => {
      if (e.target === modal) closeModal();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !modal.hidden) closeModal();
    });
  }

  render();
  if (!isModalMode) {
    fetchAvailability(state.date);
  }
})();
