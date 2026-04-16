import Bluebird from 'bluebird'
import { extname } from 'path'

import $errUtils from '../cypress/error_utils'

/**
 * prevents further scripts outside of our own and the spec itself from being
 * run in the spec frame
 * @param specWindow: Window
 */
export function setSpecContentSecurityPolicy (specWindow) {
  const metaEl = specWindow.document.createElement('meta')

  metaEl.setAttribute('http-equiv', 'Content-Security-Policy')
  metaEl.setAttribute('content', `script-src 'unsafe-eval'; worker-src * data: blob: 'unsafe-eval' 'unsafe-inline'`)
  specWindow.document.querySelector('head')!.appendChild(metaEl)
}

type PrivilegedCy = Pick<Cypress.cy, 'state'>
type PrivilegedCommandCypress = Pick<InternalCypress.Cypress, 'backend'>
type PrivilegedFileCommandCypress = Pick<InternalCypress.Cypress, 'backend' | 'config'> & {
  Buffer: {
    from: (value: ArrayBuffer) => Buffer
  }
}
type PrivilegedVerification = {
  args?: unknown[]
  promise?: Promise<unknown>
}
interface JsonObject {
  [key: string]: JsonValue
}

type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject
type DecodedPrivilegedFileContents = Buffer | JsonValue
type PrivilegedFileCommandResult = {
  contents: DecodedPrivilegedFileContents
  filePath: string
}
type PrivilegedFileTransfer = {
  filePath: string
  token: string
}
type PrivilegedWriteableFileContents = string | Buffer
type PrivilegedFileRequestBody = string | ArrayBuffer

interface RunPrivilegedCommandOptions {
  commandName: string
  cy: PrivilegedCy
  Cypress: PrivilegedCommandCypress
  options: any
}

interface RunPrivilegedFileCommandOptions {
  commandName: 'readFile' | 'selectFile'
  cy: PrivilegedCy
  Cypress: PrivilegedFileCommandCypress
  options: {
    encoding?: Cypress.Encodings | null
    file: string
  }
}

interface RunPrivilegedFileWriteCommandOptions {
  commandName: 'writeFile'
  cy: PrivilegedCy
  Cypress: PrivilegedCommandCypress & {
    config: (key: string) => string | undefined
  }
  options: {
    contents: PrivilegedWriteableFileContents
    encoding?: Cypress.Encodings | null
    fileName: string
    flag?: string
  }
}

const getVerifiedCommand = (cy: PrivilegedCy): PrivilegedVerification => {
  const privilegeVerification = cy.state('current')?.get('privilegeVerification')

  return (Array.isArray(privilegeVerification) ? privilegeVerification[0] : undefined) ?? {}
}

const getPrivilegedFileUrl = (
  Cypress: RunPrivilegedFileCommandOptions['Cypress'],
  route: 'read-file' | 'write-file',
) => {
  return `${window.location.origin}/${String(Cypress.config('namespace'))}/privileged-commands/${route}`
}

const readResponseAsArrayBuffer = async (response: Response) => {
  const { body } = response

  if (!body) return response.arrayBuffer()

  // Reassemble the streamed response body without relying on a single
  // monolithic payload transfer.
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let totalLength = 0

  for (let result = await reader.read(); !result.done; result = await reader.read()) {
    const { value } = result

    if (value) {
      chunks.push(value)
      totalLength += value.byteLength
    }
  }

  const combined = new Uint8Array(totalLength)
  let offset = 0

  chunks.forEach((chunk) => {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  })

  return combined.buffer
}

const throwResponseError = async (response: Response) => {
  const defaultError = new Error(
    `Privileged file read failed with status code ${response.status}`,
  )
  const body = await response.json().catch(() => undefined)

  if (body?.error) throw $errUtils.makeErrFromObj(body.error)

  throw defaultError
}

const stripJsonByteOrderMark = (contents: string) => {
  return contents.replace(/^\uFEFF/, '')
}

