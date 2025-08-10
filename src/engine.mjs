// Lightweight multi-agent story engine (German)
// Roles: Author (plan beats), Protagonist/Characters (choose actions), Narrator (style), Reader (interject)
// No external AI; pure deterministic with seeded randomness from prompt.

function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    // xorshift32
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17; s >>>= 0;
    s ^= s << 5;  s >>>= 0;
    return (s >>> 0) / 0xFFFFFFFF;
  };
}

export class StoryEngine {
  constructor(opts) {
    this.state = {
      language: opts.language || 'de',
      seed: opts.seed || 'Ein Rätsel',
      genre: opts.genre || 'mystery',
      readerMode: opts.readerMode || 'auto',
  mode: opts.mode || 'story', // 'story' | 'meta'
  complexity: opts.complexity || 'normal', // 'short' | 'normal' | 'long'
      step: 0,
  chapter: 1,
  maxChapters: 3,
      log: [],
      choices: [],
      cast: [],
      world: { tension: 0.2, hope: 0.5, threat: 0.2 },
    };
    this._listeners = [];
    this._rand = rng(hashString(`${this.state.seed}|${this.state.genre}`));
    this._author = new AuthorAgent(this._rand);
    this._narrator = new NarratorAgent(this._rand);
    this._reader = new ReaderAgent(this._rand);
    this._onEnd = opts.onEnd || null;
    // apply boosts (carryover)
    const boosts = opts.boosts || {};
    this.state.world.hope = clamp01(this.state.world.hope + (boosts.startHope||0));
    this.state.world.tension = clamp01(this.state.world.tension + (boosts.startTension||0));
    this.state.world.threat = clamp01(this.state.world.threat + (boosts.startThreat||0));
  }

  onUpdate(fn) { this._listeners.push(fn); }
  _emit() { const s = this.getPublicState(); this._listeners.forEach(fn => fn(s)); }
  getPublicState() { return JSON.parse(JSON.stringify({ ...this.state })); }

  start() {
    // Initialize cast
    this.state.cast = defaultCast(this.state.genre, this._rand, this.state.complexity);
    const hook = this._author.hook(this.state);
    this.state.log.push(this._narrator.tell(hook, this.state));
    this.state.choices = this._author.offerChoices(this.state);
    this._maybeReaderInterject('start');
    this._emit();
  }

  next(input) {
    if (!input) return;
    if (input.type === 'choice') {
      const c = this.state.choices[input.index];
      if (!c) return;
      this._advance(c.intent, c.target);
    } else if (input.type === 'free') {
      this._advance({ kind: 'user', text: input.text });
    }
  }

  _advance(intent, target) {
    // Chapter transition
    const beatsPerChapter = this._beatsPerChapter();
    if (this.state.step >= beatsPerChapter) {
      const summary = this._author.chapterSummary(this.state);
      this.state.log.push(this._narrator.tell({ type: 'chapterEnd', summary }, this.state));
      this.state.chapter += 1;
      this.state.step = 0;
      // escalate stakes lightly between chapters
      this.state.world.threat += 0.05; this.state.world.tension += 0.03; clampWorld(this.state.world);
      if (this.state.chapter > this.state.maxChapters) {
        this._finishRun('overlimit');
        return;
      }
      // New chapter hook
      const hook = this._author.hook(this.state);
      this.state.log.push(this._narrator.tell({ type: 'chapterStart', hook }, this.state));
    }

    const beat = this._author.nextBeat(this.state, intent, target);
  const act = chooseActionForBeat(beat, this.state, this._rand);
    const line = this._narrator.tell({ beat, act }, this.state);
    this.state.log.push(line);

    // world state tweaks
    if (beat.kind === 'reveal') this.state.world.tension += 0.05;
    if (beat.kind === 'setback') { this.state.world.hope -= 0.05; this.state.world.threat += 0.05; }
    if (beat.kind === 'progress') { this.state.world.hope += 0.05; this.state.world.tension -= 0.02; }
    clampWorld(this.state.world);

    this.state.step += 1;
    if (beat?.final) {
      this._finishRun('epilog');
      return;
    }
    this.state.choices = this._author.offerChoices(this.state);
    this._maybeReaderInterject('advance');
    this._emit();
  }

