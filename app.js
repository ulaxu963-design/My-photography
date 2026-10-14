import { GalleryMotion } from './gallery-motion.js';

const app = document.querySelector('#app');
const announcer = document.querySelector('#announcer');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let data, ui;
let dispose = () => {};
document.querySelector('.skip-link').addEventListener('click', event => {
  event.preventDefault();
  const main = document.querySelector('#main');
  main?.focus({ preventScroll: true });
  main?.scrollIntoView({ behavior: 'instant', block: 'start' });
});
const pad = n => String(n).padStart(2, '0');
// Keep supplied text intact. Empty and unfilled template fields produce no node.
const suppliedText = value => typeof value === 'string' && value.trim() && !value.includes('【填写】') ? value : '';
const label = (key, values = {}) => ui[key].replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== null && value !== false) node.setAttribute(key, value === true ? '' : value);
  }
  children.flat().forEach(child => { if (child !== null && child !== undefined) node.append(child instanceof Node ? child : document.createTextNode(String(child))); });
  return node;
}
function seriesHref(series, index = 1) { return `#/series/${encodeURIComponent(series.id)}/${index}`; }
function optionalText(tag, value, attrs = {}) { const text = suppliedText(value); return text ? el(tag, attrs, text) : null; }
function identity() {
  return el('a', { href: '#/', class: 'identity', 'aria-label': label('identityLabel', { name: suppliedText(data.profile.name) }) },
    optionalText('span', data.profile.name, { class: 'identity-name' }),
    optionalText('span', data.profile.discipline, { class: 'identity-discipline' }));
}
function projectLink(series, index, current) {
  return el('a', { href: seriesHref(series), class: `nav-link${current === series.id ? ' active' : ''}`, 'aria-current': current === series.id ? 'page' : null },
    el('span', { class: 'nav-no', 'aria-hidden': true }, pad(index + 1)), suppliedText(series.title));
}
const informationPages = [['about', 'about'], ['news', 'news'], ['contact', 'contact']];
function pageLink(id, key, current) {
  return el('a', { href: `#/${id}`, class: `nav-link${current === id ? ' active' : ''}`, 'aria-current': current === id ? 'page' : null }, ui[key]);
}
function menuButton(header, id) {
  const button = el('button', { class: 'menu-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': id, onclick: e => {
    const open = header.classList.toggle('is-open');
    e.currentTarget.setAttribute('aria-expanded', String(open));
    e.currentTarget.textContent = open ? ui.menuClose : ui.menuOpen;
  } }, ui.menuOpen);
  const close = () => { header.classList.remove('is-open'); button.setAttribute('aria-expanded', 'false'); button.textContent = ui.menuOpen; };
  header.addEventListener('click', event => { if (event.target.closest('a')) close(); });
  header.addEventListener('keydown', event => { if (event.key === 'Escape') { close(); button.focus(); } });
  return button;
}
function sidebar(current) {
  const aside = el('aside', { class: 'sidebar', 'aria-label': ui.navigation }, identity());
  aside.append(menuButton(aside, 'sidebar-navigation'));
  aside.append(el('nav', { id: 'sidebar-navigation', class: 'sidebar-navigation' },
    el('p', { class: 'eyebrow' }, ui.works),
    el('div', { class: 'project-nav' }, data.series.map((s, i) => projectLink(s, i, current))),
    el('div', { class: 'page-nav' }, informationPages.map(([id, label]) => pageLink(id, label, current)))));
  aside.append(el('div', { class: 'sidebar-foot' }, el('a', { href: '#/' }, ui.backHome)));
  return aside;
}
function imageNode(image, eager = false) {
  return el('img', { src: image.src, alt: image.alt, width: image.width, height: image.height, decoding: 'async', loading: eager ? 'eager' : 'lazy', draggable: 'false' });
}
function renderHome() {
  document.title = `${data.profile.name} — Photography`;
  const shell = el('div', { class: 'home-shell' });
  shell.classList.toggle('has-intro', !!suppliedText(data.profile.homeIntro));
  const header = el('header', { class: 'home-header' }, el('div', { class: 'home-brand' }, identity(), optionalText('p', data.profile.homeIntro, { class: 'home-intro' })));
  const navigation = el('nav', { id: 'home-navigation', class: 'home-navigation', 'aria-label': ui.navigation },
    el('div', { class: 'home-mobile-projects' }, data.series.map((s, i) => projectLink(s, i))),
    el('a', { href: seriesHref(data.series[0]), class: 'nav-link' }, ui.works),
    informationPages.map(([id, label]) => pageLink(id, label)));
  header.append(menuButton(header, 'home-navigation'), navigation);
  const stage = el('div', { class: 'arc-stage', 'aria-label': ui.homeGallery });
  const main = el('main', { id: 'main', class: 'home-main', tabindex: '-1' }, el('h1', { class: 'sr-only' }, ui.portfolio), stage);
  shell.append(header, main); app.append(shell);
  // Interleave the series so the opening view introduces every body of work.
  const entries = Array.from({ length: Math.max(...data.series.map(s => s.images.length)) }, (_, i) =>
    data.series.filter(s => s.images[i]).map(s => ({ series: s, image: s.images[i], index: i }))).flat();
  // Each photograph is an actual anchor, never a frame painted into a canvas/video.
  const cards = entries.map(entry => {
    const photo = imageNode(entry.image, true);
    photo.className = 'arc-photo';
    const mirror = imageNode({ ...entry.image, alt: '' }, true);
    const reflection = el('div', { class: 'arc-reflection', 'aria-hidden': 'true' }, mirror);
    const card = el('a', { class: 'arc-card', href: seriesHref(entry.series, entry.index + 1), 'aria-label': label('photoLink', { series: suppliedText(entry.series.title), current: entry.index + 1, total: entry.series.images.length }), tabindex: '-1' }, photo, reflection);
    stage.append(card); return card;
  });
  const events = new AbortController();
  const listen = (node, type, handler, options = {}) => node.addEventListener(type, handler, { ...options, signal: events.signal });
  let phase = 0, last = 0, frame = 0, focused = false, keyboardNavigation = false, dragging = false, moved = false;
  let mousePosition = null, mouseSample = null, mouseInside = false, hoverPosition = null;
  let pointerId = null, startX = 0, startY = 0, previousX = 0, previousTime = 0, gestureVelocity = 0, dragDirection = -1, suppressClickUntil = 0, pendingStep = 0;
  let pressHref = null, pendingClick = null;
  let width = stage.clientWidth, spacing = 190, cardHeight = 270;
  function resize() {
    width = stage.clientWidth;
    spacing = width < 761 ? 136 : Math.min(204, Math.max(165, width / 7.5));
    const floorSpace = Number.parseFloat(getComputedStyle(shell).getPropertyValue('--floor-space')) || 0;
    const photographAreaHeight = stage.clientHeight - floorSpace;
    cardHeight = width < 761 ? Math.min(210, photographAreaHeight * .65) : Math.min(330, photographAreaHeight * .62);
  }
  resize();
  phase = -spacing * 1.5;
  const motion = new GalleryMotion(data.settings);
  let peakSpeed = 0;
  shell.style.setProperty('--reflection-opacity', String(Math.min(1, Math.max(0, Number(data.settings?.reflectionOpacity ?? .15)))));
  const observer = new ResizeObserver(resize); observer.observe(stage);
  function galleryPosition(position) {
    if (!position) return null;
    const rect = stage.getBoundingClientRect();
    if (position.x < rect.left || position.x > rect.right || position.y < rect.top || position.y > rect.bottom) return null;
    // The whole gallery, including gaps, is one control surface. Header and
    // navigation overlays are excluded by the browser's actual hit test.
    const hit = document.elementFromPoint(position.x, position.y);
    return hit && stage.contains(hit) ? Math.max(0, Math.min(1, (position.x - rect.left) / rect.width)) : null;
  }
  function leaveGallery(now = performance.now() / 1000) {
    mouseInside = false; mouseSample = null; hoverPosition = null;
    motion.leave(now);
  }
  function updateMouse(e) {
    if (e.pointerType !== 'mouse') return;
    keyboardNavigation = false;
    mousePosition = { x: e.clientX, y: e.clientY };
    if (dragging || pointerId !== null || e.buttons !== 0) return;
    const now = performance.now() / 1000;
    const position = galleryPosition(mousePosition);
    if (position === null) { if (mouseInside) leaveGallery(); return; }
    motion.hover(position, now, width);
    hoverPosition = position;
    const previous = mouseInside ? mouseSample : null;
    mouseInside = true;
    mouseSample = { x: e.clientX, time: now };
    if (previous) motion.pointer(e.clientX - previous.x, Math.min(.04, now - previous.time), now, width);
    // Hovering never changes phase or captures a pointer. Position is integrated
    // only by the animation loop; direct deltas belong solely to an active drag.
  }
  function step(direction) { pendingStep += direction * spacing; motion.releaseDrag(0, direction, performance.now() / 1000, width); }
  listen(stage, 'pointerenter', updateMouse);
  listen(stage, 'pointerleave', e => { if (e.pointerType === 'mouse' && !dragging) { mousePosition = null; leaveGallery(); } });
  function cancelInteraction() {
    const capturedId = pointerId, wasDragging = dragging, now = performance.now() / 1000;
    pointerId = null; dragging = moved = false; pressHref = null; pendingClick = null;
    stage.classList.remove('is-dragging'); keyboardNavigation = false;
    if (wasDragging) { suppressClickUntil = performance.now() + 350; motion.releaseDrag(0, dragDirection, now, width); }
    if (capturedId !== null && stage.hasPointerCapture(capturedId)) stage.releasePointerCapture(capturedId);
    mousePosition = null; leaveGallery(now);
  }
  listen(window, 'blur', cancelInteraction);
  listen(stage, 'lostpointercapture', e => { if (e.pointerId === pointerId) cancelInteraction(); });
  listen(stage, 'focusin', e => { focused = keyboardNavigation && e.target.matches(':focus-visible'); });
  listen(stage, 'focusout', () => { focused = false; });
  listen(stage, 'pointerdown', e => {
    keyboardNavigation = false;
    pendingClick = null;
    if (!e.isPrimary || e.button !== 0) return;
    // A press is only a candidate. Ordinary clicks keep the animation running.
    pointerId = e.pointerId; dragging = false; moved = false; gestureVelocity = 0;
    pressHref = e.target.closest('.arc-card')?.getAttribute('href') || null;
    startX = previousX = e.clientX; startY = e.clientY; previousTime = performance.now();
  });
  listen(window, 'pointermove', e => {
    updateMouse(e);
    if (pointerId === null || e.pointerId !== pointerId) return;
    if (!(e.buttons & 1)) { cancelInteraction(); updateMouse(e); return; }
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!moved && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) { pointerId = null; pressHref = null; mouseSample = null; return; }
    if (!moved && Math.abs(dx) > 7 && Math.abs(dx) >= Math.abs(dy)) {
      dragging = moved = true; pendingStep = 0; mouseSample = null; motion.leave(performance.now() / 1000);
      stage.classList.add('is-dragging'); stage.setPointerCapture(e.pointerId);
    }
    if (moved) {
      e.preventDefault();
      const now = performance.now(), delta = e.clientX - previousX;
      phase += delta; gestureVelocity = delta / Math.max(8, now - previousTime) * 1000;
      if (delta) dragDirection = Math.sign(delta);
      previousX = e.clientX; previousTime = now;
    }
  }, { passive: false });
  function release(e) {
    if (e.pointerId !== pointerId) return;
    dragging = false; pointerId = null; stage.classList.remove('is-dragging');
    if (moved) {
      suppressClickUntil = performance.now() + 350;
      const recent = performance.now() - previousTime <= 100 && e.type !== 'pointercancel';
      motion.releaseDrag(recent ? gestureVelocity : 0, dragDirection, performance.now() / 1000, width);
    } else if (e.type === 'pointerup' && pressHref) {
      // Retain the photograph selected on press even if it rolls away before
      // release. This records a destination without freezing or moving a card.
      pendingClick = { href: pressHref, expires: performance.now() + 400 };
    }
    pressHref = null;
    if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
    mouseSample = null;
    if (e.pointerType === 'mouse') updateMouse(e);
  }
  listen(window, 'pointerup', release); listen(window, 'pointercancel', release);
  listen(stage, 'click', e => {
    if (performance.now() < suppressClickUntil) { pendingClick = null; e.preventDefault(); e.stopPropagation(); return; }
    const selected = pendingClick; pendingClick = null;
    if (selected && performance.now() < selected.expires && e.detail > 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      e.preventDefault(); location.hash = selected.href;
    }
  }, { capture: true });
  listen(stage, 'dragstart', e => e.preventDefault());
  listen(window, 'keydown', e => {
    if (e.key === 'Tab') keyboardNavigation = true;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); step(e.key === 'ArrowLeft' ? -1 : 1); }
  });
  function animate(time) {
    const dt = last ? Math.min((time - last) / 1000, .05) : 0; last = time;
    focused = keyboardNavigation && stage.contains(document.activeElement) && document.activeElement.matches(':focus-visible');
    if (mouseInside && pointerId === null && !dragging) {
      const position = galleryPosition(mousePosition);
      if (position === null) leaveGallery(time / 1000);
      else if (position !== hoverPosition) { hoverPosition = position; motion.hover(position, time / 1000, width); }
    }
    const stopped = focused || reducedMotion.matches || document.hidden;
    const movement = motion.advance(time / 1000, width, stopped);
    if (!dragging) {
      if (Math.abs(pendingStep) > .1) {
        const delta = reducedMotion.matches ? pendingStep : pendingStep * Math.min(1, dt * 10);
        phase += delta; pendingStep -= delta;
      }
      phase += movement.displacement;
    }
    const cycle = entries.length * spacing;
    phase = ((phase % cycle) + cycle) % cycle;
    peakSpeed = Math.max(peakSpeed, Math.abs(movement.speed));
    stage.dataset.speed = movement.speed.toFixed(3);
    stage.dataset.targetSpeed = movement.target.toFixed(3);
    stage.dataset.inputVelocity = movement.inputVelocity.toFixed(3);
    stage.dataset.lastInputTime = String(motion.lastInputTime);
    stage.dataset.direction = String(movement.direction);
    stage.dataset.motionMode = movement.mode;
    stage.dataset.maxSpeed = movement.maxSpeed.toFixed(3);
    stage.dataset.edgeMaxSpeed = motion.edgeMaxSpeed.toFixed(3);
    stage.dataset.peakSpeed = peakSpeed.toFixed(3);
    stage.dataset.offset = phase.toFixed(3);
    stage.dataset.dragging = String(dragging);
    stage.dataset.pressed = String(pointerId !== null);
    stage.dataset.pressedHref = pressHref || '';
    stage.dataset.captured = String(pointerId !== null && stage.hasPointerCapture(pointerId));
    stage.dataset.pointerRegion = mouseInside ? 'gallery' : 'outside';
    stage.dataset.hoverPosition = hoverPosition === null ? '' : hoverPosition.toFixed(4);
    stage.dataset.pointerX = String(mousePosition?.x ?? '');
    stage.dataset.pointerY = String(mousePosition?.y ?? '');
    cards.forEach((card, i) => {
      const x = ((i * spacing + phase + cycle / 2) % cycle + cycle) % cycle - cycle / 2;
      const u = x / Math.max(1, width / 2);
      const edge = Math.min(1.25, Math.abs(u));
      const scale = .66 + .54 * Math.pow(edge, 1.6);
      const y = 6 * edge * edge;
      const z = 145 * edge * edge;
      const ratio = entries[i].image.width / entries[i].image.height;
      const cardWidth = Math.min(cardHeight * ratio, spacing * 1.15);
      const realHeight = cardWidth / ratio;
      card.style.width = `${cardWidth}px`; card.style.height = `${realHeight}px`;
      card.style.transform = `translate(-50%, -50%) translate3d(${x}px,${y}px,${z}px) rotateY(${-39 * u}deg) scale(${scale})`;
      card.style.zIndex = String(Math.round(edge * 100));
      const visible = Math.abs(x) < width / 2 + cardWidth;
      card.classList.toggle('is-visible', visible);
      card.tabIndex = visible ? 0 : -1;
      card.setAttribute('aria-hidden', String(!visible));
    });
    frame = requestAnimationFrame(animate);
  }
  frame = requestAnimationFrame(animate);
  dispose = () => { cancelAnimationFrame(frame); events.abort(); observer.disconnect(); };
}
function renderSeries(series, index) {
  const current = Math.min(Math.max(index, 1), series.images.length) - 1;
  document.title = `${suppliedText(series.title) || ui.portfolio} — ${suppliedText(data.profile.name)}`;
  const image = series.images[current];
  const photo = imageNode(image, true);
  const stage = el('div', { class: 'photo-stage', 'aria-label': ui.photo }, photo);
  photo.addEventListener('error', () => {
    photo.hidden = true;
    stage.append(el('div', { class: 'image-failure', role: 'status' }, el('span', {}, ui.imageUnavailable), el('span', { class: 'muted' }, ui.imageHelp)));
  }, { once: true });
  const previous = () => { location.hash = seriesHref(series, (current - 1 + series.images.length) % series.images.length + 1); };
  const next = () => { location.hash = seriesHref(series, (current + 1) % series.images.length + 1); };
  const metadata = [optionalText('span', series.year), optionalText('span', series.location)].filter(Boolean);
  const photographCaption = [optionalText('h2', image.title, { class: 'photograph-title' }), optionalText('p', image.description, { class: 'photograph-description' })].filter(Boolean);
  const caption = el('figcaption', { class: 'caption' }, el('div', { class: 'caption-copy' },
    optionalText('h1', series.title, { class: 'caption-title' }),
    optionalText('p', series.englishTitle, { class: 'caption-english' }),
    metadata.length ? el('p', { class: 'caption-meta' }, metadata.flatMap((node, i) => i ? [' ', node] : [node])) : null,
    optionalText('p', series.shortDescription, { class: 'caption-intro' }),
    photographCaption.length ? el('div', { class: 'photograph-caption' }, photographCaption) : null),
    el('div', { class: 'gallery-controls' }, el('span', { class: 'counter', 'aria-label': label('photoCounter', { current: current + 1, total: series.images.length }) }, `${pad(current + 1)} / ${pad(series.images.length)}`),
      el('div', { class: 'arrow-group' },
        el('button', { class: 'arrow-button', type: 'button', 'aria-label': ui.previousPhoto, onclick: previous }, '←'),
        el('button', { class: 'arrow-button', type: 'button', 'aria-label': ui.nextPhoto, onclick: next }, '→'))));
  const gallery = el('figure', { class: 'gallery' }, stage, caption,
    suppliedText(series.description) ? el('details', { class: 'gallery-description' }, el('summary', {}, ui.projectDescription), el('p', {}, series.description)) : null);
  const nextSeries = data.series[(data.series.indexOf(series) + 1) % data.series.length];
  const main = el('main', { class: 'detail-main', id: 'main', tabindex: '-1' }, gallery,
    el('div', { class: 'viewer-tail' }, el('a', { href: '#/' }, ui.allWorks), el('a', { href: seriesHref(nextSeries) }, `${suppliedText(nextSeries.title)} →`)));
  app.append(sidebar(series.id), main);
  announcer.textContent = label('photoAnnouncement', { series: suppliedText(series.title), current: current + 1, total: series.images.length });
  const events = new AbortController();
  window.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); previous(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
  }, { signal: events.signal });
  let start = null;
  stage.addEventListener('pointerdown', e => { if (e.isPrimary && e.button === 0) start = { x: e.clientX, y: e.clientY, id: e.pointerId }; }, { signal: events.signal });
  window.addEventListener('pointerup', e => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    start = null;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) dx > 0 ? previous() : next();
  }, { signal: events.signal });
  stage.addEventListener('pointercancel', () => { start = null; }, { signal: events.signal });
  dispose = () => events.abort();
}
function textBlock(heading, content, className = '') {
  if (content == null || (typeof content === 'string' && !suppliedText(content))) return null;
  return el('section', { class: 'text-page-block' }, el('h2', { class: 'eyebrow' }, heading), el('p', { class: className }, content));
}
function renderInformation(id) {
  const title = ui[informationPages.find(p => p[0] === id)[1]];
  document.title = `${title} — ${data.profile.name}`;
  const content = el('article', { class: 'text-page' }, el('h1', {}, title));
  if (id === 'about') content.append(...[textBlock(ui.biography, data.profile.bio), textBlock(ui.basedIn, data.profile.location)].filter(Boolean));
  if (id === 'news') content.append(...(data.exhibitions || []).filter(item => [item.year, item.title, item.location].some(suppliedText)).map(item => el('section', { class: `exhibition-row${suppliedText(item.year) ? '' : ' no-year'}` },
    optionalText('div', item.year, { class: 'exhibition-year' }), el('div', {}, optionalText('h2', item.title, { class: 'exhibition-name' }), optionalText('p', item.location, { class: 'exhibition-place' })))));
  if (id === 'contact') {
    const email = suppliedText(data.profile.email);
    const account = suppliedText(data.profile.instagram);
    const instagram = /^https:\/\//.test(account) ? el('a', { href: account, target: '_blank', rel: 'noopener noreferrer' }, account) : account;
    content.append(...[textBlock(ui.enquiries, data.profile.contactIntro),
      textBlock(ui.email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? el('a', { href: `mailto:${email.trim()}` }, email) : email, 'contact-value'),
      textBlock(ui.instagram, instagram, 'contact-value')].filter(Boolean));
  }
  app.append(sidebar(id), el('main', { class: 'detail-main', id: 'main', tabindex: '-1' }, content));
  announcer.textContent = title;
}
function renderMissing() {
  document.title = `${ui.notFoundTitle} — ${ui.portfolio}`;
  app.append(el('main', { id: 'main', class: 'error-page' }, el('h1', {}, ui.notFoundTitle), el('p', {}, ui.notFoundMessage), el('a', { href: '#/' }, ui.home)));
}
function render() {
  dispose(); dispose = () => {}; app.replaceChildren();
  const route = location.hash.slice(1).split('/').filter(Boolean);
  if (!route.length) renderHome();
  else if (route[0] === 'series') {
    let id;
    try { id = decodeURIComponent(route[1] || ''); } catch { id = ''; }
    const series = data.series.find(s => s.id === id);
    series ? renderSeries(series, Number.parseInt(route[2], 10) || 1) : renderMissing();
  } else if (informationPages.some(p => p[0] === route[0])) renderInformation(route[0]);
  else renderMissing();
  window.scrollTo(0, 0);
}
try {
  const [response, interfaceResponse] = await Promise.all([
    fetch(new URL('data/portfolio.json', import.meta.url)),
    fetch(new URL('data/interface.json', import.meta.url))
  ]);
  if (!interfaceResponse.ok) throw new Error('Unable to load interface text.');
  ui = await interfaceResponse.json();
  if (!response.ok) throw new Error(ui.dataError);
  data = await response.json();
  if (!data.profile || !data.series?.length || data.series.some(s => !s.images?.length)) throw new Error(ui.dataInvalid);
  document.querySelector('.skip-link').textContent = ui.skipToContent;
  document.querySelector('meta[name="description"]').content = label('metaDescription', { name: suppliedText(data.profile.name), intro: suppliedText(data.profile.homeIntro) });
  render(); window.addEventListener('hashchange', render);
} catch (error) {
  app.append(el('main', { class: 'error-page' }, el('h1', {}, ui?.unavailableTitle || 'Portfolio unavailable'), el('p', {}, error.message), el('p', {}, ui?.previewHelp || 'Please use an HTTP server and check the portfolio data files.')));
}
