# TODO

Open housekeeping items for this repository. One line each; delete a line when it is done.

- [ ] Tooling (rtk proxy, not aimailbox code): rtk replaces the middle of long Bash heredocs, long Write-tool files and long Read results with a literal "lines omitted by rtk-proxy" line, and in written files that line lands in the file. Cause found 2026-11-23: the proxy's `compression = "balanced"` setting, which cuts the middle out of long content; setting it to `"off"` in the proxy's configuration stops it, and it is off on this machine. Still open: report upstream that the setting silently damages written files. This item is also one of the two seed notes named in the mailbox design doc, so keep it until that note exists. Owner: repository owner.
- [ ] Tooling (rtk proxy, not aimailbox code): `rtk gh pr view --json body` returned an empty body for a pull request that had one, and writing it back blanked the description. Until it is fixed upstream: read pull request bodies with `RTK_DISABLED=1 gh api`. Owner: repository owner, to report upstream to rtk.