  _maybeReaderInterject(phase) {
    const mode = this.state.readerMode;
    if (mode === 'off') return; // keine Interjektionen
    const r = this._rand();
    // Interjektion, wenn r < threshold
    const threshold = mode === 'on' ? 0.7 : 0.03; // on: häufig (~70%), auto: selten (~3%)
    if (r < threshold) {
      const msg = this._reader.comment(this.state, phase);
      this.state.log.push(`[Leser] ${msg}`);
    }
  }

  save() {
  return { ...this.state };
  }

  load(saved) {
    if (!saved) return;
    this.state = { ...saved };
    // Recreate services
    this._rand = rng(hashString(`${this.state.seed}|${this.state.genre}`));
    this._author = new AuthorAgent(this._rand);
    this._narrator = new NarratorAgent(this._rand);
    this._reader = new ReaderAgent(this._rand);
    this._emit();
  }

  _beatsPerChapter() {
    const map = { short: 6, normal: 10, long: 14 };
    return map[this.state.complexity] || 10;
  }

  _finishRun(reason) {
    // Compute score/achievements based on world and duration
    const s = this.state;
    const balance = Math.round((s.world.hope * 100) - (s.world.threat * 50) - (s.world.tension * 30));
    const chapters = s.chapter - 1 + (s.step > 0 ? 1 : 0);
    const score = clampToRange(balance + chapters * 5, 0, 100);
    const achievements = [];
    if (s.world.hope > 0.7) achievements.push('BeaconOfHope');
    if (s.world.threat < 0.15) achievements.push('TamedTheStorm');
    if (chapters >= s.maxChapters) achievements.push('LongJourney');
    const relic = pick(['Seher-Scherbe','Kernfragment','Alte Karte','Build-Talisman'], this._rand);
    const ending = reason === 'epilog' ? 'Epilog' : 'Ausklang';
    const result = {
      seed: s.seed,
      genre: s.genre,
      mode: s.mode,
      score,
      achievements,
      relic,
      ending,
      chapters,
      cast: s.cast.map(c => c.name),
    };
    this.state.log.push(this._narrator.tell({ type: 'runEnd', result }, this.state));
    this.state.choices = [];
    this._emit();
    if (this._onEnd) this._onEnd(result);
  }
}

// Agents
class AuthorAgent {
  constructor(rand) { this.rand = rand; }
  hook(state) {
    const seedsStory = {
      mystery: 'Ein Rätsel zeichnet sich im Dunst ab',
      fantasy: 'Ein Flüstern alter Magie regt die Luft',
      'sci-fi': 'Ein Sensor pingt – etwas ist jenseits des Protokolls',
      abenteuer: 'Eine wacklige Karte verspricht mehr als Vernunft',
      drama: 'Ein unausgesprochenes Wort lastet im Raum',
    };
    const seedsMeta = {
      mystery: 'Die Website verbirgt ein Pfad-Rätsel',
      fantasy: 'Der Code haucht alten Mustern Leben ein',
      'sci-fi': 'Ein Build-Check überschreitet bekannte Protokolle',
      abenteuer: 'Ein Prototyp verspricht mehr als Spezifikationen',
      drama: 'Ein diff schwebt unausgesprochen im PR',
    };
    const dict = state.mode === 'meta' ? seedsMeta : seedsStory;
    const base = dict[state.genre] || dict.mystery;
    return `${base}. Ausgangspunkt: ${state.seed}.`;
  }
  nextBeat(state, intent, target) {
    if (intent?.kind === 'user') return { kind: 'user', text: intent.text, target };
    const r = this.rand();
    const opts = ['reveal','progress','setback','choice'];
    const kind = opts[Math.floor(r*opts.length)];
    return { kind, target };
  }
  offerChoices(state) {
    // Finale anbieten, wenn letztes Kapitel überschritten ist
    if (state.chapter > state.maxChapters) {
      return [ { title: 'Epilog', intent: { kind: 'progress', final: true }, effects: { hope:+0.1, threat:-0.05, tension:-0.1 }, risk: 'niedrig' } ];
    }
    const pool = [
      { title: labelByMode(state, 'Untersuchen', 'Debuggen'), intent: { kind: 'progress' } },
      { title: labelByMode(state, 'Konfrontieren', 'Refactor erzwingen'), intent: { kind: 'reveal' } },
      { title: labelByMode(state, 'Rückzug', 'Rollback'), intent: { kind: 'setback' } },
      { title: labelByMode(state, 'Verbündeten suchen', 'Review einholen'), intent: { kind: 'progress' } },
    ];
    const choices = shuffle(pool, this.rand).slice(0, 3).map(c => {
      const effects = computeEffects(c.intent);
      const risk = riskLabel(effects);
      return { ...c, effects, risk };
    });
    return choices;
  }

