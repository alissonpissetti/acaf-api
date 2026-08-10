import type { GymUnit } from './types';

export const CHECK_IN_MAX_RADIUS_KM = 1;

/** Distância em km entre dois pontos (Haversine). */
export function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
}

export function unitHasCoordinates(unit: GymUnit): boolean {
  return typeof unit.latitude === 'number' && typeof unit.longitude === 'number';
}

export function distanceToUnitKm(unit: GymUnit, latitude: number, longitude: number): number | null {
  if (!unitHasCoordinates(unit)) return null;
  return distanceKm(latitude, longitude, unit.latitude!, unit.longitude!);
}

export function isWithinCheckInRadius(
  unit: GymUnit,
  latitude: number,
  longitude: number,
  maxRadiusKm = CHECK_IN_MAX_RADIUS_KM,
): boolean {
  const dist = distanceToUnitKm(unit, latitude, longitude);
  if (dist == null) return false;
  return dist <= maxRadiusKm;
}
