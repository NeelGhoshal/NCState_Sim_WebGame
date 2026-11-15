import { ctx, bus, save } from '../core';
import { AGENT_BY_ID, ALL_INVITES, INVITE_OWNER } from '../data/agents';
import {
  talkCheck, startConversation, spendExchange, applyAgentTurn, respondInvite, fmtTime, EXCHANGE_MIN,
} from '../engine/engine';
import { dialogueTurn, type Line, type Source } from '../agents/runtime';
import { fallbackGreeting } from '../agents/fallback';
import { llmStatus } from '../agents/gateway';
import { el, esc, root, setModal, toast } from './dom';
import { handleEvents } from './actions';

interface Conv {
  id: string;
  lines: (Line | { who: 'system'; text: string })[];
  exchange: number;
  busy: boolean;
  replies: string[];
  over: boolean;
  lastSource: Source | null;
}

let conv: Conv | null = null;

export function openDialogue(id: string) {
  const s = ctx.state!;
  const reason = talkCheck(s, id);
  if (reason) { toast(reason, 'warn'); return; }
  startConversation(s, id);
  const def = AGENT_BY_ID[id];
  conv = { id, lines: [{ who: 'agent', text: fallbackGreeting(s, id) }], exchange: 0, busy: false, replies: def.replies.slice(), over: false, lastSource: null };
  setModal('dialogue', true);
  render();
  bus.emit('state');
}

export function closeDialogue() {
  if (!conv) return;
  conv = null;
  document.getElementById('dialogue')?.remove();
  setModal('dialogue', false);
  save();
  bus.emit('state');
}

function dialogueLines(): Line[] {
  return (conv?.lines ?? []).filter((l): l is Line => l.who !== 'system');
}

async function send(text: string) {
  const s = ctx.state!;
  if (!conv || conv.busy || conv.over) return;
  text = text.trim().slice(0, 300);
  if (!text) return;
  const c = conv;
  const def = AGENT_BY_ID[c.id];
  const reason = talkCheck(s, c.id);
  if (reason) {
    c.lines.push({ who: 'agent', text: def.leave[0] }, { who: 'system', text: reason });
    c.over = true; render(); return;
  }
  const history = dialogueLines();
  c.lines.push({ who: 'player', text });
  handleEvents(spendExchange(s, c.id));
  if (conv !== c) return; // the night started (2 AM) and closed the dialogue
  c.busy = true;
  render();

  const { turn, source, warnings } = await dialogueTurn(s, c.id, history, text, c.exchange);
  if (conv !== c) return;
  if (warnings.length) console.info('[agent] warnings', warnings);
  c.exchange++;
  c.lastSource = source;
  const applied = applyAgentTurn(s, c.id, turn);
  c.lines.push({ who: 'agent', text: turn.say });
  for (const n of applied.notes) c.lines.push({ who: 'system', text: n });
  c.replies = turn.replies.length ? turn.replies : def.replies.slice();
  c.busy = false;

  const left = talkCheck(s, c.id);
  if (applied.end) {
    c.over = true;
  } else if (left) {
    c.lines.push({ who: 'agent', text: s.agents[c.id].battery <= 0 ? def.tired[0] : def.leave[c.exchange % def.leave.length] });
    c.over = true;
  }
  save();
  bus.emit('state');
  render();
}

function pendingInvites(id: string) {
  const s = ctx.state!;
  return ALL_INVITES.filter((i) => INVITE_OWNER[i.id] === id && s.invites[i.id].status === 'pending');
}

