// Builds the site into _site/: a landing page plus the docs of libquake and the Unity package, rendered from
// the markdown in each repo's docs/. Fonts and scripts are served from the site itself.
//
//   node build.mjs              repos next to this one (../libquake, ../unity)
//   REPOS=repos node build.mjs  repos somewhere else

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import hljs from 'highlight.js'
import { marked } from 'marked'

const repos = process.env.REPOS ?? '..'
const out = '_site'

// Every markdown file in docs/ and every source in examples/ has to be listed here, the build fails otherwise.
const projects = {
  libquake: {
    title: 'core lib',
    kind: 'c++ library',
    blurb:
      'Loads Quake 1 .map, .bsp and .wad files into meshes per texture, collision hulls, entities, RGBA textures and lightmaps split by light style. Maps can be lit with the built-in baker, without the Quake compile tools.',
    features: [
      ['map', 'standard and Valve 220, CSG, texture and lightmap uvs, light baking'],
      ['bsp', 'version 29 with .lit files, embedded textures, light styles'],
      ['wad', 'WAD2 textures with fullbright emission maps and split sky layers'],
      ['c api', 'a shared library for bindings, prebuilt for windows, macOS and linux'],
      ['qviewer', 'a small viewer for maps and bsp files'],
    ],
    code: `<span class="prompt">$</span> git clone https://github.com/libquake/libquake
<span class="prompt">$</span> cmake -S libquake -B build &amp;&amp; cmake --build build`,
    downloads: true,
    nav: [
      [null, [['index', 'Overview']]],
      ['guide', [
        ['guide/getting-started', 'Getting started'],
        ['guide/bsp', 'Loading a bsp'],
        ['guide/map', 'Building a map'],
        ['guide/lighting', 'Lighting'],
        ['guide/textures', 'Textures'],
        ['guide/c-api', 'C API'],
      ]],
      ['reference', [
        ['reference/level', 'Level'],
        ['reference/loading', 'Loading'],
        ['reference/lighting', 'Lighting'],
        ['reference/wad', 'Wad'],
        ['reference/c-api', 'C API'],
      ]],
      ['tools', [['tools/qviewer', 'qviewer']]],
    ],
    // shown in full under examples/, the guide includes parts of them
    examples: ['load_bsp.cpp', 'build_map.cpp', 'bake.cpp', 'light_styles.cpp', 'wad_textures.cpp', 'c_api.c'],
  },
  unity: {
    title: 'unity',
    kind: 'unity package',
    blurb:
      'Imports .map and .wad files into Unity. A map becomes a prefab with meshes, colliders, a lightmap baked by libquake and one object per entity. Save in TrenchBroom, Unity reimports.',
    features: [
      ['map', 'prefab with meshes per texture, colliders from the brush hulls, liquids as triggers'],
      ['light', 'lightmap baked on import, drawn like Quake with fullbright pixels'],
      ['wad', 'textures with emission maps and both sky layers, png export'],
      ['entities', 'prefabs per class name, keys passed to components, target and targetname as events'],
      ['pipelines', 'built-in, URP and HDRP'],
    ],
    code: `<span class="faint"># Package Manager &gt; + &gt; Add package from git URL</span>
https://github.com/libquake/unity.git?path=/com.libquake.unity`,
    nav: [
      [null, [['index', 'Overview']]],
      ['guide', [
        ['guide/getting-started', 'Getting started'],
        ['guide/maps', 'Maps'],
        ['guide/textures', 'Textures'],
        ['guide/lighting', 'Lighting'],
        ['guide/entities', 'Entities'],
      ]],
      ['reference', [
        ['reference/map-config', 'Map config'],
        ['reference/components', 'Components'],
      ]],
    ],
  },
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const num = (i) => String(i + 1).padStart(2, '0')
const github = (name) => `https://github.com/libquake/${name}`
const pageUrl = (name, id) => (id === 'index' ? `/${name}/` : `/${name}/${id}/`)
const downloads = [
  ['windows', 'win'],
  ['macOS', 'macos'],
  ['linux', 'linux'],
]

function write(path, html) {
  mkdirSync(join(out, path, '..'), { recursive: true })
  writeFileSync(join(out, path), html)
}

// --- reading the repos ---------------------------------------------------

function markdownFiles(dir, prefix = '') {
  return readdirSync(dir).flatMap((f) => {
    const path = join(dir, f)
    if (statSync(path).isDirectory()) return markdownFiles(path, `${prefix}${f}/`)
    return f.endsWith('.md') ? [`${prefix}${f.slice(0, -3)}`] : []
  })
}

const exampleId = (file) => `examples/${file.replace(/\.\w+$/, '')}`

// The docs nav plus a group with one page per example.
function nav(name) {
  const { nav, examples } = projects[name]
  return examples ? [...nav, ['examples', examples.map((f) => [exampleId(f), f])]] : nav
}

function pages(name) {
  const dir = join(repos, name, 'docs')
  const listed = nav(name).flatMap(([, items]) => items)
  const ids = new Set(listed.map(([id]) => id))
  const unlisted = markdownFiles(dir).filter((id) => !ids.has(id))
  const examples = projects[name].examples ?? []
  if (examples.length) {
    const sources = readdirSync(join(repos, name, 'examples')).filter((f) => /\.(c|cpp)$/.test(f))
    unlisted.push(...sources.filter((f) => !examples.includes(f)).map((f) => `examples/${f}`))
  }
  if (unlisted.length) throw new Error(`${name}: not in the nav of build.mjs: ${unlisted.join(', ')}`)
  return listed.map(([id, title]) => {
    const file = examples.find((f) => exampleId(f) === id)
    return file
      ? { id, title, md: exampleMarkdown(name, file), source: `examples/${file}` }
      : { id, title, md: readFileSync(join(dir, `${id}.md`), 'utf8'), source: `docs/${id}.md` }
  })
}

// The leading comment becomes the text, the "usage:" line a command, the rest the code.
function exampleMarkdown(name, file) {
  const src = readFileSync(join(repos, name, 'examples', file), 'utf8')
  const head = src.match(/^(?:\/\/[^\n]*\n)+|^\/\*[\s\S]*?\*\/\n/)?.[0] ?? ''
  const text = head
    .replace(/^\/\*|\*\/$/gm, '')
    .split('\n')
    .map((l) => l.replace(/^\s*(\/\/|\*\/?|\/\*)\s?/, '').trim())
    .filter(Boolean)
  const usage = text.filter((l) => l.startsWith('usage:')).map((l) => l.slice(6).trim())
  const about = text.filter((l) => !l.startsWith('usage:')).join(' ')
  const code = src.slice(head.length).replace(/^.*--8<-- \[[^\]]+\].*\n/gm, '').trim()
  const lang = file.endsWith('.c') ? 'c' : 'cpp'
  return [
    `# ${file}`,
    about,
    usage.length ? '```sh\n' + usage.join('\n') + '\n```' : '',
    'Built with `QLIB_BUILD_EXAMPLES=ON`.',
    '```' + lang + '\n' + code + '\n```',
  ].join('\n\n')
}

