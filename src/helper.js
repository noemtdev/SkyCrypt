import cluster from "cluster";
import axios from "axios";
import sanitize from "mongo-sanitize";
import retry from "async-retry";
// import path from "path";
import "axios-debug-log";
import { v4 } from "uuid";
import { getPrices } from "skyhelper-networth";
// import { execSync } from "child_process";

import { titleCase } from "../common/helper.js";
// import { getFolderPath } from "./helper/cache.js";

export { renderLore, formatNumber } from "../common/formatting.js";
export * from "../common/helper.js";

export * from "./helper/cache.js";
export * from "./helper/item.js";

import {
  GUILD_XP,
  COLOR_NAMES,
  RANKS,
  GEMSTONES,
  STATS_DATA,
  RARITIES,
  RARITY_COLORS,
  HOTM,
  TYPE_TO_CATEGORIES,
  ENCHANTMENTS_TO_CATEGORIES,
  PET_DATA,
  PET_RARITY_OFFSET,
  PET_LEVELS,
  ITEM_ANIMATIONS,
  MAGICAL_POWER,
} from "./constants.js";

import credentials from "./credentials.js";

const hypixel = axios.create({
  baseURL: "https://api.hypixel.net/",
});

/**
 * converts a string to a number if it can be converted
 * @param {string} key
 * @returns {string|number}
 */
function getKey(key) {
  const intKey = new Number(key);

  if (!isNaN(intKey)) {
    return intKey;
  }

  return key;
}

/**
 * @param {any} obj an object
 * @param  {...(string|number)} keys a path
 * @returns {boolean} if the path exists on the object
 */
export function hasPath(obj, ...keys) {
  if (obj == null) {
    return false;
  }

  let loc = obj;

  for (let i = 0; i < keys.length; i++) {
    loc = loc[getKey(keys[i])];

    if (loc === undefined) {
      return false;
    }
  }

  return true;
}

/**
 * @param {any} obj an object
 * @param  {...(string|number)} keys a path
 * @returns {any} the value at the path on the object
 */
export function getPath(obj, ...keys) {
  if (obj == null) {
    return undefined;
  }

  let loc = obj;

  for (let i = 0; i < keys.length; i++) {
    loc = loc[getKey(keys[i])];

    if (loc === undefined) {
      return undefined;
    }
  }

  return loc;
}

/**
 * @deprecated because it's inefficient
 *
 * sets value at path on object
 * @param {any} obj an object
 * @param {any} value a value
 * @param  {...(string|number)} keys a path
 */
export function setPath(obj, value, ...keys) {
  let i;
  let loc = obj || {};

  for (i = 0; i < keys.length - 1; i++) {
    loc[keys[i]] ??= {};

    loc = loc[keys[i]];
  }

  loc[keys[i]] = value;
}

export function getId(item) {
  return item?.tag?.ExtraAttributes?.id ?? "";
}

