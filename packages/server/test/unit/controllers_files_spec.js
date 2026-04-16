require('../spec_helper')

const EventEmitter = require('events')

const filesController = require('../../lib/controllers/files')
const files = require('../../lib/files')
const errors = require('../../lib/errors')
const { privilegedCommandsManager } = require('../../lib/privileged-commands/privileged-commands-manager')

const createResponse = () => {
  const res = {
    destroy: sinon.stub(),
    headersSent: false,
    json: sinon.stub(),
    setHeader: sinon.stub(),
    status: sinon.stub(),
    type: sinon.stub(),
  }

  res.status.callsFake(() => res)
  res.type.callsFake(() => res)

  return res
}

const createStream = () => {
  const handlers = {}
  const stream = {
    on: sinon.stub().callsFake((event, handler) => {
      handlers[event] = handler

      return stream
    }),
    pipe: sinon.stub(),
  }

  return { handlers, stream }
}

const createWriteRequest = (headers = {}) => {
  const req = new EventEmitter()

  req.get = sinon.stub().callsFake((key) => headers[key])
  req.off = req.removeListener.bind(req)
  req.pipe = sinon.stub().callsFake((stream) => {
    stream.emit('finish')

    return stream
  })

  req.setEncoding = sinon.stub()

  return req
}

const createWritableStream = () => {
  const stream = new EventEmitter()

  stream.destroy = sinon.stub()
  stream.off = stream.removeListener.bind(stream)

  return stream
}

