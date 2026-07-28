import 'dotenv/config'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import app from './app.js'

const port = Number(process.env.PORT ?? 8787)
const host = process.env.HOST ?? '0.0.0.0'

if (process.env.NODE_ENV === 'production') {
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
  const dist = path.resolve(currentDirectory, '../dist')
  app.use(express.static(dist))
  app.get('/{*splat}', (_request, response) => response.sendFile(path.join(dist, 'index.html')))
}

app.listen(port, host, () => {
  console.log(`Kindred Objects server listening at http://${host}:${port}`)
})
