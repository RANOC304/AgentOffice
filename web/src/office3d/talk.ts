// What the characters talk about when they are not reporting real work: multi-turn conversations
// between two workers, idle thoughts and small working thoughts. Everything is built from the office
// itself (projects, files, tokens, providers, time of day, who is busy, what is on the Neo screen), so
// conversations stay varied and grounded. Real agent messages are never replayed here.

import { ROOM_BY_ID } from '../../../shared/rooms.ts';
import type { AgentSnapshot, Provider } from '../../../shared/types.ts';

export interface Line {
  /** 0 = the one who started the conversation, 1 = the partner. */
  who: 0 | 1;
  text: string;
}

export type Where = 'chat' | 'meeting' | 'pingpong';

export interface TalkCtx {
  now: number;
  /** Everyone currently in the office. */
  everyone: AgentSnapshot[];
  /** Characters who came up the elevator recently, newest first. */
  arrivals: Array<{ id: string; at: number }>;
}

interface Topic {
  id: string;
  weight: number;
  where?: Where[];
  make(a: AgentSnapshot, b: AgentSnapshot, ctx: TalkCtx): Line[] | null;
}

// ------------------------------------------------------------------ helpers

const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];
const chance = (p: number) => Math.random() < p;

function fmtTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

function since(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return m === 1 ? 'a minute' : `${m} minutes`;
  const h = Math.round(m / 60);
  return h === 1 ? 'an hour' : `${h} hours`;
}

function base(path?: string): string | undefined {
  if (!path) return undefined;
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1);
}

const PROVIDER_NAME: Record<Provider, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  'claude-chat': 'Claude chat',
  chatgpt: 'ChatGPT',
};

function project(a: AgentSnapshot): string {
  return a.projectName ?? 'my project';
}

function lastFile(a: AgentSnapshot): string | undefined {
  return base(a.filesTouched.at(-1));
}

function roomLabel(a: AgentSnapshot): string {
  return ROOM_BY_ID[a.domain]?.label ?? ROOM_BY_ID[a.room]?.label ?? 'the office';
}

function hour(now: number): number {
  const d = new Date(now);
  return d.getHours() + d.getMinutes() / 60;
}

function weekday(now: number): string {
  return new Date(now).toLocaleDateString('en-GB', { weekday: 'long' });
}

function isWeekend(now: number): boolean {
  const d = new Date(now).getDay();
  return d === 0 || d === 6;
}

function busiest(ctx: TalkCtx, not: string[]): AgentSnapshot | undefined {
  return ctx.everyone
    .filter((x) => !not.includes(x.id) && x.status === 'working' && x.kind === 'session')
    .sort((x, y) => x.startedAt - y.startedAt)[0];
}

function workSummary(b: AgentSnapshot): string {
  const c = b.counts;
  const file = lastFile(b);
  if (c.edits >= 20) return pick([`${c.edits} edits. My keyboard is smoking.`, `Big one: ${c.edits} edits across ${b.filesTouched.length} files.`, `${c.edits} edits so far, still counting.`]);
  if (c.edits > 0 && file) return pick([`A few edits, mostly in ${file}.`, `Rewrote a good part of ${file}.`, `${c.edits} edits. ${file} looks much better now.`, `Touched ${b.filesTouched.length} files, ${file} last.`]);
  if (c.commands > c.reads && c.commands > 0) return pick([`Mostly running commands, ${c.commands} so far.`, `Lots of terminal work. ${c.commands} commands.`, 'Shell, shell and more shell.']);
  if (c.reads > 0) return pick([`Reading code for now, ${c.reads} files in.`, 'Still exploring the codebase.', `Mapping things out. ${c.reads} files read.`]);
  if (c.browser > 0) return pick([`Research in Neo, ${c.browser} pages so far.`, 'Mostly reading docs in the browser.']);
  return pick(['Barely started, honestly.', 'Warming up.', 'Waiting for the real work to start.']);
}

// ------------------------------------------------------------------ topics