export async function resolveUsernameOrUuid(uuid, db, cacheOnly = false) {
  let user = null;

  uuid = uuid.replaceAll("-", "");

  const isUuid = uuid.length == 32;

  if (isUuid) {
    user = await db.collection("usernames").findOne({ uuid: sanitize(uuid) });
  } else {
    const playerObjects = await db
      .collection("usernames")
      .find({ $text: { $search: sanitize(uuid) } })
      .toArray();

    for (const doc of playerObjects) {
      if (doc.username.toLowerCase() == uuid.toLowerCase()) {
        user = doc;
      }
    }
  }

  const DEFAULT_ALEX_SKIN =
    "https://textures.minecraft.net/texture/3b60a1f6d562f52aaebbf1434f1de147933a3affe0e764fa49ea057536623cd3";

  /** @type {{model:"default"|"slim"; skinurl:string; capeurl?:string;}} */
  const skinData = {
    skinurl: DEFAULT_ALEX_SKIN,
    model: "slim",
  };

  if (user?.skinurl != undefined) {
    skinData.skinurl = user.skinurl;
    skinData.model = user.model;

    if (user?.capeurl != undefined) {
      skinData.capeurl = user.capeurl;
    }
  }

  if (cacheOnly === false && (user == undefined || +new Date() - user.date > 7200 * 1000)) {
    const profileRequest = axios(`https://api.ashcon.app/mojang/v2/user/${uuid}`, { timeout: 5000 });

    profileRequest
      .then(async (response) => {
        try {
          const { data } = response;

          data.id = data.uuid.replaceAll("-", "");

          let updateDoc = {
            username: data.username,
            date: +new Date(),
          };

          if (data.textures?.skin != undefined) {
            skinData.skinurl = data.textures.skin.url;
            skinData.model = data.textures.slim ? "slim" : "default";
          }

          if (data.textures?.cape != undefined) {
            skinData.capeurl = data.textures.cape.url;
          }

          updateDoc = Object.assign(updateDoc, skinData);

          await db.collection("usernames").updateOne({ uuid: data.id }, { $set: updateDoc }, { upsert: true });

          const playerObjects = await db.collection("usernames").find({ $text: { $search: data.username } });

          for await (const doc of playerObjects) {
            if (doc.uuid == data.id) {
              continue;
            }

            if (doc.username.toLowerCase() == data.username.toLowerCase()) {
              await db.collection("usernames").deleteOne({ _id: doc._id });

              resolveUsernameOrUuid(doc.uuid, db).catch(console.error);
            }
          }
        } catch (e) {
          console.error(e);
        }
      })
      .catch(async (err) => {
        if (user) {
          await db.collection("usernames").updateOne({ uuid: user.uuid }, { $set: { date: +new Date() } });
        }

        console.error(err);
      });

    if (!user) {
      try {
        const { data } = await profileRequest;

        data.id = data.uuid.replaceAll("-", "");

        if (data.textures?.skin != undefined) {
          skinData.skinurl = data.textures.skin.url;
          skinData.model = data.textures.slim ? "slim" : "default";
        }

        if (data.textures?.cape != undefined) {
          skinData.capeurl = data.textures.cape.url;
        }

        return { uuid: data.id, display_name: data.username, skin_data: skinData };
      } catch (e) {
        if (isUuid) {
          return { uuid, display_name: uuid, skin_data: skinData };
        } else {
          throw new Error(e?.response?.data?.reason ?? "Failed resolving username.");
        }
      }
    }
  }

  if (user) {
    return { uuid: user.uuid, display_name: user.username, emoji: user.emoji, skin_data: skinData };
  } else {
    return { uuid, display_name: uuid, skin_data: skinData };
  }
}

export async function getGuild(uuid, db, cacheOnly = false) {
  uuid = sanitize(uuid);
  const cachedGuild = await db.collection("guildMembers").findOne({ uuid });
  const guildID = cachedGuild?.gid;

  let guildObject = await db.collection("guilds").findOne({ gid: sanitize(guildID) });

  // Integrating from old caching system (new Date() -> Date.now())
  if (typeof guildObject?.last_updated === "object") {
    guildObject.last_updated = new Date(guildObject.last_updated).getTime();
  }

  if (
    guildObject == undefined ||
    cacheOnly ||
    Date.now() - guildObject.last_updated > 7200 * 1000 ||
    guildObject.last_updated == undefined
  ) {
    const {
      data: { guild: guildResponse },
    } = await hypixel.get("guild", {
      params: { player: uuid, key: credentials.hypixel_api_key },
    });

    if (guildResponse === null) {
      return null;
    }

    const guildMaster = guildResponse.members.find((member) =>
      ["guild master", "guildmaster"].includes(member.rank.toLowerCase())
    ).uuid;
    guildObject = {
      ...guildResponse,
      last_updated: Date.now(),
      gm: guildMaster,
      gmUser: await resolveUsernameOrUuid(guildMaster, db, true),
      rank: guildResponse.members.find((member) => member.uuid == uuid).rank,
      level: getGuildLevel(guildResponse.exp),
      id: guildResponse._id,
    };

    // Required otherwise mongoDB will throw an error
    delete guildObject._id;

    await db.collection("guilds").updateOne({ gid: guildObject.id }, { $set: guildObject }, { upsert: true });
  }

  return guildObject;
}

