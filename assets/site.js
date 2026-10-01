// Page motion: staggered reveals, pointer spotlight on panels, the header going solid on scroll,
// hero parallax, and the headline reacting to the scene (bg.js emits scene:hitch / scene:fix).
(() => {
  const els = document.querySelectorAll('[data-reveal]');
  const show = (e) => e.classList.add('in');
  // stagger siblings that reveal together
  els.forEach((e) => {
    const sibs = [...e.parentElement.children].filter((c) => c.hasAttribute('data-reveal'));
    const i = sibs.indexOf(e);
    if (i > 0) e.style.setProperty('--d', `${Math.min(i, 5) * 0.09}s`);
  });
  if (!('IntersectionObserver' in window)) els.forEach(show);
  else {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { show(e.target); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -8% 0px' });
    els.forEach((e) => io.observe(e));
  }

  document.addEventListener('pointermove', (e) => {
    const p = e.target.closest && e.target.closest('.panel');
    if (!p) return;
    const b = p.getBoundingClientRect();
    p.style.setProperty('--mx', `${e.clientX - b.left}px`);
    p.style.setProperty('--my', `${e.clientY - b.top}px`);
  }, { passive: true });

  const header = document.querySelector('.site-header');
  const hero = document.querySelector('.hero:not(.sub)');
  const stage = hero && hero.querySelector('.stage'), copy = hero && hero.querySelector('.hero-copy');
  let queued = false;
  const onScroll = () => {
    queued = false;
    const y = window.scrollY;
    if (header) header.classList.toggle('solid', y > 40);
    if (stage && y < innerHeight * 1.2) {   // the scene sinks slower than the page, the copy lifts away
      stage.style.transform = `translate3d(0, ${y * 0.35}px, 0)`;
      copy.style.transform = `translate3d(0, ${y * -0.12}px, 0)`;
      copy.style.opacity = String(Math.max(0, 1 - y / (innerHeight * 0.75)));
    }
  };
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(onScroll); } }, { passive: true });
  onScroll();

  const jolt = document.querySelector('.jolt');
  if (jolt) {
    document.addEventListener('scene:hitch', (e) => {
      if (e.detail.v < 0.3) return;
      jolt.classList.remove('hit'); void jolt.offsetWidth; jolt.classList.add('hit');
    });
    jolt.addEventListener('animationend', () => jolt.classList.remove('hit'));
  }

  // Download: RELEASED = false puts the "Coming soon" labels back. The unversioned asset each release uploads.
  const RELEASED = true;
  const DOWNLOAD_URL = 'https://github.com/BlueHeisenberg/SCSKiller/releases/latest/download/SCSKiller-Setup.exe';
  document.documentElement.classList.toggle('soon', !RELEASED);
  if (RELEASED) document.querySelectorAll('[data-dl]').forEach((a) => {
    a.removeAttribute('aria-disabled'); a.removeAttribute('role'); a.href = DOWNLOAD_URL;
  });
})();
