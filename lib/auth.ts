import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { auth } from "./firebase";

let pendingSignIn: Promise<User> | null = null;

export const ensureAnonymousUser = async (): Promise<User> => {
  const current = auth.currentUser;
  if (current) {
    return current;
  }

  if (!pendingSignIn) {
    pendingSignIn = signInAnonymously(auth)
      .then((credential) => {
        if (!credential.user) {
          throw new Error("匿名登入失敗，請稍後再試。");
        }
        return credential.user;
      })
      .finally(() => {
        pendingSignIn = null;
      });
  }

  return pendingSignIn;
};

export const useAnonymousAuth = () => {
  const [user, setUser] = useState<User | null>(() => auth.currentUser);
  const [loading, setLoading] = useState(() => !auth.currentUser);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (next) => {
      setUser(next);
      if (next) {
        setLoading(false);
        setError(null);
      } else {
        setLoading(true);
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!auth.currentUser) {
      ensureAnonymousUser().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "匿名登入失敗，請稍後再試。";
        setError(message);
        setLoading(false);
      });
    }
  }, []);

  return { user, loading, error };
};