  chapterSummary(state) {
    const who = state.cast[0]?.name || 'Jemand';
    if (state.mode === 'meta') {
      return `Kapitel ${state.chapter} endet: ${who} konsolidiert Commits; die Architektur atmet.`;
    }
    return `Kapitel ${state.chapter} endet: ${who} hält inne, Muster verdichten sich.`;
  }
}

class NarratorAgent {
  constructor(rand) { this.rand = rand; }
  tell(payload, state) {
    if (typeof payload === 'string') return payload;
    if (payload.type === 'chapterEnd') {
      return state.mode === 'meta' ? `— ${payload.summary} —` : `— ${payload.summary} —`;
    }
    if (payload.type === 'chapterStart') {
      return state.mode === 'meta' ? `Sprintbeginn: ${payload.hook}` : `Neues Kapitel: ${payload.hook}`;
    }
    if (payload.type === 'runEnd') {
      const r = payload.result;
      return `Abschluss (${r.ending}): Score ${r.score} · Errungenschaften ${r.achievements.join(', ') || '–'} · Relikt ${r.relic}.`;
    }
    if (payload.beat?.kind === 'user') {
      return state.mode === 'meta'
        ? `Du entscheidest: "${payload.beat.text}" – der Release-Plan verschiebt sich.`
        : `Du schlägst vor: "${payload.beat.text}" – das verändert die Stimmung.`;
    }
    const act = payload.act || {};
    const voice = pick([
      'knapp', 'bildhaft', 'nüchtern', 'poetisch'
    ], this.rand);
    let line = '';
    if (state.mode === 'meta') {
      switch (payload.beat?.kind) {
        case 'reveal': line = `${act.subject} erkennt ${act.detail} im Code – ein versteckter Pfad.`; break;
        case 'progress': line = `${act.subject} ${act.verb} – die Pipeline wird grüner.`; break;
        case 'setback': line = `${act.subject} ${act.verbNeg} – Tests kippen.`; break;
        case 'choice': line = `${act.subject} wägt Architekturentscheidungen ab.`; break;
        default: line = `${act.subject} checkt Logs und atmet.`;
      }
    } else {
      switch (payload.beat?.kind) {
        case 'reveal': line = `${act.subject} erkennt ${act.detail}, ein Vorhang hebt sich.`; break;
        case 'progress': line = `${act.subject} ${act.verb} und gewinnt Boden.`; break;
        case 'setback': line = `${act.subject} ${act.verbNeg} – die Lage kippt.`; break;
        case 'choice': line = `${act.subject} zögert. Möglichkeiten flimmern.`; break;
        default: line = `${act.subject} atmet und lauscht.`;
      }
    }
    if (voice === 'bildhaft') line += ' Die Nacht riecht nach Metall und Versprechen.';
    if (voice === 'poetisch') line += ' Ein Satz wie ein Funke über dunklem Wasser.';
    return line;
  }
}