export function getGuildLevel(xp) {
  let level = 0;

  while (true) {
    const xpNeeded = GUILD_XP[Math.min(GUILD_XP.length - 1, level)];

    if (xp > xpNeeded) {
      xp -= xpNeeded;
      level++;
    } else {
      return level;
    }
  }
}

/**
 * Get Minecraft lore without the color and formatting codes
 * @param {string} text lore with color codes
 * @returns {string} lore without color codes
 */
export function getRawLore(text) {
  return text.replaceAll(/§[0-9a-fk-or]/g, "");
}

/**
 * returns a string with 4 dots "●" for completed tiers and "○" for incomplete tiers
 * @param {number} completeTiers
 * @returns {string} 4 dots
 */
export function renderRaceTier(completeTiers) {
  const incompleteTiers = Math.max(0, 4 - completeTiers);
  return "●".repeat(completeTiers) + "○".repeat(incompleteTiers);
}

/**
 * checks whether a string should be proceeded by a or by an
 * @param {string} string
 * @returns {"a"|"an"}
 * @example
 * // returns "a"
 * aOrAn("cat");
 * @example
 * // returns "an"
 * aOrAn("egg");
 */
export function aOrAn(string) {
  return ["a", "e", "i", "o", "u"].includes(string.charAt(0).toLowerCase()) ? "an" : "a";
}

/**
 * returns a object with they key sorted
 * @param {object} obj
 * @returns {object}
 */
export function sortObject(obj) {
  return Object.keys(obj)
    .sort()
    .reduce(function (res, key) {
      res[key] = obj[key];
      return res;
    }, {});
}

export function getPrice(orderSummary) {
  orderSummary = orderSummary.slice(0, Math.ceil(orderSummary.length / 2));

  const orders = [];

  const totalVolume = orderSummary.map((a) => a.amount).reduce((a, b) => a + b, 0);
  const volumeTop2 = Math.ceil(totalVolume * 0.02);

  let volume = 0;

  for (const order of orderSummary) {
    const cappedAmount = Math.min(order.amount, volumeTop2 - volume);

    orders.push([order.pricePerUnit, cappedAmount]);

    volume += cappedAmount;

    if (volume >= volumeTop2) {
      break;
    }
  }

  const totalWeight = orders.reduce((sum, value) => sum + value[1], 0);

  return orders.reduce((mean, value) => mean + (value[0] * value[1]) / totalWeight, 0);
}

export function getBazaarPrices(product) {
  return {
    buyPrice: getPrice(product.buy_summary),
    sellPrice: getPrice(product.sell_summary),
  };
}

/**
 * calculates the letter grade of a dungeon Run
 * @param {{score_exploration:number,score_speed:number,score_skill:number,score_bonus:number}} data dungeon run
 * @returns {"S+"|"S"|"A"|"B"|"C"|"D"} letter grade
 */
export function calcDungeonGrade(data) {
  const totalScore = data.score_exploration + data.score_speed + data.score_skill + data.score_bonus;
  if (totalScore <= 99) {
    return "D";
  } else if (totalScore <= 159) {
    return "C";
  } else if (totalScore <= 229) {
    return "B";
  } else if (totalScore <= 269) {
    return "A";
  } else if (totalScore <= 299) {
    return "S";
  } else {
    return "S+";
  }
}

