/** taoTestShardCount validates the private CLI-to-Jest shard-count contract. */
function taoTestShardCount(rawCount = process.env.TAO_TEST_SHARD_COUNT) {
  if (rawCount === undefined) {
    return 1
  }
  const count = Number(rawCount)
  if (!Number.isInteger(count) || count < 1 || count > 3 || String(count) !== rawCount) {
    throw new RangeError(`TAO_TEST_SHARD_COUNT must be an integer from 1 through 3, got ${JSON.stringify(rawCount)}.`)
  }
  return count
}

module.exports = { taoTestShardCount }
