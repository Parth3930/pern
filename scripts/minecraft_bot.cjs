const mineflayer = require("mineflayer");
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");
const { Vec3 } = require("vec3");

const port = parseInt(process.argv[2]) || 25565;
const host = process.argv[3] || "localhost";
const username = process.argv[4] || "Pern";
const version = process.argv[5] || "1.20.4";

console.log(`Connecting to ${host}:${port} as ${username} (${version})...`);

const bot = mineflayer.createBot({ host, port, username, auth: "offline", version });
bot.loadPlugin(pathfinder);
const mcData = require("minecraft-data")(bot.version || version);

// ponytail: cushion dig time to prevent server anti-cheat/lag rejections ("digging too fast")
const originalDigTime = bot.digTime;
bot.digTime = (block) => Math.ceil(originalDigTime.call(bot, block) * 1.25 + 150);

let followTarget = null;
let isBusy = false;
let isFollowGoalSet = false;
let taskGeneration = 0;
let isFighting = false;
let isChasing = false;
let lastUser = null; // ponytail: track the player who is controlling the bot
let lastAutoFollowTime = 0; // ponytail: rate-limit auto-follow spam


// ponytail: flat lookup beats per-entity logic every time
const MOB_THREAT = {
  sheep:0, cow:0, pig:0, chicken:0, rabbit:0, squid:0, glow_squid:0, bat:0,
  villager:0, snow_golem:0, cat:0, parrot:0, horse:0, donkey:0, mule:0,
  llama:0, trader_llama:0, panda:0, fox:0, turtle:0, axolotl:0, strider:0,
  cod:0, salmon:0, pufferfish:0, tropical_fish:0, dolphin:0, ocelot:0,
  wandering_trader:0, tadpole:0, frog:0, sniffer:0, camel:0, armadillo:0,

  wolf:1, bee:1, polar_bear:1, iron_golem:1, goat:1,

  zombie:2, skeleton:2, spider:2, cave_spider:2, drowned:2, husk:2, stray:2,
  slime:2, magma_cube:2, zombified_piglin:2, silverfish:2, endermite:2,
  phantom:2, zombie_villager:2, chicken_jockey:2,

  creeper:3, witch:3, blaze:3, guardian:3, pillager:3, vindicator:3, evoker:3,
  ravager:3, vex:3, ghast:3, shulker:3, enderman:3, hoglin:3, piglin_brute:3,
  bogged:3, breeze:3, elder_guardian:3, warden_light:3,

  wither_skeleton:4, wither:4, ender_dragon:4, warden:4, zoglin:4,
};

const threatOf = (e) => (e && e.name && MOB_THREAT[e.name.toLowerCase()]) ?? -1;
const isHostile = (e) => threatOf(e) >= 2;
const TIER = ['Passive','Neutral','Easy','Medium','Boss'];

function getUserPlayer() {
  if (lastUser) {
    const p = bot.players[lastUser];
    if (p?.entity) return p;
  }
  return Object.values(bot.players).find(p => p.username !== bot.username && p.entity) || null;
}

function getFollowMovements() {
  const mv = new Movements(bot, mcData);
  mv.canDig = false; // ponytail: do not dig when following to avoid getting stuck in pits
  mv.canPlaceBlocks = false; // ponytail: do not place blocks to avoid placement lockups
  mv.allowParkour = false; // ponytail: avoid tricky jumps
  mv.allowSprinting = false; // ponytail: slow and steady movement prevents physics desyncs
  return mv;
}

function cancelCurrentTask() {
  taskGeneration++;
  isBusy = false;
  isChasing = false;
  followTarget = null;
  isFollowGoalSet = false;
  bot.pathfinder.setGoal(null);
  try { bot.stopDigging(); } catch (_) {}
}