export function parseRank(player) {
  const output = {
    rankText: null,
    rankColor: null,
    plusText: null,
    plusColor: null,
  };

  const rankName = player.prefix
    ? getRawLore(player.prefix).replaceAll(/\[|\]/g, "")
    : player.rank && player.rank != "NORMAL"
    ? player.rank
    : player.monthlyPackageRank && player.monthlyPackageRank != "NONE"
    ? player.monthlyPackageRank
    : player.newPackageRank
    ? player.newPackageRank
    : player.packageRank
    ? player.packageRank
    : "NONE";

  if (RANKS[rankName]) {
    const { tag, color, plus, plusColor } = RANKS[rankName];
    output.rankText = tag;

    if (rankName == "SUPERSTAR") {
      output.rankColor = COLOR_NAMES[player.monthlyRankColor] ?? color;
    } else {
      output.rankColor = color;
    }

    if (plus) {
      output.plusText = plus;

      if (rankName == "SUPERSTAR" || rankName == "MVP_PLUS") {
        output.plusColor = COLOR_NAMES[player.rankPlusColor] ?? plusColor;
      } else {
        output.plusColor = plusColor;
      }
    }
  }

  return output;
}

export function renderRank({ rankText, rankColor, plusText, plusColor }) {
  if (rankText === null) {
    return "";
  } else {
    return /*html*/ `
        <div class="rank-tag nice-colors-dark">
            <div class="rank-name" style="background-color: var(--§${rankColor})">${rankText}</div>
            ${
              plusText
                ? /*html*/ `<div class="rank-plus" style="background-color: var(--§${plusColor})">${plusText}</div>`
                : ""
            }
        </div>
      `;
  }
}

export async function updateRank(uuid, db) {
  let rank = {
    rankText: null,
    rankColor: null,
    plusText: null,
    plusColor: null,
    socials: {},
    achievements: {},
    claimed_items: {},
  };

  try {
    const response = await retry(async () => {
      return await hypixel.get("player", {
        params: {
          key: credentials.hypixel_api_key,
          uuid,
        },
      });
    });

    const player = response.data.player;

    rank = Object.assign(rank, parseRank(player));

    if (player?.socialMedia?.links != undefined) {
      rank.socials = player.socialMedia.links;
    }

    if (player?.achievements != undefined) {
      rank.achievements = player.achievements;
    }

    const claimable = {
      claimed_potato_talisman: "Potato Talisman",
      claimed_potato_basket: "Potato Basket",
      claim_potato_war_silver_medal: "Silver Medal (Potato War)",
      claim_potato_war_crown: "Crown (Potato War)",
      skyblock_free_cookie: "Free Booster Cookie",
    };

    for (const item in claimable) {
      if (player?.[item]) {
        rank.claimed_items[claimable[item]] = player[item];
      }
    }

    // Scorpius Bribe
    for (const key of Object.keys(player).filter((key) => key.match(/^scorpius_bribe_\d+$/))) {
      rank.claimed_items[`Scorpius Bribe (Year ${key.split("_").pop()})`] = player[key];
    }
  } catch (e) {
    console.error(e);
  }

  rank.last_updated = new Date();

  await db.collection("hypixelPlayers").updateOne({ uuid: sanitize(uuid) }, { $set: rank }, { upsert: true });

  return rank;
}

export async function getRank(uuid, db, cacheOnly = false) {
  uuid = sanitize(uuid);

  let hypixelPlayer = await db.collection("hypixelPlayers").findOne({ uuid });

  let updateRankPromise;

  if (cacheOnly === false && (hypixelPlayer == undefined || +new Date() - hypixelPlayer.last_updated > 3600 * 1000)) {
    updateRankPromise = updateRank(uuid, db);
  }

  if (cacheOnly === false && hypixelPlayer == undefined) {
    hypixelPlayer = await updateRankPromise;
  }

  hypixelPlayer ??= { achievements: {} };

  return hypixelPlayer;
}

