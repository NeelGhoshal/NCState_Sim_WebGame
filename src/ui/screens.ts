import { ctx, bus, save, loadSave, clearSave } from '../core';
import { AGENT_BY_ID, AGENTS } from '../data/agents';
import { N } from '../data/names';
import { fmtTime, fmtMoney } from '../engine/engine';
import { BUDGETS, BUCKET, DAYS, TRAIT_KEYS, TRAIT_POINTS, newGame, validTraits, type Budget, type TraitKey, type Traits } from '../engine/state';
import { llmStatus } from '../agents/gateway';
import { el, esc, root, setModal } from './dom';

const TRAIT_INFO: Record<TraitKey, [string, string]> = {
  athletics: ['Athletics', 'Walking costs less energy'],
  academics: ['Academics', 'More knowledge per hour of study and class'],
  charisma: ['Charisma', 'Good conversations count for more (7+)'],
  creativity: ['Creativity', 'Opens arts storylines (later phases)'],
  discipline: ['Discipline', 'Energy drains more slowly'],
  streetSmarts: ['Street smarts', 'Small discount on everything you buy'],
};

function screen(html: string): HTMLElement {
  document.getElementById('screen')?.remove();
  const s = el(`<div id="screen" class="screen"><div class="screen-card">${html}</div></div>`);
  root().appendChild(s);
  setModal('screen', true);
  return s;
}

export function closeScreen() {
  document.getElementById('screen')?.remove();
  setModal('screen', false);
}

function modelLine(): string {
  const st = llmStatus();
  if (st.configured) return `<span class="chip ok">AI on · ${esc(st.provider!)} · ${esc(st.models!.small)} / ${esc(st.models!.large)}</span>`;
  return st.server
    ? '<span class="chip">Scripted mode · AI service is running but has no key. Add a free Groq key to <code>.env.local</code></span>'
    : '<span class="chip">Scripted mode · AI service not running. Start everything with <code>npm run dev</code></span>';
}

export function showTitle() {
  const saved = loadSave();
  const s = screen(`
    <p class="eyebrow">${esc(N.university)} · Phase 0 prototype</p>
    <h1>Campus Life Sim</h1>
    <p class="lead">Three days at ${esc(N.bldg.talley)} and the campus around it. The people you meet have their own schedules, memories and plans. Every conversation costs time.</p>
    <p>${modelLine()}</p>
    <div class="row">
      <button class="primary" id="new">New game</button>
      ${saved ? `<button id="cont">Continue: ${esc(saved.setup.name)}, day ${Math.min(saved.day, DAYS)}, ${fmtTime(saved.minute)}</button>` : ''}
    </div>
    <p class="fine">A fan prototype. All characters are fictional. Map layouts are schematic. Hillsborough Street businesses are invented.</p>`);
  s.querySelector<HTMLButtonElement>('#new')!.onclick = showCreator;
  const c = s.querySelector<HTMLButtonElement>('#cont');
  if (c && saved) c.onclick = () => {
    ctx.state = saved;
    closeScreen();
    bus.emit('map'); bus.emit('state');
    if (saved.ended) showEnd();
  };
}

export function showCreator() {
  const traits = Object.fromEntries(TRAIT_KEYS.map((k) => [k, 1])) as Traits;
  Object.assign(traits, { athletics: 4, academics: 5, charisma: 5, creativity: 3, discipline: 5, streetSmarts: 4 });
  let budget: Budget = 'steady';
  const s = screen(`
    <h2>Create your student</h2>
    <div class="form">
      <label>Name <input id="name" maxlength="24" value="Alex" /></label>
      <label>Pronouns <select id="pron"><option>they/them</option><option>she/her</option><option>he/him</option></select></label>
    </div>
    <h3>Traits <span class="muted" id="pts"></span></h3>
    <div class="traits"></div>
    <h3>Budget for the three days</h3>
    <div class="budgets">${(Object.keys(BUDGETS) as Budget[]).map((b) => `<label><input type="radio" name="budget" value="${b}" ${b === budget ? 'checked' : ''}/> ${esc(BUDGETS[b].label)}</label>`).join('')}</div>
    <p class="fine">Your home is Tucker Hall on Central Campus. You take CH 101 at Dabney Hall, 10:15 AM each day. Quiz on day 3.</p>
    <div class="row"><button id="back">Back</button><button class="primary" id="go">Start day 1</button></div>`);
  const box = s.querySelector('.traits')!;
  const spent = () => TRAIT_KEYS.reduce((a, k) => a + traits[k] - 1, 0);
  const draw = () => {
    box.innerHTML = '';
    for (const k of TRAIT_KEYS) {
      const row = el(`<div class="trait"><span class="tn">${TRAIT_INFO[k][0]}</span>
        <button class="m">−</button><span class="pips">${Array.from({ length: 10 }, (_, i) => `<i class="${i < traits[k] ? 'on' : ''}"></i>`).join('')}</span><button class="p">+</button>
        <span class="muted">${TRAIT_INFO[k][1]}</span></div>`);
      row.querySelector<HTMLButtonElement>('.m')!.onclick = () => { if (traits[k] > 1) { traits[k]--; draw(); } };
      row.querySelector<HTMLButtonElement>('.p')!.onclick = () => { if (traits[k] < 10 && spent() < TRAIT_POINTS) { traits[k]++; draw(); } };
      box.appendChild(row);
    }
    s.querySelector('#pts')!.textContent = `${TRAIT_POINTS - spent()} of ${TRAIT_POINTS} points left`;
  };
  draw();
  s.querySelectorAll<HTMLInputElement>('input[name=budget]').forEach((r) => (r.onchange = () => { budget = r.value as Budget; }));
  s.querySelector<HTMLButtonElement>('#back')!.onclick = showTitle;
  s.querySelector<HTMLButtonElement>('#go')!.onclick = () => {
    const name = (s.querySelector<HTMLInputElement>('#name')!.value.trim() || 'Alex').slice(0, 24);
    const pronouns = s.querySelector<HTMLSelectElement>('#pron')!.value;
    if (!validTraits(traits)) return;
    clearSave();
    ctx.state = newGame({ name, pronouns, traits: { ...traits }, budget });
    save();
    bus.emit('map'); bus.emit('state');
    showIntro();
  };
}