async function getAIResponse(sender, message) {
  try {
    const res = await fetch("http://127.0.0.1:4891/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "local",
        messages: [
          { role: "system", content: "You are Pern, a Minecraft AI. Keep replies under 2 sentences." },
          { role: "user", content: `<${sender}> ${message}` },
        ],
        stream: false,
      }),
    });
    return (await res.json()).choices[0].message.content;
  } catch {
    return "My AI brain is unreachable right now.";
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function safeDigWithTimeout(block, timeoutMs = 20000) {
  try { bot.stopDigging(); } catch (_) {}
  bot.pathfinder.setGoal(null); // ponytail: stop movement before digging to avoid desync
  
  for (let i = 0; i < 5; i++) {
    const vel = bot.entity?.velocity;
    if (!vel || Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z) < 0.01) break;
    await sleep(50);
  }

  // ponytail: ensure best tool is equipped right before digging
  await equipBestTool(block);

  // ponytail: look at the center of the block instead of the corner to prevent server rejection
  await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true);
  let digError = null;
  const digP = bot.dig(block, true).catch(err => { digError = err; });
  const result = await Promise.race([
    digP.then(() => 'done'),
    sleep(timeoutMs).then(() => 'timeout')
  ]);
  
  if (result === 'timeout') {
    try { bot.stopDigging(); } catch (_) {}
    throw new Error('dig timeout');
  }
  if (digError) {
    try { bot.stopDigging(); } catch (_) {}
    throw digError;
  }

  // ponytail: wait up to 1000ms for server block update to sync
  let broken = false;
  for (let i = 0; i < 4; i++) {
    const finalBlock = bot.blockAt(block.position);
    if (!finalBlock || finalBlock.type === 0) {
      broken = true;
      break;
    }
    await sleep(250);
  }

  if (!broken) {
    try { bot.stopDigging(); } catch (_) {}
    throw new Error('block not broken on server');
  }
}

async function gotoWithTimeout(goal, timeoutMs = 15000) {
  let finished = false;
  try {
    await Promise.race([
      bot.pathfinder.goto(goal).finally(() => { finished = true; }),
      sleep(timeoutMs).then(() => {
        if (!finished) {
          bot.pathfinder.setGoal(null);
          throw new Error(`Pathfinding timed out after ${timeoutMs}ms`);
        }
      })
    ]);
  } catch (err) {
    bot.pathfinder.setGoal(null);
    throw err;
  }
}

const hasSword   = () => bot.inventory.items().some(i => i.name.includes('sword'));
const bestSword  = () => bot.inventory.items()
  .filter(i => i.name.includes('sword'))
  .sort((a,b) => tierRank(b) - tierRank(a))[0];

function tierRank(item) {
  return ['wooden','stone','iron','golden','diamond','netherite']
    .findIndex(t => item.name.includes(t));
}

async function equipBestTool(block) {
  if (!block || !block.name) return;
  const bname = block.name.toLowerCase();
  
  let toolKeyword = null;
  if (bname.includes('log') || bname.includes('wood') || bname.includes('stem') || bname.includes('hyphae') || bname.includes('planks')) {
    toolKeyword = 'axe';
  } else if (bname.includes('stone') || bname.includes('cobblestone') || bname.includes('ore') || bname.includes('granite') || bname.includes('diorite') || bname.includes('andesite') || bname.includes('obsidian') || bname.includes('brick') || bname.includes('basalt')) {
    toolKeyword = 'pickaxe';
  } else if (bname.includes('dirt') || bname.includes('grass_block') || bname.includes('sand') || bname.includes('gravel') || bname.includes('clay') || bname.includes('snow')) {
    toolKeyword = 'shovel';
  }

  if (toolKeyword) {
    const bestTool = bot.inventory.items()
      .filter(i => i.name.includes(toolKeyword) && (toolKeyword !== 'axe' || !i.name.includes('pickaxe')))
      .sort((a, b) => tierRank(b) - tierRank(a))[0];
    if (bestTool) {
      if (bot.heldItem && bot.heldItem.name === bestTool.name) return;
      await bot.equip(bestTool, 'hand').catch(() => {});
      return;
    }
  }

  // If holding a tool that isn't the best/needed tool, unequip to avoid speed penalties
  if (bot.heldItem && (bot.heldItem.name.includes('axe') || bot.heldItem.name.includes('pickaxe') || bot.heldItem.name.includes('shovel') || bot.heldItem.name.includes('sword'))) {
    await bot.unequip('hand').catch(() => {});
  }
}

const foodItems  = ['cooked_beef','cooked_porkchop','cooked_chicken','apple','bread','beef','porkchop','chicken','mutton'];
const bestFood   = () => bot.inventory.items().find(i => foodItems.includes(i.name));

async function equipBest() {
  const sw = bestSword();
  if (sw) {
    if (!bot.heldItem || bot.heldItem.name !== sw.name) {
      await bot.equip(sw, 'hand').catch(() => {});
    }
  }
  for (const slot of ['helmet','chestplate','leggings','boots']) {
    const ar = bot.inventory.items()
      .filter(i => i.name.includes(slot))
      .sort((a,b) => tierRank(b) - tierRank(a))[0];
    if (ar) await bot.equip(ar, slot).catch(() => {});
  }
}

