import { randomBytes } from "crypto";
import * as admin from "firebase-admin";
import * as functions from "firebase-functions/v1";
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
  BoardDoc,
  PlayerPublicDoc,
  ResetGameRequest,
  TimestampLike,
} from "./contracts";
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

const { HttpsError } = functions.https;
const callableBuilder = functions.region("asia-east1").runWith({ maxInstances: 10 });

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

type PlayerWithId = {
  id: string;
  data: PlayerPublicDoc;
};

type OkResponse = { ok: true };

const getPlayerDocs = async (
  tx: FirebaseFirestore.Transaction,
  gameRef: FirebaseFirestore.DocumentReference,
): Promise<PlayerWithId[]> => {
  const playersSnap = await tx.get(gameRef.collection(PLAYERS_SUBCOLLECTION));
  return playersSnap.docs
    .map((doc) => ({ id: doc.id, data: doc.data() as PlayerPublicDoc }))
    .sort((a, b) => a.data.order - b.data.order);
};

const ensurePlayerInGame = (
  players: PlayerWithId[],
  playerId: string,
): PlayerWithId => {
  const target = players.find((p) => p.id === playerId);
  if (!target) {
    throw new HttpsError("failed-precondition", "Player is not seated in this game.");
  }
  return target;
};

const reindexPlayerOrders = (
  tx: FirebaseFirestore.Transaction,
  gameRef: FirebaseFirestore.DocumentReference,
  players: PlayerWithId[],
) => {
  players.forEach((player: PlayerWithId, index: number) => {
    if (player.data.order !== index) {
      tx.update(gameRef.collection(PLAYERS_SUBCOLLECTION).doc(player.id), { order: index });
    }
  });
};

const buildSeatRemovalGameUpdates = (
  game: GameDoc,
  remaining: PlayerWithId[],
  removedId: string,
): Record<string, unknown> => {
  const newTurnOrder = remaining.map((player) => player.id);
  const updates: Record<string, unknown> = {
    turnOrder: newTurnOrder,
  };

  if (game.hostUid === removedId) {
    updates.hostUid = newTurnOrder[0] ?? "";
  }

  const currentPlayerStillSeated =
    game.currentPlayer && newTurnOrder.includes(game.currentPlayer);
  if (!currentPlayerStillSeated) {
    updates.currentPlayer = newTurnOrder[0] ?? null;
    updates.turnPhase = "action";
  }

  if (game.longestRoadOwner === removedId) {
    updates.longestRoadOwner = null;
  }

  if (game.largestArmyOwner === removedId) {
    updates.largestArmyOwner = null;
  }

  if (game.status === "placing" && newTurnOrder.length < MAX_PLAYERS) {
    updates.status = "lobby";
    updates.round = 0;
  }

  if (newTurnOrder.length === 0) {
    updates.status = "lobby";
    updates.round = 0;
    updates.currentPlayer = null;
    updates.hostUid = "";
  }

  return updates;
};

const updateBoardAfterRemoval = (
  board: BoardDoc | null,
  remainingPlayerIds: string[],
  removedId: string,
): BoardDoc => {
  const base: BoardDoc = board ?? createInitialBoard();
  return {
    roads: base.roads.filter(
      (road: BoardDoc["roads"][number]) => road.owner !== removedId,
    ),
    settlements: base.settlements.filter(
      (node: BoardDoc["settlements"][number]) => node.owner !== removedId,
    ),
    cities: base.cities.filter(
      (node: BoardDoc["cities"][number]) => node.owner !== removedId,
    ),
    longestRoadCache: createInitialLongestRoadCache(remainingPlayerIds),
  };
};

const removePlayerDuringLobby = (
  tx: FirebaseFirestore.Transaction,
  gameRef: FirebaseFirestore.DocumentReference,
  game: GameDoc,
  players: PlayerWithId[],
  playerId: string,
) => {
  const remaining = players.filter((player: PlayerWithId) => player.id !== playerId);
  reindexPlayerOrders(tx, gameRef, remaining);

  tx.delete(gameRef.collection(PLAYERS_SUBCOLLECTION).doc(playerId));
  tx.delete(gameRef.collection(HANDS_SUBCOLLECTION).doc(playerId));

  const gameUpdates = buildSeatRemovalGameUpdates(game, remaining, playerId);
  tx.update(gameRef, gameUpdates);

  tx.set(
    gameRef.collection(BOARD_SUBCOLLECTION).doc(BOARD_DOC_ID),
    { longestRoadCache: createInitialLongestRoadCache(remaining.map((p) => p.id)) },
    { merge: true },
  );

  tx.set(
    gameRef.collection(CONFIG_SUBCOLLECTION).doc(CONFIG_DOC_ID),
    { initialPlacementOrder: [] },
    { merge: true },
  );

  return remaining;
};

