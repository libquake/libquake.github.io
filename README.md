# libquake.github.io

The libquake site: [libquake](https://github.com/libquake/libquake) and the [Unity package](https://github.com/libquake/unity), with their docs rendered from each repo's `docs/`.

Fully static, fonts and scripts come from the site itself.

```sh
npm install
npm run serve     # builds from ../libquake and ../unity, serves on :8080
```

Every markdown file in a repo's `docs/` has to be listed in the `nav` of its project in `build.mjs`, the build fails otherwise.

`.github/workflows/pages.yml` builds and publishes on every push, daily, by hand, and on a `repository_dispatch` of type `docs`.

Fonts: IBM Plex Mono and Permanent Marker, both under the SIL Open Font License (see `src/fonts/`).