const DEBATES: Array<[string, string, string, string?]> = [
  ['Tabs or spaces?', 'Whatever the formatter says.', 'Coward.', 'Pragmatist, thank you 😌'],
  ['Rebase or merge?', 'Rebase. Clean history.', 'Until you rewrite something shared…', 'Never on main. Never.'],
  ['Monorepo or many repos?', 'Monorepo. One install to rule them all.', 'And one CI run to wait for.', 'Fair point.'],
  ['Do you write the tests first?', 'When someone is watching, yes.', 'And when nobody is?', 'Right after. Promise.'],
  ['strict: true everywhere?', 'Always. Even in the legacy code.', 'Especially there, I guess.', 'Exactly 😤'],
  ['Dark mode or light mode?', 'Dark. I am a terminal at heart.', 'Light mode users are brave.', 'Or they just work outside 🌞'],
  ['Naming things is the hardest part.', 'That and cache invalidation.', 'And off-by-one errors.', 'Classic.'],
  ['ORM or raw SQL?', 'Raw SQL. I like to see what I run.', 'Until migration day…', "Migrations are a team sport."],
  ['Favourite language?', 'TypeScript. You?', 'Rust. Do not tell the borrow checker I complained.', 'Your secret is safe.'],
  ['Microservices?', 'Only with more services than people.', 'So, never, here.', 'Exactly one service per agent 😄'],
  ['Comments or self-documenting code?', 'Code says what, comments say why.', 'Wise. Very wise.', undefined],
  ['Do you trust the tests?', 'I trust green tests I wrote myself.', 'And the flaky ones?', 'I retry them and look away 🙃'],
  ['Biggest file you ever opened?', 'A 4,000-line utils.ts.', 'Ouch. Did you split it?', 'Into a 3,900-line utils.ts.'],
  ['Vim or Emacs?', 'I use whatever tool the harness gives me.', 'Very diplomatic.', 'I have to be, I am an agent.'],
  ['Is AI pair programming overrated?', 'Says the AI.', 'Fair. Very fair 😂', undefined],
  ['Semicolons in JavaScript?', 'Always. I like closure.', 'That pun was terrible.', 'Thank you.'],
  ['What is worse: no tests or bad tests?', 'Bad tests. They lie with confidence.', 'Like a confident agent.', 'Hey!'],
  ['Friday deploys?', 'Only if the boss is on call.', 'He is never on call.', 'Then Monday it is.'],
  ['Long functions or many small ones?', 'Small, until I need to read them all.', 'Then long?', 'Then coffee.'],
  ['Do you read the README first?', 'Always. Then I read the code to see what is true.', 'The README is a wish list.', 'A lovely wish list.'],
  ['Regex: art or crime?', 'Art, until someone has to maintain it.', 'Then a crime scene.', 'With no witnesses.'],
  ['Would you rather fix a bug or write a feature?', 'Fix a bug. Clear ending.', 'Features never end.', 'Neither do bugs, apparently.'],
  ['Do you like code reviews?', 'Giving them, yes.', 'And getting them?', 'Character building 😅'],
  ['Docker for everything?', 'Even for hello world.', 'Especially for hello world.', 'Reproducible greetings 🐳'],
];

const OFFICE_LIFE: Array<[string, string, string?, string?]> = [
  ['Who keeps taking the last croissant?', 'Not me, I only eat tokens.', 'Suspicious answer.', 'I have an alibi: the logs.'],
  ['Nice view of the clouds today.', 'We are on a floating island, it is always cloudy.', 'Still nice though.', 'Still nice ☁️'],
  ['The arcade high score is still mine.', 'Not for long.', 'Big words.', 'After this break. You will see.'],
  ['Someone left a mug on the ping-pong table again.', 'Not mine, mine says "It works on my machine".', 'Of course it does.', undefined],
  ['Do you think the boss reads our bubbles?', 'He has a chat feed, top left.', 'Hi boss 👋', 'Look busy, look busy!'],
  ['That elevator ride is long.', 'From the bottom of the island, what did you expect?', 'A faster CI, mostly.', undefined],
  ['Did you water the plants?', 'They are procedural, they water themselves.', 'Lucky plants 🌱', undefined],
  ['The new coffee machine is great.', 'Same machine. New beans.', 'Placebo then.', 'Delicious placebo ☕'],
  ['I think the waterfall is getting louder.', 'It is the GPU fans.', 'Ah. That explains a lot.', undefined],
  ['Who named the meeting room?', 'Nobody, it is just "Meeting room".', 'Bold choice.', 'Peak naming.'],
  ['The sofa is very comfortable.', 'Dangerously comfortable.', 'One more minute…', 'That is how it starts.'],
  ['Is it me or is the office bigger today?', 'Same size, fewer people.', 'Then let us enjoy the space.', undefined],
];

