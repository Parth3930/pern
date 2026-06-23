const { Worker } = require('worker_threads')
const path = require('path')
const { performance } = require('perf_hooks')
const { Vec3 } = require('vec3')
const nbt = require('prismarine-nbt')

const Movements = require('mineflayer-pathfinder/lib/movements')
const Move = require('mineflayer-pathfinder/lib/move')
const Physics = require('mineflayer-pathfinder/lib/physics')
const interactableBlocks = require('mineflayer-pathfinder/lib/interactable.json')

// ponytail: custom pathfinder plugin wrapping standard mineflayer-pathfinder
function customPathfinder (bot) {
  // Ensure standard plugin is loaded
  if (!bot.pathfinder) {
    const { pathfinder } = require('mineflayer-pathfinder')
    bot.loadPlugin(pathfinder)
  }

  // Remove original listeners to prevent conflicts
  for (const event of ['physicsTick', 'blockUpdate', 'chunkColumnLoad']) {
    for (const listener of bot.listeners(event)) {
      const str = listener.toString()
      if (str.includes('monitorMovement') || str.includes('isPositionNearPath') || str.includes('astarContext.visitedChunks')) {
        bot.removeListener(event, listener)
      }
    }
  }

  const physics = new Physics(bot)
  const Lock = require('mineflayer-pathfinder/lib/lock')
  const lockPlaceBlock = new Lock()
  const lockEquipItem = new Lock()
  const lockUseBlock = new Lock()

  const waterType = bot.registry.blocksByName.water.id
  const ladderId = bot.registry.blocksByName.ladder.id
  const vineId = bot.registry.blocksByName.vine.id

  const temporaryExclusions = new Map()

  function getExclusionWeight (block) {
    if (!block || !block.position) return 0
    const hash = `${block.position.x},${block.position.y},${block.position.z}`
    const expiry = temporaryExclusions.get(hash)
    if (expiry && Date.now() < expiry) {
      return 1000
    }
    return 0
  }

  let stateMovements = bot.pathfinder.movements || new Movements(bot)
  if (!stateMovements.exclusionAreasStep.includes(getExclusionWeight)) {
    stateMovements.exclusionAreasStep.push(getExclusionWeight)
  }
  let stateGoal = bot.pathfinder.goal || null
  let dynamicGoal = false
  let pathList = []
  let pathUpdated = false
  let digging = false
  let placing = false
  let placingBlock = null
  let lastNodeTime = performance.now()
  let returningPos = null
  let stopPathing = false
  let lastPlacedPos = null
  let jumpStartTime = 0
  let landingAfterJump = false // wait for onGround after jump-place before moving
  let lastPlanTime = 0
  let lastCustomLogTime = 0

  // ponytail: Re-create pathfinder object to avoid non-configurable property errors
  const originalPathfinder = bot.pathfinder
  const newPathfinder = {}
  for (const key of Object.getOwnPropertyNames(originalPathfinder)) {
    if (key !== 'goal' && key !== 'movements') {
      const desc = Object.getOwnPropertyDescriptor(originalPathfinder, key)
      Object.defineProperty(newPathfinder, key, desc)
    }
  }
  bot.pathfinder = newPathfinder

  bot.pathfinder.activeWorkers = []
  bot.pathfinder.planning = false
  bot.pathfinder.searchRadius = bot.pathfinder.searchRadius || 48
  bot.pathfinder.thinkTimeout = bot.pathfinder.thinkTimeout || 2000

  bot.pathfinder.setGoal = (goal, dynamic = false) => {
    stateGoal = goal
    dynamicGoal = dynamic
    bot.emit('goal_updated', goal, dynamic)
    resetPath('goal_updated')
  }

  bot.pathfinder.setMovements = (movements) => {
    stateMovements = movements
    if (!stateMovements.exclusionAreasStep.includes(getExclusionWeight)) {
      stateMovements.exclusionAreasStep.push(getExclusionWeight)
    }
    resetPath('movements_updated')
  }

  bot.pathfinder.isMoving = () => pathList.length > 0
  bot.pathfinder.isMining = () => digging
  bot.pathfinder.isBuilding = () => placing
  bot.pathfinder.stop = () => {
    stopPathing = true
  }

  Object.defineProperty(bot.pathfinder, 'goal', {
    get () { return stateGoal },
    configurable: true,
    enumerable: true
  })
  Object.defineProperty(bot.pathfinder, 'movements', {
    get () { return stateMovements },
    configurable: true,
    enumerable: true
  })

  function resetPath (reason, clearStates = true) {
    if (!stopPathing && pathList.length > 0) bot.emit('path_reset', reason)
    pathList = []
    if (digging) {
      bot.on('diggingAborted', detectDiggingStopped)
      bot.on('diggingCompleted', detectDiggingStopped)
      bot.stopDigging()
    }
    placing = false
    landingAfterJump = false
    pathUpdated = false
    bot.pathfinder.planning = false
    if (bot.pathfinder.activeWorkers) {
      for (const w of bot.pathfinder.activeWorkers) {
        try { w.terminate() } catch (e) {}
      }
      bot.pathfinder.activeWorkers = []
    }
    lockEquipItem.release()
    lockPlaceBlock.release()
    lockUseBlock.release()
    stateMovements.clearCollisionIndex()
    if (clearStates) bot.clearControlStates()
    if (stopPathing) return stop()
  }

  function detectDiggingStopped () {
    digging = false
    bot.removeAllListeners('diggingAborted', detectDiggingStopped)
    bot.removeAllListeners('diggingCompleted', detectDiggingStopped)
  }

  function stop () {
    stopPathing = false
    stateGoal = null
    pathList = []
    bot.pathfinder.planning = false
    if (bot.pathfinder.activeWorkers) {
      for (const w of bot.pathfinder.activeWorkers) {
        try { w.terminate() } catch (e) {}
      }
      bot.pathfinder.activeWorkers = []
    }
    bot.emit('path_stop')
    fullStop()
  }

  // ponytail: serialize Movements configurations for workers
  function serializeMovementsSettings (movements) {
    const settings = {}
    for (const [key, val] of Object.entries(movements)) {
      if (key === 'exclusionAreasStep' || key === 'exclusionAreasBreak' || key === 'exclusionAreasPlace') {
        continue
      }
      if (val instanceof Set) {
        settings[key] = Array.from(val)
      } else if (typeof val !== 'function' && key !== 'bot') {
        settings[key] = val
      }
    }
    return settings
  }

  function serializeGoal (goal) {
    if (!goal) return null
    if (goal.constructor.name === 'GoalBlock') {
      return { type: 'GoalBlock', x: goal.x, y: goal.y, z: goal.z }
    } else if (goal.constructor.name === 'GoalNear') {
      return { type: 'GoalNear', x: goal.x, y: goal.y, z: goal.z, range: Math.sqrt(goal.rangeSq) }
    } else if (goal.constructor.name === 'GoalFollow') {
      return { type: 'GoalNear', x: goal.entity.position.x, y: goal.entity.position.y, z: goal.entity.position.z, range: Math.sqrt(goal.rangeSq) }
    } else if (goal.constructor.name === 'GoalXZ') {
      return { type: 'GoalXZ', x: goal.x, z: goal.z }
    } else if (goal.constructor.name === 'GoalNearXZ') {
      return { type: 'GoalNearXZ', x: goal.x, z: goal.z, range: Math.sqrt(goal.rangeSq) }
    } else if (goal.constructor.name === 'GoalY') {
      return { type: 'GoalY', y: goal.y }
    } else if (goal.constructor.name === 'GoalGetToBlock') {
      return { type: 'GoalGetToBlock', x: goal.x, y: goal.y, z: goal.z }
    } else {
      if (goal.goals) {
        return {
          type: goal.constructor.name,
          goals: goal.goals.map(serializeGoal)
        }
      }
      return {
        type: goal.constructor.name,
        ...goal
      }
    }
  }

  function hasActions (result) {
    if (!result.path) return false
    for (const move of result.path) {
      if (move.toBreak.length > 0 || move.toPlace.length > 0) return true
    }
    return false
  }

  // ponytail: prefer walking path (safe) first, then standard, then aggressive to minimize bridging/digging
  function selectBestPath (resultSafe, resultStandard, resultAggressive) {
    const pathSafe = (resultSafe && (resultSafe.status === 'success' || resultSafe.status === 'partial')) ? resultSafe : null
    const pathStandard = (resultStandard && (resultStandard.status === 'success' || resultStandard.status === 'partial')) ? resultStandard : null
    const pathAggressive = (resultAggressive && (resultAggressive.status === 'success' || resultAggressive.status === 'partial')) ? resultAggressive : null

    if (pathSafe) return pathSafe
    if (pathStandard) return pathStandard
    if (pathAggressive) return pathAggressive

    const candidates = [resultSafe, resultStandard, resultAggressive].filter(r => r !== null)
    if (candidates.length === 0) return { status: 'noPath', cost: Number.MAX_VALUE, path: [] }

    candidates.sort((a, b) => (a.bestNodeH ?? 999999) - (b.bestNodeH ?? 999999))
    return candidates[0]
  }

  // ponytail: async pathfinder starting 3 concurrent search strategies (Walking, Standard, Aggressive)
    bot.pathfinder.getPathToAsync = (movements, goal, timeout = bot.pathfinder.thinkTimeout) => {
      console.log(`[Pathfinder] getPathToAsync started. Start: ${bot.entity.position.floored()}, Goal: type=${goal.constructor.name || 'unknown'}`);
      // ponytail: dynamically register solid, non-gravity, non-interactable blocks as scaffolding
      for (const item of bot.inventory.items()) {
        const block = bot.registry.blocksByName[item.name]
        if (block && block.boundingBox === 'block' && !movements.interactableBlocks.has(block.name) && !movements.gravityBlocks.has(block.id)) {
          if (!movements.scafoldingBlocks.includes(item.type)) {
            movements.scafoldingBlocks.push(item.type)
          }
        }
      }

    return new Promise((resolve, reject) => {
      const p = bot.entity.position.floored()
      const dy = bot.entity.position.y - p.y
      const b = bot.blockAt(p)
      const offset = (b && dy > 0.001 && bot.entity.onGround && !movements.emptyBlocks.has(b.type)) ? 1 : 0
      const start = {
        x: p.x,
        y: p.y + offset,
        z: p.z,
        remainingBlocks: movements.countScaffoldingItems(),
        cost: 0
      }

      if (movements.allowEntityDetection) {
        movements.clearCollisionIndex()
        movements.updateCollisionIndex()
      }

      const baseMovementsSettings = serializeMovementsSettings(movements)
      const serializedGoal = serializeGoal(goal)
      const version = bot.version || '1.20.4'

      // Scale searchRadius by distance to goal so A* cost ceiling is never too tight
      const gx = serializedGoal ? (serializedGoal.x ?? bot.entity.position.x) : bot.entity.position.x
      const gy = serializedGoal ? (serializedGoal.y ?? bot.entity.position.y) : bot.entity.position.y
      const gz = serializedGoal ? (serializedGoal.z ?? bot.entity.position.z) : bot.entity.position.z
      const goalDist = Math.sqrt(
        Math.pow(gx - bot.entity.position.x, 2) +
        Math.pow(gy - bot.entity.position.y, 2) +
        Math.pow(gz - bot.entity.position.z, 2)
      )
      // searchRadius: scale with distance but cap at 100 to bound search space
      const searchRadius = Math.max(bot.pathfinder.searchRadius || 48, Math.min(goalDist * 1.3, 100))
      console.log(`[Pathfinder] goalDist: ${goalDist.toFixed(1)}, effective searchRadius: ${searchRadius.toFixed(1)}`)

      const safeSettings = { ...baseMovementsSettings, canDig: false, scafoldingBlocks: [] }
      const standardSettings = { ...baseMovementsSettings, digCost: 2.0, placeCost: 1.0 }
      const aggressiveSettings = { ...baseMovementsSettings, digCost: 1.0, placeCost: 0.5 }

      const configs = [
        { settings: safeSettings, name: 'safe' },
        { settings: standardSettings, name: 'standard' },
        { settings: aggressiveSettings, name: 'aggressive' }
      ]

      let resolved = false
      const results = {}
      const workers = []

      const cleanup = () => {
        for (const w of workers) {
          try { w.terminate() } catch (e) {}
        }
      }

      const checkDone = () => {
        if (resolved) return
        if (Object.keys(results).length === 3) {
          resolved = true
          cleanup()
          console.log(`[Pathfinder] safe status: ${results.safe?.status}, path length: ${results.safe?.path?.length}`);
          console.log(`[Pathfinder] standard status: ${results.standard?.status}, path length: ${results.standard?.path?.length}`);
          console.log(`[Pathfinder] aggressive status: ${results.aggressive?.status}, path length: ${results.aggressive?.path?.length}`);
          const bestResult = selectBestPath(results.safe, results.standard, results.aggressive)
          console.log(`[Pathfinder] best strategy chosen: path length: ${bestResult?.path?.length}, status: ${bestResult?.status}`);
          if (bestResult && bestResult.path) {
            bestResult.path = bestResult.path.map(n => new Move(n.x, n.y, n.z, n.remainingBlocks, n.cost, n.toBreak, n.toPlace, n.parkour))
          }
          resolve(bestResult)
        }
      }

      const activeExclusions = []
      const now = Date.now()
      for (const [hash, expiry] of temporaryExclusions.entries()) {
        if (now < expiry) {
          activeExclusions.push(hash)
        }
      }

      configs.forEach(cfg => {
        const sharedBuffer = new SharedArrayBuffer(8192)
        const sharedInts = new Int32Array(sharedBuffer)

        const workerData = {
          start,
          goal: serializedGoal,
          movementsSettings: cfg.settings,
          entityIntersections: movements.entityIntersections,
          inventoryItems: bot.inventory.items().map(i => ({ type: i.type, count: i.count })),
          version,
          searchRadius,
          timeout,
          minY: bot.game ? bot.game.minY : 0,
          exclusions: activeExclusions,
          sharedBuffer
        }

        const worker = new Worker(path.join(__dirname, 'astar_worker.cjs'), { workerData })
        workers.push(worker)

        worker.on('message', (msg) => {
          if (msg.type === 'block_req') {
            const x = Atomics.load(sharedInts, 1)
            const y = Atomics.load(sharedInts, 2)
            const z = Atomics.load(sharedInts, 3)
            const cx = x
            const cy = y
            const cz = z

            let idx = 4
            for (let dx = -4; dx <= 4; dx++) {
              for (let dy = -4; dy <= 4; dy++) {
                for (let dz = -4; dz <= 4; dz++) {
                  const rx = cx + dx
                  const ry = cy + dy
                  const rz = cz + dz
                  const block = bot.blockAt(new Vec3(rx, ry, rz), false)
                  if (!block) {
                    Atomics.store(sharedInts, idx++, -1)
                    Atomics.store(sharedInts, idx++, 0)
                  } else {
                    Atomics.store(sharedInts, idx++, block.stateId)

                    const tool = bot.pathfinder.bestHarvestTool(block)
                    const enchants = (tool && tool.nbt) ? nbt.simplify(tool.nbt).Enchantments : []
                    const effects = bot.entity.effects
                    const digTime = block.digTime(tool ? tool.type : null, false, false, false, enchants, effects)
                    Atomics.store(sharedInts, idx++, digTime)
                  }
                }
              }
            }

            Atomics.store(sharedInts, 0, 2)
            Atomics.notify(sharedInts, 0, 1)
          } else if (msg.type === 'result') {
            results[cfg.name] = msg.result
            checkDone()
          } else if (msg.type === 'error') {
            console.error(`[Pathfinder] Worker ${cfg.name} failed:`, msg.error)
            results[cfg.name] = { status: 'noPath', cost: Number.MAX_VALUE, path: [] }
            checkDone()
          }
        })

        worker.on('error', (err) => {
          console.error(`[Pathfinder] Worker ${cfg.name} error:`, err)
          results[cfg.name] = { status: 'noPath', cost: Number.MAX_VALUE, path: [] }
          checkDone()
        })

        worker.on('exit', (code) => {
          if (code !== 0 && !resolved) {
            results[cfg.name] = results[cfg.name] || { status: 'noPath', cost: Number.MAX_VALUE, path: [] }
            checkDone()
          }
        })
      })

      bot.pathfinder.activeWorkers = workers
    })
  }

  function postProcessPath (path) {
    for (let i = 0; i < path.length; i++) {
      const curPoint = path[i]
      if (curPoint.toBreak.length > 0 || curPoint.toPlace.length > 0) break
      const b = bot.blockAt(new Vec3(curPoint.x, curPoint.y, curPoint.z))
      if (b && (b.type === waterType || ((b.type === ladderId || b.type === vineId) && i + 1 < path.length && path[i + 1].y < curPoint.y))) {
        curPoint.x = Math.floor(curPoint.x) + 0.5
        curPoint.y = Math.floor(curPoint.y)
        curPoint.z = Math.floor(curPoint.z) + 0.5
        continue
      }
      let np = getPositionOnTopOf(b)
      if (np === null) np = getPositionOnTopOf(bot.blockAt(new Vec3(curPoint.x, curPoint.y - 1, curPoint.z)))
      if (np) {
        curPoint.x = np.x
        curPoint.y = np.y
        curPoint.z = np.z
      } else {
        curPoint.x = Math.floor(curPoint.x) + 0.5
        curPoint.y = curPoint.y - 1
        curPoint.z = Math.floor(curPoint.z) + 0.5
      }
    }

    if (!bot.pathfinder.enablePathShortcut || stateMovements.exclusionAreasStep.length !== 0 || path.length === 0) return path

    const newPath = []
    let lastNode = bot.entity.position
    for (let i = 1; i < path.length; i++) {
      const node = path[i]
      if (Math.abs(node.y - lastNode.y) > 0.5 || node.toBreak.length > 0 || node.toPlace.length > 0 || !physics.canStraightLineBetween(lastNode, node)) {
        newPath.push(path[i - 1])
        lastNode = path[i - 1]
      }
    }
    newPath.push(path[path.length - 1])
    return newPath
  }

  function getPositionOnTopOf (block) {
    if (!block || block.shapes.length === 0) return null
    const p = new Vec3(0.5, 0, 0.5)
    let n = 1
    for (const shape of block.shapes) {
      const h = shape[4]
      if (h === p.y) {
        p.x += (shape[0] + shape[3]) / 2
        p.z += (shape[2] + shape[5]) / 2
        n++
      } else if (h > p.y) {
        n = 2
        p.x = 0.5 + (shape[0] + shape[3]) / 2
        p.y = h
        p.z = 0.5 + (shape[2] + shape[5]) / 2
      }
    }
    p.x /= n
    p.z /= n
    return block.position.plus(p)
  }

  function pathFromPlayer (path) {
    if (path.length === 0) return
    let minI = 0
    let minDistance = 1000
    for (let i = 0; i < path.length; i++) {
      const node = path[i]
      if (node.toBreak.length !== 0 || node.toPlace.length !== 0) break
      const dist = bot.entity.position.distanceSquared(node)
      if (dist < minDistance) {
        minDistance = dist
        minI = i
      }
    }
    const n1 = path[minI]
    const dx = n1.x - bot.entity.position.x
    const dy = n1.y - bot.entity.position.y
    const dz = n1.z - bot.entity.position.z
    const reached = Math.abs(dx) <= 0.35 && Math.abs(dz) <= 0.35 && Math.abs(dy) < 1
    if (minI + 1 < path.length && n1.toBreak.length === 0 && n1.toPlace.length === 0) {
      const n2 = path[minI + 1]
      const d2 = bot.entity.position.distanceSquared(n2)
      const d12 = n1.distanceSquared(n2)
      minI += d12 > d2 || reached ? 1 : 0
    }
    path.splice(0, minI)
  }

  function isPositionNearPath (pos, path) {
    let prevNode = null
    for (const node of path) {
      let comparisonPoint = null
      if (prevNode === null || (Math.abs(prevNode.x - node.x) <= 2 && Math.abs(prevNode.y - node.y) <= 2 && Math.abs(prevNode.z - node.z) <= 2)) {
        comparisonPoint = node
      } else {
        const minBound = prevNode.min(node)
        const maxBound = prevNode.max(node)
        if (pos.x - 0.5 < minBound.x - 1 || pos.x - 0.5 > maxBound.x + 1 || pos.y - 0.5 < minBound.y - 2 || pos.y - 0.5 > maxBound.y + 2 || pos.z - 0.5 < minBound.z - 1 || pos.z - 0.5 > maxBound.z + 1) {
          continue
        }
        comparisonPoint = closestPointOnLineSegment(pos, prevNode, node)
      }
      const dx = Math.abs(comparisonPoint.x - pos.x - 0.5)
      const dy = Math.abs(comparisonPoint.y - pos.y - 0.5)
      const dz = Math.abs(comparisonPoint.z - pos.z - 0.5)
      if (dx <= 1 && dy <= 2 && dz <= 1) return true
      prevNode = node
    }
    return false
  }

  function closestPointOnLineSegment (point, segmentStart, segmentEnd) {
    const segmentLength = segmentEnd.minus(segmentStart).norm()
    if (segmentLength === 0) {
      return segmentStart
    }
    let t = (point.minus(segmentStart)).dot(segmentEnd.minus(segmentStart)) / segmentLength
    t = Math.max(0, Math.min(1, t))
    return segmentStart.plus(segmentEnd.minus(segmentStart).scaled(t))
  }

  function fullStop () {
    bot.clearControlStates()
    bot.entity.velocity.x = 0
    bot.entity.velocity.z = 0
    // Snap to block center when drifted more than 0.1 blocks to prevent desync
    const stopCenterX = Math.floor(bot.entity.position.x) + 0.5
    const stopCenterZ = Math.floor(bot.entity.position.z) + 0.5
    if (Math.abs(bot.entity.position.x - stopCenterX) > 0.1) bot.entity.position.x = stopCenterX
    if (Math.abs(bot.entity.position.z - stopCenterZ) > 0.1) bot.entity.position.z = stopCenterZ
  }

  function moveToEdge (refBlock, edge) {
    const allowInstantTurn = false
    function getViewVector (pitch, yaw) {
      const csPitch = Math.cos(pitch)
      const snPitch = Math.sin(pitch)
      const csYaw = Math.cos(yaw)
      const snYaw = Math.sin(yaw)
      return new Vec3(-snYaw * csPitch, snPitch, -csYaw * csPitch)
    }
    const targetBlockPos = refBlock.offset(edge.x + 0.5, edge.y, edge.z + 0.5)
    const targetPosDelta = bot.entity.position.clone().subtract(targetBlockPos)
    const targetYaw = Math.atan2(-targetPosDelta.x, -targetPosDelta.z)
    const targetPitch = -1.421
    const viewVector = getViewVector(targetPitch, targetYaw)
    if (bot.entity.position.distanceTo(refBlock.clone().offset(edge.x + 0.5, 1, edge.z + 0.5)) > 0.4) {
      bot.lookAt(bot.entity.position.offset(viewVector.x, viewVector.y, viewVector.z), allowInstantTurn)
      bot.setControlState('sneak', true)
      bot.setControlState('back', true)
      return false
    }
    bot.setControlState('back', false)
    return true
  }

  function moveToBlock (pos) {
    const minDistanceSq = 0.2 * 0.2
    const targetPos = pos.clone().offset(0.5, 0, 0.5)
    if (bot.entity.position.distanceSquared(targetPos) > minDistanceSq) {
      bot.lookAt(targetPos)
      bot.setControlState('forward', true)
      return false
    }
    bot.setControlState('forward', false)
    return true
  }

  // Guard: after jump-place, wait for the bot to land before releasing the placing lock
  // Prevents the bot from trying to walk while still mid-air and falling off the placed block
  function checkLanding () {
    if (!landingAfterJump) return false
    if (bot.entity.onGround) {
      landingAfterJump = false
      placing = false
      lockPlaceBlock.release()
      lastNodeTime = performance.now()
      // Snap bot to block center so it doesn't drift off the edge
      bot.entity.velocity.x = 0
      bot.entity.velocity.z = 0
      const landCenterX = Math.floor(bot.entity.position.x) + 0.5
      const landCenterZ = Math.floor(bot.entity.position.z) + 0.5
      if (Math.abs(bot.entity.position.x - landCenterX) > 0.1) bot.entity.position.x = landCenterX
      if (Math.abs(bot.entity.position.z - landCenterZ) > 0.1) bot.entity.position.z = landCenterZ
      // Clear remaining path — the bot's position just changed significantly (moved up 1 block)
      // so old path nodes are invalid and would cause the bot to walk off the pillar
      pathList = []
      pathUpdated = false
      // Signal the main loop to pause follow/lookAt for ~20 ticks to let the custom
      // pathfinder re-plan from the new position without interference
      if (bot.botState) bot.botState.landingCooldownTicks = 20
    }
    return true // still waiting to land
  }

  bot.on('blockUpdate', (oldBlock, newBlock) => {
    if (!oldBlock || !newBlock) return
    if (lastPlacedPos && oldBlock.position.equals(lastPlacedPos)) {
      lastPlacedPos = null
      return
    }
    if (isPositionNearPath(oldBlock.position, pathList) && oldBlock.type !== newBlock.type) {
      resetPath('block_updated', false)
    }
  })

  // ponytail: handle movement monitoring on physics tick with async path calculation hook
  bot.on('physicsTick', monitorMovement)

  function monitorMovement () {
    // MUST check landing BEFORE anything else — allowFreeMotion, preplan, and path movement
    // all try to walk forward, which causes the bot to walk off ledges mid-air
    if (checkLanding()) return

    if (stateMovements && stateMovements.allowFreeMotion && stateGoal && stateGoal.entity) {
      const target = stateGoal.entity
      if (physics.canStraightLine([target.position])) {
        bot.lookAt(target.position.offset(0, 1.6, 0))
        if (target.position.distanceSquared(bot.entity.position) > stateGoal.rangeSq) {
          bot.setControlState('forward', true)
        } else {
          bot.clearControlStates()
        }
        return
      }
    }
    if (stateGoal) {
      if (!stateGoal.isValid()) {
        stop()
        return
      }
      
      const currentPos = bot.entity.position.floored()
      if (stateGoal.isEnd(currentPos) || stateGoal.isEnd(currentPos.offset(0, 1, 0))) {
        if (!dynamicGoal) {
          bot.emit('goal_reached', stateGoal)
          stop()
          return
        }
      }

      if (stateGoal.hasChanged()) {
        // Clear stale pathList — entity has moved so current path is going to the old position
        // Don't keep walking the old path; stop and re-plan immediately from current location
        pathList = []
        pathUpdated = false
        if (bot.pathfinder.activeWorkers) {
          for (const w of bot.pathfinder.activeWorkers) {
            try { w.terminate() } catch (e) {}
          }
          bot.pathfinder.activeWorkers = []
        }
        bot.pathfinder.planning = false
      }
    }

    if (bot.pathfinder.LOSWhenPlacingBlocks && returningPos) {
      if (!moveToBlock(returningPos)) return
      returningPos = null
    }

    if (stateGoal && stateMovements) {
      if (Date.now() - lastCustomLogTime > 1000) {
        lastCustomLogTime = Date.now();
        console.log(`[Pathfinder] planning: ${bot.pathfinder.planning}, pathList.length: ${pathList.length}, pathUpdated: ${pathUpdated}, lastPlanDiff: ${Date.now() - lastPlanTime}ms`);
      }
    }

    // ponytail: pre-plan the next path in the background when the goal has changed or when the path is running out
    const needsPreplan = stateGoal && stateMovements && !bot.pathfinder.planning &&
                         (pathList.length <= 5 && (!pathUpdated || Date.now() - lastPlanTime > 2000))
 
    if (needsPreplan) {
      if (pathList.length === 0) {
        if (stateGoal.isEnd(bot.entity.position.floored())) {
          if (!dynamicGoal) {
            console.log(`[Pathfinder] Goal already reached! Emitting goal_reached.`);
            bot.emit('goal_reached', stateGoal)
            stateGoal = null
            fullStop()
            return
          }
        }
      }
 
      console.log(`[Pathfinder] Triggering async path plan towards goal: ${stateGoal.constructor.name}`);
      bot.pathfinder.planning = true
      lastPlanTime = Date.now()
      bot.pathfinder.getPathToAsync(stateMovements, stateGoal)
        .then(results => {
          bot.pathfinder.planning = false
          results.path = postProcessPath(results.path)
          pathFromPlayer(results.path)
          bot.emit('path_update', results)
          pathList = results.path
          pathUpdated = true
          lastNodeTime = performance.now()
        })
        .catch(err => {
          bot.pathfinder.planning = false
          console.error('[Pathfinder] Async planning failed:', err)
        })
    }

    if (pathList.length === 0) {
      return
    }

    let nextPoint = pathList[0]
    const p = bot.entity.position

    if (digging || nextPoint.toBreak.length > 0) {
      if (!digging && bot.entity.onGround) {
        digging = true
        const b = nextPoint.toBreak.shift()
        const block = bot.blockAt(new Vec3(b.x, b.y, b.z), false)
        const tool = bot.pathfinder.bestHarvestTool(block)
        fullStop()

        const digBlock = () => {
          bot.dig(block, true)
            .catch(() => {
              resetPath('dig_error')
            })
            .then(function () {
              lastNodeTime = performance.now()
              digging = false
            })
        }

        if (!tool) {
          digBlock()
        } else {
          bot.equip(tool, 'hand')
            .catch(() => {})
            .then(() => digBlock())
        }
      }
      return
    }

    if (placing || nextPoint.toPlace.length > 0) {
      const block = stateMovements.getScaffoldingItem()
      if (!block) {
        resetPath('no_scaffolding_blocks')
        return
      }

      // ponytail: equip scaffolding block BEFORE starting placement to avoid mid-air equip delays
      const equipped = bot.heldItem && bot.heldItem.type === block.type
      if (!equipped) {
        if (!placing) {
          placing = true
          const nextToPlace = nextPoint.toPlace[0]
          if (!nextToPlace?.jump) {
            fullStop()
          } else {
            bot.setControlState('forward', false)
            bot.setControlState('back', false)
            bot.setControlState('left', false)
            bot.setControlState('right', false)
            bot.setControlState('sprint', false)
            bot.entity.velocity.x = 0
            bot.entity.velocity.z = 0
          }
          bot.equip(block, 'hand')
            .catch(() => {})
            .then(() => {
              placing = false
            })
        }
        return
      }
 
      if (!placing) {
        placing = true
        placingBlock = nextPoint.toPlace.shift()
        if (!placingBlock.jump) {
          fullStop()
        } else {
          bot.setControlState('forward', false)
          bot.setControlState('back', false)
          bot.setControlState('left', false)
          bot.setControlState('right', false)
          bot.setControlState('sprint', false)
          bot.entity.velocity.x = 0
          bot.entity.velocity.z = 0
        }
      }
 
      if (placingBlock?.useOne) {
        if (!lockUseBlock.tryAcquire()) return
        bot.activateBlock(bot.blockAt(new Vec3(placingBlock.x, placingBlock.y, placingBlock.z))).then(() => {
          lockUseBlock.release()
          placingBlock = nextPoint.toPlace.shift()
        }, err => {
          console.error(err)
          lockUseBlock.release()
        })
        return
      }
 
      if (bot.pathfinder.LOSWhenPlacingBlocks && placingBlock.y === bot.entity.position.floored().y - 1 && placingBlock.dy === 0 && !placingBlock.jump) {
        if (!moveToEdge(new Vec3(placingBlock.x, placingBlock.y, placingBlock.z), new Vec3(placingBlock.dx, 0, placingBlock.dz))) return
      }
      let canPlace = true
      if (placingBlock.jump) {
        if (!bot.controlState.jump) {
          bot.setControlState('forward', false)
          bot.setControlState('back', false)
          bot.setControlState('left', false)
          bot.setControlState('right', false)
          bot.setControlState('sprint', false)
          bot.entity.velocity.x = 0
          bot.entity.velocity.z = 0
          bot.setControlState('jump', true)
          jumpStartTime = performance.now()
        }
        canPlace = performance.now() - jumpStartTime > 150
      }
      if (canPlace) {
        if (placingBlock.jump) {
          // Keep jump active during placeBlock — releasing early causes the bot to fall
          bot.look(bot.entity.yaw, -Math.PI / 2, true)
        }
        const refBlock = bot.blockAt(new Vec3(placingBlock.x, placingBlock.y, placingBlock.z), false)
        if (!lockPlaceBlock.tryAcquire()) return
        if (interactableBlocks.includes(refBlock.name)) {
          bot.setControlState('sneak', true)
        }
        lastPlacedPos = new Vec3(placingBlock.x + placingBlock.dx, placingBlock.y + placingBlock.dy, placingBlock.z + placingBlock.dz)
        bot.placeBlock(refBlock, new Vec3(placingBlock.dx, placingBlock.dy, placingBlock.dz))
          .then(function () {
            bot.setControlState('sneak', false)
            if (placingBlock.jump) {
              // Stop jumping — block is placed, now wait to land on it
              bot.setControlState('jump', false)
              landingAfterJump = true
              // Keep placing=true and lock held — checkLanding() will release when grounded
            } else {
              if (bot.pathfinder.LOSWhenPlacingBlocks && placingBlock.returnPos) returningPos = placingBlock.returnPos.clone()
            }
          })
          .catch(() => {
            lastPlacedPos = null
            if (placingBlock?.jump) {
              bot.setControlState('jump', false)
            }
            resetPath('place_error')
          })
          .then(() => {
            // For jump-places, lock release happens in checkLanding() (so the bot stays put while falling)
            // For non-jump or error paths, release here
            if (!landingAfterJump) {
              lockPlaceBlock.release()
              placing = false
              lastNodeTime = performance.now()
            }
          })
      }
      return
    }

    let dx = nextPoint.x - p.x
    const dy = nextPoint.y - p.y
    let dz = nextPoint.z - p.z
    if (Math.abs(dx) <= 0.35 && Math.abs(dz) <= 0.35 && Math.abs(dy) < 1) {
      lastNodeTime = performance.now()
      // Center the bot on the block when reaching a node to prevent drift accumulation
      const reachCenterX = Math.floor(bot.entity.position.x) + 0.5
      const reachCenterZ = Math.floor(bot.entity.position.z) + 0.5
      if (Math.abs(bot.entity.position.x - reachCenterX) > 0.1) bot.entity.position.x = reachCenterX
      if (Math.abs(bot.entity.position.z - reachCenterZ) > 0.1) bot.entity.position.z = reachCenterZ
      if (stopPathing) {
        stop()
        return
      }
      pathList.shift()
      if (pathList.length === 0) {
        if (!dynamicGoal && stateGoal && (stateGoal.isEnd(p.floored()) || stateGoal.isEnd(p.floored().offset(0, 1, 0)))) {
          bot.emit('goal_reached', stateGoal)
          stateGoal = null
        }
        fullStop()
        return
      }
      nextPoint = pathList[0]
      if (nextPoint.toBreak.length > 0 || (nextPoint.toPlace.length > 0 && !nextPoint.toPlace[0].jump)) {
        fullStop()
        return
      }
      dx = nextPoint.x - p.x
      dz = nextPoint.z - p.z
    }

    bot.look(Math.atan2(-dx, -dz), 0)
    bot.setControlState('forward', true)
    bot.setControlState('jump', false)

    // ponytail: safety check for sprint-jumping — only allow if the next 3 path nodes
    // are in a straight line at the same Y level. Sprint-jumping covers ~4 blocks and
    // would overshoot turns or elevation changes, causing the bot to fall off edges.
    function isSprintJumpSafe (pl) {
      if (pl.length < 3) return false
      const n0 = pl[0], n1 = pl[1], n2 = pl[2]
      // All at same Y level — no elevation change coming up
      if (Math.abs(n1.y - n0.y) > 0.1 || Math.abs(n2.y - n0.y) > 0.1) return false
      // No break/place actions in the jump arc
      if (n1.toBreak.length > 0 || n1.toPlace.length > 0) return false
      if (n2.toBreak.length > 0 || n2.toPlace.length > 0) return false
      // Straight line: same direction for next 2 segments
      const d1x = n1.x - n0.x
      const d1z = n1.z - n0.z
      // Use sign to check direction — allow zero (no movement on that axis)
      const s1x = d1x === 0 ? 0 : Math.sign(d1x)
      const s1z = d1z === 0 ? 0 : Math.sign(d1z)
      const d2x = n2.x - n1.x
      const d2z = n2.z - n1.z
      const s2x = d2x === 0 ? 0 : Math.sign(d2x)
      const s2z = d2z === 0 ? 0 : Math.sign(d2z)
      // Direction changed (turn) → not safe to sprint-jump
      if (s2x !== 0 && s1x !== 0 && s2x !== s1x) return false
      if (s2z !== 0 && s1z !== 0 && s2z !== s1z) return false
      return true
    }

    if (bot.entity.isInWater) {
      bot.setControlState('jump', true)
      bot.setControlState('sprint', false)
    } else if (stateMovements.allowSprinting && physics.canStraightLine(pathList, true) && isSprintJumpSafe(pathList)) {
      bot.setControlState('jump', false)
      bot.setControlState('sprint', true)
    } else if (stateMovements.allowSprinting && physics.canSprintJump(pathList) && isSprintJumpSafe(pathList)) {
      bot.setControlState('jump', true)
      bot.setControlState('sprint', true)
    } else if (physics.canStraightLine(pathList)) {
      bot.setControlState('jump', false)
      bot.setControlState('sprint', false)
    } else if (physics.canWalkJump(pathList)) {
      bot.setControlState('jump', true)
      bot.setControlState('sprint', false)
    } else {
      bot.setControlState('forward', false)
      bot.setControlState('sprint', false)
    }

    if (pathList.length > 0 && performance.now() - lastNodeTime > 3500) {
      const nextPt = pathList[0]
      const hash = `${Math.floor(nextPt.x)},${Math.floor(nextPt.y)},${Math.floor(nextPt.z)}`
      temporaryExclusions.set(hash, Date.now() + 15000) // avoid for 15 seconds
      resetPath('stuck')
    }
  }
}

module.exports = customPathfinder
