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
      const source = cleanId.split('/src/').pop()
      const replaceRequired = (text, before, after, label) => {
        if (!text.includes(before)) throw new Error('LIFTR integration point changed in ' + label + '; review the pinned source before rebuilding.')
        return text.replace(before, after)
      }

      if (source === 'lib/i18n-core.js'){
        const brandCopy = "const liftrVisibleCopy = value => String(value)\n" +
          "  .replaceAll('Documents/openGym', 'the default folder')\n" +
          "  .replaceAll('Documents/OpenGym', 'the default folder')\n" +
          "  .replaceAll('OpenNutriTracker', 'LIFTR')\n" +
          "  .replaceAll('OpenGym', 'LIFTR')\n" +
          "  .replaceAll('openGym', 'LIFTR')\n" +
          "  .replaceAll('opengym.ch', 'LIFTR')\n\n"
        code = replaceRequired(code, 'export function t(s, ...args) {', brandCopy + 'export function t(s, ...args) {', 'translations')
        const tStart = code.indexOf('export function t(s, ...args) {')
        const tEnd = tStart < 0 ? -1 : code.indexOf('\n}', tStart) + 2
        if (tStart < 0 || tEnd < 2) throw new Error('LIFTR translation point changed in t; review the pinned source before rebuilding.')
        const tBody = code.slice(tStart, tEnd)
        const returnAt = tBody.lastIndexOf('  return v')
        if (returnAt < 0) throw new Error('LIFTR translation return changed; review the pinned source before rebuilding.')
        code = code.slice(0, tStart) + tBody.slice(0, returnAt) + '  v = liftrVisibleCopy(v)\n' + tBody.slice(returnAt) + code.slice(tEnd)
        for (const name of ['tn', 'tnf']){
          const start = code.indexOf('export function ' + name + '(')
          const end = start < 0 ? -1 : code.indexOf('\n}', start) + 2
          if (start < 0 || end < 2) throw new Error('LIFTR translation point changed: ' + name)
          const part = code.slice(start, end)
          code = code.slice(0, start) + replaceRequired(part, 'return v', 'return liftrVisibleCopy(v)', name) + code.slice(end)
        }
        return code
      }

      if (source === 'views/Home.jsx'){
        code = code.replace(": 'openGym'", ": 'LIFTR'")
        const marker = 'return <div className="narrow">'
        if (!code.includes(marker)) throw new Error('Gym Home integration point changed; review the pinned source before rebuilding.')
        return code.replace(marker, marker + '\n    <a className="liftr-home-return" href="/" aria-label="Back to LIFTR"><img src="/nouveau%20logo.jpeg" alt="" /><span>LIFTR</span></a>')
      }

      if (source === 'views/Login.jsx' || source === 'views/MobileOnboarding.jsx'){
        code = code.replace('>openGym</h1>', '>LIFTR</h1>')
        if (source === 'views/Login.jsx'){
          code = code.replace("{t('This demo runs entirely in your browser on example data. Nothing is sent anywhere. Passkey sign-in and sync across your devices come with the openGym server, which you get by self-hosting it.')}", "{t('Your training data stays on this device.')}")
          const repoLink = '      <div className="dim small" style={{ marginTop: 22, lineHeight: 1.6 }}>\n        <a href={REPO} target="_blank" rel="noopener">{t(\'Self-host it in a minute →\')}</a>\n      </div>\n'
          code = code.replace(repoLink, '')
        }
        return code
      }

      if (source === 'components/BackupFolderRow.jsx'){
        code = code.replace("const DEFAULT_FOLDER = 'Documents/openGym'", "const DEFAULT_FOLDER = 'LIFTR backup folder'")
        code = code.replace("subtitle={folder.uri ? (folder.label || t('Chosen folder')) : DEFAULT_FOLDER}", "subtitle={folder.uri ? t('Chosen folder') : DEFAULT_FOLDER}")
        return code
      }

      if (source === 'lib/card-draw.js'){
        code = code.replace("export const SITE = 'opengym.ch'", "export const SITE = 'LIFTR'")
        code = code.replace("  ctx.fillText('open', tx, y)\n  tx += ctx.measureText('open').width\n  ctx.fillStyle = colors.accText || colors.acc\n  ctx.fillText('Gym', tx, y)", "  ctx.fillText('LIFTR', tx, y)")
        return code
      }

      if (source === 'views/Settings.jsx'){
        const supportStart = code.indexOf("      <Section title={t('Support openGym')}")
        const supportEnd = supportStart < 0 ? -1 : code.indexOf('      </Section>', supportStart)
        if (supportStart >= 0 && supportEnd >= 0) code = code.slice(0, supportStart) + code.slice(supportEnd + '      </Section>'.length)
        code = code.replace("          <Row icon=\"rocket\" iconTint=\"var(--indigo)\" title={t('Self-host openGym')} subtitle={t('Passkey sign-in, sync across your devices, your own data.')} accessory=\"chevron\"\n            onClick={() => window.open(REPO, '_blank', 'noopener')} />\n", '')
        const footerStart = code.indexOf('      <div className="dim small sp-version">')
        const footerEnd = footerStart < 0 ? -1 : code.indexOf('      </div>', footerStart)
        if (footerStart < 0 || footerEnd < 0) throw new Error('Gym legal footer changed; review it before rebuilding.')
        const footer = [
          '      <div className="dim small sp-version">',
          "        LIFTR Gym v{__APP_VERSION__} · {t('free & open source (AGPL v3)')}<br />",
          '        <a href="/LICENSE">{t(\'Open-source licence\')}</a> · <a href="/NOTICE.md">{t(\'Licences & acknowledgements\')}</a><br />',
          '        {/* Attribution the media licence asks for word for word (agreement §8c), so it is not translated */}',
          '        Exercise media © Aliaksandr Makatserchyk, <a href="https://gymvisual.com/" target="_blank" rel="noopener">Gym visual</a>, gymvisual.com.',
          '        Media licensed for use in openGym only; see <a href="/NOTICE.md">NOTICE.md</a>',
          '      </div>'
        ].join('\n')
        return code.slice(0, footerStart) + footer + code.slice(footerEnd + '      </div>'.length)
      }

      const filenameSources = new Set(['views/Admin.jsx', 'components/CsvExportSheet.jsx', 'views/Settings.jsx', 'components/Recap.jsx', 'components/RoutineShare.jsx', 'sheets.jsx', 'lib/fit-export.js'])
      if (filenameSources.has(source)) code = code.replace(/opengym-/g, 'liftr-')

      if (source === 'lib/backup-media.js'){
        code = code.replace("export const BACKUP_JSON = 'opengym-backup.json'", "export const BACKUP_JSON = 'liftr-gym-backup.json'")
        code = code.replace('const MEDIA_ENTRY =', "const LEGACY_BACKUP_JSON = 'opengym-backup.json'\nconst MEDIA_ENTRY =")
        code = code.replace('const json = entries.find(e => e.name === BACKUP_JSON)', 'const json = entries.find(e => e.name === BACKUP_JSON || e.name === LEGACY_BACKUP_JSON)')
        code = code.replace(/openGym/g, 'LIFTR').replace(/opengym-backup\.json/g, 'liftr-gym-backup.json')
        return code
      }

      return null
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
          .replaceAll('openGym could not start on this browser.', 'LIFTR could not start on this browser.')
          .replaceAll('openGym is taking too long to start.', 'LIFTR is taking too long to start.')
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
      manifest.description = 'Offline workout planning and tracking.'
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
