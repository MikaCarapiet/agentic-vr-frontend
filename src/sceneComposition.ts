export type SceneCharacterAnchor = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  path: string;
  delay: number;
};

export type SceneFlashLane = {
  id: string;
  x: number;
  y: number;
  width: number;
  angle: number;
  delay: number;
};

export type SceneComposition = {
  id: string;
  characters: SceneCharacterAnchor[];
  flashLanes: SceneFlashLane[];
};

const yodaVaderWide: SceneComposition = {
  id: "yoda-vader-foreground",
  characters: [
    {
      id: "vader-foreground",
      x: 17,
      y: 50,
      width: 30,
      height: 78,
      path: "M50 5 C62 6 69 15 69 28 C76 31 82 39 83 51 C91 64 91 82 87 97 C71 92 62 82 56 67 C52 71 47 71 43 67 C36 82 27 92 12 97 C8 82 9 64 17 51 C18 39 24 31 31 28 C31 15 38 6 50 5 Z",
      delay: 0,
    },
    {
      id: "yoda-center",
      x: 60,
      y: 58,
      width: 8,
      height: 22,
      path: "M50 10 C61 11 68 19 72 32 C83 35 88 44 85 54 C81 63 71 62 64 58 C61 74 56 88 49 95 C42 88 37 74 35 58 C28 62 18 63 14 54 C11 44 17 35 28 32 C32 19 39 11 50 10 Z",
      delay: 0.42,
    },
  ],
  flashLanes: [
    { id: "vader-helmet", x: 4, y: 30, width: 25, angle: -12, delay: 0.2 },
    { id: "vader-shoulder", x: 17, y: 72, width: 25, angle: 10, delay: 0.82 },
    { id: "yoda-focus", x: 57, y: 53, width: 10, angle: -8, delay: 1.25 },
  ],
};

const yodaClose: SceneComposition = {
  id: "yoda-close",
  characters: [
    {
      id: "yoda-close",
      x: 50,
      y: 58,
      width: 68,
      height: 72,
      path: "M50 2 C66 4 77 14 83 31 C94 33 100 42 96 53 C91 66 78 64 69 58 C66 76 59 92 50 98 C40 92 33 76 30 58 C20 64 8 66 3 53 C-1 42 5 33 16 31 C22 14 34 4 50 2 Z",
      delay: 0,
    },
  ],
  flashLanes: [
    { id: "left-face", x: 5, y: 52, width: 18, angle: -24, delay: 0.1 },
    { id: "brow", x: 44, y: 43, width: 13, angle: -4, delay: 0.62 },
    { id: "right-ear", x: 78, y: 56, width: 15, angle: 18, delay: 1.05 },
  ],
};

const duelWide: SceneComposition = {
  id: "duel-wide",
  characters: [
    {
      id: "vader-wide",
      x: 36,
      y: 62,
      width: 15,
      height: 43,
      path: "M50 4 C61 6 67 16 66 29 C75 36 80 49 79 67 C77 82 69 94 58 98 C54 86 51 72 50 62 C47 74 43 87 37 98 C27 93 21 82 20 67 C18 49 25 36 34 29 C33 16 39 6 50 4 Z",
      delay: 0.22,
    },
    {
      id: "yoda-wide",
      x: 60,
      y: 68,
      width: 16,
      height: 35,
      path: "M50 10 C61 11 68 19 72 32 C83 35 88 44 85 54 C81 63 71 62 64 58 C61 74 56 88 49 95 C42 88 37 74 35 58 C28 62 18 63 14 54 C11 44 17 35 28 32 C32 19 39 11 50 10 Z",
      delay: 0.68,
    },
  ],
  flashLanes: [
    { id: "left-action", x: 27, y: 49, width: 19, angle: -11, delay: 0.25 },
    { id: "right-action", x: 54, y: 47, width: 21, angle: 10, delay: 0.95 },
    { id: "ground-action", x: 43, y: 79, width: 23, angle: -3, delay: 1.45 },
  ],
};

const yodaVaderClose: SceneComposition = {
  id: "yoda-vader-close",
  characters: [
    {
      id: "vader",
      x: 50,
      y: 50,
      width: 28,
      height: 66,
      path: "M50 2 C66 4 76 18 75 34 C86 40 93 53 91 70 C89 83 82 93 70 98 C63 88 57 76 54 64 C51 68 47 68 44 64 C41 76 35 88 27 98 C15 93 9 83 8 70 C6 53 13 40 25 34 C24 18 34 4 50 2 Z",
      delay: 0,
    },
  ],
  flashLanes: [
    { id: "helmet-left", x: 31, y: 34, width: 17, angle: -16, delay: 0.12 },
    { id: "helmet-right", x: 61, y: 36, width: 16, angle: 17, delay: 0.8 },
    { id: "shoulder-edge", x: 60, y: 70, width: 19, angle: -8, delay: 1.45 },
  ],
};

const genericComposition: SceneComposition = {
  id: "generic-scene",
  characters: [
    {
      id: "primary-subject",
      x: 38,
      y: 58,
      width: 26,
      height: 54,
      path: "M50 4 C62 6 70 18 70 34 C80 42 84 58 80 73 C76 87 65 96 50 98 C35 96 24 87 20 73 C16 58 20 42 30 34 C30 18 38 6 50 4 Z",
      delay: 0.12,
    },
    {
      id: "secondary-subject",
      x: 64,
      y: 60,
      width: 24,
      height: 50,
      path: "M50 6 C61 7 69 17 70 31 C79 38 84 53 82 68 C79 84 66 95 50 98 C34 95 22 84 18 68 C16 53 21 38 30 31 C31 17 39 7 50 6 Z",
      delay: 0.58,
    },
  ],
  flashLanes: [
    { id: "upper-left", x: 12, y: 32, width: 24, angle: -14, delay: 0 },
    { id: "upper-right", x: 70, y: 35, width: 22, angle: 16, delay: 0.85 },
    { id: "lower-center", x: 44, y: 72, width: 26, angle: -4, delay: 1.5 },
  ],
};

export function getSceneComposition(
  videoId: string,
  currentTime: number,
  _activeAgentId?: string | null,
): SceneComposition {
  if (videoId === "yoda-vader-duel") {
    if (currentTime < 6) return yodaVaderWide;
    if (currentTime < 10) return yodaClose;
    if (currentTime < 22) return yodaVaderClose;
    return duelWide;
  }

  return genericComposition;
}
