import { ctx, bus, save } from '../core';
import { AGENT_BY_ID, AGENTS, ALL_INVITES, INVITE_OWNER } from '../data/agents';
import { fmtTime, fmtMoney, upcoming, nextEventMinute, advance, respondInvite, agentHere } from '../engine/engine';
import { BUCKET, DAY_END } from '../engine/state';
import { MAPS } from '../maps/index';
import { llmStatus } from '../agents/gateway';
import { el, esc, root, setModal } from './dom';
import { handleEvents } from './actions';

type Tab = 'today' | 'texts' | 'feed' | 'bank' | 'bucket' | 'notes' | 'system';
let tab: Tab = 'today';
let open = false;

export function togglePhone() { if (open) closePhone(); else openPhone(); }

export function openPhone(t?: Tab) {
  if (!ctx.state) return;
  if (t) tab = t;
  open = true;
  setModal('phone', true);
  render();
}

export function closePhone() {
  if (!open) return;
  open = false;
  document.getElementById('phone')?.remove();
  setModal('phone', false);
}

export function unreadCount() {
  return ctx.state ? ctx.state.texts.filter((t) => !t.read && (t.day < ctx.state!.day || (t.day === ctx.state!.day && t.minute <= ctx.state!.minute))).length : 0;
}

function visibleTexts() {
  const s = ctx.state!;
  return s.texts.filter((t) => t.day < s.day || (t.day === s.day && t.minute <= s.minute));
}

function skip(minutes: number) {
  const s = ctx.state!;
  const n = Math.min(minutes, DAY_END - s.minute);
  if (n <= 0) return;
  handleEvents(advance(s, n));
  save();
  bus.emit('state');
  if (open) render();
}

function inviteButtons(id: string): string {
  const st = ctx.state!.invites[id].status;
  return st === 'pending' ? `<span class="inv-actions" data-inv="${id}"><button class="yes">Accept</button><button class="no">Decline</button></span>` : `<span class="status ${st}">${st}</span>`;
}

function body(): string {
  const s = ctx.state!;
  switch (tab) {
    case 'today': {
      const items = upcoming(s);
      const ups = items.length ? items.map((u) => {
        const inv = ALL_INVITES.find((i) => i.label === u.label);
        return `<li><b>${fmtTime(u.minute)}</b> ${esc(u.label)}<br><span class="muted">${esc(u.where)}</span> ${inv ? inviteButtons(inv.id) : u.status ? `<span class="status ${u.status}">${u.status}</span>` : ''}</li>`;
      }).join('') : '<li class="muted">Nothing scheduled.</li>';
      const people = AGENTS.filter((a) => s.agents[a.id].met).map((a) => {
        const here = agentHere(s, a.id);
        const where = here ? `${esc(here.activity)} <span class="muted">(${esc(MAPS[s.mapId].name)})</span>` : '<span class="muted">not around you</span>';
        return `<li><b>${esc(a.name)}</b> <span class="muted">${s.agents[a.id].rel}/100</span><br>${where}</li>`;
      }).join('') || '<li class="muted">You have not met anyone yet. Talley is a good place to start.</li>';
      return `<h3>Schedule · Day ${s.day}</h3><ul>${ups}</ul><h3>People you know</h3><ul>${people}</ul>`;
    }
    case 'texts': {
      const texts = visibleTexts();
      texts.forEach((t) => (t.read = true));
      const list = texts.slice().reverse().map((t) => {
        const inv = ALL_INVITES.find((i) => i.textBody === t.body && INVITE_OWNER[i.id] === t.from);
        return `<li class="text"><b>${esc(AGENT_BY_ID[t.from].name)}</b> <span class="muted">day ${t.day}, ${fmtTime(t.minute)}</span><br>${esc(t.body)}${inv ? `<br>${inviteButtons(inv.id)}` : ''}</li>`;
      }).join('');
      return `<h3>Texts</h3><ul>${list || '<li class="muted">No texts yet.</li>'}</ul>`;
    }
    case 'feed': {
      const list = s.feed.slice(-30).reverse().map((f) => `<li><span class="muted">day ${f.day}, ${fmtTime(f.minute)}</span><br>${esc(f.text)}</li>`).join('');
      return `<h3>Feed</h3><p class="muted">What people posted while you were busy.</p><ul>${list || '<li class="muted">Quiet so far.</li>'}</ul>`;
    }
    case 'bank': {
      const list = s.txns.slice(-20).reverse().map((t) => `<li><span class="amt">${fmtMoney(t.amount)}</span> ${esc(t.label)} <span class="muted">day ${t.day}, ${fmtTime(t.minute)}</span></li>`).join('');
      return `<h3>Bank</h3><p class="big">${fmtMoney(s.money)}</p><p>${s.swipes} meal swipes left</p><ul>${list || '<li class="muted">No spending yet.</li>'}</ul>`;
    }
    case 'bucket':
      return `<h3>Bucket list</h3><ul class="bucket">${BUCKET.map((b) => `<li class="${s.bucket[b.id] ? 'done' : ''}">${s.bucket[b.id] ? '☑' : '☐'} ${esc(b.text)}</li>`).join('')}</ul>`;
    case 'notes':
      return `<h3>Notes</h3><ul>${s.notes.map((n) => `<li>${esc(n)}</li>`).join('') || '<li class="muted">Things people tell you end up here.</li>'}</ul>`;
    case 'system': {
      const st = llmStatus();
      const u = s.usage;
      const tok = (t: typeof u.small) => `${t.calls} calls · ${t.promptTokens.toLocaleString()} in / ${t.completionTokens.toLocaleString()} out`;
      return `<h3>Model</h3><p>${st.configured ? `Provider: <b>${esc(st.provider!)}</b><br>small: ${esc(st.models!.small)}<br>large: ${esc(st.models!.large)}` : 'Scripted mode. Add a key to <code>.env.local</code> and restart <code>npm run dev</code> to use a model.'}</p>
        <h3>Usage this episode</h3><ul><li>Dialogue (small): ${tok(u.small)}</li><li>Reflection and director (large): ${tok(u.large)}</li><li>Fallbacks to scripts: ${u.fallbacks}</li>
        <li>Total tokens: <b>${(u.small.promptTokens + u.small.completionTokens + u.large.promptTokens + u.large.completionTokens).toLocaleString()}</b></li></ul>
        <h3>Controls</h3><p class="muted">WASD or arrows to walk · click to walk there · E to talk or use · P phone · M map overview · mouse wheel to zoom · Esc to close</p>`;
    }
  }
}

