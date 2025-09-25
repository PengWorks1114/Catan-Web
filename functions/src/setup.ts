import { randomBytes } from "crypto";
import type {
  BankDoc,
  BoardDoc,
  ConfigDoc,
  DevKind,
  HandDoc,
  MapConfig,
  MetaDoc,
  ResMap,
  Resource,
  TradeDoc,
} from "./types";
import { DEV_CARD_KINDS, PLAYER_COLORS, RESOURCE_TYPES } from "./types";

type Rng = () => number;

const HEX_IDS = Array.from({ length: 19 }, (_, index) =>
  `hex_${index.toString().padStart(2, "0")}`,
);

const TILE_POOL: (Resource | "desert")[] = [
  "wood",
  "wood",
  "wood",
  "wood",
  "brick",
  "brick",
  "brick",
  "sheep",
  "sheep",
  "sheep",
  "sheep",
  "wheat",
  "wheat",
  "wheat",
  "wheat",
  "ore",
  "ore",
  "ore",
  "desert",
];

const NUMBER_CHITS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

const PORT_EDGE_IDS = [
  "e:r0-c1",
  "e:r0-c3",
  "e:r1-c5",
  "e:r3-c6",
  "e:r4-c6",
  "e:r5-c4",
  "e:r5-c2",
  "e:r3-c0",
  "e:r1-c0",
];

const PORT_TYPE_POOL = [
  "3:1",
  "3:1",
  "3:1",
  "3:1",
  "wood",
  "brick",
  "sheep",
  "wheat",
  "ore",
] as const;

const DEV_DECK_COMPOSITION: Record<DevKind, number> = {
  knight: 14,
  roadBuilding: 2,
  yearOfPlenty: 2,
  monopoly: 2,
  vp: 5,
};

export const CONFIG_DOC_ID = "state";
export const BOARD_DOC_ID = "state";
export const BANK_DOC_ID = "state";
export const TRADE_DOC_ID = "state";
export const META_DOC_ID = "state";

const DEFAULT_BANK_RESOURCE_STOCK: ResMap = {
  wood: 19,
  brick: 19,
  sheep: 19,
  wheat: 19,
  ore: 19,
};

const makeMulberry32 = (seed: number): Rng => {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const hashSeed = (seed: string): number => {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(31, h) + seed.charCodeAt(i);
    h |= 0;
  }
  return h;
};

const shuffle = <T>(values: readonly T[], rng: Rng): T[] => {
  const arr = values.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

export const createSeed = (): string => randomBytes(8).toString("hex");

const generateMap = (seed: string): { map: MapConfig; robberHex: string } => {
  const rng = makeMulberry32(hashSeed(seed));
  const tilesShuffled = shuffle(TILE_POOL, rng);
  const tiles: MapConfig["tiles"] = tilesShuffled.map((type, index) => ({
    hexId: HEX_IDS[index],
    type,
  }));

  const robberHex = tiles.find((tile) => tile.type === "desert")?.hexId ?? HEX_IDS[0];
  const numberTargets = tiles.filter((tile) => tile.type !== "desert");
  const numbers: MapConfig["numbers"] = shuffle(NUMBER_CHITS, rng).map((chit, index) => ({
    hexId: numberTargets[index]?.hexId ?? HEX_IDS[index],
    chit,
  }));

  const ports: MapConfig["ports"] = shuffle(PORT_TYPE_POOL, rng).map((type, index) => ({
    edgeId: PORT_EDGE_IDS[index] ?? PORT_EDGE_IDS[0],
    type,
  }));

  return { map: { tiles, numbers, ports }, robberHex };
};

const buildDevDeck = (seed: string): DevKind[] => {
  const deck: DevKind[] = [];
  for (const kind of DEV_CARD_KINDS) {
    const count = DEV_DECK_COMPOSITION[kind];
    for (let i = 0; i < count; i += 1) {
      deck.push(kind);
    }
  }
  const rng = makeMulberry32(hashSeed(`dev-${seed}`));
  return shuffle(deck, rng);
};

const emptyResMap = (): ResMap => {
  const map: Partial<ResMap> = {};
  for (const resource of RESOURCE_TYPES) {
    map[resource] = 0;
  }
  return map as ResMap;
};

export const createEmptyHand = (): HandDoc => ({
  resources: emptyResMap(),
  devCards: Object.fromEntries(DEV_CARD_KINDS.map((kind) => [kind, 0])) as Record<DevKind, number>,
  devNewlyBought: Object.fromEntries(DEV_CARD_KINDS.map((kind) => [kind, 0])) as Record<DevKind, number>,
  armyCount: 0,
});

export const createInitialBoard = (): BoardDoc => ({
  roads: [],
  settlements: [],
  cities: [],
  longestRoadCache: {},
});

export const createInitialBank = (deckSize: number): BankDoc => ({
  resources: { ...DEFAULT_BANK_RESOURCE_STOCK },
  devRemain: deckSize,
});

export const createInitialTrade = (): TradeDoc => ({
  phase: "idle",
  offer: null,
  visibleTo: [],
  deadlineAt: null,
});

export const createInitialMeta = (): MetaDoc => ({
  spectators: [],
  locked: false,
});

export const createInitialPlacementOrder = (turnOrder: string[]): string[] => {
  if (turnOrder.length === 0) {
    return [];
  }
  return [...turnOrder, ...turnOrder.slice().reverse()];
};

export const createInitialLongestRoadCache = (playerIds: string[]): Record<string, number> => {
  const cache: Record<string, number> = {};
  for (const id of playerIds) {
    cache[id] = 0;
  }
  return cache;
};

export const generateInitialConfig = (): { config: ConfigDoc; robberHex: string } => {
  const mapSeed = createSeed();
  const devSeed = createSeed();
  const { map, robberHex } = generateMap(mapSeed);
  const devDeckOrder = buildDevDeck(devSeed);
  const config: ConfigDoc = {
    map,
    devDeckSeed: devSeed,
    devDeckOrder,
    initialPlacementOrder: [],
  };
  return { config, robberHex };
};

export const nextAvailableColor = (used: Set<string>): string | null => {
  for (const color of PLAYER_COLORS) {
    if (!used.has(color)) {
      return color;
    }
  }
  return null;
};
