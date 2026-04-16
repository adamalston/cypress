import path from 'path'
import { fs } from './util/fs'

type FileStreamError = Error & {
  filePath?: string
  originalFilePath?: string
}

type WritableFileContents = string | Buffer

export async function createReadFileStreamFromPath ({
  filePath,
  originalFilePath,
}: {
  filePath: string
  originalFilePath?: string
}) {
  const stream = fs.createReadStream(filePath)

  try {
    // Wait for the stream to emit `open` so missing file errors are normalized
    // before the response starts streaming.
    await new Promise<void>((resolve, reject) => {
      const handleError = (error: FileStreamError) => {
        error.originalFilePath = originalFilePath
        error.filePath = filePath

        reject(error)
      }

      stream.once('error', handleError)
      stream.once('open', () => {
        stream.off('error', handleError)
        resolve()
      })
    })

    return {
      filePath,
      stream,
    }
  } catch (error) {
    stream.destroy()

    throw error
  }
}

export async function createWriteFileStreamFromPath ({
  filePath,
  originalFilePath,
  encoding,
  flag,
}: {
  filePath: string
  originalFilePath?: string
  encoding?: BufferEncoding | null
  flag?: string
}) {
  await fs.ensureDir(path.dirname(filePath))

  const stream = fs.createWriteStream(filePath, {
    ...(encoding === null ? {} : { encoding: encoding === undefined ? 'utf8' : encoding }),
    flags: flag ?? 'w',
  })

  try {
    // Wait for the stream to emit `open` so path and permission errors are
    // normalized before the request body starts flowing into the stream.
    await new Promise<void>((resolve, reject) => {
      const handleError = (error: FileStreamError) => {
        error.originalFilePath = originalFilePath
        error.filePath = filePath

        reject(error)
      }

      stream.once('error', handleError)
      stream.once('open', () => {
        stream.off('error', handleError)
        resolve()
      })
    })

    return {
      filePath,
      stream,
    }
  } catch (error) {
    stream.destroy()

    throw error
  }
}

export async function readFile (projectRoot: string, options: { file: string, encoding?: BufferEncoding } = { file: '', encoding: 'utf8' }) {
  const filePath = path.resolve(projectRoot, options.file)

  // https://github.com/cypress-io/cypress/issues/1558
  // If no encoding is specified, then Cypress has historically defaulted
  // to `utf8`, because of it's focus on text files. This is in contrast to
  // NodeJs, which defaults to binary. We allow users to pass in `null`
  // to restore the default node behavior.
  try {
    let contents

    if (path.extname(filePath) === '.json' && options.encoding !== null) {
      contents = await fs.readJsonAsync(filePath, options.encoding === undefined ? 'utf8' : options.encoding)
    } else {
      contents = await fs.readFileAsync(filePath, {
        encoding: options.encoding === undefined ? 'utf8' : options.encoding,
      })
    }

    return {
      contents,
      filePath,
    }
  } catch (err) {
    err.originalFilePath = options.file
    err.filePath = filePath
    throw err
  }
}

export async function writeFile (projectRoot: string, options: { fileName: string, contents: WritableFileContents, encoding?: BufferEncoding | null, flag?: string } = { fileName: '', contents: '', encoding: 'utf8', flag: 'w' }) {
  const filePath = path.resolve(projectRoot, options.fileName)
  const writeOptions = {
    encoding: options.encoding === undefined ? 'utf8' : options.encoding,
    flag: options.flag || 'w',
  }

  try {
    await fs.outputFile(filePath, options.contents, writeOptions)

    return {
      contents: options.contents,
      filePath,
    }
  } catch (err) {
    err.filePath = filePath
    throw err
  }
}
