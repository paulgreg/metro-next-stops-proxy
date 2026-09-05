import type { Config, StopEntry } from './config.js'
import { fetchPlatformDirections, type Direction } from './prim.js'

type NextStopsResponse = {
    name: string
    line: string
    updatedAt: string
    directions: Direction[]
}

type CacheEntry = {
    expiresAt: number
    value: NextStopsResponse
}

const cacheByStopKey = new Map<string, CacheEntry>()

function mergeDirections(allDirections: Direction[], maxDepartures: number, maxDirections: number): Direction[] {
    const byName = new Map<string, Direction>()

    for (const direction of allDirections) {
        const existing = byName.get(direction.name)
        if (existing == null) {
            byName.set(direction.name, {
                name: direction.name,
                line: direction.line,
                minutes: [...direction.minutes],
            })
            continue
        }

        existing.minutes.push(...direction.minutes)
        if (existing.line.length === 0 && direction.line.length > 0) {
            existing.line = direction.line
        }
    }

    const merged = Array.from(byName.values())
        .map((direction) => {
            direction.minutes.sort((a, b) => a - b)
            if (direction.minutes.length > maxDepartures) {
                direction.minutes.length = maxDepartures
            }
            return direction
        })
        .sort((a, b) => {
            const aFirst = a.minutes.length > 0 ? a.minutes[0] : Number.MAX_SAFE_INTEGER
            const bFirst = b.minutes.length > 0 ? b.minutes[0] : Number.MAX_SAFE_INTEGER
            return aFirst - bFirst
        })

    if (merged.length > maxDirections) {
        merged.length = maxDirections
    }

    return merged
}

function findStop(config: Config, stopKey: string): StopEntry | null {
    return config.stops.find((stop) => stop.key === stopKey) ?? null
}

function normalizeStopKey(stopKey: string | undefined): string {
    if (stopKey == null || stopKey.trim() === '') {
        return ''
    }
    return stopKey.trim()
}

function getCacheEntry(stopKey: string): CacheEntry | null {
    return cacheByStopKey.get(stopKey) ?? null
}

function setCacheEntry(stopKey: string, entry: CacheEntry): void {
    cacheByStopKey.set(stopKey, entry)
}

function listStops(config: Config): { key: string; name: string }[] {
    return config.stops.map((stop) => ({ key: stop.key, name: stop.config.name }))
}

export async function getNextStops(config: Config, requestedStopKey: string | undefined): Promise<NextStopsResponse> {
    const stopKey = normalizeStopKey(requestedStopKey)
    const stop = findStop(config, stopKey)
    if (stop == null) {
        throw new Error(`Unknown stop key: ${stopKey}`)
    }

    const now = Date.now()
    const cached = getCacheEntry(stopKey)
    if (cached != null && cached.expiresAt > now) {
        return cached.value
    }

    const platformResults = await Promise.allSettled(
        stop.config.platforms.map(async (platform) =>
            fetchPlatformDirections(platform, stop.config.lineRef, stop.config.lineName, config)
        )
    )

    const directions: Direction[] = []
    let hasSuccess = false

    for (const result of platformResults) {
        if (result.status === 'fulfilled') {
            hasSuccess = true
            directions.push(...result.value.directions)
        }
    }

    if (!hasSuccess) {
        const messages = platformResults
            .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
            .map((result) => String(result.reason))
        throw new Error(messages.length > 0 ? messages.join(' | ') : 'All platform requests failed')
    }

    const value: NextStopsResponse = {
        name: stop.config.name,
        line: stop.config.lineName,
        updatedAt: new Date().toISOString(),
        directions: mergeDirections(directions, config.maxDepartures, config.maxDirections),
    }

    setCacheEntry(stopKey, {
        value,
        expiresAt: now + config.cacheTtlMs,
    })

    return value
}

function resolveStopKey(requestedStopKey: string | undefined): string {
    return normalizeStopKey(requestedStopKey)
}

function stopExists(config: Config, requestedStopKey: string | undefined): boolean {
    const stopKey = normalizeStopKey(requestedStopKey)
    return findStop(config, stopKey) != null
}

export { listStops, resolveStopKey, stopExists }
export type { NextStopsResponse }
