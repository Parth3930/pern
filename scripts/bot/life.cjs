const { goals } = require("mineflayer-pathfinder");
const { Vec3 } = require("vec3");
const { sleep, gotoWithTimeout, equipBest, bestFood, tierRank } = require("./helpers.cjs");
const { ensureCraftingTableInInventory } = require("./crafting.cjs");

const FOOD_ITEM_KEYWORDS = [
  'beef',
  'porkchop',
  'chicken',
  'mutton',
  'rabbit',
  'bread',
  'apple',
  'carrot',
  'potato',
  'cod',
  'salmon'
];

function isWoodBlockName(name) {
  return /(?:_log|_wood|_stem|_hyphae)$/.test(name);
}

function isWoodLogItemName(name) {
  return /(?:_log|_wood|_stem|_hyphae)$/.test(name);
}

function isWoodPlankItemName(name) {
  return /_planks$/.test(name);
}

function isFoodItemName(name) {
  return FOOD_ITEM_KEYWORDS.some(keyword => name.includes(keyword));
}

function isLogLikeItemName(name) {
  return /(?:_log|_wood|_stem|_hyphae)$/.test(name);
}

function isPlankItemName(name) {
  return /_planks$/.test(name);
}

function logItemToPlanksName(logName) {
  if (logName.endsWith('_log')) return `${logName.slice(0, -4)}_planks`;
  if (logName.endsWith('_wood')) return `${logName.slice(0, -5)}_planks`;
  if (logName.endsWith('_stem')) return `${logName.slice(0, -5)}_planks`;
  if (logName.endsWith('_hyphae')) return `${logName.slice(0, -7)}_planks`;
  return null;
}

function countItems(bot, predicate) {
  return bot.inventory.items()
    .filter(predicate)
    .reduce((sum, item) => sum + item.count, 0);
}

function isTaskInterrupted(state, myGen) {
  return state.taskGeneration !== myGen || state.isFighting || state.isChasing;
}

function hasAdjacentAir(bot, pos) {
  const passableNames = [
    'air',
    'cave_air',
    'void_air',
    'vine',
    'weeping_vines',
    'twisting_vines',
    'short_grass',
    'tall_grass',
    'fern',
    'large_fern'
  ];
  const offsets = [
    new Vec3(1, 0, 0),
    new Vec3(-1, 0, 0),
    new Vec3(0, 1, 0),
    new Vec3(0, -1, 0),
    new Vec3(0, 0, 1),
    new Vec3(0, 0, -1),
  ];

  return offsets.some(offset => {
    const block = bot.blockAt(pos.plus(offset));
    if (!block) return true;
    if (passableNames.includes(block.name)) return true;
    if (block.name.includes('leaves')) return true;
    return block.boundingBox !== 'block';
  });
}

