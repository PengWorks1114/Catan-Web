import { randomBytes } from "crypto";
import * as admin from "firebase-admin";
import {
  HttpsError,
  CallableRequest,
  onCall,
} from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2/options";
import * as logger from "firebase-functions/logger";
import type {
  CreateGameRequest,
  CreateGameResponse,
  GameDoc,
  IntentRequest,
  JoinGameRequest,
  JoinGameResponse,
  KickGameRequest,
  LeaveGameRequest,
  LogEntry,
  PlayerPublicDoc,
  ResetGameRequest,
  TimestampLike,
} from "./types";
import {
  BANK_DOC_ID,
  BOARD_DOC_ID,
  CONFIG_DOC_ID,
  META_DOC_ID,
  TRADE_DOC_ID,
  createEmptyHand,
  createInitialBank,
  createInitialBoard,
  generateInitialConfig,
  createInitialLongestRoadCache,
  createInitialMeta,
  createInitialPlacementOrder,
  createInitialTrade,
  nextAvailableColor,
} from "./setup";

setGlobalOptions({ region: "asia-east1", maxInstances: 10 });

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

const GAMES_COLLECTION = "games";
const PLAYERS_SUBCOLLECTION = "players";
const HANDS_SUBCOLLECTION = "hands";
const BOARD_SUBCOLLECTION = "board";
const CONFIG_SUBCOLLECTION = "config";
const BANK_SUBCOLLECTION = "bank";
const TRADE_SUBCOLLECTION = "trade";
const META_SUBCOLLECTION = "meta";
const LOGS_SUBCOLLECTION = "logs";
const MAX_PLAYERS = 4;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 4;
const CODE_GENERATION_MAX_ATTEMPTS = 8;

const assertAuthenticated = <T>(request: CallableRequest<T>): string => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  return uid;
};

const sanitizeName = (name?: string | null): string => {
  const trimmed = (name ?? "").trim();
  if (!trimmed) {
    return "Player";
  }
  return trimmed.slice(0, 40);
};

const normalizeCode = (code?: string | null): string => {
  const cleaned = (code ?? "").trim().toUpperCase();
  if (cleaned.length !== CODE_LENGTH) {
    throw new HttpsError("invalid-argument", "Room code must be 4 characters.");
  }
  return cleaned;
};

const generateRoomCode = (): string => {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
};

const createUniqueRoomCode = async (): Promise<string> => {
  for (let attempt = 0; attempt < CODE_GENERATION_MAX_ATTEMPTS; attempt += 1) {
    const candidate = generateRoomCode();
    const existing = await db
      .collection(GAMES_COLLECTION)
      .where("code", "==", candidate)
      .limit(1)
      .get();
    if (existing.empty) {
      return candidate;
    }
  }
  throw new HttpsError("resource-exhausted", "Unable to allocate unique room code.");
};

const timestampNow = (): admin.firestore.Timestamp => admin.firestore.Timestamp.now();

const logGameEvent = async (
  gameRef: FirebaseFirestore.DocumentReference,
  entry: Omit<LogEntry, "ts">,
): Promise<void> => {
  const logRef = gameRef.collection(LOGS_SUBCOLLECTION).doc();
  await logRef.set({
    ts: timestampNow(),
    ...entry,
  });
};

const getGameByCode = async (code: string) => {
  const snapshot = await db
    .collection(GAMES_COLLECTION)
    .where("code", "==", code)
    .limit(1)
    .get();
  return snapshot.docs[0]?.ref ?? null;
};

export const gamesCreate = onCall<CreateGameRequest>(async (request) => {
  const uid = assertAuthenticated(request);
  const displayName = sanitizeName(request.data?.name);
  const code = await createUniqueRoomCode();
  const { config, robberHex } = generateInitialConfig();
  const createdAt = timestampNow();
  const gameRef = db.collection(GAMES_COLLECTION).doc();
  const batch = db.batch();

  const baseTurnOrder = [uid];
  const gameDoc: GameDoc = {
    code,
    status: "lobby",
    createdAt: createdAt as unknown as TimestampLike,
    hostUid: uid,
    currentPlayer: uid,
    round: 0,
    turnOrder: baseTurnOrder,
    turnPhase: "action",
    robber: robberHex,
    largestArmyOwner: null,
    longestRoadOwner: null,
    winner: null,
    schemaVersion: 1,
  };

  const playerDoc: PlayerPublicDoc = {
    uid,
    name: displayName,
    color: "red",
    order: 0,
    pointsPublic: 0,
    hasLargestArmy: false,
    hasLongestRoad: false,
    connected: true,
  };

  const board = createInitialBoard();
  board.longestRoadCache = createInitialLongestRoadCache(baseTurnOrder);

  batch.set(gameRef, { ...gameDoc, createdAt });
  batch.set(gameRef.collection(PLAYERS_SUBCOLLECTION).doc(uid), playerDoc);
  batch.set(gameRef.collection(HANDS_SUBCOLLECTION).doc(uid), createEmptyHand());
  batch.set(gameRef.collection(BOARD_SUBCOLLECTION).doc(BOARD_DOC_ID), board);
  batch.set(gameRef.collection(CONFIG_SUBCOLLECTION).doc(CONFIG_DOC_ID), config);
  batch.set(
    gameRef.collection(BANK_SUBCOLLECTION).doc(BANK_DOC_ID),
    createInitialBank(config.devDeckOrder.length),
  );
  batch.set(gameRef.collection(TRADE_SUBCOLLECTION).doc(TRADE_DOC_ID), createInitialTrade());
  batch.set(gameRef.collection(META_SUBCOLLECTION).doc(META_DOC_ID), createInitialMeta());

  await batch.commit();
  await logGameEvent(gameRef, {
    actor: uid,
    action: "join",
    payload: { name: displayName },
  });

  logger.info("Game created", { gameId: gameRef.id, code, hostUid: uid });
  return { gameId: gameRef.id, code } satisfies CreateGameResponse;
});

