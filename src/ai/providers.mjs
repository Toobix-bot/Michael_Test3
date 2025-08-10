// Simple AI-Lab provider scaffold (no external calls by default)
// Interface:
// - suggest(state, choices) => { index, rationale } | null
// - rewrite(line, ctx) => string | null

export function getProvider(name = 'none', opts = {}) {
  const key = (name||'none').toLowerCase();
  switch (key) {
    case 'mock': return new MockProvider(opts);
    case 'gpu': {
      try { return new WebGPUProvider(opts); } catch { return new NoopProvider(); }
    }
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

class WebGPUProvider {
  constructor(opts){
    this.name = 'gpu';
    this.device = null;
    this.pipeline = null;
    this.ready = this._init();
  }
  async _init(){
    if (!('gpu' in navigator)) { this.name = 'none'; return; }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) { this.name = 'none'; return; }
    this.device = await adapter.requestDevice();
    const code = `
      struct Effects { hope: f32, tension: f32, threat: f32 };
      struct Params {
        n: u32,
        _pad0: u32,
        _pad1: u32,
        _pad2: u32,
        currentTension: f32,
        targetTension: f32,
        wMomentum: f32,
        wSafety: f32,
        wTensionFit: f32,
      };
      @group(0) @binding(0) var<storage, read> effects: array<Effects>;
      @group(0) @binding(1) var<storage, read_write> scores: array<f32>;
      @group(0) @binding(2) var<uniform> params: Params;
      @compute @workgroup_size(64)
      fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
        let i = gid.x;
        if (i >= params.n) { return; }
        let e = effects[i];
        let predTension = clamp(params.currentTension + e.tension, 0.0, 1.0);
        let safety = -e.threat;
        let momentum = e.hope - max(0.0, e.tension * 0.5);
        let tensionFit = -abs(params.targetTension - predTension);
        let s = params.wMomentum*momentum + params.wSafety*safety + params.wTensionFit*tensionFit;
        scores[i] = s;
      }
    `;
    this.pipeline = await this.device.createComputePipelineAsync({
      layout: 'auto',
      compute: { module: this.device.createShaderModule({ code }), entryPoint: 'main' }
    });
  }
  async suggest(state, choices){
    try {
      if (!choices || choices.length === 0) return null;
      await this.ready;
      if (!this.device || !this.pipeline) return this._cpuFallback(state, choices);
      const n = choices.length >>> 0;
      const eff = new Float32Array(n * 3);
      for (let i=0;i<n;i++) {
        const e = choices[i].effects || {};
        eff[i*3+0] = e.hope || 0;
        eff[i*3+1] = e.tension || 0;
        eff[i*3+2] = e.threat || 0;
      }
      const effectsBuf = this.device.createBuffer({
        size: eff.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      });
      this.device.queue.writeBuffer(effectsBuf, 0, eff.buffer, eff.byteOffset, eff.byteLength);

      const scoresSize = n * 4;
      const scoresBuf = this.device.createBuffer({
        size: scoresSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      });
      const readBuf = this.device.createBuffer({ size: scoresSize, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });

      const paramsSize = 64; // padded
      const paramsBuf = this.device.createBuffer({ size: paramsSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      // weights similar to engine's balanced profile
      const wt = { momentum: 2.5, safety: 2.0, tensionFit: 1.0 };
      const targetTension = 0.4 + ((state?.freedom || 0.4) - 0.5) * 0.1;
      const arr = new ArrayBuffer(paramsSize);
      const u32 = new Uint32Array(arr);
      const f32 = new Float32Array(arr);
      u32[0] = n; // n
      f32[4] = state?.world?.tension || 0;
      f32[5] = targetTension;
      f32[6] = wt.momentum; f32[7] = wt.safety; f32[8] = wt.tensionFit;
      this.device.queue.writeBuffer(paramsBuf, 0, arr);

      const bind = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: effectsBuf } },
          { binding: 1, resource: { buffer: scoresBuf } },
          { binding: 2, resource: { buffer: paramsBuf } },
        ]
      });

      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, bind);
      pass.dispatchWorkgroups(Math.ceil(n/64));
      pass.end();
      encoder.copyBufferToBuffer(scoresBuf, 0, readBuf, 0, scoresSize);
      this.device.queue.submit([encoder.finish()]);
      await readBuf.mapAsync(GPUMapMode.READ);
      const out = new Float32Array(readBuf.getMappedRange().slice(0));
      readBuf.unmap();
      let best = -Infinity, idx = 0;
      for (let i=0;i<n;i++){ const s = out[i]; if (s > best){ best = s; idx = i; } }
      return { index: idx, rationale: 'WebGPU: Multi-Kriterium (Momentum/Sicherheit/Spannung) auf GPU berechnet.' };
    } catch {
      return this._cpuFallback(state, choices);
    }
  }
  _cpuFallback(state, choices){
    if (!choices || choices.length === 0) return null;
    let best=-Infinity, idx=0;
    for (let i=0;i<choices.length;i++){
      const e = choices[i].effects||{};
      const s = (e.hope||0) - (e.threat||0) - 0.2*(e.tension||0);
      if (s>best){ best=s; idx=i; }
    }
    return { index: idx, rationale: 'Fallback: CPU-Heuristik (GPU nicht verfügbar).' };
  }
  rewrite(){ return null; }
}

// To add a real provider (external or local), implement the same methods and return it in getProvider().