async function fetchBlock(sender, blockType, targetCount = 8) {
  cancelCurrentTask();
  const myGen = taskGeneration;
  isBusy = true;

  const player = bot.players[sender];
  if (!player?.entity) { bot.chat("I can't see you!"); isBusy = false; return; }

  const mcData = require('minecraft-data')(bot.version);
  const targetLower = blockType.toLowerCase();

  const matchingBlockIds = new Set();
  for (const b of Object.values(mcData.blocks)) {
    if (targetLower === 'wood' || targetLower === 'log') {
      if (b.name.includes('log') || b.name.includes('wood') || b.name.includes('stem') || b.name.includes('hyphae')) {
        matchingBlockIds.add(b.id);
      }
    } else if (b.name === targetLower || b.name.includes(targetLower)) {
      matchingBlockIds.add(b.id);
    }
  }

  const matchingItemIds = new Set();
  for (const i of Object.values(mcData.items)) {
    if (targetLower === 'wood' || targetLower === 'log') {
      if (i.name.includes('log') || i.name.includes('wood') || i.name.includes('stem') || i.name.includes('hyphae')) {
        matchingItemIds.add(i.id);
      }
    } else if (i.name === targetLower || i.name.includes(targetLower)) {
      matchingItemIds.add(i.id);
    }
  }

  if (matchingBlockIds.size === 0) {
    bot.chat(`I don't know what block matches '${blockType}'.`);
    isBusy = false;
    return;
  }

  const isMatchingEntity = (e) => {
    if (e.type !== 'item' && e.name !== 'item' && e.name !== 'Item' && e.name !== 'item_stack') return false;
    const item = typeof e.getDroppedItem === 'function' ? e.getDroppedItem() : null;
    return item && matchingItemIds.has(item.type);
  };

  const getInventoryCount = () => bot.inventory.items()
    .filter(i => matchingItemIds.has(i.type))
    .reduce((s, i) => s + i.count, 0);

  const wc = () => getInventoryCount();
  if (wc() < targetCount) {
    bot.chat(`Fetching ${targetCount} ${blockType} (have ${wc()})...`);
    bot.pathfinder.setMovements(Object.assign(new Movements(bot, mcData), { canDig: true, canPlaceBlocks: false }));
  }

  const unreachable = [];
  let harvested = wc(), wanderAttempts = 0;

  while (harvested < targetCount) {
    if (taskGeneration !== myGen || isFighting) break;

    const botPos = bot.entity?.position;
    if (!botPos) {
      await sleep(500);
      continue;
    }

    // ponytail: check for any matching items on the ground first to save mining time
    const droppedItem = bot.nearestEntity(e => 
      isMatchingEntity(e) && 
      botPos.distanceTo(e.position) < 32 && 
      !unreachable.some(p => p.distanceTo(e.position) < 1.5)
    );

    if (droppedItem) {
      console.log(`[MINING] Found dropped ${blockType} item on ground at ${droppedItem.position}. Collecting...`);
      try {
        await gotoWithTimeout(new goals.GoalNear(droppedItem.position.x, droppedItem.position.y, droppedItem.position.z, 0.5), 10000);
        await sleep(250);
        const oldWc = harvested;
        harvested = wc();
        if (harvested <= oldWc) {
          unreachable.push(droppedItem.position.clone());
        }
      } catch (err) {
        console.log(`[MINING] Failed to navigate to dropped item: ${err.message}`);
        unreachable.push(droppedItem.position.clone());
      }
      continue;
    }

    // ponytail: findBlocks (plural) + manual filter
    const candidates = bot.findBlocks({ matching: Array.from(matchingBlockIds), maxDistance: 32, count: 64 });
    console.log(`[MINING] Found ${candidates.length} candidate blocks.`);
    const block = candidates
      .filter(pos => {
        const dy = pos.y - botPos.y;
        const isUnderfoot = (Math.pow(pos.x + 0.5 - botPos.x, 2) + Math.pow(pos.z + 0.5 - botPos.z, 2) < 0.8) && (pos.y < botPos.y + 0.5);
        return dy >= -3 && dy <= 10 && !isUnderfoot && !unreachable.some(p => p.equals(pos));
      })
      .sort((a, b) => a.distanceTo(botPos) - b.distanceTo(botPos))
      .map(pos => bot.blockAt(pos))
      .find(b => b && b.type !== 0);

    if (!block) {
      console.log(`[MINING] No suitable block found nearby. unreachable list size: ${unreachable.length}`);
      if (wanderAttempts++ < 3) {
        const a = Math.random() * Math.PI * 2, d = 20 + Math.random() * 20;
        const dest = botPos.offset(Math.cos(a)*d, 0, Math.sin(a)*d);
        console.log(`[MINING] Wandering to ${dest} (attempt ${wanderAttempts}/3) to find more...`);
        try { await gotoWithTimeout(new goals.GoalXZ(dest.x, dest.z), 15000); } catch (err) { console.log(`[MINING] Wander pathfind failed: ${err.message}`); }
        unreachable.length = 0;
        continue;
      }
      bot.chat(harvested > 0 ? `No more ${blockType}. Returning with ${harvested}.` : `No ${blockType} within 32 blocks.`);
      break;
    }

    console.log(`[MINING] Selected block at ${block.position} (dist: ${botPos.distanceTo(block.position).toFixed(1)}m)`);
    try {
      const distXZ = Math.sqrt(Math.pow(block.position.x - botPos.x, 2) + Math.pow(block.position.z - botPos.z, 2));
      const distY = Math.abs(block.position.y - botPos.y);
      if (distXZ > 2 || distY > 3 || !bot.canDigBlock(block)) {
        console.log(`[MINING] Navigating to block at ${block.position}...`);
        const targetY = block.position.y > botPos.y ? botPos.y : block.position.y;
        await gotoWithTimeout(new goals.GoalNear(block.position.x, targetY, block.position.z, 1.5), 15000);
        await sleep(250);
      }
      const cb = bot.blockAt(block.position);
      if (!cb || cb.type === 0) { 
        console.log(`[MINING] Block at ${block.position} is air/null when arrived.`);
        unreachable.push(block.position); 
        continue; 
      }
      if (!bot.canDigBlock(cb)) {
        console.log(`[MINING] Block at ${block.position} cannot be dug.`);
        unreachable.push(block.position);
        continue;
      }
      console.log(`[MINING] Starting to dig block at ${block.position} (type: ${cb.type}, name: ${cb.name})...`);
      await safeDigWithTimeout(cb, 20000);
      console.log(`[MINING] Successfully dug block at ${block.position}`);
      
      let foundItem = false;
      for (let i = 0; i < 10; i++) {
        const item = bot.nearestEntity(e => 
          (e.type === 'item' || e.name === 'item' || e.name === 'Item' || e.name === 'item_stack') && 
          Math.abs(e.position.x - block.position.x) < 1.5 && 
          Math.abs(e.position.z - block.position.z) < 1.5
        );
        if (item) {
          foundItem = true;
          if (bot.entity.position.distanceTo(item.position) > 1.5) {
            console.log(`[MINING] Moving to collect item at ${item.position}`);
            await gotoWithTimeout(new goals.GoalNear(item.position.x, item.position.y, item.position.z, 0.5), 3000).catch(() => {});
            break;
          }
        } else if (foundItem) {
          break;
        }
        await sleep(100);
      }
      harvested = wc();
    } catch (err) {
      console.log(`[MINING] Error digging or moving: ${err.message}`);
      unreachable.push(block.position);
      await sleep(250);
    }
  }

  if (wc() > 0) {
    const targetPlayer = bot.players[sender] || { username: sender };
    const playerEntity = targetPlayer.entity || bot.nearestEntity(e => e.type === 'player' && e.username === sender);
    if (playerEntity) {
      bot.chat("Returning to you...");
      try {
        const mv = getFollowMovements();
        bot.pathfinder.setMovements(mv);

        await gotoWithTimeout(new goals.GoalNear(playerEntity.position.x, playerEntity.position.y, playerEntity.position.z, 2), 20000);
        await bot.lookAt(playerEntity.position.offset(0, playerEntity.height, 0));
        bot.chat(`Here is the ${blockType}!`);
      } catch (err) {
        console.log(`[MINING] Return pathfinding failed: ${err.message}`);
        bot.chat("I got stuck trying to return to you, dropping the items here!");
      }
    } else {
      bot.chat("I can't see you anymore, dropping the items here!");
    }
    const itemsToToss = bot.inventory.items().filter(i => matchingItemIds.has(i.type));
    for (const i of itemsToToss) { await bot.tossStack(i).catch(()=>{}); await sleep(250); }
  } else {
    bot.chat(`No ${blockType} to give!`);
  }
  isBusy = false;
}