export const gamesJoin = onCall<JoinGameRequest>(async (request) => {
  const uid = assertAuthenticated(request);
  const code = normalizeCode(request.data?.code);
  const displayName = sanitizeName(request.data?.name);

  const gameRef = await getGameByCode(code);
  if (!gameRef) {
    throw new HttpsError("not-found", "Game not found for provided code.");
  }

  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) {
      throw new HttpsError("not-found", "Game not found.");
    }
    const game = gameSnap.data() as GameDoc;

    if (game.status === "ended") {
      throw new HttpsError("failed-precondition", "Game has already ended.");
    }

    const playersSnap = await tx.get(gameRef.collection(PLAYERS_SUBCOLLECTION));
    if (playersSnap.docs.some((doc) => doc.id === uid)) {
      throw new HttpsError("already-exists", "You are already seated in this game.");
    }

    if (playersSnap.size >= MAX_PLAYERS) {
      throw new HttpsError("resource-exhausted", "Game is already full.");
    }

    const players = playersSnap.docs
      .map((doc) => doc.data() as PlayerPublicDoc)
      .sort((a, b) => a.order - b.order);

    const usedColors = new Set(players.map((player) => player.color));
    const color = nextAvailableColor(usedColors);
    if (!color) {
      throw new HttpsError("internal", "Unable to assign a seat color.");
    }

    const order = players.length;
    const updatedTurnOrder = [...game.turnOrder.filter((id) => players.some((p) => p.uid === id)), uid];

    const playerDoc: PlayerPublicDoc = {
      uid,
      name: displayName,
      color: color as PlayerPublicDoc["color"],
      order,
      pointsPublic: 0,
      hasLargestArmy: false,
      hasLongestRoad: false,
      connected: true,
    };

    tx.set(gameRef.collection(PLAYERS_SUBCOLLECTION).doc(uid), playerDoc);
    tx.set(gameRef.collection(HANDS_SUBCOLLECTION).doc(uid), createEmptyHand());
    tx.update(gameRef, {
      turnOrder: updatedTurnOrder,
    });
    tx.set(
      gameRef.collection(BOARD_SUBCOLLECTION).doc(BOARD_DOC_ID),
      { [`longestRoadCache.${uid}`]: 0 },
      { merge: true },
    );

    if (updatedTurnOrder.length === MAX_PLAYERS) {
      tx.update(gameRef, {
        status: "placing",
        currentPlayer: updatedTurnOrder[0],
        round: 0,
      });
      tx.set(
        gameRef.collection(CONFIG_SUBCOLLECTION).doc(CONFIG_DOC_ID),
        { initialPlacementOrder: createInitialPlacementOrder(updatedTurnOrder) },
        { merge: true },
      );
    }
  });

  await logGameEvent(gameRef, {
    actor: uid,
    action: "join",
    payload: { name: displayName },
  });

  logger.info("Player joined game", { gameId: gameRef.id, uid });
  return { gameId: gameRef.id } satisfies JoinGameResponse;
});

export const gameIntent = onCall<IntentRequest>(async (request) => {
  assertAuthenticated(request);
  const gameId = (request.data?.gameId ?? "").trim();
  if (!gameId) {
    throw new HttpsError("invalid-argument", "gameId is required.");
  }
  logger.warn("Intent handler not yet implemented", {
    gameId,
    intent: request.data?.intent?.type ?? "unknown",
  });
  throw new HttpsError("unimplemented", "Intent handling is not implemented yet.");
});

export const gameReset = onCall<ResetGameRequest>((request) => {
  assertAuthenticated(request);
  throw new HttpsError("unimplemented", "Reset functionality is not implemented yet.");
});

export const gameLeave = onCall<LeaveGameRequest>((request) => {
  assertAuthenticated(request);
  throw new HttpsError("unimplemented", "Leave functionality is not implemented yet.");
});

export const gameKick = onCall<KickGameRequest>((request) => {
  assertAuthenticated(request);
  throw new HttpsError("unimplemented", "Kick functionality is not implemented yet.");
});
