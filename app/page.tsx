"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useAnonymousAuth } from "@/lib/auth";
import { createGame, joinGame } from "@/lib/api";
import { describeError } from "@/lib/errors";

export default function Home() {
  const router = useRouter();
  const { loading: authLoading, error: authError } = useAnonymousAuth();

  const [createName, setCreateName] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [joinCode, setJoinCode] = useState("");
  const [joinName, setJoinName] = useState("");
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (authLoading) {
      return;
    }

    setCreateError(null);
    setCreateLoading(true);
    try {
      const response = await createGame(createName.trim() || undefined);
      router.push(`/room/${response.gameId}`);
    } catch (error) {
      setCreateError(describeError(error));
    } finally {
      setCreateLoading(false);
    }
  };

  const handleJoin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (authLoading) {
      return;
    }

    setJoinError(null);
    setJoinLoading(true);
    try {
      const response = await joinGame(joinCode.trim(), joinName.trim());
      router.push(`/room/${response.gameId}`);
    } catch (error) {
      setJoinError(describeError(error));
    } finally {
      setJoinLoading(false);
    }
  };

  const disabled = authLoading || createLoading || joinLoading;

  return (
    <main className="flex min-h-screen flex-col items-center bg-slate-100 px-4 py-12">
      <div className="w-full max-w-4xl space-y-10">
        <header className="text-center">
          <h1 className="text-4xl font-semibold text-slate-900">卡坦島桌遊</h1>
          <p className="mt-3 text-base text-slate-600">
            建立新的房間或輸入房號加入，開始四人對戰。伺服端會自動驗證所有規則。
          </p>
          {authError && (
            <p className="mt-2 text-sm font-medium text-red-600">{authError}</p>
          )}
        </header>

        <section className="grid gap-6 md:grid-cols-2">
          <form
            onSubmit={handleCreate}
            className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <h2 className="text-lg font-semibold text-slate-900">建立房間</h2>
            <p className="mt-1 text-sm text-slate-600">
              系統會立即為你產生地圖、骰子種子與發展卡牌庫。
            </p>
            <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="create-name">
              暱稱（選填）
            </label>
            <input
              id="create-name"
              type="text"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder="Ex. 紅色玩家"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              disabled={disabled}
              maxLength={40}
            />
            <button
              type="submit"
              disabled={disabled}
              className="mt-5 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
            >
              {createLoading ? "建立中…" : "建立新房間"}
            </button>
            {createError && (
              <p className="mt-3 text-sm font-medium text-red-600">{createError}</p>
            )}
          </form>

          <form
            onSubmit={handleJoin}
            className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <h2 className="text-lg font-semibold text-slate-900">加入房間</h2>
            <p className="mt-1 text-sm text-slate-600">
              向房主索取房號，輸入後即可加入並等待其他玩家。
            </p>
            <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="join-code">
              房號
            </label>
            <input
              id="join-code"
              type="text"
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
              placeholder="例如 6LQ7"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase tracking-widest focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              disabled={disabled}
              maxLength={4}
              required
            />
            <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="join-name">
              暱稱
            </label>
            <input
              id="join-name"
              type="text"
              value={joinName}
              onChange={(event) => setJoinName(event.target.value)}
              placeholder="Ex. 藍色玩家"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              disabled={disabled}
              maxLength={40}
              required
            />
            <button
              type="submit"
              disabled={disabled || joinCode.trim().length !== 4}
              className="mt-5 w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
            >
              {joinLoading ? "加入中…" : "加入既有房間"}
            </button>
            {joinError && (
              <p className="mt-3 text-sm font-medium text-red-600">{joinError}</p>
            )}
          </form>
        </section>
      </div>
    </main>
  );
}