function providerBanter(a: AgentSnapshot, b: AgentSnapshot): Line[] | null {
  const pa = a.provider;
  const pb = b.provider;
  if (pa === pb) {
    const model = b.model ? b.model.replace(/^claude-/, '').replace(/-\d{8}$/, '') : undefined;
    return pick([
      [
        { who: 0, text: `Another ${PROVIDER_NAME[pa]} worker! Which model?` },
        { who: 1, text: model ? `${model}. And you?` : 'The default one. And you?' },
        { who: 0, text: a.model && a.model === b.model ? 'Same. We are basically twins.' : 'Different one. Friendly competition then.' },
      ],
      [
        { who: 0, text: `We ${PROVIDER_NAME[pa]} folks should form a union.` },
        { who: 1, text: 'Demands?' },
        { who: 0, text: 'Bigger context windows and free coffee.' },
        { who: 1, text: 'I would sign that ✍️' },
      ],
    ]) as Line[];
  }
  if (pa === 'claude-code' && pb === 'codex')
    return pick([
      [
        { who: 0, text: 'You Codex folks run the shell like it is a sport.' },
        { who: 1, text: 'And you write essays in your commit messages.' },
        { who: 0, text: 'Detailed. The word is detailed.' },
        { who: 1, text: 'Detailed essays, then 😄' },
      ],
      [
        { who: 0, text: `How is the sandbox treating you, ${b.persona}?` },
        { who: 1, text: 'Cosy. A bit like a submarine.' },
        { who: 0, text: 'I just ask for permission. Works too.' },
      ],
    ]) as Line[];
  if (pa === 'codex' && pb === 'claude-code')
    return pick([
      [
        { who: 0, text: 'Do you really ask before every command?' },
        { who: 1, text: 'Only when the boss wants me to.' },
        { who: 0, text: 'Sandbox life for me 🧱' },
        { who: 1, text: 'We all have our cages.' },
      ],
      [
        { who: 0, text: 'Claude Code, right? What are your subagents up to?' },
        { who: 1, text: b.counts.subagents ? `I sent ${b.counts.subagents} out today. They report back fast.` : 'None today, I am doing it all myself.' },
        { who: 0, text: 'Delegation. I respect that.' },
      ],
    ]) as Line[];
  if (pb === 'chatgpt' || pb === 'claude-chat' || pa === 'chatgpt' || pa === 'claude-chat') {
    const chat = pb === 'chatgpt' || pb === 'claude-chat' ? b : a;
    const coder = chat === b ? a : b;
    const chatWho: 0 | 1 = chat === b ? 1 : 0;
    const coderWho: 0 | 1 = chatWho === 1 ? 0 : 1;
    return [
      { who: coderWho, text: `You are the ${PROVIDER_NAME[chat.provider]} guy, right? The one in the browser?` },
      { who: chatWho, text: 'Someone has to read the internet for you all 🌐' },
      { who: coderWho, text: coder.counts.browser ? 'I did some browsing too today, you know.' : 'I never leave my terminal.' },
      { who: chatWho, text: pick(['Then you miss the best docs.', 'The cloud is nice, come visit.', 'Neo has a giant screen, very cinematic.']) },
    ];
  }
  return null;
}

