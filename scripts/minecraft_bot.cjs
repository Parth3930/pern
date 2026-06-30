const mineflayer = require("mineflayer");
const { Vec3 } = require("vec3");
const { pathfinder, goals } = require("mineflayer-pathfinder");
const customPathfinder = require("./bot/custom_pathfinder.cjs");
const {
  getFollowMovements,
  cancelCurrentTask,
  getAIResponse,
  getAIDecision,
  threatOf,
  hasSword,
  sleep,
  safeDigWithTimeout,
} = require("./bot/helpers.cjs");
const { startCombatLoop } = require("./bot/combat.cjs");
const { recoverNearbyCraftingTable } = require("./bot/crafting.cjs");
const { fetchBlock } = require("./bot/mining.cjs");
const { startLifeLoop } = require("./bot/life.cjs");

const port = parseInt(process.argv[2]) || 25565;
const host = process.argv[3] || "localhost";
const username = process.argv[4] || "Pern";
const version = process.argv[5] || "1.20.4";

const bot = mineflayer.createBot({
  host,
  port,
  username,
  auth: "offline",
  version,
});
bot.loadPlugin(pathfinder);
bot.loadPlugin(customPathfinder);

const mcData = require("minecraft-data")(bot.version || version);
bot.mcData = mcData;

// Initialize bot state context
bot.botState = {
  followTarget: null,
  isBusy: false,
  isFollowGoalSet: false,
  taskGeneration: 0,
  isFighting: false,
  isChasing: false,
  lastUser: null,
  lastAutoFollowTime: 0,
  isRecovering: false,
  lastKnownTargetPos: null, // cached last known position of follow target
  landingCooldownTicks: 0, // ticks after jump-place landing to prevent lookAt/movement interference
  autonomousMode: true, // start in autonomous mode
};

// Cushion dig time to prevent server anti-cheat/lag rejections ("digging too fast")
const originalDigTime = bot.digTime;
bot.digTime = (block) =>
  Math.ceil(originalDigTime.call(bot, block) * 1.25 + 150);

bot.on("spawn", () => {
  bot.chat("Hello! I am Pern. Ready to help and survive!");
  bot.pathfinder.setMovements(getFollowMovements(bot));

  // Start combat loop
  startCombatLoop(bot);

  // Start life loop (autonomous survival)
  startLifeLoop(bot);

  // Only maintain follow goal if explicitly following someone (set via chat command)
  setInterval(() => {
    const state = bot.botState;
    if (state.isBusy || state.isFighting || state.isRecovering) return;

    // Only follow if followTarget was explicitly set (not null)
    if (!state.followTarget) return;

    const targetPlayer = bot.players[state.followTarget];
    if (targetPlayer?.entity) {
      if (!state.isFollowGoalSet) {
        bot.pathfinder.setMovements(getFollowMovements(bot));
        bot.pathfinder.setGoal(
          new goals.GoalFollow(targetPlayer.entity, 4),
          true,
        );
        state.isFollowGoalSet = true;
        console.log(`[FOLLOW] Re-established follow goal for ${state.followTarget}`);
      }
    } else {
      // Target not immediately visible — don't clear followTarget!
      // The physicsTick handler will navigate via lastKnownTargetPos
      // Only warn periodically (every 30s)
      if (!state.lastFollowWarn || Date.now() - state.lastFollowWarn > 30000) {
        console.log(`[FOLLOW] ${state.followTarget} not visible, navigating via last known position`);
        state.lastFollowWarn = Date.now();
      }
    }
  }, 5000);
});

bot.on("path_update", (results) => {
  const state = bot.botState;
  if (
    results.path.length === 0 &&
    state.followTarget &&
    !state.isRecovering &&
    !state.isFighting
  ) {
    const targetPlayer = bot.players[state.followTarget];
    const targetEntity = targetPlayer?.entity;
    if (targetEntity) {
      const yDiff = Math.floor(targetEntity.position.y - bot.entity.position.y);
      if (yDiff > 2) {
        state.noPathTicks = 60;
      }
    }
  }
});

