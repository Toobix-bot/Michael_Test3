// Simple local profile storage and meta-progression utilities
const KEY = 'ki-story-weber-profile-v1';

export function loadProfile() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultProfile();
    const p = JSON.parse(raw);
    return { ...defaultProfile(), ...p };
  } catch {
    return defaultProfile();
  }
}

export function saveProfile(p) {
  localStorage.setItem(KEY, JSON.stringify(p));
}

export function resetProfile() {
  saveProfile(defaultProfile());
}

export function exportProfile() {
  const blob = new Blob([JSON.stringify(loadProfile(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ki-story-weber-profile.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function importProfile(file) {
  const text = await file.text();
  const p = JSON.parse(text);
  saveProfile({ ...defaultProfile(), ...p });
  return loadProfile();
}

export function applyCarryoverOptions(profile) {
  // Translate profile perks/relics into engine options
  const boosts = { startHope: 0, startTension: 0, startThreat: 0 };
  if (profile.perks.includes('CalmMind')) boosts.startTension -= 0.05;
  if (profile.perks.includes('Optimist')) boosts.startHope += 0.05;
  if (profile.perks.includes('Hardening')) boosts.startThreat -= 0.03;
  return { boosts, relics: profile.relics.slice(0, 5) };
}

export function applyRunResultToProfile(profile, result) {
  const p = { ...profile };
  p.totalRuns += 1;
  p.totalChapters += result.chapters;
  p.bestScore = Math.max(p.bestScore, result.score);
  // earn points: base on score and chapters
  const earned = Math.max(1, Math.round((result.score||0)/10) + Math.round((result.chapters||0)*2));
  p.points = Math.max(0, (p.points||0) + earned);
  p.lastRuns.unshift({
    date: new Date().toISOString(),
    seed: result.seed,
    genre: result.genre,
    mode: result.mode,
    score: result.score,
    ending: result.ending,
    cast: result.cast,
  });
  p.lastRuns = p.lastRuns.slice(0, 10);
  // Unlock achievements
  for (const a of result.achievements || []) {
    if (!p.achievements.includes(a)) p.achievements.push(a);
  }
  // Add relic (if any)
  if (result.relic && !p.relics.includes(result.relic)) p.relics.push(result.relic);
  // Gentle difficulty/benefit scaling: add perk occasionally
  if (result.score >= 80 && !p.perks.includes('Optimist')) p.perks.push('Optimist');
  if (result.score >= 60 && !p.perks.includes('CalmMind')) p.perks.push('CalmMind');
  // Learning persona: update style preferences from accents summary
  if (p.stylePref?.learn && result.accents) {
    const decay = 0.9;
    const gain = 1.0;
    p.stylePref.accents = p.stylePref.accents || {};
    for (const key of ['insight','bold','caution','momentum','empathy']) {
      const prev = Number(p.stylePref.accents[key] || 0);
      const delta = Number(result.accents[key] || 0);
      const next = decay * prev + gain * delta;
      p.stylePref.accents[key] = Math.max(0, Math.min(1000, next));
    }
  }
  // Learn simple intent policy from run distribution
  if (p.policy?.learn && result.intentCounts) {
    const d = result.intentCounts;
    const total = Math.max(1, (d.progress||0)+(d.reveal||0)+(d.setback||0));
    const target = { progress: (d.progress||0)/total, reveal: (d.reveal||0)/total, setback: (d.setback||0)/total };
    const decay = 0.9;
    const gain = 1.0;
    p.policy.intents = p.policy.intents || { progress:1, reveal:1, setback:1 };
    for (const k of Object.keys(target)) {
      const prev = Number(p.policy.intents[k]||1);
      // Map target share (0..1) to weight (0.5..1.5) around 1
      const desired = 0.5 + target[k];
      p.policy.intents[k] = decay*prev + gain*desired;
    }
  }
  saveProfile(p);
  return p;
}

export function canAfford(profile, cost){ return (profile.points||0) >= cost; }

export function purchasePerk(profile, perk, cost){
  const p = { ...profile };
  if (p.perks.includes(perk)) return { ok:false, reason:'Bereits vorhanden', profile:p };
  if (!canAfford(p, cost)) return { ok:false, reason:'Nicht genug Punkte', profile:p };
  p.points = (p.points||0) - cost;
  p.perks = Array.from(new Set([...(p.perks||[]), perk]));
  saveProfile(p);
  return { ok:true, profile:p };
}

export function purchaseRelic(profile, relic, cost){
  const p = { ...profile };
  if (!canAfford(p, cost)) return { ok:false, reason:'Nicht genug Punkte', profile:p };
  p.points = (p.points||0) - cost;
  if (!p.relics.includes(relic)) p.relics = [...(p.relics||[]), relic];
  saveProfile(p);
  return { ok:true, profile:p };
}

function defaultProfile() {
  return {
    totalRuns: 0,
    totalChapters: 0,
    bestScore: 0,
    points: 0,
    achievements: [],
    relics: [],
    perks: [], // passive boosts
    lastRuns: [],
  stylePref: { learn: true, accents: { insight: 0, bold: 0, caution: 0, momentum: 0, empathy: 0 } },
  policy: { learn: true, intents: { progress: 1, reveal: 1, setback: 1 } },
  };
}
