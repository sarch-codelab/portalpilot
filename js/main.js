// ── Loader ───────────────────────────────────────────
window.addEventListener('load', () => {
  const bar = document.getElementById('lbar');
  const pct = document.getElementById('lpct');
  let p = 0;
  const t = setInterval(() => {
    p += Math.random() * 18;
    if (p >= 100) {
      p = 100;
      clearInterval(t);
      setTimeout(() => {
        const l = document.getElementById('loader');
        l.style.opacity = '0';
        l.style.transition = 'opacity .4s';
        setTimeout(() => l.style.display = 'none', 400);
      }, 300);
    }
    bar.style.width = p + '%';
    pct.textContent = Math.floor(p) + '%';
  }, 80);
});

// ── Custom Cursor ────────────────────────────────────
const dot = document.getElementById('cursor-dot');
const ring = document.getElementById('cursor-ring');
const glow = document.getElementById('cursor-glow');
let mx = 0, my = 0, rx = 0, ry = 0;

document.addEventListener('mousemove', e => {
  mx = e.clientX;
  my = e.clientY;
  dot.style.left = mx + 'px';
  dot.style.top = my + 'px';
  glow.style.left = mx + 'px';
  glow.style.top = my + 'px';
});

function animRing() {
  rx += (mx - rx) * 0.12;
  ry += (my - ry) * 0.12;
  ring.style.left = rx + 'px';
  ring.style.top = ry + 'px';
  requestAnimationFrame(animRing);
}
animRing();

document.querySelectorAll('a,button').forEach(el => {
  el.addEventListener('mouseenter', () => {
    ring.style.width = '50px';
    ring.style.height = '50px';
    ring.style.opacity = '.5';
  });
  el.addEventListener('mouseleave', () => {
    ring.style.width = '36px';
    ring.style.height = '36px';
    ring.style.opacity = '1';
  });
});

// ── Scroll Progress ──────────────────────────────────
window.addEventListener('scroll', () => {
  const p = (window.scrollY / (document.documentElement.scrollHeight - innerHeight)) * 100;
  document.getElementById('progress-fill').style.width = p + '%';
});

// ── Reveal ───────────────────────────────────────────
const obs = new IntersectionObserver(entries => {
  entries.forEach((e, i) => {
    if (e.isIntersecting) setTimeout(() => e.target.classList.add('in'), i * 50);
  });
}, { threshold: 0.07 });

document.querySelectorAll('.reveal,.reveal-left,.reveal-right').forEach(el => obs.observe(el));

// ── Mobile Menu ──────────────────────────────────────
function toggleMenu() {
  document.getElementById('mobileMenu').classList.toggle('open');
}

document.addEventListener('click', e => {
  const m = document.getElementById('mobileMenu');
  const h = document.getElementById('ham');
  if (m.classList.contains('open') && !m.contains(e.target) && !h.contains(e.target)) {
    m.classList.remove('open');
  }
});

// ── Nav Active ───────────────────────────────────────
window.addEventListener('scroll', () => {
  const y = window.scrollY + 80;
  document.querySelectorAll('section[id]').forEach(sec => {
    const link = document.querySelector(`.nav-links a[href="#${sec.id}"]`);
    if (link) {
      const top = sec.offsetTop, h = sec.offsetHeight;
      link.classList.toggle('active', y >= top && y < top + h);
    }
  });
});

// ── FAQ ──────────────────────────────────────────────
function toggleFaq(btn) {
  const item = btn.closest('.faq-item');
  const isOpen = item.classList.contains('open');
  document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open', 'active-highlight'));
  if (!isOpen) {
    item.classList.add('open', 'active-highlight');
  }
}

// ── Pricing Toggle ───────────────────────────────────
const prices = {
  monthly: { p1: '299', p2: '899', p3: 'Custom' },
  yearly: { p1: '239', p2: '719', p3: 'Custom' }
};

function setPricingToggle(btn, mode) {
  document.querySelectorAll('.pt-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const p = prices[mode];
  document.getElementById('p1').textContent = p.p1;
  document.getElementById('p2').textContent = p.p2;
}

// ── Plan select feedback ─────────────────────────────
function selectPlan(name, e) {
  const btn = e.currentTarget;
  const orig = btn.textContent;
  btn.textContent = '✓ Seleccionado!';
  btn.style.background = '#34d399';
  btn.style.borderColor = '#34d399';
  btn.style.color = '#000';
  setTimeout(() => {
    btn.textContent = orig;
    btn.style.background = '';
    btn.style.borderColor = '';
    btn.style.color = '';
  }, 2000);
}

// ── Typing effect for terminal ────────────────────────
function typeTerminal() {
  const lines = document.querySelectorAll('.t-line');
  lines.forEach((l, i) => {
    l.style.opacity = '0';
    l.style.transform = 'translateY(5px)';
    l.style.transition = 'opacity .3s ease, transform .3s ease';
    setTimeout(() => {
      l.style.opacity = '1';
      l.style.transform = 'translateY(0)';
    }, 600 + i * 180);
  });
}

setTimeout(typeTerminal, 1200);

// ── Database Spotlight Effect ────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const cards = document.querySelectorAll('.premium-spotlight-card');

  cards.forEach(card => {
    const glow = card.querySelector('.card-glow-element');

    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      glow.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    });
  });
});