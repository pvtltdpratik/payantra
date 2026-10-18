# Self-hosted fonts

Latin-subset, variable-weight `woff2` files, taken from Google Fonts. Both families are licensed under the
[SIL Open Font License 1.1](https://openfontlicense.org/), which permits bundling and redistribution with an
application provided the fonts are not sold on their own.

| File | Family | Source |
|---|---|---|
| `inter-latin.woff2` | Inter, © The Inter Project Authors | https://github.com/rsms/inter |
| `cormorant-garamond-latin.woff2` | Cormorant Garamond, © The Cormorant Project Authors | https://github.com/CatharsisFonts/Cormorant |

Why not `next/font/google`? It declares every unicode subset, and the rupee sign (U+20B9) lives in Inter's `latin-ext`
file, so an 85 kB download was triggered by the first price on the page. With only Latin declared, `₹` is drawn with the
device's own font. See `docs/MOTION.md`.
