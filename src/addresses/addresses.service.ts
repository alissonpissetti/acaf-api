import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildUnitGeocodeQueries, parseUnitCity, type UnitAddressFields } from './unit-geocode';

export type CepLookupResult = {
  zip: string;
  address: string;
  neighborhood: string;
  city: string;
  state: string;
  uf: string;
};

@Injectable()
export class AddressesService {
  constructor(private readonly config: ConfigService) {}

  private normalizeZip(zip: string): string {
    return zip.replace(/\D/g, '');
  }

  formatZip(zip: string): string {
    const digits = this.normalizeZip(zip);
    if (digits.length !== 8) return digits;
    return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  }

  async lookupZip(zip: string): Promise<CepLookupResult> {
    const normalized = this.normalizeZip(zip);
    if (normalized.length !== 8) {
      throw new NotFoundException('CEP inválido.');
    }

    const key = this.config.getOrThrow<string>('BUSCA_CEP_KEY');
    const endpoint = `https://cep.hub.tagsa.com.br/cep/${normalized}/${key}`;
    const response = await fetch(endpoint);

    if (!response.ok) {
      throw new NotFoundException('CEP não encontrado.');
    }

    const data = (await response.json()) as {
      retorno?: string;
      mensagem?: string;
      Endereco?: { nome?: string; cep?: string };
      Bairro?: { nome?: string };
      Cidade?: { nome?: string };
      Estado?: { nome?: string; uf?: string };
    };

    if (data.retorno === 'erro' || !data.Endereco?.nome) {
      throw new NotFoundException(data.mensagem ?? 'CEP não encontrado.');
    }

    return {
      zip: this.formatZip(data.Endereco.cep ?? normalized),
      address: data.Endereco.nome,
      neighborhood: data.Bairro?.nome ?? '',
      city: data.Cidade?.nome ?? '',
      state: data.Estado?.nome ?? '',
      uf: data.Estado?.uf ?? '',
    };
  }

  /** Geocodifica unidade por endereço (OpenStreetMap Nominatim). */
  async geocodeUnit(unit: UnitAddressFields): Promise<{ latitude: number; longitude: number } | null> {
    const zipDigits = unit.zip?.replace(/\D/g, '') ?? '';
    if (unit.address?.trim() && zipDigits.length === 8) {
      const structured = await this.geocodeStructured(unit);
      if (structured) return structured;
      await this.nominatimDelay();
    }

    const queries = buildUnitGeocodeQueries(unit);
    for (const query of queries) {
      const coords = await this.geocodeQuery(query);
      if (coords) return coords;
      await this.nominatimDelay();
    }
    return null;
  }

  private async geocodeStructured(
    unit: UnitAddressFields,
  ): Promise<{ latitude: number; longitude: number } | null> {
    const { cityName, stateUf } = parseUnitCity(unit.city, unit.state);
    const street =
      unit.number?.trim()
        ? `${unit.number.trim()} ${unit.address?.trim() ?? ''}`
        : unit.address?.trim() ?? '';
    if (!street) return null;

    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    url.searchParams.set('countrycodes', 'br');
    url.searchParams.set('street', street);
    url.searchParams.set('city', cityName);
    url.searchParams.set('state', stateUf);
    url.searchParams.set('postalcode', this.formatZip(unit.zip ?? ''));

    try {
      const response = await fetch(url.toString(), {
        headers: { 'User-Agent': 'ACAF-Connect/1.0 (acaf-api)' },
      });
      if (!response.ok) return null;
      const data = (await response.json()) as Array<{ lat?: string; lon?: string }>;
      if (!data?.length) return null;
      const latitude = Number(data[0].lat);
      const longitude = Number(data[0].lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      return { latitude, longitude };
    } catch {
      return null;
    }
  }

  private async geocodeQuery(query: string): Promise<{ latitude: number; longitude: number } | null> {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    url.searchParams.set('countrycodes', 'br');

    try {
      const response = await fetch(url.toString(), {
        headers: { 'User-Agent': 'ACAF-Connect/1.0 (acaf-api)' },
      });
      if (!response.ok) return null;
      const data = (await response.json()) as Array<{ lat?: string; lon?: string }>;
      if (!data?.length) return null;
      const latitude = Number(data[0].lat);
      const longitude = Number(data[0].lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      return { latitude, longitude };
    } catch {
      return null;
    }
  }

  private nominatimDelay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 1100));
  }
}
