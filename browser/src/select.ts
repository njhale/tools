import { type Page } from 'playwright'
import { inspectForSelect } from './browse.ts'
import { type BrowserSettings } from './settings.ts'

export async function select (page: Page, model: string, userInput: string, option: string, settings: BrowserSettings): Promise<void> {
  const selection = await inspectForSelect(page, model, option, userInput, settings)

  try {
    await page.selectOption(`${selection.selector}`, selection.option, { timeout: 5000 })
  } catch (e) {
    console.error('failed to select option: ', e)
  }
}
