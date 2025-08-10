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
  freedom: 0.4,
  accentTallies: { insight: 0, bold: 0, caution: 0, momentum: 0, empathy: 0 },
  history: { verbs: [], details: [], voices: [], beatKinds: [], subjects: [] },
  lastActorIndex: -1,
  intentCounts: { progress: 0, reveal: 0, setback: 0 },
    };
    this._listeners = [];
    this._rand = rng(hashString(`${this.state.seed}|${this.state.genre}`));
    this._author = new AuthorAgent(this._rand);
    this._narrator = new NarratorAgent(this._rand);
    this._reader = new ReaderAgent(this._rand);
  this._onEnd = opts.onEnd || null;
  this._freedom = typeof opts.freedom === 'number' ? Math.max(0, Math.min(1, opts.freedom)) : 0.4;
  this.state.freedom = this._freedom;
  this._explain = !!opts.explain;
  this._aiProfile = opts.aiProfile || 'balanced'; // 'balanced' | 'defensive' | 'aggressive'
  this._peaceful = !!opts.peaceful;
  this._startRelic = opts.startRelic || '';
  this._startCastPref = opts.startCastPref || '';
  this._stylePref = opts.stylePref || null;
  this._policy = opts.policy || null; // { intents: { progress, reveal, setback } }
  // surface mode flags into state for agents that only get state
  this.state.peaceful = this._peaceful;
  // apply boosts (carryover)
    const boosts = opts.boosts || {};
    this.state.world.hope = clamp01(this.state.world.hope + (boosts.startHope||0));
    this.state.world.tension = clamp01(this.state.world.tension + (boosts.startTension||0));
    this.state.world.threat = clamp01(this.state.world.threat + (boosts.startThreat||0));
    if (this._peaceful) {
      // nudge start world to calmer state
      this.state.world.hope = clamp01(this.state.world.hope + 0.05);
      this.state.world.tension = clamp01(this.state.world.tension - 0.04);
      this.state.world.threat = clamp01(this.state.world.threat - 0.03);
    }
    // seed accent tallies from style preferences (learned persona)
    if (this._stylePref?.accents) {
      for (const k of Object.keys(this._stylePref.accents)) {
        const v = Number(this._stylePref.accents[k]||0);
        if (!isNaN(v) && k in this.state.accentTallies) this.state.accentTallies[k] += Math.max(0, Math.min(5, v));
      }
    }
  }

  onUpdate(fn) { this._listeners.push(fn); }
  _emit() { const s = this.getPublicState(); this._listeners.forEach(fn => fn(s)); }
  getPublicState() { return JSON.parse(JSON.stringify({ ...this.state })); }

  start() {
    // Initialize cast
    this.state.cast = defaultCast(this.state.genre, this._rand, this.state.complexity);
    // apply carryover start options
    if (this._startCastPref) {
      const i = this.state.cast.findIndex(c => (c.name||'').toLowerCase() === this._startCastPref.toLowerCase());
      if (i > 0) { const [c] = this.state.cast.splice(i,1); this.state.cast.unshift(c); }
    }
    const hook = this._author.hook(this.state);
    if (this._startRelic) {
      this.state.log.push(`[Relikt] Du startest mit: ${this._startRelic}.`);
      // small thematic world nudge based on relic keyword
      const k = this._startRelic.toLowerCase();
      if (k.includes('seher') || k.includes('karte')) this.state.world.hope += 0.03;
      if (k.includes('kern') || k.includes('talisman')) this.state.world.tension -= 0.02;
      if (k.includes('archiv') || k.includes('klammer')) this.state.world.threat -= 0.02;
      clampWorld(this.state.world);
    }
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
      this._advance(c.intent, c.target, { selected: c });
    } else if (input.type === 'free') {
  const mapped = parseFreeIntent(input.text, this.state);
  if (mapped) this._advance(mapped.intent, mapped.target, { source: 'free', raw: input.text });
  else this._advance({ kind: 'user', text: input.text });
    }
  }

  _advance(intent, target, meta) {
    // Chapter transition
    const beatsPerChapter = this._beatsPerChapter();
  if (this.state.step >= beatsPerChapter) {
      const summary = this._author.chapterSummary(this.state);
      this.state.log.push(this._narrator.tell({ type: 'chapterEnd', summary }, this.state));
      this.state.chapter += 1;
      this.state.step = 0;
  // escalate stakes between chapters; in peaceful mode, reduce escalation
  const escThr = this._peaceful ? 0.02 : 0.05;
  const escTen = this._peaceful ? 0.01 : 0.03;
  this.state.world.threat += escThr; this.state.world.tension += escTen; clampWorld(this.state.world);
      if (this.state.chapter > this.state.maxChapters) {
        this._finishRun('overlimit');
        return;
      }
      // New chapter hook
      const hook = this._author.hook(this.state);
      this.state.log.push(this._narrator.tell({ type: 'chapterStart', hook }, this.state));
    }

  const before = { ...this.state.world };
  const beat = this._author.nextBeat(this.state, intent, target);
  const act = chooseActionForBeat(beat, this.state, this._rand);
    const line = this._narrator.tell({ beat, act }, this.state);
    this.state.log.push(line);

    // world state tweaks
    if (beat.kind === 'reveal') this.state.world.tension += this._peaceful ? 0.03 : 0.05;
    if (beat.kind === 'setback') {
      const k = this._peaceful ? 0.6 : 1.0;
      this.state.world.hope -= 0.05 * k; this.state.world.threat += 0.05 * k;
    }
    if (beat.kind === 'progress') { this.state.world.hope += this._peaceful ? 0.06 : 0.05; this.state.world.tension -= this._peaceful ? 0.03 : 0.02; }
    clampWorld(this.state.world);
    if (meta?.selected?.accents) {
      for (const a of meta.selected.accents) {
        if (a in this.state.accentTallies) this.state.accentTallies[a] += 1;
      }
    }
    if (meta?.selected?.intent?.kind && this.state.intentCounts[meta.selected.intent.kind] !== undefined) {
      this.state.intentCounts[meta.selected.intent.kind] += 1;
    }
    if (this._explain) {
      const dw = deltas(before, this.state.world);
      const explain = explainDelta(dw);
      if (explain) this.state.log.push(explain);
    }

    this.state.step += 1;
    if (beat?.final) {
      this._finishRun('epilog');
      return;
    }
    this.state.choices = this._author.offerChoices(this.state);
    this._maybeReaderInterject('advance');
    this._emit();
  }

  // Provide suggestions set for the next choice (multi-objective, allow ties)
  suggestChoice() {
    const state = this.state;
    if (!state.choices || state.choices.length === 0) return null;
  let targetTension = 0.4 + (this._freedom - 0.5) * 0.1; // slight drift with freedom
  if (this._peaceful) targetTension -= 0.05;
    const weights = (p => {
      switch(p){
        case 'defensive': return { momentum: 2.0, safety: 3.0, tensionFit: 1.2, style: 0.4 };
        case 'aggressive': return { momentum: 3.0, safety: 1.2, tensionFit: 1.5, style: 0.6 };
        default: return { momentum: 2.5, safety: 2.0, tensionFit: 1.0, style: 0.5 };
      }
    })(this._aiProfile);
  const policy = (this._policy && this._policy.intents) ? this._policy.intents : null;
  const scored = state.choices.map((c, idx) => {
      const eff = c.effects || computeEffects(c.intent);
      const hope = eff.hope || 0, tens = eff.tension || 0, thr = eff.threat || 0;
      const predTension = clamp01(state.world.tension + tens);
      // multi-objective: value safety, momentum, and style diversity
      const safety = -thr;
      const momentum = hope - Math.max(0, tens*0.5);
      const tensionFit = -Math.abs(targetTension - predTension);
      const style = styleAffinity(c.accents, this.state.accentTallies);
      let score = weights.momentum*momentum + weights.safety*safety + weights.tensionFit*tensionFit + weights.style*style;
      if (policy && c.intent?.kind && policy[c.intent.kind] != null) {
        const pref = Math.max(0.5, Math.min(2.0, Number(policy[c.intent.kind]) || 1));
        const beta = 0.3; // modest policy influence
        score = score * (1 + beta * (pref - 1));
      }
      const isBad = (thr > 0.06 && hope < 0.02);
      return { idx, score, c, eff, predTension, isBad };
    }).sort((a,b)=>b.score-a.score);
    if (scored.length === 0) return null;
    const best = scored[0].score;
    const eps = 0.15; // near-equal threshold -> mehrere gleich gute Akzente
    const ties = scored.filter(x => !x.isBad && (best - x.score) <= eps);
    const rationale = `Mehrere gleich gute Wege: Balance aus Hoffnung, geringer Gefahr und Spannungsziel bei ${Math.round(targetTension*100)}%.`;
    return { ties: ties.map(t => ({ index: t.idx, title: t.c.title, accents: t.c.accents })), rationale, scored };
  }

  // Insights for UI: forecast and context
  getInsights() {
    const s = this.state;
    const dist = forecastBeatDist(this._freedom, s.world, this._peaceful);
    const suggestion = this.suggestChoice();
    const castTraits = (s.cast||[]).map(x=>({ name: x.name, traits: x.traits }));
    return { distribution: dist, suggestion, castTraits };
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
  if ((s.step + chapters) >= 12) achievements.push('MarathonMind');
  if (this._freedom >= 0.8) achievements.push('WildImprov');
  const relic = pick(['Seher-Scherbe','Kernfragment','Alte Karte','Build-Talisman','Archiv-Klammer','Refactor-Feder'], this._rand);
    const ending = reason === 'epilog' ? 'Epilog' : 'Ausklang';
    const result = {
      seed: s.seed,
      genre: s.genre,
      mode: s.mode,
      score,
  accents: { ...s.accentTallies },
      achievements,
      relic,
      ending,
      chapters,
      cast: s.cast.map(c => c.name),
  intentCounts: { ...s.intentCounts },
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
  noir: 'Ein Radiosummen trägt Gerüchte durch die Nacht',
  horror: 'Etwas atmet zwischen den Wänden – keiner will es hören',
    };
    const seedsMeta = {
      mystery: 'Die Website verbirgt ein Pfad-Rätsel',
      fantasy: 'Der Code haucht alten Mustern Leben ein',
      'sci-fi': 'Ein Build-Check überschreitet bekannte Protokolle',
      abenteuer: 'Ein Prototyp verspricht mehr als Spezifikationen',
  drama: 'Ein diff schwebt unausgesprochen im PR',
  noir: 'Ein Logfile flüstert von nächtlichen Request-Spuren',
  horror: 'Ein Prozess hängt – und zieht alles in die Tiefe',
    };
    const dict = state.mode === 'meta' ? seedsMeta : seedsStory;
    const base = dict[state.genre] || dict.mystery;
    return `${base}. Ausgangspunkt: ${state.seed}.`;
  }
  nextBeat(state, intent, target) {
    if (intent?.kind === 'user') return { kind: 'user', text: intent.text, target };
  const r = this.rand();
  // vary distribution by freedom (mehr Freiheit -> mehr reveal/choice)
  const base = ['reveal','progress','setback','choice'];
  const more = this.rand() < (0.5 * (state?.freedom ?? 0.4)) ? ['reveal','choice'] : [];
    const opts = base.concat(more);
    let kind = opts[Math.floor(r*opts.length)];
    // avoid 3x repeat of same beat kind
    const recent = state.history?.beatKinds || [];
    if (recent.length >= 2 && recent[recent.length-1] === kind && recent[recent.length-2] === kind) {
      kind = base.find(k => k !== kind) || kind;
    }
    pushHistory(state.history.beatKinds, kind, 4);
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
  // With higher freedom, offer 4 choices sometimes
  const count = (state?.freedom ?? 0.4) > 0.6 && this.rand() > 0.5 ? 4 : 3;
    const choices = shuffle(pool, this.rand).slice(0, count).map(c => {
      const effects = computeEffects(c.intent);
      if (state.peaceful) {
        // soften negative effects and threat
        effects.threat = (effects.threat||0) * 0.6;
        effects.tension = (effects.tension||0) * 0.8;
      }
      const risk = riskLabel(effects);
      const accents = classifyAccents(c.intent, effects);
      return { ...c, effects, risk, accents };
    });
    // bias away from pure setback in peaceful mode by reweighting order
    if (state.peaceful) {
      choices.sort((a,b)=>{
        const sa = a.intent?.kind === 'setback' ? 1 : 0;
        const sb = b.intent?.kind === 'setback' ? 1 : 0;
        return sa - sb;
      });
    }
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
  const voice = pickDistinct(['knapp','bildhaft','nüchtern','poetisch','sinngenau','knisternd'], state.history.voices, 3, this.rand);
  pushHistory(state.history.voices, voice, 3);
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
  const names = ['Lina','Aras','Milo','Kira','Jon','Elif','Rafi','Noa','Zara','Ivo','Runa','Tariq','Mara','Naeem','Sora','Tilo'];
  const rolesByGenre = {
    mystery: ['Ermittler','Archivarin','Journalist','Zeugin','Analyst'],
    fantasy: ['Magierin','Hüter','Bardin','Kundschafter','Alchimist'],
    'sci-fi': ['Navigatorin','Ingenieur','Bot','Pilotin','Linguist'],
    abenteuer: ['Kartographin','Späher','Kapitän','Forscherin','Bote'],
  drama: ['Schriftsteller','Regisseurin','Schauspieler','Mentorin','Kritikerin'],
  noir: ['Detektiv','Radiomoderatorin','Informantin','Barkeeper','Stadtplaner'],
  horror: ['Heimleiterin','Bewohner','Priester','Forscher','Hüter der Schlüssel']
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
  // rotate actor to avoid repetition
  if (state.cast.length > 0) {
    state.lastActorIndex = (state.lastActorIndex + 1) % state.cast.length;
  }
  const hero = state.cast[state.lastActorIndex] || state.cast[0] || { name: 'Jemand' };
  const subject = hero.name;
  pushHistory(state.history.subjects, subject, 4);
  const verbs = state.mode === 'meta'
    ? ['schließt Tickets','sichtet Logs','ordnet Commits','strafft Module','stabilisiert Builds','entwirrt Abhängigkeiten','schärft Tests']
    : ['spürt eine Spur','folgt dem Echo','notiert Hinweise','studiert Muster','kartiert die Gassen','entziffert Zeichen','sichert Spuren'];
  const verbsNeg = state.mode === 'meta'
    ? ['verheddert sich','zweifelt am Ansatz','zögert','verliert Kontext','übersieht einen Check','bricht den Build']
    : ['stolpert','zweifelt','zögert','verliert den Faden','irrt umher','verliert die Spur'];
  const details = state.mode === 'meta'
    ? ['einen schleichenden Leak','eine silent regression','eine wacklige Abhängigkeit','eine Schatten-Konfiguration','einen rissigen Contract','eine vergessene Flag']
    : ['ein verborgenes Zeichen','eine leise Warnung','eine verdrehte Wahrheit','eine alte Narbe','ein fehlendes Puzzleteil','eine gedeckte Spur'];
  return {
    subject,
    detail: pickDistinct(details, state.history.details, 4, rand),
    verb: pickDistinct(verbs, state.history.verbs, 4, rand),
    verbNeg: pickDistinct(verbsNeg, state.history.verbs, 4, rand),
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

function deltas(before, after) {
  return {
    hope: +(after.hope - before.hope).toFixed(3),
    tension: +(after.tension - before.tension).toFixed(3),
    threat: +(after.threat - before.threat).toFixed(3)
  };
}

function explainDelta(d) {
  const parts = [];
  if (d.hope) parts.push(`Hoffnung ${d.hope>0?'+':''}${Math.round(d.hope*100)}%`);
  if (d.tension) parts.push(`Spannung ${d.tension>0?'+':''}${Math.round(d.tension*100)}%`);
  if (d.threat) parts.push(`Gefahr ${d.threat>0?'+':''}${Math.round(d.threat*100)}%`);
  if (parts.length === 0) return '';
  return `(Auswirkung: ${parts.join(' · ')})`;
}

function forecastBeatDist(freedom, world, peaceful=false) {
  // very rough forecast used for UI hints
  const base = { reveal: 0.25, progress: 0.35, setback: 0.25, choice: 0.15 };
  const f = freedom||0;
  base.reveal += 0.15*f;
  base.choice += 0.10*f;
  // higher tension nudges toward setbacks, lower toward progress
  base.setback += (world.tension - 0.5) * 0.1;
  base.progress += (0.5 - world.tension) * 0.1;
  // peaceful mode biases away from setbacks and toward progress/choice
  if (peaceful) {
    base.setback -= 0.08;
    base.progress += 0.06;
    base.choice += 0.02;
    base.reveal -= 0.00; // keep neutral
  }
  // normalize
  const sum = Object.values(base).reduce((a,b)=>a+b,0);
  for (const k of Object.keys(base)) base[k] = Math.max(0, base[k]/sum);
  return base;
}

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

function classifyAccents(intent, eff) {
  const a = [];
  if (intent?.kind === 'reveal') a.push('insight');
  if (intent?.kind === 'progress' && (eff.hope||0) > 0.04) a.push('momentum');
  if (intent?.kind === 'setback' && (eff.threat||0) < 0.03) a.push('caution');
  if ((eff.hope||0) > 0.05 && (eff.tension||0) < 0.02) a.push('empathy');
  if (intent?.kind === 'reveal' && (eff.tension||0) > 0.04) a.push('bold');
  return a.length ? a : ['momentum'];
}

function styleAffinity(accents, tallies) {
  if (!accents || accents.length === 0) return 0;
  let score = 0;
  for (const a of accents) score += (tallies[a]||0);
  return Math.log(1 + score);
}

function pushHistory(arr, value, maxLen) {
  if (!Array.isArray(arr)) return;
  arr.push(value);
  if (arr.length > (maxLen||4)) arr.shift();
}

function pickDistinct(arr, historyArr, maxLen, rand) {
  const hist = new Set(historyArr || []);
  const candidates = arr.filter(v => !hist.has(v));
  const pool = candidates.length ? candidates : arr;
  return pool[Math.floor((rand?.()||Math.random()) * pool.length)];
}

function parseFreeIntent(text, state) {
  if (!text) return null;
  const t = String(text).toLowerCase().trim();
  // Slash commands
  if (t.startsWith('/')) {
    if (t.startsWith('/untersuchen') || t.startsWith('/investigate')) return { intent: { kind: 'progress' } };
    if (t.startsWith('/konfrontieren') || t.startsWith('/confront')) return { intent: { kind: 'reveal' } };
    if (t.startsWith('/rückzug') || t.startsWith('/rollback') || t.startsWith('/zurueck')) return { intent: { kind: 'setback' } };
    if (t.startsWith('/verbündeter') || t.startsWith('/verbuendeter') || t.startsWith('/ally')) return { intent: { kind: 'progress' } };
    if (state.mode === 'meta') {
      if (t.startsWith('/refactor')) return { intent: { kind: 'reveal' } };
      if (t.startsWith('/review')) return { intent: { kind: 'progress' } };
    }
  }
  // Verb heuristics
  if (/(untersuchen|prüfen|suchen|analysieren|investigieren)/.test(t)) return { intent: { kind: 'progress' } };
  if (/(konfrontieren|stellen|anreden|enthüllen|zeigen|aufdecken)/.test(t)) return { intent: { kind: 'reveal' } };
  if (/(rückzug|zurückziehen|abwarten|fliehen|verstecken|rollback)/.test(t)) return { intent: { kind: 'setback' } };
  if (/(fragen|befragen|reden|verhandeln|bitten)/.test(t)) return { intent: { kind: 'progress' } };
  return null;
}
