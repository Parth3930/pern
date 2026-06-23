const { goals } = require("mineflayer-pathfinder");
const { sleep, gotoWithTimeout, equipBest, bestFood, isHostile } = require("./helpers.cjs");
const { ensureCraftingTableInInventory } = require("./crafting.cjs");

async function eatIfHungry(bot) {
  if (bot.food <= 14) {
    const food = bestFood(bot);
    if (food) {
      console.log(`[LIFE] Eating ${food.name} (Food level: ${bot.food}/20)`);
      try {
        await bot.equip(food, 'hand');
        await bot.consume();
        await sleep(500);
      } catch (err) {
        console.warn(`[LIFE] Failed to eat: ${err.message}`);
      }
    }
  }
}

async function huntForFood(bot) {
  const state = bot.botState;
  
  // Find nearest passive food entity within 32 blocks
  const targetMob = bot.nearestEntity(e => 
    ['cow', 'pig', 'sheep', 'chicken'].includes(e.name?.toLowerCase()) && 
    e.isValid && 
    bot.entity.position.distanceTo(e.position) < 32
  );

  if (!targetMob) {
    console.log("[LIFE] Low food, but no hunting targets found nearby.");
    return;
  }

  console.log(`[LIFE] Low food (${bot.food}/20). Hunting ${targetMob.name} for food...`);
  state.isBusy = true;

  try {
    await equipBest(bot);
    bot.pathfinder.setGoal(new goals.GoalFollow(targetMob, 2.5), true);

    const startTime = Date.now();
    while (targetMob.isValid && Date.now() - startTime < 15000 && !state.isFighting) {
      const pos = bot.entity.position;
      const dist = pos.distanceTo(targetMob.position);
      if (dist > 16) break;

      if (dist <= 4.5) {
        await bot.lookAt(targetMob.position.offset(0, targetMob.height / 2, 0), true);
        bot.attack(targetMob);
      }
      await sleep(400);
    }

    // Wait a moment for food item to drop and navigate to collect it
    await sleep(800);
    const dropItem = bot.nearestEntity(e => 
      (e.type === 'item' || e.name === 'item' || e.name === 'Item' || e.name === 'item_stack') && 
      e.position.distanceTo(bot.entity.position) < 8
    );
    if (dropItem) {
      await gotoWithTimeout(bot, new goals.GoalNear(dropItem.position.x, dropItem.position.y, dropItem.position.z, 0.5), 3000).catch(()=>{});
    }

    // Attempt to eat immediately
    await eatIfHungry(bot);
  } catch (err) {
    console.warn(`[LIFE] Hunt failed: ${err.message}`);
  } finally {
    state.isBusy = false;
    bot.pathfinder.setGoal(null);
  }
}

async function collectNearbyMaterials(bot) {
  const state = bot.botState;
  if (state.isBusy || state.isFighting || state.isChasing) return;

  const dropped = bot.nearestEntity(e => 
    (e.type === 'item' || e.name === 'item' || e.name === 'Item' || e.name === 'item_stack') && 
    bot.entity.position.distanceTo(e.position) < 12
  );

  if (dropped) {
    console.log(`[LIFE] Collecting dropped material at ${dropped.position}`);
    state.isBusy = true;
    try {
      await gotoWithTimeout(bot, new goals.GoalNear(dropped.position.x, dropped.position.y, dropped.position.z, 0.5), 5000);
      await sleep(250);
    } catch (err) {
      // Ignore navigation failure
    } finally {
      state.isBusy = false;
    }
  }
}

async function runIdleAction(bot) {
  const state = bot.botState;
  if (state.isBusy || state.isFighting || state.isChasing || state.followTarget || state.isRecovering) return;

  // Plan 1: Ensure we have a crafting table in inventory
  const hasTable = bot.inventory.items().some(i => i.name === 'crafting_table');
  if (!hasTable) {
    const success = await ensureCraftingTableInInventory(bot);
    if (success) return;
  }

  // Plan 2: Gather wood logs if we have less than 16 logs
  const logCount = bot.inventory.items()
    .filter(i => i.name.includes('log') || i.name.includes('wood') || i.name.includes('stem'))
    .reduce((s, i) => s + i.count, 0);

  if (logCount < 16) {
    // Find nearby log block
    const matchingBlockIds = Object.values(bot.mcData.blocks)
      .filter(b => b.name.includes('log') || b.name.includes('wood') || b.name.includes('stem'))
      .map(b => b.id);

    const logPos = bot.findBlock({
      matching: matchingBlockIds,
      maxDistance: 24
    });

    if (logPos) {
      console.log(`[LIFE] Idle action: Gathering wood from ${logPos}`);
      const block = bot.blockAt(logPos);
      if (block) {
        state.isBusy = true;
        try {
          await gotoWithTimeout(bot, new goals.GoalNear(logPos.x, logPos.y, logPos.z, 1.5), 10000);
          await sleep(250);
          const cb = bot.blockAt(logPos);
          if (cb && bot.canDigBlock(cb)) {
            const { safeDigWithTimeout } = require("./helpers.cjs");
            await safeDigWithTimeout(bot, cb, 10000);
          }
        } catch (_) {
        } finally {
          state.isBusy = false;
          bot.pathfinder.setGoal(null);
        }
        return;
      }
    }
  }

  // Plan 3: Wander/Scout to stay active
  console.log(`[LIFE] Idle action: Wandering to scout surroundings`);
  state.isBusy = true;
  try {
    const a = Math.random() * Math.PI * 2;
    const d = 8 + Math.random() * 8;
    const dest = bot.entity.position.offset(Math.cos(a)*d, 0, Math.sin(a)*d);
    await gotoWithTimeout(bot, new goals.GoalXZ(dest.x, dest.z), 8000);
    await sleep(1000);
  } catch (_) {
  } finally {
    state.isBusy = false;
    bot.pathfinder.setGoal(null);
  }
}

function startLifeLoop(bot) {
  // Check food and hunt loop (every 10s)
  setInterval(async () => {
    const state = bot.botState;
    if (state.isFighting || state.isChasing) return;

    // Eat if hungry
    await eatIfHungry(bot);

    // Hunt if low food and not already busy
    if (bot.food <= 10 && !state.isBusy) {
      await huntForFood(bot);
    }
  }, 10000);

  // Collect materials loop (every 5s)
  setInterval(async () => {
    await collectNearbyMaterials(bot);
  }, 5000);

  // Idle planner loop (every 20s)
  setInterval(async () => {
    const state = bot.botState;
    if (state.isBusy || state.isFighting || state.isChasing || state.followTarget || state.isRecovering) return;
    
    // Check pathfinder status to ensure bot isn't actively moving
    if (bot.pathfinder.isMoving()) return;

    await runIdleAction(bot);
  }, 20000);
}

module.exports = { startLifeLoop };
