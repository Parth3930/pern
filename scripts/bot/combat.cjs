const { goals } = require("mineflayer-pathfinder");
const { sleep, threatOf, isHostile, TIER, equipBest, bestFood, cancelCurrentTask } = require("./helpers.cjs");

function startCombatLoop(bot) {
  setInterval(async () => {
    const state = bot.botState;
    if (state.isFighting || state.isChasing) return;

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
      console.log(`[COMBAT] Fleeing ${hostile.name} (Level ${lvl} ${TIER[lvl]}) - Low Health`);
      bot.chat(`${hostile.name} is too dangerous — running!`);
      const dx = botPos.x - hostile.position.x;
      const dz = botPos.z - hostile.position.z;
      const flee = botPos.offset(dx*2, 0, dz*2);
      bot.pathfinder.setGoal(new goals.GoalXZ(Math.floor(flee.x), Math.floor(flee.z)), true);
      await sleep(3000);
      bot.pathfinder.setGoal(null);
      return;
    }

    const prevFollow = state.followTarget;
    cancelCurrentTask(bot); // cancel wood/crafting/mining immediately when under attack
    state.isChasing = true;
    console.log(`[COMBAT] Engaging ${hostile.name} (Threat ${lvl})`);

    try {
      await equipBest(bot);
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
          state.isFighting = true;
          await bot.lookAt(hostile.position.offset(0, hostile.height/2, 0), true);
          bot.attack(hostile);
          state.isFighting = false;
        }

        if (bot.health < 8) {
          const f = bestFood(bot);
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
      state.isFighting = false;
      state.isChasing = false;
      state.isBusy = false;
      bot.pathfinder.setGoal(null);
      if (prevFollow) {
        state.followTarget = prevFollow;
      }
    }
  }, 500);
}

module.exports = { startCombatLoop };
