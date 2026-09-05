import process from 'node:process'

type Platform = {
    monitoringRef: string
    lineRef?: string
}

type StopConfig = {
    name: string
    lineName: string
    lineRef: string
    platforms: Platform[]
}

type StopEntry = {
    key: string
    config: StopConfig
}

type Config = {
    port: number
    primApiToken: string
    stops: StopEntry[]
    defaultStopKey: string
    maxDepartures: number
    maxDirections: number
    cacheTtlMs: number
    requestTimeoutMs: number
}

function parsePositiveInt(name: string, rawValue: string | undefined, fallback: number): number {
    if (rawValue == null || rawValue.trim() === '') {
        return fallback
    }

    const value = Number.parseInt(rawValue, 10)
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`)
    }
    return value
}

function parsePlatformsValue(value: unknown, scope: string): Platform[] {
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error(`${scope} must be a non-empty JSON array`)
    }

    return value.map((item, index): Platform => {
        if (typeof item !== 'object' || item == null) {
            throw new Error(`${scope}[${index}] must be an object`)
        }

        const monitoringRef = (item as { monitoringRef?: unknown }).monitoringRef
        if (typeof monitoringRef !== 'string' || monitoringRef.trim() === '') {
            throw new Error(`${scope}[${index}].monitoringRef must be a non-empty string`)
        }

        const lineRef = (item as { lineRef?: unknown }).lineRef
        if (lineRef != null && (typeof lineRef !== 'string' || lineRef.trim() === '')) {
            throw new Error(`${scope}[${index}].lineRef must be a non-empty string when set`)
        }

        return {
            monitoringRef: monitoringRef.trim(),
            lineRef: typeof lineRef === 'string' ? lineRef.trim() : undefined,
        }
    })
}

function parsePlatforms(rawValue: string | undefined): Platform[] {
    if (rawValue == null || rawValue.trim() === '') {
        throw new Error('PLATFORMS is required and must be a JSON array')
    }

    let parsed: unknown
    try {
        parsed = JSON.parse(rawValue)
    } catch (error) {
        throw new Error(`PLATFORMS must be valid JSON: ${(error as Error).message}`)
    }

    return parsePlatformsValue(parsed, 'PLATFORMS')
}

function parseStops(rawValue: string | undefined): StopEntry[] {
    if (rawValue == null || rawValue.trim() === '') {
        return []
    }

    let parsed: unknown
    try {
        parsed = JSON.parse(rawValue)
    } catch (error) {
        throw new Error(`STOPS must be valid JSON: ${(error as Error).message}`)
    }

    if (typeof parsed !== 'object' || parsed == null || Array.isArray(parsed)) {
        throw new Error('STOPS must be a JSON object keyed by stop id')
    }

    const entries = Object.entries(parsed)
    if (entries.length === 0) {
        throw new Error('STOPS must contain at least one stop')
    }

    return entries.map(([key, value], index): StopEntry => {
        if (typeof key !== 'string' || key.trim() === '') {
            throw new Error(`STOPS key at index ${index} must be a non-empty string`)
        }

        if (typeof value !== 'object' || value == null || Array.isArray(value)) {
            throw new Error(`STOPS.${key} must be an object`)
        }

        const stop = value as {
            name?: unknown
            lineName?: unknown
            lineRef?: unknown
            platforms?: unknown
        }

        if (typeof stop.name !== 'string' || stop.name.trim() === '') {
            throw new Error(`STOPS.${key}.name must be a non-empty string`)
        }

        if (typeof stop.lineRef !== 'string' || stop.lineRef.trim() === '') {
            throw new Error(`STOPS.${key}.lineRef must be a non-empty string`)
        }

        if (stop.lineName != null && typeof stop.lineName !== 'string') {
            throw new Error(`STOPS.${key}.lineName must be a string when set`)
        }

        return {
            key: key.trim(),
            config: {
                name: stop.name.trim(),
                lineName: typeof stop.lineName === 'string' ? stop.lineName.trim() : '',
                lineRef: stop.lineRef.trim(),
                platforms: parsePlatformsValue(stop.platforms, `STOPS.${key}.platforms`),
            },
        }
    })
}

function buildLegacySingleStop(): StopEntry {
    const lineRef = process.env.LINE_REF?.trim() ?? ''
    if (lineRef.length === 0) {
        throw new Error('LINE_REF is required when STOPS is not set')
    }

    return {
        key: 'default',
        config: {
            name: process.env.STOP_NAME?.trim() || 'Metro',
            lineName: process.env.LINE_NAME?.trim() || '',
            lineRef,
            platforms: parsePlatforms(process.env.PLATFORMS),
        },
    }
}

function loadDotEnv(): void {
    try {
        process.loadEnvFile('.env')
    } catch {
        // Optional; useful in production when env vars are injected directly.
    }
}

export function loadConfig(): Config {
    loadDotEnv()

    const primApiToken = process.env.PRIM_API_TOKEN?.trim() ?? ''
    if (primApiToken.length === 0) {
        throw new Error('PRIM_API_TOKEN is required')
    }

    const stops = parseStops(process.env.STOPS)
    const resolvedStops = stops.length > 0 ? stops : [buildLegacySingleStop()]
    const defaultStopKeyRaw = process.env.DEFAULT_STOP_KEY?.trim()
    const defaultStopKey =
        defaultStopKeyRaw != null && defaultStopKeyRaw.length > 0 ? defaultStopKeyRaw : resolvedStops[0].key

    if (!resolvedStops.some((stop) => stop.key === defaultStopKey)) {
        throw new Error('DEFAULT_STOP_KEY must match one of the configured STOPS keys')
    }

    const conf = {
        port: parsePositiveInt('PORT', process.env.PORT, 3000),
        primApiToken,
        stops: resolvedStops,
        defaultStopKey,
        maxDepartures: parsePositiveInt('MAX_DEPARTURES', process.env.MAX_DEPARTURES, 6),
        maxDirections: parsePositiveInt('MAX_DIRECTIONS', process.env.MAX_DIRECTIONS, 4),
        cacheTtlMs: parsePositiveInt('CACHE_TTL_MS', process.env.CACHE_TTL_MS, 30_000),
        requestTimeoutMs: parsePositiveInt('REQUEST_TIMEOUT_MS', process.env.REQUEST_TIMEOUT_MS, 15_000),
    }
    console.info(
        'config:',
        JSON.stringify(
            {
                ...conf,
                primApiToken: 'redacted',
            },
            null,
            2
        )
    )
    return conf
}

export type { Config, Platform, StopConfig, StopEntry }
