// What happens when the player presses E on something, and the overnight flow.
import { ctx, bus, save } from '../core';
import { AGENTS } from '../data/agents';
import { VENUES } from '../data/venues';
import { BUS_STOPS, BUS_ORDER } from '../maps/campus';
import type { Interactable } from '../engine/types';
import {
  type Ev, type Result, buy, itemPrice, venueOpen, fmtTime, fmtMoney, study, rest, wait, classStatus, attendClass,
  paintTunnel, whisperEars, busRunning, BUS, hoursOfSleep, sleep, applyReflection, agentHere,
} from '../engine/engine';
import { PLAYER_CLASS } from '../engine/state';
import { reflect, directorRecap, directorEpilogue } from '../agents/runtime';
import { menu, toast, closeMenu } from './dom';
import { openDialogue, closeDialogue } from './dialogue';
import { closePhone } from './phone';
import { showNight, showMorning, showEnd } from './screens';

export type Target = { type: 'agent'; id: string } | { type: 'crowd'; line: string } | { type: 'obj'; it: Interactable };

let nightRunning = false;

export function handleEvents(evs: Ev[]) {
  if (!evs.length) return;
  let passout = false;
  for (const ev of evs) {
    if (ev.kind === 'passout') passout = true;
    else if (ev.kind === 'text') toast(ev.text, 'text');
    else if (ev.kind === 'bucket') toast(ev.text, 'bucket');
    else if (ev.kind === 'toast' || ev.kind === 'invite') toast(ev.text, 'info');
  }
  bus.emit('state');
  if (passout) void startNight(true);
}

export function after(r: Result) {
  toast(r.msg, r.ok ? 'ok' : 'warn');
  handleEvents(r.events);
  save();
  bus.emit('state');
}

export function interact(t: Target) {
  const s = ctx.state!;
  if (t.type === 'agent') return openDialogue(t.id);
  if (t.type === 'crowd') return toast(`"${t.line}"`);
  const it = t.it;
  switch (it.kind) {
    case 'venue': return venueMenu(it.ref!);
    case 'booth': return menu('Booth', `${fmtTime(s.minute)}. A good place to sit.`, [
      { label: 'Study here', detail: '60 min · knowledge', onClick: () => after(study(s, 'booth')) },
      { label: 'Rest', detail: '30 min · energy, stress', onClick: () => after(rest(s)) },
      { label: 'People-watch', detail: '15 min', onClick: () => after(wait(s, 15)) },
    ]);
    case 'study': return menu(it.label, 'Quiet floors, good light. Studying here is more effective.', [
      { label: 'Study in the library', detail: '60 min · knowledge ×1.3', onClick: () => after(study(s, 'library')) },
    ]);
    case 'class': {
      const st = classStatus(s);
      return menu(it.label, `${PLAYER_CLASS.name}, ${fmtTime(PLAYER_CLASS.from)} to ${fmtTime(PLAYER_CLASS.to)}. ${st.msg}`, [
        { label: s.day === PLAYER_CLASS.quizDay ? 'Go to class and take the quiz' : 'Go to class', detail: 'until the end of lecture', disabled: st.canAttend ? false : st.msg, onClick: () => after(attendClass(s)) },
      ]);
    }
    case 'bus': return busMenu(it.ref!);
    case 'sleep': return sleepMenu();
    case 'tunnel': return menu(it.label, 'Every inch is covered in paint, layered years deep.', [
      { label: 'Paint something', detail: '25 min · uses spray paint', disabled: s.flags.paint ? false : 'You need spray paint from Talley Market', onClick: () => after(paintTunnel(s)) },
    ]);
    case 'wolfears': return menu(it.label, 'Two stone ears, far apart. A whisper into one carries to the other.', [
      { label: 'Whisper something', detail: '5 min', onClick: () => after(whisperEars(s)) },
    ]);
    case 'info': {
      if (agentHere(s, 'walt')) return openDialogue('walt');
      return toast('The information desk is closed.');
    }
    case 'closed': return toast(`${it.label}: fenced off and being demolished.`);
  }
}

function venueMenu(id: string) {
  const s = ctx.state!;
  const v = VENUES[id];
  const open = venueOpen(v, s.minute);
  menu(v.name, `${open ? 'Open' : 'Closed'} · ${fmtTime(v.open)} to ${fmtTime(v.close)} · You have ${fmtMoney(s.money)}, ${s.swipes} swipes`,
    v.items.map((item) => {
      const price = item.swipe ? '1 swipe' : fmtMoney(itemPrice(s, item));
      const short = item.swipe ? (s.swipes < 1 ? 'No swipes left' : '') : (s.money < itemPrice(s, item) ? 'Not enough money' : '');
      return {
        label: item.name, detail: `${price} · ${item.minutes} min`,
        disabled: !open ? 'Closed' : short || false,
        onClick: () => after(buy(s, id, item.id)),
      };
    }));
}

/** Set by the scene: when the next bus reaches a stop, as text ("in about 3 min"). */
let busEta: (stop: string) => string = () => '';
export function setBusEta(fn: (stop: string) => string) { busEta = fn; }

function busMenu(from: string) {
  const s = ctx.state!;
  const route = BUS_ORDER.map((id) => BUS_STOPS[id].name.split(' at ')[1]).join(' → ');
  const running = busRunning(s.minute);
  menu(`Wolfline stop: ${BUS_STOPS[from].name}`,
    `Free. The loop runs ${route}, ${fmtTime(BUS.first)} to ${fmtTime(BUS.last)}. Wait at the sign; when the bus pulls in and opens its doors, press E to board.`,
    [{
      label: 'Wait for the bus', detail: running ? `next bus ${busEta(from) || 'soon'}` : '',
      disabled: running ? false : 'No more buses tonight', onClick: () => {},
    }]);
}

function sleepMenu() {
  const s = ctx.state!;
  const hours = hoursOfSleep(s);
  const early = s.minute < 20 * 60;
  menu('Your room in Tucker Hall', `${fmtTime(s.minute)}. Sleeping now gives ${hours} hours until 7:30 AM.${hours < 6 ? ' Under 6 hours carries a penalty.' : ''}`, [
    { label: early ? 'Go to bed early' : 'Go to sleep', detail: `ends day ${s.day}`, onClick: () => void startNight(false) },
    { label: 'Nap', detail: '30 min · energy', onClick: () => after(rest(s)) },
  ]);
}

export async function startNight(passedOut: boolean) {
  if (nightRunning || !ctx.state) return;
  nightRunning = true;
  closeMenu(); closeDialogue(); closePhone();
  const s = ctx.state;
  showNight(passedOut);
  try {
    const core = AGENTS.filter((a) => a.tier === 'core');
    const results = await Promise.all(core.map((a) => reflect(s, a.id)));
    results.forEach((res, i) => applyReflection(s, core[i].id, res.r));
    sleep(s, passedOut);
    if (s.ended) {
      const ep = await directorEpilogue(s);
      s.epilogue = ep;
      save();
      showEnd();
    } else {
      const rc = await directorRecap(s);
      s.recaps.push({ day: s.day, text: [rc.recap, rc.hook].filter(Boolean).join(' '), source: rc.source });
      save();
      bus.emit('map');
      bus.emit('state');
      showMorning();
    }
  } finally {
    nightRunning = false;
  }
}
