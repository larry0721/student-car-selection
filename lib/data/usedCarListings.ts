import { fetchWithTimeout } from "@/lib/data/fetchWithTimeout";
import type { DataProviderStatus, UsedCarListing, VehicleDataOverlay, VehicleIdentity } from "@/types/data";

type ListingProvider = "custom" | "marketcheck";

export function getUsedCarListingProviderStatus(): DataProviderStatus {
  const provider = getListingProvider();

  if (provider === "marketcheck") {
    return {
      source: "listing-api",
      configured: Boolean(process.env.MARKETCHECK_API_KEY || process.env.USED_CAR_API_KEY),
      message: process.env.MARKETCHECK_API_KEY || process.env.USED_CAR_API_KEY
        ? "Marketcheck listing API configured."
        : "Marketcheck selected, but MARKETCHECK_API_KEY is missing.",
    };
  }

  return {
    source: "listing-api",
    configured: Boolean(process.env.USED_CAR_API_BASE_URL),
    message: process.env.USED_CAR_API_BASE_URL
      ? "Custom used-car listing API configured."
      : "Used-car listings, market prices, and verified photos need a provider key or USED_CAR_API_BASE_URL.",
  };
}

export async function fetchUsedCarListings(identity: VehicleIdentity): Promise<UsedCarListing[]> {
  if (!identity.make || !identity.model) return [];

  const provider = getListingProvider();
  if (provider === "marketcheck") return fetchMarketcheckListings(identity);
  return fetchCustomListings(identity);
}

export async function fetchListingOverlay(identity: VehicleIdentity): Promise<VehicleDataOverlay[]> {
  const status = getUsedCarListingProviderStatus();
  if (!status.configured) return [];

  const listings = await fetchUsedCarListings(identity);
  if (!listings.length) return [];

  const prices = listings.map((listing) => listing.price).filter((price): price is number => Boolean(price));
  const mileages = listings.map((listing) => listing.mileage).filter((mileage): mileage is number => Boolean(mileage));
  const imageListing = listings.find((listing) => listing.imageUrl);

  return [
    {
      make: identity.make,
      model: identity.model,
      year: identity.year,
      source: "listing-api",
      sourceId: imageListing?.sourceId || listings[0]?.sourceId,
      price: median(prices),
      mileage: median(mileages),
      listingUrl: listings[0]?.listingUrl,
      imageUrl: imageListing?.imageUrl,
      imageSource: listings[0]?.source || "listing-api",
      imageVerified: Boolean(imageListing?.imageUrl),
      fetchedAt: new Date().toISOString(),
    },
  ];
}

function getListingProvider(): ListingProvider {
  const provider = (process.env.USED_CAR_API_PROVIDER || "").toLowerCase();
  if (provider === "marketcheck") return "marketcheck";
  return "custom";
}

async function fetchCustomListings(identity: VehicleIdentity): Promise<UsedCarListing[]> {
  const baseUrl = process.env.USED_CAR_API_BASE_URL;
  if (!baseUrl) return [];

  const url = new URL(baseUrl);
  url.searchParams.set("make", identity.make);
  url.searchParams.set("model", identity.model);
  if (identity.year) url.searchParams.set("year", String(identity.year));

  const response = await fetchWithTimeout(url, {
    headers: {
      Accept: "application/json",
      ...(process.env.USED_CAR_API_KEY ? { Authorization: `Bearer ${process.env.USED_CAR_API_KEY}` } : {}),
    },
  }, 4500);

  if (!response.ok) throw new Error(`Used-car listing API request failed with status ${response.status}`);

  const data = await response.json();
  const rawListings = Array.isArray(data) ? data : data.listings || data.results || [];
  return normalizeListings(rawListings, identity, "custom-listing-api");
}

