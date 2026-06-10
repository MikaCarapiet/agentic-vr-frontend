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

// Vivid fallback hues assigned when a subject's own color is too gray or
// too close to another subject's color, so each character reads distinctly.
const SUBJECT_PALETTE: SubjectColor[] = [
  { r: 96, g: 247, b: 161 },
  { r: 255, g: 96, b: 96 },
  { r: 118, g: 188, b: 255 },
  { r: 255, g: 198, b: 88 },
];

function colorDistance(a: SubjectColor, b: SubjectColor) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function ensureDistinctColors(subjects: SceneSubject[]) {
  const used: SubjectColor[] = [];
  for (const subject of subjects) {
    const { r, g, b } = subject.color;
    const vividness = Math.max(r, g, b) - Math.min(r, g, b);
    const separated = used.every((color) => colorDistance(subject.color, color) >= 95);
    if (vividness < 70 || !separated) {
      let best = SUBJECT_PALETTE[0];
      let bestDistance = -1;
      for (const candidate of SUBJECT_PALETTE) {
        const distance = used.length
          ? Math.min(...used.map((color) => colorDistance(candidate, color)))
          : Number.POSITIVE_INFINITY;
        if (distance > bestDistance) {
          bestDistance = distance;
          best = candidate;
        }
      }
      subject.color = best;
    }
    used.push(subject.color);
  }
}

let sharedCanvas: HTMLCanvasElement | null = null;

function getSamplingContext(width: number, height: number) {
  if (!sharedCanvas) sharedCanvas = document.createElement("canvas");
  if (sharedCanvas.width !== width) sharedCanvas.width = width;
  if (sharedCanvas.height !== height) sharedCanvas.height = height;
  return sharedCanvas.getContext("2d", { willReadFrequently: true });
}

export type SceneRegion = {
  id: string;
  label?: string;
  /** Normalized [left, top, right, bottom] box (0-1) in the frame. */
  box: [number, number, number, number];
};

const REGION_GRID = 72;
let regionCanvas: HTMLCanvasElement | null = null;

function getRegionContext(width: number, height: number) {
  if (!regionCanvas) regionCanvas = document.createElement("canvas");
  if (regionCanvas.width !== width) regionCanvas.width = width;
  if (regionCanvas.height !== height) regionCanvas.height = height;
  return regionCanvas.getContext("2d", { willReadFrequently: true });
}

/**
 * Trace silhouettes inside AI-provided character boxes. Each box is sampled
 * as its own high-resolution crop, so a small distant figure gets the same
 * contour fidelity as a foreground close-up.
 */
