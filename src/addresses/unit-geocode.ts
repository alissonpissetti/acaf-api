export type UnitAddressFields = {
  unitName?: string;
  address?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city: string;
  state?: string;
  zip?: string;
};

export function parseUnitCity(city: string, state?: string) {
  const parts = city.split('/');
  const cityName = parts[0]?.trim() ?? city.trim();
  const stateUf = (state?.trim() || parts[1]?.trim() || 'PR').toUpperCase();
  return { cityName, stateUf };
}

/** Consultas em ordem de precisão (endereço completo → bairro). */
export function buildUnitGeocodeQueries(unit: UnitAddressFields): string[] {
  const { cityName, stateUf } = parseUnitCity(unit.city, unit.state);
  const queries: string[] = [];

  const streetLine =
    unit.address?.trim()
      ? unit.number?.trim()
        ? `${unit.address.trim()}, ${unit.number.trim()}`
        : unit.address.trim()
      : '';

  if (streetLine && unit.zip?.replace(/\D/g, '').length === 8) {
    queries.push(
      [streetLine, unit.neighborhood, cityName, stateUf, unit.zip, 'Brasil']
        .filter(Boolean)
        .join(', '),
    );
  }

  if (streetLine) {
    queries.push(
      [streetLine, unit.neighborhood, cityName, stateUf, 'Brasil'].filter(Boolean).join(', '),
    );
  }

  if (unit.neighborhood?.trim() && cityName) {
    queries.push([unit.neighborhood.trim(), cityName, stateUf, 'Brasil'].join(', '));
  }

  if (unit.unitName?.trim() && cityName) {
    queries.push([unit.unitName.trim(), cityName, stateUf, 'Brasil'].join(', '));
  }

  return [...new Set(queries)];
}

export function unitAddressFieldsChanged(
  before: UnitAddressFields,
  after: UnitAddressFields,
): boolean {
  return (
    before.zip !== after.zip ||
    before.address !== after.address ||
    before.number !== after.number ||
    before.complement !== after.complement ||
    before.neighborhood !== after.neighborhood ||
    before.city !== after.city ||
    before.state !== after.state
  );
}