async function fetchMarketcheckListings(identity: VehicleIdentity): Promise<UsedCarListing[]> {
  const apiKey = process.env.MARKETCHECK_API_KEY || process.env.USED_CAR_API_KEY;
  if (!apiKey) return [];

  const url = new URL(process.env.MARKETCHECK_BASE_URL || "https://api.marketcheck.com/v2/search/car/active");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("make", identity.make);
  url.searchParams.set("model", getModelFamily(identity.model));
  url.searchParams.set("car_type", "used");
  url.searchParams.set("rows", "10");
  if (identity.year) url.searchParams.set("year", String(identity.year));

  const response = await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, 4500);
  if (!response.ok) throw new Error(`Marketcheck request failed with status ${response.status}`);

  const data = await response.json();
  const rawListings = Array.isArray(data) ? data : data.listings || [];
  return normalizeListings(rawListings, identity, "marketcheck");
}

function normalizeListings(rawListings: unknown[], identity: VehicleIdentity, source: string): UsedCarListing[] {
  return rawListings.slice(0, 10).map((rawListing, index) => {
    const listing = isRecord(rawListing) ? rawListing : {};
    const build = isRecord(listing.build) ? listing.build : {};
    const dealer = isRecord(listing.dealer) ? listing.dealer : {};
    const media = isRecord(listing.media) ? listing.media : {};
    const listedMake = firstString(listing.make, build.make);
    const listedModel = firstString(listing.model, build.model);
    const listedYear = toNumber(listing.year || build.year);
    const listingIdentity = {
      make: listedMake || identity.make,
      model: listedModel || identity.model,
      year: listedYear || identity.year || new Date().getFullYear(),
    };
    const canVerifyImage = Boolean(listedMake && listedModel && listedYear);
    const imageUrl = canVerifyImage && listingMatchesIdentity(identity, listingIdentity)
      ? getListingImageUrl(listing, media)
      : undefined;

    return {
      sourceId: String(listing.id || listing.listing_id || listing.vin || `${identity.make}-${identity.model}-${index}`),
      make: listingIdentity.make,
      model: listingIdentity.model,
      year: listingIdentity.year,
      price: toNumber(listing.price || listing.listPrice || listing.list_price),
      mileage: toNumber(listing.mileage || listing.miles),
      listingUrl: firstString(listing.url, listing.listingUrl, listing.vdp_url, dealer.website),
      imageUrl,
      imageVerified: Boolean(imageUrl),
      source,
    };
  });
}

function getListingImageUrl(listing: Record<string, unknown>, media: Record<string, unknown>) {
  const directUrl = firstString(
    listing.imageUrl,
    listing.photoUrl,
    listing.thumbnail,
    listing.primaryPhotoUrl,
    listing.primary_photo_url,
    media.photo_link,
  );
  if (directUrl) return directUrl;

  return firstStringFromArray(listing.photoUrls) || firstStringFromArray(listing.images) || firstStringFromArray(media.photo_links);
}

function listingMatchesIdentity(identity: VehicleIdentity, listing: VehicleIdentity) {
  const requestedYear = identity.year ? Number(identity.year) : undefined;
  const listingYear = listing.year ? Number(listing.year) : undefined;

  if (requestedYear && listingYear && requestedYear !== listingYear) return false;
  if (normalizeName(identity.make) !== normalizeName(listing.make)) return false;

  const requestedModel = normalizeName(identity.model);
  const listingModel = normalizeName(listing.model);
  const requestedFamily = getModelFamily(identity.model);
  const listingFamily = getModelFamily(listing.model);

  return (
    requestedModel === listingModel ||
    requestedModel.includes(listingModel) ||
    listingModel.includes(requestedModel) ||
    (requestedFamily.length > 1 && requestedFamily === listingFamily)
  );
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && Boolean(value.trim()))?.trim();
}

function firstStringFromArray(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value.find((item): item is string => typeof item === "string" && Boolean(item.trim()))?.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function getModelFamily(value: string) {
  return normalizeName(value).split(" ").filter(Boolean)[0] || "";
}

function toNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function median(values: number[]) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)]);
}
