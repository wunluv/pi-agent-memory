# Memory Sync Contract

## Roles

All memory remotes derive from the device-local `server_url` in
`~/.pi/memory-sync.json`:

| Role | Remote |
|---|---|
| Zone A agent | `<server_url>/<agent-uuid>.git` |
| Zone B project | `<server_url>/<project-name>.git` |
| Org root | `<server_url>/org.git` |

Zone B and org-root callers never accept a caller-provided remote. The
extension derives the remote and validates that it is under `server_url` before
provisioning, pulling, or pushing. A project's public code remote is outside
this contract and is never touched.

## Lifecycle

- Zone A keeps issue #8's auto-push and session-start pull.
- Zone B pulls on `/startwork`; its first remote is provisioned by
  `/memory:init` or by the first committed write/endwork. Successful local
  commits fire a detached pull-rebase-push when `push_on_commit` is enabled.
- The org root pulls during `session_start`. Gated registry and role writes
  fire the same detached push.
- Pulls use `--rebase --autostash`, never force, and conflicts leave both sides
  intact for human resolution.

## Identity and paths

Project remote names use the mutable registry `name`, as required by issue #24.
The project UUID remains the identity in `project.json` and the registry key.
Registry paths are machine-local locator data. A future registry merge layer
must preserve the local path when the same UUID arrives from another device;
it must never treat a remote machine's path as a local filesystem path.
