import leaderboard from "../leaderboards.js";
import { redisClient } from "../redis.js";

async function capLeaderboards() {
  const keys = await redisClient.keys("lb_*");

  const multi = redisClient.pipeline();

  for (const key of keys) {
    const lb = leaderboard(key);
    let lbLimit = 10000;

    if (key.endsWith("xp") || key.endsWith("completions")) {
      lbLimit = 100000;
    } else if (key.startsWith("lb_collection")) {
      lbLimit = 50000;
    }

    if (lb.sortedBy < 0) {
      redisClient.zremrangebyrank(key, 0, -lbLimit);
    } else {
      redisClient.zremrangebyrank(key, lbLimit, -1);
    }
  }

  await multi.exec();

  // console.log(`Capped ${keys.length} leaderboards in Redis!`);
  setTimeout(capLeaderboards, 30 * 60 * 1000);
}

capLeaderboards();
