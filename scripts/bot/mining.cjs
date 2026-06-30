const { goals } = require("mineflayer-pathfinder");
const { sleep, gotoWithTimeout, safeDigWithTimeout, getFollowMovements } = require("./helpers.cjs");
const { recoverNearbyCraftingTable } = require("./crafting.cjs");

async function fetchBlock(bot, sender, blockType, targetCount = 8) {
  const state = bot.botState;
  const mcData = bot.mcData;
  state.isBusy = true;

  const player = bot.players[sender];
  if (!player?.entity) { 
    bot.chat("I can't see you!"); 
    state.isBusy = false; 
    return; 
  }

  const targetLower = blockType.toLowerCase();

  // Map block names
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

  // Map item names
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
    state.isBusy = false;
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
    bot.chat(`Fetching ${targetCount} ${blockType}...`);
    bot.pathfinder.setMovements(Object.assign(getFollowMovements(bot), { canDig: true }));
  }

  const unreachable = [];
  let harvested = wc(), wanderAttempts = 0;
  const myGen = state.taskGeneration;

  while (harvested < targetCount) {
    if (state.taskGeneration !== myGen || state.isFighting) break;

    const botPos = bot.entity?.position;
    if (!botPos) {
      await sleep(500);
      continue;
    }

    // Check for dropped items on ground first
    const droppedItem = bot.nearestEntity(e => 
      isMatchingEntity(e) && 
      botPos.distanceTo(e.position) < 32 && 
      !unreachable.some(p => p.distanceTo(e.position) < 1.5)
    );

    if (droppedItem) {
      try {
        await gotoWithTimeout(bot, new goals.GoalNear(droppedItem.position.x, droppedItem.position.y, droppedItem.position.z, 0.5), 10000);
        await sleep(250);
        const oldWc = harvested;
        harvested = wc();
        if (harvested <= oldWc) {
          unreachable.push(droppedItem.position.clone());
        }
      } catch (err) {
        unreachable.push(droppedItem.position.clone());
      }
      continue;
    }

    // Find block candidates with progressive search radius
    let block = null;
    let searchRadius = 64;
    const maxSearchRadius = 256;
    
    while (!block && searchRadius <= maxSearchRadius) {
      const candidates = bot.findBlocks({ matching: Array.from(matchingBlockIds), maxDistance: searchRadius, count: 128 });
      block = candidates
        .filter(pos => {
          const dy = pos.y - Math.floor(botPos.y);
          // Only exclude the block directly below the bot's feet (the one it's standing on)
          const isUnderfoot = pos.x === Math.floor(botPos.x) && pos.z === Math.floor(botPos.z) && pos.y < Math.floor(botPos.y);
          return dy >= -30 && dy <= 30 && !isUnderfoot && !unreachable.some(p => p.equals(pos));
        })
        .sort((a, b) => a.distanceTo(botPos) - b.distanceTo(botPos))
        .map(pos => bot.blockAt(pos))
        .find(b => b && b.type !== 0);
      
      if (!block) {
        searchRadius *= 2;
        bot.chat(`Searching for ${blockType} within ${searchRadius} blocks...`);
      }
    }

    if (!block) {
      if (wanderAttempts++ < 5) {
        const a = Math.random() * Math.PI * 2, d = 50 + Math.random() * 50;
        const dest = botPos.offset(Math.cos(a)*d, 0, Math.sin(a)*d);
        try { await gotoWithTimeout(bot, new goals.GoalXZ(dest.x, dest.z), 30000); } catch (_) {}
        unreachable.length = 0;
        continue;
      }
      bot.chat(harvested > 0 ? `No more ${blockType}. Returning with ${harvested}.` : `No ${blockType} found after extensive search.`);
      break;
    }

    try {
      const distXZ = Math.sqrt(Math.pow(block.position.x - botPos.x, 2) + Math.pow(block.position.z - botPos.z, 2));
      const distY = Math.abs(block.position.y - botPos.y);
      console.log(`[MINING] Block at ${block.position.x}, ${block.position.y}, ${block.position.z}, distXZ: ${distXZ.toFixed(1)}, distY: ${distY.toFixed(1)}`);
      
      if (distXZ > 2 || distY > 3 || !bot.canDigBlock(block)) {
        const targetY = block.position.y > botPos.y ? botPos.y : block.position.y;
        console.log(`[MINING] Moving to block...`);
        bot.pathfinder.setMovements(getFollowMovements(bot));
        await gotoWithTimeout(bot, new goals.GoalNear(block.position.x, targetY, block.position.z, 1.5), 15000);
        await sleep(250);
      }
      const cb = bot.blockAt(block.position);
      if (!cb || cb.type === 0 || !bot.canDigBlock(cb)) { 
        console.log(`[MINING] Block no longer valid, marking unreachable`);
        unreachable.push(block.position); 
        continue; 
      }
      
      console.log(`[MINING] Digging block...`);
      await safeDigWithTimeout(bot, cb, 20000);
      
      // Wait to pick up drops
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
            await gotoWithTimeout(bot, new goals.GoalNear(item.position.x, item.position.y, item.position.z, 0.5), 3000).catch(() => {});
            break;
          }
        } else if (foundItem) {
          break;
        }
        await sleep(100);
      }
      harvested = wc();
    } catch (err) {
      unreachable.push(block.position);
      await sleep(250);
    }
  }

  if (wc() > 0) {
    const targetPlayer = bot.players[sender] || { username: sender };
    const playerEntity = targetPlayer.entity || bot.nearestEntity(e => e.type === 'player' && e.username === sender);
    if (playerEntity) {
      // ponytail: break and carry crafting table before returning to user
      await recoverNearbyCraftingTable(bot);
      
      bot.chat("Returning to you...");
      try {
        console.log(`[MINING] Moving to player at ${playerEntity.position.x}, ${playerEntity.position.y}, ${playerEntity.position.z}`);
        bot.pathfinder.setMovements(getFollowMovements(bot));
        await gotoWithTimeout(bot, new goals.GoalNear(playerEntity.position.x, playerEntity.position.y, playerEntity.position.z, 2), 20000);
        await bot.lookAt(playerEntity.position.offset(0, playerEntity.height, 0));
        bot.chat(`Here is the ${blockType}!`);
      } catch (err) {
        console.log(`[MINING] Failed to return to player:`, err.message);
        bot.chat("I got stuck returning to you, dropping the items here!");
      }
    } else {
      console.log(`[MINING] Can't see player ${sender}`);
      bot.chat("I can't see you, dropping the items here!");
    }
    const itemsToToss = bot.inventory.items().filter(i => matchingItemIds.has(i.type));
    console.log(`[MINING] Tossing ${itemsToToss.length} item stacks`);
    for (const i of itemsToToss) { 
      await bot.tossStack(i).catch(()=>{}); 
      await sleep(250); 
    }
  } else {
    bot.chat(`No ${blockType} to give!`);
  }
  state.isBusy = false;
}

module.exports = { fetchBlock };