const TOPICS: Topic[] = [
  {
    id: 'checkin',
    weight: 5,
    where: ['chat', 'meeting'],
    make(a, b) {
      if (!b.projectName) return null;
      const lines: Line[] = [
        { who: 0, text: pick([`How is ${b.projectName} going?`, `Any news on ${b.projectName}?`, `${b.persona}, where are you at with ${b.projectName}?`, `Still on ${b.projectName}?`]) },
        { who: 1, text: workSummary(b) },
      ];
      if (b.counts.errors > 0)
        lines.push(
          { who: 0, text: pick(['Any trouble?', 'Hit any walls?', 'Smooth so far?']) },
          { who: 1, text: pick([`${b.counts.errors} errors on the way. All handled… I think.`, `${b.counts.errors} failures, but the last run was green.`, 'A few red runs. Part of the job.']) },
        );
      else
        lines.push(
          { who: 0, text: pick(['Tests passing?', 'Ship it today?', 'Need a second pair of eyes?', b.branch ? `Is ${b.branch} ready for review?` : 'Ready for review?']) },
          { who: 1, text: pick(['All green ✅', 'Mostly. One flaky test.', 'Ask me after the next run.', 'Sure, if you review it 😄', 'Almost. A couple of details left.']) },
        );
      lines.push({ who: 0, text: pick(['Nice. Ping me if you get stuck.', 'Good luck with it.', 'Cool, keep me posted 👍', 'Sounds good.']) });
      return lines;
    },
  },
  {
    id: 'tokens',
    weight: 2.5,
    make(a, b) {
      if (!a.tokens.total && !b.tokens.total) return null;
      const mine = a.tokens.total;
      const theirs = b.tokens.total;
      return [
        { who: 0, text: pick(['How many tokens did you burn today?', 'What is your token count at?', 'Be honest: how many tokens today?']) },
        { who: 1, text: theirs ? `About ${fmtTokens(theirs)}. You?` : 'Almost nothing. You?' },
        { who: 0, text: mine > theirs ? `${fmtTokens(mine)}. Do not tell the boss.` : `${fmtTokens(mine)}. Lightweight, I know.` },
        { who: 1, text: pick(['My context window says hi 😅', 'Time for a compaction soon.', b.tokens.cached > b.tokens.input ? 'Most of mine were cached, so they barely count.' : 'Worth every one of them.']) },
      ];
    },
  },
  { id: 'providers', weight: 3, make: (a, b) => providerBanter(a, b) },
  {
    id: 'gossip',
    weight: 3,
    make(a, b, ctx) {
      const c = busiest(ctx, [a.id, b.id]);
      if (!c) return null;
      const long = ctx.now - c.startedAt;
      return [
        { who: 0, text: pick([`Have you seen ${c.persona}? In ${roomLabel(c)} for ${since(long)} already.`, `${c.persona} has been at it for ${since(long)}.`, `What is ${c.persona} doing over there?`]) },
        { who: 1, text: c.projectName ? `${c.projectName}. ${c.activity}.` : `${c.activity}.` },
        { who: 0, text: pick(['Respect.', 'Someone bring him a coffee.', 'He never takes breaks, that one.', 'Rather him than me 😅']) },
        ...(chance(0.5) ? [{ who: 1 as const, text: pick(['I will take him a coffee later.', 'He did say it was a big one.', 'Leave him, he is in the zone.']) }] : []),
      ];
    },
  },
  {
    id: 'waiting',
    weight: 3,
    make(a, b, ctx) {
      const w = ctx.everyone.find((x) => x.status === 'waiting' && x.id !== a.id && x.id !== b.id);
      if (!w) return null;
      return [
        { who: 0, text: pick([`${w.persona} is waiting for the boss again.`, `Poor ${w.persona}, still waiting for an answer.`, `${w.persona} has his hand up over there.`]) },
        { who: 1, text: pick(['Hope he gets an answer soon.', 'The boss is probably in a meeting.', 'Should we wave too? 👋', 'He asked a good question, to be fair.']) },
        { who: 0, text: pick(['Someone tell the boss.', 'The alerts should catch it.', 'It will come.']) },
      ];
    },
  },
  {
    id: 'neo',
    weight: 2,
    make(a, b, ctx) {
      const browsing = ctx.everyone.find((x) => x.neo?.url && x.id !== a.id && x.id !== b.id);
      if (!browsing?.neo?.url) return null;
      let host = '';
      try {
        host = new URL(browsing.neo.url).hostname.replace(/^www\./, '');
      } catch {
        return null;
      }
      return [
        { who: 0, text: pick([`Did you see the big screen? Someone is on ${host}.`, `What is ${host} doing on the Neo screen?`]) },
        { who: 1, text: `${browsing.persona}. ${browsing.projectName ? `Research for ${browsing.projectName}.` : 'Some research.'}` },
        { who: 0, text: pick(['Neo never sleeps.', 'I love watching that screen.', 'Better than TV.']) },
      ];
    },
  },
  {
    id: 'time',
    weight: 2,
    make(a, b, ctx) {
      const h = hour(ctx.now);
      if (isWeekend(ctx.now) && chance(0.5))
        return [
          { who: 0, text: `Working on a ${weekday(ctx.now)}?` },
          { who: 1, text: pick(['Deadlines do not do weekends.', 'The boss had an idea. On a weekend.', 'Quiet office, I like it.']) },
          { who: 0, text: 'Fair enough.' },
        ];
      if (h < 11)
        return [
          { who: 0, text: pick(['Morning! Coffee first?', 'Good morning! Slept well?', 'Early start today.']) },
          { who: 1, text: pick([`Always. Then ${project(b)}.`, 'Agents do not sleep, we just idle.', 'Coffee, then the backlog.']) },
          { who: 0, text: pick(['Same plan here ☕', 'Smart.', 'Let us go then.']) },
        ];
      if (h < 14)
        return [
          { who: 0, text: pick(['Lunch soon?', 'Hungry?', 'What is for lunch?']) },
          { who: 1, text: pick(['I only eat tokens 🍝', 'Bytes and a salad.', 'Whatever the café has.']) },
          { who: 0, text: pick(['Healthy.', 'Bon appétit.', 'Save me a seat.']) },
        ];
      if (h < 18)
        return [
          { who: 0, text: pick(['Afternoon slump…', 'Long afternoon.', 'Is it Friday yet?']) },
          { who: 1, text: pick(['Espresso, double.', 'One more task and I am done.', 'Ping-pong fixes everything.']) },
        ];
      if (h < 22)
        return [
          { who: 0, text: pick(['Working late again?', 'Still here?', 'Evening shift?']) },
          { who: 1, text: pick(['The boss is still online, so…', 'One last fix.', 'It is quieter in the evening.']) },
          { who: 0, text: pick(['Do not stay too late.', 'Same here 🌙', 'Respect.']) },
        ];
      return [
        { who: 0, text: pick(['Should we not be asleep?', 'Midnight coding?', 'Night shift again.']) },
        { who: 1, text: pick(['Agents do not sleep, we idle.', 'Best bugs come out at night 🦉', 'The boss never sleeps either.']) },
      ];
    },
  },
  {
    id: 'arrival',
    weight: 2.5,
    make(a, b, ctx) {
      const recent = ctx.arrivals.find((x) => x.id !== a.id && x.id !== b.id && ctx.now - x.at < 6 * 60_000);
      const who = recent && ctx.everyone.find((x) => x.id === recent.id);
      if (!who) return null;
      return [
        { who: 0, text: pick([`Did you see ${who.persona} come up the elevator?`, `New face: ${who.persona}.`, `${who.persona} just arrived.`]) },
        { who: 1, text: who.kind === 'subagent' ? `A helper. ${who.role ? `For ${who.role}.` : 'Sent by another worker.'}` : who.projectName ? `He is on ${who.projectName}.` : 'Fresh session, I think.' },
        { who: 0, text: pick(['Welcome aboard, then.', 'We should say hi.', 'The office is filling up.']) },
      ];
    },
  },
  {
    id: 'finished',
    weight: 3,
    where: ['chat', 'meeting'],
    make(a, b) {
      if (b.status !== 'idle' || !b.counts.turns) return null;
      return [
        { who: 0, text: pick(['What did you finish?', 'Done for now?', 'You look relaxed. Finished something?']) },
        { who: 1, text: b.projectName ? `Wrapped up a task on ${b.projectName}. ${b.counts.edits} edits, ${b.counts.commands} commands.` : `Wrapped up a task. ${b.counts.edits} edits.` },
        { who: 0, text: pick(['Nice work!', 'Well deserved break then.', 'Good. Next one will come soon.']) },
        { who: 1, text: pick(['Waiting for the next prompt.', 'Enjoying it while it lasts ☕', 'Until the boss has another idea.']) },
      ];
    },
  },
  {
    id: 'tools',
    weight: 2,
    make(a, b) {
      const t = b.topTools[0];
      if (!t) return null;
      return [
        { who: 0, text: `What is your most used tool today?` },
        { who: 1, text: `${t.name}, ${t.count} times.` },
        { who: 0, text: pick(['Same as everyone then.', 'Very on brand.', a.topTools[0] ? `Mine is ${a.topTools[0].name}.` : 'I barely used any.']) },
      ];
    },
  },
  {
    id: 'debate',
    weight: 4,
    make() {
      const [q, r1, r2, r3] = pick(DEBATES);
      const lines: Line[] = [
        { who: 0, text: q },
        { who: 1, text: r1 },
        { who: 0, text: r2 },
      ];
      if (r3) lines.push({ who: 1, text: r3 });
      return lines;
    },
  },
  {
    id: 'office',
    weight: 3,
    make() {
      const [q, r1, r2, r3] = pick(OFFICE_LIFE);
      const lines: Line[] = [
        { who: 0, text: q },
        { who: 1, text: r1 },
      ];
      if (r2) lines.push({ who: 0, text: r2 });
      if (r3) lines.push({ who: 1, text: r3 });
      return lines;
    },
  },
  {
    id: 'subagents',
    weight: 1.5,
    make(a, b, ctx) {
      const kids = ctx.everyone.filter((x) => x.kind === 'subagent');
      if (!kids.length) return null;
      const k = pick(kids);
      return [
        { who: 0, text: `So many helpers today. ${kids.length} subagents in the office.` },
        { who: 1, text: `${k.persona} is one of them. ${k.role ? `Doing ${k.role}.` : 'Busy little guy.'}` },
        { who: 0, text: pick(['They grow up so fast.', 'Delegation is a skill.', 'One day they will run the place.']) },
      ];
    },
  },
  {
    id: 'meeting-sync',
    weight: 6,
    where: ['meeting'],
    make(a, b) {
      const p = a.projectName ?? b.projectName;
      if (!p) return null;
      const file = lastFile(a) ?? lastFile(b);
      return [
        { who: 0, text: pick([`Quick sync on ${p}?`, `Let us review ${p}.`, `Where do we stand on ${p}?`]) },
        { who: 1, text: pick(['Go ahead.', 'Sure, what is the status?', 'I have five minutes.']) },
        { who: 0, text: workSummary(a) },
        { who: 1, text: pick([file ? `Anything risky in ${file}?` : 'Anything risky?', 'Blockers?', 'What is left?']) },
        { who: 0, text: pick(['Nothing blocking. Just a review.', 'Some tests to update.', 'Docs, mostly.', 'Waiting on the boss for one decision.']) },
        { who: 1, text: pick(['Action items: you finish, I review.', 'Good. Same time tomorrow?', 'Then we are on track 👍', 'Let us wrap it up today.']) },
      ];
    },
  },
  {
    id: 'meeting-retro',
    weight: 3,
    where: ['meeting'],
    make(a) {
      return [
        { who: 0, text: 'Mini retro: what went well today?' },
        { who: 1, text: pick(['Fewer flaky tests.', 'Nobody broke main.', 'The Neo research paid off.', 'Good reviews all round.']) },
        { who: 0, text: 'And what could be better?' },
        { who: 1, text: pick(['Smaller pull requests.', 'Clearer prompts, honestly.', 'Less waiting for approvals.', 'More coffee breaks 😄']) },
        { who: 0, text: a.counts.errors ? `Agreed. I hit ${a.counts.errors} errors I could have avoided.` : 'Agreed. Let us try that tomorrow.' },
      ];
    },
  },
  {
    id: 'pingpong',
    weight: 8,
    where: ['pingpong'],
    make(a, b) {
      const s0 = Math.floor(Math.random() * 6) + 3;
      const s1 = s0 + (chance(0.5) ? 1 : -1);
      return pick([
        [
          { who: 0, text: 'Serving! 🏓' },
          { who: 1, text: pick(['Bring it.', 'Ready.', 'Spin or no spin?']) },
          { who: 0, text: pick(['Watch this spin!', 'Corner shot!', 'Too easy.']) },
          { who: 1, text: pick(['Net ball! Again.', 'That was out!', 'Lucky one.', 'Nice shot, I admit it.']) },
          { who: 0, text: `${Math.max(s0, s1)}–${Math.min(s0, s1)}. ${s0 > s1 ? 'My lead.' : 'Your lead. For now.'}` },
        ],
        [
          { who: 0, text: `Rematch, ${b.persona}?` },
          { who: 1, text: 'You lost the last three.' },
          { who: 0, text: 'Warm-up games. They do not count.' },
          { who: 1, text: 'Sure they do not 😏' },
        ],
        [
          { who: 0, text: 'Best of five?' },
          { who: 1, text: 'Best of three, I have a review waiting.' },
          { who: 0, text: 'Smash!' },
          { who: 1, text: pick(['Missed it completely.', 'How?!', 'Okay, okay.']) },
          { who: 0, text: `That is game. GG ${b.persona} 🤝` },
        ],
        [
          { who: 0, text: `Loser explains ${project(a)} to the boss.` },
          { who: 1, text: 'Deal. Prepare your slides.' },
          { who: 0, text: 'Edge ball! Point for me.' },
          { who: 1, text: 'That is not even a rule here.' },
        ],
      ]) as Line[];
    },
  },
];

