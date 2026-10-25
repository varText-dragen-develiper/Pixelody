# Theme records

Read [the theme guide](../../docs/themes/THEME_SYSTEM.md) before changing registration or presentation code.

`built-in-themes.json` maps implementations; `*.theme.json` records palette, assets, HUD, type and motion intent. `theme.schema.json` validates them and `template.theme.json` starts a new record. The starter list is an idea backlog.

Studio, Obsession Mode and Cartridge Quest are offered in Settings. Studio is the rebuilt-shell fallback; the other two are separately allowed composition recipes. The remaining manifests preserve design work. Canvas's 27 baseline ports have stock module graphs but don't restore retired stylesheets or make all ports ordinary built-ins.

The app doesn't read built-in manifests live. Checked runtime maps supply navigation and information assignments. Manifests may select registered mechanics or `information.profile` keys, never executable markup, scripts or state owners. Semantic `tokens` are schema-valid/tested but not wired live. See the [runtime reference](../../docs/themes/THEME_RUNTIME_ARCHITECTURE.md) and [navigation](../theme-runtime/navigation/contract.md)/[information](../theme-runtime/information/contract.md) contracts.

The bounded local-package parser/store remain implemented, but My Themes/application is hidden during the reset. Packages can't carry assets, fonts, CSS, scripts, URLs or executable mods, and built-in manifests aren't installable packages. Manifest asset paths stay relative.

Run `check:themes` for theme changes; add `check:theme-information`, `check:navigation-platform`, the relevant mechanic check and `check:theme-packages` when their contracts are affected. New entries need the live admission rules, not just a manifest.
