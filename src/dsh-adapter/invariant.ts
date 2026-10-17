/**
 * Package-owned invariant companion for `@deepseek-harness-tui/dsh-tui`.
 *
 * The vendored renderer core is third-party code written against
 * looser compiler flags; the relaxed `tsconfig` options exist only for that
 * subtree and must not spread to new code.
 * @module @deepseek-harness-tui/dsh-tui/invariant
 */

/* jscpd:ignore-start */
import type { Context, Inject } from '@deepseek-ai/cordis'

// The host retired dsh-invariants in 0.2.1. Keep the optional companion
// entry for older hosts without requiring that retired package in new profiles.
export interface InvariantInstaller {
  (ctx: Context, fail: (message: string) => never): void | Promise<void>
  readonly inject?: Inject
}

const PACKAGE_NAME = '@deepseek-harness-tui/dsh-tui'

/** Cordis companion plugin name. */
export const name = 'dsh-tui-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this interactive TUI front door owns no independent
 * lifecycle stream; state relations are owned by the agent/session seams it
 * renders.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context & {
  invariants: { register(packageName: string, installer: InvariantInstaller): () => void }
}): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