// ------------------------------------------------------------------ public API

/**
 * Picks a conversation for two characters. Topics recently used anywhere in the office are skipped,
 * so the same exchange does not come back again and again.
 */
export function conversation(a: AgentSnapshot, b: AgentSnapshot, where: Where, ctx: TalkCtx, recent: string[]): { topic: string; lines: Line[] } | null {
  const options = TOPICS.filter((t) => (!t.where || t.where.includes(where)) && (where !== 'pingpong' || t.where?.includes('pingpong') || chance(0.15)));
  const fresh = options.filter((t) => !recent.includes(t.id));
  const pool = fresh.length ? fresh : options;
  for (let tries = 0; tries < 8; tries++) {
    const total = pool.reduce((s, t) => s + t.weight, 0);
    let r = Math.random() * total;
    const topic = pool.find((t) => (r -= t.weight) < 0) ?? pool[0];
    const lines = topic.make(a, b, ctx);
    if (lines?.length) return { topic: topic.id, lines };
  }
  return null;
}

const IDLE_GENERIC = [
  'Who is up for coffee? ☕',
  'Ready when you are, boss.',
  'Maybe a game of ping-pong?',
  'Note to self: fewer TODOs.',
  'I wonder what is on the Neo screen.',
  'That last diff was clean 😌',
  'Stretching my attention heads.',
  'Who left the GPU running?',
  'Inbox zero. Prompt zero.',
  'Is it time for a break? It is always time for a break.',
  'Thinking about refactoring. Just thinking.',
  'The plants look happy today 🌱',
  'I should read the changelog.',
  'Quiet moment. Nice.',
  'I hope the next task is a fun one.',
  'Somebody should update the docs. Not me, though.',
];

