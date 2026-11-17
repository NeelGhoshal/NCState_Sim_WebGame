// Persona cards, schedules, invitations and scripted lines. Every character is fictional.
// Times are minutes after midnight; past 1440 means after midnight.
import { N } from './names';

export interface SchedEntry {
  from: number;
  to: number;
  mapId: string | null; // null = offscreen (in class, at work, asleep)
  spot?: string;
  activity: string;
  days?: number[];      // day-specific entries win over everyday ones
  feed?: string;        // posted to the phone feed when this entry starts
}

export interface InviteDef {
  id: string;
  label: string;
  day: number;
  from: number;
  to: number;
  mapId: string;
  spot: string;
  radius: number;
  textAt?: number;      // if not offered in person by then, it arrives as a text
  textBody: string;
  requires?: string;    // another invite that must have been attended
  reward: { rel: number; knowledge?: number; stress?: number };
  attendedMemory: string;
  missedMemory: string;
}

/**
 * Something a character knows and may tell. Facts move between characters through the rumor
 * network (src/engine/rumors.ts) and reach the player through share_info.
 */
export interface Fact {
  id: string;
  text: string;
  /** Private to its owner: passing it on is gossip, and the owner minds if it gets back to them. */
  secret?: boolean;
  /** 0..1: how tempting it is to repeat. Multiplied by the teller's gossip level. */
  spread?: number;
  /** How the owner refers to it when it gets back to them ("my lab email"). */
  topic?: string;
}
export interface Gift { id: string; label: string; energy: number; hunger: number; stress: number }

export interface AgentDef {
  id: string;
  name: string;
  tier: 'core' | 'supporting';
  role: string;
  pronouns: string;
  /**
   * What this character follows. Decides which real campus happenings and background cards
   * the AI service retrieves for them (ai/app/rag/topics.py lists the topics). 'all' hears
   * everything; everyone also knows general campus facts.
   */
  topics: string[];
  /** 0..1: how readily this character passes on what they hear. */
  gossip: number;
  colors: { skin: string; hair: string; shirt: string; pants: string };
  persona: string;
  speech: string;
  values: string;
  semesterGoal: string;
  dayGoals: string[];
  facts: Fact[];
  gift?: Gift;
  schedule: SchedEntry[];
  invites: InviteDef[];
  startRel: number;
  startNote: string;
  battery: number;
  greet: string[];
  lines: string[];
  replies: string[];
  leave: string[];
  tired: string[];
  morningTexts: Record<number, string>;
}

const h = (hh: number, mm = 0) => hh * 60 + mm;
const T = N.talley;