class ReaderAgent {
  constructor(rand) { this.rand = rand; }
  comment(state, phase) {
    const reactions = [
      'Was, wenn es gar kein Zufall ist?',
      'Kann man dem trauen?',
      'Ich würde niemals allein dorthin gehen…',
      'Das fühlt sich nach einem Fehler an.',
      'Mutig – oder töricht?'
    ];
    return pick(reactions, this.rand);
  }
}

// Helpers
function defaultCast(genre, rand, complexity) {
  const names = ['Lina','Aras','Milo','Kira','Jon','Elif','Rafi','Noa','Zara','Ivo'];
  const rolesByGenre = {
    mystery: ['Ermittler','Archivarin','Journalist','Zeugin','Analyst'],
    fantasy: ['Magierin','Hüter','Bardin','Kundschafter','Alchimist'],
    'sci-fi': ['Navigatorin','Ingenieur','Bot','Pilotin','Linguist'],
    abenteuer: ['Kartographin','Späher','Kapitän','Forscherin','Bote'],
    drama: ['Schriftsteller','Regisseurin','Schauspieler','Mentorin','Kritikerin']
  };
  const baseRoles = rolesByGenre[genre] || rolesByGenre.mystery;
  const size = complexity === 'long' ? 3 : complexity === 'short' ? 1 : 2;
  const cast = [];
  for (let i=0;i<Math.max(1,size);i++) {
    cast.push({ name: pick(names, rand), role: pick(baseRoles, rand), traits: pickTraits(rand) });
  }
  return cast;
}

function pickTraits(rand) {
  const t = ['mutig','vorsichtig','neugierig','loyal','stolz','argwöhnisch'];
  return shuffle(t, rand).slice(0, 3);
}

function chooseActionForBeat(beat, state, rand) {
  const hero = state.cast[Math.floor(rand()*state.cast.length)] || state.cast[0] || { name: 'Jemand' };
  const subject = hero.name;
  const verbs = state.mode === 'meta'
    ? ['schließt Tickets','sichtet Logs','ordnet Commits','strafft Module']
    : ['spürt eine Spur','folgt dem Echo','notiert Hinweise','studiert Muster'];
  const verbsNeg = state.mode === 'meta'
    ? ['verheddert sich','zweifelt am Ansatz','zögert','verliert Kontext']
    : ['stolpert','zweifelt','zögert','verliert den Faden'];
  return {
    subject,
    detail: pick(state.mode === 'meta'
      ? ['einen schleichenden Leak','eine silent regression','eine wacklige Abhängigkeit','eine Schatten-Konfiguration']
      : ['ein verborgenes Zeichen','eine leise Warnung','eine verdrehte Wahrheit','eine alte Narbe'], rand),
    verb: pick(verbs, rand),
    verbNeg: pick(verbsNeg, rand),
  };
}

function pick(arr, rand) { return arr[Math.floor(rand()*arr.length)] }
function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function clampWorld(w) {
  w.tension = Math.max(0, Math.min(1, w.tension));
  w.hope = Math.max(0, Math.min(1, w.hope));
  w.threat = Math.max(0, Math.min(1, w.threat));
}
function clamp01(x){ return Math.max(0, Math.min(1, x)); }
function clampToRange(x, lo, hi){ return Math.max(lo, Math.min(hi, x)); }

function computeEffects(intent) {
  switch (intent?.kind) {
    case 'progress': return { hope: +0.06, tension: -0.02, threat: -0.01 };
    case 'reveal': return { hope: +0.01, tension: +0.05, threat: +0.02 };
    case 'setback': return { hope: -0.05, tension: +0.03, threat: +0.04 };
    default: return { };
  }
}

function riskLabel(eff) {
  const score = (eff.threat||0) + (eff.tension||0) - (eff.hope||0);
  if (score > 0.06) return 'hoch';
  if (score < -0.02) return 'niedrig';
  return 'mittel';
}

function labelByMode(state, story, meta) {
  return state.mode === 'meta' ? meta : story;
}