export async function fetchMembers(profileId, db, returnUuid = false) {
  let output = [];
  profileId = sanitize(profileId);

  const members = await db.collection("members").find({ profile_id: profileId }).toArray();

  if (members.length == 0) {
    const profileResponse = await hypixel.get("skyblock/profile", {
      params: { key: credentials.hypixel_api_key, profile: profileId },
    });

    const memberPromises = [];

    for (const member in profileResponse.data.profile.members) {
      memberPromises.push(resolveUsernameOrUuid(member, db));
    }

    const profileMembers = await Promise.all(memberPromises);

    for (const profileMember of profileMembers) {
      await db
        .collection("members")
        .replaceOne(
          { profile_id: profileId, uuid: profileMember.uuid },
          { profile_id: profileId, uuid: profileMember.uuid, username: profileMember.display_name },
          { upsert: true }
        );
    }

    if (returnUuid) {
      output = profileMembers;
    } else {
      output = profileMembers.map((a) => a.display_name);
    }
  } else {
    if (returnUuid) {
      output = members.map((a) => {
        return { uuid: a.uuid, display_name: a.username };
      });
    } else {
      output = members.map((a) => a.username);
    }
  }

  return output;
}

export function getClusterId(fullName = false) {
  if (fullName) {
    return cluster.isWorker ? `worker${cluster.worker.id}` : "master";
  }

  return cluster.isWorker ? `w${cluster.worker.id}` : "m";
}

export const generateDebugId = (endpointName = "unknown") => {
  return `${getClusterId()}/${endpointName}_${Date.now()}.${Math.floor(Math.random() * 9000 + 1000)}`;
};

export function generateUUID() {
  let u = "",
    i = 0;
  while (i++ < 36) {
    const c = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"[i - 1],
      r = (Math.random() * 16) | 0,
      v = c == "x" ? r : (r & 0x3) | 0x8;
    u += c == "-" || c == "4" ? c : v.toString(16);
  }
  return u;
}

/**
 * @typedef {{slot_type:string,slot_number:number,gem_type:string,gem_tier:string,lore:string}} Gem
 */

/**
 * @param  {{[key:string]:string}} gems item.ExtraAttributes.gems
 * @param  {string} [rarity] item rarity, ex: MYTHIC
 *
 * @returns {Gem[]} array of gem objects
 */
export function parseItemGems(gems, rarity) {
  /** @type {Gem[]} */

  const slots = {
    normal: Object.keys(GEMSTONES),
    special: ["UNIVERSAL", "COMBAT", "OFFENSIVE", "DEFENSIVE", "MINING"],
    ignore: ["unlocked_slots"],
  };

  const parsed = [];
  for (const [key, value] of Object.entries(gems)) {
    const slot_type = key.split("_")[0];

    if (slots.ignore.includes(key) || (slots.special.includes(slot_type) && key.endsWith("_gem"))) {
      continue;
    }

    if (slots.special.includes(slot_type)) {
      parsed.push({
        slot_type,
        slot_number: +key.split("_")[1],
        gem_type: gems[`${key}_gem`],
        gem_tier: value?.quality || value,
      });
    } else if (slots.normal.includes(slot_type)) {
      parsed.push({
        slot_type,
        slot_number: +key.split("_")[1],
        gem_type: key.split("_")[0],
        gem_tier: value?.quality || value,
      });
    } else {
      throw new Error(`Error! Unknown gemstone slot key: ${key}`);
    }
  }

  parsed.forEach((gem) => {
    gem.lore = generateGemLore(gem.gem_type, gem.gem_tier, rarity);
  });

  return parsed;
}

/**
 * @param  {string} type gem name, ex: RUBY
 * @param  {string} tier gem tier, ex: PERFECT
 * @param  {string} [rarity] item rarity, ex: MYTHIC
 *
 * @returns {string} formatted gem string
 *
 * @example
 * // returns "§cPerfect Ruby §7(§c+25❤§7)"
 * generateGemLore("RUBY", "PERFECT", "MYTHIC");
 */
