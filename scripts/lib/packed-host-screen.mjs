/** Parsed English viewport preconditions for the isolated packed-host journey. */
export function workspacePickerReady(screen, workspaceTitle) {
  const lines = screen.split('\n').map(line => line.trim().replace(/\s+/gu, ' '))
  // The empty isolated profile has exactly one registered workspace: the
  // driver's cwd. The card itself is unconditional, so require its hydrated
  // rail row, matching pane/hint and completed empty listing, not just a label.
  return !/Loading sessions|\brefreshing\b/u.test(screen)
    && lines.some(line => line.includes('Workspaces (1)')
      && line.includes(`│ Sessions in ${workspaceTitle} 0 working · 0 live · 0 total`))
    && lines.some(line => line.includes(`▣ ${workspaceTitle} ✓ 0 sessions`))
    && lines.some(line => line === `Start a session in "${workspaceTitle}"`)
    && lines.some(line => line === 'No sessions in this workspace yet · Enter starts one')
}

export function newSessionActionReady(screen, workspaceTitle) {
  // SessionSupervisor draws this cursor only when the list owns input and
  // row zero is selected. Seeing the unfocused card does not acknowledge Right.
  return workspacePickerReady(screen, workspaceTitle)
    && screen.split('\n').some(line => /❯\s+\+ New session\s*$/u.test(line))
}
