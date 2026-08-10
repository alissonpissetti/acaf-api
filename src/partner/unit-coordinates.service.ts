import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AddressesService } from '../addresses/addresses.service';
import { unitHasCoordinates } from './checkInGeo';
import { loadStore, updateStore } from './store';
import type { GymUnit } from './types';
import { buildUnitGeocodeQueries, unitAddressFieldsChanged } from '../addresses/unit-geocode';

function unitNeedsGeocode(unit: GymUnit): boolean {
  return !unitHasCoordinates(unit) && buildUnitGeocodeQueries(unit).length > 0;
}

@Injectable()
export class UnitCoordinatesService implements OnModuleInit {
  private readonly logger = new Logger(UnitCoordinatesService.name);
  private backfillRunning = false;

  constructor(private readonly addresses: AddressesService) {}

  onModuleInit() {
    void this.backfillMissingCoordinates();
  }

  async applyToUnit(unit: GymUnit): Promise<GymUnit> {
    if (unitHasCoordinates(unit)) return unit;
    const coords = await this.addresses.geocodeUnit(unit);
    if (!coords) return unit;
    return { ...unit, latitude: coords.latitude, longitude: coords.longitude };
  }

  async applyIfNeeded(before: GymUnit, after: GymUnit): Promise<GymUnit> {
    if (unitAddressFieldsChanged(before, after)) {
      const { latitude: _lat, longitude: _lon, ...rest } = after;
      return this.applyToUnit(rest as GymUnit);
    }
    if (unitHasCoordinates(after)) return after;
    return this.applyToUnit(after);
  }

  async backfillMissingCoordinates() {
    if (this.backfillRunning) return;
    this.backfillRunning = true;

    try {
      const store = loadStore();
      const missing = store.units.filter((unit) => unitNeedsGeocode(unit));
      if (!missing.length) return;

      this.logger.log(`Geocodificando ${missing.length} unidade(s) sem coordenadas…`);

      for (const unit of missing) {
        const coords = await this.addresses.geocodeUnit(unit);
        if (coords) {
          updateStore((s) => {
            const idx = s.units.findIndex((u) => u.id === unit.id);
            if (idx >= 0 && !unitHasCoordinates(s.units[idx])) {
              s.units[idx] = {
                ...s.units[idx],
                latitude: coords.latitude,
                longitude: coords.longitude,
              };
            }
          });
          this.logger.log(`Coordenadas definidas para ${unit.id} (${unit.unitName})`);
        } else {
          this.logger.warn(`Não foi possível geocodificar ${unit.id} (${unit.unitName})`);
        }
      }
    } catch (error) {
      this.logger.error('Falha ao geocodificar unidades', error);
    } finally {
      this.backfillRunning = false;
    }
  }
}