export function generateGemLore(type, tier, rarity) {
  const lore = [];
  const stats = [];

  // Gem color
  const color = `§${GEMSTONES[type.toUpperCase()].color}`;

  // Gem stats
  if (rarity) {
    const gemstone_stats = GEMSTONES[type.toUpperCase()]?.stats?.[tier.toUpperCase()];
    if (gemstone_stats) {
      Object.keys(gemstone_stats).forEach((stat) => {
        let stat_value = gemstone_stats[stat][rarityNameToInt(rarity)];

        // Fallback since skyblock devs didn't code all gemstone stats for divine rarity yet
        // ...they didn't expect people to own divine tier items other than divan's drill
        if (rarity.toUpperCase() === "DIVINE" && stat_value === null) {
          stat_value = gemstone_stats[stat][rarityNameToInt("MYTHIC")];
        }

        if (stat_value) {
          stats.push(["§", STATS_DATA[stat].color, "+", stat_value, " ", STATS_DATA[stat].symbol].join(""));
        } else {
          stats.push("§c§oMISSING VALUE§r");
        }
      });
    }
  }

  // Final lore
  lore.push(color, titleCase(tier), " ", titleCase(type));

  if (stats.length) {
    lore.push("§7 (", stats.join("§7, "), "§7)");
  }

  return lore.join("");
}

export function rarityNameToInt(string) {
  return RARITIES.indexOf(string.toLowerCase());
}

/**
 * floors a number to a certain number of decimal places
 * @param {number} num the number to be floored
 * @param {number} decimals the number of decimal places to floor to
 * @returns {number} the floored number
 */
export function floor(num, decimals = 0) {
  return Math.floor(Math.pow(10, decimals) * num) / Math.pow(10, decimals);
}

/**
 * ceils a number to a certain number of decimal places
 * @param {number} num the number to be ceiled
 * @param {number} decimals the number of decimal places to ceil to
 * @returns {number} the ceiled number
 */
export function ceil(num, decimals = 0) {
  return Math.ceil(Math.pow(10, decimals) * num) / Math.pow(10, decimals);
}

export function generateItem(data) {
  if (!data) {
    return {
      itemId: v4("itemid"),
      item_index: Date.now(),
    };
  }

  const default_data = {
    id: 389,
    Damage: 0,
    Count: 1,
    display_name: "",
    rarity: null,
    categories: [],
    type: "misc",
    tag: {
      display: {
        Name: "",
        Lore: [""],
      },
    },
    itemId: v4("itemid"),
    item_index: Date.now(),
  };

  // Making sure rarity is lowercase
  if (data.rarity) {
    data.rarity = data.rarity.toLowerCase();
  }

  if (data.name && (data.display_name === undefined || data.display_name?.length === 0)) {
    data.display_name = data.name;
  }

  if (!data.rarity && data.tier) {
    data.rarity = data.tier.toLowerCase();
  }

  if (data.item_id) {
    data.id = data.item_id;
  }

  if (data.damage) {
    data.Damage = data.damage;
  }

  // Setting tag.display.Name using display_name if not specified
  if (data.display_name && !data.tag?.display?.Name) {
    data.tag = data.tag ?? {};
    data.tag.display = data.tag.display ?? {};
    const rarityColor = data.rarity ? `§${RARITY_COLORS[data.rarity ?? "common"]}` : "";
    data.tag.display.Name = `${rarityColor}${data.display_name}`;
  }

  // Creating final item
  return Object.assign(default_data, data);
}

/**
 * @param {number} hotmTier
 * @param {number} potmTier
 * @returns {number}
 */
export function calcHotmTokens(hotmTier, potmTier) {
  let tokens = 0;

  for (let tier = 1; tier <= hotmTier; tier++) {
    tokens += HOTM.rewards.hotm[tier]?.token_of_the_mountain || 0;
  }

  for (let tier = 1; tier <= potmTier; tier++) {
    tokens += HOTM.rewards.potm[tier]?.token_of_the_mountain || 0;
  }

  return tokens;
}

/**
 * convert an amount of seconds into seconds minutes and hours
 * @param {string} seconds
 * @param {"friendly"|"friendlyhhmm"|"clock"} format
 * @param {boolean} alwaysTwoDigits
 * @returns {string}
 */
