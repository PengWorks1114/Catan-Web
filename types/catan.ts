export type Resource = "wood" | "brick" | "sheep" | "wheat" | "ore";

export const RESOURCE_TYPES: readonly Resource[] = [
  "wood",
  "brick",
  "sheep",
  "wheat",
  "ore",
] as const;

export type ResMap = Record<Resource, number>;

export type DevKind =
  | "knight"
  | "roadBuilding"
  | "yearOfPlenty"
  | "monopoly"
  | "vp";

export const DEV_CARD_KINDS: readonly DevKind[] = [
  "knight",
  "roadBuilding",
  "yearOfPlenty",
  "monopoly",
  "vp",
] as const;

export type GameStatus = "lobby" | "placing" | "playing" | "ended";
export type TurnPhase = "dice" | "action" | "end";
export type TradePhase = "idle" | "offer" | "counter" | "accepted" | "resolved";

export type PlayerColor = "red" | "blue" | "white" | "orange";
export const PLAYER_COLORS: readonly PlayerColor[] = [
  "red",
  "blue",
  "white",
  "orange",
] as const;

export interface TimestampLike {
  seconds: number;
  nanoseconds: number;
}

export interface GameDoc {
  code: string;
  status: GameStatus;
  createdAt: TimestampLike;
  hostUid: string;
  currentPlayer: string | null;
  round: number;
  turnOrder: string[];
  turnPhase: TurnPhase;
  robber: string;
  largestArmyOwner: string | null;
  longestRoadOwner: string | null;
  winner: { playerId: string; points: number } | null;
  schemaVersion: 1;
}

export interface PlayerPublicDoc {
  uid: string;
  name: string;
  color: PlayerColor;
  order: number;
  pointsPublic: number;
  hasLargestArmy: boolean;
  hasLongestRoad: boolean;
  connected: boolean;
}

export interface HandDoc {
  resources: ResMap;
  devCards: Record<DevKind, number>;
  devNewlyBought: Record<DevKind, number>;
  armyCount: number;
}

export interface RoadPiece {
  edgeId: string;
  owner: string;
}

export interface NodePiece {
  nodeId: string;
  owner: string;
}

export interface BoardDoc {
  roads: RoadPiece[];
  settlements: NodePiece[];
  cities: NodePiece[];
  longestRoadCache: Record<string, number>;
}

export interface TileConfig {
  hexId: string;
  type: Resource | "desert";
}

export interface NumberTokenConfig {
  hexId: string;
  chit: number;
}

export type PortType = "3:1" | Resource;

export interface PortConfig {
  edgeId: string;
  type: PortType;
}

export interface MapConfig {
  tiles: TileConfig[];
  numbers: NumberTokenConfig[];
  ports: PortConfig[];
}

export interface ConfigDoc {
  map: MapConfig;
  devDeckSeed: string;
  devDeckOrder: DevKind[];
  initialPlacementOrder: string[];
}

export interface BankDoc {
  resources: ResMap;
  devRemain: number;
}

export interface TradeDoc {
  phase: TradePhase;
  offer: {
    from: string | null;
    to: string | null;
    give: Partial<ResMap>;
    want: Partial<ResMap>;
    port: "3:1" | "2:1" | Resource | null;
  } | null;
  visibleTo: string[];
  deadlineAt: TimestampLike | null;
}

export type LogAction =
  | "dice"
  | "build"
  | "moveRobber"
  | "steal"
  | "trade"
  | "buyDev"
  | "playDev"
  | "endTurn"
  | "award"
  | "join"
  | "leave"
  | "reset";

export interface LogEntry {
  ts: TimestampLike;
  actor: string | null;
  action: LogAction;
  payload: Record<string, unknown> | null;
  seed?: string;
}

export interface MetaDoc {
  spectators: string[];
  locked: boolean;
}

export type Intent =
  | { type: "ROLL_DICE" }
  | { type: "BUILD_ROAD"; edgeId: string }
  | { type: "BUILD_SETTLEMENT"; nodeId: string }
  | { type: "BUILD_CITY"; nodeId: string }
  | { type: "BUY_DEV" }
  | { type: "PLAY_DEV"; dev: DevKind; args?: unknown }
  | { type: "MOVE_ROBBER"; hexId: string; stealFrom?: string | null }
  | { type: "TRADE_BANK"; give: ResMap; want: ResMap; port?: "3:1" | "2:1" }
  | { type: "TRADE_PLAYER"; to: string; give: ResMap; want: ResMap }
  | { type: "ACCEPT_TRADE"; from: string }
  | { type: "END_TURN" }
  | { type: "RESIGN" };

export interface CreateGameRequest {
  name?: string;
}

export interface CreateGameResponse {
  gameId: string;
  code: string;
}

export interface JoinGameRequest {
  code: string;
  name: string;
}

export interface JoinGameResponse {
  gameId: string;
}

export interface IntentRequest {
  gameId: string;
  intent: Intent;
  idempotencyKey?: string;
}

export interface IntentResponse {
  ok: true;
}

export interface ResetGameRequest {
  gameId: string;
}

export interface LeaveGameRequest {
  gameId: string;
}

export interface KickGameRequest {
  gameId: string;
  playerId: string;
}

export {};
