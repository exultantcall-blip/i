const lightbox = document.querySelector(".lightbox");
const lightboxImage = lightbox?.querySelector("img");
const lightboxClose = lightbox?.querySelector(".lightbox-close");
const lightboxPrev = lightbox?.querySelector(".lightbox-prev");
const lightboxNext = lightbox?.querySelector(".lightbox-next");
const estimateModal = document.querySelector(".estimate-modal");
const siteHeader = document.querySelector(".site-header");
const navToggle = document.querySelector(".nav-toggle");
const mainNav = document.querySelector(".main-nav");
// Set this before main.js to forward leads to a CRM, email service, or webhook.
const leadEndpoint = window.IMAMOV_LEAD_ENDPOINT || "";
let headerScrolled = null;
let headerTicking = false;
let lastLightboxTrigger = null;
let lastModalTrigger = null;
let lightboxIndex = -1;
const lightboxImageCache = new Map();

function keepHomeOnHeroOnInitialLoad() {
  if (document.body.classList.contains("inner-page") || !document.querySelector(".hero")) return;

  if (window.location.hash) {
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }
  if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
  }
}

keepHomeOnHeroOnInitialLoad();

function initHeroGentleScroll() {
  const hero = document.querySelector(".hero");
  if (!hero || document.body.classList.contains("inner-page")) return;

  const scroller = document.scrollingElement || document.documentElement;
  let frame = 0;
  let animationStart = 0;
  let fromY = 0;
  let targetY = 0;
  let touchActive = false;
  let touchLastX = 0;
  let touchLastY = 0;

  const currentY = () => window.scrollY || scroller.scrollTop || 0;
  const maxY = () => Math.max(0, scroller.scrollHeight - window.innerHeight);
  const heroBottom = () => hero.offsetTop + hero.offsetHeight;
  const isLocked = () =>
    document.body.classList.contains("modal-open") ||
    siteHeader?.classList.contains("nav-open");
  const isNearHero = () => {
    const y = currentY();
    if (y < heroBottom() - 1) return hero.getBoundingClientRect().bottom > 0;
    return y < heroBottom() + Math.min(180, window.innerHeight * 0.22);
  };
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const withInstantScrollBehavior = (callback) => {
    const previousBehavior = scroller.style.scrollBehavior;
    scroller.style.scrollBehavior = "auto";
    callback();
    if (previousBehavior) {
      scroller.style.scrollBehavior = previousBehavior;
    } else {
      scroller.style.removeProperty("scroll-behavior");
    }
  };

  const render = (time) => {
    if (!animationStart) animationStart = time;
    const distance = Math.abs(targetY - fromY);
    const duration = clamp(distance * 1.15, 260, 520);
    const progress = clamp((time - animationStart) / duration, 0, 1);
    const next = Math.round(fromY + (targetY - fromY) * easeOut(progress));
    withInstantScrollBehavior(() => {
      scroller.scrollTop = next;
    });
    updateHeaderState();
    if (progress < 1 && Math.abs(targetY - currentY()) > 1) {
      frame = requestAnimationFrame(render);
    } else {
      frame = 0;
      animationStart = 0;
      fromY = targetY;
    }
  };

  const animateBy = (delta, source, event) => {
    if (!delta || isLocked() || !isNearHero()) return false;
    if (event?.cancelable) event.preventDefault();
    const abs = Math.abs(delta);
    const sign = Math.sign(delta);
    const factor = source === "touch" ? 1.55 : 2.15;
    const cap = Math.min(source === "touch" ? 320 : 300, window.innerHeight * 0.34);
    const distance = sign * Math.min(abs * factor, cap);
    const base = frame ? targetY : currentY();
    targetY = clamp(base + distance, 0, maxY());
    fromY = currentY();
    animationStart = 0;
    if (!frame) frame = requestAnimationFrame(render);
    return true;
  };

  const normalizedWheelDelta = (event) => {
    if (event.deltaMode === 1) return event.deltaY * 16;
    if (event.deltaMode === 2) return event.deltaY * window.innerHeight;
    return event.deltaY;
  };

  window.addEventListener("wheel", (event) => {
    if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    animateBy(normalizedWheelDelta(event), "wheel", event);
  }, { passive: false });

  window.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1 || isLocked()) {
      touchActive = false;
      return;
    }
    const touch = event.touches[0];
    touchActive = true;
    touchLastX = touch.clientX;
    touchLastY = touch.clientY;
  }, { passive: true });

  window.addEventListener("touchmove", (event) => {
    if (!touchActive || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const deltaX = touchLastX - touch.clientX;
    const deltaY = touchLastY - touch.clientY;
    touchLastX = touch.clientX;
    touchLastY = touch.clientY;
    if (Math.abs(deltaY) <= Math.abs(deltaX) * 1.15) return;
    animateBy(deltaY, "touch", event);
  }, { passive: false });

  window.addEventListener("touchend", () => {
    touchActive = false;
  }, { passive: true });
  window.addEventListener("touchcancel", () => {
    touchActive = false;
  }, { passive: true });
}

