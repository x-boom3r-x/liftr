import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const frontend = resolve(projectRoot, 'vendor/openGym/frontend')
const vite = resolve(frontend, 'node_modules/vite/bin/vite.js')
const config = resolve(projectRoot, 'scripts/opengym.vite.config.mjs')

if (!existsSync(vite)) {
  console.error('Install the pinned openGym frontend dependencies first: npm run gym:install')
  process.exit(1)
}

const result = spawnSync(process.execPath, [vite, 'build', '--config', config], {
  cwd: frontend,
  env: {
    ...process.env,
    VITE_DEMO: '1',
    VITE_MOBILE: '0',
    VITE_UMAMI_SRC: '',
    VITE_UMAMI_ID: ''
  },
  stdio: 'inherit'
})

if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status || 1)
