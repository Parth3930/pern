const { Movements } = require("mineflayer-pathfinder");
const fetch = globalThis.fetch; // ponytail: use native fetch to avoid external dependencies

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

function getUserPlayer(bot) {
  const state = bot.botState;
  if (state.lastUser) {
    const p = bot.players[state.lastUser];
    if (p?.entity) return p;
  }
  return Object.values(bot.players).find(p => p.username !== bot.username && p.entity) || null;
}

function getFollowMovements(bot) {
  const mv = new Movements(bot, bot.mcData);
  mv.canDig = true;
  mv.canPlaceBlocks = true;
  mv.allowParkour = true; 
  mv.allowSprinting = true; 
  return mv;
}

function cancelCurrentTask(bot) {
  const state = bot.botState;
  state.taskGeneration++;
  state.isBusy = false;
  state.isChasing = false;
  state.followTarget = null;
  state.isFollowGoalSet = false;
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
    const data = await res.json();
    return data.choices[0].message.content;
  } catch {
    return "My AI brain is unreachable right now.";
  }
}

async function getAIDecision(bot, situation, options) {
  try {
    const botPos = bot.entity?.position;
    const health = bot.health ?? 20;
    const food = bot.food ?? 20;
    const inventory = bot.inventory.items().map(i => `${i.name} x${i.count}`).join(', ');
    
    const context = `
Situation: ${situation}
Bot Status: Health ${health}/20, Food ${food}/20
Position: ${botPos ? `${Math.floor(botPos.x)}, ${Math.floor(botPos.y)}, ${Math.floor(botPos.z)}` : 'unknown'}
Inventory: ${inventory || 'empty'}
Available options: ${options.join(', ')}

Respond with only the best option name, no explanation.
`;

    const res = await fetch("http://127.0.0.1:4891/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "local",
        messages: [
          { role: "system", content: "You are Pern, a Minecraft AI assistant. Choose the best action based on the situation. Respond with ONLY the option name, nothing else." },
          { role: "user", content: context },
        ],
        stream: false,
        max_tokens: 50,
      }),
    });
    const data = await res.json();
    const choice = data.choices[0].message.content.trim();
    return options.find(opt => choice.toLowerCase().includes(opt.toLowerCase())) || options[0];
  } catch {
    return options[0]; // fallback to first option
  }
}

async function safeDigWithTimeout(bot, block, timeoutMs = 20000) {
  try { bot.stopDigging(); } catch (_) {}
  bot.pathfinder.setGoal(null); // ponytail: stop movement before digging to avoid desync
  
  for (let i = 0; i < 5; i++) {
    const vel = bot.entity?.velocity;
    if (!vel || Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z) < 0.01) break;
    await sleep(50);
  }

  // ponytail: ensure best tool is equipped right before digging
  await equipBestTool(bot, block);

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

async function gotoWithTimeout(bot, goal, timeoutMs = 15000) {
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

const hasSword = (bot) => bot.inventory.items().some(i => i.name.includes('sword'));
const bestSword = (bot) => bot.inventory.items()
  .filter(i => i.name.includes('sword'))
  .sort((a,b) => tierRank(b) - tierRank(a))[0];

function tierRank(item) {
  return ['wooden','stone','iron','golden','diamond','netherite']
    .findIndex(t => item.name.includes(t));
}

async function equipBestTool(bot, block) {
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

const foodItems = [
  'cooked_beef',
  'cooked_porkchop',
  'cooked_chicken',
  'cooked_mutton',
  'cooked_rabbit',
  'cooked_cod',
  'cooked_salmon',
  'cooked_potato',
  'bread',
  'apple',
  'carrot',
  'potato',
  'beef',
  'porkchop',
  'chicken',
  'mutton',
  'rabbit',
  'cod',
  'salmon'
];
const bestFood = (bot) => bot.inventory.items()
  .filter(i => foodItems.includes(i.name))
  .sort((a, b) => foodItems.indexOf(a.name) - foodItems.indexOf(b.name))[0];

async function equipBest(bot) {
  const sw = bestSword(bot);
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

module.exports = {
  sleep,
  MOB_THREAT,
  threatOf,
  isHostile,
  TIER,
  getUserPlayer,
  getFollowMovements,
  cancelCurrentTask,
  getAIResponse,
  getAIDecision,
  safeDigWithTimeout,
  gotoWithTimeout,
  hasSword,
  bestSword,
  tierRank,
  equipBestTool,
  foodItems,
  bestFood,
  equipBest
};
