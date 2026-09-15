import TR from '@tao/runtime'

/**
 * The Hacker News adapter: each declared query shape maps to one Algolia HN API request, and every
 * JSON-to-row mapping lives here, typed against the entities by the rows it upserts. The Algolia
 * API is chosen over the official Firebase one because one `items/:id` call returns a story's whole
 * comment tree.
 */

const API = 'https://hn.algolia.com/api/v1'

type FrontPageHit = {
  author: string | null
  num_comments: number | null
  objectID: string
  points: number | null
  title: string | null
  url: string | null
}

type ItemNode = {
  author: string | null
  children: ItemNode[]
  id: number
  points?: number | null
  text: string | null
  title?: string | null
  type: string
  url?: string | null
}

export const HNAdapter = TR.Http.adapter({
  Story: [
    // Rank is the position in the API's own response for the front-page set — which Algolia orders
    // by points, approximating rather than matching news.ycombinator.com's ranking (exact parity
    // needs Firebase's topstories for the ID order, at a request per story). Either way it is the
    // rule this field exists for: ordering the API owns and no stored field derives becomes data.
    TR.Http.on({ orderBy: 'Rank' }, async (query, { upsert }) => {
      const size = query.limit ?? 30
      const page = await fetchJson<{ hits: FrontPageHit[] }>(
        `${API}/search?tags=front_page&hitsPerPage=${size}`,
      )
      upsert(page.hits.map((hit, index) => ({
        HnId: Number(hit.objectID),
        Title: hit.title ?? '(untitled)',
        Url: hit.url ?? '',
        Score: hit.points ?? 0,
        Author: hit.author ?? '(unknown)',
        CommentCount: hit.num_comments ?? 0,
        Rank: index + 1,
      })))
    }),
    // One story by id, for a bookmark that names a story the front page has not served — a cold
    // launch, or a story that has since fallen off. It is not on the front page, so it has no Rank.
    TR.Http.on({ where: 'HnId' }, async (query, { upsert }) => {
      const id = query.where['HnId'] as number
      const item = await fetchJson<ItemNode>(`${API}/items/${id}`)
      if (item.type !== 'story') {
        return
      }
      upsert([{
        HnId: item.id,
        Title: item.title ?? '(untitled)',
        Url: item.url ?? '',
        Score: item.points ?? 0,
        Author: item.author ?? '(unknown)',
        CommentCount: countComments(item.children),
      }])
    }),
  ],
  Comment: [
    TR.Http.on({ where: 'Story' }, async (query, { upsert }) => {
      const story = query.where['Story'] as { HnId: number }
      const item = await fetchJson<ItemNode>(`${API}/items/${story.HnId}`)
      upsert(flattenComments(item, story.HnId))
    }),
  ],
})

/**
 * flattenComments walks the tree depth-first into Depth-annotated rows. A deleted comment with
 * replies keeps its place as a placeholder so its live descendants survive; a deleted leaf is
 * omitted outright.
 */
function flattenComments(item: ItemNode, storyId: number): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []
  let ordering = 0
  const walk = (nodes: ItemNode[], depth: number): void => {
    for (const node of nodes) {
      if (node.type !== 'comment') {
        continue
      }
      const deleted = node.text === null
      if (deleted && node.children.length === 0) {
        continue
      }
      ordering += 1
      rows.push({
        HnId: node.id,
        Story: { HnId: storyId },
        Author: deleted ? '(deleted)' : node.author ?? '(unknown)',
        Text: deleted ? '(deleted)' : plainText(node.text!),
        Depth: depth,
        Ordering: ordering,
      })
      walk(node.children, depth + 1)
    }
  }
  walk(item.children, 0)
  return rows
}

function countComments(nodes: readonly ItemNode[]): number {
  return nodes.reduce((total, node) => total + (node.type === 'comment' ? 1 : 0) + countComments(node.children), 0)
}

/**
 * plainText strips the API's HTML markup down to readable text. `&amp;` decodes last, so a comment
 * about markup — `&amp;lt;` — reads as `&lt;` rather than being decoded twice into `<`.
 */
function plainText(html: string): string {
  return html
    .replace(/<p>/g, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&amp;/g, '&')
    .trim()
}

async function fetchJson<ResultT>(url: string): Promise<ResultT> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Hacker News responded ${response.status} for ${url}.`)
  }
  return await response.json() as ResultT
}
