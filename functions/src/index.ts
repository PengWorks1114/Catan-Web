import { setGlobalOptions } from "firebase-functions";
import { onRequest } from "firebase-functions/v2/https"; // ✅ 建議改用 v2 API
import * as logger from "firebase-functions/logger";

setGlobalOptions({ maxInstances: 10 });

// 範例函式，避免 TS 報錯
export const helloWorld = onRequest((request, response) => {
  logger.info("Hello logs!", { structuredData: true });
  response.send("Hello from Firebase!");
});