initHeroGentleScroll();

function trackGoal(goal, params = {}) {
  if (typeof window.ym === "function") {
    try {
      window.ym(106785987, "reachGoal", goal, params);
    } catch {
      // Analytics must never block the lead flow.
    }
  }
  if (typeof window.gtag === "function") {
    try {
      window.gtag("event", goal, params);
    } catch {
      // Analytics must never block the lead flow.
    }
  }
}

document.querySelectorAll("img").forEach((img) => {
  img.setAttribute("draggable", "false");
});

const lightboxItems = Array.from(document.querySelectorAll("[data-lightbox]"));

function getLightboxItem(index) {
  if (!lightboxItems.length) return null;
  const nextIndex = (index + lightboxItems.length) % lightboxItems.length;
  return {
    index: nextIndex,
    button: lightboxItems[nextIndex]
  };
}

function preloadLightboxImage(index, priority = "low") {
  const item = getLightboxItem(index);
  if (!item) return null;
  const src = item.button.getAttribute("data-lightbox");
  if (!src) return null;
  const cached = lightboxImageCache.get(src);
  if (cached) return cached;

  const image = new Image();
  image.decoding = "async";
  image.loading = "eager";
  if ("fetchPriority" in image) image.fetchPriority = priority;
  image.src = src;

  const ready = image.decode
    ? image.decode().catch(() => {})
    : new Promise((resolve) => {
      image.onload = resolve;
      image.onerror = resolve;
    });

  const record = { image, ready };
  lightboxImageCache.set(src, record);
  return record;
}

function warmLightboxImages(index) {
  preloadLightboxImage(index, "high");
  preloadLightboxImage(index + 1);
  preloadLightboxImage(index - 1);
  preloadLightboxImage(index + 2);
  preloadLightboxImage(index - 2);
}

function warmInitialLightboxImages() {
  if (!lightboxItems.length) return;
  const warm = () => {
    lightboxItems.slice(0, 4).forEach((_, index) => preloadLightboxImage(index));
  };
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(warm, { timeout: 1600 });
  } else {
    window.setTimeout(warm, 900);
  }
}

function setLightboxImage(index) {
  if (!lightboxImage || !lightboxItems.length) return;
  const item = getLightboxItem(index);
  if (!item) return;
  const { button, index: nextIndex } = item;
  const src = button.getAttribute("data-lightbox");
  const img = button.querySelector("img");
  if (!src) return;
  lightboxIndex = nextIndex;
  lightboxImage.src = src;
  lightboxImage.alt = img?.alt || "Фото объекта";
  warmLightboxImages(nextIndex);
}

function openLightbox(button) {
  if (!lightbox || !lightboxImage) return;
  const index = lightboxItems.indexOf(button);
  if (index < 0) return;
  lastLightboxTrigger = button;
  setLightboxImage(index);
  lightbox.hidden = false;
  document.body.classList.add("modal-open");
  lightboxClose?.focus();
}

function showLightboxImage(direction) {
  if (!lightbox || lightbox.hidden || lightboxIndex < 0) return;
  setLightboxImage(lightboxIndex + direction);
}

lightboxItems.forEach((button, index) => {
  button.addEventListener("pointerenter", () => warmLightboxImages(index), { passive: true });
  button.addEventListener("pointerdown", () => warmLightboxImages(index), { passive: true });
  button.addEventListener("focus", () => warmLightboxImages(index));
  button.addEventListener("click", () => {
    openLightbox(button);
  });
});

function closeLightbox() {
  if (!lightbox || !lightboxImage) return;
  lightbox.hidden = true;
  lightboxImage.src = "";
  document.body.classList.remove("modal-open");
  lastLightboxTrigger?.focus();
  lastLightboxTrigger = null;
  lightboxIndex = -1;
}

