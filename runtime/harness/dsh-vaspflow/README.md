# dsh-vaspflow host bundle

This is the MIT-licensed VASPFlow host data service vendored from
`21271122/VASPFlow` commit `1cf773749bd0bd8405f2503a2d684bdb99ca34f5`.

NebulaMat deploys this host-only bundle into its private DeepSeek Harness web
profile. The original browser client is intentionally not bundled: its
`platform: "web"` injection cannot render inside the native desktop shell, so
the desktop uses the same HTTP scene/task contract through native React and
Three.js components.