export function convertHMS(seconds, format = "clock", alwaysTwoDigits = false) {
  seconds = parseInt(seconds, 10);

  let hh = Math.floor(seconds / 3600);
  let mm = Math.floor((seconds - hh * 3600) / 60);
  let ss = seconds - hh * 3600 - mm * 60;

  if (alwaysTwoDigits) {
    hh = hh < 10 ? `0${hh}` : hh;
    mm = mm < 10 ? `0${mm}` : mm;
    ss = ss < 10 ? `0${ss}` : ss;
  }

  switch (format) {
    case "friendly":
      return `${hh} hours, ${mm} minutes and ${ss} seconds`;
    case "friendlyhhmm":
      return `${hh} hours and ${mm} minutes`;
    // clock
    default:
      return `${hh}:${mm}:${ss}`;
  }
}

export function parseItemTypeFromLore(lore, item) {
  const regex = new RegExp(
    `^(?<recomb>a )?(?<shiny>SHINY )?(?:(?<rarity>${RARITIES.map((x) => x.replaceAll("_", " ").toUpperCase()).join(
      "|"
    )}) ?)(?<dungeon>DUNGEON )?(?<type>[A-Z ]+)?(?<recomb2>a)?$`
  );

  // Executing the regex on every lore line
  // Reverse array and breaks after first find to optimize speed
  let match = null;
  for (const line of lore.reverse()) {
    match = regex.exec(line);

    if (match) {
      break;
    }
  }

  // No match found (glitched items, like /sbmenu gui items)
  if (match == null) {
    return {
      categories: [],
      rarity: null,
      recombobulated: null,
      dungeon: null,
      shiny: null,
    };
  }

  // Parsing the match and returning data
  const r = match.groups;
  return {
    categories: r.type ? getCategories(r.type.trim().toLowerCase(), item) : [],
    rarity: r.rarity.replaceAll(" ", "_").toLowerCase(),
    recombobulated: !!r.recomb && !!r.recomb2,
    dungeon: !!r.dungeon,
    shiny: !!r.shiny,
  };
}

function getCategories(type, item) {
  const categories = [];

  const enchantments = item?.tag?.ExtraAttributes?.enchantments || {};
  Object.keys(enchantments).forEach((enchantment) =>
    Object.entries(ENCHANTMENTS_TO_CATEGORIES).forEach(
      ([category, enchantmentList]) => enchantmentList.includes(enchantment) && categories.push(category)
    )
  );

  return [...new Set(categories.concat(TYPE_TO_CATEGORIES[type]))];
}

export function generateDebugPets(type = "ALL") {
  const pets = [];

  for (const [petType, petData] of Object.entries(PET_DATA)) {
    if (type !== "ALL" && petType !== type) {
      continue;
    }

    for (const rarity of ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY", "MYTHIC"]) {
      pets.push(
        {
          type: petType,
          active: false,
          exp: 0,
          tier: rarity,
          candyUsed: 0,
          heldItem: null,
          skin: null,
          uuid: generateUUID(),
        },
        {
          type: petType,
          active: false,
          exp: getPetExp(petData.maxTier, (petData.maxLevel / 3) * 2),
          tier: rarity,
          candyUsed: 0,
          heldItem: null,
          skin: null,
          uuid: generateUUID(),
        },
        {
          type: petType,
          active: false,
          exp: 1000000000,
          tier: rarity,
          candyUsed: 0,
          heldItem: null,
          skin: null,
          uuid: generateUUID(),
        }
      );
    }
  }

  return pets;
}

/**
 * @param  {string} rarity
 * @param  {number} level
 * @returns number
 * @description takes rarity and level and returns the required pet exp to reach the level
 */
export function getPetExp(rarity, level) {
  const rarityOffset = PET_RARITY_OFFSET[rarity.toLowerCase()];

  return PET_LEVELS.slice(rarityOffset, rarityOffset + level - 1).reduce((prev, curr) => prev + curr, 0);
}