export function analyzeVideoFrameInRegions(
  video: HTMLVideoElement,
  regions: SceneRegion[],
): SceneVisionResult | null {
  if (video.videoWidth === 0 || video.videoHeight === 0 || regions.length === 0) return null;

  const subjects: SceneSubject[] = [];
  let lumaTotal = 0;

  for (let index = 0; index < regions.length && subjects.length < MAX_SUBJECTS; index += 1) {
    const region = regions[index];
    // Pad slightly so the silhouette edge itself sits inside the crop.
    const pad = 0.015;
    const bx0 = Math.max(0, Math.min(region.box[0], region.box[2]) - pad);
    const by0 = Math.max(0, Math.min(region.box[1], region.box[3]) - pad);
    const bx1 = Math.min(1, Math.max(region.box[0], region.box[2]) + pad);
    const by1 = Math.min(1, Math.max(region.box[1], region.box[3]) + pad);
    const boxW = bx1 - bx0;
    const boxH = by1 - by0;
    if (boxW < 0.01 || boxH < 0.01) continue;

    const gw = REGION_GRID;
    const gh = Math.max(24, Math.min(120, Math.round(gw * ((boxH * video.videoHeight) / (boxW * video.videoWidth)))));
    const context = getRegionContext(gw, gh);
    if (!context) return null;

    let pixels: Uint8ClampedArray;
    try {
      context.drawImage(
        video,
        bx0 * video.videoWidth,
        by0 * video.videoHeight,
        boxW * video.videoWidth,
        boxH * video.videoHeight,
        0,
        0,
        gw,
        gh,
      );
      pixels = context.getImageData(0, 0, gw, gh).data;
    } catch {
      return null;
    }

    const cellCount = gw * gh;
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
    lumaTotal += lumaSum / cellCount;

    const gradient = new Float32Array(cellCount);
    let maxGradient = 0;
    for (let y = 1; y < gh - 1; y += 1) {
      for (let x = 1; x < gw - 1; x += 1) {
        const i = y * gw + x;
        const gx =
          luma[i - gw + 1] + 2 * luma[i + 1] + luma[i + gw + 1] -
          luma[i - gw - 1] - 2 * luma[i - 1] - luma[i + gw - 1];
        const gy =
          luma[i + gw - 1] + 2 * luma[i + gw] + luma[i + gw + 1] -
          luma[i - gw - 1] - 2 * luma[i - gw] - luma[i - gw + 1];
        const magnitude = Math.hypot(gx, gy);
        gradient[i] = magnitude;
        if (magnitude > maxGradient) maxGradient = magnitude;
      }
    }
    if (maxGradient <= 0) continue;
    for (let i = 0; i < cellCount; i += 1) gradient[i] /= maxGradient;

    // Strong-edge cells inside the box belong overwhelmingly to the
    // character silhouette, since the AI box is tight around the figure.
    const sorted = Array.from(gradient).sort((a, b) => a - b);
    const cutoff = Math.max(sorted[Math.floor(cellCount * 0.82)] ?? 0, 0.16);
    const edgeCells: number[] = [];
    for (let i = 0; i < cellCount; i += 1) {
      if (gradient[i] >= cutoff) edgeCells.push(i);
    }
    if (edgeCells.length < 10) continue;

    let weightSum = 0;
    let centroidX = 0;
    let centroidY = 0;
    for (const cell of edgeCells) {
      const x = cell % gw;
      const y = (cell - x) / gw;
      const weight = gradient[cell];
      weightSum += weight;
      centroidX += x * weight;
      centroidY += y * weight;
    }
    centroidX /= weightSum;
    centroidY /= weightSum;

    let covXX = 0;
    let covYY = 0;
    let covXY = 0;
    for (const cell of edgeCells) {
      const x = cell % gw;
      const y = (cell - x) / gw;
      const dx = x - centroidX;
      const dy = y - centroidY;
      covXX += dx * dx;
      covYY += dy * dy;
      covXY += dx * dy;
    }
    const axisAngle = 0.5 * Math.atan2(2 * covXY, covXX - covYY);

    let colorWeight = 0;
    let red = 0;
    let green = 0;
    let blue = 0;
    for (const cell of edgeCells) {
      const weight = Math.pow(saturation[cell], 1.5) * (0.25 + luma[cell]);
      red += pixels[cell * 4] * weight;
      green += pixels[cell * 4 + 1] * weight;
      blue += pixels[cell * 4 + 2] * weight;
      colorWeight += weight;
    }
    let color: SubjectColor = { r: 110, g: 205, b: 255 };
    if (colorWeight >= 0.5) {
      red /= colorWeight;
      green /= colorWeight;
      blue /= colorWeight;
      const peak = Math.max(red, green, blue, 1);
      const mean = (red + green + blue) / (3 * peak);
      const amp = 2.35;
      const boost = (channel: number) =>
        Math.round(Math.min(1, Math.max(0, mean + (channel / peak - mean) * amp)) * 255);
      color = { r: boost(red), g: boost(green), b: boost(blue) };
    }

    edgeCells.sort((a, b) => {
      const angleA = Math.atan2((a - (a % gw)) / gw - centroidY, (a % gw) - centroidX);
      const angleB = Math.atan2((b - (b % gw)) / gw - centroidY, (b % gw) - centroidX);
      return angleA - angleB;
    });
    const step = Math.max(1, Math.floor(edgeCells.length / MAX_CONTOUR_POINTS));
    const contour: ContourPoint[] = [];
    for (let i = 0; i < edgeCells.length; i += step) {
      const cell = edgeCells[i];
      const x = cell % gw;
      const y = (cell - x) / gw;
      contour.push({
        x: bx0 + ((x + 0.5) / gw) * boxW,
        y: by0 + ((y + 0.5) / gh) * boxH,
        w: Math.max(0.25, gradient[cell]),
      });
    }

    subjects.push({
      id: region.id,
      cx: bx0 + (centroidX / gw) * boxW,
      cy: by0 + (centroidY / gh) * boxH,
      x0: bx0,
      y0: by0,
      x1: bx1,
      y1: by1,
      color,
      axisAngle,
      energy: Math.max(0.55, 1 - index * 0.12),
      contour,
    });
  }

  if (subjects.length === 0) return null;
  ensureDistinctColors(subjects);
  return {
    subjects,
    meanLuma: lumaTotal / Math.max(1, subjects.length),
    sampledAt: performance.now(),
  };
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
  // Keep the floor low so distant figures (a character far from camera) still register.
  const minCells = Math.max(8, Math.round(cellCount * 0.0015));

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

  // Rank blobs by how much they look like a figure (compact, dense, framed
  // within the shot) rather than by raw saliency mass, which favours scenery
  // like tree canopies and ground texture in wide shots.
  const ranked = components
    .map((component) => {
      let minX = width;
      let minY = height;
      let maxX = 0;
      let maxY = 0;
      let saturationSum = 0;
      for (const cell of component.cells) {
        const x = cell % width;
        const y = (cell - x) / width;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        saturationSum += saturation[cell];
      }
      const boxW = maxX - minX + 1;
      const boxH = maxY - minY + 1;
      const boxArea = boxW * boxH;
      const areaFraction = boxArea / cellCount;
      const widthFraction = boxW / width;
      // Scenery rejection: near-frame-wide strips (canopy, horizon, ground)
      // and near-frame-filling masses are environment, not characters.
      // Tall-but-narrow is fine — that is what a close-up character looks like.
      if (areaFraction > 0.45 || widthFraction > 0.78) return null;
      const fillRatio = component.cells.length / boxArea;
      // Sparse, web-like blobs (branches, foliage edges) have low fill.
      if (fillRatio < 0.2) return null;

      const centerX = (minX + maxX) / 2 / width;
      const centerY = (minY + maxY) / 2 / height;
      // Characters are usually staged toward the middle band of the frame.
      const centerBias =
        1 - Math.min(1, Math.hypot((centerX - 0.5) * 1.35, (centerY - 0.52) * 1.7));
      const aspect = boxH / Math.max(1, boxW);
      // Favour upright-ish blobs; penalise wide flat strips (horizon, ground).
      const uprightness = aspect >= 0.7 ? 1 : Math.max(0.2, aspect / 0.7);
      const meanSaliency = component.score / component.cells.length;
      const meanSaturation = saturationSum / component.cells.length;
      const sizeWeight = Math.sqrt(component.cells.length / cellCount);

      const subjectScore =
        meanSaliency *
        (0.5 + sizeWeight * 3.2) *
        (0.45 + fillRatio) *
        (0.4 + centerBias * 1.2) *
        uprightness *
        (0.7 + meanSaturation * 1.4);
      return { component, subjectScore };
    })
    .filter((entry): entry is { component: { cells: number[]; score: number }; subjectScore: number } => entry !== null)
    .sort((a, b) => b.subjectScore - a.subjectScore);

  // Drop weak trailing detections so faint scenery doesn't ride along with
  // strongly detected characters.
  const leadScore = ranked[0]?.subjectScore ?? 0;
  const picked = ranked
    .filter((entry, index) => index === 0 || entry.subjectScore >= leadScore * 0.18)
    .slice(0, MAX_SUBJECTS)
    .map((entry) => entry.component);
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
  ensureDistinctColors(subjects);

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
    color = { r: 110, g: 205, b: 255 };
  } else {
    red /= colorWeight;
    green /= colorWeight;
    blue /= colorWeight;
    const peak = Math.max(red, green, blue, 1);
    let r = red / peak;
    let g = green / peak;
    let b = blue / peak;
    // Exaggerate the hue so the glow reads vividly against the footage.
    const mean = (r + g + b) / 3;
    const amp = 2.35;
    r = Math.min(1, Math.max(0, mean + (r - mean) * amp));
    g = Math.min(1, Math.max(0, mean + (g - mean) * amp));
    b = Math.min(1, Math.max(0, mean + (b - mean) * amp));
    color = {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255),
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
