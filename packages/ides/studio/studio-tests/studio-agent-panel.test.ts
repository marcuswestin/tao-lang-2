import { Expect, Test } from '@shared/test'
import { StudioAgentAnnouncements } from '../studio-src/agent-chat/StudioAgentChatPanel'
import { StudioAgentPosition } from '../studio-src/agent-chat/StudioAgentPanel'

Test('Studio agent position clamp: clamps within viewport bounds', () => {
  const panelSize = { height: 500, width: 480 }
  const viewportSize = { height: 768, width: 1024 }

  // Normal position inside bounds
  Expect(StudioAgentPosition.clamp({ left: 100, top: 100 }, panelSize, viewportSize)).toEqual({
    left: 100,
    top: 100,
  })

  // Off-screen left / top (clamps to minLeft: 8, minTop: 48 below toolbar)
  Expect(StudioAgentPosition.clamp({ left: -50, top: 10 }, panelSize, viewportSize)).toEqual({
    left: 8,
    top: 48,
  })

  // Off-screen right / bottom
  Expect(StudioAgentPosition.clamp({ left: 2000, top: 2000 }, panelSize, viewportSize)).toEqual({
    left: 1024 - 480 - 8,
    top: 768 - 500 - 8,
  })
})

Test('Studio agent position clamp: handles minimized pill bounds', () => {
  const minimizedSize = { height: 34, width: 200 }
  const viewportSize = { height: 768, width: 1024 }

  // Can move further right and bottom when minimized
  Expect(StudioAgentPosition.clamp({ left: 800, top: 700 }, minimizedSize, viewportSize)).toEqual({
    left: 800,
    top: 700,
  })

  Expect(StudioAgentPosition.clamp({ left: 1200, top: 900 }, minimizedSize, viewportSize)).toEqual({
    left: 1024 - 200 - 8,
    top: 768 - 34 - 8,
  })
})

Test('Studio agent position clamp: rounds fractional coordinates', () => {
  const panelSize = { height: 500, width: 480 }
  const viewportSize = { height: 768, width: 1024 }

  Expect(StudioAgentPosition.clamp({ left: 123.7, top: 234.2 }, panelSize, viewportSize)).toEqual({
    left: 124,
    top: 234,
  })
})

Test('Studio agent position parse: keeps only a pair of finite pixel values', () => {
  Expect(StudioAgentPosition.parse(JSON.stringify({ left: 120, top: 300 }))).toEqual({ left: 120, top: 300 })
  // Earlier versions persisted the CSS strings straight off the element.
  Expect(StudioAgentPosition.parse(JSON.stringify({ left: '120px', top: '300px' }))).toEqual({
    left: 120,
    top: 300,
  })

  // Nothing usable is placed at all, so the stylesheet's own corner keeps the panel.
  for (
    const unusable of [
      undefined,
      null,
      '',
      'not json',
      '{}',
      '[]',
      '"120,300"',
      JSON.stringify({ left: 120 }),
      JSON.stringify({ left: 'auto', top: 'auto' }),
      JSON.stringify({ left: Number.NaN, top: 3 }),
      JSON.stringify({ left: '1e400', top: 3 }),
    ]
  ) {
    Expect(StudioAgentPosition.parse(unusable)).toBeUndefined()
  }
})

Test('Studio agent position: a position stored on a larger display comes back reachable', () => {
  const stored = StudioAgentPosition.parse(JSON.stringify({ left: 2400, top: 1300 }))
  Expect(stored).toEqual({ left: 2400, top: 1300 })

  // Reopened on a laptop: without re-clamping on restore the panel is placed past the viewport, with
  // its header -- the only way to drag it back -- off-screen.
  const laptop = StudioAgentPosition.clamp(
    stored!,
    StudioAgentPosition.defaultSize(false),
    { height: 800, width: 1280 },
  )
  Expect(laptop).toEqual({ left: 1280 - 480 - 8, top: 800 - 500 - 8 })
})

Test('Studio agent position: expanding a pill in a corner pulls it back into view', () => {
  const cornerPill = StudioAgentPosition.clamp(
    { left: 4000, top: 4000 },
    StudioAgentPosition.defaultSize(true),
    { height: 768, width: 1024 },
  )
  Expect(cornerPill).toEqual({ left: 1024 - 200 - 8, top: 768 - 34 - 8 })

  Expect(StudioAgentPosition.clamp(cornerPill, StudioAgentPosition.defaultSize(false), {
    height: 768,
    width: 1024,
  })).toEqual({ left: 1024 - 480 - 8, top: 768 - 500 - 8 })
})

Test('Studio agent position: restoring a minimized pill does not clamp it as an expanded panel', () => {
  const stored = JSON.stringify({ left: 800, top: 700 })
  const viewport = { height: 768, width: 1024 }

  Expect(StudioAgentPosition.restore(stored, true, viewport)).toEqual({ left: 800, top: 700 })
  Expect(StudioAgentPosition.restore(stored, false, viewport)).toEqual({
    left: 1024 - 480 - 8,
    top: 768 - 500 - 8,
  })
})

Test('Studio agent announcements keep streaming silent and announce the completed response once', () => {
  Expect(StudioAgentAnnouncements.streamingAriaLive).toBe('off')
  Expect(StudioAgentAnnouncements.completed({ text: 'The complete answer.' })).toBe('The complete answer.')
  Expect(StudioAgentAnnouncements.completed({ text: '' })).toBeUndefined()
})