// pymdownx snippets as the docs use them: --8<-- "path:section" includes the lines between
// "--8<-- [start:section]" and "--8<-- [end:section]" of a file in the repo, dedented. A code block made of
// snippets gets a line naming the files it comes from.
function snippets(md, name) {
  return md
    .replace(/^```(\w*)\n((?:--8<-- "[^"]+"\n)+)```$/gm, (block, lang, lines) => {
      const files = [...new Set([...lines.matchAll(/--8<-- "([^":]+)/g)].map((m) => m[1]))]
      return `${block}\n\n<p class="from">from ${files.map((f) => sourceLink(name, f)).join(', ')}</p>`
    })
    .replace(/^--8<-- "([^":]+)(?::([\w-]+))?"$/gm, (_, file, section) => include(name, file, section))
}

function sourceLink(name, file) {
  const example = projects[name].examples?.find((f) => `examples/${f}` === file)
  const href = example ? pageUrl(name, exampleId(example)) : `${github(name)}/blob/main/${file}`
  return `<a href="${href}"><code>${esc(file)}</code></a>`
}

function include(name, file, section) {
  let lines = readFileSync(join(repos, name, file), 'utf8').split('\n')
  if (section) {
    const start = lines.findIndex((l) => l.includes(`--8<-- [start:${section}]`))
    const end = lines.findIndex((l) => l.includes(`--8<-- [end:${section}]`))
    if (start < 0 || end < start) throw new Error(`${name}: no section ${section} in ${file}`)
    lines = lines.slice(start + 1, end)
  }
  lines = lines.filter((l) => !l.includes('--8<-- ['))
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length))
  return lines.map((l) => l.slice(indent)).join('\n')
}

// --- markdown ------------------------------------------------------------

const slug = (text) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')

// "term" followed by ":   definition", as in the libquake reference.
const deflist = {
  name: 'deflist',
  level: 'block',
  start: (src) => src.match(/^[^\n]+\n:   /m)?.index,
  tokenizer(src) {
    const match = /^(?:[^\n]+\n:   [^\n]*(?:\n(?: {4}[^\n]*|[ \t]*(?=\n {4})))*(?:\n+|$))+/.exec(src)
    if (!match) return
    const items = match[0]
      .trim()
      .split(/\n(?=[^\s:][^\n]*\n:   )/)
      .map((item) => {
        const [term, ...rest] = item.split('\n')
        const def = rest.join('\n').replace(/^: {3}/, '').replace(/^ {4}/gm, '')
        return { term, def }
      })
    return { type: 'deflist', raw: match[0], items }
  },
  renderer(token) {
    const body = token.items
      .map(({ term, def }) => `<dt>${marked.parseInline(term)}</dt>\n<dd>${marked.parse(def)}</dd>`)
      .join('\n')
    return `<dl class="defs">\n${body}\n</dl>\n`
  },
}

marked.use({
  extensions: [deflist],
  renderer: {
    code({ text, lang }) {
      const known = lang && hljs.getLanguage(lang)
      const html = known ? hljs.highlight(text, { language: lang }).value : esc(text)
      return `<pre><code${known ? ` class="hljs language-${lang}"` : ''}>${html}</code></pre>\n`
    },
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens)
      return `<h${depth} id="${slug(text)}">${text}</h${depth}>\n`
    },
  },
})

