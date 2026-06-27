import traverse from '@json-schema-tools/traverse'
import { isEmpty, set as setPath, truncate } from 'lodash-es'
import { Console } from 'node:console'
import { homedir } from 'os'
import { join } from 'path'
import prompts from 'prompts'
import { parse } from 'uri-template'
import yoctoSpinner from 'yocto-spinner'
import colors from 'yoctocolors'

export const logger = new Console({ stdout: process.stderr, stderr: process.stderr })

export function prettyPrint(obj) {
  logger.dir(obj, { depth: null, colors: true })
}

export function createSpinner(text) {
  return yoctoSpinner({ text, stream: process.stderr }).start()
}

export function getClaudeConfigPath() {
  if (process.platform === 'win32') {
    return join(homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json')
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  }
}

export async function readPromptArgumentInputs(args) {
  if (!args || args.length === 0) {
    return {}
  }
  return prompts(
    args.map((arg) => ({
      type: 'text',
      name: arg.name,
      message: colors.dim((arg.required ? '* ' : '') + `${arg.name}: ${arg.description}`),
    })),
  )
}

function getPromptPropertyKey(path) {
  if (path === '$' || !path.includes('.properties.')) {
    return null
  }

  return path
    .replace(/^\$\.properties\./, '')
    .replace(/\.properties\./g, '.')
    .replace(/\.(?:anyOf|oneOf)\[\d+\]/g, '')
}

function isPropertyRequired(schema, keyPath) {
  const parts = keyPath.split('.')
  let current = schema
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = current?.properties?.[parts[index]]
  }
  return current?.required?.includes(parts.at(-1)) ?? false
}

export function buildJSONSchemaQuestions(schema) {
  if (!schema || isEmpty(schema)) {
    return []
  }

  const questions = []
  const seenKeys = new Set()
  traverse.default(schema, (s, _isCycle, path, parent) => {
    const key = getPromptPropertyKey(path)
    if (!key || seenKeys.has(key)) {
      return
    }
    if (parent && parent.type === 'array') {
      return
    }

    const required = isPropertyRequired(schema, key)
    if (s.type === 'string') {
      seenKeys.add(key)
      questions.push({ key, type: 'text', required, initial: s.default })
    } else if (s.type === 'integer' || s.type === 'number') {
      seenKeys.add(key)
      questions.push({
        key,
        type: 'number',
        required,
        initial: s.default,
        max: s.maximum ?? s.exclusiveMaximum,
        min: s.minimum ?? s.exclusiveMinimum,
      })
    } else if (s.type === 'boolean') {
      seenKeys.add(key)
      questions.push({ type: 'confirm', key, required, initial: s.default })
    }
  })
  return questions
}

export async function readJSONSchemaInputs(schema) {
  const questions = buildJSONSchemaQuestions(schema)
  if (questions.length === 0) {
    return {}
  }
  const results = {}
  for (const q of questions) {
    const { key, required, ...options } = q
    const { value } = await prompts({
      name: 'value',
      message: colors.dim(`${required ? '* ' : ''}${key}`),
      ...options,
    })
    if (value !== '') {
      setPath(results, q.key, value)
    }
  }
  return results
}

export async function populateURITemplateParts(uriTemplate) {
  const template = parse(uriTemplate)
  let uri = ''
  const values = {}
  logger.log('Constructing URI template:', colors.underline(uriTemplate))
  for (const part of template.ast.parts) {
    if (part.type === 'literal') {
      uri += part.value
    } else if (part.type === 'expression') {
      for (const variable of part.variables) {
        const { value } = await prompts({
          type: 'text',
          name: 'value',
          message: variable.name,
        })
        values[variable.name] = value
      }
    }
  }
  const expanded = template.expand(values)
  logger.info('Constructed resource URI:', colors.underline(expanded))
  const result = await prompts({
    name: 'value',
    type: 'confirm',
    message: 'Confirm resource URI?',
    initial: true,
  })
  return result.value ? expanded : null
}

export function formatDescription(description, compact = false) {
  if (!description || !compact) {
    return description || ''
  }
  const normalized = description.replace(/\s+/g, ' ').trim()
  return truncate(normalized, { length: 100 })
}