function startCombatLoop() {
  setInterval(async () => {
    if (isFighting || isChasing) return;

    const botPos = bot.entity?.position;
    if (!botPos) return;

    const threats = Object.values(bot.entities ?? {})
      .filter(e => e?.isValid && threatOf(e) >= 2 && botPos.distanceTo(e.position) < 10)
      .map(e => ({ e, lvl: threatOf(e), dist: botPos.distanceTo(e.position) }))
      .sort((a,b) => b.lvl - a.lvl || a.dist - b.dist);

    if (!threats.length) return;

    const { e: hostile, lvl } = threats[0];
    if (!hostile.isValid) return;

    if (lvl >= 4 && bot.health < 16) {
      console.log(`[COMBAT] Fleeing ${hostile.name} (Level ${lvl} ${TIER[lvl]})`);
      bot.chat(`${hostile.name} is too dangerous — running!`);
      const dx = botPos.x - hostile.position.x;
      const dz = botPos.z - hostile.position.z;
      const flee = botPos.offset(dx*2, 0, dz*2);
      bot.pathfinder.setGoal(new goals.GoalXZ(Math.floor(flee.x), Math.floor(flee.z)), true);
      await sleep(3000);
      bot.pathfinder.setGoal(null);
      return;
    }

    const prevFollow = followTarget;
    cancelCurrentTask(); // ponytail: cancel wood/crafting immediately when under attack to avoid action conflicts
    isChasing = true;
    console.log(`[COMBAT] Engaging ${hostile.name} — Threat ${lvl} (${TIER[lvl]}), dist ${threats[0].dist.toFixed(1)}m`);

    try {
      await equipBest();
      bot.pathfinder.setGoal(new goals.GoalFollow(hostile, 2), true);

      while (hostile.isValid) {
        const currentBotPos = bot.entity?.position;
        if (!currentBotPos) break;
        const dist = currentBotPos.distanceTo(hostile.position);
        if (dist > 16) break;

        if (hostile.name === 'creeper' && dist < 3) {
          const ang = Math.atan2(currentBotPos.z - hostile.position.z, currentBotPos.x - hostile.position.x);
          bot.pathfinder.setGoal(new goals.GoalXZ(
            Math.floor(currentBotPos.x + Math.cos(ang)*5),
            Math.floor(currentBotPos.z + Math.sin(ang)*5)
          ), true);
          await sleep(800);
          bot.pathfinder.setGoal(new goals.GoalFollow(hostile, 3), true);
          continue;
        }

        if (dist <= 4) {
          isFighting = true;
          await bot.lookAt(hostile.position.offset(0, hostile.height/2, 0), true);
          bot.attack(hostile);
          isFighting = false;
        }

        if (bot.health < 8) {
          const f = bestFood();
          if (f) {
            bot.pathfinder.setGoal(null);
            await bot.equip(f, 'hand').catch(()=>{});
            await bot.consume().catch(()=>{});
            bot.pathfinder.setGoal(new goals.GoalFollow(hostile, 2), true);
          }
        }

        await sleep(500);
      }
    } catch (e) {
      console.warn('[COMBAT] Error:', e.message ?? e);
    } finally {
      isFighting = false;
      isChasing = false;
      isBusy = false;
      bot.pathfinder.setGoal(null);
      if (prevFollow?.isValid) {
        followTarget = prevFollow;
        bot.pathfinder.setGoal(new goals.GoalFollow(followTarget, 4), true);
        isFollowGoalSet = true;
      }
    }
  }, 500);
}

