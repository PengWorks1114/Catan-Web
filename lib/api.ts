import { httpsCallable } from "firebase/functions";
import type {
  CreateGameRequest,
  CreateGameResponse,
  JoinGameRequest,
  JoinGameResponse,
  Intent,
  IntentRequest,
  IntentResponse,
  KickGameRequest,
  LeaveGameRequest,
  ResetGameRequest,
} from "@/types/catan";
import { functions } from "./firebase";

type OkResponse = { ok: true };

const createCallable = httpsCallable<CreateGameRequest, CreateGameResponse>(functions, "gamesCreate");
const joinCallable = httpsCallable<JoinGameRequest, JoinGameResponse>(functions, "gamesJoin");
const intentCallable = httpsCallable<IntentRequest, IntentResponse>(functions, "gameIntent");
const resetCallable = httpsCallable<ResetGameRequest, OkResponse>(functions, "gameReset");
const leaveCallable = httpsCallable<LeaveGameRequest, OkResponse>(functions, "gameLeave");
const kickCallable = httpsCallable<KickGameRequest, OkResponse>(functions, "gameKick");

export const createGame = async (name?: string) => {
  const payload: CreateGameRequest = {};
  if (name) {
    payload.name = name;
  }
  const { data } = await createCallable(payload);
  return data;
};

export const joinGame = async (code: string, name: string) => {
  const payload: JoinGameRequest = { code, name };
  const { data } = await joinCallable(payload);
  return data;
};

export const sendIntent = async (gameId: string, intent: Intent, idempotencyKey?: string) => {
  const payload: IntentRequest = { gameId, intent };
  if (idempotencyKey) {
    payload.idempotencyKey = idempotencyKey;
  }
  await intentCallable(payload);
};

export const resetGame = async (gameId: string) => {
  await resetCallable({ gameId });
};

export const leaveGame = async (gameId: string) => {
  await leaveCallable({ gameId });
};

export const kickPlayer = async (gameId: string, playerId: string) => {
  await kickCallable({ gameId, playerId });
};