function openEstimateModal() {
  if (!estimateModal) return;
  lastModalTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  trackGoal("estimate_open", { source: "modal" });
  closeNavMenu();
  estimateModal.hidden = false;
  document.body.classList.add("modal-open");
  estimateModal.querySelector("input[name='name']")?.focus();
}

function closeEstimateModal() {
  if (!estimateModal) return;
  estimateModal.hidden = true;
  document.body.classList.remove("modal-open");
  lastModalTrigger?.focus();
  lastModalTrigger = null;
}

function getHashTarget() {
  if (!window.location.hash) return null;
  try {
    return document.querySelector(window.location.hash);
  } catch {
    return null;
  }
}

function closeNavMenu() {
  if (!siteHeader || !navToggle) return;
  siteHeader.classList.remove("nav-open");
  navToggle.setAttribute("aria-expanded", "false");
  navToggle.setAttribute("aria-label", "Открыть меню");
}

function toggleNavMenu() {
  if (!siteHeader || !navToggle) return;
  const isOpen = siteHeader.classList.toggle("nav-open");
  navToggle.setAttribute("aria-expanded", String(isOpen));
  navToggle.setAttribute("aria-label", isOpen ? "Закрыть меню" : "Открыть меню");
}

function buildLeadText(form) {
  const data = new FormData(form);
  const name = String(data.get("name") || "").trim();
  const phone = String(data.get("phone") || "").trim();
  const object = String(data.get("object") || "").trim();
  const area = String(data.get("area") || "").trim();
  const finish = String(data.get("finish") || "").trim();
  const source = form.dataset.formSource || "Форма сайта";
  const lines = [
    "Здравствуйте. Хочу предварительно рассчитать ремонт в «Имамов Ремонт».",
    `Источник: ${source}`,
    name ? `Имя: ${name}` : "",
    phone ? `Телефон: ${phone}` : "",
    object ? `Тип объекта: ${object}` : "",
    area ? `Площадь: ${area} м²` : "",
    finish ? `Уровень отделки: ${finish}` : "",
    "Подскажите, пожалуйста, какие вводные еще нужны для предварительной сметы."
  ].filter(Boolean);
  return lines.join("\n");
}

function setLeadStatus(form, message) {
  const status = form.querySelector("[data-lead-status]");
  if (status) status.textContent = message;
}

async function copyLeadText(text) {
  try {
    await navigator.clipboard?.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function sendLeadToEndpoint(payload) {
  if (!leadEndpoint) return false;
  const body = JSON.stringify(payload);
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(leadEndpoint, blob)) return true;
    }
  } catch {
    // keepalive fetch below is the fallback for browsers that reject JSON beacons.
  }
  try {
    await fetch(leadEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true
    });
    return true;
  } catch {
    return false;
  }
}

async function submitLeadForm(form) {
  const data = new FormData(form);
  if (String(data.get("website") || "").trim() !== "") return;
  const channel = String(data.get("channel") || "whatsapp");
  const leadText = buildLeadText(form);
  const text = encodeURIComponent(leadText);
  sendLeadToEndpoint({
    name: String(data.get("name") || "").trim(),
    phone: String(data.get("phone") || "").trim(),
    object: String(data.get("object") || "").trim(),
    area: String(data.get("area") || "").trim(),
    finish: String(data.get("finish") || "").trim(),
    website: String(data.get("website") || "").trim(),
    channel,
    source: form.dataset.formSource || "Форма сайта",
    message: leadText
  });
  trackGoal("lead_submit", {
    channel,
    source: form.dataset.formSource || "Форма сайта"
  });

  const shouldCopyLeadText = channel === "telegram" || channel === "max";
  const copiedLeadText = shouldCopyLeadText ? await copyLeadText(leadText) : false;
  const urls = {
    whatsapp: `https://api.whatsapp.com/send?phone=79219582786&text=${text}`,
    telegram: "https://t.me/AbdullaStroy",
    max: "https://max.ru/AbdullaStroy"
  };
  const targetUrl = urls[channel] || urls.whatsapp;
  trackGoal("lead_messenger_open", { channel });
  const opened = window.open(targetUrl, "_blank");
  if (opened) {
    opened.opener = null;
  } else {
    window.location.href = targetUrl;
  }
  if (channel === "max") {
    setLeadStatus(form, copiedLeadText
      ? "Текст заявки скопирован. Вставьте его в открывшемся канале связи."
      : "Скопируйте данные заявки вручную и отправьте их в выбранном канале связи.");
  } else if (channel === "telegram") {
    setLeadStatus(form, copiedLeadText
      ? "Открыт Telegram Абдуллы. Текст заявки скопирован — вставьте его в чат и отправьте."
      : "Открыт Telegram Абдуллы. Если текст не скопировался, скопируйте данные заявки вручную и отправьте в чат.");
  }
}