bot.on("spawn", () => {
  console.log("Bot spawned!");
  bot.chat("Hello! I am Pern. Ready to help and survive!");
  bot.pathfinder.setMovements(getFollowMovements());
  startCombatLoop();
  bot.on("health", () => {
    // ponytail: count wood generically if needed, but let's just show inventory items count of any wood/logs for logging
    const woodCount = bot.inventory.items()
      .filter(i => i.name.includes('log') || i.name.includes('wood') || i.name.includes('stem'))
      .reduce((s,i) => s + i.count, 0);
    console.log(`[LIFE] HP:${bot.health?.toFixed(1)}/20 Food:${bot.food}/20 | Sword:${hasSword()} | Wood:${woodCount}`);
  });
});

bot.on("physicTick", () => {
  // ponytail: auto-follow if user is far (>= 50 blocks) and bot is not fighting
  if (!isFighting && !isChasing) {
    const userPlayer = getUserPlayer();
    if (userPlayer && bot.entity?.position) {
      const userEntity = userPlayer.entity;
      const dist = bot.entity.position.distanceTo(userEntity.position);
      const now = Date.now();
      if (dist >= 50 && (followTarget !== userEntity || !isFollowGoalSet || now - lastAutoFollowTime > 10000)) {
        lastAutoFollowTime = now;
        console.log(`[AUTO-FOLLOW] User is ${dist.toFixed(1)}m away. Auto-firing follow...`);
        bot.chat(`${userPlayer.username}, user too far getting to user`);
        const mv = getFollowMovements();
        bot.pathfinder.setMovements(mv);
        cancelCurrentTask();
        followTarget = userEntity;
        isFollowGoalSet = true;
        bot.pathfinder.setGoal(new goals.GoalFollow(followTarget, 4), true);
      }
    }
  }

  if (isFighting || !followTarget || isBusy) return;
  const botPos = bot.entity?.position;
  if (!botPos) return;
  bot.lookAt(followTarget.position.offset(0, followTarget.height, 0));
  const dist = botPos.distanceTo(followTarget.position);
  if (dist < 4) { if (isFollowGoalSet) { bot.pathfinder.setGoal(null); isFollowGoalSet = false; } }
  else if (dist > 5.5 && !isFollowGoalSet) {
    bot.pathfinder.setGoal(new goals.GoalFollow(followTarget, 4), true);
    isFollowGoalSet = true;
  }
});