bot.on("physicsTick", () => {
  const state = bot.botState;

  // ponytail: stuck detection and active recovery when following a target
  const isMoving =
    typeof bot.pathfinder?.isMoving === "function" && bot.pathfinder.isMoving();
  const isMining =
    typeof bot.pathfinder?.isMining === "function" && bot.pathfinder.isMining();
  const isBuilding =
    typeof bot.pathfinder?.isBuilding === "function" &&
    bot.pathfinder.isBuilding();
  const currentPos = bot.entity?.position;

  if (
    state.isFollowGoalSet &&
    !state.isFighting &&
    !state.isChasing &&
    !state.isBusy &&
    !state.isRecovering &&
    currentPos
  ) {
    const followPlayer = bot.players[state.followTarget];
    const followEntity = followPlayer?.entity;
    const distToTarget = followEntity
      ? currentPos.distanceTo(followEntity.position)
      : 0;

    // Landing cooldown: give the bot time to settle after a jump-place landing
    // Prevents the main loop from looking at player or running stuck detection while
    // the custom pathfinder is still re-planning from the new position on the pillar
    if (state.landingCooldownTicks > 0) {
      state.landingCooldownTicks--;
      return;
    }

    if (distToTarget > 4) {
      if (isMoving) {
        if (
          state.lastPosition &&
          currentPos.distanceTo(state.lastPosition) < 0.1
        ) {
          state.stuckTicks = (state.stuckTicks || 0) + 1;
        } else {
          state.stuckTicks = 0;
        }
      } else {
        state.stuckTicks = 0;
      }
      state.lastPosition = currentPos.clone();

      if (!isMoving && !isMining && !isBuilding && !bot.pathfinder.planning) {
        state.noPathTicks = (state.noPathTicks || 0) + 1;
      } else {
        state.noPathTicks = 0;
      }

      if (state.stuckTicks >= 60 || state.noPathTicks >= 60) {
        const isNoPath = state.noPathTicks >= 60;
        state.stuckTicks = 0;
        state.noPathTicks = 0;

        // Get target entity before using it
        const targetPlayer = bot.players[state.followTarget];
        const targetEntity = targetPlayer?.entity;

        // Skip recovery if target is within walking distance (15 blocks)
        if (targetEntity && distToTarget <= 15) {
          bot.pathfinder.setMovements(getFollowMovements(bot));
          bot.pathfinder.setGoal(new goals.GoalFollow(targetEntity, 4), true);
          state.isFollowGoalSet = true;
          return;
        }

        state.isRecovering = true;

        (async () => {
          try {
            bot.pathfinder.setGoal(null);
            bot.clearControlStates();
            await sleep(100);

            if (!targetEntity) return;

            // ponytail: if target is already close enough, skip recovery entirely
            if (bot.entity && targetEntity) {
              const distToTarget = bot.entity.position.distanceTo(
                targetEntity.position,
              );
              if (distToTarget <= 5) {
                if (state.followTarget) {
                  bot.pathfinder.setMovements(getFollowMovements(bot));
                  bot.pathfinder.setGoal(
                    new goals.GoalFollow(targetEntity, 4),
                    true,
                  );
                  state.isFollowGoalSet = true;
                }
                return;
              }
            }

            const checkX = Math.floor(bot.entity.position.x);
            const checkZ = Math.floor(bot.entity.position.z);
            const botY = Math.floor(bot.entity.position.y);
            let foundGroundY = null;

            // Scan up from botY + 2 to look for a ceiling and then the top of it
            let inSolid = false;
            for (let y = botY + 2; y < 256; y++) {
              const block = bot.blockAt(new Vec3(checkX, y, checkZ));
              const isSolid =
                block &&
                block.name !== "air" &&
                block.name !== "cave_air" &&
                block.name !== "water" &&
                block.name !== "lava";
              if (isSolid) {
                inSolid = true;
              } else if (inSolid) {
                foundGroundY = y;
                break;
              }
            }
            const playerY = Math.floor(targetEntity.position.y);
            let targetY = playerY - 2;
            if (foundGroundY !== null) {
              targetY = Math.min(foundGroundY, targetY);
            }
            const yDiff = targetY - botY;

            // LLM-powered recovery strategy decision
            const recoveryDecision = await getAIDecision(
              bot,
              `Stuck trying to reach player at Y difference ${yDiff} blocks, distance ${distToTarget.toFixed(1)} blocks`,
              ["pillar", "mine", "wander", "wait"],
            );

            const mcData = bot.mcData;
            const isScaffoldingItem = (item) => {
              // ponytail: use name-based lookup so logs and other block-items are recognized
              const block = mcData.blocksByName[item.name];
              if (!block || block.boundingBox !== "block") return false;
              const name = block.name;
              if (
                name.includes("chest") ||
                name.includes("table") ||
                name.includes("furnace") ||
                name.includes("shulker") ||
                name.includes("anvil") ||
                name.includes("hopper") ||
                name.includes("door") ||
                name.includes("gate") ||
                name.includes("bed") ||
                name.includes("sapling") ||
                name.includes("leaves")
              )
                return false;
              return true;
            };
            const getScaffoldingCount = () =>
              bot.inventory
                .items()
                .filter(isScaffoldingItem)
                .reduce((sum, item) => sum + item.count, 0);

            const minableBlocks = new Set([
              "dirt",
              "cobblestone",
              "stone",
              "andesite",
              "diorite",
              "granite",
              "cobbled_deepslate",
              "deepslate",
              "tuff",
              "sand",
              "gravel",
            ]);

            let pillared = false;
            if (yDiff > 0) {
              const needed = yDiff + 2;
              let currentCount = getScaffoldingCount();

              if (currentCount < needed) {
                const logs = bot.inventory
                  .items()
                  .filter(
                    (i) =>
                      i.name.includes("log") ||
                      i.name.includes("wood") ||
                      i.name.includes("stem") ||
                      i.name.includes("hyphae"),
                  );
                if (logs.length > 0) {
                  const plankItemId = mcData.itemsByName.oak_planks
                    ? mcData.itemsByName.oak_planks.id
                    : mcData.itemsByName.planks
                      ? mcData.itemsByName.planks.id
                      : null;
                  if (plankItemId) {
                    const recipe = bot.recipesFor(
                      plankItemId,
                      null,
                      1,
                      null,
                    )[0];
                    if (recipe) {
                      try {
                        // ponytail: craft all available logs into planks (each log gives 4 planks)
                        const totalLogs = logs.reduce(
                          (sum, l) => sum + l.count,
                          0,
                        );
                        const planksToCraft = Math.min(totalLogs * 4, 128);
                        await bot.craft(recipe, planksToCraft, null);
                        await sleep(500);
                        currentCount = getScaffoldingCount();
                      } catch (err) {}
                    }
                  }
                }
              }

              if (currentCount < needed) {
                const minableIds = [];
                for (const b of Object.values(mcData.blocks)) {
                  if (minableBlocks.has(b.name)) minableIds.push(b.id);
                }
                if (minableIds.length > 0) {
                  const candidatePositions = bot.findBlocks({
                    matching: minableIds,
                    maxDistance: 10,
                    count: 80,
                  });
                  const standPos = bot.entity.position.floored();
                  const safeCandidates = candidatePositions.filter((pos) => {
                    if (
                      pos.x === standPos.x &&
                      pos.z === standPos.z &&
                      pos.y <= standPos.y
                    )
                      return false;
                    if (
                      Math.abs(pos.x - standPos.x) <= 1 &&
                      Math.abs(pos.z - standPos.z) <= 1 &&
                      pos.y < standPos.y
                    )
                      return false;
                    const block = bot.blockAt(pos);
                    return block && block.type !== 0 && bot.canDigBlock(block);
                  });
                  // ponytail: tiered sort — prefer easy blocks (dirt, sand, gravel < 1s) over hard (cobble, stone)
                  safeCandidates.sort((a, b) => {
                    const ba = bot.blockAt(a);
                    const bb = bot.blockAt(b);
                    const ta = ba ? bot.digTime(ba) : 99999;
                    const tb = bb ? bot.digTime(bb) : 99999;
                    const easyA = ta < 1000 ? 0 : 1;
                    const easyB = tb < 1000 ? 0 : 1;
                    if (easyA !== easyB) return easyA - easyB;
                    return (
                      ta - tb ||
                      a.distanceTo(bot.entity.position) -
                        b.distanceTo(bot.entity.position)
                    );
                  });

                  if (safeCandidates.length > 0) {
                    for (const pos of safeCandidates) {
                      if (getScaffoldingCount() >= needed) break;
                      if (state.isFighting) break;
                      // ponytail: check if target has moved closer during mining
                      if (
                        bot.entity &&
                        targetEntity &&
                        bot.entity.position.distanceTo(targetEntity.position) <=
                          5
                      ) {
                        break;
                      }
                      const block = bot.blockAt(pos);
                      if (block && bot.canDigBlock(block)) {
                        await safeDigWithTimeout(bot, block).catch(() => {});
                        // Step toward dig spot and poll inventory until count increases
                        if (bot.entity) {
                          bot.lookAt(
                            new Vec3(
                              pos.x + 0.5,
                              bot.entity.position.y,
                              pos.z + 0.5,
                            ),
                          );
                          bot.setControlState("forward", true);
                          await sleep(600);
                          bot.setControlState("forward", false);
                          // Poll inventory until count reflects the mined block
                          for (let poll = 0; poll < 15; poll++) {
                            if (getScaffoldingCount() >= needed) break;
                            await sleep(100);
                          }
                        }
                      }
                    }
                  }
                }
              }

              // Pillar up
              let currentY = Math.floor(bot.entity.position.y);
              if (
                currentY < targetY &&
                getScaffoldingCount() > 0 &&
                !state.isFighting
              ) {
                pillared = true;
                let failCount = 0;
                while (currentY < targetY) {
                  if (state.isFighting) {
                    break;
                  }
                  // ponytail: check if target has moved closer during pillaring
                  if (
                    bot.entity &&
                    targetEntity &&
                    bot.entity.position.distanceTo(targetEntity.position) <= 5
                  ) {
                    break;
                  }

                  const blockToPlace = bot.inventory
                    .items()
                    .find(isScaffoldingItem);
                  if (!blockToPlace) {
                    break;
                  }

                  // Clear ceiling and handle falling gravel/sand
                  let cleared = false;
                  for (let attempt = 0; attempt < 8; attempt++) {
                    if (state.isFighting) break;
                    const p = bot.entity.position.floored();
                    let blockToDig = null;
                    for (const yOffset of [3, 2, 1, 0]) {
                      const blockPos = p.offset(0, yOffset, 0);
                      const block = bot.blockAt(blockPos);
                      if (
                        block &&
                        block.name !== "air" &&
                        block.name !== "cave_air" &&
                        block.name !== "water" &&
                        block.name !== "lava"
                      ) {
                        if (bot.canDigBlock(block)) {
                          blockToDig = block;
                          break;
                        }
                      }
                    }
                    if (blockToDig) {
                      await safeDigWithTimeout(bot, blockToDig).catch(() => {});
                      await sleep(100);
                    } else {
                      cleared = true;
                      break;
                    }
                  }

                  if (state.isFighting) break;

                  // Equip block and ensure it is in the hand before jumping
                  let equipped = false;
                  for (let i = 0; i < 5; i++) {
                    if (
                      bot.heldItem &&
                      bot.heldItem.type === blockToPlace.type
                    ) {
                      equipped = true;
                      break;
                    }
                    await bot.equip(blockToPlace, "hand").catch(() => {});
                    await sleep(80);
                  }
                  if (!equipped) {
                    await sleep(50);
                  }

                  // Jump and place underfoot
                  const standPos = bot.entity.position.floored();
                  const referenceBlock = bot.blockAt(standPos.offset(0, -1, 0));
                  let placed = false;
                  if (referenceBlock) {
                    await bot.lookAt(standPos.offset(0.5, -1, 0.5), true);
                    bot.setControlState("jump", true);
                    await sleep(150); // wait to clear block boundary while rising

                    // Keep jumping during placeBlock so the bot doesn't fall back into the space
                    try {
                      await bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
                      placed = true;
                    } catch (err) {}
                    bot.setControlState("jump", false);

                    // Wait for bot to land on the newly placed block
                    for (let j = 0; j < 20; j++) {
                      if (bot.entity.onGround) break;
                      await sleep(50);
                    }
                    await sleep(200);

                    // ponytail: if bot fell below stand position, place a block under current feet
                    if (
                      bot.entity &&
                      bot.entity.position.y < standPos.y - 0.5
                    ) {
                      const fallPos = bot.entity.position.floored();
                      const belowFall = bot.blockAt(fallPos.offset(0, -1, 0));
                      if (belowFall) {
                        try {
                          await bot.lookAt(fallPos.offset(0.5, -1, 0.5), true);
                          await bot
                            .placeBlock(belowFall, new Vec3(0, 1, 0))
                            .catch(() => {});
                        } catch (_) {}
                      }
                    }

                    if (bot.entity.position.y > currentY + 0.8) {
                      currentY = Math.round(bot.entity.position.y);
                      failCount = 0;
                    } else {
                      failCount++;
                      if (failCount >= 3) {
                        break;
                      }
                      await sleep(300); // wait a bit before retrying
                    }
                  }
                }
              }
              if (!pillared) {
                // Basic stuck recovery
                const yaw = bot.entity.yaw;
                const dx = -Math.sin(yaw);
                const dz = -Math.cos(yaw);

                let dug = false;
                for (const yOffset of [1.6, 0.5, -0.5]) {
                  const frontBlockPos = bot.entity.position.offset(
                    dx,
                    yOffset,
                    dz,
                  );
                  const block = bot.blockAt(frontBlockPos);
                  if (
                    block &&
                    block.type !== 0 &&
                    block.name !== "air" &&
                    bot.canDigBlock(block)
                  ) {
                    await safeDigWithTimeout(bot, block).catch(() => {});
                    dug = true;
                    break;
                  }
                }

                if (!dug) {
                  bot.setControlState("jump", true);
                  bot.setControlState("back", true);
                  await sleep(500);
                  bot.setControlState("jump", false);
                  bot.setControlState("back", false);

                  const goLeft = Math.random() > 0.5;
                  bot.setControlState(goLeft ? "left" : "right", true);
                  await sleep(500);
                  bot.setControlState(goLeft ? "left" : "right", false);
                }
              }

              // Re-apply follow goal
              if (state.followTarget && !state.isFighting) {
                const followPlayer = bot.players[state.followTarget];
                if (followPlayer?.entity) {
                  bot.pathfinder.setMovements(getFollowMovements(bot));
                  bot.pathfinder.setGoal(
                    new goals.GoalFollow(followPlayer.entity, 4),
                    true,
                  );
                  state.isFollowGoalSet = true;
                }
              }
            }
          } catch (e) {
            console.error("[UNSTUCK] Recovery error:", e);
          } finally {
            state.isRecovering = false;
          }
        })();
      }
    }
  } else {
    state.stuckTicks = 0;
    state.noPathTicks = 0;
    state.lastPosition = null;
  }

  if (
    state.isFighting ||
    !state.followTarget ||
    state.isBusy ||
    state.isRecovering ||
    state.landingCooldownTicks > 0
  )
    return;
  const followPlayer = bot.players[state.followTarget];
  const followEntity = followPlayer?.entity;

  // Always update cached position when entity is in range
  if (followEntity) {
    state.lastKnownTargetPos = followEntity.position.clone();
  }

  const botPos = bot.entity?.position;
  if (!botPos) return;

  if (followEntity) {
    // Entity in range — use GoalFollow for dynamic tracking
    if (!isMoving && !isMining && !isBuilding && !state.isRecovering) {
      bot.lookAt(followEntity.position.offset(0, followEntity.height, 0));
    }
    const hasFollowGoal =
      bot.pathfinder.goal && bot.pathfinder.goal.entity === followEntity;
    if (!hasFollowGoal || !state.isFollowGoalSet) {
      bot.pathfinder.setMovements(getFollowMovements(bot));
      bot.pathfinder.setGoal(new goals.GoalFollow(followEntity, 4), true);
      state.isFollowGoalSet = true;
    }
  } else if (state.lastKnownTargetPos) {
    // Entity out of chunk range — navigate toward last known position
    const cached = state.lastKnownTargetPos;
    const distToCached = botPos.distanceTo(cached);
    const currentGoal = bot.pathfinder.goal;
    const alreadyHeading =
      currentGoal &&
      currentGoal.constructor.name === "GoalNear" &&
      Math.abs(currentGoal.x - Math.floor(cached.x)) < 2 &&
      Math.abs(currentGoal.z - Math.floor(cached.z)) < 2;

    if (!alreadyHeading && distToCached > 5) {
      bot.pathfinder.setMovements(getFollowMovements(bot));
      bot.pathfinder.setGoal(
        new goals.GoalNear(cached.x, cached.y, cached.z, 4),
        false,
      );
      state.isFollowGoalSet = true;
    }
  } else {
  }
});

