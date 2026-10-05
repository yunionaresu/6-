/* ============================================================
   Noisism Engine: 空間知覚のための多重ノイズ合成モジュール
   ============================================================ */

const NoiseEngine = (() => {
  // 1. 規則性ノイズ: 4x4 Bayer Matrix (ディザリング・パース量子化用)
  const bayer4x4 = [
    [ 0/16,  8/16,  2/16, 10/16],
    [12/16,  4/16, 14/16,  6/16],
    [ 3/16, 11/16,  1/16,  9/16],
    [15/16,  7/16, 13/16,  5/16]
  ];

  function getBayer(x, y) {
    const ix = Math.floor(Math.abs(x)) % 4;
    const iy = Math.floor(Math.abs(y)) % 4;
    return bayer4x4[iy][ix];
  }

  // 2. ランダムノイズ: Box-Muller変換による正規分布散乱
  function gaussian(rng) {
    let u = 0, v = 0;
    while(u === 0) u = rng();
    while(v === 0) v = rng();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  // 3. フラクタルノイズ (Fast 2D Value Noise + fBm)
  function hash2d(x, y) {
    let n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return n - Math.floor(n);
  }

  function smoothNoise2D(x, y) {
    const i = Math.floor(x), j = Math.floor(y);
    const fx = x - i, fy = y - j;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);

    const n00 = hash2d(i, j);
    const n10 = hash2d(i + 1, j);
    const n01 = hash2d(i, j + 1);
    const n11 = hash2d(i + 1, j + 1);

    const nx0 = n00 * (1 - sx) + n10 * sx;
    const nx1 = n01 * (1 - sx) + n11 * sx;
    return nx0 * (1 - sy) + nx1 * sy;
  }

  function fBm(x, y, octaves = 3) {
    let val = 0, amp = 0.5, freq = 1;
    for (let o = 0; o < octaves; o++) {
      val += smoothNoise2D(x * freq, y * freq) * amp;
      freq *= 2.05;
      amp *= 0.5;
    }
    return val;
  }

  // 4. 背景の曲率フィールド生成（6点透視空間の気配を錯視させる）
  function renderCurvedField(ctx, cx, cy, R, w, h) {
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    const step = 2; // 負荷抑制のためのステップサンプリング

    for (let py = 0; py < h; py += step) {
      for (let px = 0; px < w; px += step) {
        const dx = (px - cx) / R;
        const dy = (py - cy) / R;
        const dist2 = dx * dx + dy * dy;

        if (dist2 < 1.0) {
          // 球面歪曲座票 (Z+ 方向の膨らみ)
          const z = Math.sqrt(1.0 - dist2);
          const f = fBm(dx * 4.5 + z * 1.5, dy * 4.5 + z * 1.5, 3);
          
          // 規則性同心ノイズ（モアレ効果で視界背面のZ-方向を暗示）
          const ring = Math.sin(dist2 * 32.0 - z * 8.0) * 0.5 + 0.5;
          const b = getBayer(px, py);

          const intensity = (f * 0.7 + ring * 0.3);
          if (intensity > b * 0.95) {
            const idx = (py * w + px) * 4;
            const lum = 18 + Math.floor(intensity * 26);
            d[idx]     = lum;
            d[idx + 1] = lum + 8;
            d[idx + 2] = lum + 18;
            d[idx + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  return { getBayer, gaussian, fBm, renderCurvedField };
})();