bot.on("chat", async (sender, message) => {
  if (sender === bot.username) return;
  lastUser = sender; // ponytail: update last user to match chat sender
  console.log(`[CHAT] <${sender}> ${message}`);
  const m = message.toLowerCase();

  if (m.includes("status")) {
    const botPos = bot.entity?.position;
    const threats = botPos ? Object.values(bot.entities ?? {})
      .filter(e => e?.isValid && threatOf(e) >= 2 && botPos.distanceTo(e.position) < 16).length : 0;
    const state = isFighting ? "fighting!" : isBusy ? "busy" : followTarget ? "following" : "planning";
    bot.chat(`HP:${bot.health?.toFixed(0)} Food:${bot.food} | ${state} | Sword:${hasSword()} | Threats:${threats}`);
    return;
  }

  if (/\b(make|craft|get|give)\b.*\bsword\b/i.test(m)) {
    bot.chat("Crafting is currently disabled.");
    return;
  }

  if (m.includes("follow") || m.includes("come here")) {
    const p = bot.players[sender];
    if (!p?.entity) { bot.chat("Can't see you!"); return; }
    console.log(`[CHAT] Starting follow for ${sender}`);
    const mv = getFollowMovements();
    bot.pathfinder.setMovements(mv);
    cancelCurrentTask();
    followTarget = p.entity; isFollowGoalSet = true;
    bot.chat("Following you!");
    bot.pathfinder.setGoal(new goals.GoalFollow(followTarget, 4), true);
    return;
  }

  if (m.includes("stop") || m.includes("stay")) { 
    console.log(`[CHAT] Stop requested by ${sender}`);
    cancelCurrentTask(); 
    bot.chat("Stopping."); 
    return; 
  }

  // ponytail: generic block mining handler
  if (/\b(get|fetch|mine|gather|collect|chop|harvest|give|bring|deliver)\b(?:\s+me)?\s*(?:(?:some|the|a|an)\s+)?(?:(\d+)\s+)?([a-z0-9_]+)\b/i.test(m)) {
    const match = m.match(/\b(get|fetch|mine|gather|collect|chop|harvest|give|bring|deliver)\b(?:\s+me)?\s*(?:(?:some|the|a|an)\s+)?(?:(\d+)\s+)?([a-z0-9_]+)\b/i);
    const count = match[2] ? parseInt(match[2]) : 8;
    const blockType = match[3];
    console.log(`[CHAT] Requested ${count} ${blockType} by ${sender}`);
    fetchBlock(sender, blockType, count).catch(err => console.error(`[CHAT] fetchBlock failed:`, err));
    return;
  }

  bot.chat(await getAIResponse(sender, message).catch(() => "My AI brain failed."));
});

bot.on("kicked", (r) => { console.error("Kicked:", r); process.exit(1); });
bot.on("error",  (e) => { console.error("Error:", e);  process.exit(1); });
