import * as fs from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'

export interface BrowserSettings {
  useDefaultSession?: boolean
  headless?: boolean
  lookForShadowRoot?: boolean
}

export function loadSettingsFile (): BrowserSettings {
  if (process.env.GPTSCRIPT_SETTINGS_FILE != null && process.env.GPTSCRIPT_SETTINGS_FILE !== '') {
    try {
      const contents = fs.readFileSync(process.env.GPTSCRIPT_SETTINGS_FILE)
      return JSON.parse(contents.toString()).browser
    } catch (e) {
      return {}
    }
  }

  if (process.env.GPTSCRIPT_BROWSER_SETTINGS_FILE != null && process.env.GPTSCRIPT_BROWSER_SETTINGS_FILE !== '') {
    try {
      const contents = fs.readFileSync(process.env.GPTSCRIPT_BROWSER_SETTINGS_FILE)
      return JSON.parse(contents.toString())
    } catch (e) {
      return {}
    }
  }

  const file = process.env.GPTSCRIPT_WORKSPACE_DIR + '/browsersettings.json'
  try {
    const contents = fs.readFileSync(file)
    return JSON.parse(contents.toString())
  } catch (e) {
    return {}
  }
}

const APP_CACHE_DIR = getAppCacheDir()

function getAppCacheDir(): string {
  const homeDir = os.homedir()
  const appPath = path.join('otto8', 'tools', 'browser')

  let cacheDir = ''

  switch (os.platform()) {
    case 'win32':
      cacheDir = path.join(process.env.APPDATA ?? path.join(homeDir, 'AppData', 'Roaming'), appPath)
      break
    case 'darwin':
      cacheDir = path.join(homeDir, 'Library', 'Caches', appPath)
      break
    default:
      cacheDir = path.join(process.env.XDG_CACHE_HOME ?? path.join(homeDir, '.cache'), appPath)
      break
  }

  return cacheDir
}