function render() {
  const s = ctx.state!;
  if (!conv) return;
  const c = conv;
  const def = AGENT_BY_ID[c.id];
  const a = s.agents[c.id];
  document.getElementById('dialogue')?.remove();
  const mode = llmStatus().configured ? (c.lastSource === 'fallback' ? 'scripted fallback' : `AI · ${llmStatus().provider}`) : 'scripted';
  const battery = Array.from({ length: def.battery }, (_, i) => `<i class="${i < a.battery ? 'on' : ''}"></i>`).join('');
  const panel = el(`<div id="dialogue" class="panel dialogue">
    <div class="d-head">
      <div class="portrait" style="background:${def.colors.shirt}"><span style="background:${def.colors.skin}"></span></div>
      <div class="who"><b>${esc(def.name)}</b> <span class="muted">${esc(def.pronouns)} · ${esc(def.role)}</span>
        <div class="relrow"><span class="muted">Relationship</span><div class="bar rel"><div style="width:${a.rel}%"></div></div><span>${a.rel}</span>
        <span class="muted">Social battery</span><span class="battery">${battery}</span></div></div>
      <div class="d-meta"><span class="chip">${esc(mode)}</span><span class="muted">${fmtTime(s.minute)} · ${EXCHANGE_MIN} min per exchange</span>
        <button class="x" aria-label="Leave">×</button></div>
    </div>
    <div class="transcript"></div>
    <div class="invites"></div>
    <div class="replies"></div>
    <form class="say"><input maxlength="300" placeholder="${c.over ? 'The conversation is over.' : 'Say something…'}" ${c.over || c.busy ? 'disabled' : ''}/>
      <button ${c.over || c.busy ? 'disabled' : ''}>Say</button><button type="button" class="leave">Leave</button></form>
  </div>`);
  const tr = panel.querySelector('.transcript')!;
  for (const l of c.lines) {
    const who = l.who === 'player' ? s.setup.name : l.who === 'agent' ? def.name.split(' ')[0] : '';
    tr.appendChild(el(`<div class="line ${l.who}">${who ? `<b>${esc(who)}</b> ` : ''}${esc(l.text)}</div>`));
  }
  if (c.busy) tr.appendChild(el(`<div class="line agent typing"><b>${esc(def.name.split(' ')[0])}</b> <span>…</span></div>`));

  const inv = panel.querySelector('.invites')!;
  for (const i of pendingInvites(c.id)) {
    const card = el(`<div class="invite"><span>📅 <b>${esc(i.label)}</b> · ${fmtTime(i.from)} to ${fmtTime(i.to)}</span>
      <span><button class="yes">Accept</button><button class="no">Decline</button></span></div>`);
    card.querySelector<HTMLButtonElement>('.yes')!.onclick = () => { c.lines.push({ who: 'system', text: respondInvite(s, i.id, true) }); save(); render(); bus.emit('state'); };
    card.querySelector<HTMLButtonElement>('.no')!.onclick = () => { c.lines.push({ who: 'system', text: respondInvite(s, i.id, false) }); save(); render(); bus.emit('state'); };
    inv.appendChild(card);
  }

  const rep = panel.querySelector('.replies')!;
  if (!c.over) {
    c.replies.forEach((r) => {
      const b = el<HTMLButtonElement>(`<button class="reply" ${c.busy ? 'disabled' : ''}>${esc(r)}</button>`);
      b.onclick = () => void send(r);
      rep.appendChild(b);
    });
  }
  const form = panel.querySelector<HTMLFormElement>('form')!;
  const input = form.querySelector('input')!;
  form.onsubmit = (e) => { e.preventDefault(); void send(input.value); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDialogue(); e.stopPropagation(); });
  panel.querySelector<HTMLButtonElement>('.leave')!.onclick = closeDialogue;
  panel.querySelector<HTMLButtonElement>('.x')!.onclick = closeDialogue;
  root().appendChild(panel);
  tr.scrollTop = tr.scrollHeight;
  // Focus after the key that opened the dialogue has finished, so "E" is not typed into the box.
  if (!c.over && !c.busy) setTimeout(() => { if (conv === c) input.focus(); }, 120);
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && conv && !(document.activeElement instanceof HTMLInputElement)) closeDialogue();
});
