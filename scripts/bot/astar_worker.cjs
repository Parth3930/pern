const { parentPort, workerData } = require('worker_threads')
const { Vec3 } = require('vec3')
const minecraftData = require('minecraft-data')
const prismarineBlock = require('prismarine-block')

// ponytail: import pathfinder classes from standard mineflayer-pathfinder package
const AStar = require('mineflayer-pathfinder/lib/astar')
const Movements = require('mineflayer-pathfinder/lib/movements')
const Move = require('mineflayer-pathfinder/lib/move')
const goals = require('mineflayer-pathfinder/lib/goals')

const registry = minecraftData(workerData.version)
const Block = prismarineBlock(registry)

const sharedBuffer = workerData.sharedBuffer
const sharedInts = new Int32Array(sharedBuffer)

const blockCache = new Map()

// ponytail: query blocks in 9x9x9 batches to minimize thread communication overhead
function getBlock (x, y, z) {
  const hash = `${x},${y},${z}`
  if (blockCache.has(hash)) {
    return blockCache.get(hash)
  }

  // Request block region from main thread
  Atomics.store(sharedInts, 1, x)
  Atomics.store(sharedInts, 2, y)
  Atomics.store(sharedInts, 3, z)
  Atomics.store(sharedInts, 0, 1) // REQUEST_PENDING

  parentPort.postMessage({ type: 'block_req' })

  // Synchronously block until response is ready
  Atomics.wait(sharedInts, 0, 1)

  let idx = 4
  const cx = x
  const cy = y
  const cz = z

  for (let dx = -4; dx <= 4; dx++) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dz = -4; dz <= 4; dz++) {
        const stateId = Atomics.load(sharedInts, idx++)
        const digTime = Atomics.load(sharedInts, idx++)
        const rx = cx + dx
        const ry = cy + dy
        const rz = cz + dz
        const rHash = `${rx},${ry},${rz}`

        if (stateId === -1) {
          blockCache.set(rHash, null)
        } else {
          const block = Block.fromStateId(stateId)
          block.position = new Vec3(rx, ry, rz)
          block.digTime = () => digTime
          blockCache.set(rHash, block)
        }
      }
    }
  }

  return blockCache.get(hash) || null
}

const mockBot = {
  registry,
  inventory: {
    items: () => workerData.inventoryItems
  },
  game: {
    minY: workerData.minY
  },
  entity: {
    effects: {}
  },
  pathfinder: {
    bestHarvestTool: () => null
  },
  blockAt: (pos) => {
    return getBlock(pos.x, pos.y, pos.z)
  }
}

function reconstructGoal (serialized) {
  const { type, ...props } = serialized
  if (type === 'GoalCompositeAny') {
    return new goals.GoalCompositeAny(props.goals.map(reconstructGoal))
  }
  if (type === 'GoalCompositeAll') {
    return new goals.GoalCompositeAll(props.goals.map(reconstructGoal))
  }
  if (type === 'GoalInvert') {
    return new goals.GoalInvert(reconstructGoal(props.goal))
  }

  const GoalClass = goals[type]
  if (!GoalClass) {
    throw new Error(`Unknown goal type: ${type}`)
  }

  if (type === 'GoalBlock' || type === 'GoalGetToBlock') {
    return new GoalClass(props.x, props.y, props.z)
  }
  if (type === 'GoalNear' || type === 'GoalFollow') {
    return new goals.GoalNear(props.x, props.y, props.z, props.range)
  }
  if (type === 'GoalXZ') {
    return new GoalClass(props.x, props.z)
  }
  if (type === 'GoalNearXZ') {
    return new GoalClass(props.x, props.z, props.range)
  }
  if (type === 'GoalY') {
    return new GoalClass(props.y)
  }

  const instance = Object.create(GoalClass.prototype)
  Object.assign(instance, props)
  return instance
}

try {
  const movements = new Movements(mockBot)
  const setKeys = new Set([
    'entitiesToAvoid',
    'passableEntities',
    'interactableBlocks',
    'blocksCantBreak',
    'blocksToAvoid',
    'liquids',
    'gravityBlocks',
    'climbables',
    'emptyBlocks',
    'replaceables',
    'fences',
    'carpets',
    'openable'
  ])
  for (const [key, val] of Object.entries(workerData.movementsSettings)) {
    if (setKeys.has(key)) {
      movements[key] = new Set(val)
    } else {
      movements[key] = val
    }
  }
  movements.entityIntersections = workerData.entityIntersections
 
  const originalGetNeighbors = movements.getNeighbors.bind(movements)
  movements.getNeighbors = (node) => {
    let neighbors
    try {
      neighbors = originalGetNeighbors(node)
    } catch (e) {
      return []
    }
    for (const neighbor of neighbors) {
      if (neighbor.toBreak && neighbor.toBreak.length > 0) {
        let penalty = 0
        for (const pos of neighbor.toBreak) {
          // pos is a Vec3 — must use pos.x/y/z, not pass the object directly
          const block = movements.blockAt ? movements.blockAt(pos) : getBlock(pos.x, pos.y, pos.z)
          if (!block) continue  // unloaded chunk — skip penalty, don't crash
          const digTime = typeof block.digTime === 'function' ? block.digTime() : 500
          const timeSecs = digTime / 1000
          // Soft preference to walk around rather than dig, but low enough
          // that the A* cost ceiling isn't breached on long-distance paths
          // ponytail: moderate dig penalty — high enough to prefer walking around, low enough to avoid search explosion
          penalty += 5.0 + Math.pow(timeSecs * 2.0, 2.0) * 3.0
        }
        neighbor.cost += penalty
      }
    }
    return neighbors
  }

  const exclusions = new Set(workerData.exclusions || [])
  function getExclusionWeight (block) {
    if (!block || !block.position) return 0
    const hash = `${block.position.x},${block.position.y},${block.position.z}`
    if (exclusions.has(hash)) {
      return 1000
    }
    return 0
  }
  movements.exclusionAreasStep.push(getExclusionWeight)

  const startMove = new Move(workerData.start.x, workerData.start.y, workerData.start.z, workerData.start.remainingBlocks, workerData.start.cost)
  const goal = reconstructGoal(workerData.goal)

  const astar = new AStar(startMove, movements, goal, workerData.timeout, 9999999, workerData.searchRadius)
  const result = astar.compute()

  parentPort.postMessage({
    type: 'result',
    result: {
      status: result.status,
      cost: result.cost,
      time: result.time,
      visitedNodes: result.visitedNodes,
      generatedNodes: result.generatedNodes,
      path: result.path.map(n => ({
        x: n.x,
        y: n.y,
        z: n.z,
        remainingBlocks: n.remainingBlocks,
        cost: n.cost,
        toBreak: n.toBreak,
        toPlace: n.toPlace,
        parkour: n.parkour
      })),
      bestNodeH: astar.bestNode?.h || 0
    }
  })
} catch (err) {
  parentPort.postMessage({ type: 'error', error: err.stack || err.message })
}
