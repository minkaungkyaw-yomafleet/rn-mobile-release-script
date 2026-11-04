/**
 * Tie-breaker for Fastlane lane discovery: decides which lane to run when SEVERAL lanes
 * match the same platform, environment and kind (build / release / build-and-release).
 * It is only called when there are two or more candidates; a single match is used as is.
 *
 * Two real ties from our repos (production, kind "release"):
 *   plus-mobile android
 *   - android_production_release   "Release a new production release to google play"
 *   - huawei_production_release    "Submit a new production to huawei app gallery"
 *   better-mobile ios
 *   - distribute_prod              uploads an existing IPA to TestFlight
 *   - prod                         alias of `release`: builds, uploads AND distributes
 * Both pairs are valid names for "the release lane", but picking the wrong one ships to the
 * wrong store, or builds twice.
 *
 * Trade-off to weigh: a confident auto-pick keeps releases fast and CI-friendly, but a wrong
 * pick ships to the wrong store. Returning null is always safe: an interactive run asks the
 * developer, and a CI run fails with the candidate names and a hint to pin one under
 * fastlane.lanes in rnmrs.config.yml.
 *
 * @param {Array<{ name: string, desc?: string, tokens: string[] }>} candidates 2+ lanes, in Fastfile order
 * @param {{ platform: 'android' | 'ios', env: string, kind: 'build' | 'release' | 'both' }} ctx
 * @returns {string | null} the chosen lane name, or null to ask the developer (or fail in CI)
 */
export function pickLane(candidates, ctx) {
  // TODO(you): replace this with your tie-break rule (about 5 to 10 lines). Ideas:
  //   - prefer a lane whose tokens include ctx.platform (android_production_release over huawei_...)
  //   - prefer the lane with the fewest extra tokens
  //   - match on desc, e.g. /google play|testflight/i
  // Until then, ambiguity is never guessed.
  void candidates
  void ctx
  return null
}
