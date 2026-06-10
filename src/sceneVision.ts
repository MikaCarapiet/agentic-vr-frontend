export type SubjectColor = { r: number; g: number; b: number };

export type ContourPoint = {
  x: number;
  y: number;
  w: number;
};

export type SceneSubject = {
  id: string;
  cx: number;
  cy: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: SubjectColor;
  axisAngle: number;
  energy: number;
  contour: ContourPoint[];
};

export type SceneVisionResult = {
  subjects: SceneSubject[];
  meanLuma: number;
  sampledAt: number;
};

const GRID_WIDTH = 144;
const MAX_SUBJECTS = 4;
const MAX_CONTOUR_POINTS = 88;
const NEIGHBOR_OFFSETS = [-1, 1, 0, 0, -1, -1, 1, 1, 0, 0, -1, 1, -1, 1, -1, 1];

let sharedCanvas: HTMLCanvasElement | null = null;

function getSamplingContext(width: number, height: number) {
  if (!sharedCanvas) sharedCanvas = document.createElement("canvas");
  if (sharedCanvas.width !== width) sharedCanvas.width = width;
  if (sharedCanvas.height !== height) sharedCanvas.height = height;
  return sharedCanvas.getContext("2d", { willReadFrequently: true });
}

export function analyzeVideoFrame(video: HTMLVideoElement): SceneVisionResult | null {
  if (video.videoWidth === 0 || video.videoHeight === 0) return null;

  const width = GRID_WIDTH;
  const height = Math.max(32, Math.round((video.videoHeight / video.videoWidth) * width));
  const context = getSamplingContext(width, height);
  if (!context) return null;

  let pixels: Uint8ClampedArray;
  try {
    context.drawImage(video, 0, 0, width, height);
    pixels = context.getImageData(0, 0, width, height).data;
  } catch {
    return null;
  }

  const cellCount = width * height;
  const luma = new Float32Array(cellCount);
  const saturation = new Float32Array(cellCount);

  let lumaSum = 0;
  for (let i = 0; i < cellCount; i += 1) {
    const r = pixels[i * 4] / 255;
    const g = pixels[i * 4 + 1] / 255;
    const b = pixels[i * 4 + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    luma[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    saturation[i] = max === 0 ? 0 : (max - min) / max;
    lumaSum += luma[i];
  }
  const meanLuma = lumaSum / cellCount;

  const gradient = new Float32Array(cellCount);
  let maxGradient = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const gx =
        luma[i - width + 1] +
        2 * luma[i + 1] +
        luma[i + width + 1] -
        luma[i - width - 1] -
        2 * luma[i - 1] -
        luma[i + width - 1];
      const gy =
        luma[i + width - 1] +
        2 * luma[i + width] +
        luma[i + width + 1] -
        luma[i - width - 1] -
        2 * luma[i - width] -
        luma[i - width + 1];
      const magnitude = Math.hypot(gx, gy);
      gradient[i] = magnitude;
      if (magnitude > maxGradient) maxGradient = magnitude;
    }
  }
  if (maxGradient > 0) {
    for (let i = 0; i < cellCount; i += 1) gradient[i] /= maxGradient;
  }

  const saliency = new Float32Array(cellCount);
  let saliencySum = 0;
  for (let i = 0; i < cellCount; i += 1) {
    saliency[i] =
      gradient[i] * 1.15 +
      saturation[i] * (0.35 + luma[i]) * 0.95 +
      Math.abs(luma[i] - meanLuma) * 0.55;
    saliencySum += saliency[i];
  }
  const saliencyMean = saliencySum / cellCount;
  let varianceSum = 0;
  for (let i = 0; i < cellCount; i += 1) {
    const delta = saliency[i] - saliencyMean;
    varianceSum += delta * delta;
  }
  const threshold = saliencyMean + Math.sqrt(varianceSum / cellCount) * 1.05;

  const labels = new Int32Array(cellCount).fill(-1);
  const queue = new Int32Array(cellCount);
  const components: Array<{ cells: number[]; score: number }> = [];
  const minCells = Math.max(12, Math.round(cellCount * 0.003));

  for (let seed = 0; seed < cellCount; seed += 1) {
    if (labels[seed] !== -1 || saliency[seed] < threshold) continue;

    const label = components.length;
    const cells: number[] = [];
    let score = 0;
    let head = 0;
    let tail = 0;
    queue[tail] = seed;
    tail += 1;
    labels[seed] = label;

    while (head < tail) {
      const cell = queue[head];
      head += 1;
      cells.push(cell);
      score += saliency[cell];
      const cellX = cell % width;
      const cellY = (cell - cellX) / width;
      for (let n = 0; n < 8; n += 1) {
        const nx = cellX + NEIGHBOR_OFFSETS[n];
        const ny = cellY + NEIGHBOR_OFFSETS[n + 8];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbor = ny * width + nx;
        if (labels[neighbor] !== -1 || saliency[neighbor] < threshold) continue;
        labels[neighbor] = label;
        queue[tail] = neighbor;
        tail += 1;
      }
    }

    if (cells.length >= minCells) components.push({ cells, score });
  }

  components.sort((a, b) => b.score - a.score);
  const picked = components.slice(0, MAX_SUBJECTS);
  if (picked.length === 0) {
    return { subjects: [], meanLuma, sampledAt: performance.now() };
  }

  const topScore = picked[0].score;
  const subjects = picked.map((component, index) =>
    buildSubject(component, index, {
      width,
      height,
      pixels,
      luma,
      saturation,
      saliency,
      gradient,
      topScore,
    }),
  );

  return { subjects, meanLuma, sampledAt: performance.now() };
}

