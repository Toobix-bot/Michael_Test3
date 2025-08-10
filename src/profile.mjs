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
  saveProfile(p);
  return p;
}

function defaultProfile() {
  return {
    totalRuns: 0,
    totalChapters: 0,
    bestScore: 0,
    achievements: [],
    relics: [],
    perks: [], // passive boosts
    lastRuns: [],
  };
}