// Links between docs pages point to the .md files, so they also work on GitHub.
function render(md, name, id) {
  const here = posix.dirname(id)
  return marked
    .parse(snippets(md, name))
    .replace(/href="(?![a-z]+:|#|\/)([^"#]+)\.md(#[^"]*)?"/g, (_, path, hash = '') =>
      `href="${pageUrl(name, posix.normalize(posix.join(here, path)))}${hash}"`,
    )
    .replace(/src="(?![a-z]+:|\/)([^"]+)"/g, (_, file) =>
      `src="/${name}/${posix.normalize(posix.join(here, file))}" loading="lazy"`,
    )
}

// --- templates -----------------------------------------------------------

const shell = ({ title, description, on, body }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/PermanentMarker-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/style.css">
<script>try{const t=localStorage.getItem('theme');if(t)document.documentElement.dataset.theme=t}catch{}</script>
</head>
<body>
<header class="bar">
  <a class="logo" href="/"><img src="/favicon.svg" alt="" width="20" height="20">libquake</a>
  <nav>
    ${Object.keys(projects)
      .map((n) => `<a href="/${n}/"${n === on ? ' class="on"' : ''}>${n}</a>`)
      .join('\n    ')}
    <a href="https://github.com/libquake">github ↗</a>
  </nav>
</header>
${body}
<footer class="foot">
  <span>MIT licensed</span>
  <button class="text" id="theme" type="button">theme: system</button>
</footer>
<script src="/theme.js"></script>
</body>
</html>
`

function section(name, i) {
  const p = projects[name]
  const files = p.downloads
    ? `
    <div class="downloads">
      <span class="caps">latest release</span>
      ${downloads.map(([os, file]) => `<a href="${github(name)}/releases/latest/download/libquake-${file}.zip">${os}</a>`).join('\n      ')}
    </div>`
    : ''
  return `
<section class="project" id="${name}">
  <div>
    <p class="caps index"><span>${num(i)}</span> / ${p.kind}</p>
    <h2>${p.title}</h2>
    <p class="blurb">${p.blurb}</p>
    <div class="actions">
      <a class="button primary" href="/${name}/">docs →</a>
      <a class="button" href="${github(name)}">github ↗</a>
    </div>${files}
  </div>
  <div>
    <dl class="features">
      ${p.features.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('\n      ')}
    </dl>
    <pre><code>${p.code}</code></pre>
  </div>
</section>`
}

function home() {
  return shell({
    title: 'libquake',
    description: 'libquake: a C++ library for Quake 1 map, bsp and wad files, and a Unity importer built on it.',
    body: `<main>
<section class="intro">
  <h1 class="brand">libquake</h1>
  <p class="lede">Quake 1 map, bsp and wad files for engines. A C++20 library with a C API, and a Unity package built on it.</p>
</section>
${Object.keys(projects).map(section).join('\n')}
</main>`,
  })
}

function docPage(name, list, at) {
  const page = list[at]
  const prev = list[at - 1]
  const next = list[at + 1]
  let n = 0
  const menu = nav(name)
    .map(([group, items]) => {
      const links = items
        .map(([id, title]) => {
          const on = id === page.id ? ' class="on" aria-current="page"' : ''
          return `<a href="${pageUrl(name, id)}"${on}><span class="num">${num(n++)}</span>${esc(title)}</a>`
        })
        .join('\n    ')
      return group ? `<p class="caps">${group}</p>\n    ${links}` : links
    })
    .join('\n    ')
  return shell({
    title: `${page.title} · ${name}`,
    description: `${name} docs: ${page.title}`,
    on: name,
    body: `<main class="docs">
<aside class="side">
  <p class="caps">${projects[name].kind}</p>
  <nav>
    ${menu}
  </nav>
  <a class="source" href="${github(name)}/blob/main/${page.source}">source ↗</a>
</aside>
<article class="doc">
  <p class="caps crumb">${name} <span>/</span> ${num(at)}</p>
  ${render(page.md, name, page.id)}
  <div class="pager">
    ${prev ? `<a href="${pageUrl(name, prev.id)}"><span class="caps">← prev</span>${esc(prev.title)}</a>` : '<span></span>'}
    ${next ? `<a class="next" href="${pageUrl(name, next.id)}"><span class="caps">next →</span>${esc(next.title)}</a>` : ''}
  </div>
</article>
</main>`,
  })
}

// --- build ---------------------------------------------------------------

rmSync(out, { recursive: true, force: true })
cpSync('src', out, { recursive: true })
write('index.html', home())

for (const name of Object.keys(projects)) {
  const list = pages(name)
  const img = join(repos, name, 'docs', 'img')
  if (existsSync(img)) cpSync(img, join(out, name, 'img'), { recursive: true })
  list.forEach((p, i) => write(join(pageUrl(name, p.id), 'index.html'), docPage(name, list, i)))
  console.log(`${name}: ${list.length} pages`)
}
