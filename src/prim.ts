import type { Config, Platform } from './config.js'
import debug from 'debug'

const d = debug('prim')

const STOP_MONITORING_BASE_URL = 'https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring'

type Direction = {
    name: string
    line: string
    minutes: number[]
}

type ParsedPlatformResponse = {
    directions: Direction[]
    responseTimestamp?: string
}

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return value as JsonRecord
    }
    return null
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : []
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() !== '' ? value : null
}

function extractLangString(value: unknown): string | null {
    const direct = asString(value)
    if (direct != null) {
        return direct
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            const nested = extractLangString(item)
            if (nested != null) {
                return nested
            }
        }
        return null
    }

    const objectValue = asRecord(value)
    if (objectValue == null) {
        return null
    }

    const nestedValue = extractLangString(objectValue.value)
    if (nestedValue != null) {
        return nestedValue
    }

    const frValue = extractLangString(objectValue.fr)
    if (frValue != null) {
        return frValue
    }

    for (const entryValue of Object.values(objectValue)) {
        const nested = extractLangString(entryValue)
        if (nested != null) {
            return nested
        }
    }

    return null
}

function parseMinutes(referenceIso: string, expectedIso: string): number | null {
    const referenceMs = Date.parse(referenceIso)
    const expectedMs = Date.parse(expectedIso)
    if (!Number.isFinite(referenceMs) || !Number.isFinite(expectedMs)) {
        return null
    }

    const diffMs = expectedMs - referenceMs
    if (diffMs < 0) {
        return null
    }

    return Math.ceil(diffMs / 60000)
}

function ensureSortedAndLimited(values: number[], limit: number): number[] {
    values.sort((a, b) => a - b)
    if (values.length <= limit) {
        return values
    }
    values.length = limit
    return values
}

function parsePlatformPayload(
    payload: unknown,
    fallbackLineName: string,
    maxDepartures: number
): ParsedPlatformResponse {
    const root = asRecord(payload)
    if (root == null) {
        throw new Error('PRIM response is not a JSON object')
    }

    const siri = asRecord(root.Siri)
    const serviceDelivery = asRecord(siri?.ServiceDelivery)
    const responseTimestamp = asString(serviceDelivery?.ResponseTimestamp) ?? undefined

    const deliveriesRaw = serviceDelivery?.StopMonitoringDelivery
    const deliveries = Array.isArray(deliveriesRaw) ? deliveriesRaw : deliveriesRaw == null ? [] : [deliveriesRaw]

    const minuteMap = new Map<string, { line: string; minutes: number[] }>()

    for (const deliveryValue of deliveries) {
        const delivery = asRecord(deliveryValue)
        if (delivery == null) {
            continue
        }

        const visits = asArray(delivery.MonitoredStopVisit)
        for (const visitValue of visits) {
            const visit = asRecord(visitValue)
            const monitoredVehicleJourney = asRecord(visit?.MonitoredVehicleJourney)
            const monitoredCall = asRecord(monitoredVehicleJourney?.MonitoredCall)
            if (monitoredVehicleJourney == null || monitoredCall == null) {
                continue
            }

            const directionName =
                extractLangString(monitoredVehicleJourney.DestinationName) ??
                extractLangString(monitoredVehicleJourney.DirectionName)
            if (directionName == null || directionName.length === 0) {
                continue
            }

            const expectedTime =
                asString(monitoredCall.ExpectedDepartureTime) ?? asString(monitoredCall.ExpectedArrivalTime)
            if (responseTimestamp == null || expectedTime == null) {
                continue
            }

            const minutes = parseMinutes(responseTimestamp, expectedTime)
            if (minutes == null) {
                continue
            }

            const lineName = extractLangString(monitoredVehicleJourney.PublishedLineName) ?? fallbackLineName
            const key = directionName
            const current = minuteMap.get(key)
            if (current == null) {
                minuteMap.set(key, { line: lineName, minutes: [minutes] })
            } else {
                current.minutes.push(minutes)
            }
        }
    }

    const directions: Direction[] = Array.from(minuteMap.entries())
        .map(([name, value]) => ({
            name,
            line: value.line,
            minutes: ensureSortedAndLimited(value.minutes, maxDepartures),
        }))
        .sort((a, b) => {
            const aFirst = a.minutes.length > 0 ? a.minutes[0] : Number.MAX_SAFE_INTEGER
            const bFirst = b.minutes.length > 0 ? b.minutes[0] : Number.MAX_SAFE_INTEGER
            return aFirst - bFirst
        })

    return { directions, responseTimestamp }
}

export async function fetchPlatformDirections(
    platform: Platform,
    lineRefFallback: string,
    lineNameFallback: string,
    config: Config
): Promise<ParsedPlatformResponse> {
    const lineRef = platform.lineRef ?? lineRefFallback

    const url = new URL(STOP_MONITORING_BASE_URL)
    url.searchParams.set('MonitoringRef', platform.monitoringRef)
    url.searchParams.set('LineRef', lineRef)

    if (d.enabled) d(`calling ${url} - timeout: ${config.requestTimeoutMs}`)
    const response = await fetch(url, {
        headers: {
            apikey: config.primApiToken,
            accept: 'application/json',
        },
        signal: AbortSignal.timeout(config.requestTimeoutMs),
    })

    if (!response.ok) {
        const body = await response.text()
        if (d.enabled) d(`response (${response.status}): ${body}`)
        throw new Error(`PRIM request failed (${response.status}): ${body.slice(0, 200)}`)
    }

    const payload = (await response.json()) as unknown
    if (d.enabled) d(`response (${response.status}): ${JSON.stringify(payload)}`)
    return parsePlatformPayload(payload, lineNameFallback, config.maxDepartures)
}

export type { Direction }
