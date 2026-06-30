const { goals } = require("mineflayer-pathfinder");
const { sleep, gotoWithTimeout, safeDigWithTimeout } = require("./helpers.cjs");

function isLogLikeItem(name) {
  return /(?:_log|_wood|_stem|_hyphae)$/.test(name);
}

function logItemToPlanksName(logName) {
  if (logName.endsWith('_log')) return `${logName.slice(0, -4)}_planks`;
  if (logName.endsWith('_wood')) return `${logName.slice(0, -5)}_planks`;
  if (logName.endsWith('_stem')) return `${logName.slice(0, -5)}_planks`;
  if (logName.endsWith('_hyphae')) return `${logName.slice(0, -7)}_planks`;
  return null;
}

function getPlankItems(bot) {
  return bot.inventory.items().filter(i => i.name.endsWith('_planks'));
}

function countPlanks(bot) {
  return getPlankItems(bot).reduce((sum, item) => sum + item.count, 0);
}

async function craftPlanksFromLogs(bot, minPlanks = 4) {
  const logs = bot.inventory.items().filter(i => isLogLikeItem(i.name));
  if (!logs.length) return countPlanks(bot) >= minPlanks;

  while (countPlanks(bot) < minPlanks) {
    const logItem = bot.inventory.items().find(i => isLogLikeItem(i.name));
    if (!logItem) break;

    const plankName = logItemToPlanksName(logItem.name);
    const plankItem = plankName ? bot.mcData.itemsByName?.[plankName] : null;
    if (!plankItem) break;

    const recipe = bot.recipesFor(plankItem.id, null, 1, null)[0];
    if (!recipe) break;

    await bot.craft(recipe, 1, null);
    await sleep(300);
  }

  return countPlanks(bot) >= minPlanks;
}

async function recoverNearbyCraftingTable(bot) {
  const botPos = bot.entity?.position;
  if (!botPos) return;

  // Search for crafting table blocks within 15 blocks
  const tablePos = bot.findBlock({
    matching: bot.mcData.blocksByName.crafting_table.id,
    maxDistance: 15
  });

  if (!tablePos) return;

  try {
    const block = bot.blockAt(tablePos);
    if (!block || block.type === 0) return;

    // Navigate close to the table
    await gotoWithTimeout(bot, new goals.GoalNear(tablePos.x, tablePos.y, tablePos.z, 1.5), 8000);
    
    // Break the block
    await safeDigWithTimeout(bot, block, 10000);
    
    // Wait a brief moment to collect the dropped item
    for (let i = 0; i < 5; i++) {
      const droppedItem = bot.nearestEntity(e => 
        (e.type === 'item' || e.name === 'item' || e.name === 'Item' || e.name === 'item_stack') && 
        e.position.distanceTo(tablePos) < 2
      );
      if (droppedItem) {
        await gotoWithTimeout(bot, new goals.GoalNear(droppedItem.position.x, droppedItem.position.y, droppedItem.position.z, 0.5), 2000).catch(()=>{});
        break;
      }
      await sleep(100);
    }
  } catch (err) {
  }
}

// ponytail: check inventory for crafting table, if not present and logs/planks are available, we can craft it
async function ensureCraftingTableInInventory(bot) {
  const tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
  if (tableItem) return true;

  const planksReady = countPlanks(bot) >= 4 || await craftPlanksFromLogs(bot, 4);
  if (!planksReady) return false;

  try {
    const mcData = bot.mcData;
    const tableRecipe = bot.recipesFor(mcData.itemsByName.crafting_table.id, null, 1, null)[0];
    if (tableRecipe) {
      await bot.craft(tableRecipe, 1, null);
      await sleep(500);
      return bot.inventory.items().some(i => i.name === 'crafting_table');
    }
  } catch (err) {
  }
  return false;
}

module.exports = {
  recoverNearbyCraftingTable,
  ensureCraftingTableInInventory
};
