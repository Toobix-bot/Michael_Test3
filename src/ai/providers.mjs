// Simple AI-Lab provider scaffold (no external calls by default)
// Interface:
// - suggest(state, choices) => { index, rationale } | null
// - rewrite(line, ctx) => string | null

export function getProvider(name = 'none', opts = {}) {
  switch ((name||'none').toLowerCase()) {
    case 'mock': return new MockProvider(opts);
    default: return new NoopProvider();
  }
}

class NoopProvider {
  name = 'none';
  suggest() { return null; }
  rewrite(line) { return null; }
}

class MockProvider {
  constructor(opts) { this.name = 'mock'; }
  suggest(state, choices) {
    if (!choices || choices.length === 0) return null;
    // heuristic: prefer choices with highest hope - threat, tie-break by low tension
    let best = -Infinity, idx = 0;
    for (let i=0;i<choices.length;i++) {
      const c = choices[i];
      const e = c.effects || {};
      const score = (e.hope||0) - (e.threat||0) - 0.2*(e.tension||0);
      if (score > best) { best = score; idx = i; }
    }
    return { index: idx, rationale: 'Mock: Hoffnung hoch, Gefahr niedrig, Spannung moderat.' };
  }
  rewrite(line, ctx) {
    if (!line) return null;
    // add a tiny flourish sometimes
    if (String(line).length < 12) return null;
    return line + ' (Ein kaum hörbares Knistern liegt in der Luft.)';
  }
}

// To add a real provider (external or local), implement the same methods and return it in getProvider().
