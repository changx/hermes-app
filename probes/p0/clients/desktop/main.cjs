const { app, BrowserWindow } = require('electron')
const path = require('node:path')

app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 860, height: 600,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
  })
  window.loadFile(path.join(__dirname, 'dist/renderer/index.html'))
  if (process.env.HERMES_P0_SELFTEST === '1') {
    window.webContents.once('did-finish-load', async () => {
      try {
        const result = await window.webContents.executeJavaScript(`({
          title: document.querySelector('h1')?.textContent,
          state: document.querySelector('#state')?.textContent,
          synthetic: document.querySelector('strong')?.textContent
        })`)
        if (!result.title?.includes('Hermes App P0') ||
            result.state !== '连接状态：idle' ||
            !result.synthetic?.includes('合成诊断')) throw new Error(JSON.stringify(result))
        console.log('P0_DESKTOP_SELFTEST_OK', JSON.stringify(result))
      } catch (error) {
        console.error('P0_DESKTOP_SELFTEST_FAILED', error)
        process.exitCode = 1
      } finally {
        app.quit()
      }
    })
  }
})
app.on('window-all-closed', () => app.quit())
