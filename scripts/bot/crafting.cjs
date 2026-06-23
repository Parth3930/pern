const { goals } = require("mineflayer-pathfinder");
const { sleep, gotoWithTimeout, safeDigWithTimeout } = require("./helpers.cjs");

async function recoverNearbyCraftingTable(bot) {
  const botPos = bot.entity?.position;
  if (!botPos) return;

  // Search for crafting table blocks within 15 blocks
  const tablePos = bot.findBlock({
    matching: bot.mcData.blocksByName.crafting_table.id,
    maxDistance: 15
  });

  if (!tablePos) return;

  console.log(`[CRAFTING] Found crafting table at ${tablePos}. Collecting before returning to user...`);
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
    console.log(`[CRAFTING] Crafting table recovered successfully.`);
  } catch (err) {
    console.log(`[CRAFTING] Failed to recover crafting table: ${err.message}`);
  }
}

// ponytail: check inventory for crafting table, if not present and logs/planks are available, we can craft it
async function ensureCraftingTableInInventory(bot) {
  const tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
  if (tableItem) return true;

  const logs = bot.inventory.items().filter(i => i.name.includes('log') || i.name.includes('wood') || i.name.includes('stem'));
  const planks = bot.inventory.items().find(i => i.name.includes('planks'));

  if (!planks && logs.length === 0) return false;

  console.log(`[CRAFTING] Attempting to auto-craft a crafting table to keep in inventory...`);
  try {
    const mcData = bot.mcData;
    // Step 1: Craft logs to planks if we don't have enough planks (need 4 planks for table)
    let plankCount = planks ? planks.count : 0;
    if (plankCount < 4 && logs.length > 0) {
      const recipe = bot.recipesFor(mcData.itemsByName.oak_planks ? mcData.itemsByName.oak_planks.id : mcData.itemsByName.planks.id, null, 1, null)[0] 
        || bot.recipesFor(planks ? planks.type : null, null, 1, null)[0];
      if (recipe) {
        await bot.craft(recipe, 1, null);
        await sleep(500);
      }
    }

    // Step 2: Craft crafting table
    const tableRecipe = bot.recipesFor(mcData.itemsByName.crafting_table.id, null, 1, null)[0];
    if (tableRecipe) {
      await bot.craft(tableRecipe, 1, null);
      console.log(`[CRAFTING] Crafted a crafting table successfully.`);
      await sleep(500);
      return true;
    }
  } catch (err) {
    console.log(`[CRAFTING] Auto-crafting crafting table failed: ${err.message}`);
  }
  return false;
}

module.exports = {
  recoverNearbyCraftingTable,
  ensureCraftingTableInInventory
};
