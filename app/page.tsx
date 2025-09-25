"use client";

import { useEffect } from "react";
import { auth, db } from "@/lib/firebase";
import { signInAnonymously } from "firebase/auth";
import { collection, addDoc, getDocs } from "firebase/firestore";

export default function Home() {
  useEffect(() => {
    // 匿名登入
    signInAnonymously(auth).then(() => {
      console.log("✅ Signed in anonymously");
    });

    // 測試 Firestore
    (async () => {
      const ref = collection(db, "test");
      await addDoc(ref, { createdAt: new Date() });
      const snap = await getDocs(ref);
      console.log(
        "📂 Firestore docs:",
        snap.docs.map((d) => d.data())
      );
    })();

    // 測試 Functions (helloWorld)
    (async () => {
      try {
        const res = await fetch(
          "http://127.0.0.1:5001/catan-web-37f7b/us-central1/helloWorld"
        );
        const text = await res.text();
        console.log("🛰️ Functions helloWorld:", text);
      } catch (err) {
        console.error("❌ Functions call failed:", err);
      }
    })();
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <h1 className="text-3xl font-bold">Catan Web Connected ✔</h1>
    </main>
  );
}
