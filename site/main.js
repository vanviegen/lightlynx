// Light Lynx Landing Page — Interactive JS
// Screenshot popup on hover/touch, smooth scroll behavior

const popup = document.getElementById('screenshot-popup');
const popupImg = popup?.querySelector('img');

// Screenshot popup on hover/touch for .screenshot-hint elements
document.querySelectorAll('.screenshot-hint').forEach(el => {
  const name = el.dataset.screenshot;
  if (!name) return;
  const src = `/${name}.png`;

  // Preload image
  const img = new Image();
  img.src = src;

  el.addEventListener('mouseenter', (e) => {
    showPopup(src, e);
  });

  el.addEventListener('mousemove', (e) => {
    positionPopup(e);
  });

  el.addEventListener('mouseleave', () => {
    hidePopup();
  });

  // Touch: show on tap, hide on second tap or outside tap
  el.addEventListener('click', (e) => {
    e.preventDefault();
    if (popup?.classList.contains('visible') && popupImg?.src.endsWith(src)) {
      hidePopup();
    } else {
      showPopup(src, e);
      // Position centered on mobile
      if (popup) {
        popup.style.left = '50%';
        popup.style.top = '50%';
        popup.style.transform = 'translate(-50%, -50%)';
      }
    }
  });
});

// Hide popup when clicking outside on mobile
document.addEventListener('click', (e) => {
  if (!(e.target instanceof Element)) return;
  if (!e.target.closest('.screenshot-hint') && popup?.classList.contains('visible')) {
    hidePopup();
  }
});

function showPopup(src, e) {
  if (!popup || !popupImg) return;
  popupImg.src = src;
  popup.classList.add('visible');
  popup.style.transform = '';
  positionPopup(e);
}

function positionPopup(e) {
  if (!popup || !popup.classList.contains('visible')) return;
  // Don't reposition if using fixed-center (touch)
  if (popup.style.transform) return;

  const pad = 16;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Position to the right of cursor, flip if near edge
  let x = e.clientX + pad;
  let y = e.clientY + pad;

  // Get popup dimensions (may be 0 if image not loaded yet)
  const rect = popup.getBoundingClientRect();
  const pw = rect.width || 360;
  const ph = rect.height || 640;

  if (x + pw > vw - pad) x = e.clientX - pw - pad;
  if (y + ph > vh - pad) y = vh - ph - pad;
  if (x < pad) x = pad;
  if (y < pad) y = pad;

  popup.style.left = x + 'px';
  popup.style.top = y + 'px';
}

function hidePopup() {
  popup?.classList.remove('visible');
}

// Smooth scroll for anchor links (fallback for browsers without CSS scroll-behavior)
document.querySelectorAll('a[href^="#"]').forEach(link => {
  link.addEventListener('click', (e) => {
    const target = document.querySelector(link.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});
