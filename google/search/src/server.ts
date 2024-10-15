import path from 'node:path'
import { search } from './search.ts'
import { genQuery } from './genQuery.ts'
import { getNewContext } from './context.ts'
import * as gptscript from '@gptscript-ai/gptscript'
import { rmSync } from 'node:fs'

const gptsClient = new gptscript.GPTScript()

const question: string = process.env.QUESTION ?? ''
if (question === '') {
  console.log('error: no question provided')
  process.exit(1)
}

if (process.env.GPTSCRIPT_WORKSPACE_ID === undefined || process.env.GPTSCRIPT_WORKSPACE_DIR === undefined) {
  console.log('error: GPTScript workspace ID and directory are not set')
  process.exit(1)
}

// Simultaneously start the browser and generate our search query.
const queryPromise = genQuery(question)
const contextPromise = getNewContext(path.resolve(process.env.GPTSCRIPT_WORKSPACE_DIR), true)
const noJSContextPromise = getNewContext(path.resolve(process.env.GPTSCRIPT_WORKSPACE_DIR), false)
const [query, context, noJSContext] = await Promise.all([queryPromise, contextPromise, noJSContextPromise])

// Query Google
const pageContents = await search(
  context.context,
  noJSContext.context,
  query,
  process.env.MAX_PAGES !== undefined ? parseInt(process.env.MAX_PAGES) : undefined
)

console.log(pageContents.length)

// Ask gpt-4o to generate an answer
const tool: gptscript.ToolDef = {
  agents: [],
  arguments: { 
    type: 'object', 
    properties: {
      search: {
        type: 'string',
        description: 'JSON string containing unfocussed search query andresults'
      }
    },
    required: ['search']
  },
  chat: false,
  context: [],
  credentials: [],
  description: '',
  export: [],
  exportContext: [],
  globalModelName: '',
  globalTools: [],
  jsonResponse: true,
  maxTokens: 0,
  modelName: '',
  modelProvider: false,
  name: '',
  tools: [],
  temperature: 0.2,
  instructions: `
  When given a search object with the following JSON schema: 

  {
  "title": "Search",
  "type": "object",
  "properties": {
    "question": {
      "type": "string",
      "description": "The search query or question"
    },
    "results": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "url": {
            "type": "string",
            "format": "uri",
            "description": "URL of the web page"
          },
          "content": {
            "type": "string",
            "description": "Content of the web page at URL in markdown"
          }
        },
        "required": ["url", "content"],
        "additionalProperties": false
      },
      "description": "An array of search results"
    }
  },
  "required": ["question", "results"],
  "additionalProperties": false
}

Silently read through the content of each result and extract all chunks of text with information relevant or even remotely related to the subject of the search question. After extracting the chunks for all search results, sanitize the text into valid markdown and use it to generate a focusedSearch JSON object with the following JSON schema:

  {
  "title": "FocusedSearch",
  "type": "object",
  "properties": {
    "question": {
      "type": "string",
      "description": "The search query or question"
    },
    "results": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "url": {
            "type": "string",
            "format": "uri",
            "description": "URL of the web page"
          },
          "title": {
            "type": "string",
            "description": "Title of the web page"
          },
          "relevantContent": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "A chunk of text sourced from the web page at URL"
          }
        },
        "required": ["url", "title", "relevantContent"],
      },
      "description": "An array of focused search results"
    }
  },
  "required": ["question", "results"],
  }

  Respond with only the final focusedSearch object without any additional preamble or commentary.
  `
}

const run = await gptsClient.evaluate(tool, { 
  input: JSON.stringify({ question, results: pageContents }),
  disableCache: true 
})
const focusedSearch = await run.json()

// let prev = ''

// run.on(gptscript.RunEventType.CallProgress, data => {
//   // We don't want to start printing until we see the first "### Sources" line.
//   // Also, sometimes the content will get messed up and a space will get dropped,
//   // so we make sure each content includes the previous one before we print the new part of it.
//   if (data.output.length < 1 || data.output[0].content === undefined || !data.output[0].content.includes('###') || !data.output[0].content.includes(prev)) {
//     return
//   }

//   process.stdout.write(data.output[0].content.slice(prev.length))
//   prev = data.output[0].content
// })

// While we wait for GPTScript to execute, we want to remove the session dirs we used.
// Each session dir is usually at least 20MB, and they are one-time use, so we don't need to keep them around.
await context.context.close()
await noJSContext.context.close()
rmSync(context.sessionDir, { recursive: true, force: true })
rmSync(noJSContext.sessionDir, { recursive: true, force: true })
process.stdout.write(JSON.stringify(focusedSearch))

process.exit(0)