const assertAuthenticated = (context: functions.https.CallableContext): string => {
  const uid = context.auth?.uid;
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

export const gamesCreate = callableBuilder.https.onCall(async (
  data: CreateGameRequest | undefined,
  context: functions.https.CallableContext,
) => {
  const uid = assertAuthenticated(context);
  const displayName = sanitizeName(data?.name);
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

export const gamesJoin = callableBuilder.https.onCall(async (
  data: JoinGameRequest | undefined,
  context: functions.https.CallableContext,
) => {
  const uid = assertAuthenticated(context);
  const code = normalizeCode(data?.code);
  const displayName = sanitizeName(data?.name);

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
    const updatedTurnOrder = [
      ...game.turnOrder.filter((id: string) => players.some((p) => p.uid === id)),
      uid,
    ];

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

export const gameIntent = callableBuilder.https.onCall(async (
  data: IntentRequest | undefined,
  context: functions.https.CallableContext,
) => {
  const uid = assertAuthenticated(context);
  const gameId = (data?.gameId ?? "").trim();
  const intent = data?.intent;

  if (!gameId) {
    throw new HttpsError("invalid-argument", "gameId is required.");
  }

  if (!intent) {
    throw new HttpsError("invalid-argument", "intent payload is required.");
  }

  const gameRef = db.collection(GAMES_COLLECTION).doc(gameId);

  switch (intent.type) {
    case "RESIGN": {
      let resignedPlayerName: string | null = null;
      await db.runTransaction(async (tx) => {
        const gameSnap = await tx.get(gameRef);
        if (!gameSnap.exists) {
          throw new HttpsError("not-found", "Game not found.");
        }
        const game = gameSnap.data() as GameDoc;

        const players = await getPlayerDocs(tx, gameRef);
        const player = ensurePlayerInGame(players, uid);
        resignedPlayerName = player.data.name;

        if (game.status === "lobby") {
          removePlayerDuringLobby(tx, gameRef, game, players, uid);
          return;
        }

        const remaining = players.filter((player) => player.id !== uid);
        reindexPlayerOrders(tx, gameRef, remaining);

        tx.delete(gameRef.collection(PLAYERS_SUBCOLLECTION).doc(uid));
        tx.delete(gameRef.collection(HANDS_SUBCOLLECTION).doc(uid));

        const boardRef = gameRef.collection(BOARD_SUBCOLLECTION).doc(BOARD_DOC_ID);
        const boardSnap = await tx.get(boardRef);
        const board = boardSnap.exists ? (boardSnap.data() as BoardDoc) : null;
        const updatedBoard = updateBoardAfterRemoval(
          board,
          remaining.map((player) => player.id),
          uid,
        );
        tx.set(boardRef, updatedBoard);

        const gameUpdates = buildSeatRemovalGameUpdates(game, remaining, uid);
        if (remaining.length === 0) {
          gameUpdates.status = "ended";
          gameUpdates.round = game.round;
          gameUpdates.currentPlayer = null;
          gameUpdates.winner = null;
        } else if (remaining.length === 1) {
          const sole = remaining[0];
          gameUpdates.status = "ended";
          gameUpdates.round = game.round;
          gameUpdates.currentPlayer = sole.id;
          gameUpdates.turnPhase = "action";
          gameUpdates.winner = {
            playerId: sole.id,
            points: sole.data.pointsPublic,
          };
        }

        tx.update(gameRef, gameUpdates);
        tx.set(
          gameRef.collection(TRADE_SUBCOLLECTION).doc(TRADE_DOC_ID),
          createInitialTrade(),
        );
      });

      await logGameEvent(gameRef, {
        actor: uid,
        action: "leave",
        payload: { resigned: true, name: resignedPlayerName },
      });

      return { ok: true } satisfies OkResponse;
    }
    default:
      throw new HttpsError("unimplemented", `Intent ${intent.type} is not implemented yet.`);
  }
});

export const gameReset = callableBuilder.https.onCall(async (
  data: ResetGameRequest | undefined,
  context: functions.https.CallableContext,
) => {
  const uid = assertAuthenticated(context);
  const gameId = (data?.gameId ?? "").trim();
  if (!gameId) {
    throw new HttpsError("invalid-argument", "gameId is required.");
  }

  const gameRef = db.collection(GAMES_COLLECTION).doc(gameId);
  const { config, robberHex } = generateInitialConfig();

  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) {
      throw new HttpsError("not-found", "Game not found.");
    }

    const game = gameSnap.data() as GameDoc;
    if (game.hostUid !== uid) {
      throw new HttpsError("permission-denied", "Only the host can reset the game.");
    }

    const players = await getPlayerDocs(tx, gameRef);
    const turnOrder = players.map((player: PlayerWithId) => player.id);

    players.forEach((player: PlayerWithId, index: number) => {
      tx.update(gameRef.collection(PLAYERS_SUBCOLLECTION).doc(player.id), {
        order: index,
        pointsPublic: 0,
        hasLargestArmy: false,
        hasLongestRoad: false,
        connected: true,
      });
    });

    const newBoard = createInitialBoard();
    newBoard.longestRoadCache = createInitialLongestRoadCache(turnOrder);

    const nextStatus = turnOrder.length === MAX_PLAYERS ? "placing" : "lobby";
    const nextCurrentPlayer = turnOrder[0] ?? null;

    tx.update(gameRef, {
      status: nextStatus,
      currentPlayer: nextCurrentPlayer,
      round: 0,
      turnOrder,
      turnPhase: "action",
      robber: robberHex,
      largestArmyOwner: null,
      longestRoadOwner: null,
      winner: null,
    });

    turnOrder.forEach((playerId: string) => {
      tx.set(
        gameRef.collection(HANDS_SUBCOLLECTION).doc(playerId),
        createEmptyHand(),
      );
    });

    tx.set(gameRef.collection(BOARD_SUBCOLLECTION).doc(BOARD_DOC_ID), newBoard);
    tx.set(
      gameRef.collection(CONFIG_SUBCOLLECTION).doc(CONFIG_DOC_ID),
      {
        ...config,
        initialPlacementOrder:
          nextStatus === "placing" ? createInitialPlacementOrder(turnOrder) : [],
      },
    );
    tx.set(
      gameRef.collection(BANK_SUBCOLLECTION).doc(BANK_DOC_ID),
      createInitialBank(config.devDeckOrder.length),
    );
    tx.set(gameRef.collection(TRADE_SUBCOLLECTION).doc(TRADE_DOC_ID), createInitialTrade());
  });

  await logGameEvent(gameRef, {
    actor: uid,
    action: "reset",
    payload: null,
  });

  return { ok: true } satisfies OkResponse;
});

export const gameLeave = callableBuilder.https.onCall(async (
  data: LeaveGameRequest | undefined,
  context: functions.https.CallableContext,
) => {
  const uid = assertAuthenticated(context);
  const gameId = (data?.gameId ?? "").trim();
  if (!gameId) {
    throw new HttpsError("invalid-argument", "gameId is required.");
  }

  const gameRef = db.collection(GAMES_COLLECTION).doc(gameId);

  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) {
      throw new HttpsError("not-found", "Game not found.");
    }

    const game = gameSnap.data() as GameDoc;
    if (game.status !== "lobby") {
      throw new HttpsError(
        "failed-precondition",
        "Cannot leave after the game has started. Use resign instead.",
      );
    }

    const players = await getPlayerDocs(tx, gameRef);
    ensurePlayerInGame(players, uid);

    removePlayerDuringLobby(tx, gameRef, game, players, uid);
  });

  await logGameEvent(gameRef, {
    actor: uid,
    action: "leave",
    payload: { voluntary: true },
  });

  return { ok: true } satisfies OkResponse;
});

