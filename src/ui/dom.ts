import { ctx } from '../core';

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export const root = () => document.getElementById('ui')!;

export function el<T extends HTMLElement = HTMLElement>(html: string): T {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}

const openModals = new Set<string>();
export function setModal(name: string, on: boolean) {
  if (on) openModals.add(name); else openModals.delete(name);
  ctx.modal = openModals.size;
  if (!on && document.activeElement instanceof HTMLElement && !openModals.size) document.activeElement.blur();
}
export const isOpen = (name: string) => openModals.has(name);

export function toast(text: string, kind: 'info' | 'ok' | 'warn' | 'text' | 'bucket' = 'info') {
  let stack = document.getElementById('toasts');
  if (!stack) { stack = el('<div id="toasts"></div>'); root().appendChild(stack); }
  const t = el(`<div class="toast ${kind}">${esc(text)}</div>`);
  stack.appendChild(t);
  setTimeout(() => t.classList.add('out'), kind === 'text' ? 6000 : 4000);
  setTimeout(() => t.remove(), kind === 'text' ? 6500 : 4500);
  while (stack.children.length > 5) stack.firstElementChild?.remove();
}

export interface MenuOption { label: string; detail?: string; disabled?: string | false; onClick: () => void }

/** A modal list of choices. Each choice closes the menu before running. */
export function menu(title: string, subtitle: string, options: MenuOption[]) {
  closeMenu();
  const panel = el(`<div class="modal-wrap" id="menu"><div class="panel menu">
    <div class="panel-head"><div><h2>${esc(title)}</h2>${subtitle ? `<p class="sub">${esc(subtitle)}</p>` : ''}</div>
    <button class="x" aria-label="Close">×</button></div>
    <div class="options"></div></div></div>`);
  const list = panel.querySelector('.options')!;
  options.forEach((o, i) => {
    const b = el<HTMLButtonElement>(`<button class="opt" ${o.disabled ? 'disabled' : ''}>
      <span class="k">${i + 1}</span><span class="l">${esc(o.label)}</span>
      <span class="d">${esc(o.disabled || o.detail || '')}</span></button>`);
    b.onclick = () => { closeMenu(); o.onClick(); };
    list.appendChild(b);
  });
  if (!options.length) list.appendChild(el('<p class="empty">Nothing to do here right now.</p>'));
  panel.querySelector<HTMLButtonElement>('.x')!.onclick = closeMenu;
  panel.addEventListener('mousedown', (e) => { if (e.target === panel) closeMenu(); });
  root().appendChild(panel);
  setModal('menu', true);
  menuKeys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { closeMenu(); return; }
    const n = Number(e.key);
    if (n >= 1 && n <= options.length && !options[n - 1].disabled) { closeMenu(); options[n - 1].onClick(); }
  };
  window.addEventListener('keydown', menuKeys);
}

let menuKeys: ((e: KeyboardEvent) => void) | null = null;
export function closeMenu() {
  document.getElementById('menu')?.remove();
  if (menuKeys) { window.removeEventListener('keydown', menuKeys); menuKeys = null; }
  setModal('menu', false);
}