function showIntro() {
  const s = ctx.state!;
  const sc = screen(`
    <p class="eyebrow">Episode 1 · Day 1</p>
    <h2>First week</h2>
    <p class="lead">It is 8:00 AM outside Tucker Hall, ${esc(s.setup.name)}. Class is at 10:15 in Dabney Hall, north of the tracks. ${esc(N.bldg.talley)} is just up the sidewalk, and everyone seems to end up there eventually.</p>
    <ul class="tips">
      <li><b>WASD</b> or arrows to walk, or click where you want to go. The clock only moves when you do something.</li>
      <li><b>E</b> to talk to people and use things. Each exchange costs 5 minutes.</li>
      <li><b>P</b> opens your phone: schedule, texts, and scrolling to skip time.</li>
      <li>Go home to Tucker Hall to sleep. If you are still out at 2 AM, you crash.</li>
    </ul>
    <div class="row"><button class="primary" id="go">Start</button></div>`);
  sc.querySelector<HTMLButtonElement>('#go')!.onclick = closeScreen;
}

export function showNight(passedOut: boolean) {
  screen(`
    <p class="eyebrow">Night ${ctx.state!.day}</p>
    <h2>${passedOut ? 'You crash at 2 AM.' : 'The night passes.'}</h2>
    <p class="lead">${AGENTS.filter((a) => a.tier === 'core').map((a) => esc(a.name.split(' ')[0])).join(', ')} are thinking over their day. The director is planning tomorrow.</p>
    <div class="spinner"></div>`);
}

export function showMorning() {
  const s = ctx.state!;
  const recap = s.recaps[s.recaps.length - 1];
  const texts = s.texts.filter((t) => t.day === s.day && !t.read);
  const sc = screen(`
    <p class="eyebrow">Episode 1 · Day ${s.day} of ${DAYS}</p>
    <h2>${fmtTime(s.minute)}, Tucker Hall</h2>
    <p class="lead">${esc(recap?.text ?? '')}</p>
    <p class="muted small">${recap?.source === 'llm' ? 'Recap written by the director model.' : 'Scripted recap.'}</p>
    ${texts.length ? `<h3>New texts</h3><ul>${texts.map((t) => `<li><b>${esc(AGENT_BY_ID[t.from].name)}:</b> ${esc(t.body)}</li>`).join('')}</ul>` : ''}
    <div class="row"><button class="primary" id="go">Get up</button></div>`);
  sc.querySelector<HTMLButtonElement>('#go')!.onclick = closeScreen;
}

export function showEnd() {
  const s = ctx.state!;
  const ep = s.epilogue;
  const u = s.usage;
  const tokens = u.small.promptTokens + u.small.completionTokens + u.large.promptTokens + u.large.completionTokens;
  const core = AGENTS.filter((a) => a.tier === 'core');
  const sc = screen(`
    <p class="eyebrow">End of episode 1</p>
    <h2>Three days in</h2>
    <p class="lead">${esc(ep?.closing ?? '')}</p>
    <ul>${core.map((a) => `<li><b>${esc(a.name)}</b> <span class="muted">${s.agents[a.id].rel}/100</span><br>${esc(ep?.characters[a.id] ?? '')}</li>`).join('')}</ul>
    <div class="stats">
      <div><span class="muted">CH 101 quiz</span><b>${s.quizScore ?? 'skipped'}</b></div>
      <div><span class="muted">Money left</span><b>${fmtMoney(s.money)}</b></div>
      <div><span class="muted">Bucket list</span><b>${BUCKET.filter((b) => s.bucket[b.id]).length}/${BUCKET.length}</b></div>
      <div><span class="muted">Model calls</span><b>${u.calls}</b></div>
      <div><span class="muted">Tokens</span><b>${tokens.toLocaleString()}</b></div>
      <div><span class="muted">Fallbacks</span><b>${u.fallbacks}</b></div>
    </div>
    <p class="muted small">${ep?.source === 'llm' ? 'Epilogue written by the director model.' : 'Scripted epilogue.'} Gate 0 asks: was that fun? The token count above is the measured cost of one episode.</p>
    <div class="row"><button class="primary" id="again">New game</button></div>`);
  sc.querySelector<HTMLButtonElement>('#again')!.onclick = () => { clearSave(); ctx.state = null; showTitle(); };
}
