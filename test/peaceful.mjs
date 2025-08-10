import { StoryEngine } from '../src/engine.mjs';

function runOneStep(opts){
  let last = null;
  const e = new StoryEngine(opts);
  e.onUpdate(s => last = s);
  e.start();
  // pick first available choice to advance deterministically
  e.next({ type: 'choice', index: 0 });
  return last;
}

const base = runOneStep({ seed: 'PeacefulCheck', genre: 'mystery', readerMode: 'off', language: 'de' });
const calm = runOneStep({ seed: 'PeacefulCheck', genre: 'mystery', readerMode: 'off', language: 'de', peaceful: true });

if (!base || !calm) {
  console.error('Peaceful test failed: missing states');
  process.exit(1);
}

// Expect: calm mode should not increase threat more than base; tension also should be <= base in most cases
const tBase = base.world.threat;
const tCalm = calm.world.threat;
if (tCalm - 1e-6 > tBase) {
  console.error('Peaceful test failed: calm threat higher than base', { tBase, tCalm });
  process.exit(1);
}

console.log('OK peaceful', { base: { threat: tBase, tension: base.world.tension }, calm: { threat: tCalm, tension: calm.world.tension } });
