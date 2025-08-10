import { StoryEngine } from '../src/engine.mjs';

function distFor(opts){
  const e = new StoryEngine(opts);
  e.start();
  const ins = e.getInsights();
  return ins.distribution;
}

const base = distFor({ seed: 'PeacefulInsights', genre: 'mystery', readerMode: 'off', language: 'de' });
const calm = distFor({ seed: 'PeacefulInsights', genre: 'mystery', readerMode: 'off', language: 'de', peaceful: true });

if (!base || !calm) {
  console.error('Peaceful insights test failed: missing distribution');
  process.exit(1);
}

if (calm.setback > base.setback + 1e-9) {
  console.error('Peaceful insights test failed: calm setback not reduced', { base, calm });
  process.exit(1);
}
console.log('OK peaceful insights', { base: base.setback.toFixed(3), calm: calm.setback.toFixed(3) });
