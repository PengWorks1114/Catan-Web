"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  type Unsubscribe,
} from "firebase/firestore";
import type { GameDoc, PlayerPublicDoc } from "@/types/catan";
import { db } from "@/lib/firebase";
import { leaveGame, sendIntent } from "@/lib/api";
import { useAnonymousAuth } from "@/lib/auth";
import { describeError } from "@/lib/errors";
import Board from "@/components/Board";

type LoadingState = "idle" | "loading" | "ready";

const statusLabels: Record<GameDoc["status"], string> = {
  lobby: "等待玩家", 
  placing: "首置階段",
  playing: "遊戲進行中",
  ended: "遊戲已結束",
};

const phaseLabels: Record<GameDoc["turnPhase"], string> = {
  dice: "等待擲骰",
  action: "行動中",
  end: "回合結束",
};

const colorBadges: Record<PlayerPublicDoc["color"], string> = {
  red: "bg-rose-100 text-rose-800",
  blue: "bg-sky-100 text-sky-800",
  white: "bg-slate-100 text-slate-800",
  orange: "bg-amber-100 text-amber-800",
};

const formatPlayerLabel = (player: PlayerPublicDoc) => {
  const awards: string[] = [];
  if (player.hasLargestArmy) {
    awards.push("最大軍隊");
  }
  if (player.hasLongestRoad) {
    awards.push("最長道路");
  }
  return awards.length > 0 ? `${player.name}（${awards.join("、")}）` : player.name;
};

export default function RoomPage({ params }: { params: { gameId: string } }) {
  const router = useRouter();
  const { loading: authLoading, error: authError } = useAnonymousAuth();

  const [game, setGame] = useState<GameDoc | null>(null);
  const [players, setPlayers] = useState<PlayerPublicDoc[]>([]);
  const [loadingState, setLoadingState] = useState<LoadingState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (authError) {
      setError(authError);
      setLoadingState("ready");
      return;
    }

    let gameLoaded = false;
    let playersLoaded = false;
    setLoadingState("loading");
    setError(null);

    const updateReady = () => {
      if (gameLoaded && playersLoaded) {
        setLoadingState("ready");
      }
    };

    const unsubscribeGame: Unsubscribe = onSnapshot(
      doc(db, "games", params.gameId),
      (snapshot) => {
        gameLoaded = true;
        if (!snapshot.exists()) {
          setGame(null);
          setError("找不到這個房間，可能已被刪除或無存取權限。");
        } else {
          setGame(snapshot.data() as GameDoc);
        }
        updateReady();
      },
      (err) => {
        gameLoaded = true;
        setError(describeError(err));
        updateReady();
      },
    );

    const unsubscribePlayers: Unsubscribe = onSnapshot(
      query(
        collection(db, "games", params.gameId, "players"),
        orderBy("order", "asc"),
      ),
      (snapshot) => {
        playersLoaded = true;
        setPlayers(snapshot.docs.map((docSnap) => docSnap.data() as PlayerPublicDoc));
        updateReady();
      },
      (err) => {
        playersLoaded = true;
        setError(describeError(err));
        updateReady();
      },
    );

    return () => {
      unsubscribeGame();
      unsubscribePlayers();
    };
  }, [authLoading, authError, params.gameId]);

  const sortedPlayers = useMemo(() => players.slice().sort((a, b) => a.order - b.order), [players]);

  const currentPlayer = useMemo(() => {
    if (!game) {
      return null;
    }
    return sortedPlayers.find((player) => player.uid === game.currentPlayer) ?? null;
  }, [game, sortedPlayers]);

  const handleExit = async () => {
    if (!game) {
      router.push("/");
      return;
    }

    setActionLoading(true);
    try {
      if (game.status === "lobby") {
        await leaveGame(params.gameId);
      } else {
        await sendIntent(params.gameId, { type: "RESIGN" });
      }
      router.push("/");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setActionLoading(false);
    }
  };

  const renderBody = () => {
    if (loadingState === "loading") {
      return (
        <div className="flex h-80 items-center justify-center rounded-xl border border-slate-200 bg-white">
          <p className="text-sm text-slate-500">載入遊戲資料中…</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex h-80 flex-col items-center justify-center gap-3 rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-base font-semibold text-red-700">{error}</p>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-red-700"
          >
            返回首頁
          </button>
        </div>
      );
    }

    if (!game) {
      return (
        <div className="flex h-80 items-center justify-center rounded-xl border border-slate-200 bg-white">
          <p className="text-sm text-slate-500">找不到遊戲紀錄。</p>
        </div>
      );
    }

    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <Board />
        </section>
        <aside className="flex flex-col gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-700">房間資訊</h2>
            <dl className="mt-3 space-y-2 text-sm text-slate-600">
              <div className="flex items-center justify-between gap-3">
                <dt className="font-medium text-slate-700">房號</dt>
                <dd className="font-mono text-base tracking-widest text-slate-900">{game.code}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="font-medium text-slate-700">狀態</dt>
                <dd>{statusLabels[game.status]}</dd>
              </div>
              {currentPlayer && (
                <div className="flex items-center justify-between gap-3">
                  <dt className="font-medium text-slate-700">當前玩家</dt>
                  <dd>{currentPlayer.name}</dd>
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <dt className="font-medium text-slate-700">回合階段</dt>
                <dd>{phaseLabels[game.turnPhase]}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-700">玩家列表</h2>
            <ul className="mt-3 space-y-2">
              {sortedPlayers.map((player) => (
                <li key={player.uid} className="flex items-center justify-between gap-3 text-sm text-slate-700">
                  <span className={`inline-flex items-center gap-2 font-medium`}>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${colorBadges[player.color]}`}>
                      {player.color.toUpperCase()}
                    </span>
                    {formatPlayerLabel(player)}
                  </span>
                  <span className="text-xs text-slate-500">公開分數：{player.pointsPublic}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    );
  };

  return (
    <main className="flex min-h-screen flex-col bg-slate-100 px-4 py-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">對局房間</h1>
            <p className="text-sm text-slate-600">房號 {game?.code ?? params.gameId}</p>
          </div>
          <button
            type="button"
            onClick={handleExit}
            disabled={actionLoading}
            className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {actionLoading ? "處理中…" : game?.status === "lobby" ? "離開房間" : "投降 / 離場"}
          </button>
        </header>
        {renderBody()}
      </div>
    </main>
  );
}
