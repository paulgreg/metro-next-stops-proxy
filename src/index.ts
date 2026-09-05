import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { URL } from 'node:url'

import { loadConfig } from './config.js'
import { getNextStops, listStops, resolveStopKey, stopExists } from './nextStops.js'

import debug from 'debug'

const d = debug('index')

const config = loadConfig()

function sendJson(response: ServerResponse, statusCode: number, data: unknown): void {
    const payload = JSON.stringify(data)
    response.writeHead(statusCode, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(payload).toString(),
    })
    response.end(payload)
}

async function handleNextStops(requestUrl: URL, response: ServerResponse): Promise<void> {
    const requestedStopKey = requestUrl.searchParams.get('stop') ?? undefined
    const resolvedStopKey = resolveStopKey(requestedStopKey)
    if (d.enabled) d(`requestedStopKey: ${requestedStopKey} ; resolvedStopKey: ${resolvedStopKey}`)

    if (!stopExists(config, requestedStopKey)) {
        sendJson(response, 404, {
            error: 'Unknown stop key',
            stop: resolvedStopKey,
        })
        return
    }

    try {
        const payload = await getNextStops(config, requestedStopKey)
        sendJson(response, 200, payload)
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected error'
        sendJson(response, 502, {
            error: 'Failed to fetch next stops',
            details: message,
        })
    }
}

function handleStops(response: ServerResponse): void {
    sendJson(response, 200, {
        default: config.defaultStopKey,
        stops: listStops(config),
    })
}

function routeRequest(request: IncomingMessage, response: ServerResponse): Promise<void> | void {
    const method = request.method ?? 'GET'
    const requestUrl = new URL(request.url ?? '/', 'http://localhost')

    if (method === 'GET' && requestUrl.pathname === '/health') {
        sendJson(response, 200, {
            ok: true,
        })
        return
    }

    if (method === 'GET' && requestUrl.pathname === '/stops') {
        handleStops(response)
        return
    }

    if (method === 'GET' && requestUrl.pathname === '/next-stops') {
        return handleNextStops(requestUrl, response)
    }

    sendJson(response, 404, {
        error: 'Not found',
    })
}

const server = createServer((request, response) => {
    void routeRequest(request, response)
})

server.listen(config.port, () => {
    console.log(`metro-next-stops-proxy listening on port ${config.port}`)
})