function initReveal() {
  const targets = document.querySelectorAll([
    ".section-head",
    ".trust-visual",
    ".trust-metrics article",
    ".benefit-grid article",
    ".compare-table",
    ".process-card",
    ".feature-grid article",
    ".project-card",
    ".budget-card",
    ".estimate-strip",
    ".offer-note",
    ".warranty-grid article",
    ".faq-card",
    ".reviews-grid blockquote",
    ".owner-photo",
    ".owner-copy",
    ".owner-facts article",
    ".footer-top",
    ".footer-grid",
    ".footer-disclaimer",
    ".footer-bottom"
  ].join(","));

  targets.forEach((target) => target.classList.add("reveal"));

  const showVisibleTargets = () => {
    targets.forEach((target) => {
      const rect = target.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.96 && rect.bottom > 0) {
        target.classList.add("is-visible");
      }
    });
  };

  const showHashTarget = () => {
    const target = getHashTarget();
    if (!target) return;
    if (target.classList.contains("reveal")) {
      target.classList.add("is-visible");
    }
    target.querySelectorAll(".reveal").forEach((item) => item.classList.add("is-visible"));
  };

  if (!("IntersectionObserver" in window)) {
    targets.forEach((target) => target.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, {
    threshold: 0.12,
    rootMargin: "0px 0px -8% 0px"
  });

  targets.forEach((target) => observer.observe(target));

  let ticking = false;
  const scheduleVisibleCheck = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      showVisibleTargets();
      ticking = false;
    });
  };

  window.addEventListener("hashchange", () => {
    showHashTarget();
    scheduleVisibleCheck();
  });
  requestAnimationFrame(showVisibleTargets);
  requestAnimationFrame(showHashTarget);
  window.setTimeout(showVisibleTargets, 120);
  window.setTimeout(showHashTarget, 240);
}

function updateHeaderState() {
  if (!siteHeader) return;
  const isScrolled = window.scrollY > 24;
  if (headerScrolled === isScrolled) return;
  headerScrolled = isScrolled;
  siteHeader.classList.toggle("header-scrolled", isScrolled);
}

function scheduleHeaderState() {
  if (headerTicking) return;
  headerTicking = true;
  requestAnimationFrame(() => {
    headerTicking = false;
    updateHeaderState();
  });
}

function initCustomCursor() {
  const canUseCursor = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!canUseCursor || prefersReducedMotion || document.body.classList.contains("custom-cursor")) return;

  const dot = document.createElement("span");
  const ring = document.createElement("span");
  dot.className = "cursor-dot";
  ring.className = "cursor-ring";
  document.body.append(dot, ring);
  document.body.classList.add("custom-cursor");

  let x = window.innerWidth / 2;
  let y = window.innerHeight / 2;
  let ringX = x;
  let ringY = y;
  let cursorFrame = 0;

  const render = () => {
    ringX += (x - ringX) * 0.22;
    ringY += (y - ringY) * 0.22;
    dot.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    ring.style.transform = `translate3d(${ringX}px, ${ringY}px, 0) translate(-50%, -50%)`;

    if (Math.abs(x - ringX) > 0.2 || Math.abs(y - ringY) > 0.2) {
      cursorFrame = requestAnimationFrame(render);
    } else {
      cursorFrame = 0;
    }
  };

  const scheduleCursorRender = () => {
    if (!cursorFrame) cursorFrame = requestAnimationFrame(render);
  };

  window.addEventListener("pointermove", (event) => {
    x = event.clientX;
    y = event.clientY;
    dot.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    scheduleCursorRender();
  }, { passive: true });

  const interactiveSelector = [
    "a",
    "button",
    "input",
    "select",
    "textarea",
    "[data-lightbox]",
    ".map-pill",
    ".social-disabled",
    ".project-card",
    ".lift-card"
  ].join(",");

  document.addEventListener("pointerover", (event) => {
    if (event.target.closest(interactiveSelector)) {
      document.body.classList.add("cursor-active");
    }
  });

  document.addEventListener("pointerout", (event) => {
    if (event.target.closest(interactiveSelector)) {
      document.body.classList.remove("cursor-active");
    }
  });

  scheduleCursorRender();
}