describe('controllers/files', () => {
  it('should stream a privileged file read response', async () => {
    const res = createResponse()
    const { stream } = createStream()

    sinon.stub(privilegedCommandsManager, 'consumePrivilegedFileRead').returns({
      filePath: '/project/root/foo.txt',
      originalFilePath: 'foo.txt',
    })

    sinon.stub(files, 'createReadFileStreamFromPath').resolves({ stream })
    sinon.stub(errors, 'cloneErr').callsFake((error) => {
      return {
        message: error.message,
        name: error.name,
      }
    })

    await filesController.handlePrivilegedFileRead({ body: { token: 'token-123' } }, res)

    expect(privilegedCommandsManager.consumePrivilegedFileRead).to.have.been.calledWith('token-123')
    expect(files.createReadFileStreamFromPath).to.have.been.calledWith({
      filePath: '/project/root/foo.txt',
      originalFilePath: 'foo.txt',
    })

    expect(res.type).to.have.been.calledWith('application/octet-stream')
    expect(res.setHeader).to.have.been.calledWith('Cache-Control', 'no-store')
    expect(res.setHeader).to.have.been.calledWith(
      'x-cypress-file-path',
      encodeURIComponent('/project/root/foo.txt'),
    )

    expect(stream.on).to.have.been.calledWith('error', sinon.match.func)
    expect(stream.pipe).to.have.been.calledWith(res)
    expect(res.status).not.to.have.been.called
    expect(res.json).not.to.have.been.called
  })

  it('should return a 500 response when the privileged file read token is missing', async () => {
    const res = createResponse()

    sinon.stub(privilegedCommandsManager, 'consumePrivilegedFileRead')
    sinon.stub(files, 'createReadFileStreamFromPath')
    sinon.stub(errors, 'cloneErr').callsFake((error) => {
      return {
        message: error.message,
        name: error.name,
      }
    })

    await filesController.handlePrivilegedFileRead({ body: {} }, res)

    expect(privilegedCommandsManager.consumePrivilegedFileRead).not.to.have.been.called
    expect(files.createReadFileStreamFromPath).not.to.have.been.called
    expect(res.status).to.have.been.calledWith(500)
    expect(res.json).to.have.been.calledWith({
      error: {
        message: 'You requested a privileged file read without a valid token',
        name: 'Error',
      },
    })
  })

  it('should return a 500 response when the privileged file stream errors before headers are sent', async () => {
    const res = createResponse()
    const { handlers, stream } = createStream()
    const streamError = Object.assign(new Error('stream failed'), { code: 'EISDIR' })

    sinon.stub(privilegedCommandsManager, 'consumePrivilegedFileRead').returns({
      filePath: '/project/root/foo.txt',
      originalFilePath: 'foo.txt',
    })

    sinon.stub(files, 'createReadFileStreamFromPath').resolves({ stream })
    sinon.stub(errors, 'cloneErr').callsFake((error) => {
      return {
        code: error.code,
        message: error.message,
        name: error.name,
      }
    })

    await filesController.handlePrivilegedFileRead({ body: { token: 'token-123' } }, res)
    handlers.error(streamError)

    expect(res.status).to.have.been.calledWith(500)
    expect(res.json).to.have.been.calledWith({
      error: {
        code: 'EISDIR',
        message: 'stream failed',
        name: 'Error',
      },
    })

    expect(res.destroy).not.to.have.been.called
  })

  it('should destroy the response when the privileged file stream errors after headers are sent', async () => {
    const res = createResponse()
    const { handlers, stream } = createStream()
    const streamError = new Error('stream failed')

    sinon.stub(privilegedCommandsManager, 'consumePrivilegedFileRead').returns({
      filePath: '/project/root/foo.txt',
      originalFilePath: 'foo.txt',
    })

    sinon.stub(files, 'createReadFileStreamFromPath').resolves({ stream })
    sinon.stub(errors, 'cloneErr')

    await filesController.handlePrivilegedFileRead({ body: { token: 'token-123' } }, res)
    res.headersSent = true
    handlers.error(streamError)

    expect(res.destroy).to.have.been.calledWith(streamError)
    expect(res.status).not.to.have.been.called
    expect(res.json).not.to.have.been.called
    expect(errors.cloneErr).not.to.have.been.called
  })

  it('should stream a privileged file write request to disk', async () => {
    const req = createWriteRequest({
      'x-cypress-file-contents-type': 'string',
      'x-cypress-privileged-file-token': 'token-123',
    })
    const res = createResponse()
    const stream = createWritableStream()

    sinon.stub(privilegedCommandsManager, 'consumePrivilegedFileWrite').returns({
      encoding: 'utf8',
      filePath: '/project/root/foo.txt',
      flag: 'w',
      originalFilePath: 'foo.txt',
    })

    sinon.stub(files, 'createWriteFileStreamFromPath').resolves({ stream })
    sinon.stub(errors, 'cloneErr')

    await filesController.handlePrivilegedFileWrite(req, res)

    expect(privilegedCommandsManager.consumePrivilegedFileWrite).to.have.been.calledWith('token-123')
    expect(files.createWriteFileStreamFromPath).to.have.been.calledWith({
      encoding: 'utf8',
      filePath: '/project/root/foo.txt',
      flag: 'w',
      originalFilePath: 'foo.txt',
    })

    expect(req.setEncoding).to.have.been.calledWith('utf8')
    expect(req.pipe).to.have.been.calledWith(stream)
    expect(stream.destroy).not.to.have.been.called
    expect(res.status).to.have.been.calledWith(200)
    expect(res.json).to.have.been.calledWith({ filePath: '/project/root/foo.txt' })
  })

  it('should return a 500 response when the privileged file write token is missing', async () => {
    const req = createWriteRequest({
      'x-cypress-file-contents-type': 'string',
    })
    const res = createResponse()

    sinon.stub(privilegedCommandsManager, 'consumePrivilegedFileWrite')
    sinon.stub(files, 'createWriteFileStreamFromPath')
    sinon.stub(errors, 'cloneErr').callsFake((error) => {
      return {
        message: error.message,
        name: error.name,
      }
    })

    await filesController.handlePrivilegedFileWrite(req, res)

    expect(privilegedCommandsManager.consumePrivilegedFileWrite).not.to.have.been.called
    expect(files.createWriteFileStreamFromPath).not.to.have.been.called
    expect(res.status).to.have.been.calledWith(500)
    expect(res.json).to.have.been.calledWith({
      error: {
        message: 'You requested a privileged file write without a valid token',
        name: 'Error',
      },
    })
  })

  it('should return a 500 response when the privileged file write contents type is missing', async () => {
    const req = createWriteRequest({
      'x-cypress-privileged-file-token': 'token-123',
    })
    const res = createResponse()

    sinon.stub(privilegedCommandsManager, 'consumePrivilegedFileWrite')
    sinon.stub(files, 'createWriteFileStreamFromPath')
    sinon.stub(errors, 'cloneErr').callsFake((error) => {
      return {
        message: error.message,
        name: error.name,
      }
    })

    await filesController.handlePrivilegedFileWrite(req, res)

    expect(privilegedCommandsManager.consumePrivilegedFileWrite).not.to.have.been.called
    expect(files.createWriteFileStreamFromPath).not.to.have.been.called
    expect(res.status).to.have.been.calledWith(500)
    expect(res.json).to.have.been.calledWith({
      error: {
        message: 'You requested a privileged file write without a valid contents type',
        name: 'Error',
      },
    })
  })

  it('should return a 500 response when the privileged file write stream errors', async () => {
    const req = createWriteRequest({
      'x-cypress-file-contents-type': 'buffer',
      'x-cypress-privileged-file-token': 'token-123',
    })
    const res = createResponse()
    const stream = createWritableStream()
    const streamError = Object.assign(new Error('stream failed'), { code: 'EISDIR' })

    req.pipe.callsFake((destination) => {
      destination.emit('error', streamError)

      return destination
    })

    sinon.stub(privilegedCommandsManager, 'consumePrivilegedFileWrite').returns({
      encoding: null,
      filePath: '/project/root/foo.txt',
      flag: 'w',
      originalFilePath: 'foo.txt',
    })

    sinon.stub(files, 'createWriteFileStreamFromPath').resolves({ stream })
    sinon.stub(errors, 'cloneErr').callsFake((error) => {
      return {
        code: error.code,
        filePath: error.filePath,
        message: error.message,
        name: error.name,
        originalFilePath: error.originalFilePath,
      }
    })

    await filesController.handlePrivilegedFileWrite(req, res)

    expect(req.setEncoding).not.to.have.been.called
    expect(stream.destroy).to.have.been.called
    expect(res.status).to.have.been.calledWith(500)
    expect(res.json).to.have.been.calledWith({
      error: {
        code: 'EISDIR',
        filePath: '/project/root/foo.txt',
        message: 'stream failed',
        name: 'Error',
        originalFilePath: 'foo.txt',
      },
    })
  })
})
