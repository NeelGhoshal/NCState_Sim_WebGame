import { ctx, bus } from '../core';
import { fmtTime, fmtMoney, upcoming } from '../engine/engine';
import { zoneAt } from '../engine/types';
import { MAPS } from '../maps/index';
import { llmStatus } from '../agents/gateway';
import { el, esc, root } from './dom';
import { unreadCount } from './phone';

let hud: HTMLElement;
let prompt: HTMLElement;
let routeChip: HTMLElement;

function bar(label: string, value: number, cls: string, invert = false) {
  const v = Math.round(value);
  const warn = invert ? v >= 70 : v <= 25;
  return `<div class="meter ${warn ? 'warn' : ''}"><span>${label}</span><div class="bar ${cls}"><div style="width:${v}%"></div></div><b>${v}</b></div>`;
}

export function mountHud() {
  hud = el('<div id="hud"></div>');
  prompt = el('<div id="prompt" hidden></div>');
  routeChip = el('<div id="route" hidden></div>');
  root().append(hud, prompt, routeChip);
  bus.on('route', (text: string | null) => {
    routeChip.hidden = !text;
    if (text) routeChip.innerHTML = esc(text).replace(/\[(\w)\]/g, '<kbd>$1</kbd>');
  });
  bus.on('state', render);
  bus.on('map', render);
  bus.on('prompt', (text: string | null) => {
    prompt.hidden = !text || !!ctx.modal;
    if (text) prompt.innerHTML = `<kbd>E</kbd> ${esc(text)}`;
  });
  render();
}

function render() {
  const s = ctx.state;
  if (!s) { hud.innerHTML = ''; prompt.hidden = true; return; }
  if (ctx.modal) prompt.hidden = true;
  const map = MAPS[s.mapId];
  const zone = zoneAt(map, s.x, s.y);
  const next = upcoming(s).find((u) => u.minute > s.minute && (!u.status || u.status === 'pending' || u.status === 'accepted'));
  const unread = unreadCount();
  hud.innerHTML = `
    <div class="hud-main panel">
      <div class="clock"><b>${fmtTime(s.minute)}</b><span>Day ${Math.min(s.day, 3)} of 3</span></div>
      <div class="where">${esc(zone)}${zone !== map.name ? ` <span class="muted">· ${esc(map.name)}</span>` : ''}</div>
      ${bar('Energy', s.energy, 'energy')}
      ${bar('Hunger', s.hunger, 'hunger', true)}
      ${bar('Stress', s.stress, 'stress', true)}
      <div class="money"><span>${fmtMoney(s.money)}</span><span>${s.swipes} swipes</span><span>Knowledge ${Math.round(s.knowledge)}</span></div>
      ${next ? `<div class="next">Next: <b>${fmtTime(next.minute)}</b> ${esc(next.label)}</div>` : ''}
    </div>
    <div class="hud-right">
      <span class="chip ${llmStatus().configured ? 'ok' : ''}">${llmStatus().configured ? `AI · ${esc(llmStatus().provider!)}` : 'Scripted'}</span>
      <button id="goto-btn" class="panel">🎯 Go to <kbd>O</kbd></button>
      <button id="phone-btn" class="panel">📱 Phone <kbd>P</kbd>${unread ? `<span class="badge">${unread}</span>` : ''}</button>
    </div>
    ${map.credit ? `<a class="map-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">${esc(map.credit)}</a>` : ''}`;
  hud.querySelector<HTMLButtonElement>('#phone-btn')!.onclick = () => bus.emit('phone');
  hud.querySelector<HTMLButtonElement>('#goto-btn')!.onclick = () => bus.emit('goto');
}