function getPortfolioObjectKey(card) {
  const src = card.querySelector("[data-lightbox]")?.getAttribute("data-lightbox") || "";
  const moika = ["DSC07547","DSC07548","DSC07561","DSC07550","DSC07554","DSC07557","DSC07564","DSC07583","DSC07568","DSC07571","DSC07575","DSC07582"];
  const podpisnye = ["DSC07695","DSC07730","DSC07609","DSC07704","DSC07760","DSC07821","DSC07613","DSC07640","DSC07780","DSC07629","DSC07768","DSC07822"];
  const petrovskiy11 = ["DSC07892","DSC07908","DSC07889","DSC07894","DSC07898","DSC07888","DSC07912","DSC07916","DSC07923","DSC07928","DSC07931","DSC07943"];
  const posadskaya = ["DSC07843","DSC07847","DSC07874","DSC07855","DSC07849","DSC07864","DSC07875","DSC07854","DSC07861","DSC07877","DSC07879","DSC07881"];

  if (moika.some((name) => src.includes(name))) return "moika";
  if (podpisnye.some((name) => src.includes(name))) return "podpisnye";
  if (petrovskiy11.some((name) => src.includes(name))) return "petrovskiy11";
  if (posadskaya.some((name) => src.includes(name))) return "posadskaya";
  if (src.includes("photo_2026-05-18")) return "petrovskiy22";
  return "other";
}

function createPortfolioFact(label, value) {
  const item = document.createElement("div");
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.textContent = value;
  item.append(term, description);
  return item;
}

function initPortfolioObjectGroups() {
  const sourceGrid = document.querySelector(".portfolio-page .full-portfolio-grid");
  if (!sourceGrid || document.querySelector(".portfolio-objects")) return;

  const configs = [
    {
      key: "moika",
      category: "apartment",
      type: "Квартира",
      title: "Набережная реки Мойки, 40",
      facts: [["Площадь", "350 м²"], ["Срок", "18 месяцев"], ["Бюджет", "28,2 млн ₽"]]
    },
    {
      key: "petrovskiy22",
      category: "apartment",
      type: "Квартира",
      title: "Петровский проспект, 22",
      facts: [["Площадь", "126 м²"], ["Срок", "август 2024 - август 2025"], ["Бюджет", "8,2 млн ₽"]]
    },
    {
      key: "petrovskiy11",
      category: "apartment",
      type: "Квартира",
      title: "Петровский проспект, 11",
      facts: [["Площадь", "176 м²"], ["Срок", "10 месяцев"], ["Бюджет", "9,8 млн ₽"]]
    },
    {
      key: "posadskaya",
      category: "apartment",
      type: "Квартира",
      title: "Большая Посадская, 6",
      facts: [["Площадь", "152 м²"], ["Срок", "февраль 2010 - август 2010"], ["Бюджет", "6,8 млн ₽"]]
    },
    {
      key: "podpisnye",
      category: "commercial",
      type: "Коммерция",
      title: "«Подписные издания»",
      facts: [["Площадь", "560 м²"], ["Срок", "3 месяца"], ["Бюджет", "5,2 млн ₽"]]
    }
  ];

  const cards = Array.from(sourceGrid.querySelectorAll(".project-card"));
  const groups = document.createElement("div");
  groups.className = "portfolio-objects";

  configs.forEach((config) => {
    const galleryCards = cards.filter((card) => getPortfolioObjectKey(card) === config.key);
    if (!galleryCards.length) return;

    const section = document.createElement("section");
    section.className = "portfolio-object";
    section.dataset.category = config.category;

    const head = document.createElement("div");
    head.className = "portfolio-object-head";

    const titleWrap = document.createElement("div");
    titleWrap.className = "portfolio-object-title";
    const kicker = document.createElement("p");
    kicker.className = "kicker dark";
    kicker.textContent = config.type;
    const title = document.createElement("h2");
    title.textContent = config.title;
    titleWrap.append(kicker, title);

    const facts = document.createElement("dl");
    facts.className = "portfolio-object-facts";
    config.facts.forEach(([label, value]) => facts.append(createPortfolioFact(label, value)));

    const grid = document.createElement("div");
    grid.className = "portfolio-grid full-portfolio-grid";
    galleryCards.forEach((card) => {
      card.hidden = false;
      card.dataset.category = config.category;
      grid.append(card);
    });

    head.append(titleWrap, facts);
    section.append(head, grid);
    groups.append(section);
  });

  document.querySelector(".portfolio-facts")?.remove();
  document.querySelector(".portfolio-empty")?.remove();
  sourceGrid.replaceWith(groups);
}