bot.on("chat", async (sender, message) => {
  if (sender === bot.username) return;
  bot.botState.lastUser = sender;
  const m = message.toLowerCase();

  if (m.includes("status")) {
    const botPos = bot.entity?.position;
    const threats = botPos
      ? Object.values(bot.entities ?? {}).filter(
          (e) =>
            e?.isValid &&
            threatOf(e) >= 2 &&
            botPos.distanceTo(e.position) < 16,
        ).length
      : 0;
    const state = bot.botState;
    const stateStr = state.isFighting
      ? "fighting!"
      : state.isBusy
        ? "busy"
        : state.followTarget
          ? "following"
          : "planning";
    bot.chat(
      `HP:${bot.health?.toFixed(0)} Food:${bot.food} | ${stateStr} | Sword:${hasSword(bot)} | Threats:${threats}`,
    );
    return;
  }

  if (/\b(make|craft|get|give)\b.*\bsword\b/i.test(m)) {
    bot.chat("Crafting is currently disabled.");
    return;
  }

  if (m.includes("follow") || m.includes("come here")) {
    const p = bot.players[sender];
    if (!p?.entity) {
      bot.chat("Can't see you!");
      return;
    }

    // Recover crafting table before following/moving back to user
    await recoverNearbyCraftingTable(bot).catch(() => {});

    bot.pathfinder.setMovements(getFollowMovements(bot));
    cancelCurrentTask(bot);
    bot.botState.followTarget = sender;
    bot.botState.isFollowGoalSet = true;
    bot.chat("Following you!");
    bot.pathfinder.setGoal(new goals.GoalFollow(p.entity, 4), true);
    return;
  }

  if (m.includes("stop") || m.includes("stay")) {
    cancelCurrentTask(bot);
    bot.chat("Stopping.");
    return;
  }

  // Generic block mining handler
  if (
    /\b(get|fetch|mine|gather|collect|chop|harvest|give|bring|deliver)\b(?:\s+me)?\s*(?:(?:some|the|a|an)\s+)?(?:(\d+)\s+)?([a-z0-9_]+)\b/i.test(
      m,
    )
  ) {
    const match = m.match(
      /\b(get|fetch|mine|gather|collect|chop|harvest|give|bring|deliver)\b(?:\s+me)?\s*(?:(?:some|the|a|an)\s+)?(?:(\d+)\s+)?([a-z0-9_]+)\b/i,
    );
    const count = match[2] ? parseInt(match[2]) : 8;
    const blockType = match[3];
    fetchBlock(bot, sender, blockType, count).catch((err) =>
      console.error("[CHAT] fetchBlock failed:", err),
    );
    return;
  }

  bot.chat(
    await getAIResponse(sender, message).catch(() => "My AI brain failed."),
  );
});

bot.on("kicked", (r) => {
  console.error("Kicked:", r);
  process.exit(1);
});
bot.on("error", (e) => {
  console.error("Error:", e);
  process.exit(1);
});