const decodePrivilegedFileContents = (
  Cypress: RunPrivilegedFileCommandOptions['Cypress'],
  arrayBuffer: ArrayBuffer,
  {
    encoding,
    file,
    filePath,
  }: {
    encoding?: Cypress.Encodings | null
    file: string
    filePath: string
  },
): DecodedPrivilegedFileContents => {
  const buffer = Cypress.Buffer.from(arrayBuffer)

  if (encoding === null) return buffer

  const stringContents = buffer.toString(encoding ?? 'utf8')

  if (extname(filePath || file) === '.json') {
    try {
      return JSON.parse(stripJsonByteOrderMark(stringContents))
    } catch (error) {
      error.filePath = filePath
      error.originalFilePath = file

      throw error
    }
  }

  return stringContents
}

const getPrivilegedFileWriteBody = (
  contents: PrivilegedWriteableFileContents,
): PrivilegedFileRequestBody => {
  if (Buffer.isBuffer(contents)) {
    const arrayBuffer = new ArrayBuffer(contents.byteLength)

    new Uint8Array(arrayBuffer).set(contents)

    return arrayBuffer
  }

  return contents
}

export function runPrivilegedCommand ({ commandName, cy, Cypress, options }: RunPrivilegedCommandOptions): Bluebird<any> {
  const { args, promise } = getVerifiedCommand(cy)

  return Bluebird
  .try(() => promise)
  .then(() => {
    return Cypress.backend('run:privileged', {
      commandName,
      options,
      args,
    })
  })
}

export function runPrivilegedFileCommand ({
  commandName,
  cy,
  Cypress,
  options,
}: RunPrivilegedFileCommandOptions): Bluebird<PrivilegedFileCommandResult> {
  const { args, promise } = getVerifiedCommand(cy)

  return Bluebird
  .try(() => promise)
  .then(async () => {
    const fileRead: PrivilegedFileTransfer = await Cypress.backend(
      'create:privileged:file:read',
      {
        args,
        commandName,
        options: {
          file: options.file,
        },
      },
    )

    const response = await fetch(
      getPrivilegedFileUrl(Cypress, 'read-file'),
      {
        body: JSON.stringify({ token: fileRead.token }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      },
    )

    if (!response.ok) await throwResponseError(response)

    const encodedFilePath = response.headers.get('x-cypress-file-path')
    const filePath = encodedFilePath
      ? decodeURIComponent(encodedFilePath)
      : fileRead.filePath
    const contents = decodePrivilegedFileContents(
      Cypress,
      await readResponseAsArrayBuffer(response),
      { encoding: options.encoding, file: options.file, filePath },
    )

    return {
      contents,
      filePath,
    }
  })
}

export function runPrivilegedFileWriteCommand ({
  commandName,
  cy,
  Cypress,
  options,
}: RunPrivilegedFileWriteCommandOptions): Bluebird<{
  contents: PrivilegedWriteableFileContents
  filePath: string
}> {
  const { args, promise } = getVerifiedCommand(cy)

  return Bluebird
  .try(() => promise)
  .then(async () => {
    const fileWrite: PrivilegedFileTransfer = await Cypress.backend(
      'create:privileged:file:write',
      {
        args,
        commandName,
        options: {
          encoding: options.encoding,
          fileName: options.fileName,
          flag: options.flag,
        },
      },
    )

    const contentsType = Buffer.isBuffer(options.contents) ? 'buffer' : 'string'
    const requestBody = getPrivilegedFileWriteBody(options.contents)
    const response = await fetch(
      getPrivilegedFileUrl(Cypress as RunPrivilegedFileCommandOptions['Cypress'], 'write-file'),
      {
        body: requestBody,
        headers: {
          'Content-Type': contentsType === 'buffer'
            ? 'application/octet-stream'
            : 'text/plain;charset=UTF-8',
          'x-cypress-file-contents-type': contentsType,
          'x-cypress-privileged-file-token': fileWrite.token,
        },
        method: 'POST',
      },
    )

    if (!response.ok) await throwResponseError(response)

    const body = await response.json()

    return {
      contents: options.contents,
      filePath: body?.filePath ?? fileWrite.filePath,
    }
  })
}