export const gameKick = callableBuilder.https.onCall(async (
  data: KickGameRequest | undefined,
  context: functions.https.CallableContext,
) => {
  const uid = assertAuthenticated(context);
  const gameId = (data?.gameId ?? "").trim();
  const targetId = (data?.playerId ?? "").trim();
  if (!gameId || !targetId) {
    throw new HttpsError("invalid-argument", "gameId and playerId are required.");
  }

  const gameRef = db.collection(GAMES_COLLECTION).doc(gameId);

  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) {
      throw new HttpsError("not-found", "Game not found.");
    }

    const game = gameSnap.data() as GameDoc;
    if (game.hostUid !== uid) {
      throw new HttpsError("permission-denied", "Only the host can kick players.");
    }

    if (game.status !== "lobby") {
      throw new HttpsError("failed-precondition", "Players can only be kicked in the lobby.");
    }

    if (uid === targetId) {
      throw new HttpsError("failed-precondition", "Host cannot kick themselves.");
    }

    const players = await getPlayerDocs(tx, gameRef);
    ensurePlayerInGame(players, targetId);

    removePlayerDuringLobby(tx, gameRef, game, players, targetId);
  });

  await logGameEvent(gameRef, {
    actor: uid,
    action: "leave",
    payload: { kicked: true, targetId },
  });

  return { ok: true } satisfies OkResponse;
});