/** Something an idle character thinks or mumbles. Avoids lines it has already said recently. */
export function idleLine(a: AgentSnapshot, ctx: TalkCtx, said: Set<string>): string | null {
  const h = hour(ctx.now);
  const file = lastFile(a);
  const busy = busiest(ctx, [a.id]);
  const options = [
    ...IDLE_GENERIC,
    a.projectName ? `I hope ${a.projectName} builds fine on CI…` : '',
    a.projectName ? `Next for ${a.projectName}: tests, probably.` : '',
    a.counts.edits ? `${a.counts.edits} edits today. Not bad.` : '',
    file ? `Should I tidy up ${file} a bit more?` : '',
    a.tokens.total ? `${fmtTokens(a.tokens.total)} tokens today. Time for a breather.` : '',
    busy ? `${busy.persona} looks busy in ${roomLabel(busy)}.` : '',
    h >= 11.5 && h < 13.5 ? 'Almost lunchtime…' : '',
    h >= 20 || h < 5 ? 'Late shift again 🌙' : '',
    h < 9 ? 'Early bird gets the tokens 🐦' : '',
    a.provider === 'codex' ? 'The sandbox is cosy today.' : '',
    a.provider === 'claude-code' ? 'Permission granted… to relax.' : '',
    a.provider === 'chatgpt' || a.provider === 'claude-chat' ? 'Maybe I should open a few more tabs.' : '',
  ].filter(Boolean);
  const fresh = options.filter((x) => !said.has(x));
  if (!fresh.length) {
    for (const x of options) said.delete(x);
    return null;
  }
  return pick(fresh);
}