function getPortfolioCategory(card) {
  const text = card.textContent || "";
  if (text.includes("Подписные") || text.includes("Коммерческий")) return "commercial";
  if (text.includes("дом")) return "house";
  return "apartment";
}

function initPortfolioFilters() {
  const filters = document.querySelectorAll("[data-portfolio-filter]");
  const objectSections = document.querySelectorAll(".portfolio-object");
  const setActiveFilter = (activeFilter) => {
    filters.forEach((item) => {
      const isActive = item === activeFilter;
      item.classList.toggle("is-active", isActive);
      item.setAttribute("aria-pressed", String(isActive));
    });
  };

  if (filters.length && objectSections.length) {
    filters.forEach((filter) => {
      filter.setAttribute("aria-pressed", String(filter.classList.contains("is-active")));
      filter.addEventListener("click", () => {
        const value = filter.dataset.portfolioFilter || "all";
        setActiveFilter(filter);
        objectSections.forEach((section) => {
          section.hidden = value !== "all" && section.dataset.category !== value;
        });
      });
    });
    return;
  }

  const cards = document.querySelectorAll(".full-portfolio-grid .project-card");
  if (!filters.length || !cards.length) return;
  const empty = document.querySelector(".portfolio-empty");

  cards.forEach((card) => {
    card.dataset.category = card.dataset.category || getPortfolioCategory(card);
  });

  filters.forEach((filter) => {
    filter.setAttribute("aria-pressed", String(filter.classList.contains("is-active")));
    filter.addEventListener("click", () => {
      const value = filter.dataset.portfolioFilter || "all";
      let visibleCount = 0;
      setActiveFilter(filter);
      cards.forEach((card) => {
        const isVisible = value === "all" || card.dataset.category === value;
        card.hidden = !isVisible;
        if (isVisible) visibleCount += 1;
      });
      if (empty) empty.hidden = visibleCount !== 0;
    });
  });
}

lightboxClose?.addEventListener("click", closeLightbox);
lightboxPrev?.addEventListener("click", () => showLightboxImage(-1));
lightboxNext?.addEventListener("click", () => showLightboxImage(1));

lightbox?.addEventListener("click", (event) => {
  if (event.target === lightbox) closeLightbox();
});

document.querySelectorAll("[data-estimate-open]").forEach((button) => {
  button.addEventListener("click", openEstimateModal);
});

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[href]");
  if (!link) return;
  const href = link.getAttribute("href") || "";
  if (href.startsWith("tel:")) trackGoal("phone_click");
  if (href.startsWith("mailto:")) trackGoal("email_click");
  if (href.includes("t.me/")) trackGoal("telegram_click");
  if (href.includes("wa.me/") || href.includes("api.whatsapp.com/")) trackGoal("whatsapp_click");
});

document.addEventListener("click", (event) => {
  const socialButton = event.target.closest("[data-social-url]");
  if (!socialButton) return;
  const url = socialButton.dataset.socialUrl;
  if (!url) return;
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (opened) opened.opener = null;
});

document.querySelectorAll("[data-estimate-close]").forEach((button) => {
  button.addEventListener("click", closeEstimateModal);
});

navToggle?.addEventListener("click", toggleNavMenu);

mainNav?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", closeNavMenu);
});

document.addEventListener("click", (event) => {
  if (!siteHeader?.classList.contains("nav-open")) return;
  if (siteHeader.contains(event.target)) return;
  closeNavMenu();
});

document.querySelectorAll("[data-lead-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitLeadForm(form);
  });
});

document.addEventListener("keydown", (event) => {
  if (lightbox && !lightbox.hidden) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      showLightboxImage(-1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      showLightboxImage(1);
    }
  }
  if (event.key === "Escape") {
    closeNavMenu();
    closeLightbox();
    closeEstimateModal();
  }
});

window.addEventListener("scroll", scheduleHeaderState, { passive: true });
window.addEventListener("resize", () => {
  if (window.innerWidth > 1120) closeNavMenu();
}, { passive: true });
updateHeaderState();
initReveal();
initCustomCursor();
initPortfolioObjectGroups();
initPortfolioFilters();
warmInitialLightboxImages();
