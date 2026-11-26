(function () {
  const reviewsGrid = document.getElementById('reviewsGrid');
  const openBtn = document.getElementById('openAddReview');
  const backdrop = document.getElementById('reviewModalBackdrop');
  const modal = document.getElementById('reviewModal');
  if (!reviewsGrid || !openBtn || !backdrop || !modal) return;

  const formView = document.getElementById('reviewFormView');
  const successView = document.getElementById('reviewSuccessView');
  const closeBtn = document.getElementById('closeReviewModal');
  const form = document.getElementById('reviewForm');

  const nameInput = document.getElementById('revName');
  const emailInput = document.getElementById('revEmail');
  const textInput = document.getElementById('revText');
  const charCountEl = document.getElementById('revCharCount');

  const starsWrap = document.getElementById('revStars');
  const starBtns = Array.from(starsWrap.querySelectorAll('[data-star]'));
  const ratingTextEl = document.getElementById('revRatingText');

  const photoLabel = document.getElementById('revPhotoLabel');
  const photoInput = document.getElementById('revPhotoInput');
  const dropzone = document.getElementById('revDropzone');
  const photoPreview = document.getElementById('revPhotoPreview');
  const photoThumb = document.getElementById('revPhotoThumb');
  const photoNameEl = document.getElementById('revPhotoName');
  const photoMetaEl = document.getElementById('revPhotoMeta');
  const photoRemoveBtn = document.getElementById('revPhotoRemove');

  const nameErr = document.getElementById('revNameErr');
  const emailErr = document.getElementById('revEmailErr');
  const ratingErr = document.getElementById('revRatingErr');
  const textErr = document.getElementById('revTextErr');
  const photoErr = document.getElementById('revPhotoErr');
  const submitErr = document.getElementById('revSubmitErr');
  const submitBtn = document.getElementById('revSubmitBtn');

  const successStarsEl = document.getElementById('revSuccessStars');
  const backToReviewsBtn = document.getElementById('backToReviewsBtn');
  const statusEl = document.getElementById('reviewsStatus');
  const reviewsNav = document.getElementById('reviewsNav');
  const revPrev = document.getElementById('revPrev');
  const revNext = document.getElementById('revNext');

  const MAX_BYTES = 5 * 1024 * 1024;
  const RATING_LABELS = {
    1: 'Not great · 1 of 5',
    2: 'It was okay · 2 of 5',
    3: 'Good · 3 of 5',
    4: 'Loved it · 4 of 5',
    5: 'Loved it · 5 of 5'
  };

  let reviewsList = [];
  let selectedRating = 0;
  let hoverRating = 0;
  let photoDataUrl = '';
  let isSubmitting = false;
  let clientRequestId = '';

  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  function newRequestId() {
    return `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatStarsHTML(rating) {
    const r = Math.max(1, Math.min(5, Number(rating) || 5));
    const filled = '★'.repeat(r);
    const empty = '☆'.repeat(5 - r);
    return `${filled}${empty ? `<span class="stars__empty">${empty}</span>` : ''}`;
  }

  function renderReviews(list) {
    if (!Array.isArray(list) || !list.length) return;
    reviewsGrid.innerHTML = list.map(r => {
      const dateStr = formatDate(r.createdAt);
      const photoHTML = r.photoUrl
        ? `<div class="review__photo-wrap"><img class="review__photo" src="${esc(r.photoUrl)}" alt="Photo shared by ${esc(r.name)}" loading="lazy"></div>`
        : '';
      return `<figure class="review-card">
        <div class="stars" aria-label="${esc(r.rating)} out of 5 stars">${formatStarsHTML(r.rating)}</div>
        ${photoHTML}
        <blockquote>${esc(r.review)}</blockquote>
        <figcaption>
          <span>${esc(r.name)}</span>
          ${dateStr ? `<time datetime="${esc(r.createdAt)}">${esc(dateStr)}</time>` : ''}
        </figcaption>
      </figure>`;
    }).join('');
    syncReviewsNav();
  }

  function reviewStepWidth() {
    const first = reviewsGrid.firstElementChild;
    if (!first) return 300;
    const gap = parseFloat(getComputedStyle(reviewsGrid).columnGap || getComputedStyle(reviewsGrid).gap || '20') || 20;
    return first.getBoundingClientRect().width + gap;
  }

  function syncReviewsNav() {
    if (!reviewsNav || !revPrev || !revNext) return;
    const hasOverflow = reviewsGrid.scrollWidth > reviewsGrid.clientWidth + 4;
    reviewsNav.hidden = !hasOverflow;
    revPrev.disabled = reviewsGrid.scrollLeft < 4;
    revNext.disabled = reviewsGrid.scrollLeft + reviewsGrid.clientWidth >= reviewsGrid.scrollWidth - 4;
  }

  async function loadReviews() {
    try {
      const res = await fetch('/api/reviews');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      if (Array.isArray(data.reviews) && data.reviews.length) {
        reviewsList = data.reviews;
        renderReviews(reviewsList);
      }
      if (statusEl) statusEl.hidden = true;
    } catch {
      if (statusEl) {
        statusEl.textContent = 'Showing saved highlights. Unable to refresh latest reviews right now.';
        statusEl.hidden = false;
      }
    }
  }

  function updateStarsUI() {
    const active = hoverRating || selectedRating;
    starBtns.forEach(btn => {
      const val = Number(btn.dataset.star);
      btn.classList.toggle('is-active', val <= active);
      btn.setAttribute('aria-checked', String(val === selectedRating));
    });
    if (selectedRating > 0) {
      ratingTextEl.textContent = RATING_LABELS[selectedRating];
      ratingTextEl.classList.remove('is-required');
    } else if (hoverRating > 0) {
      ratingTextEl.textContent = RATING_LABELS[hoverRating];
      ratingTextEl.classList.remove('is-required');
    } else {
      ratingTextEl.textContent = 'Tap a star to rate';
    }
  }

  function setFieldError(fieldId, errEl, message) {
    const field = document.getElementById(fieldId);
    if (message) {
      if (field) field.classList.add('is-invalid');
      errEl.innerHTML = `<span aria-hidden="true">&#9888;</span> ${esc(message)}`;
      errEl.hidden = false;
    } else {
      if (field) field.classList.remove('is-invalid');
      errEl.textContent = '';
      errEl.hidden = true;
    }
  }

  function clearPhoto() {
    photoDataUrl = '';
    photoInput.value = '';
    photoThumb.src = '';
    photoPreview.hidden = true;
    dropzone.hidden = false;
    photoLabel.innerHTML = 'Add a photo <span class="rev-opt">(optional)</span>';
    setFieldError('revPhotoField', photoErr, '');
  }

  function handlePhotoFile(file) {
    if (!file) return;
    const validType = file.type === 'image/jpeg' || file.type === 'image/png';
    if (!validType) {
      setFieldError('revPhotoField', photoErr, 'Uploaded images must be JPG or PNG.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setFieldError('revPhotoField', photoErr, 'Uploaded image must be no larger than 5 MB.');
      return;
    }
    setFieldError('revPhotoField', photoErr, '');

    const reader = new FileReader();
    reader.onload = () => {
      photoDataUrl = String(reader.result || '');
      photoThumb.src = photoDataUrl;
      photoNameEl.textContent = file.name;
      const mb = Math.max(0.1, file.size / (1024 * 1024)).toFixed(1);
      photoMetaEl.textContent = `${mb} MB · uploaded ✓`;
      dropzone.hidden = true;
      photoPreview.hidden = false;
      photoLabel.innerHTML = 'Your photo <span class="rev-opt">(optional)</span>';
    };
    reader.readAsDataURL(file);
  }

  function resetModalForm() {
    form.reset();
    selectedRating = 0;
    hoverRating = 0;
    clientRequestId = newRequestId();
    charCountEl.textContent = '0 / 500';
    ratingTextEl.classList.remove('is-required');
    updateStarsUI();
    clearPhoto();
    setFieldError('revNameField', nameErr, '');
    setFieldError('revEmailField', emailErr, '');
    setFieldError('revRatingField', ratingErr, '');
    setFieldError('revTextField', textErr, '');
    submitErr.hidden = true;
    formView.hidden = false;
    successView.hidden = true;
  }

  function openModal() {
    resetModalForm();
    backdrop.hidden = false;
    modal.hidden = false;
    document.body.classList.add('lock');
    nameInput.focus();
  }

  function closeModal() {
    backdrop.hidden = true;
    modal.hidden = true;
    document.body.classList.remove('lock');
    openBtn.focus();
  }

  function validateForm() {
    let valid = true;
    const nameVal = nameInput.value.trim();
    const emailVal = emailInput.value.trim();
    const reviewVal = textInput.value.trim();

    if (!nameVal) {
      setFieldError('revNameField', nameErr, 'Please tell us your name so we can say thanks');
      valid = false;
    } else {
      setFieldError('revNameField', nameErr, '');
    }

    if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      setFieldError('revEmailField', emailErr, "That email doesn't look quite right");
      valid = false;
    } else {
      setFieldError('revEmailField', emailErr, '');
    }

    if (selectedRating < 1 || selectedRating > 5) {
      ratingTextEl.textContent = 'Required';
      ratingTextEl.classList.add('is-required');
      setFieldError('revRatingField', ratingErr, 'Please choose a star rating');
      valid = false;
    } else {
      setFieldError('revRatingField', ratingErr, '');
    }

    if (reviewVal.length < 20) {
      setFieldError('revTextField', textErr, 'Add at least 20 characters');
      valid = false;
    } else if (reviewVal.length > 500) {
      setFieldError('revTextField', textErr, 'Review must be 500 characters or fewer');
      valid = false;
    } else {
      setFieldError('revTextField', textErr, '');
    }

    return valid;
  }

  openBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', closeModal);
  modal.addEventListener('click', e => {
    if (e.target === modal) closeModal();
  });

  backToReviewsBtn.addEventListener('click', () => {
    closeModal();
    document.getElementById('reviews').scrollIntoView({ behavior: 'smooth' });
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
  });

  starBtns.forEach(btn => {
    const val = Number(btn.dataset.star);
    btn.addEventListener('mouseenter', () => {
      hoverRating = val;
      updateStarsUI();
    });
    btn.addEventListener('click', () => {
      selectedRating = val;
      setFieldError('revRatingField', ratingErr, '');
      updateStarsUI();
    });
  });

  starsWrap.addEventListener('mouseleave', () => {
    hoverRating = 0;
    updateStarsUI();
  });

  nameInput.addEventListener('input', () => {
    if (nameInput.value.trim()) setFieldError('revNameField', nameErr, '');
  });

  emailInput.addEventListener('input', () => {
    const v = emailInput.value.trim();
    if (!v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) setFieldError('revEmailField', emailErr, '');
  });

  textInput.addEventListener('input', () => {
    const len = textInput.value.length;
    charCountEl.textContent = `${len} / 500`;
    if (textInput.value.trim().length >= 20 && len <= 500) {
      setFieldError('revTextField', textErr, '');
    }
  });

  dropzone.addEventListener('click', () => photoInput.click());
  dropzone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      photoInput.click();
    }
  });
  dropzone.addEventListener('dragover', e => {
    e.preventDefault();
    dropzone.classList.add('is-dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('is-dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) handlePhotoFile(file);
  });
  photoInput.addEventListener('change', () => {
    const file = photoInput.files?.[0];
    if (file) handlePhotoFile(file);
  });
  photoRemoveBtn.addEventListener('click', clearPhoto);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (isSubmitting) return;
    submitErr.hidden = true;

    if (!validateForm()) {
      const firstErrField = form.querySelector('.is-invalid input, .is-invalid textarea');
      if (firstErrField) firstErrField.focus();
      return;
    }

    isSubmitting = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: nameInput.value.trim(),
          email: emailInput.value.trim(),
          rating: selectedRating,
          review: textInput.value.trim(),
          photoDataUrl,
          clientRequestId
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.review) {
        submitErr.textContent = data.error || 'Could not save your review. Please try again.';
        submitErr.hidden = false;
        return;
      }

      reviewsList = [data.review, ...reviewsList.filter(item => item.id !== data.review.id)];
      renderReviews(reviewsList);
      reviewsGrid.scrollTo({ left: 0, behavior: 'auto' });
      syncReviewsNav();

      successStarsEl.innerHTML = formatStarsHTML(data.review.rating);
      formView.hidden = true;
      successView.hidden = false;
      backToReviewsBtn.focus();
    } catch {
      submitErr.textContent = 'Unable to connect to the server. Please try again.';
      submitErr.hidden = false;
    } finally {
      isSubmitting = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Review';
    }
  });

  if (revPrev && revNext) {
    revPrev.addEventListener('click', () => {
      reviewsGrid.scrollBy({ left: -reviewStepWidth(), behavior: 'smooth' });
    });
    revNext.addEventListener('click', () => {
      reviewsGrid.scrollBy({ left: reviewStepWidth(), behavior: 'smooth' });
    });
  }
  reviewsGrid.addEventListener('scroll', syncReviewsNav, { passive: true });
  window.addEventListener('resize', syncReviewsNav);

  syncReviewsNav();
  loadReviews();
})();