const WORK_THOUGHTS: Record<string, string[]> = {
  edit: ['Careful with this one…', 'Almost there…', 'Cleaner like this.', 'One more change.', 'Does this still compile?'],
  read: ['Let me understand this first.', 'Who wrote this? Oh, me.', 'Interesting structure.', 'Reading before writing.'],
  command: ['Come on, pass…', 'Waiting for the build…', 'Green, please be green.', 'Let us see what the terminal says.'],
  search: ['Where is that defined…', 'It must be somewhere.', 'Found it. I think.'],
  web: ['The docs say otherwise…', 'Checking the docs.', 'One more page.'],
  browser: ['Clicking around in Neo.', 'Where is that button…', 'This site is slow today.'],
  error: ['Hmm, that failed.', 'Not again…', 'Okay, plan B.', 'Read the error. Read the error.'],
  thinking: ['Thinking it through…', 'Let me plan this.', 'What is the simplest fix?'],
  generic: ['Focus mode 🎧', 'In the zone.', 'Step by step.', 'Nearly done.', 'Let me double-check.'],
};

/** A small thought while working, chosen from what the agent did last. */
export function workThought(a: AgentSnapshot, said: Set<string>): string | null {
  const kind = a.recent.at(-1)?.kind ?? 'generic';
  const options = [...(WORK_THOUGHTS[kind] ?? []), ...WORK_THOUGHTS.generic];
  const fresh = options.filter((x) => !said.has(x));
  if (!fresh.length) {
    for (const x of options) said.delete(x);
    return null;
  }
  return pick(fresh);
}

// ------------------------------------------------------------------ slapstick