export function getAnimatedTexture(item) {
  const results = ITEM_ANIMATIONS.filter((x) => x.id === getId(item));

  if (results.length === 0) {
    return false;
  }

  if (results.length === 1) {
    return results[0];
  }

  const deepResults = results.filter((x) => {
    if (!x.tags) {
      return false;
    }

    return Object.entries(x.tags).every(([key, value]) => item.tag?.ExtraAttributes?.[key] === value);
  });

  return deepResults[0] ?? false;
}

export function romanize(num) {
  const lookup = { M: 1000, CM: 900, D: 500, CD: 400, C: 100, XC: 90, L: 50, XL: 40, X: 10, IX: 9, V: 5, IV: 4, I: 1 };
  let roman = "";

  for (const i in lookup) {
    while (num >= lookup[i]) {
      roman += i;
      num -= lookup[i];
    }
  }
  return roman;
}

export async function getBingoGoals(db, cacheOnly = false) {
  const output = await db.collection("bingoData").findOne({ _id: "cardData" });

  if (cacheOnly === true) {
    return output;
  }

  // 12 hours cache
  if (output === null || output.last_save + 43200000 < Date.now()) {
    const { data: output } = await axios.get("https://api.hypixel.net/resources/skyblock/bingo");
    output.last_save = Date.now();

    await db.collection("bingoData").updateOne({ _id: "cardData" }, { $set: { output } }, { upsert: true });
  }

  return output;
}

/**
 * Returns the price of the item. Returns 0 if the item is not found or if the item argument is falsy.
 * @param {string} item - The ID of the item to retrieve the price for.
 * @returns {number}
 * @returns {Promise<number>}
 */
export async function getItemPrice(item) {
  if (!item) return 0;

  const prices = await getPrices(true);

  return prices[item.toLowerCase()] ?? prices[getId(item).toLowerCase()] ?? 0;
}

/**
 * Returns the magical power of an item based on its rarity and optional ID.
 * @param {string} rarity - The rarity of the item. See {@link MAGICAL_POWER}.
 * @param {string|null} [id=null] - (Optional) The ID of the item.
 * @returns {number} Returns 0 if `rarity` is undefined or if `rarity` is not a valid rarity value.
 */
export function getMagicalPower(rarity, id = null) {
  if (rarity === undefined) return 0;

  if (id !== null && typeof id === "string") {
    // Hegemony artifact provides double MP
    if (id === "HEGEMONY_ARTIFACT") {
      return 2 * (MAGICAL_POWER[rarity] ?? 0);
    }
  }

  return MAGICAL_POWER[rarity] ?? 0;
}

export function getCommitHash() {
  return "N/A";

  /*
  return execSync("git rev-parse HEAD", { cwd: path.resolve(getFolderPath(), "../") })
    .toString()
    .trim()
    .slice(0, 10);
    */
}

export function RGBtoHex(rgb) {
  const [r, g, b] = rgb.split(",").map((c) => parseInt(c.trim()));

  return [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
}

/**
 * Adds lore to an item's display tag.
 *
 * @param {Item} item - The item to add lore to.
 * @param {string|string[]} lore - The lore to add to the item. If a string is provided, it will be converted to an array.
 * @returns {Item} The modified item.
 */
export function addToItemLore(item, lore) {
  if (typeof lore === "string") {
    console.log("Converting lore to array");
    lore = [lore];
  }

  item.tag ??= {};
  item.tag.display ??= {};
  item.tag.display.Lore ??= [];
  item.tag.display.Lore = item.tag.display.Lore.concat(lore);

  return item;
}

/**
 * Returns a formatted progress bar string based on the given amount and total.
 *
 * @param {number} amount - The current amount.
 * @param {number} total - The total amount.
 * @param {string} [color="a"] - The color of the progress bar.
 * @returns {string} The formatted progress bar string.
 */
export function formatProgressBar(amount, total, color = "a") {
  const barLength = 25;
  const progress = Math.min(1, amount / total);
  const progressBars = Math.floor(progress * barLength);
  const emptyBars = barLength - progressBars;

  return `${`§${color}§l§m-`.repeat(progressBars)}${"§f§l§m-".repeat(emptyBars)}§r`;
}