type SubjectBuildContext = {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  luma: Float32Array;
  saturation: Float32Array;
  saliency: Float32Array;
  gradient: Float32Array;
  topScore: number;
};

function buildSubject(
  component: { cells: number[]; score: number },
  index: number,
  ctx: SubjectBuildContext,
): SceneSubject {
  const { width, height, pixels, luma, saturation, saliency, gradient, topScore } = ctx;

  let weightSum = 0;
  let centroidX = 0;
  let centroidY = 0;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (const cell of component.cells) {
    const x = cell % width;
    const y = (cell - x) / width;
    const weight = saliency[cell];
    weightSum += weight;
    centroidX += x * weight;
    centroidY += y * weight;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  centroidX /= weightSum;
  centroidY /= weightSum;

  let covXX = 0;
  let covYY = 0;
  let covXY = 0;
  for (const cell of component.cells) {
    const x = cell % width;
    const y = (cell - x) / width;
    const weight = saliency[cell];
    const dx = x - centroidX;
    const dy = y - centroidY;
    covXX += dx * dx * weight;
    covYY += dy * dy * weight;
    covXY += dx * dy * weight;
  }
  const axisAngle = 0.5 * Math.atan2(2 * covXY, covXX - covYY);

  let colorWeight = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (const cell of component.cells) {
    const weight = Math.pow(saturation[cell], 1.5) * (0.25 + luma[cell]);
    red += pixels[cell * 4] * weight;
    green += pixels[cell * 4 + 1] * weight;
    blue += pixels[cell * 4 + 2] * weight;
    colorWeight += weight;
  }
  let color: SubjectColor;
  if (colorWeight < 0.5) {
    color = { r: 214, g: 228, b: 255 };
  } else {
    red /= colorWeight;
    green /= colorWeight;
    blue /= colorWeight;
    const peak = Math.max(red, green, blue, 1);
    const boost = Math.min(235 / peak, 3.2);
    color = {
      r: Math.round(Math.min(255, red * boost * 0.82 + 46)),
      g: Math.round(Math.min(255, green * boost * 0.82 + 46)),
      b: Math.round(Math.min(255, blue * boost * 0.82 + 46)),
    };
  }

  const edgeMagnitudes = component.cells
    .map((cell) => gradient[cell])
    .sort((a, b) => a - b);
  const edgeCutoff = edgeMagnitudes[Math.floor(edgeMagnitudes.length * 0.6)] ?? 0;
  let edgeCells = component.cells.filter((cell) => gradient[cell] >= edgeCutoff && gradient[cell] > 0);
  if (edgeCells.length === 0) edgeCells = component.cells;

  edgeCells.sort((a, b) => {
    const angleA = Math.atan2((a - (a % width)) / width - centroidY, (a % width) - centroidX);
    const angleB = Math.atan2((b - (b % width)) / width - centroidY, (b % width) - centroidX);
    return angleA - angleB;
  });
  const step = Math.max(1, Math.floor(edgeCells.length / MAX_CONTOUR_POINTS));
  let peakEdge = 0;
  for (const cell of edgeCells) peakEdge = Math.max(peakEdge, gradient[cell]);
  const contour: ContourPoint[] = [];
  for (let i = 0; i < edgeCells.length; i += step) {
    const cell = edgeCells[i];
    const x = cell % width;
    const y = (cell - x) / width;
    contour.push({
      x: (x + 0.5) / width,
      y: (y + 0.5) / height,
      w: peakEdge > 0 ? Math.max(0.25, gradient[cell] / peakEdge) : 0.6,
    });
  }

  const padX = 1.6 / width;
  const padY = 1.6 / height;

  return {
    id: `subject-${index}`,
    cx: centroidX / width,
    cy: centroidY / height,
    x0: Math.max(0, minX / width - padX),
    y0: Math.max(0, minY / height - padY),
    x1: Math.min(1, (maxX + 1) / width + padX),
    y1: Math.min(1, (maxY + 1) / height + padY),
    color,
    axisAngle,
    energy: Math.max(0.4, Math.min(1, component.score / topScore)),
    contour,
  };
}