async function eatIfHungry(bot) {
  if (bot.food <= 14) {
    const food = bestFood(bot);
    if (food) {
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
    return;
  }

  state.isBusy = true;
  const myGen = state.taskGeneration;

  try {
    await equipBest(bot);
    bot.pathfinder.setGoal(new goals.GoalFollow(targetMob, 2.5), true);

    const startTime = Date.now();
    while (targetMob.isValid && Date.now() - startTime < 15000 && !isTaskInterrupted(state, myGen)) {
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
    if (isTaskInterrupted(state, myGen)) return;
    await sleep(800);
    const dropItem = bot.nearestEntity(e => 
      (e.type === 'item' || e.name === 'item' || e.name === 'Item' || e.name === 'item_stack') && 
      e.position.distanceTo(bot.entity.position) < 8
    );
    if (dropItem && !isTaskInterrupted(state, myGen)) {
      await gotoWithTimeout(bot, new goals.GoalNear(dropItem.position.x, dropItem.position.y, dropItem.position.z, 0.5), 3000).catch(()=>{});
    }

    // Attempt to eat immediately
    if (!isTaskInterrupted(state, myGen)) {
      await eatIfHungry(bot);
    }
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

function analyzeInventory(bot) {
  const items = bot.inventory.items();
  const analysis = {
    tools: { pickaxe: [], axe: [], shovel: [], sword: [] },
    armor: { helmet: [], chestplate: [], leggings: [], boots: [] },
    resources: {},
    food: [],
    foodCount: 0,
    totalItems: items.length
  };

  for (const item of items) {
    const name = item.name;
    
    // Tools
    if (name.includes('pickaxe')) analysis.tools.pickaxe.push(item);
    if (name.includes('axe')) analysis.tools.axe.push(item);
    if (name.includes('shovel')) analysis.tools.shovel.push(item);
    if (name.includes('sword')) analysis.tools.sword.push(item);
    
    // Armor
    if (name.includes('helmet')) analysis.armor.helmet.push(item);
    if (name.includes('chestplate')) analysis.armor.chestplate.push(item);
    if (name.includes('leggings')) analysis.armor.leggings.push(item);
    if (name.includes('boots')) analysis.armor.boots.push(item);
    
    // Resources
    if (isWoodLogItemName(name)) {
      analysis.resources.wood = (analysis.resources.wood || 0) + (item.count * 4);
    } else if (isWoodPlankItemName(name)) {
      analysis.resources.wood = (analysis.resources.wood || 0) + item.count;
    }
    if (name === 'cobblestone' || name === 'stone' || name === 'blackstone' || name === 'cobbled_deepslate') {
      analysis.resources.stone = (analysis.resources.stone || 0) + item.count;
    }
    if (name.includes('iron_ingot')) {
      analysis.resources.iron = (analysis.resources.iron || 0) + item.count;
    }
    if (name.includes('coal')) {
      analysis.resources.coal = (analysis.resources.coal || 0) + item.count;
    }
    if (name.includes('diamond')) {
      analysis.resources.diamond = (analysis.resources.diamond || 0) + item.count;
    }
    
    // Food
    if (isFoodItemName(name)) {
      analysis.food.push(item);
      analysis.foodCount += item.count;
    }
  }
  
  return analysis;
}

function getInventoryNeeds(analysis) {
  const needs = [];
  
  // Tool needs
  if (analysis.tools.pickaxe.length === 0) needs.push('pickaxe');
  if (analysis.tools.axe.length === 0) needs.push('axe');
  if (analysis.tools.shovel.length === 0) needs.push('shovel');
  if (analysis.tools.sword.length === 0) needs.push('sword');
  
  // Armor needs
  if (analysis.armor.helmet.length === 0) needs.push('helmet');
  if (analysis.armor.chestplate.length === 0) needs.push('chestplate');
  if (analysis.armor.leggings.length === 0) needs.push('leggings');
  if (analysis.armor.boots.length === 0) needs.push('boots');
  
  // Resource needs
  if ((analysis.resources.wood || 0) < 16) needs.push('wood');
  if ((analysis.resources.stone || 0) < 32) needs.push('stone');
  if ((analysis.resources.coal || 0) < 8) needs.push('coal');
  
  // Food needs
  if (analysis.foodCount < 4) needs.push('food');
  
  return needs;
}

function decideAction(bot, analysis, needs) {
  // Direct priority-based decision system — no LLM dependency
  
  // Priority 1: Health/safety
  const timeOfDay = bot.time?.timeOfDay ?? 0;
  const isNight = timeOfDay > 13000 && timeOfDay < 23000;
  const hasFoodInInventory = analysis.foodCount > 0;

  if (bot.health < 10) {
    if (hasFoodInInventory && bot.food <= 18) {
      return 'eat_food';
    }
    if (bot.health <= 6 || isNight || !hasFoodInInventory) {
      return 'seek_shelter';
    }
    return 'wait';
  }
  
  // Priority 2: Food
  if (bot.food < 8 && analysis.foodCount < 2) {
    return 'hunt_food';
  }
  
  // Priority 3: Essential tools
  if (needs.includes('pickaxe') || needs.includes('axe') || needs.includes('sword')) {
    // Check if we have materials to craft
    if ((analysis.resources.wood || 0) >= 3 || (analysis.resources.stone || 0) >= 3 || (analysis.resources.iron || 0) >= 3) {
      return 'craft_tools';
    }
  }
  
  // Priority 4: Wood (most fundamental resource)
  if ((analysis.resources.wood || 0) < 16) {
    return 'gather_wood';
  }
  
  // Priority 5: Stone (for better tools)
  if ((analysis.resources.stone || 0) < 32 && (analysis.resources.wood || 0) >= 8) {
    return 'gather_stone';
  }
  
  // Priority 6: Coal (for torches)
  if ((analysis.resources.coal || 0) < 8 && (analysis.resources.stone || 0) >= 16) {
    return 'gather_coal';
  }
  
  // Priority 7: Craft armor if we have iron
  if ((analysis.resources.iron || 0) >= 4 && (needs.includes('helmet') || needs.includes('chestplate') || needs.includes('leggings') || needs.includes('boots'))) {
    return 'craft_armor';
  }
  
  // Priority 8: Upgrade tools
  if ((analysis.resources.iron || 0) >= 3 && (analysis.tools.pickaxe.length > 0 || analysis.tools.sword.length > 0)) {
    return 'craft_tools';
  }
  
  // Priority 9: Explore (when well-stocked)
  if ((analysis.resources.wood || 0) >= 32 && (analysis.resources.stone || 0) >= 32 && analysis.foodCount >= 4) {
    return 'explore';
  }
  
  // Default: wait (no urgent needs)
  return 'wait';
}

async function runIdleAction(bot) {
  const state = bot.botState;
  if (state.isBusy || state.isFighting || state.isChasing || state.isRecovering) return;
  
  // Don't run autonomous actions if explicitly following someone
  if (state.followTarget) return;
  
  // Check pathfinder status to ensure bot isn't actively moving
  if (bot.pathfinder.isMoving()) return;

  const analysis = analyzeInventory(bot);
  const needs = getInventoryNeeds(analysis);
  
  // Ensure we have a crafting table in inventory
  const hasTable = bot.inventory.items().some(i => i.name === 'crafting_table');
  if (!hasTable) {
    const success = await ensureCraftingTableInInventory(bot);
    if (success) return;
  }
  
  // Use direct priority-based decision (no LLM dependency)
  const decision = decideAction(bot, analysis, needs);
  
  console.log(`[LIFE] Idle action: ${decision} | Needs: ${needs.slice(0,3).join(',')} | HP:${bot.health} Food:${bot.food}`);

  // Execute decision
  switch (decision) {
    case 'gather_wood':
      await gatherResource(bot, 'wood', 16);
      break;
    case 'gather_stone':
      await gatherResource(bot, 'stone', 32);
      break;
    case 'gather_coal':
      await gatherResource(bot, 'coal', 8);
      break;
    case 'gather_iron':
      await gatherResource(bot, 'iron', 8);
      break;
    case 'craft_tools':
      await craftNeededTools(bot, analysis);
      break;
    case 'craft_armor':
      await craftNeededArmor(bot, analysis);
      break;
    case 'hunt_food':
      await huntForFood(bot);
      break;
    case 'eat_food':
      await eatIfHungry(bot);
      await sleep(1000);
      break;
    case 'seek_shelter':
      await seekShelter(bot);
      break;
    case 'explore':
      await exploreArea(bot);
      break;
    case 'wait':
      break;
    default:
      await gatherResource(bot, 'wood', 16);
  }

  // If after the decision we still have zero resources, explore to find new terrain
  const postAnalysis = analyzeInventory(bot);
  const hasAnyResources = (postAnalysis.resources.wood || 0) > 0 || (postAnalysis.resources.stone || 0) > 0;
  if (!hasAnyResources && decision !== 'explore' && decision !== 'wait') {
    console.log(`[LIFE] Still have no resources after '${decision}'. Exploring...`);
    await exploreArea(bot);
  }
}

async function gatherResource(bot, resourceType, targetCount) {
  const state = bot.botState;
  state.isBusy = true;
  const myGen = state.taskGeneration;
  
  try {
    const currentAnalysis = analyzeInventory(bot);
    if ((currentAnalysis.resources[resourceType] || 0) >= targetCount) {
      return;
    }

    let blockIds = [];
    let baseSearchDistance = 32;
    
    if (resourceType === 'wood') {
      blockIds = Object.values(bot.mcData.blocks)
        .filter(b => isWoodBlockName(b.name))
        .map(b => b.id);
    } else if (resourceType === 'stone') {
      blockIds = Object.values(bot.mcData.blocks)
        .filter(b => b.name.includes('stone') && !b.name.includes('cobblestone'))
        .map(b => b.id);
    } else if (resourceType === 'coal') {
      blockIds = Object.values(bot.mcData.blocks)
        .filter(b => b.name.includes('coal_ore'))
        .map(b => b.id);
      baseSearchDistance = 48;
    } else if (resourceType === 'iron') {
      blockIds = Object.values(bot.mcData.blocks)
        .filter(b => b.name.includes('iron_ore'))
        .map(b => b.id);
      baseSearchDistance = 48;
    }

    if (blockIds.length === 0) {
      console.log(`[LIFE] No block IDs found for ${resourceType}`);
      return;
    }

    let gathered = 0;
    const maxAttempts = Math.min(targetCount, 10);
    const unreachable = [];
    let wanderAttempts = 0;
    
    while (gathered < maxAttempts && wanderAttempts < 5) {
      if (isTaskInterrupted(state, myGen)) break;
      
      // Progressive search: try increasingly large radii
      const searchDistances = resourceType === 'wood'
        ? [16, 32, 64, 128]
        : [baseSearchDistance, 64, 128];
      let foundBlocks = [];

      for (let searchIndex = 0; searchIndex < searchDistances.length; searchIndex++) {
        const dist = searchDistances[searchIndex];
        foundBlocks = bot.findBlocks({
          matching: blockIds,
          maxDistance: dist,
          count: resourceType === 'wood' ? 256 : 96
        });
        if (foundBlocks.length > 0) {
          console.log(`[LIFE] Found ${foundBlocks.length} ${resourceType} blocks at ${dist} blocks`);
          break;
        }
        const nextDist = searchDistances[searchIndex + 1];
        if (nextDist) {
          console.log(`[LIFE] No ${resourceType} at ${dist}, expanding to ${nextDist}...`);
        }
      }

      // If still nothing found even at max radius, wander to find new terrain
      if (foundBlocks.length === 0) {
        wanderAttempts++;
        const a = Math.random() * Math.PI * 2;
        const d = 50 + Math.random() * 50;
        const dest = bot.entity.position.offset(Math.cos(a)*d, 0, Math.sin(a)*d);
        console.log(`[LIFE] No ${resourceType} in range (tried 32/64/128). Wandering to find new terrain (${wanderAttempts}/5)...`);
        try {
          bot.pathfinder.setMovements(require("./helpers.cjs").getFollowMovements(bot));
          await gotoWithTimeout(bot, new goals.GoalXZ(dest.x, dest.z), 30000);
          await sleep(500);
        } catch (_) {}
        unreachable.length = 0;
        continue;
      }

      // Filter out unreachable blocks and sort by distance
      const botPos = bot.entity.position;
      const botFloorX = Math.floor(botPos.x);
      const botFloorZ = Math.floor(botPos.z);
      const botFloorY = Math.floor(botPos.y);
      const validPos = foundBlocks
        .filter(pos => {
          const block = bot.blockAt(pos);
          if (!block || block.type === 0) return false;
          const dy = pos.y - botFloorY;
          // Prevent digging the block directly below the bot's feet
          const isUnderfoot = pos.x === botFloorX && pos.z === botFloorZ && pos.y < botFloorY;
          // Don't filter anything above — trees can be tall; only filter way below
          const tooFarBelow = dy < -30;
          if (tooFarBelow || isUnderfoot || unreachable.some(p => p.equals(pos))) return false;
          // Do not filter by hasAdjacentAir — vines, leaves, and tight jungle trees
          // make that check too conservative. Let pathfinding+drying handle it.
          return true;
        })
        .sort((a, b) => a.distanceTo(botPos) - b.distanceTo(botPos))[0];

      if (!validPos) {
        wanderAttempts++;
        console.log(`[LIFE] Found ${foundBlocks.length} ${resourceType} blocks but all filtered (unreachable or out of vertical range). Wandering...`);
        const a = Math.random() * Math.PI * 2;
        const d = 30 + Math.random() * 30;
        const dest = bot.entity.position.offset(Math.cos(a)*d, 0, Math.sin(a)*d);
        try {
          bot.pathfinder.setMovements(require("./helpers.cjs").getFollowMovements(bot));
          await gotoWithTimeout(bot, new goals.GoalXZ(dest.x, dest.z), 20000);
          await sleep(500);
        } catch (_) {}
        unreachable.length = 0;
        continue;
      }

      // Wrap navigation+dig in try-catch so pathfinding failures mark position unreachable and continue
      try {
        const block = bot.blockAt(validPos);
        if (block && bot.canDigBlock(block)) {
          console.log(`[LIFE] Moving to ${resourceType} at ${validPos.x}, ${validPos.y}, ${validPos.z}`);
          bot.pathfinder.setMovements(require("./helpers.cjs").getFollowMovements(bot));
          await gotoWithTimeout(bot, new goals.GoalNear(validPos.x, validPos.y, validPos.z, 1.5), 10000);
          if (isTaskInterrupted(state, myGen)) break;
          await sleep(250);
          const cb = bot.blockAt(validPos);
          if (cb && bot.canDigBlock(cb)) {
            const { safeDigWithTimeout } = require("./helpers.cjs");
            console.log(`[LIFE] Digging ${resourceType}`);
            await safeDigWithTimeout(bot, cb, 10000);
            gathered++;
            
            // Check if we've gathered enough
            const updatedAnalysis = analyzeInventory(bot);
            if ((updatedAnalysis.resources[resourceType] || 0) >= targetCount) break;
            
            await sleep(500);
          } else {
            unreachable.push(validPos);
          }
        } else {
          unreachable.push(validPos);
        }
      } catch (err) {
        // Pathfinding or digging failure — mark unreachable and try next block
        console.log(`[LIFE] Failed to reach/dig ${resourceType} at ${validPos.x}, ${validPos.y}, ${validPos.z}: ${err.message}`);
        unreachable.push(validPos);
        bot.pathfinder.setGoal(null);
        await sleep(250);
      }
    }
    
    console.log(`[LIFE] Gathered ${gathered} ${resourceType}`);
  } catch (err) {
    console.warn(`[LIFE] Failed to gather ${resourceType}:`, err.message);
    console.error(err);
  } finally {
    state.isBusy = false;
    bot.pathfinder.setGoal(null);
  }
}

async function craftNeededTools(bot, analysis) {
  const state = bot.botState;
  if (state.isBusy) return;
  
  const resources = analyzeInventory(bot).resources;
  const wood = resources.wood || 0;
  const stone = resources.stone || 0;
  const iron = resources.iron || 0;
  
  // If we have NO materials at all, skip crafting — bot needs to gather first
  if (wood === 0 && stone === 0 && iron === 0) {
    console.log(`[LIFE] Can't craft tools — no materials. Need to gather resources first.`);
    return;
  }
  
  // Priority: Pickaxe > Axe > Shovel > Sword
  // Upgrade tiers: Wooden -> Stone -> Iron -> Diamond
  
  // Pickaxe crafting
  if (analysis.tools.pickaxe.length === 0) {
    if (iron >= 3) {
      await craftItem(bot, 'iron_pickaxe');
    } else if (stone >= 3) {
      await craftItem(bot, 'stone_pickaxe');
    } else if (wood >= 3) {
      await craftItem(bot, 'wooden_pickaxe');
    }
  } else {
    // Upgrade existing pickaxe
    const currentPick = analysis.tools.pickaxe[0];
    const currentTier = tierRank(currentPick);
    if (currentTier < 2 && iron >= 3) { // Upgrade to iron
      await craftItem(bot, 'iron_pickaxe');
    } else if (currentTier < 1 && stone >= 3) { // Upgrade to stone
      await craftItem(bot, 'stone_pickaxe');
    }
  }
  
  // Axe crafting
  if (analysis.tools.axe.length === 0) {
    if (iron >= 3) {
      await craftItem(bot, 'iron_axe');
    } else if (stone >= 3) {
      await craftItem(bot, 'stone_axe');
    } else if (wood >= 3) {
      await craftItem(bot, 'wooden_axe');
    }
  }
  
  // Sword crafting (important for combat)
  if (analysis.tools.sword.length === 0) {
    if (iron >= 2) {
      await craftItem(bot, 'iron_sword');
    } else if (stone >= 2) {
      await craftItem(bot, 'stone_sword');
    } else if (wood >= 2) {
      await craftItem(bot, 'wooden_sword');
    }
  } else {
    // Upgrade sword
    const currentSword = analysis.tools.sword[0];
    const currentTier = tierRank(currentSword);
    if (currentTier < 2 && iron >= 2) {
      await craftItem(bot, 'iron_sword');
    }
  }
  
  // Shovel crafting (lower priority)
  if (analysis.tools.shovel.length === 0 && (stone >= 1 || wood >= 1)) {
    if (stone >= 1) {
      await craftItem(bot, 'stone_shovel');
    } else if (wood >= 1) {
      await craftItem(bot, 'wooden_shovel');
    }
  }
}

async function craftNeededArmor(bot, analysis) {
  const resources = analyzeInventory(bot).resources;
  const iron = resources.iron || 0;
  
  // Priority: Chestplate (most protection) > Leggings > Helmet > Boots
  
  if (iron >= 8 && analysis.armor.chestplate.length === 0) {
    await craftItem(bot, 'iron_chestplate');
  }
  if (iron >= 7 && analysis.armor.leggings.length === 0) {
    await craftItem(bot, 'iron_leggings');
  }
  if (iron >= 5 && analysis.armor.helmet.length === 0) {
    await craftItem(bot, 'iron_helmet');
  }
  if (iron >= 4 && analysis.armor.boots.length === 0) {
    await craftItem(bot, 'iron_boots');
  }
}

async function isCraftingTableNearby(bot) {
  const tableId = bot.mcData.blocksByName?.crafting_table?.id;
  if (!tableId) return null;
  const nearby = bot.findBlock({
    matching: tableId,
    maxDistance: 4
  });
  return nearby ? bot.blockAt(nearby) : null;
}

async function placeCraftingTableNearby(bot) {
  const table = bot.inventory.items().find(i => i.name === 'crafting_table');
  if (!table) return null;
  
  const pos = bot.entity.position.floored();
  const directions = [
    new Vec3(1, 0, 0),
    new Vec3(-1, 0, 0),
    new Vec3(0, 0, 1),
    new Vec3(0, 0, -1),
    new Vec3(1, 0, 1),
    new Vec3(-1, 0, -1),
    new Vec3(1, 0, -1),
    new Vec3(-1, 0, 1),
  ];
  
  for (const dir of directions) {
    const targetPos = pos.plus(dir);
    const targetBlock = bot.blockAt(targetPos);
    const aboveTarget = bot.blockAt(targetPos.offset(0, 1, 0));
    
    if (targetBlock && targetBlock.name === 'air' && aboveTarget && aboveTarget.name === 'air') {
      const belowTarget = bot.blockAt(targetPos.offset(0, -1, 0));
      if (belowTarget && belowTarget.type !== 0) {
        try {
          await bot.equip(table, 'hand');
          await bot.lookAt(targetPos.offset(0.5, 0.5, 0.5), true);
          await bot.placeBlock(belowTarget, new Vec3(0, 1, 0));
          await sleep(300);
          return bot.blockAt(targetPos);
        } catch (err) {
          continue;
        }
      }
    }
  }
  return null;
}

async function pickupPlacedCraftingTable(bot, tableBlock) {
  if (!tableBlock) return;

  try {
    const currentBlock = bot.blockAt(tableBlock.position);
    if (!currentBlock || currentBlock.name !== 'crafting_table') return;

    await gotoWithTimeout(bot, new goals.GoalNear(currentBlock.position.x, currentBlock.position.y, currentBlock.position.z, 1.5), 8000);
    const { safeDigWithTimeout } = require("./helpers.cjs");
    await safeDigWithTimeout(bot, currentBlock, 10000);
    await sleep(500);
  } catch (err) {
    console.warn(`[LIFE] Failed to recover crafting table: ${err.message}`);
  }
}

async function craftInventoryRecipe(bot, itemName, count = 1) {
  const item = bot.mcData.itemsByName[itemName];
  if (!item) return false;

  const recipe = bot.recipesFor(item.id, null, 1, null)[0];
  if (!recipe) return false;

  await bot.craft(recipe, count, null);
  await sleep(300);
  return true;
}

async function ensurePlanks(bot, minCount) {
  while (countItems(bot, item => isPlankItemName(item.name)) < minCount) {
    const logItem = bot.inventory.items().find(item => isLogLikeItemName(item.name));
    if (!logItem) return false;

    const plankName = logItemToPlanksName(logItem.name);
    if (!plankName) return false;

    const crafted = await craftInventoryRecipe(bot, plankName, 1);
    if (!crafted) return false;
  }

  return true;
}

async function ensureSticks(bot, minCount) {
  while (countItems(bot, item => item.name === 'stick') < minCount) {
    if (!await ensurePlanks(bot, 2)) return false;
    const crafted = await craftInventoryRecipe(bot, 'stick', 1);
    if (!crafted) return false;
  }

  return true;
}

async function ensureCraftingIngredients(bot, itemName) {
  if (itemName === 'crafting_table') {
    return await ensurePlanks(bot, 4);
  }

  if (itemName.startsWith('wooden_')) {
    const neededPlanks = {
      wooden_pickaxe: 5,
      wooden_axe: 5,
      wooden_sword: 4,
      wooden_shovel: 3,
    }[itemName];

    if (!neededPlanks) return true;
    if (!await ensurePlanks(bot, neededPlanks)) return false;
    return await ensureSticks(bot, itemName === 'wooden_sword' ? 1 : 2);
  }

  if (itemName.endsWith('_pickaxe') || itemName.endsWith('_axe') || itemName.endsWith('_shovel') || itemName.endsWith('_hoe')) {
    return await ensureSticks(bot, 2);
  }

  if (itemName.endsWith('_sword')) {
    return await ensureSticks(bot, 1);
  }

  if (itemName === 'torch') {
    return await ensureSticks(bot, 1);
  }

  return true;
}

async function craftItem(bot, itemName) {
  const state = bot.botState;
  state.isBusy = true;
  
  try {
    const mcData = bot.mcData;
    const item = mcData.itemsByName[itemName];
    if (!item) {
      console.warn(`[LIFE] Unknown item: ${itemName}`);
      return;
    }
    
    // For 2x2 grid items (planks, sticks, torches), no crafting table needed
    // Wooden tools need 3x3 grid - a crafting table IS needed
    const needsTable = ![
      'oak_planks', 'birch_planks', 'spruce_planks', 'jungle_planks',
      'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks',
      'crimson_planks', 'warped_planks',
      'stick', 'torch'
    ].includes(itemName);

    // Ensure we have the ingredients before looking up the recipe
    const ok = await ensureCraftingIngredients(bot, itemName);
    if (!ok) {
      console.warn(`[LIFE] Missing ingredients for ${itemName}`);
      return;
    }

    let tableBlock = null;
    if (needsTable) {
      tableBlock = await isCraftingTableNearby(bot);
      if (!tableBlock) {
        tableBlock = await placeCraftingTableNearby(bot);
        if (!tableBlock) {
          console.warn(`[LIFE] Can't craft ${itemName} — no crafting table nearby`);
          return;
        }
      }
    }

    const recipes = bot.recipesFor(item.id, tableBlock, 1, null);
    if (recipes.length === 0) {
      console.warn(`[LIFE] No recipe for ${itemName}`);
      return;
    }

    await bot.craft(recipes[0], 1, tableBlock);
    await sleep(500);
  } catch (err) {
    console.warn(`[LIFE] Failed to craft ${itemName}:`, err.message);
  } finally {
    state.isBusy = false;
  }
}

async function exploreArea(bot) {
  const state = bot.botState;
  state.isBusy = true;
  
  try {
    const a = Math.random() * Math.PI * 2;
    const d = 16 + Math.random() * 16;
    const dest = bot.entity.position.offset(Math.cos(a)*d, 0, Math.sin(a)*d);
    await gotoWithTimeout(bot, new goals.GoalXZ(dest.x, dest.z), 12000);
    await sleep(1000);
  } catch (_) {
  } finally {
    state.isBusy = false;
    bot.pathfinder.setGoal(null);
  }
}

async function seekShelter(bot) {
  const state = bot.botState;
  state.isBusy = true;
  const myGen = state.taskGeneration;
  
  try {
    const botPos = bot.entity?.position;
    if (!botPos) return;
    if (isTaskInterrupted(state, myGen)) return;
    
    // Check if it's nighttime (low light level)
    const timeOfDay = bot.time.timeOfDay;
    const isNight = timeOfDay > 13000 && timeOfDay < 23000;
    
    if (!isNight && bot.health > 15) {
      // No need for shelter during day if healthy
      return;
    }
    
    // Look for nearby shelter (caves, overhangs, or structures)
    const shelterBlocks = ['stone', 'cobblestone', 'dirt', 'grass_block', 'sand'];
    const shelterIds = Object.values(bot.mcData.blocks)
      .filter(b => shelterBlocks.includes(b.name))
      .map(b => b.id);
    
    // Try to find a covered area
    const nearbyBlocks = bot.findBlocks({
      matching: shelterIds,
      maxDistance: 16,
      count: 50
    });
    
    if (nearbyBlocks.length > 0) {
      // Find a block with something above it (shelter)
      for (const pos of nearbyBlocks) {
        if (isTaskInterrupted(state, myGen)) return;
        const above = bot.blockAt(pos.offset(0, 1, 0));
        const above2 = bot.blockAt(pos.offset(0, 2, 0));
        
        if (above && above.name !== 'air' && above.name !== 'cave_air' && 
            above.name !== 'water' && above.name !== 'lava') {
          // Found shelter - move there
          await gotoWithTimeout(bot, new goals.GoalNear(pos.x, pos.y, pos.z, 2), 8000);
          bot.chat("Seeking shelter...");
          return;
        }
      }
    }
    
    // If no shelter found, dig a simple hole
    const standPos = botPos.floored();
    const below = bot.blockAt(standPos.offset(0, -1, 0));
    
    if (below && below.name !== 'air' && below.name !== 'bedrock') {
      // Dig down 2 blocks and cover top
      const { safeDigWithTimeout } = require("./helpers.cjs");
      
      // Dig first block down
      if (!isTaskInterrupted(state, myGen) && bot.canDigBlock(below)) {
        await safeDigWithTimeout(bot, below, 5000);
      }
      
      // Move down
      if (isTaskInterrupted(state, myGen)) return;
      bot.setControlState('sprint', true);
      bot.setControlState('forward', true);
      await sleep(400);
      bot.setControlState('forward', false);
      bot.setControlState('sprint', false);
      
      // Dig second block
      const below2 = bot.blockAt(bot.entity.position.offset(0, -1, 0));
      if (!isTaskInterrupted(state, myGen) && below2 && bot.canDigBlock(below2)) {
        await safeDigWithTimeout(bot, below2, 5000);
      }
      
      // Place a block above to seal
      const dirt = bot.inventory.items().find(i => i.name.includes('dirt') || i.name.includes('cobblestone'));
      if (!isTaskInterrupted(state, myGen) && dirt) {
        const ceiling = bot.blockAt(bot.entity.position.offset(0, 2, 0));
        if (ceiling && ceiling.name === 'air') {
          await bot.equip(dirt, 'hand');
          const refBlock = bot.blockAt(bot.entity.position.offset(0, 1, 0));
          if (refBlock) {
            try {
              await bot.placeBlock(refBlock, new Vec3(0, 1, 0));
              bot.chat("Dug a hole for shelter.");
            } catch (_) {}
          }
        }
      }
    }
  } catch (err) {
    console.warn('[LIFE] Failed to seek shelter:', err.message);
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
