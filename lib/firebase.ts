// lib/firebase.ts
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyBq_F6fChX3xncAmQf_XyG9RGXB4G3bJ4Q",
  authDomain: "catan-web-37f7b.firebaseapp.com",
  projectId: "catan-web-37f7b",
  storageBucket: "catan-web-37f7b.firebasestorage.app",
  messagingSenderId: "119334722012",
  appId: "1:119334722012:web:969ee3497620343e385719",
};

const app = initializeApp(firebaseConfig);

// Services
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, "asia-east1");

// 在本地環境連線到 Emulator
if (process.env.NODE_ENV === "development") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099");
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}

export { auth, db, functions };
