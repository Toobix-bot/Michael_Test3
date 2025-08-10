import { StoryEngine } from '../src/engine.mjs';

const engine = new StoryEngine({ seed: 'Test', genre: 'mystery', readerMode: 'off', language: 'de' });
let lastState = null;
engine.onUpdate((s) => { lastState = s; });
engine.start();
engine.next({ type: 'choice', index: 0 });
engine.next({ type: 'free', text: 'Wir teilen uns auf.' });

if (!lastState || lastState.log.length < 3) {
  console.error('Smoke test failed: insufficient log output', lastState?.log);
  process.exit(1);
}
if (!Array.isArray(lastState.choices)) {
  console.error('Smoke test failed: choices missing');
  process.exit(1);
}
// ensure no reader comments when readerMode = 'off'
if (lastState.log.some(l => String(l).startsWith('[Leser]'))) {
  console.error('Smoke test failed: reader interjection present while off');
  process.exit(1);
}
console.log('OK', { steps: lastState.step, log: lastState.log.slice(0,3) });