function render() {
  if (!open) return;
  const s = ctx.state!;
  document.getElementById('phone')?.remove();
  const unread = unreadCount();
  const tabs: [Tab, string][] = [['today', 'Today'], ['texts', `Texts${unread ? ` (${unread})` : ''}`], ['feed', 'Feed'], ['bank', 'Bank'], ['bucket', 'Bucket'], ['notes', 'Notes'], ['system', 'System']];
  const next = nextEventMinute(s);
  const panel = el(`<div id="phone" class="phone">
    <div class="ph-top"><b>${fmtTime(s.minute)}</b><span>Day ${s.day}</span><button class="x" aria-label="Close phone">×</button></div>
    <nav>${tabs.map(([id, label]) => `<button data-tab="${id}" class="${tab === id ? 'on' : ''}">${label}</button>`).join('')}</nav>
    <div class="ph-body">${body()}</div>
    <div class="ph-skip"><span class="muted">Scroll to pass time</span>
      <button data-skip="15">+15 min</button><button data-skip="60">+1 hr</button>
      <button data-skip="next" ${next === null ? 'disabled' : ''}>${next === null ? 'No events' : `To ${fmtTime(next)}`}</button></div>
  </div>`);
  panel.querySelectorAll<HTMLButtonElement>('nav button').forEach((b) => (b.onclick = () => { tab = b.dataset.tab as Tab; render(); bus.emit('state'); }));
  panel.querySelectorAll<HTMLButtonElement>('[data-skip]').forEach((b) => (b.onclick = () => {
    const v = b.dataset.skip!;
    if (v === 'next') { const n = nextEventMinute(s); if (n !== null) skip(n - s.minute); } else skip(Number(v));
  }));
  panel.querySelectorAll<HTMLElement>('[data-inv]').forEach((box) => {
    const id = box.dataset.inv!;
    box.querySelector<HTMLButtonElement>('.yes')!.onclick = () => { respondInvite(s, id, true); save(); render(); bus.emit('state'); };
    box.querySelector<HTMLButtonElement>('.no')!.onclick = () => { respondInvite(s, id, false); save(); render(); bus.emit('state'); };
  });
  panel.querySelector<HTMLButtonElement>('.x')!.onclick = closePhone;
  root().appendChild(panel);
}

bus.on('phone', () => { if (!ctx.modal || open) togglePhone(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) closePhone(); });
