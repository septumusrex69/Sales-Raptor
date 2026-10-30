/*
 * The Sign In button's way of asking SignInOpening (mounted above the routes) to play. Its own file because a module
 * that exports a component should export only components (fast refresh).
 */
let listener: (() => void) | null = null

export function onRaptorOpening(fn: (() => void) | null): void {
  listener = fn
}

export function queueRaptorOpening(): void {
  listener?.()
}
