/**
 * PropertyValuationProvider — the seam for automated property estimates.
 * Nothing outside this file may talk to a valuation vendor directly, so the
 * vendor is swappable (RentCast today, anything later).
 *
 * Estimates are ALWAYS stored as `source: "automated"` valuations and are
 * presented as estimates, never as guaranteed market values. Manual entries
 * take precedence under the hybrid method (see domain/assets.ts).
 */
import "server-only";

export interface PropertyLookup {
  /** Vendor's identifier for the property, when it has one. */
  providerPropertyId: string | null;
  formattedAddress: string;
  propertyType: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  squareFootage: number | null;
}

export interface PropertyValueEstimate {
  value: number;
  valueLow: number | null;
  valueHigh: number | null;
  asOf: string; // YYYY-MM-DD
  source: string; // e.g. "rentcast"
}

export interface PropertyComparable {
  address: string;
  price: number | null;
  squareFootage: number | null;
  distanceMiles: number | null;
}

export interface PropertyValuationProvider {
  readonly name: string;
  lookupProperty(address: string): Promise<PropertyLookup | null>;
  getCurrentValue(address: string): Promise<PropertyValueEstimate | null>;
  getValueRange(
    address: string,
  ): Promise<Pick<PropertyValueEstimate, "valueLow" | "valueHigh"> | null>;
  getComparables(address: string): Promise<PropertyComparable[]>;
}

/**
 * RentCast implementation (https://developers.rentcast.io). Requires
 * RENTCAST_API_KEY; free tier covers modest personal usage. Inert when the
 * key is absent — manual valuation is always available regardless.
 */
class RentCastProvider implements PropertyValuationProvider {
  readonly name = "rentcast";

  private async request<T>(path: string, address: string): Promise<T | null> {
    const key = process.env.RENTCAST_API_KEY;
    if (!key) return null;
    const url = `https://api.rentcast.io/v1${path}?address=${encodeURIComponent(address)}`;
    const res = await fetch(url, {
      headers: { "X-Api-Key": key, Accept: "application/json" },
      // Property values move slowly; avoid hammering the paid API.
      next: { revalidate: 86_400 },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  }

  async lookupProperty(address: string): Promise<PropertyLookup | null> {
    const data = await this.request<
      {
        id?: string;
        formattedAddress?: string;
        propertyType?: string;
        bedrooms?: number;
        bathrooms?: number;
        squareFootage?: number;
      }[]
    >("/properties", address);
    const p = data?.[0];
    if (!p) return null;
    return {
      providerPropertyId: p.id ?? null,
      formattedAddress: p.formattedAddress ?? address,
      propertyType: p.propertyType ?? null,
      bedrooms: p.bedrooms ?? null,
      bathrooms: p.bathrooms ?? null,
      squareFootage: p.squareFootage ?? null,
    };
  }

  async getCurrentValue(address: string): Promise<PropertyValueEstimate | null> {
    const data = await this.request<{
      price?: number;
      priceRangeLow?: number;
      priceRangeHigh?: number;
    }>("/avm/value", address);
    if (!data?.price) return null;
    return {
      value: data.price,
      valueLow: data.priceRangeLow ?? null,
      valueHigh: data.priceRangeHigh ?? null,
      asOf: new Date().toISOString().slice(0, 10),
      source: this.name,
    };
  }

  async getValueRange(address: string) {
    const est = await this.getCurrentValue(address);
    return est ? { valueLow: est.valueLow, valueHigh: est.valueHigh } : null;
  }

  async getComparables(address: string): Promise<PropertyComparable[]> {
    const data = await this.request<{
      comparables?: {
        formattedAddress?: string;
        price?: number;
        squareFootage?: number;
        distance?: number;
      }[];
    }>("/avm/value", address);
    return (data?.comparables ?? []).map((c) => ({
      address: c.formattedAddress ?? "",
      price: c.price ?? null,
      squareFootage: c.squareFootage ?? null,
      distanceMiles: c.distance ?? null,
    }));
  }
}

export function isPropertyValuationConfigured(): boolean {
  return !!process.env.RENTCAST_API_KEY;
}

/** Null when no vendor is configured — callers must handle that. */
export function getPropertyValuationProvider(): PropertyValuationProvider | null {
  return isPropertyValuationConfigured() ? new RentCastProvider() : null;
}
