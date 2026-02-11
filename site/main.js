// Light Lynx Landing Page — Interactive JS
// Accordion, download handling, smooth scroll, demo server selection

// ---- Demo server selection (persistent in localStorage) ----
function getDemoUrl() {
  let demoNumber = localStorage.getItem('lightlynx-demo-number');
  if (!demoNumber) {
    // Pick a random number from 00 to 09
    demoNumber = String(Math.floor(Math.random() * 10)).padStart(2, '0');
    localStorage.setItem('lightlynx-demo-number', demoNumber);
  }
  return `https://app.lightlynx.eu/?instanceId=demo${demoNumber}.lightlynx.eu:443&userName=admin`;
}

// Attach demo button handlers
document.querySelectorAll('#show-demo-hero, #show-demo-cta').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    window.open(getDemoUrl(), '_blank', 'noopener');
  });
});

// ---- Single-open accordion: only one feature card open at a time ----
document.querySelectorAll('.feature-card').forEach(card => {
  card.addEventListener('toggle', () => {
    if (card.open) {
      document.querySelectorAll('.feature-card').forEach(other => {
        if (other !== card && other.open) other.open = false;
      });
    }
  });
});

// ---- Force download for extension links (cross-origin `download` attr is ignored) ----
document.querySelectorAll('a.download-link').forEach(link => {
  link.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(link.href);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = link.getAttribute('download') || 'lightlynx.js';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Fallback: just navigate
      window.open(link.href, '_blank');
    }
  });
});

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
