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
      step: 0,
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
  }

  onUpdate(fn) { this._listeners.push(fn); }
  _emit() { const s = this.getPublicState(); this._listeners.forEach(fn => fn(s)); }
  getPublicState() { return JSON.parse(JSON.stringify({ ...this.state })); }

  start() {
    // Initialize cast
    this.state.cast = defaultCast(this.state.genre, this._rand);
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
}

// Agents
class AuthorAgent {
  constructor(rand) { this.rand = rand; }
  hook(state) {
    const seeds = {
      mystery: 'Ein Rätsel zeichnet sich im Dunst ab',
      fantasy: 'Ein Flüstern alter Magie regt die Luft',
      'sci-fi': 'Ein Sensor pingt – etwas ist jenseits des Protokolls',
      abenteuer: 'Eine wacklige Karte verspricht mehr als Vernunft',
      drama: 'Ein unausgesprochenes Wort lastet im Raum',
    };
    const base = seeds[state.genre] || seeds.mystery;
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
    // Stop offering after ~12 beats to suggest closure
    if (state.step > 12) return [ { title: 'Finale riskieren', intent: { kind: 'progress' } } ];
    const pool = [
      { title: 'Untersuchen', intent: { kind: 'progress' } },
      { title: 'Konfrontieren', intent: { kind: 'reveal' } },
      { title: 'Rückzug', intent: { kind: 'setback' } },
      { title: 'Einen Verbündeten suchen', intent: { kind: 'progress' } },
    ];
    // slight randomization
    return shuffle(pool, this.rand).slice(0, 3);
  }
}

class NarratorAgent {
  constructor(rand) { this.rand = rand; }
  tell(payload, state) {
    if (typeof payload === 'string') return payload;
    if (payload.beat?.kind === 'user') {
      return `Du schlägst vor: "${payload.beat.text}" – das verändert die Stimmung.`;
    }
    const act = payload.act || {};
    const voice = pick([
      'knapp', 'bildhaft', 'nüchtern', 'poetisch'
    ], this.rand);
    let line = '';
    switch (payload.beat?.kind) {
      case 'reveal': line = `${act.subject} erkennt ${act.detail}, ein Vorhang hebt sich.`; break;
      case 'progress': line = `${act.subject} ${act.verb} und gewinnt Boden.`; break;
      case 'setback': line = `${act.subject} ${act.verbNeg} – die Lage kippt.`; break;
      case 'choice': line = `${act.subject} zögert. Möglichkeiten flimmern.`; break;
      default: line = `${act.subject} atmet und lauscht.`;
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
function defaultCast(genre, rand) {
  const names = ['Lina','Aras','Milo','Kira','Jon','Elif'];
  const role = pick(['Ermittler','Botanikerin','Schreiber','Hackerin','Bot','Bote'], rand);
  const protagonist = { name: pick(names, rand), role, traits: pickTraits(rand) };
  return [protagonist];
}

function pickTraits(rand) {
  const t = ['mutig','vorsichtig','neugierig','loyal','stolz','argwöhnisch'];
  return shuffle(t, rand).slice(0, 3);
}

function chooseActionForBeat(beat, state, rand) {
  const hero = state.cast[0] || { name: 'Jemand' };
  const subject = hero.name;
  const verbs = ['spürt eine Spur','folgt dem Echo','notiert Hinweise','studiert Muster'];
  const verbsNeg = ['stolpert','zweifelt','zögert','verliert den Faden'];
  return {
    subject,
    detail: pick(['ein verborgenes Zeichen','eine leise Warnung','eine verdrehte Wahrheit','eine alte Narbe'], rand),
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
