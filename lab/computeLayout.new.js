function computeLayout(nodeList, linkList, spin) {
  const place = {}
  const count = nodeList.length
  if (count === 0) return place
  const CX = BOX_W / 2
  const CY = BOX_H / 2

  const byId = {}
  for (let i = 0; i < count; i++) byId[nodeList[i].id] = nodeList[i]

  const adj = {}
  for (let i = 0; i < count; i++) adj[nodeList[i].id] = []
  const live = []
  for (let i = 0; i < linkList.length; i++) {
    const link = linkList[i]
    if (byId[link.source] === undefined || byId[link.target] === undefined) continue
    adj[link.source].push(link.target)
    adj[link.target].push(link.source)
    live.push(link)
  }

  let hub = nodeList[0].id
  for (let i = 1; i < count; i++) {
    const node = nodeList[i]
    const degree = adj[node.id].length
    const hubDegree = adj[hub].length
    if (degree > hubDegree) { hub = node.id; continue }
    if (degree !== hubDegree) continue
    const nodeSeed = node.seed === true
    const hubSeed = byId[hub].seed === true
    if (nodeSeed && !hubSeed) { hub = node.id; continue }
    if (nodeSeed === hubSeed && node.citedBy > byId[hub].citedBy) hub = node.id
  }

  const layer = {}
  for (let i = 0; i < count; i++) layer[nodeList[i].id] = -1
  layer[hub] = 0
  const layers = [[hub]]
  const queue = [hub]
  for (let qi = 0; qi < queue.length; qi++) {
    const current = queue[qi]
    const neighbours = adj[current]
    for (let i = 0; i < neighbours.length; i++) {
      const other = neighbours[i]
      if (layer[other] !== -1) continue
      layer[other] = layer[current] + 1
      if (layers[layer[other]] === undefined) layers[layer[other]] = []
      layers[layer[other]].push(other)
      queue.push(other)
    }
  }
  const stray = []
  for (let i = 0; i < count; i++) {
    const id = nodeList[i].id
    if (layer[id] === -1) { layer[id] = layers.length; stray.push(id) }
  }
  if (stray.length > 0) layers.push(stray)

  const kinds = {}
  for (let i = 0; i < live.length; i++) {
    const link = live[i]
    if (kinds[link.source] === undefined) kinds[link.source] = {}
    if (kinds[link.target] === undefined) kinds[link.target] = {}
    kinds[link.source][link.kind] = true
    kinds[link.target][link.kind] = true
  }
  function roleOf(id) {
    const node = byId[id]
    if (node !== undefined && node.seed === true) return 'seed'
    const set = kinds[id]
    if (set === undefined) return 'lonely'
    if (set.references === true) return 'references'
    if (set.citations === true) return 'citations'
    if (set.related === true) return 'related'
    return 'lonely'
  }
  const ORDER = ['references', 'citations', 'related', 'lonely']

  const minSpacing = count > 150 ? 30 : count > 80 ? 38 : 46
  const ringGap = minSpacing + 30
  const maxRadius = Math.min(CX, CY) - 26
  const turns = spin > 0 ? spin : 0
  const direction = turns % 2 === 0 ? 1 : -1
  const turn = turns * 0.43

  place[hub] = { x: CX, y: CY }

  const spokes = []
  let usedRadius = 0

  for (let level = 1; level < layers.length; level++) {
    const ids = layers[level]
    if (ids === undefined || ids.length === 0) continue

    const groups = []
    for (let g = 0; g < ORDER.length; g++) {
      const members = []
      for (let i = 0; i < ids.length; i++) if (roleOf(ids[i]) === ORDER[g]) members.push(ids[i])
      if (members.length === 0) continue
      members.sort(function (a, b) { return byId[b].citedBy - byId[a].citedBy })
      groups.push(members)
    }

    const gap = groups.length > 1 ? 0.2 : 0
    const usable = Math.PI * 2 - gap * groups.length
    let cursor = turn + (level - 1) * 0.31 * direction
    const startRadius = Math.max(96, usedRadius + ringGap)
    let reached = startRadius

    for (let g = 0; g < groups.length; g++) {
      const members = groups[g]
      const arc = usable * (members.length / ids.length)
      let remaining = members.length
      let placed = 0
      let radius = startRadius
      let ring = 0
      while (remaining > 0) {
        if (radius > maxRadius) radius = maxRadius
        let capacity = Math.floor((arc * radius) / minSpacing)
        if (capacity < 1) capacity = 1
        const take = remaining < capacity ? remaining : capacity
        const step = arc / take
        const stagger = ring % 2 === 0 ? 0.5 : 1
        for (let k = 0; k < take; k++) {
          const theta = cursor + direction * step * (k + stagger)
          const id = members[placed + k]
          if (level === 1) spokes.push({ id: id, radius: radius, theta: theta })
          else place[id] = { x: CX + radius * Math.cos(theta), y: CY + radius * Math.sin(theta) }
          if (radius > reached) reached = radius
        }
        placed += take
        remaining -= take
        ring++
        radius += ringGap
      }
      cursor = cursor + direction * (arc + gap)
    }
    usedRadius = reached
  }

  if (spokes.length > 1) {
    const minAngle = 0.05
    spokes.sort(function (a, b) { return a.theta - b.theta })
    const total = spokes.length
    for (let pass = 0; pass < 60; pass++) {
      let moved = 0
      for (let i = 0; i < total; i++) {
        const a = spokes[i]
        const b = spokes[(i + 1) % total]
        let gap = i === total - 1 ? b.theta + Math.PI * 2 - a.theta : b.theta - a.theta
        if (gap >= minAngle) continue
        const push = (minAngle - gap) * 0.5
        a.theta -= push
        b.theta += push
        moved++
      }
      if (moved === 0) break
    }
  }
  for (let i = 0; i < spokes.length; i++) {
    const spoke = spokes[i]
    place[spoke.id] = { x: CX + spoke.radius * Math.cos(spoke.theta), y: CY + spoke.radius * Math.sin(spoke.theta) }
  }

  const ids = Object.keys(place)
  for (let i = 0; i < ids.length; i++) {
    const point = place[ids[i]]
    if (!isFinite(point.x) || !isFinite(point.y)) { point.x = CX; point.y = CY }
    point.x = Math.max(34, Math.min(BOX_W - 34, point.x))
    point.y = Math.max(34, Math.min(BOX_H - 34, point.y))
  }
  return place
}