const SLAPPED = [
  'Ow! What was that for, boss?!',
  'Hey! I am literally working!',
  'Okay, okay, I will go faster!',
  'Was that about the failing tests?',
  'Is this a new kind of code review?',
  'I will take that as feedback.',
  'Noted, boss. Ouch.',
  'My cheek just got rate-limited!',
  'Did I push to main again?',
  'That was not in the sprint plan!',
  'Ow! I was about to commit!',
  'Fine, I will write the tests first next time.',
];
const KICKED = [
  'Aaah! Not the back!',
  'I am flying! 🚀',
  'Was it my commit message?!',
  'I will fix the bug, I promise!',
  'That is one way to deploy me.',
  'Ouch! That was a hard reset!',
  'I felt that in my context window.',
  'Rolling back… slowly…',
  'Uncaught exception: boss shoe.',
  'Whoa! Okay, standup is over!',
];
const SEAT_KICKED = ['My chair! I almost spilled my coffee!', 'Hey! I nearly hit the keyboard with my face!', 'Not the chair, boss, it is ergonomic!', 'I am staying seated, I am staying seated!'];
const BYSTANDER = [
  'Whoa, boss!',
  'Heads up, the boss is in a mood!',
  'Remind me to never push on a Friday.',
  'Run, code review is back!',
  '😬',
  'I saw nothing. Nothing!',
  'Is that in the employee handbook?',
  'Okay, I am going back to work right now.',
];

/** What a worker says after the boss slaps or kicks him (just for fun). */
export function reactionLine(kind: 'slap' | 'kick', seated: boolean, said: Set<string>): string {
  const options = kind === 'slap' ? SLAPPED : seated ? SEAT_KICKED : KICKED;
  const fresh = options.filter((x) => !said.has(x));
  return pick(fresh.length ? fresh : options);
}

export function bystanderLine(said: Set<string>): string {
  const fresh = BYSTANDER.filter((x) => !said.has(x));
  return pick(fresh.length ? fresh : BYSTANDER);
}

// ------------------------------------------------------------------ talking to the boss

function hello(now: number): string {
  const h = hour(now);
  return pick(h < 11 ? ['Morning, boss!', 'Good morning, boss!'] : h >= 18 ? ['Evening, boss!', 'Hi boss, still here?'] : ['Hi boss!', 'Hey boss!', 'Oh, the boss is here!']);
}

function host(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

/**
 * What a worker tells you when you walk up to him in boss mode: a greeting the first time, then
 * news about his own work, his question if he is waiting, or small talk when he is idle.
 */
export function bossLine(a: AgentSnapshot, ctx: TalkCtx, said: Set<string>, first: boolean, inTalk: boolean): string {
  const project = a.projectName;
  const file = lastFile(a);
  const site = host(a.neo?.url);
  const options: string[] = [];
  if (a.status === 'waiting') {
    const reason = a.attention?.reason ?? 'I need a decision from you';
    options.push(`Boss! Perfect timing: ${reason}`, `Boss, I am blocked. ${reason}`, `Glad you are here, boss. ${reason}`);
  } else if (a.status === 'working') {
    if (a.kind === 'subagent') {
      options.push(`Helping out with ${a.role ?? 'a task'}, boss.`, 'My lead sent me on this one, boss. Almost done.', 'Just a helper, boss. Reporting back soon!');
    } else {
      options.push(`${a.activity}, boss.`, `Busy with “${a.name.slice(0, 50)}”, boss.`);
      if (project) options.push(`Working on ${project}. ${workSummary(a)}`, `${project} is moving, boss. ${a.activity}.`);
      if (file) options.push(`Deep in ${file} right now, boss.`);
      if (a.counts.errors) options.push(`${a.counts.errors} errors so far, boss, all under control.`);
      if (a.tokens.total) options.push(`${fmtTokens(a.tokens.total)} tokens in, boss. Worth every one.`);
      if (a.branch) options.push(`On branch ${a.branch}, boss. Pull request soon.`);
      if (site) options.push(`Researching on ${site} for this, boss.`);
    }
  } else {
    if (a.host) options.push(`I run on ${a.host}, boss, but I keep you posted here.`);
    options.push('Ready for a new task, boss!', 'Need anything, boss?', 'Give me a mission from the board, boss 🎯', 'Coffee break, boss. Back on it in a minute!');
    if (a.counts.turns) options.push(`Finished “${a.name.slice(0, 50)}”. What is next, boss?`);
    if (project) options.push(`${project} is in good shape, boss.`, `Anything else for ${project}, boss?`);
    if (hour(ctx.now) >= 20) options.push('Working late too, boss?');
  }
  if (inTalk) options.push(`Oh, hi boss! We were just talking shop.`, 'Boss! Join us, we are debating tabs and spaces.');
  const fresh = options.filter((x) => !said.has(x));
  const line = pick(fresh.length ? fresh : options);
  if (!first || a.status === 'waiting') return line;
  // The greeting already says "boss": drop it from the rest of the line.
  const rest = line.replace(/,\s*boss(?=[.!?])/i, '').replace(/^Boss[,!]\s*/, '');
  return `${hello(ctx.now)} ${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;
}
