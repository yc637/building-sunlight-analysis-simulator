// 透视校正：4 组对应点解单应矩阵（Homography），并做像素逆映射重采样。
// 约定：H 为 3x3 行主序数组，src→dst，H[2][2]=1。

// 4 组对应点 (srcPts→dstPts) 解 3x3 单应矩阵。点退化（共线/秩亏）返回 null。
export function solveHomography(srcPts, dstPts) {
  const A = []; // 8 行 × 9 列（含常数项）
  for (let i = 0; i < 4; i++) {
    const [x, y] = srcPts[i];
    const [u, v] = dstPts[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]); // 分子 x 方程
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]); // 分子 y 方程
  }
  const h = gaussSolve8(A);
  if (!h) return null;
  return [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1],
  ];
}

// 高斯消元（部分主元）解 8 元线性方程组，A 为 8×(8+1) 增广矩阵。奇异返回 null。
function gaussSolve8(A) {
  const n = 8;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / A[col][col];
      for (let c = col; c <= n; c++) A[r][c] -= f * A[col][c];
    }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = A[r][n];
    for (let c = r + 1; c < n; c++) s -= A[r][c] * x[c];
    x[r] = s / A[r][r];
  }
  return x;
}

// 齐次正向映射：H 作用于 (x,y,1)。
export function transformPoint(H, x, y) {
  const w = H[2][0] * x + H[2][1] * y + H[2][2];
  return [
    (H[0][0] * x + H[0][1] * y + H[0][2]) / w,
    (H[1][0] * x + H[1][1] * y + H[1][2]) / w,
  ];
}

// 3x3 逆矩阵（伴随矩阵/行列式）。奇异返回 null。
export function invertHomography(H) {
  const [[a, b, c], [d, e, f], [g, h, i]] = H;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  return [
    [(e * i - f * h) * inv, (c * h - b * i) * inv, (b * f - c * e) * inv],
    [(f * g - d * i) * inv, (a * i - c * g) * inv, (c * d - a * f) * inv],
    [(d * h - e * g) * inv, (b * g - a * h) * inv, (a * e - b * d) * inv],
  ];
}

// 逆映射重采样：把 src 图（img）按 H（像素→世界米）重投影成正射图。
// worldBBox = {minX,maxX,minZ,maxZ}（目标4点世界包围盒）；outW 控制输出横向分辨率（默认=img.width）。
// 返回 { canvas, mpp, worldX, worldZ }，直接可作 bg 使用。
export function applyHomography(img, H, worldBBox, outW = img.width) {
  const mpp = (worldBBox.maxX - worldBBox.minX) / outW;
  const outH = Math.max(1, Math.round((worldBBox.maxZ - worldBBox.minZ) / mpp));
  const Hinv = invertHomography(H);
  const out = document.createElement('canvas');
  out.width = outW; out.height = outH;
  const octx = out.getContext('2d');
  // 奇异（H 不可逆）：返回同尺寸透明画布，保持返回结构一致
  if (!Hinv) return { canvas: out, mpp, worldX: worldBBox.minX, worldZ: worldBBox.minZ };
  // 先把 img 落到普通 canvas 以读像素
  const src = document.createElement('canvas');
  src.width = img.width; src.height = img.height;
  const sctx = src.getContext('2d');
  sctx.drawImage(img, 0, 0);
  const sdata = sctx.getImageData(0, 0, img.width, img.height).data;
  const odata = octx.createImageData(outW, outH);
  for (let oy = 0; oy < outH; oy++) {
    for (let ox = 0; ox < outW; ox++) {
      // 输出像素中心 → 世界米 → 源像素（H 逆）
      const wx = worldBBox.minX + (ox + 0.5) * mpp;
      const wz = worldBBox.minZ + (oy + 0.5) * mpp;
      const [sx, sy] = transformPoint(Hinv, wx, wz);
      const xi = Math.round(sx - 0.5), yi = Math.round(sy - 0.5);
      if (xi >= 0 && xi < img.width && yi >= 0 && yi < img.height) {
        const s = (yi * img.width + xi) * 4;
        const d = (oy * outW + ox) * 4;
        odata.data[d] = sdata[s];
        odata.data[d + 1] = sdata[s + 1];
        odata.data[d + 2] = sdata[s + 2];
        odata.data[d + 3] = 255;
      }
      // 源图外保持透明（alpha 0）
    }
  }
  octx.putImageData(odata, 0, 0);
  return { canvas: out, mpp, worldX: worldBBox.minX, worldZ: worldBBox.minZ };
}
