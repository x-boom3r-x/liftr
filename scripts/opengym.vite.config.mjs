import { promises as fs } from 'node:fs'
import { resolve, relative, sep, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import upstream from '../vendor/openGym/frontend/vite.config.js'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const frontend = resolve(projectRoot, 'vendor/openGym/frontend')
const output = resolve(projectRoot, 'gym')

function liftrOpenGym(){
  return {
    name: 'liftr-opengym-integration',
    enforce: 'pre',
    transform(code, id){
      const cleanId = id.split('?')[0].replace(/\\/g, '/')
      if (!cleanId.endsWith('/src/views/Home.jsx')) return null
      const marker = 'return <div className="narrow">'
      if (!code.includes(marker)) throw new Error('openGym Home integration point changed; review the pinned source before rebuilding.')
      return code.replace(marker, `${marker}\n    <a className="liftr-home-return" href="/" aria-label="Back to LIFTR"><img src="/nouveau%20logo.jpeg" alt="" /><span>LIFTR</span></a>`)
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html){
        const brandSetup = `<script>(function(){try{var key='gym_state_v1',mark='liftr_opengym_brand_v1';if(localStorage.getItem(mark)!=='1'){var s=JSON.parse(localStorage.getItem(key)||'{}');s.accent='custom';s.accentCustom='#1374FC';localStorage.setItem(key,JSON.stringify(s));localStorage.setItem(mark,'1')}localStorage.setItem('gym_demo_seeded_v1','1')}catch(e){}})();</script>`
        const brandStyle = `<style>.liftr-home-return{display:inline-flex;align-items:center;gap:8px;width:max-content;margin:0 0 14px;color:var(--label-2);font-size:var(--fs-caption);font-weight:650;text-decoration:none}.liftr-home-return img{display:block;width:30px;height:30px;border-radius:9px;object-fit:cover}.liftr-home-return:focus-visible{outline:2px solid #61A3FF;outline-offset:3px;border-radius:10px}#boot{background:#080D18!important}#boot .liftr-boot-logo{display:block;width:112px;height:112px;border-radius:24px;object-fit:cover}#boot.fail button{color:#080D18;background:#1374FC}</style>`
        const boot = /  <svg viewBox="80 140 352 250">[\s\S]*?  <\/svg>/
        if (!boot.test(html)) throw new Error('openGym boot mark changed; review the pinned source before rebuilding.')
        return html
          .replace('<head>', `<head>\n${brandSetup}\n${brandStyle}`)
          .replace('<title>openGym</title>', '<title>LIFTR · Gym</title>')
          .replace('<meta name="theme-color" content="#0c0e12">', '<meta name="theme-color" content="#080D18">')
          .replace('<meta name="apple-mobile-web-app-title" content="openGym">', '<meta name="apple-mobile-web-app-title" content="LIFTR">')
          .replace(/href="icon-180\.png"/g, 'href="/nouveau%20logo.jpeg"')
          .replace(boot, '  <img class="liftr-boot-logo" src="/nouveau%20logo.jpeg" alt="LIFTR">')
      }
    },
    async closeBundle(){
      const manifestPath = resolve(output, 'manifest.json')
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
      manifest.name = 'LIFTR · Gym'
      manifest.short_name = 'LIFTR'
      manifest.description = 'Offline gym tracking powered by openGym.'
      manifest.background_color = '#080D18'
      manifest.theme_color = '#080D18'
      manifest.icons = [{ src: '../nouveau%20logo.jpeg', sizes: 'any', type: 'image/jpeg', purpose: 'any' }]
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

      const files = []
      async function visit(dir){
        for (const entry of await fs.readdir(dir, { withFileTypes: true })){
          const full = resolve(dir, entry.name)
          if (entry.isDirectory()) await visit(full)
          else if (entry.isFile() && entry.name !== 'precache.json'){
            const path = relative(output, full).split(sep).join(posix.sep)
            files.push('/gym/' + path)
          }
        }
      }
      await visit(output)
      await fs.writeFile(resolve(output, 'precache.json'), JSON.stringify(files.sort(), null, 2) + '\n')

      const textFiles = new Set(['.css', '.html', '.js', '.json', '.svg', '.txt', '.webmanifest'])
      async function normalizeText(dir){
        for (const entry of await fs.readdir(dir, { withFileTypes: true })){
          const full = resolve(dir, entry.name)
          if (entry.isDirectory()) await normalizeText(full)
          else if (entry.isFile() && textFiles.has(entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase())){
            const source = await fs.readFile(full, 'utf8')
            const normalized = source.replace(/\r\n?/g, '\n').replace(/^[\t ]+$/gm, '')
            if (normalized !== source) await fs.writeFile(full, normalized)
          }
        }
      }
      await normalizeText(output)
    }
  }
}

export default {
  ...upstream,
  root: frontend,
  base: '/gym/',
  plugins: [liftrOpenGym(), ...(upstream.plugins || [])],
  build: {
    ...(upstream.build || {}),
    outDir: output,
    emptyOutDir: true
  }
}
