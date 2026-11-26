(function () {
  const { products, categories, allPreview, featured, currency } = window.MENU;
  const $ = (s, r = document) => r.querySelector(s);
  const byId = Object.fromEntries(products.map(p => [p.id, p]));
  const price = p => currency + p.price;
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  let current = 'all';

  const img = (p, cls = '') => p.image
    ? `<img class="${cls}" src="${p.image}" alt="${esc(p.name)}" loading="lazy">`
    : `<div class="ph ${cls}" role="img" aria-label="${esc(p.name)} – photo coming soon">Photo coming soon</div>`;

  const card = p => `<article class="card">${img(p)}
    <div class="card__label"><h3>${esc(p.name)}</h3><span>${price(p)}</span></div>
    <button class="card__add" type="button" aria-label="Add ${esc(p.name)}">+</button></article>`;

  const list = id => id === 'all' ? null : products.filter(p => p.category === id);

  function tabs(el) {
    el.innerHTML = categories.map(c =>
      `<button type="button" data-cat="${c.id}" aria-pressed="${c.id === current}">${c.label}</button>`).join('');
  }
  function render() {
    tabs($('#menuTabs')); tabs($('#fullTabs'));
    const preview = (list(current) || allPreview.map(i => byId[i]));
    $('#menuGrid').innerHTML = preview.map(card).join('');
    $('#fullGrid').innerHTML = (list(current) || products).map(card).join('');
  }
  function setCategory(id) { current = id; render(); }

  document.addEventListener('click', e => {
    const t = e.target.closest('#menuTabs button, #fullTabs button');
    if (t) return setCategory(t.dataset.cat);
    const c = e.target.closest('.cats button');
    if (c) { setCategory(c.dataset.cat); $('#menu').scrollIntoView({ behavior: 'smooth' }); }
  });

  /* Full-menu overlay */
  const full = $('#fullMenu');
  function openFull() { full.hidden = false; document.body.classList.add('lock'); full.scrollTop = 0; $('#closeFull').focus(); }
  function closeFull() { full.hidden = true; document.body.classList.remove('lock'); $('#openFull').focus(); }
  $('#openFull').onclick = openFull;
  $('#closeFull').onclick = closeFull;
  full.addEventListener('click', e => { if (e.target.closest('[data-close]')) { e.preventDefault(); closeFull(); window.scrollTo({ top: 0 }); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !full.hidden) closeFull(); });

  /* Favorites carousel */
  const track = $('#favTrack');
  track.innerHTML = featured.map(i => byId[i]).map(p => `<article class="fav__card">${img(p)}
    <h3>${esc(p.name)}</h3><div class="fav__foot"><strong>${price(p)}</strong><button type="button" aria-label="Add ${esc(p.name)}">Add +</button></div></article>`).join('');
  const prev = $('#favPrev'), next = $('#favNext');
  const step = () => track.firstElementChild.getBoundingClientRect().width + parseFloat(getComputedStyle(track).columnGap || 0);
  const sync = () => { prev.disabled = track.scrollLeft < 4; next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4; };
  prev.onclick = () => track.scrollBy({ left: -step(), behavior: 'smooth' });
  next.onclick = () => track.scrollBy({ left: step(), behavior: 'smooth' });
  track.addEventListener('scroll', sync, { passive: true }); addEventListener('resize', sync);

  /* Nav */
  const nav = $('#nav'), toggle = $('#navToggle');
  const onScroll = () => nav.classList.toggle('nav--solid', scrollY > 40);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
  toggle.onclick = () => { const o = nav.classList.toggle('nav--open'); toggle.setAttribute('aria-expanded', o); };
  $('#navLinks').addEventListener('click', () => { nav.classList.remove('nav--open'); toggle.setAttribute('aria-expanded', false); });

  render(); sync();
})();