export const AGENTS: AgentDef[] = [
  {
    id: 'maya',
    name: 'Maya Okafor',
    tier: 'core',
    role: 'your roommate',
    topics: ['biology', 'science', 'research', 'residence', 'dining', 'wellness'],
    gossip: 0.35,
    pronouns: 'she/her',
    colors: { skin: '#8d5a3b', hair: '#1d1410', shirt: '#2f8f6f', pants: '#2b2f45' },
    persona: 'A first-year biology major from Charlotte and your roommate in Tucker Hall. Early riser, keeps succulents on the windowsill and a shared chore chart on the fridge. Wants to get into a research lab by spring and is quietly worried she is behind.',
    speech: 'Warm and dry. Short sentences. Starts objections with "okay but". Teases people she likes.',
    values: 'Reliability, keeping promises, a clean shared space, people who show up.',
    semesterGoal: 'Get a spot as an undergraduate research assistant in a biology lab.',
    dayGoals: [
      'Settle into a routine and figure out if the new roommate is someone she can count on.',
      'Get through a brutal bio lab write-up and have one real meal with a friend.',
      'Email a professor about lab openings without overthinking it.',
    ],
    facts: [
      { id: 'maya_lab', text: 'Maya has a professor she wants to email about lab openings but keeps rewriting the draft.', secret: true, spread: 0.5, topic: 'my lab email' },
      { id: 'maya_tuffys', text: "Maya says Tuffy's milkshakes are the best stress cure in Talley.", spread: 0.6 },
    ],
    schedule: [
      { from: h(6), to: h(8), mapId: 'campus', spot: 'c.dorm', activity: 'heading out from Tucker Hall' },
      { from: h(8), to: h(12), mapId: null, activity: 'in biology lecture and lab', feed: 'Lab section ran long again. Pipettes are my nemesis.' },
      { from: h(12), to: h(13, 30), mapId: 'talley2', spot: 'f2.oneearth.seat', activity: 'eating lunch by One Earth' },
      { from: h(13, 30), to: h(15), mapId: null, activity: 'in calculus' },
      { from: h(15), to: h(18), mapId: 'talley3', spot: 'f3.lounge.desk', activity: 'studying in the third-floor study lounge', feed: 'Third floor study lounge, window seat secured.' },
      { from: h(18), to: h(19), mapId: 'talley2', spot: 'f2.w3.a', activity: 'having dinner in a booth' },
      { from: h(18), to: h(19), mapId: 'talley2', spot: 'f2.tuffys.line', activity: "waiting for you at Tuffy's Diner", days: [2] },
      { from: h(19), to: h(22), mapId: 'talley1', spot: 'f1.lounge.sofa', activity: 'hanging out in the first-floor lounge' },
      { from: h(22), to: h(26), mapId: 'campus', spot: 'c.dorm', activity: 'back at Tucker Hall' },
    ],
    invites: [
      {
        id: 'maya_dinner', label: `Dinner with Maya at ${T.tuffys}`, day: 2, from: h(18), to: h(19),
        mapId: 'talley2', spot: 'f2.tuffys.line', radius: 7, textAt: h(11),
        textBody: "dinner tonight? tuffy's, 6pm. I need a milkshake and a human",
        reward: { rel: 8, stress: -8 },
        attendedMemory: 'The player came to dinner at Tuffy\'s and we actually talked. Felt like a real friend.',
        missedMemory: 'The player said they would come to dinner at Tuffy\'s and never showed. I ate alone.',
      },
    ],
    startRel: 50,
    startNote: 'New roommate. Seems fine so far.',
    battery: 8,
    greet: ['Hey, roomie.', 'Oh good, a familiar face.', 'Okay but where have you been all day?'],
    lines: [
      'I have three chapters to read and I have read zero of them.',
      'Did you take my oat milk? Kidding. Mostly.',
      'Talley is basically my second dorm at this point.',
      'Okay but you should actually come out more. People here are nice.',
      'I keep rewriting this email to a professor. It is four sentences long.',
    ],
    replies: ['How was lab?', 'Want to grab food later?', 'I should probably go study.'],
    leave: ['I have to run, I am going to be late.', 'Okay, that is my cue. See you at home.'],
    tired: ['I am all talked out today. Tomorrow?'],
    morningTexts: { 2: "morning! left you a granola bar on your desk. don't say I never do anything", 3: 'big day. you got this. also take out the trash pls' },
  },
  {
    id: 'jordan',
    name: 'Jordan Ellis',
    tier: 'core',
    role: `president of ${N.club}, the campus makers club`,
    topics: ['engineering', 'makers', 'technology', 'entrepreneurship', 'clubs', 'career'],
    gossip: 0.6,
    pronouns: 'they/them',
    colors: { skin: '#e0b48f', hair: '#c44d2a', shirt: '#d9a21b', pants: '#33363d' },
    persona: `A third-year mechanical engineering student and president of ${N.club}, a club that builds weird hardware projects. Runs on cold brew. Needs new members before the spring hackathon or the club loses its funding tier.`,
    speech: 'Fast and enthusiastic. Pitches everything like a startup. Uses "okay, picture this".',
    values: 'Building things, momentum, people who follow through, inclusion of beginners.',
    semesterGoal: `Recruit five new ${N.club} members who stick around through the spring hackathon.`,
    dayGoals: [
      `Get first-years to come to the ${N.club} interest meeting tonight.`,
      'Find someone to help fix the 3D printer before build night.',
      'Run build night and see who actually comes back.',
    ],
    facts: [
      { id: 'jordan_printer', text: `The ${N.club} 3D printer has been broken for a week and Jordan is quietly panicking about it.`, secret: true, spread: 0.6, topic: 'the printer' },
      { id: 'jordan_funding', text: `${N.club} needs more active members to keep its funding tier.`, spread: 0.9 },
    ],
    schedule: [
      { from: h(9), to: h(11, 30), mapId: 'campus', spot: 'c.brickyard', activity: `tabling for ${N.club} in the Brickyard`, feed: `Tabling in the Brickyard! Come say hi, we have stickers.` },
      { from: h(11, 30), to: h(13), mapId: 'talley2', spot: 'f2.m2.a', activity: 'eating lunch and sketching a robot arm' },
      { from: h(13), to: h(17, 30), mapId: null, activity: 'in engineering classes on Centennial' },
      { from: h(17, 30), to: h(19, 30), mapId: 'talley3', spot: 'f3.club', activity: `running the ${N.club} club room` },
      { from: h(19, 30), to: h(22), mapId: 'talley1', spot: 'f1.s6.a', activity: 'fixing a printer part in a booth' },
      { from: h(20), to: h(21, 30), mapId: 'talley3', spot: 'f3.club', activity: 'running build night', days: [3] },
    ],
    invites: [
      {
        id: 'jordan_meeting', label: `${N.club} interest meeting`, day: 1, from: h(18), to: h(19),
        mapId: 'talley3', spot: 'f3.club', radius: 6, textAt: h(13),
        textBody: `hey! saw you around Talley. ${N.club} interest meeting tonight 6pm, third floor club room. free pizza (not a bribe) (it is a bribe)`,
        reward: { rel: 10, stress: -4 },
        attendedMemory: `The player came to the ${N.club} interest meeting and asked good questions.`,
        missedMemory: `The player never came to the ${N.club} interest meeting.`,
      },
      {
        id: 'jordan_build', label: `${N.club} build night`, day: 3, from: h(20), to: h(21, 30),
        mapId: 'talley3', spot: 'f3.club', radius: 6, textAt: h(15), requires: 'jordan_meeting',
        textBody: 'build night tonight 8pm, club room. bring snacks or bring hands, both welcome',
        reward: { rel: 10, stress: -6 },
        attendedMemory: 'The player came back for build night. That is a real member.',
        missedMemory: 'The player skipped build night after coming to the first meeting.',
      },
    ],
    startRel: 40,
    startNote: 'Have not met yet.',
    battery: 8,
    greet: ['Hey hey! You look like someone who builds things.', 'Okay, picture this: you, me, a robot arm.', 'Oh nice, you again!'],
    lines: [
      `We are making a plant that tweets when it is thirsty. It is very important work.`,
      'The 3D printer is broken. Do not tell anyone. Okay, I am telling you.',
      'Zero experience is fine. Half of us learned to solder last month.',
      'I have had four cold brews. I am fine. I am great.',
      'Honestly the best part of college so far was building something stupid with friends.',
    ],
    replies: ['What does the club actually do?', 'I have never built anything.', 'Maybe another time.'],
    leave: ['Ah, I have to run. Catch you later!', 'Duty calls. Club stuff. Always club stuff.'],
    tired: ['I am out of words for today. Find me tomorrow!'],
    morningTexts: { 2: 'quick q: do you know anything about stepper motors. no pressure. some pressure', 3: 'build night is tonight if you want in!' },
  },
  {
    id: 'dev',
    name: 'Dev Kapoor',
    tier: 'core',
    role: 'your rival in CH 101',
    topics: ['premed', 'health', 'science', 'research', 'academics', 'career'],
    gossip: 0.2,
    pronouns: 'he/him',
    colors: { skin: '#a8754f', hair: '#16110e', shirt: '#3b5ba8', pants: '#1e2230' },
    persona: 'A first-year pre-med student in your CH 101 section who has decided you are his competition. Sets the curve on purpose. Underneath, anxious about disappointing his parents, and would never admit it.',
    speech: 'Clipped and competitive. Quizzes people mid-conversation. Rarely uses exclamation marks.',
    values: 'Winning, preparation, being taken seriously. Respects people who push back.',
    semesterGoal: 'Get the top grade in CH 101 and get noticed by the professor.',
    dayGoals: [
      'Figure out whether the new person in CH 101 is actually a threat.',
      'Out-study everyone before the quiz, and maybe test the rival in a study duel.',
      'Ace the CH 101 quiz.',
    ],
    facts: [
      { id: 'dev_quiz', text: 'Dev heard the CH 101 quiz on day 3 is heavy on stoichiometry.', spread: 0.7 },
      { id: 'dev_parents', text: 'Dev calls home every night and his parents always ask about his grades first.', secret: true, spread: 0.35, topic: 'my parents' },
    ],
    schedule: [
      { from: h(7), to: h(9, 30), mapId: 'talley1', spot: 'f1.pcj.t1', activity: 'doing flashcards at Port City Java' },
      { from: h(9, 30), to: h(11, 5), mapId: null, activity: 'in CH 101 at Dabney Hall', feed: 'Front row. As usual.' },
      { from: h(11, 5), to: h(14), mapId: null, activity: 'in other classes' },
      { from: h(14), to: h(16), mapId: 'talley2', spot: 'f2.sbux.chair', activity: 'doing problem sets at Starbucks' },
      { from: h(16), to: h(19), mapId: null, activity: 'volunteering at the hospital' },
      { from: h(19), to: h(23), mapId: 'talley3', spot: 'f3.e2.a', activity: 'timing practice exams in the study lounge', feed: 'Practice exam #4. 94. Not good enough.' },
    ],
    invites: [
      {
        id: 'dev_duel', label: 'Study duel with Dev before the quiz', day: 2, from: h(19, 30), to: h(21),
        mapId: 'talley3', spot: 'f3.e2.a', radius: 6, textAt: h(16, 30),
        textBody: 'study duel. tonight 7:30, third floor study lounge. loser buys coffee. unless you are scared',
        reward: { rel: 8, knowledge: 12 },
        attendedMemory: 'The player showed up for the study duel and kept up with me. Annoying. Impressive.',
        missedMemory: 'The player dodged the study duel. Typical.',
      },
    ],
    startRel: 35,
    startNote: 'Seen in CH 101. Possible competition.',
    battery: 7,
    greet: ['You are in my CH 101 section.', 'Quick: what is Avogadro\'s number?', 'Oh. You.'],
    lines: [
      'The quiz is in two days. I have done every practice problem twice.',
      'If you are not ahead you are behind.',
      'Office hours are wasted on people who do not prepare questions.',
      'I am not stressed. I am focused. Different thing.',
      'You are either very calm or very unprepared. I cannot tell which.',
    ],
    replies: ['Six point oh two times ten to the twenty-third.', 'Do you ever relax?', 'Want to study together?'],
    leave: ['I have a schedule. Bye.', 'I am going to go be productive now.'],
    tired: ['I do not have time for more talking today.'],
    morningTexts: { 3: 'quiz today. good luck. you will need it' },
  },
  {
    id: 'sam',
    name: 'Sam Rivera',
    tier: 'supporting',
    role: `barista at ${T.pcj}`,
    topics: ['dining', 'arts', 'clubs', 'athletics', 'service'],
    gossip: 0.85,
    pronouns: 'they/them',
    colors: { skin: '#c68e63', hair: '#5a2e8a', shirt: '#6b3a1f', pants: '#2a2a2a' },
    persona: `A senior and the morning barista at ${T.pcj} in Talley. Knows every regular's order and most of the gossip.`,
    speech: 'Easygoing, a little sarcastic, calls everyone "friend".',
    values: 'Kindness to service workers, good coffee, sleeping in on weekends.',
    semesterGoal: 'Graduate without working a single double shift.',
    dayGoals: ['Survive the morning rush.', 'Survive the morning rush.', 'Survive the morning rush.'],
    facts: [
      { id: 'sam_cow', text: `${T.howlingCow} scoops on the first floor, next to ${T.market}, use milk from the university dairy.` },
      { id: 'sam_ears', text: 'If you whisper into the Wolf Ears in the Court of North Carolina, someone at the other ear hears you perfectly.' },
    ],
    gift: { id: 'cookie', label: 'a free day-old cookie', energy: 4, hunger: -8, stress: -3 },
    schedule: [{ from: h(7), to: h(15), mapId: 'talley1', spot: 'f1.pcj.staff', activity: `working the counter at ${T.pcj}` }],
    invites: [],
    startRel: 45,
    startNote: 'A customer.',
    battery: 4,
    greet: ['Morning, friend. What can I get you?', 'Hey friend.'],
    lines: ['The espresso machine and I are not on speaking terms today.', 'Dev over there has ordered the same drink 40 days in a row.'],
    replies: ['What is good today?', 'Any campus tips?', 'Thanks, see you.'],
    leave: ['Line is backing up, friend. Catch you later.'],
    tired: ['Sorry friend, rush hour. Come back tomorrow.'],
    morningTexts: {},
  },
  {
    id: 'walt',
    name: 'Walt Brooks',
    tier: 'supporting',
    role: `staff at the ${N.bldg.talley} information desk`,
    topics: ['all'],
    gossip: 0.5,
    pronouns: 'he/him',
    colors: { skin: '#e8c4a0', hair: '#bdbdbd', shirt: '#9e1b1b', pants: '#30343c' },
    persona: `Has worked the ${N.bldg.talley} information desk for nineteen years. Knows the building better than its architects.`,
    speech: 'Patient, folksy, gives directions with landmarks.',
    values: 'Helping lost first-years, punctuality, the building itself.',
    semesterGoal: 'Get through one more semester before retiring.',
    dayGoals: ['Help whoever walks up.', 'Help whoever walks up.', 'Help whoever walks up.'],
    facts: [
      { id: 'walt_tunnel', text: `Anyone can paint the ${N.place.freeExpression}; ${T.market} sells tunnel-safe spray paint.` },
      { id: 'walt_bus', text: `The ${N.bus.name} stops on Cates Avenue right outside ${N.bldg.talley}, and it is free.` },
      { id: 'walt_stewart', text: `${T.stewart} on the second floor shows free movies some weekend nights.` },
    ],
    schedule: [{ from: h(8), to: h(20), mapId: 'talley1', spot: 'f1.info.staff', activity: 'staffing the information desk' }],
    invites: [],
    startRel: 50,
    startNote: 'A student asking for directions.',
    battery: 4,
    greet: ['Welcome to Talley. Lost?', 'Afternoon. What can I help you find?'],
    lines: ['Food is on the second floor, ballrooms on the third, and the best booths are by the south windows.'],
    replies: ['Where is the food?', 'Anything fun to do?', 'Thanks!'],
    leave: ['Someone else needs directions. Good luck out there.'],
    tired: ['That is all the help I have in me today. Come back tomorrow.'],
    morningTexts: {},
  },
];

export const AGENT_BY_ID: Record<string, AgentDef> = Object.fromEntries(AGENTS.map((a) => [a.id, a]));
export const ALL_INVITES: InviteDef[] = AGENTS.flatMap((a) => a.invites);
export const INVITE_OWNER: Record<string, string> = Object.fromEntries(AGENTS.flatMap((a) => a.invites.map((i) => [i.id, a.id])));

export const CROWD_LINES = [
  'Sorry, running late for class!',
  'Have you seen a blue water bottle? No? Okay.',
  'The Wi-Fi in here is a lie.',
  'Go Pack!',
  'I have a midterm in an hour and I am eating a cookie about it.',
  'Is this booth taken? Never mind.',
  'Do you know where the club fair is?',
];

/** Every fact by id, with the character it belongs to. */
export const FACTS: Record<string, Fact & { owner: string }> = Object.fromEntries(
  AGENTS.flatMap((a) => a.facts.map((f) => [f.id, { ...f, owner: a.id }])),
);
